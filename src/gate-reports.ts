import type { Hono } from 'hono';
import { requirePrincipal, requireOwnedApp } from './connect-cli-apps';
import { requireManager } from './connect';
import { randomToken, sha256Base64Url } from './crypto';
import type { Env } from './types';

const MAX_BYTES = 16 * 1024;
const TOKEN_TTL = 90 * 24 * 60 * 60 * 1000;
const FIELDS = new Set(['schema_version', 'installed_version', 'runtime_version', 'commit_sha', 'status', 'checked_count', 'failure_count', 'service_url', 'deployment_id', 'previous_deployment_id']);
const STATUSES = new Set(['verified', 'failed', 'indeterminate', 'recovered', 'rollback-failed']);

type GateSummary = {
  readonly schema_version: 1;
  readonly installed_version: string;
  readonly runtime_version: string | null;
  readonly commit_sha: string;
  readonly status: string;
  readonly checked_count: number;
  readonly failure_count: number;
  readonly service_url: string;
  readonly deployment_id: string | null;
  readonly previous_deployment_id: string | null;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function version(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(value) && value.length <= 80;
}

function deploymentId(value: unknown): value is string | null | undefined {
  return value == null || (typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value));
}

function url(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try { return new URL(value); } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

function parseSummary(value: unknown, origins: ReadonlySet<string>): GateSummary | null {
  if (!record(value) || Object.keys(value).some((key) => !FIELDS.has(key))) return null;
  if (value.schema_version !== 1 || !version(value.installed_version) || !(value.runtime_version === null || version(value.runtime_version))) return null;
  if (typeof value.commit_sha !== 'string' || !/^[a-fA-F0-9]{40}$/.test(value.commit_sha)) return null;
  if (typeof value.status !== 'string' || !STATUSES.has(value.status)) return null;
  const checked = value.checked_count;
  const failures = value.failure_count;
  if (typeof checked !== 'number' || !Number.isSafeInteger(checked) || checked < 0 || checked > 10000) return null;
  if (typeof failures !== 'number' || !Number.isSafeInteger(failures) || failures < 0 || failures > checked) return null;
  if (['verified', 'recovered'].includes(value.status) && (checked === 0 || failures !== 0 || value.runtime_version === null)) return null;
  if (value.status === 'failed' && failures === 0) return null;
  if (!deploymentId(value.deployment_id) || !deploymentId(value.previous_deployment_id)) return null;
  const service = url(value.service_url);
  if (!service || !origins.has(service.origin) || service.username || service.password || service.search || service.hash || service.pathname !== '/') return null;
  return {
    schema_version: 1, installed_version: value.installed_version, runtime_version: value.runtime_version,
    commit_sha: value.commit_sha.toLowerCase(), status: value.status, checked_count: checked, failure_count: failures,
    service_url: service.origin, deployment_id: value.deployment_id ?? null, previous_deployment_id: value.previous_deployment_id ?? null,
  };
}

async function history(env: Env, clientId: string) {
  const rows = await env.DB.prepare('SELECT id, received_at, summary_json FROM gate_reports WHERE client_id = ? ORDER BY id DESC LIMIT 100')
    .bind(clientId).all<{ id: number; received_at: number; summary_json: string }>();
  const reports = (rows.results || []).map((row) => {
    const summary: unknown = JSON.parse(row.summary_json);
    return { ...(record(summary) ? summary : {}), id: row.id, received_at: row.received_at };
  });
  const token = await env.DB.prepare('SELECT expires_at FROM gate_report_tokens WHERE client_id = ?').bind(clientId).first<{ expires_at: number }>();
  return { reports, informational: true, token: { active: Boolean(token && token.expires_at > Date.now()), expires_at: token?.expires_at ?? null } };
}

export function registerGateReportRoutes(app: Hono<{ Bindings: Env }>): void {
  for (const path of ['/connect/gate-reports/*', '/connect/cli/apps/*/gate-report-token', '/connect/cli/apps/*/gate-reports', '/admin/api/apps/*/gate-reports']) {
    app.use(path, async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
  }
  app.post('/connect/cli/apps/:clientId/gate-report-token', async (c) => {
    const principal = await requirePrincipal(c);
    if (principal instanceof Response) return principal;
    const clientId = c.req.param('clientId');
    const access = await requireOwnedApp(c, principal, clientId);
    if (access.response) return access.response;
    const token = `nwgr_${randomToken()}`;
    const now = Date.now();
    const expires = now + TOKEN_TTL;
    await c.env.DB.prepare('INSERT INTO gate_report_tokens(client_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(client_id) DO UPDATE SET token_hash=excluded.token_hash, expires_at=excluded.expires_at, created_at=excluded.created_at')
      .bind(clientId, await sha256Base64Url(token), expires, now).run();
    return c.json({ ok: true, data: { token, expires_at: expires } }, 201);
  });
  app.delete('/connect/cli/apps/:clientId/gate-report-token', async (c) => {
    const principal = await requirePrincipal(c);
    if (principal instanceof Response) return principal;
    const clientId = c.req.param('clientId');
    const access = await requireOwnedApp(c, principal, clientId);
    if (access.response) return access.response;
    await c.env.DB.prepare('DELETE FROM gate_report_tokens WHERE client_id = ?').bind(clientId).run();
    return c.json({ ok: true });
  });
  app.get('/connect/cli/apps/:clientId/gate-reports', async (c) => {
    const principal = await requirePrincipal(c);
    if (principal instanceof Response) return principal;
    const clientId = c.req.param('clientId');
    const access = await requireOwnedApp(c, principal, clientId);
    if (access.response) return access.response;
    return c.json({ ok: true, data: await history(c.env, clientId) });
  });
  app.get('/admin/api/apps/:clientId/gate-reports', async (c) => {
    const principal = await requireManager(c);
    if (principal instanceof Response) return principal;
    const clientId = c.req.param('clientId');
    const exists = await c.env.DB.prepare('SELECT client_id FROM applications WHERE client_id = ?').bind(clientId).first();
    if (!exists) return c.json({ ok: false, error: { code: 'APP_NOT_FOUND' } }, 404);
    return c.json({ ok: true, data: await history(c.env, clientId) });
  });
  app.post('/connect/gate-reports/:clientId', async (c) => {
    const clientId = c.req.param('clientId');
    const token = c.req.header('Authorization')?.match(/^Bearer (nwgr_[A-Za-z0-9_-]{43})$/)?.[1];
    if (!token) return c.json({ ok: false, error: { code: 'INVALID_REPORT_TOKEN' } }, 401);
    const authorized = await c.env.DB.prepare('SELECT a.redirect_uris, s.homepage_url FROM gate_report_tokens t JOIN applications a ON a.client_id=t.client_id LEFT JOIN application_settings s ON s.client_id=a.client_id WHERE t.client_id=? AND t.token_hash=? AND t.expires_at>? AND a.status=\'active\'')
      .bind(clientId, await sha256Base64Url(token), Date.now()).first<{ redirect_uris: string; homepage_url: string | null }>();
    if (!authorized) return c.json({ ok: false, error: { code: 'INVALID_REPORT_TOKEN' } }, 401);
    const origins = new Set<string>();
    const redirects: unknown = JSON.parse(authorized.redirect_uris);
    for (const candidate of [authorized.homepage_url, ...(Array.isArray(redirects) ? redirects : [])]) {
      const parsed = url(candidate);
      if (parsed) origins.add(parsed.origin);
    }
    const reader = c.req.raw.body?.getReader();
    if (!reader) return c.json({ ok: false, error: { code: 'INVALID_REPORT' } }, 400);
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_BYTES) { await reader.cancel(); return c.json({ ok: false, error: { code: 'REPORT_TOO_LARGE' } }, 413); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let input: unknown;
    try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return c.json({ ok: false, error: { code: 'INVALID_REPORT' } }, 400);
    }
    const summary = parseSummary(input, origins);
    if (!summary) return c.json({ ok: false, error: { code: 'INVALID_REPORT' } }, 400);
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO gate_reports(client_id, received_at, summary_json) VALUES (?, ?, ?)').bind(clientId, Date.now(), JSON.stringify(summary)),
      c.env.DB.prepare('DELETE FROM gate_reports WHERE client_id = ? AND id NOT IN (SELECT id FROM gate_reports WHERE client_id = ? ORDER BY id DESC LIMIT 100)').bind(clientId, clientId),
    ]);
    return c.json({ ok: true, informational: true }, 201);
  });
}
