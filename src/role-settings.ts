import type { Env } from './types';

export class RoleSettingsError extends Error {
  readonly code = 'INVALID_ROLE_SETTINGS';
}

export function parseRequiredRoleIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 25 || value.some((id: unknown) => typeof id !== 'string' || !/^[0-9]{17,20}$/.test(id))) {
    throw new RoleSettingsError('역할 목록은 최대 25개의 Discord 역할 ID여야 합니다.');
  }
  return [...new Set<string>(value)];
}

export async function getRequiredRoleIds(env: Env, clientId: string): Promise<readonly string[]> {
  const row = await env.DB.prepare('SELECT role_ids FROM application_role_requirements WHERE client_id = ?').bind(clientId).first<{ role_ids: string }>();
  if (!row) return [];
  let value: unknown;
  try { value = JSON.parse(row.role_ids); }
  catch (error) {
    if (error instanceof SyntaxError) throw new RoleSettingsError('저장된 역할 목록이 올바른 JSON이 아닙니다.');
    throw error;
  }
  return parseRequiredRoleIds(value);
}
