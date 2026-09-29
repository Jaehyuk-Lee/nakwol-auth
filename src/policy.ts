import type { Env } from './types';
import { getUserWithMembership } from './store';
import { getAuthLabPrivilege } from './platform-access';
import { getRequiredRoleIds } from './role-settings';

export const MEMBERSHIP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const NAKWOL_CONNECT_POLICY_VERSION = '0.2.0';
export type ApplicationAccessPolicy = 'guest' | 'member' | 'admin' | 'lab';

export async function getApplicationAccessPolicy(env: Env, clientId: string): Promise<ApplicationAccessPolicy> {
  const row = await env.DB.prepare(
    `SELECT access_policy FROM application_settings WHERE client_id = ?`
  ).bind(clientId).first<{ access_policy: string }>();

  if (row?.access_policy === 'public') return 'guest';
  if (
    row?.access_policy === 'guest' ||
    row?.access_policy === 'member' ||
    row?.access_policy === 'admin' ||
    row?.access_policy === 'lab'
  ) return row.access_policy;

  return 'member';
}

export async function isPlatformAdmin(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT ao.user_id
       FROM auth_operators ao
       JOIN users u ON u.id = ao.user_id
      WHERE ao.user_id = ? AND u.status = 'active'
      LIMIT 1`
  ).bind(userId).first<{ user_id: string }>();
  return Boolean(row?.user_id);
}

export async function isApplicationAccessAllowed(env: Env, userId: string, clientId: string, requireMember = false): Promise<boolean> {
  return (await diagnoseApplicationAccess(env, userId, clientId, requireMember)).allowed;
}

export async function diagnoseApplicationAccess(env: Env, userId: string, clientId: string, requireMember = false) {
  const policy = await getApplicationAccessPolicy(env, clientId);
  const user = await getUserWithMembership(env, userId);
  const requiredRoles = await getRequiredRoleIds(env, clientId);
  const membership = await env.DB.prepare(`SELECT role_ids FROM memberships WHERE user_id = ? AND guild_id = ?`)
    .bind(userId, env.NAKWOL_GUILD_ID).first<{ role_ids: string }>();
  let parsed: unknown = null;
  try { parsed = JSON.parse(membership?.role_ids ?? 'null'); } catch { parsed = null; }
  const roles: string[] = Array.isArray(parsed) && parsed.every((id: unknown) => typeof id === 'string') ? parsed : [];
  const seasonRole = env.NAKWOL_MEMBER_ROLE_ID?.trim() || '';
  const reauth = await env.DB.prepare(`SELECT requested_at FROM user_reauthentication WHERE user_id = ?`)
    .bind(userId).first<{ requested_at: number }>();
  const grant = await env.DB.prepare(`SELECT g.status FROM application_access_grants g
    JOIN auth_identities i ON i.provider = 'discord' AND i.provider_user_id = g.discord_user_id
    WHERE i.user_id = ? AND g.client_id = ?`).bind(userId, clientId).first<{ status: string }>();
  const result = (allowed: boolean, reason: string) => ({ allowed, reason, policy,
    season_role_id: seasonRole, role_ids: roles, missing_role_ids: [seasonRole, ...requiredRoles].filter(id => id && !roles.includes(id)),
    checked_at: user?.membership.checked_at ?? null, manual_grant: grant?.status === 'active',
    reauthentication_requested_at: reauth?.requested_at ?? null,
    reauthentication_status: reauth ? (Number(user?.membership.checked_at ?? 0) > reauth.requested_at ? 'completed' : 'pending') : null });
  const application = await env.DB.prepare(`SELECT status FROM applications WHERE client_id = ?`).bind(clientId).first<{ status: string }>();
  if (application?.status !== 'active') return result(false, 'APP_DISABLED');
  if (!user || user.status !== 'active') return result(false, 'USER_DISABLED');
  if (reauth && Number(user.membership.checked_at ?? 0) <= reauth.requested_at) return result(false, 'REAUTHENTICATION_REQUIRED');
  // Explicit service grants replace member role requirements, never AUTH operator/lab privileges.
  if ((policy === 'member' || policy === 'guest') && grant?.status === 'active') return result(true, 'MANUAL_GRANT');
  if (policy === 'member' || requireMember || requiredRoles.length > 0) {
    const checkedAt = Number(user.membership.checked_at);
    if (!Number.isFinite(checkedAt) || checkedAt <= 0 || checkedAt > Date.now() || Date.now() - checkedAt >= MEMBERSHIP_MAX_AGE_MS) return result(false, 'MEMBERSHIP_REFRESH_REQUIRED');
    if (!seasonRole) return result(false, 'SEASON_ROLE_NOT_CONFIGURED');
    if (!roles.includes(seasonRole)) return result(false, 'SEASON_ROLE_MISSING');
    if (!user.membership.is_member) return result(false, 'MEMBERSHIP_INACTIVE');
    if (!requiredRoles.every(id => roles.includes(id))) return result(false, 'ADDITIONAL_ROLE_MISSING');
  }
  switch (policy) {
    case 'guest':
    case 'member': return result(true, 'POLICY_ALLOWED');
    case 'admin': {
      const allowed = await isPlatformAdmin(env, userId);
      return result(allowed, allowed ? 'POLICY_ALLOWED' : 'AUTH_OPERATOR_REQUIRED');
    }
    case 'lab': {
      const privilege = await getAuthLabPrivilege(env, userId);
      return result(privilege.canUseLab, privilege.canUseLab ? 'POLICY_ALLOWED' : 'LAB_PRIVILEGE_REQUIRED');
    }
  }
}
