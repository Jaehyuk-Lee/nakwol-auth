import type { Env } from './types';
import { getUserWithMembership } from './store';
import { getAuthLabPrivilege } from './platform-access';

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

export async function isApplicationAccessAllowed(env: Env, userId: string, clientId: string): Promise<boolean> {
  const policy = await getApplicationAccessPolicy(env, clientId);
  if (policy === 'lab') {
    const privilege = await getAuthLabPrivilege(env, userId);
    return privilege.canUseLab;
  }

  const user = await getUserWithMembership(env, userId);
  if (!user || user.status !== 'active') return false;
  if (policy === 'guest') return true;
  if (policy === 'member') return Boolean(user.membership?.is_member);
  return isPlatformAdmin(env, userId);
}
