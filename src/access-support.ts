import type { Context, Hono } from 'hono';
import type { Env } from './types';
import { authenticateAccessToken } from './store';
import { diagnoseApplicationAccess, getApplicationAccessPolicy, isPlatformAdmin } from './policy';
import { randomToken } from './crypto';

async function operator(c: Context<{ Bindings: Env }>) {
  const token = c.req.header('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const userId = token ? await authenticateAccessToken(c.env, token, 'nakwol-connect-admin') : null;
  if (!userId) return c.json({ error: { message: '운영자 로그인이 필요합니다.' } }, 401);
  if (!await isPlatformAdmin(c.env, userId)) return c.json({ error: { message: 'AUTH 운영자만 조치할 수 있습니다.' } }, 403);
  return userId;
}

export function registerAccessSupportRoutes(app: Hono<{ Bindings: Env }>): void {
  app.use('/admin/api/access/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.get('/admin/api/access/:clientId', async (c) => {
    const actor = await operator(c);
    if (actor instanceof Response) return actor;
    const clientId = c.req.param('clientId');
    const discordId = c.req.query('discord_id')?.trim() || '';
    if (discordId && !/^\d{15,22}$/.test(discordId)) return c.json({ error: { message: '숫자로 된 Discord 사용자 ID를 입력하세요.' } }, 400);
    const before = Number(c.req.query('before') || Date.now() + 1);
    const cursorId = c.req.query('cursor_id') || '';
    if (!Number.isSafeInteger(before) || before < 0) return c.json({ error: { message: '잘못된 조회 시각입니다.' } }, 400);
    const events = await c.env.DB.prepare(`SELECT e.id, e.user_id, e.event_type, e.created_at, e.detail,
      u.display_name, i.provider_user_id AS discord_user_id
      FROM auth_events e LEFT JOIN users u ON u.id = e.user_id
      LEFT JOIN auth_identities i ON i.user_id = e.user_id AND i.provider = 'discord'
      WHERE e.client_id = ? AND (e.created_at < ? OR (e.created_at = ? AND e.id < ?))
      AND (? = '' OR i.provider_user_id = ? OR json_extract(e.detail, '$.discord_user_id') = ?)
      ORDER BY e.created_at DESC, e.id DESC LIMIT 51`).bind(clientId, before, before, cursorId, discordId, discordId, discordId).all();
    const grants = await c.env.DB.prepare(`SELECT g.*, u.display_name FROM application_access_grants g
      LEFT JOIN auth_identities i ON i.provider = 'discord' AND i.provider_user_id = g.discord_user_id
      LEFT JOIN users u ON u.id = i.user_id WHERE g.client_id = ? ORDER BY g.updated_at DESC LIMIT 200`).bind(clientId).all();
    const user = discordId ? await c.env.DB.prepare(`SELECT u.id, u.display_name, u.status FROM users u
      JOIN auth_identities i ON i.user_id = u.id WHERE i.provider = 'discord' AND i.provider_user_id = ?`)
      .bind(discordId).first<{ id: string; display_name: string; status: string }>() : null;
    const diagnosis = user ? await diagnoseApplicationAccess(c.env, user.id, clientId) : null;
    return c.json({ ok: true, events: events.results.slice(0, 50), has_more: events.results.length > 50,
      grants: grants.results, user, diagnosis });
  });

  app.post('/admin/api/access/:clientId', async (c) => {
    const actor = await operator(c);
    if (actor instanceof Response) return actor;
    const origin = c.req.header('Origin');
    if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: { message: '허용되지 않은 요청 출처입니다.' } }, 403);
    const clientId = c.req.param('clientId');
    const body: unknown = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object' || !('discord_user_id' in body) || typeof body.discord_user_id !== 'string'
      || !/^\d{15,22}$/.test(body.discord_user_id) || !('reason' in body) || typeof body.reason !== 'string'
      || !body.reason.trim() || body.reason.length > 500 || !('action' in body)
      || (body.action !== 'grant' && body.action !== 'revoke' && body.action !== 'reauthenticate')) {
      return c.json({ error: { message: 'Discord ID, 조치 종류, 사유(1~500자)가 필요합니다.' } }, 400);
    }
    const application = await c.env.DB.prepare(`SELECT status FROM applications WHERE client_id = ?`).bind(clientId).first();
    if (!application) return c.json({ error: { message: '서비스를 찾을 수 없습니다.' } }, 404);
    const policy = await getApplicationAccessPolicy(c.env, clientId);
    if (body.action === 'grant' && policy !== 'member' && policy !== 'guest') {
      return c.json({ error: { message: '멤버·게스트 서비스만 수동 허가할 수 있습니다. 운영 권한은 부여하지 않습니다.' } }, 400);
    }
    const target = await c.env.DB.prepare(`SELECT user_id FROM auth_identities WHERE provider = 'discord' AND provider_user_id = ?`)
      .bind(body.discord_user_id).first<{ user_id: string }>();
    const now = Date.now();
    const statements: D1PreparedStatement[] = [];
    if (body.action === 'reauthenticate') {
      if (!target) return c.json({ error: { message: '아직 로그인한 적 없는 사용자입니다. 수동 허가는 미리 등록할 수 있습니다.' } }, 404);
      if (actor === target.user_id) return c.json({ error: { message: '자신의 계정은 로그아웃 후 다시 로그인하세요.' } }, 400);
      statements.push(
        c.env.DB.prepare(`INSERT INTO user_reauthentication(user_id, requested_at, requested_by, reason) VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET requested_at=excluded.requested_at, requested_by=excluded.requested_by, reason=excluded.reason`)
          .bind(target.user_id, now, actor, body.reason.trim()),
        c.env.DB.prepare(`DELETE FROM auth_sessions WHERE user_id = ?`).bind(target.user_id),
        c.env.DB.prepare(`DELETE FROM auth_codes WHERE user_id = ?`).bind(target.user_id),
        c.env.DB.prepare(`UPDATE access_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).bind(now, target.user_id),
      );
    } else {
      statements.push(c.env.DB.prepare(`INSERT INTO application_access_grants(client_id, discord_user_id, status, reason, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(client_id, discord_user_id) DO UPDATE SET
        status=excluded.status, reason=excluded.reason, updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
        .bind(clientId, body.discord_user_id, body.action === 'grant' ? 'active' : 'revoked', body.reason.trim(), actor, now));
      if (target && body.action === 'revoke') statements.push(
        c.env.DB.prepare(`UPDATE access_tokens SET revoked_at = ? WHERE user_id = ? AND client_id = ? AND revoked_at IS NULL`).bind(now, target.user_id, clientId),
        c.env.DB.prepare(`DELETE FROM auth_codes WHERE user_id = ? AND client_id = ?`).bind(target.user_id, clientId),
      );
    }
    statements.push(c.env.DB.prepare(`INSERT INTO auth_events(id, user_id, client_id, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(`evt_${randomToken(10)}`, target?.user_id ?? null, clientId, `admin.access.${body.action}`,
        JSON.stringify({ actor_user_id: actor, discord_user_id: body.discord_user_id, reason: body.reason.trim() }), now));
    await c.env.DB.batch(statements);
    return c.json({ ok: true, message: body.action === 'reauthenticate'
      ? '모든 서비스의 기존 AUTH 토큰을 회수했습니다. 다음 접속 시 Discord 재인증이 필요합니다.'
      : body.action === 'grant' ? '이 서비스에 수동 접근을 허가했습니다.' : '수동 허가를 회수했습니다. 원래 역할 조건을 충족하면 계속 접근할 수 있습니다.' });
  });
}
