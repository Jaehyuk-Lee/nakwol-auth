import { randomToken, safeEqual, sha256Base64Url } from './crypto';
import type { DiscordUser, Env, MembershipRow, SessionRow, UserRow } from './types';
import { discordAvatarUrl, fetchDiscordIdentity, resolveNakwolRole } from './discord';

// 중앙 로그인 세션: 마지막 사용 후 10일까지 유지(쓸 때마다 연장), 로그인 시점부터 최대 30일.
// 맹원 자격은 앱 토큰(1시간)을 새로 발급할 때마다 다시 확인하므로 세션 기간과 권한 회수는 분리된다.
export const SESSION_IDLE_TTL_MS = 10 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const AUTH_CODE_TTL_MS = 2 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

export async function findSessionUser(env: Env, rawToken: string | undefined): Promise<string | null> {
  if (!rawToken) return null;
  const hash = await sha256Base64Url(rawToken);
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT user_id, expires_at, created_at FROM auth_sessions WHERE token_hash = ? AND expires_at > ? AND created_at > ?`
  ).bind(hash, now, now - SESSION_ABSOLUTE_TTL_MS).first<SessionRow & { created_at: number }>();
  if (!row) return null;
  const expiresAt = sessionExpiry(Number(row.created_at), now);
  await env.DB.prepare(`UPDATE auth_sessions SET last_used_at = ?, expires_at = ? WHERE token_hash = ?`).bind(now, expiresAt, hash).run();
  return row.user_id;
}

/** 사용 시점 기준 10일 뒤, 단 로그인 시점 기준 30일을 넘지 않는다. */
export function sessionExpiry(createdAt: number, now: number): number {
  return Math.min(now + SESSION_IDLE_TTL_MS, createdAt + SESSION_ABSOLUTE_TTL_MS);
}

export async function createSession(env: Env, userId: string): Promise<{ token: string; maxAgeSeconds: number }> {
  const token = randomToken(32);
  const hash = await sha256Base64Url(token);
  const now = Date.now();
  const expiresAt = sessionExpiry(now, now);
  await env.DB.prepare(
    `INSERT INTO auth_sessions(token_hash, user_id, expires_at, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(hash, userId, expiresAt, now, now).run();
  // 쿠키는 최대 기간(30일)만큼 두고, 실제 만료(10일 비활동)는 서버의 expires_at이 판단한다.
  return { token, maxAgeSeconds: Math.floor(SESSION_ABSOLUTE_TTL_MS / 1000) };
}

export async function deleteSession(env: Env, rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  const hash = await sha256Base64Url(rawToken);
  await env.DB.prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`).bind(hash).run();
}

export async function upsertDiscordUser(env: Env, discordUser: DiscordUser, displayName: string): Promise<string> {
  const now = Date.now();
  const existing = await env.DB.prepare(
    `SELECT user_id FROM auth_identities WHERE provider = 'discord' AND provider_user_id = ?`
  ).bind(discordUser.id).first<{ user_id: string }>();

  if (existing) {
    await env.DB.prepare(
      `UPDATE users SET display_name = ?, avatar_url = ?, updated_at = ? WHERE id = ?`
    ).bind(displayName, discordAvatarUrl(discordUser), now, existing.user_id).run();
    await env.DB.prepare(
      `UPDATE auth_identities SET updated_at = ? WHERE provider = 'discord' AND provider_user_id = ?`
    ).bind(now, discordUser.id).run();
    return existing.user_id;
  }

  const userId = `usr_${randomToken(12)}`;
  const identityId = `idn_${randomToken(12)}`;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users(id, display_name, avatar_url, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)`
      ).bind(userId, displayName, discordAvatarUrl(discordUser), now, now),
      env.DB.prepare(
        `INSERT INTO auth_identities(id, user_id, provider, provider_user_id, created_at, updated_at) VALUES (?, ?, 'discord', ?, ?, ?)`
      ).bind(identityId, userId, discordUser.id, now, now),
    ]);
    return userId;
  } catch (error) {
    const raced = await env.DB.prepare(
      `SELECT user_id FROM auth_identities WHERE provider = 'discord' AND provider_user_id = ?`
    ).bind(discordUser.id).first<{ user_id: string }>();
    if (raced) return raced.user_id;
    throw error;
  }
}

export async function upsertMembership(env: Env, userId: string, isGuildMember: boolean, role: 'user' | 'member' | 'admin'): Promise<void> {
  const now = Date.now();
  const active = role === 'member' || role === 'admin';
  await env.DB.prepare(
    `INSERT INTO memberships(user_id, guild_id, is_guild_member, role, status, checked_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, guild_id) DO UPDATE SET
       is_guild_member = excluded.is_guild_member,
       role = excluded.role,
       status = excluded.status,
       checked_at = excluded.checked_at`
  ).bind(userId, env.NAKWOL_GUILD_ID, isGuildMember ? 1 : 0, role, active ? 'active' : 'inactive', now).run();
}

export async function refreshDiscordMembership(
  env: Env,
  discordAccessToken: string,
): Promise<{ userId: string; role: 'user' | 'member' | 'admin' }> {
  const { user: discordUser, member } = await fetchDiscordIdentity(env, discordAccessToken);
  const role = resolveNakwolRole(env, member);
  const displayName = member?.nick ?? discordUser.global_name ?? discordUser.username;
  const userId = await upsertDiscordUser(env, discordUser, displayName);
  await upsertMembership(env, userId, Boolean(member), role);
  return { userId, role };
}

