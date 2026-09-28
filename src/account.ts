import type { Hono } from 'hono';
import type { Env } from './types';
import { clearSessionCookie, jsonError, parseCookies } from './http';
import { authenticateAccessToken, deleteSession, getUserWithMembership } from './store';
import { listConnectedServices } from './account-store';
import { registerAccountRecoveryRoutes } from './account-recovery';

export const ACCOUNT_CLIENT_ID = 'nakwol-account-center';

function bearerToken(header: string | undefined): string | null {
  const match = (header ?? '').match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export function accountPageHtml(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>NAKWOL 계정</title>
  <style>
    :root{color-scheme:dark;--bg:#0b1020;--surface:#111a2b;--line:#29364b;--text:#f1f5f9;--muted:#a6b3c7;--accent:#a5b4fc;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--text);background:var(--bg)}
    *{box-sizing:border-box}body{margin:0;line-height:1.65}button,a{font:inherit}a{color:var(--accent);text-underline-offset:4px}button{cursor:pointer}.shell{width:min(720px,calc(100% - 40px));margin:auto;padding:48px 0 64px}.topbar{margin-bottom:32px}.brand small{color:var(--muted);font-size:12px;letter-spacing:.12em}.brand h1{margin:8px 0;font-size:30px;letter-spacing:-.04em}.intro,.muted{color:var(--muted)}.intro{margin:0}.card,.notice{padding:24px;border:1px solid var(--line);border-radius:16px;background:var(--surface);margin-bottom:16px}.card h2{font-size:18px;margin:0 0 12px}.card p{margin:8px 0}.profile{display:flex;align-items:center;gap:16px}.avatar{width:64px;height:64px;flex:none;border-radius:50%;object-fit:cover;background:#24314b;display:grid;place-items:center;font-size:24px;color:var(--accent)}.profile h2{font-size:23px;margin:0;overflow-wrap:anywhere}.profile p{margin:2px 0;font-size:14px}.row{display:flex;align-items:center;justify-content:space-between;gap:16px}.stack{display:grid;gap:12px}.badge{display:inline-block;padding:5px 12px;border-radius:999px;background:#25304c;color:#d6dcff;font-weight:650;font-size:14px}.badge[data-member="true"]{background:#143e35;color:#a7f3d0}.button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 16px;border:1px solid transparent;border-radius:10px;background:#5865f2;color:white;font-weight:650;text-decoration:none}.button.secondary{background:transparent;border-color:#4b5b76;color:var(--text)}.button:disabled{opacity:.6;cursor:wait}button:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:4px}.recovery{border-left:3px solid #818cf8}.service{padding:16px 0;border-bottom:1px solid var(--line)}.service:first-child{padding-top:0}.service:last-child{padding-bottom:0;border-bottom:0}.service strong{overflow-wrap:anywhere}.service .muted{font-size:13px}.notice.error{border-color:#9f4b5a;color:#fecdd3}.small{font-size:13px}.support{margin-top:24px;color:var(--muted);font-size:13px}.support summary{cursor:pointer;min-height:44px;padding:10px 0}.support-body{padding:16px;border:1px solid var(--line);border-radius:12px;overflow-wrap:anywhere}.support dl{margin:0}.support dt{margin-top:8px}.support dd{margin-left:0;color:var(--text)}.permissions-list{padding-left:20px}.logout-section{margin-top:24px;padding-top:24px;border-top:1px solid var(--line)}[hidden]{display:none!important}
    @media(max-width:520px){.shell{width:calc(100% - 32px);padding-top:28px}.card,.notice{padding:20px}.brand h1{font-size:27px}.row{align-items:flex-start;flex-direction:column;gap:8px}.button{width:100%}.service .button{width:auto}.avatar{width:52px;height:52px}.profile h2{font-size:21px}}
  </style>
</head>
<body>
  <main class="shell" id="account-root">
    <header class="topbar">
      <div class="brand"><small>落月 · NAKWOL</small><h1>내 낙월 계정</h1></div>
      <p class="intro">내 로그인 정보와 낙월 이용 상태를 확인하세요.</p>
    </header>
    <section id="service-recovery" class="card recovery" hidden aria-live="polite">
      <h2 id="recovery-title">접속 문제 해결</h2><p id="recovery-message"></p>
      <a id="return-service" class="button secondary" hidden>서비스로 돌아가기</a>
    </section>
    <p id="loading" class="muted" role="status">계정 정보를 불러오는 중입니다…</p>
    <section id="logged-out" class="notice" hidden>
      <h2>Discord 계정으로 시작하세요</h2>
      <p class="muted">로그인하면 내 맹원 상태와 이용한 서비스를 확인할 수 있습니다.</p>
      <button id="login" class="button" type="button">Discord로 낙월 로그인</button>
    </section>
    <section id="account-error" class="notice error" hidden aria-live="assertive">
      <p id="error-message"></p><button id="retry-login" class="button secondary" type="button">로그인 다시 시도</button>
    </section>
    <section id="account-content" hidden>
      <section id="profile-card" class="card profile">
        <span id="avatar-fallback" class="avatar" aria-hidden="true">落</span><img id="profile-avatar" class="avatar" alt="" hidden referrerpolicy="no-referrer">
        <div><h2 id="profile-name">내 계정</h2><p id="account-identity" class="muted">Discord로 로그인한 계정</p></div>
      </section>
      <section id="membership-card" class="card">
        <div class="row"><h2>낙월 이용 상태</h2><span id="membership-state" class="badge">확인 중</span></div>
        <p id="membership-help"></p>
        <p class="muted small">마지막 확인 <time id="membership-checked">확인 기록 없음</time></p>
        <p class="muted small">Discord에서 마지막으로 확인한 상태입니다. 역할이 바뀌었다면 아래에서 다시 확인해 주세요.</p>
      </section>
      <section class="card recovery">
        <h2>역할을 받았는데 접속이 안 되나요?</h2>
        <p class="muted">시즌3 역할이 있는 Discord 계정으로 다시 인증해 주세요. 확인을 마친 뒤 이용하던 서비스에서 다시 접속해 보세요.</p>
        <button id="recheck" class="button" type="button">Discord로 다시 확인</button>
        <p id="recheck-status" class="small" role="status"></p>
      </section>
      <section id="services-card" class="card">
        <h2>이용한 서비스</h2><p class="muted small">이 계정으로 로그인에 성공한 서비스입니다. 현재 이용 가능 여부는 각 서비스의 접근 설정에 따라 달라집니다.</p>
        <div id="services" class="stack"></div>
      </section>
      <section class="logout-section">
        <button id="global-logout" class="button secondary" type="button">모든 낙월 서비스에서 로그아웃</button>
        <p class="muted small">다른 기기를 포함해 낙월 인증 세션을 종료합니다. 서비스에 다시 접속할 때 로그인이 필요하며, 서비스 자체 세션은 인증을 다시 확인할 때 종료됩니다.</p>
        <p id="logout-status" role="status"></p>
      </section>
      <details id="support" class="support">
        <summary>고객지원 정보</summary>
        <div class="support-body">
          <p>접속 문제가 계속되면 아래 계정 식별 정보와 서비스 이름을 관리자에게 알려 주세요.</p>
          <dl><dt>NAKWOL ID</dt><dd id="profile-id">-</dd><dt>인증 역할</dt><dd id="membership-role">-</dd></dl>
          <section id="permissions"><h3>서비스 권한</h3><div id="permission-detail"></div></section>
        </div>
      </details>
    </section>
  </main>

  <script type="module">
    import { NakwolAuthClient } from '/sdk/v0.3.2/nakwol-auth-web.js';

    const ACCOUNT_CLIENT_ID = 'nakwol-account-center';
    const auth = new NakwolAuthClient({
      clientId: ACCOUNT_CLIENT_ID,
      authOrigin: location.origin,
      redirectUri: location.origin + '/account',
    });

    const identity = document.querySelector('#account-identity');
    const loggedOut = document.querySelector('#logged-out');
    const content = document.querySelector('#account-content');
    const errorBox = document.querySelector('#account-error');
    const loginButton = document.querySelector('#login');
    const servicesRoot = document.querySelector('#services');
    const permissionDetail = document.querySelector('#permission-detail');
    const globalLogout = document.querySelector('#global-logout');
    const params = new URLSearchParams(location.search);
    const selectedClientId = params.get('client_id');
    const recoveryKey = 'nakwol:account:recovery';
    let recoveryClientId = params.get('recovery') === '1' ? selectedClientId : null;
    try {
      if (recoveryClientId) sessionStorage.setItem(recoveryKey, JSON.stringify({ clientId: recoveryClientId, at: Date.now() }));
      else if (params.has('code') || params.has('error')) {
        const saved = JSON.parse(sessionStorage.getItem(recoveryKey) || 'null');
        if (saved && Date.now() - saved.at < 30 * 60 * 1000) recoveryClientId = saved.clientId;
      } else sessionStorage.removeItem(recoveryKey);
    } catch {}
    async function loadRecovery() {
      if (!recoveryClientId) return;
      const section = document.querySelector('#service-recovery');
      const message = document.querySelector('#recovery-message');
      section.hidden = false;
      try {
        const token = auth.getAccessToken();
        const response = await fetch('/account/api/recovery?client_id=' + encodeURIComponent(recoveryClientId), {
          headers: token ? { Authorization: 'Bearer ' + token } : {},
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error('recovery unavailable');
        const recoveryLocation = new URL(location.href);
        recoveryLocation.searchParams.set('client_id', recoveryClientId);
        recoveryLocation.searchParams.set('recovery', '1');
        history.replaceState({}, document.title, recoveryLocation.pathname + recoveryLocation.search + recoveryLocation.hash);
        document.querySelector('#recovery-title').textContent = payload.data.name + ' 접속 문제 해결';
        message.textContent = payload.data.message;
        const back = document.querySelector('#return-service');
        if (payload.data.url) { back.href = payload.data.url; back.hidden = false; }
        back.addEventListener('click', () => { try { sessionStorage.removeItem(recoveryKey); } catch {} });
      } catch { message.textContent = '서비스 정보를 확인하지 못했습니다. 계정을 확인한 뒤 원래 서비스에서 다시 시도해 주세요.'; }
    }
    function saveRecovery() {
      if (recoveryClientId) { try { sessionStorage.setItem(recoveryKey, JSON.stringify({ clientId: recoveryClientId, at: Date.now() })); } catch {} }
    }

    function hideAllStates() {
      document.querySelector('#loading').hidden = true;
      loggedOut.hidden = true;
      content.hidden = true;
      errorBox.hidden = true;
    }

    function setIdentity(user) {
      identity.textContent = user ? 'Discord로 로그인한 계정' : '로그인하지 않음';
    }

    function showError(message) {
      hideAllStates();
      document.querySelector('#error-message').textContent = message || '계정 정보를 불러오지 못했습니다.';
      errorBox.hidden = false;
    }

    function formatDate(value) {
      if (!value || !Number.isFinite(Number(value))) return '확인 기록 없음';
      return new Date(Number(value)).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
    }

    function roleLabel(role) {
      if (role === 'admin') return '낙월 관리자';
      if (role === 'member') return '낙월 맹원';
      return '일반 사용자';
    }

    function showPermission(service) {
      while (permissionDetail.firstChild) permissionDetail.removeChild(permissionDetail.firstChild);
      permissionDetail.className = '';
      if (!service) {
        permissionDetail.className = 'permission-empty';
        permissionDetail.textContent = '연결된 서비스를 선택하면 이 서비스가 확인하는 AUTH 권한을 표시합니다.';
        return;
      }

      const title = document.createElement('strong');
      title.textContent = (service.name || '등록된 서비스') + ' · ' + service.client_id;
      const list = document.createElement('ul');
      list.className = 'permissions-list';
      for (const permission of service.permissions || []) {
        const item = document.createElement('li');
        item.textContent = permission;
        list.appendChild(item);
      }
      permissionDetail.append(title, list);
    }

    function renderServices(services) {
      while (servicesRoot.firstChild) servicesRoot.removeChild(servicesRoot.firstChild);
      if (!services.length) {
        const empty = document.createElement('div');
        empty.className = 'muted';
        empty.textContent = '아직 표시할 연결 서비스 기록이 없습니다.';
        servicesRoot.appendChild(empty);
        showPermission(null);
        return;
      }

      let selected = services.find((service) => service.client_id === selectedClientId) || null;
      if (!selected && location.hash === '#permissions') selected = services[0];

      for (const service of services) {
        const item = document.createElement('article');
        item.className = 'service';
        item.dataset.selected = service === selected ? 'true' : 'false';

        const heading = document.createElement('div');
        heading.className = 'row';
        const name = document.createElement('strong');
        name.textContent = service.name || '등록된 서비스';
        heading.append(name);

        const meta = document.createElement('div');
        meta.className = 'muted';
        meta.textContent = '마지막 로그인 ' + formatDate(service.last_authorized_at);
        item.append(heading, meta);

        let homepageUrl = null;
        try { const url = new URL(service.homepage_url); if (['https:', 'http:'].includes(url.protocol)) homepageUrl = url.href; } catch {}
        if (homepageUrl) {
          const homepage = document.createElement('a');
          homepage.href = homepageUrl;
          homepage.className = 'button secondary';
          homepage.target = '_blank';
          homepage.rel = 'noopener noreferrer';
          homepage.textContent = '서비스 열기 ↗';
          homepage.setAttribute('aria-label', (service.name || '서비스') + ' 열기 (새 탭)');
          item.appendChild(homepage);
        }
        servicesRoot.appendChild(item);
      }

      showPermission(selected || services[0]);
      const select = document.createElement('select');
      select.setAttribute('aria-label', '고객지원 서비스 선택');
      for (const service of services) { const option = document.createElement('option'); option.value = service.client_id; option.textContent = service.name || service.client_id; option.selected = service === (selected || services[0]); select.appendChild(option); }
      select.addEventListener('change', () => showPermission(services.find(service => service.client_id === select.value)));
      document.querySelector('#permissions').prepend(select);
      if (selectedClientId || location.hash === '#permissions') document.querySelector('#support').open = true;
    }

    function renderAccount(summary) {
      const user = summary.user;
      setIdentity(user);
      document.querySelector('#profile-name').textContent = user.display_name || '-';
      document.querySelector('#profile-id').textContent = user.id || '-';
      document.querySelector('#membership-role').textContent = roleLabel(user.membership?.role);
      const member = Boolean(user.membership?.is_member);
      document.querySelector('#membership-state').textContent = member ? '시즌3 맹원 확인됨' : '시즌3 맹원 미확인';
      document.querySelector('#membership-state').dataset.member = String(member);
      document.querySelector('#membership-help').textContent = member ? '시즌3 맹원으로 확인된 계정입니다.' : '마지막 확인에서 시즌3 맹원 자격이 확인되지 않았습니다. 서비스별 별도 허용 여부는 관리자에게 문의해 주세요.';
      document.querySelector('#membership-checked').textContent = formatDate(user.membership?.checked_at);
      const avatar = document.querySelector('#profile-avatar');
      if (user.avatar_url) {
        avatar.addEventListener('error', () => { avatar.hidden = true; document.querySelector('#avatar-fallback').hidden = false; });
        avatar.src = user.avatar_url; avatar.hidden = false; document.querySelector('#avatar-fallback').hidden = true;
      }
      renderServices(Array.isArray(summary.services) ? summary.services : []);
      hideAllStates();
      content.hidden = false;
    }

    async function loadSummary() {
      const token = auth.getAccessToken();
      if (!token) return null;
      const response = await fetch('/account/api/summary', {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (response.status === 401) {
        await auth.logout();
        return null;
      }
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok || !payload?.data) {
        throw new Error(payload?.error?.message || '계정 요약 정보를 불러오지 못했습니다.');
      }
      return payload.data;
    }

    async function startLogin(button) {
      button.disabled = true;
      try { saveRecovery(); auth.clearLocalState(); await auth.login(); }
      catch { button.disabled = false; showError('로그인을 시작하지 못했습니다. 다시 시도해 주세요.'); }
    }
    loginButton.addEventListener('click', () => startLogin(loginButton));
    document.querySelector('#retry-login').addEventListener('click', (event) => startLogin(event.currentTarget));
    document.querySelector('#recheck').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const status = document.querySelector('#recheck-status');
      button.disabled = true; status.textContent = 'Discord 인증으로 이동합니다…';
      try {
        const token = auth.getAccessToken();
        const response = await fetch('/account/api/recheck', { method: 'POST', headers: { Authorization: 'Bearer ' + (token || '') } });
        if (response.status === 401) { showError('로그인이 만료되었습니다. 다시 로그인해 주세요.'); return; }
        if (!response.ok) throw new Error('recheck failed');
        saveRecovery();
        auth.clearLocalState();
        await auth.login();
      } catch { status.textContent = '인증을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.'; }
      finally { button.disabled = false; }
    });
    globalLogout.addEventListener('click', async () => {
      if (!confirm('모든 낙월 서비스에서 로그아웃할까요?')) return;
      globalLogout.disabled = true;
      try { await auth.logout({ global: true, returnTo: location.origin + '/account' }); }
      catch { document.querySelector('#logout-status').textContent = '로그아웃하지 못했습니다. 다시 시도해 주세요.'; globalLogout.disabled = false; }
    });

    try {
      setIdentity(null);
      const user = await auth.bootstrap();
      if (!user) {
        hideAllStates();
        loggedOut.hidden = false;
      } else {
        const summary = await loadSummary();
        if (!summary) {
          setIdentity(null);
          hideAllStates();
          loggedOut.hidden = false;
        } else {
          renderAccount(summary);
        }
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
    await loadRecovery();
  </script>
</body>
</html>`;
}

export function registerAccountRoutes(app: Hono<{ Bindings: Env }>): void {
  registerAccountRecoveryRoutes(app, ACCOUNT_CLIENT_ID);
  app.get('/account', (c) => c.html(accountPageHtml()));

  app.use('/account/api/*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });

  app.post('/account/api/recheck', async (c) => {
    const origin = c.req.header('Origin');
    if (origin && origin !== new URL(c.req.url).origin) return jsonError(c, 403, 'ORIGIN_DENIED', '허용되지 않은 요청입니다.');
    const token = bearerToken(c.req.header('Authorization'));
    if (!token || !await authenticateAccessToken(c.env, token, ACCOUNT_CLIENT_ID)) {
      return jsonError(c, 401, 'INVALID_ACCOUNT_TOKEN', '다시 로그인해 주세요.');
    }
    // 현재 브라우저의 SSO만 종료한다. 다른 서비스의 access token은 유지한다.
    await deleteSession(c.env, parseCookies(c.req.header('Cookie')).nakwol_sid);
    c.header('Set-Cookie', clearSessionCookie(c.env.COOKIE_SECURE !== 'false'));
    return c.json({ ok: true });
  });

  app.get('/account/api/summary', async (c) => {
    const token = bearerToken(c.req.header('Authorization'));
    if (!token) return jsonError(c, 401, 'ACCOUNT_AUTH_REQUIRED', 'NAKWOL 계정 로그인이 필요합니다.');

    const userId = await authenticateAccessToken(c.env, token, ACCOUNT_CLIENT_ID);
    if (!userId) return jsonError(c, 401, 'INVALID_ACCOUNT_TOKEN', 'Account Center access token이 유효하지 않습니다.');

    const user = await getUserWithMembership(c.env, userId);
    if (!user) return jsonError(c, 404, 'ACCOUNT_USER_NOT_FOUND', 'NAKWOL 사용자를 찾을 수 없습니다.');

    const services = await listConnectedServices(c.env, userId);
    return c.json({ ok: true, data: { user, services } });
  });
}
