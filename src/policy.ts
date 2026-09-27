import type { Env } from './types';
import { getUserWithMembership, upsertMembership } from './store';
import { getAuthLabPrivilege } from './platform-access';
import { fetchCurrentGuildMember, resolveNakwolRole } from './discord';
import { getRequiredRoleIds } from './role-settings';

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
  const policy = await getApplicationAccessPolicy(env, clientId);
  const user = await getUserWithMembership(env, userId);
  if (!user || user.status !== 'active') return false;
  const requiredRoles = await getRequiredRoleIds(env, clientId);
  if (policy === 'member' || requireMember || requiredRoles.length > 0) {
    const identity = await env.DB.prepare(
      `SELECT provider_user_id FROM auth_identities WHERE user_id = ? AND provider = 'discord'`
    ).bind(userId).first<{ provider_user_id: string }>();
    if (!identity) return false;
    const member = await fetchCurrentGuildMember(env, identity.provider_user_id);
    const role = resolveNakwolRole(env, member);
    await upsertMembership(env, userId, Boolean(member), role, member?.roles ?? []);
    if (role !== 'member' || !requiredRoles.every((id) => member?.roles.includes(id))) return false;
  }
  switch (policy) {
    case 'guest':
    case 'member': return true;
    case 'admin': return isPlatformAdmin(env, userId);
    case 'lab': {
      const privilege = await getAuthLabPrivilege(env, userId);
      return privilege.canUseLab;
    }
  }
}