export async function createAuthorizationCode(env: Env, userId: string, clientId: string, redirectUri: string, codeChallenge: string): Promise<string> {
  const code = randomToken(32);
  const codeHash = await sha256Base64Url(code);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO auth_codes(code_hash, user_id, client_id, redirect_uri, code_challenge, expires_at, used_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`
  ).bind(codeHash, userId, clientId, redirectUri, codeChallenge, now + AUTH_CODE_TTL_MS, now).run();
  return code;
}

export async function exchangeAuthorizationCode(env: Env, args: { code: string; clientId: string; redirectUri: string; codeVerifier: string }): Promise<{ accessToken: string; expiresIn: number }> {
  const codeHash = await sha256Base64Url(args.code);
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT user_id, client_id, redirect_uri, code_challenge, expires_at, used_at FROM auth_codes WHERE code_hash = ?`
  ).bind(codeHash).first<{
    user_id: string; client_id: string; redirect_uri: string; code_challenge: string; expires_at: number; used_at: number | null;
  }>();

  if (!row || row.used_at || row.expires_at <= now) throw new Error('INVALID_OR_EXPIRED_CODE');
  if (row.client_id !== args.clientId || row.redirect_uri !== args.redirectUri) throw new Error('CODE_CLIENT_MISMATCH');

  const expected = await sha256Base64Url(args.codeVerifier);
  if (!safeEqual(expected, row.code_challenge)) throw new Error('PKCE_VERIFICATION_FAILED');

  const accessToken = randomToken(32);
  const tokenHash = await sha256Base64Url(accessToken);
  const expiresAt = now + ACCESS_TOKEN_TTL_MS;
  await env.DB.batch([
    env.DB.prepare(`UPDATE auth_codes SET used_at = ? WHERE code_hash = ?`).bind(now, codeHash),
    env.DB.prepare(
      `INSERT INTO access_tokens(token_hash, user_id, client_id, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)`
    ).bind(tokenHash, row.user_id, args.clientId, expiresAt, now),
  ]);
  return { accessToken, expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000) };
}

export async function authenticateAccessToken(env: Env, rawToken: string, clientId: string): Promise<string | null> {
  const hash = await sha256Base64Url(rawToken);
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT user_id, client_id, expires_at, revoked_at FROM access_tokens WHERE token_hash = ?`
  ).bind(hash).first<{ user_id: string; client_id: string; expires_at: number; revoked_at: number | null }>();
  if (!row || row.revoked_at || row.expires_at <= now || row.client_id !== clientId) return null;
  return row.user_id;
}

export async function inspectAccessToken(env: Env, rawToken: string, clientId: string): Promise<{ userId: string; clientId: string; expiresAt: number } | null> {
  const hash = await sha256Base64Url(rawToken);
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT user_id, client_id, expires_at, revoked_at FROM access_tokens WHERE token_hash = ?`
  ).bind(hash).first<{ user_id: string; client_id: string; expires_at: number; revoked_at: number | null }>();
  if (!row || row.revoked_at || row.expires_at <= now || row.client_id !== clientId) return null;
  return { userId: row.user_id, clientId: row.client_id, expiresAt: Number(row.expires_at) };
}

export async function revokeAccessToken(env: Env, rawToken: string): Promise<void> {
  const hash = await sha256Base64Url(rawToken);
  await env.DB.prepare(`UPDATE access_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`).bind(Date.now(), hash).run();
}

export async function revokeAccessTokensForUser(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(`UPDATE access_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).bind(Date.now(), userId).run();
}

export async function getUserWithMembership(env: Env, userId: string) {
  const user = await env.DB.prepare(`SELECT id, display_name, avatar_url, status FROM users WHERE id = ?`).bind(userId).first<UserRow>();
  if (!user) return null;
  const membership = await env.DB.prepare(
    `SELECT user_id, guild_id, is_guild_member, role, status, checked_at FROM memberships WHERE user_id = ? AND guild_id = ?`
  ).bind(userId, env.NAKWOL_GUILD_ID).first<MembershipRow>();
  return {
    id: user.id,
    display_name: user.display_name,
    avatar_url: user.avatar_url,
    status: user.status,
    membership: {
      is_guild_member: Boolean(membership?.is_guild_member),
      is_member: membership?.role === 'member' || membership?.role === 'admin',
      role: membership?.role ?? 'user',
      checked_at: membership?.checked_at ?? null,
    },
  };
}

export async function logAuthEvent(env: Env, eventType: string, userId?: string | null, clientId?: string | null, detail?: unknown): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO auth_events(id, user_id, client_id, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(`evt_${randomToken(10)}`, userId ?? null, clientId ?? null, eventType, detail === undefined ? null : JSON.stringify(detail), Date.now()).run();
}

export async function cleanupExpiredAuthData(env: Env): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM oauth_requests WHERE expires_at <= ?`).bind(now),
    env.DB.prepare(`DELETE FROM auth_sessions WHERE expires_at <= ?`).bind(now),
    env.DB.prepare(`DELETE FROM auth_codes WHERE expires_at <= ?`).bind(now),
    env.DB.prepare(`DELETE FROM access_tokens WHERE expires_at <= ? OR revoked_at IS NOT NULL`).bind(now),
  ]);
}
