import type { Context, Hono } from 'hono';
import connectEmbedSource from './assets/nakwol-connect-v1.js.txt';
import connectAdminSource from './assets/nakwol-connect-admin.js.txt';
import { authenticateAccessToken, getUserWithMembership, logAuthEvent } from './store';
import type { Env } from './types';

const ADMIN_CLIENT_ID = 'nakwol-connect-admin';
const FRAMEWORKS = new Set(['html', 'vite', 'react', 'vue', 'cra', 'sveltekit', 'next_app', 'next_pages', 'other', 'internal']);
const ACCESS_POLICIES = new Set(['guest', 'member', 'admin', 'public']);
const APP_STATUSES = new Set(['active', 'disabled']);

type ConnectApp = {
  client_id: string;
  name: string;
  redirect_uris: string[];
  status: string;
  homepage_url: string | null;
  framework: string;
  access_policy: string;
  owner_user_id: string | null;
  created_at: number | null;
  updated_at: number | null;
};

type AdminIdentity = {
  userId: string;
  user: Awaited<ReturnType<typeof getUserWithMembership>>;
  operatorRole: string | null;
  operatorCount: number;
  canManage: boolean;
};

function jsResponse(source: string, cacheControl = 'public, max-age=300'): Response {
  return new Response(source, {
    status: 200,
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': cacheControl,
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function adminPage(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>NAKWOL Connect</title>
  <style>
    :root{font-family:Inter,Pretendard,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e5e7eb;background:#080c14;--panel:#111827;--panel2:#0c1321;--line:#263244;--muted:#94a3b8;--accent:#818cf8;--ok:#86efac;--bad:#fca5a5}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 10% 0%,#182038 0,#080c14 38%);color:#e5e7eb}button,input,textarea,select{font:inherit}button{cursor:pointer}
    header{height:74px;display:flex;align-items:center;justify-content:space-between;padding:0 28px;border-bottom:1px solid var(--line);background:rgba(8,12,20,.82);backdrop-filter:blur(16px);position:sticky;top:0;z-index:10}.brand{display:flex;gap:14px;align-items:center}.mark{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:#4f46e5;font-weight:900}.brand b{font-size:18px}.brand small{display:block;color:var(--muted);margin-top:2px}
    #auth-area{display:flex;align-items:center;gap:10px}.auth-copy{display:flex;flex-direction:column;align-items:flex-end}.auth-copy span{font-size:12px;color:var(--muted);margin-top:2px}
    .primary,.ghost,.copy{border:0;border-radius:10px;padding:9px 13px;font-weight:750}.primary{background:#6366f1;color:white}.primary:disabled{opacity:.55}.ghost{background:#1f2937;color:#e5e7eb;border:1px solid #334155}.copy{background:#273349;color:#dbeafe;padding:6px 10px}
    main{padding:24px;max-width:1500px;margin:0 auto}.gate-card{max-width:620px;margin:9vh auto;background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:28px;box-shadow:0 28px 80px rgba(0,0,0,.28)}.gate-card h2{margin-top:0}.gate-card p{color:var(--muted);line-height:1.6}
    .workspace{display:grid;grid-template-columns:280px minmax(0,1fr);gap:18px}.sidebar,.content-card{background:rgba(17,24,39,.88);border:1px solid var(--line);border-radius:16px}.sidebar{padding:14px;min-height:760px}.sidebar-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.sidebar-head h2{font-size:15px;margin:0}.count{background:#273349;border-radius:999px;padding:2px 8px;color:#cbd5e1;font-size:12px}.new-app{width:100%;margin-bottom:12px}.app-list{display:flex;flex-direction:column;gap:7px}.app-item{display:grid;grid-template-columns:1fr auto;gap:3px 8px;text-align:left;background:transparent;border:1px solid transparent;border-radius:11px;padding:10px;color:#e5e7eb}.app-item:hover,.app-item[data-active="true"]{background:#172033;border-color:#31415b}.app-item-title{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.app-item-meta{font-size:11px;color:var(--muted);grid-column:1}.status{font-size:10px;border-radius:999px;padding:3px 7px;align-self:start}.status-active{color:#86efac;background:#123124}.status-disabled{color:#fecaca;background:#3b1820}
    .content{display:flex;flex-direction:column;gap:16px}.content-card{padding:20px}.content-card h2,.content-card h3{margin-top:0}.content-card h3{font-size:15px;margin-bottom:14px}.detail-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.detail-head h2{margin:0;font-size:21px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.field{display:flex;flex-direction:column;gap:6px}.field.full{grid-column:1/-1}.field label{font-size:12px;color:#cbd5e1;font-weight:700}.field input,.field textarea,.field select{width:100%;border:1px solid #334155;background:#0b1220;color:#f8fafc;border-radius:10px;padding:10px 11px;outline:none}.field textarea{min-height:88px;resize:vertical}.field input:focus,.field textarea:focus,.field select:focus{border-color:#6366f1}.field small{color:var(--muted);font-size:11px}.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
    .guide-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}.guide-step{background:var(--panel2);border:1px solid var(--line);border-radius:11px;padding:12px;display:flex;flex-direction:column;gap:6px}.guide-step span{font-size:12px;color:var(--muted);line-height:1.45}.code-wrap{position:relative;margin:10px 0}.code{margin:0;background:#050912;border:1px solid #202c3f;border-radius:11px;padding:14px 70px 14px 14px;color:#c7d2fe;white-space:pre-wrap;word-break:break-word;font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace}.code-wrap .copy{position:absolute;top:8px;right:8px}.muted{color:var(--muted);font-size:13px}.diag-row{display:grid;grid-template-columns:22px 145px 1fr;gap:7px;align-items:center;border-bottom:1px solid #1f2937;padding:9px 0}.diag-ok{color:var(--ok);font-weight:900}.diag-bad{color:var(--bad);font-weight:900}.diag-detail{color:var(--muted);font-size:12px;overflow-wrap:anywhere}.event-row{padding:9px 0;border-bottom:1px solid #1f2937}.event-top{display:flex;justify-content:space-between;gap:10px}.event-top time{font-size:11px;color:var(--muted)}.event-row code{display:block;color:#94a3b8;font-size:11px;margin-top:4px}.section-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.error-text{color:var(--bad)}#toast{position:fixed;right:20px;bottom:20px;background:#172033;border:1px solid #334155;border-radius:12px;padding:12px 15px;box-shadow:0 15px 50px rgba(0,0,0,.35);z-index:30}#toast[data-bad="true"]{border-color:#7f1d1d;color:#fecaca}
    @media(max-width:900px){header{padding:0 14px}.workspace{grid-template-columns:1fr}.sidebar{min-height:auto}.app-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.form-grid,.guide-grid{grid-template-columns:1fr}.field.full{grid-column:auto}.auth-copy{display:none}}@media(max-width:560px){main{padding:12px}.app-list{grid-template-columns:1fr}.brand small{display:none}.diag-row{grid-template-columns:22px 1fr}.diag-detail{grid-column:2}}
  </style>
</head>
<body>
<header>
  <div class="brand"><div class="mark">落</div><div><b>NAKWOL Connect</b><small>앱 등록 · 설치 가이드 · 연동 진단</small></div></div>
  <div id="auth-area"></div>
</header>
<main>
  <section id="gate-area" hidden></section>
  <section id="workspace" class="workspace" hidden>
    <aside class="sidebar">
      <div class="sidebar-head"><h2>등록된 앱</h2><span id="app-count" class="count">0</span></div>
      <button id="new-app" class="primary new-app" type="button">+ 새 앱 등록</button>
      <div id="app-list" class="app-list"></div>
    </aside>
    <div class="content">
      <section class="content-card">
        <div class="detail-head"><h2 id="detail-heading">앱 선택</h2></div>
        <form id="app-form">
          <div class="form-grid">
            <div class="field"><label>앱 이름</label><input name="name" required maxlength="100" placeholder="예: 공성 계산기"></div>
            <div class="field"><label>Client ID</label><input name="client_id" required pattern="[a-z0-9][a-z0-9-]{2,62}" placeholder="siege-calculator"><small>영문 소문자, 숫자, 하이픈</small></div>
            <div class="field full"><label>서비스 주소</label><input name="homepage_url" required type="url" placeholder="https://example.pages.dev/"></div>
            <div class="field full"><label>Redirect URI</label><textarea name="redirect_uris" required placeholder="https://example.pages.dev/\nhttps://preview.example.dev/"></textarea><small>한 줄에 하나. 로그인 후 돌아올 정확한 URL입니다.</small></div>
            <div class="field"><label>개발 환경</label><select name="framework"><option value="vite">Vite</option><option value="react">React</option><option value="vue">Vue</option><option value="cra">Create React App</option><option value="next_app">Next.js App Router</option><option value="next_pages">Next.js Pages Router</option><option value="sveltekit">SvelteKit</option><option value="html">일반 HTML</option><option value="other">기타</option></select></div>
            <div class="field"><label>접근 정책</label><select name="access_policy"><option value="member">낙월 맹원 이상</option><option value="admin">AUTH 관리자만</option><option value="guest">Discord 로그인 사용자</option></select></div>
            <div class="field"><label>상태</label><select name="status"><option value="active">active</option><option value="disabled">disabled</option></select></div>
          </div>
          <div class="actions"><button id="reset-app" class="ghost" type="button">되돌리기</button><button id="save-app" class="primary" type="submit">저장</button></div>
        </form>
      </section>
      <section class="content-card"><h3>개발자 연동 방법</h3><div id="guide-area"></div></section>
      <section class="content-card"><div class="section-head"><h3>연동 진단</h3><button id="run-diagnostics" class="ghost" type="button">연동 상태 확인</button></div><div id="diagnostics-area"></div></section>
      <section class="content-card"><div class="section-head"><h3>최근 인증 이벤트</h3><button id="refresh-events" class="ghost" type="button">새로고침</button></div><div id="events-area"></div></section>
    </div>
  </section>
</main>
<div id="toast" hidden></div>
<script type="module" src="/admin/connect-app.js"></script>
</body>
</html>`;
}

function bearer(c: Context<{ Bindings: Env }>): string | null {
  const header = c.req.header('Authorization') || '';
  return header.match(/^Bearer\s+(.+)$/i)?.[1] || null;
}

async function adminIdentity(c: Context<{ Bindings: Env }>): Promise<AdminIdentity | null> {
  const token = bearer(c);
  if (!token) return null;
  const userId = await authenticateAccessToken(c.env, token, ADMIN_CLIENT_ID);
  if (!userId) return null;
  const user = await getUserWithMembership(c.env, userId);
  if (!user) return null;
  const operator = await c.env.DB.prepare(`SELECT role FROM auth_operators WHERE user_id = ?`).bind(userId).first<{ role: string }>();
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM auth_operators`).first<{ count: number }>();
  return {
    userId,
    user,
    operatorRole: operator?.role ?? null,
    operatorCount: Number(count?.count ?? 0),
    canManage: Boolean(operator) || user.membership?.role === 'admin',
  };
}

async function requireManager(c: Context<{ Bindings: Env }>): Promise<AdminIdentity | Response> {
  const identity = await adminIdentity(c);
  if (!identity) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'NAKWOL Connect 로그인이 필요합니다.' } }, 401);
  if (!identity.canManage) return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'NAKWOL Connect 운영 권한이 없습니다.' } }, 403);
  return identity;
}

function parseRedirectUris(raw: string): string[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
  } catch { return []; }
}

function appFromRow(row: any): ConnectApp {
  return {
    client_id: row.client_id,
    name: row.name,
    redirect_uris: parseRedirectUris(row.redirect_uris),
    status: row.status,
    homepage_url: row.homepage_url ?? null,
    framework: row.framework ?? 'other',
    access_policy: row.access_policy === 'public' ? 'guest' : row.access_policy ?? 'member',
    owner_user_id: row.owner_user_id ?? null,
    created_at: row.created_at == null ? null : Number(row.created_at),
    updated_at: row.updated_at == null ? null : Number(row.updated_at),
  };
}

async function readApp(env: Env, clientId: string): Promise<ConnectApp | null> {
  const row = await env.DB.prepare(
    `SELECT a.client_id, a.name, a.redirect_uris, a.status,
            s.homepage_url, s.framework, s.access_policy, s.owner_user_id, s.created_at, s.updated_at
       FROM applications a
       LEFT JOIN application_settings s ON s.client_id = a.client_id
      WHERE a.client_id = ?`
  ).bind(clientId).first();
  return row ? appFromRow(row) : null;
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}

function normalizeAppInput(raw: any, clientIdOverride?: string): { value?: any; error?: string } {
  const name = String(raw?.name || '').trim();
  const clientId = String(clientIdOverride || raw?.client_id || '').trim();
  const homepageUrl = String(raw?.homepage_url || '').trim();
  const redirectUris = Array.isArray(raw?.redirect_uris) ? raw.redirect_uris.map((item: unknown) => String(item).trim()).filter(Boolean) : [];
  const framework = String(raw?.framework || 'other');
  const requestedAccessPolicy = String(raw?.access_policy || 'member');
  const status = String(raw?.status || 'active');

  if (!name || name.length > 100) return { error: '앱 이름은 1~100자여야 합니다.' };
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(clientId)) return { error: 'Client ID는 영문 소문자/숫자로 시작하고 하이픈만 사용할 수 있습니다.' };
  if (!homepageUrl || !validHttpUrl(homepageUrl)) return { error: '유효한 서비스 주소(HTTPS)가 필요합니다.' };
  if (redirectUris.length < 1 || redirectUris.length > 10 || redirectUris.some((uri: string) => !validHttpUrl(uri))) return { error: 'Redirect URI를 1~10개 입력하고 HTTPS URL 형식을 확인하세요.' };
  if (!FRAMEWORKS.has(framework)) return { error: '지원하지 않는 개발 환경입니다.' };
  if (!ACCESS_POLICIES.has(requestedAccessPolicy)) return { error: '지원하지 않는 접근 정책입니다.' };
  if (!APP_STATUSES.has(status)) return { error: '지원하지 않는 앱 상태입니다.' };

  const accessPolicy = requestedAccessPolicy === 'public' ? 'guest' : requestedAccessPolicy;
  return { value: { name, clientId, homepageUrl, redirectUris: [...new Set(redirectUris)], framework, accessPolicy, status } };
}

