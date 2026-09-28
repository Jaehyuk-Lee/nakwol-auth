import type { Hono } from 'hono';
import type { Env } from './types';
import { getApplication, getRedirectUris, jsonError } from './http';
import { authenticateAccessToken } from './store';
import { diagnoseApplicationAccess } from './policy';

export function recoveryMessage(reason: string): string {
  if (['POLICY_ALLOWED', 'MANUAL_GRANT'].includes(reason)) return '낙월 인증의 접근 조건이 확인됐습니다. 서비스로 돌아가 다시 로그인해 주세요. 문제가 계속되면 서비스 관리자에게 문의해 주세요.';
  if (['USER_DISABLED', 'APP_DISABLED', 'AUTH_OPERATOR_REQUIRED', 'LAB_PRIVILEGE_REQUIRED', 'SEASON_ROLE_NOT_CONFIGURED'].includes(reason)) return '관리자 권한 또는 서비스 설정 확인이 필요합니다. 재로그인만으로 해결되지 않으므로 관리자에게 문의해 주세요.';
  if (reason === 'ADDITIONAL_ROLE_MISSING') return '이 서비스에 필요한 추가 역할이 확인되지 않았습니다. 역할을 받은 뒤 Discord로 다시 확인하거나 관리자에게 문의해 주세요.';
  if (['SEASON_ROLE_MISSING', 'MEMBERSHIP_INACTIVE', 'REAUTHENTICATION_REQUIRED'].includes(reason)) return '시즌3 맹원 상태를 다시 확인해 주세요. 역할을 받은 Discord 계정으로 아래에서 다시 인증할 수 있습니다.';
  return '계정을 확인한 뒤 서비스로 돌아가 다시 시도해 주세요. 관리자 차단이나 서비스 설정 문제는 관리자 확인이 필요합니다.';
}

export function registeredRecoveryUrl(uris: string[]): string | null {
  for (const uri of uris) {
    try {
      const url = new URL(uri);
      if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url.href;
    } catch {}
  }
  return null;
}

export function registerAccountRecoveryRoutes(app: Hono<{ Bindings: Env }>, accountClientId: string): void {
  app.get('/account/api/recovery', async (c) => {
    c.header('Cache-Control', 'no-store');
    const clientId = c.req.query('client_id') ?? '';
    const application = await getApplication(c.env, clientId);
    if (!application) return jsonError(c, 404, 'UNKNOWN_SERVICE', '등록된 서비스를 찾을 수 없습니다.');
    let reason = application.status === 'active' ? '' : 'APP_DISABLED';
    const header = c.req.header('Authorization');
    if (header) {
      const token = header.match(/^Bearer\s+(.+)$/i)?.[1];
      const userId = token ? await authenticateAccessToken(c.env, token, accountClientId) : null;
      if (!userId) return jsonError(c, 401, 'INVALID_ACCOUNT_TOKEN', '다시 로그인해 주세요.');
      const diagnosis = await diagnoseApplicationAccess(c.env, userId, clientId);
      reason = diagnosis.reason;
    }
    return c.json({ ok: true, data: {
      name: application.name,
      url: application.status === 'active' ? registeredRecoveryUrl(getRedirectUris(application)) : null,
      message: recoveryMessage(reason),
    } });
  });
}
