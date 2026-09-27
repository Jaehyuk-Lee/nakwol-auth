import type { Context, Hono } from 'hono';
import { authenticateCliToken, type ConnectPrincipal } from './connect-cli-store';
import { normalizeClientId, validateConnectRedirectUri } from './connect-cli-domain';
import {
  canManageOwnedApplication,
  canRequestAccessPolicy,
  hasConnectAppScope,
  nextAvailableClientId,
  resolveAppStatus,
} from './connect-admin-developers';
import { logAuthEvent } from './store';
import type { Env } from './types';

const FRAMEWORKS = new Set(['html', 'vite', 'react', 'vue', 'cra', 'sveltekit', 'next_app', 'next_pages', 'other']);

function bearer(c: Context<{ Bindings: Env }>): string | null {
  const header = c.req.header('Authorization') || '';
  return header.match(/^Bearer\s+(.+)$/i)?.[1] || null;
}

async function requirePrincipal(c: Context<{ Bindings: Env }>): Promise<ConnectPrincipal | Response> {
  const raw = bearer(c);
  if (!raw) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'CLI token이 필요합니다.' } }, 401);
  const principal = await authenticateCliToken(c.env, raw);
  if (!principal) return c.json({ ok: false, error: { code: 'INVALID_CLI_TOKEN', message: 'CLI token이 만료되었거나 취소되었습니다.' } }, 401);
  if (!hasConnectAppScope(principal.scopes)) {
    return c.json({ ok: false, error: { code: 'CLI_SCOPE_REQUIRED', message: 'connect:apps 권한이 필요합니다.' } }, 403);
  }
  return principal;
}