export function registerConnectRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/connect/v1.js', () => jsResponse(connectEmbedSource, 'public, max-age=300'));
  app.get('/connect/manifest.json', (c) => c.json({
    ok: true,
    name: 'nakwol-connect',
    stable: '1.0.0',
    embed: '/connect/v1.js',
    sdk: '/sdk/v0.3.0/nakwol-auth-web.js',
    default_auth: 'required',
    default_access_policy: 'member',
  }));

  app.get('/admin/apps', (c) => c.html(adminPage()));
  app.get('/admin/connect-app.js', () => jsResponse(connectAdminSource, 'no-store'));

  app.get('/admin/api/session', async (c) => {
    const identity = await adminIdentity(c);
    if (!identity) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, 401);
    return c.json({ ok: true, data: {
      user: identity.user,
      operator_role: identity.operatorRole,
      operator_count: identity.operatorCount,
      can_manage: identity.canManage,
      bootstrap_available: identity.operatorCount === 0,
    } });
  });

  app.post('/admin/api/bootstrap', async (c) => {
    const identity = await adminIdentity(c);
    if (!identity) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, 401);
    if (!identity.user?.membership?.is_member) return c.json({ ok: false, error: { code: 'MEMBER_REQUIRED', message: '첫 운영자는 낙월 맹원이어야 합니다.' } }, 403);
    if (identity.operatorCount > 0) return c.json({ ok: false, error: { code: 'ALREADY_BOOTSTRAPPED', message: '이미 NAKWOL Connect 운영자가 등록되어 있습니다.' } }, 409);

    const result = await c.env.DB.prepare(
      `INSERT INTO auth_operators(user_id, role, created_at, created_by_user_id)
       SELECT ?, 'owner', ?, NULL
        WHERE NOT EXISTS (SELECT 1 FROM auth_operators)`
    ).bind(identity.userId, Date.now()).run();
    if (!result.success || Number(result.meta?.changes ?? 0) < 1) return c.json({ ok: false, error: { code: 'BOOTSTRAP_RACE', message: '다른 운영자가 먼저 등록되었습니다. 새로고침해 주세요.' } }, 409);
    await logAuthEvent(c.env, 'connect.operator.bootstrap', identity.userId, ADMIN_CLIENT_ID);
    return c.json({ ok: true });
  });

  app.get('/admin/api/apps', async (c) => {
    const identity = await requireManager(c);
    if (identity instanceof Response) return identity;
    const result = await c.env.DB.prepare(
      `SELECT a.client_id, a.name, a.redirect_uris, a.status,
              s.homepage_url, s.framework, s.access_policy, s.owner_user_id, s.created_at, s.updated_at
         FROM applications a
         LEFT JOIN application_settings s ON s.client_id = a.client_id
        WHERE a.client_id NOT IN ('nakwol-auth-selftest','nakwol-connect-admin')
        ORDER BY COALESCE(s.updated_at, a.updated_at) DESC, a.name ASC`
    ).all();
    return c.json({ ok: true, data: (result.results || []).map(appFromRow) });
  });

  app.post('/admin/api/apps', async (c) => {
    const identity = await requireManager(c);
    if (identity instanceof Response) return identity;
    const raw = await c.req.json().catch(() => ({}));
    const normalized = normalizeAppInput(raw);
    if (!normalized.value) return c.json({ ok: false, error: { code: 'INVALID_APP', message: normalized.error } }, 400);
    const v = normalized.value;
    if (await readApp(c.env, v.clientId)) return c.json({ ok: false, error: { code: 'CLIENT_ID_EXISTS', message: '이미 사용 중인 Client ID입니다.' } }, 409);
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO applications(client_id, name, redirect_uris, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(v.clientId, v.name, JSON.stringify(v.redirectUris), v.status, now, now),
      c.env.DB.prepare(
        `INSERT INTO application_settings(client_id, homepage_url, framework, access_policy, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(v.clientId, v.homepageUrl, v.framework, v.accessPolicy, identity.userId, now, now),
    ]);
    await logAuthEvent(c.env, 'connect.app.created', identity.userId, v.clientId, { framework: v.framework, access_policy: v.accessPolicy });
    return c.json({ ok: true, data: await readApp(c.env, v.clientId) }, 201);
  });

  app.put('/admin/api/apps/:clientId', async (c) => {
    const identity = await requireManager(c);
    if (identity instanceof Response) return identity;
    const clientId = c.req.param('clientId');
    const existing = await readApp(c.env, clientId);
    if (!existing) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: '앱을 찾을 수 없습니다.' } }, 404);
    if ([ADMIN_CLIENT_ID, 'nakwol-auth-selftest'].includes(clientId)) return c.json({ ok: false, error: { code: 'SYSTEM_APP', message: '시스템 앱은 여기서 수정할 수 없습니다.' } }, 403);
    const raw = await c.req.json().catch(() => ({}));
    const normalized = normalizeAppInput(raw, clientId);
    if (!normalized.value) return c.json({ ok: false, error: { code: 'INVALID_APP', message: normalized.error } }, 400);
    const v = normalized.value;
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE applications SET name = ?, redirect_uris = ?, status = ?, updated_at = ? WHERE client_id = ?`)
        .bind(v.name, JSON.stringify(v.redirectUris), v.status, now, clientId),
      c.env.DB.prepare(
        `INSERT INTO application_settings(client_id, homepage_url, framework, access_policy, owner_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(client_id) DO UPDATE SET
           homepage_url = excluded.homepage_url,
           framework = excluded.framework,
           access_policy = excluded.access_policy,
           updated_at = excluded.updated_at`
      ).bind(clientId, v.homepageUrl, v.framework, v.accessPolicy, existing.owner_user_id || identity.userId, existing.created_at || now, now),
    ]);
    await logAuthEvent(c.env, 'connect.app.updated', identity.userId, clientId, { framework: v.framework, access_policy: v.accessPolicy, status: v.status });
    return c.json({ ok: true, data: await readApp(c.env, clientId) });
  });

  app.get('/admin/api/apps/:clientId/diagnostics', async (c) => {
    const identity = await requireManager(c);
    if (identity instanceof Response) return identity;
    const clientId = c.req.param('clientId');
    const registered = await readApp(c.env, clientId);
    if (!registered) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: '앱을 찾을 수 없습니다.' } }, 404);
    const redirectUri = registered.redirect_uris[0] || '';
    const data: any = {
      registered: true,
      status: registered.status,
      redirect_ok: registered.redirect_uris.length > 0 && registered.redirect_uris.every(validHttpUrl),
      redirect_uri: redirectUri,
      site_reachable: false,
      http_status: null,
      embed_found: false,
      client_id_found: false,
      error: null,
    };
    if (!registered.homepage_url) return c.json({ ok: true, data });
    try {
      const url = new URL(registered.homepage_url);
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]') {
        data.error = 'localhost는 서버에서 원격 검사할 수 없습니다.';
        return c.json({ ok: true, data });
      }
      const response = await fetch(url.toString(), { headers: { 'User-Agent': 'NAKWOL-Connect-Diagnostic/1.0' }, redirect: 'follow' });
      data.http_status = response.status;
      data.site_reachable = response.ok;
      const contentType = response.headers.get('Content-Type') || '';
      if (contentType.includes('text/html')) {
        const html = await response.text();
        data.embed_found = html.includes('/connect/v1.js') || html.includes(`${new URL(c.req.url).origin}/connect/v1.js`);
        data.client_id_found = html.includes(clientId);
      }
    } catch (error) {
      data.error = error instanceof Error ? error.message : String(error);
    }
    return c.json({ ok: true, data });
  });

  app.get('/admin/api/apps/:clientId/events', async (c) => {
    const identity = await requireManager(c);
    if (identity instanceof Response) return identity;
    const clientId = c.req.param('clientId');
    if (!await readApp(c.env, clientId)) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: '앱을 찾을 수 없습니다.' } }, 404);
    const result = await c.env.DB.prepare(
      `SELECT event_type, user_id, created_at, detail FROM auth_events WHERE client_id = ? ORDER BY created_at DESC LIMIT 50`
    ).bind(clientId).all();
    return c.json({ ok: true, data: result.results || [] });
  });
}
