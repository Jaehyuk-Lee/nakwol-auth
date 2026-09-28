import type { Env } from './types';

export interface ConnectedServiceRow {
  client_id: string;
  name: string;
  homepage_url: string | null;
  access_policy: string;
  last_authorized_at: number;
}

export interface ConnectedServiceSummary {
  client_id: string;
  name: string;
  homepage_url: string | null;
  last_authorized_at: number;
  permissions: string[];
}

export function permissionLabelsForAccessPolicy(policy: string): string[] {
  if (policy === 'member') return ['NAKWOL 기본 프로필 확인', '낙월 맹원 여부 확인'];
  if (policy === 'admin') return ['NAKWOL 기본 프로필 확인', '낙월 관리자 여부 확인'];
  return ['NAKWOL 기본 프로필 확인'];
}

export function toConnectedServiceSummary(row: ConnectedServiceRow): ConnectedServiceSummary {
  return {
    client_id: row.client_id,
    name: row.name,
    homepage_url: row.homepage_url,
    last_authorized_at: row.last_authorized_at,
    permissions: permissionLabelsForAccessPolicy(row.access_policy),
  };
}

export async function listConnectedServices(env: Env, userId: string): Promise<ConnectedServiceSummary[]> {
  const result = await env.DB.prepare(
    `SELECT a.client_id,a.name,s.homepage_url,COALESCE(s.access_policy,'member') AS access_policy,MAX(e.created_at) AS last_authorized_at
     FROM auth_events e
     JOIN applications a ON a.client_id=e.client_id
     LEFT JOIN application_settings s ON s.client_id=a.client_id
     WHERE e.user_id = ?
       AND e.client_id IS NOT NULL
       AND e.event_type IN ('discord.login.success','authorize.sso','authorize.sso_auto')
       AND a.status = 'active'
       AND COALESCE(s.framework,'') <> 'internal'
     GROUP BY a.client_id,a.name,s.homepage_url,s.access_policy
     ORDER BY last_authorized_at DESC`
  ).bind(userId).all<ConnectedServiceRow>();

  return (result.results ?? []).map(toConnectedServiceSummary);
}