function parseRedirectUris(raw: string): string[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

async function ownerIds(env: Env, clientId: string): Promise<string[]> {
  const result = await env.DB.prepare(`SELECT user_id FROM application_owners WHERE client_id = ?`).bind(clientId).all<{ user_id: string }>();
  return (result.results || []).map((row) => row.user_id);
}

async function readApp(env: Env, clientId: string) {
  const row = await env.DB.prepare(
    `SELECT a.client_id, a.name, a.redirect_uris, a.status,
            s.homepage_url, s.framework, s.access_policy, s.created_at, s.updated_at
       FROM applications a
       LEFT JOIN application_settings s ON s.client_id = a.client_id
      WHERE a.client_id = ?`
  ).bind(clientId).first<any>();
  if (!row) return null;
  return {
    client_id: row.client_id,
    name: row.name,
    redirect_uris: parseRedirectUris(row.redirect_uris),
    status: row.status,
    homepage_url: row.homepage_url ?? null,
    framework: row.framework ?? 'other',
    access_policy: row.access_policy === 'public' ? 'guest' : row.access_policy ?? 'member',
    owner_user_ids: await ownerIds(env, clientId),
    created_at: row.created_at == null ? null : Number(row.created_at),
    updated_at: row.updated_at == null ? null : Number(row.updated_at),
  };
}

async function requireOwnedApp(c: Context<{ Bindings: Env }>, principal: ConnectPrincipal, clientId: string) {
  const current = await readApp(c.env, clientId);
  if (!current) return { response: c.json({ ok: false, error: { code: 'APP_NOT_FOUND', message: '앱을 찾을 수 없습니다.' } }, 404) };
  if (!canManageOwnedApplication({ isOperator: principal.isOperator, userId: principal.userId, ownerUserIds: current.owner_user_ids })) {
    return { response: c.json({ ok: false, error: { code: 'APP_OWNERSHIP_REQUIRED', message: '이 앱을 관리할 권한이 없습니다.' } }, 403) };
  }
  return { app: current };
}

function validFramework(value: string): string {
  return FRAMEWORKS.has(value) ? value : 'other';
}

function validateRedirectList(values: unknown): { values?: string[]; error?: string } {
  if (!Array.isArray(values) || values.length < 1 || values.length > 10) return { error: 'Redirect URI를 1~10개 제공해야 합니다.' };
  const output: string[] = [];
  for (const item of values) {
    const check = validateConnectRedirectUri(String(item));
    if (!check.ok) return { error: `허용할 수 없는 Redirect URI입니다: ${String(item)}` };
    output.push(check.value);
  }
  return { values: [...new Set(output)] };
}

export function registerConnectCliAppRoutes(app: Hono<{ Bindings: Env }>): void {
  app.post('/connect/cli/apps', async (c) => {
    const principal = await requirePrincipal(c);
    if (principal instanceof Response) return principal;
    const body: {
      name?: string;
      client_id?: string;
      homepage_url?: string | null;
      framework?: string;
      access_policy?: string;
      redirect_uris?: unknown;
    } = await c.req.json().catch(() => ({} as any));

    const name = String(body.name || '').trim();
    if (!name || name.length > 100) return c.json({ ok: false, error: { code: 'INVALID_APP_NAME', message: '앱 이름은 1~100자여야 합니다.' } }, 400);
    const requestedAccessPolicy = String(body.access_policy || 'member');
    if (!canRequestAccessPolicy(principal.isOperator, requestedAccessPolicy)) return c.json({ ok: false, error: { code: 'ACCESS_POLICY_DENIED', message: '이 접근 정책을 사용할 권한이 없습니다.' } }, 403);
    const accessPolicy = requestedAccessPolicy === 'public' ? 'guest' : requestedAccessPolicy;
    const redirects = validateRedirectList(body.redirect_uris);
    if (!redirects.values) return c.json({ ok: false, error: { code: 'INVALID_REDIRECT_URI', message: redirects.error } }, 400);

    const base = normalizeClientId(String(body.client_id || name));
    const candidates = await c.env.DB.prepare(`SELECT client_id FROM applications WHERE client_id = ? OR client_id LIKE ?`).bind(base, `${base}-%`).all<{ client_id: string }>();
    const existing = new Set((candidates.results || []).map((row) => row.client_id));
    const clientId = nextAvailableClientId(base, existing);
    const framework = validFramework(String(body.framework || 'other'));
    const homepage = body.homepage_url == null ? null : String(body.homepage_url).trim() || null;
    if (homepage) {
      const check = validateConnectRedirectUri(homepage);
      if (!check.ok) return c.json({ ok: false, error: { code: 'INVALID_HOMEPAGE_URL', message: '서비스 주소는 HTTPS 또는 localhost여야 합니다.' } }, 400);
    }

    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO applications(client_id, name, redirect_uris, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)`)
        .bind(clientId, name, JSON.stringify(redirects.values), now, now),
      c.env.DB.prepare(`INSERT INTO application_settings(client_id, homepage_url, framework, access_policy, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(clientId, homepage, framework, accessPolicy, principal.userId, now, now),
      c.env.DB.prepare(`INSERT INTO application_owners(client_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`)
        .bind(clientId, principal.userId, now),
    ]);
    await logAuthEvent(c.env, 'connect.cli.app.created', principal.userId, clientId, { framework, access_policy: accessPolicy });
    return c.json({ ok: true, data: await readApp(c.env, clientId) }, 201);
  });

  app.get('/connect/cli/apps/:clientId', async (c) => {
    const principal = await requirePrincipal(c);
    if (principal instanceof Response) return principal;
    const access = await requireOwnedApp(c, principal, c.req.param('clientId'));
    if (access.response) return access.response;
    return c.json({ ok: true, data: access.app });
  });

  app.patch('/connect/cli/apps/:clientId', async (c) => {
    const principal = await requirePrincipal(c);
    if (principal instanceof Response) return principal;
    const clientId = c.req.param('clientId');
    const access = await requireOwnedApp(c, principal, clientId);
    if (access.response) return access.response;
    const body: { name?: string; homepage_url?: string | null; framework?: string; access_policy?: string; status?: string } = await c.req.json().catch(() => ({} as any));
    const current = access.app!;
    const name = body.name == null ? current.name : String(body.name).trim();
    const requestedPolicy = body.access_policy == null ? current.access_policy : String(body.access_policy);
    if (!name || name.length > 100) return c.json({ ok: false, error: { code: 'INVALID_APP_NAME', message: '앱 이름은 1~100자여야 합니다.' } }, 400);
    if (!canRequestAccessPolicy(principal.isOperator, requestedPolicy)) return c.json({ ok: false, error: { code: 'ACCESS_POLICY_DENIED', message: '이 접근 정책을 사용할 권한이 없습니다.' } }, 403);
    const policy = requestedPolicy === 'public' ? 'guest' : requestedPolicy;
    const framework = body.framework == null ? current.framework : validFramework(String(body.framework));
    const status = resolveAppStatus(current.status, body.status);
    const homepage = body.homepage_url === undefined ? current.homepage_url : body.homepage_url == null ? null : String(body.homepage_url).trim() || null;
    if (homepage) {
      const check = validateConnectRedirectUri(homepage);
      if (!check.ok) return c.json({ ok: false, error: { code: 'INVALID_HOMEPAGE_URL', message: '서비스 주소는 HTTPS 또는 localhost여야 합니다.' } }, 400);
    }
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE applications SET name = ?, status = ?, updated_at = ? WHERE client_id = ?`).bind(name, status, now, clientId),
      c.env.DB.prepare(`UPDATE application_settings SET homepage_url = ?, framework = ?, access_policy = ?, updated_at = ? WHERE client_id = ?`)
        .bind(homepage, framework, policy, now, clientId),
    ]);
    await logAuthEvent(c.env, 'connect.cli.app.updated', principal.userId, clientId, { framework, access_policy: policy, status });
    return c.json({ ok: true, data: await readApp(c.env, clientId) });
  });

  app.post('/connect/cli/apps/:clientId/redirects', async (c) => {
    const principal = await requirePrincipal(c);
    if (principal instanceof Response) return principal;
    const clientId = c.req.param('clientId');
    const access = await requireOwnedApp(c, principal, clientId);
    if (access.response) return access.response;
    const body: { redirect_uri?: string } = await c.req.json().catch(() => ({} as { redirect_uri?: string }));
    const check = validateConnectRedirectUri(String(body.redirect_uri || ''));
    if (!check.ok) return c.json({ ok: false, error: { code: check.code, message: '허용할 수 없는 Redirect URI입니다.' } }, 400);
    const current = access.app!;
    const redirects = [...new Set([...current.redirect_uris, check.value])];
    if (redirects.length > 10) return c.json({ ok: false, error: { code: 'TOO_MANY_REDIRECTS', message: 'Redirect URI는 최대 10개입니다.' } }, 400);
    await c.env.DB.prepare(`UPDATE applications SET redirect_uris = ?, updated_at = ? WHERE client_id = ?`).bind(JSON.stringify(redirects), Date.now(), clientId).run();
    await logAuthEvent(c.env, 'connect.cli.redirect.added', principal.userId, clientId, { redirect_uri: check.value });
    return c.json({ ok: true, data: await readApp(c.env, clientId) });
  });

  app.get('/connect/cli/apps/:clientId/diagnose', async (c) => {
    const principal = await requirePrincipal(c);
    if (principal instanceof Response) return principal;
    const clientId = c.req.param('clientId');
    const access = await requireOwnedApp(c, principal, clientId);
    if (access.response) return access.response;
    const current = access.app!;
    const checks: Array<{ name: string; ok: boolean; detail: string }> = [
      { name: 'registered', ok: current.status === 'active', detail: current.status },
      { name: 'redirects', ok: current.redirect_uris.length > 0 && current.redirect_uris.every((uri: string) => validateConnectRedirectUri(uri).ok), detail: `${current.redirect_uris.length} registered` },
      { name: 'ownership', ok: true, detail: principal.isOperator ? 'operator' : 'owner' },
    ];
    if (current.homepage_url && current.homepage_url.startsWith('https://')) {
      try {
        const response = await fetch(current.homepage_url, { redirect: 'follow', headers: { 'User-Agent': 'NAKWOL-Connect-CLI-Diagnostic/0.2' } });
        const html = (response.headers.get('Content-Type') || '').includes('text/html') ? await response.text() : '';
        checks.push({ name: 'site', ok: response.ok, detail: `HTTP ${response.status}` });
        checks.push({ name: 'embed', ok: html.includes('/connect/v1.js') && html.includes(clientId), detail: html ? 'HTML inspected' : 'non-HTML response' });
      } catch (error) {
        checks.push({ name: 'site', ok: false, detail: error instanceof Error ? error.message : String(error) });
      }
    }
    return c.json({ ok: true, data: { client_id: clientId, ok: checks.every((item) => item.ok), checks } });
  });
}
