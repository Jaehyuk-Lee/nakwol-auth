import type { Hono } from 'hono';
import type { Env } from './types';

export function connectOnboardingPageHtml(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>NAKWOL Connect · 시작하기</title>
  <style>
    :root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#182235;background:#f6f3eb}
    *{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#faf8f2 0,#f2eee4 100%);color:#182235}a{color:#8d5b09}code,pre{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
    .shell{width:min(980px,calc(100% - 32px));margin:0 auto;padding:38px 0 70px}.hero{padding:28px;border:1px solid #dcd5c7;border-radius:20px;background:#fff}.eyebrow{font-size:12px;font-weight:900;letter-spacing:.14em;color:#9a6c17}.hero h1{margin:7px 0 8px;font-size:clamp(32px,6vw,50px)}.hero p{margin:0;color:#667386;line-height:1.65;max-width:760px}.chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}.chip{border:1px solid #ddd5c6;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:800;background:#faf8f2}
    .panel{margin-top:16px;padding:22px;border:1px solid #ddd6c8;border-radius:16px;background:#fff}.panel h2{margin:0 0 8px;font-size:20px}.panel h3{margin:20px 0 7px;font-size:15px}.panel p,.panel li{color:#5f6b7d;line-height:1.62}.panel ul{margin:8px 0 0;padding-left:21px}.step{display:grid;grid-template-columns:34px 1fr;gap:12px;align-items:start;margin-top:14px}.num{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:#172033;color:#fff;font-weight:900}.step strong{display:block;margin-top:4px}.muted{color:#7b8797;font-size:13px}
    pre{margin:10px 0 0;padding:14px;border-radius:12px;background:#101827;color:#e6edf7;white-space:pre-wrap;overflow:auto;font-size:13px;line-height:1.55}.callout{margin-top:12px;border-left:3px solid #c99219;background:#fff8e7;padding:11px 13px;color:#6f5a2d;line-height:1.55}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.card{border:1px solid #e3ddd1;border-radius:13px;padding:14px;background:#fcfbf8}.card strong{display:block;margin-bottom:4px}.links{display:flex;gap:12px;flex-wrap:wrap;margin-top:12px}.footer{margin-top:20px;color:#7a8595;font-size:12px;line-height:1.6}
    @media(max-width:720px){.shell{width:min(100% - 20px,980px);padding-top:18px}.hero,.panel{padding:18px}.grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
<main class="shell">
  <section class="hero">
    <div class="eyebrow">落月 · DEVELOPER</div>
    <h1>NAKWOL Connect 시작하기</h1>
    <p>낙월 서비스에 Discord 기반 로그인과 공통 DATA를 붙이는 공식 연동 경로입니다. 각 서비스는 Discord OAuth나 Client Secret을 직접 다루지 않고 중앙 NAKWOL AUTH와 Connect를 사용합니다.</p>
    <div class="chips"><span class="chip">AUTH 0.2.0</span><span class="chip">Web SDK 0.3.0</span><span class="chip">Connect CLI 0.5.0</span><span class="chip">required + member 기본값</span><span class="chip">자동 SSO</span><span class="chip">PKCE S256</span><span class="chip">Discord secret 불필요</span></div>
  </section>

  <section class="panel">
    <h2>기본 원칙</h2>
    <div class="callout"><strong>NAKWOL Connect는 기본 비공개입니다.</strong><br>별도 옵션 없이 설치하면 <code>auth=required</code> + <code>access-policy=member</code>가 적용됩니다. 로그인하지 않았거나 낙월 맹원이 아닌 사용자는 페이지를 사용할 수 없습니다. 테스트 페이지나 정적 Cloudflare Pages도 자동으로 공개 취급하지 않습니다.</div>
  </section>

  <section class="panel">
    <h2>가장 빠른 시작</h2>
    <div class="step"><div class="num">1</div><div><strong>NAKWOL developer 권한을 먼저 받습니다.</strong><div class="muted">NAKWOL 운영자는 /admin/developers에서 Discord 사용자 ID를 미리 허가할 수 있습니다. 대상자가 아직 NAKWOL에 로그인한 적이 없어도 되며 Discord 서버 역할과는 무관합니다. 첫 Connect CLI 승인 때 해당 Discord 계정과 자동 연결됩니다.</div></div></div>
    <div class="step"><div class="num">2</div><div><strong>프로젝트 루트에서 공식 CLI를 실행합니다.</strong><pre>npx --yes nakwol-connect init
npx --yes nakwol-connect doctor --json</pre><div class="muted">이 명령 자체가 기본적으로 로그인 필수 + 낙월 맹원 전용입니다.</div></div></div>
    <div class="step"><div class="num">3</div><div><strong>DATA도 필요하면 필요한 scope만 추가합니다.</strong><pre>npx --yes nakwol-connect init --scopes roster:read,decks:read
npx --yes nakwol-connect data describe --json
npx --yes nakwol-connect doctor --json</pre></div></div>
    <div class="step"><div class="num">4</div><div><strong>공개 서비스일 때만 명시적으로 완화합니다.</strong><pre>npx --yes nakwol-connect init --auth optional --access-policy guest</pre><div class="muted"><code>optional</code>/<code>guest</code>는 기본값이 아닙니다. 제품 요구사항이 공개 서비스일 때만 사용합니다.</div></div></div>
    <div class="callout">최초 한 서비스에서 Discord 로그인을 완료하면 중앙 NAKWOL SSO 세션이 생깁니다. 같은 브라우저의 다른 required NAKWOL Connect 서비스는 로그인 버튼을 다시 누르지 않고 자동으로 자기 서비스용 access token을 발급받습니다.</div>
  </section>

  <section class="panel">
    <h2>LLM/코딩 에이전트에게 그대로 주는 지시문</h2>
    <pre>이 프로젝트에 공식 NAKWOL Connect를 붙여줘.

NAKWOL Connect의 npm 패키지는 nakwol-connect이고 프로젝트 루트에서
npx --yes nakwol-connect ... 형태로 실행한다.
Discord OAuth나 PKCE를 직접 구현하지 말고 반드시 공식 CLI와 Universal Embed를 사용해.

이 서비스는 내가 공개 서비스라고 명시적으로 말하지 않는 한 반드시 NAKWOL 기본 보안 정책을 유지해야 한다:
- auth mode = required
- access policy = member
- 페이지 진입 즉시 인증 가드를 적용
- 중앙 NAKWOL SSO 세션이 있으면 사용자 조작 없이 자동 인증
- 중앙 세션이 없으면 페이지를 공개하지 말고 로그인 흐름으로 연결
- 로그인했지만 낙월 맹원이 아니면 페이지를 공개하지 말고 access denied 처리

일반적인 설치는 npx --yes nakwol-connect init 을 사용한다.
--auth optional 또는 --access-policy guest는 내가 공개 서비스라고 명시적으로 요청한 경우에만 사용한다.
테스트 페이지, 정적 사이트, Cloudflare Pages라는 이유만으로 optional/guest를 추론하지 마.

현재 서비스의 실제 production URL을 exact callback으로 등록해.
기존 NAKWOL Connect 연동이 있다면 별도 OAuth 구현을 추가하지 말고 공식 Connect 방식으로 정리해.
브라우저 코드나 저장소에는 Discord Client Secret, Cloudflare secret, Connect CLI token을 넣지 마.

DATA가 필요하면 필요한 scope만 최소로 선언하고
npx --yes nakwol-connect data describe --json 으로 현재 계약을 먼저 확인해.

작업이 끝나면 반드시 npx --yes nakwol-connect doctor --json 을 실행해.
마지막으로 설치된 Embed/설정에서 auth=required이고 access policy=member인지 직접 확인해서 보고해.
검증이 다르면 성공이라고 보고하지 말고 먼저 수정해.</pre>
    <p class="muted">공개 서비스가 목적일 때만 위 지시문에 “이 서비스는 공개 서비스이며 optional/guest로 설치해”라고 명시적으로 추가합니다.</p>
  </section>

  <section class="panel">
    <h2>브라우저 연결</h2>
    <h3>Universal Embed · 기본은 required</h3>
    <pre>&lt;script
  src="https://nakwol-auth.sepsd21.workers.dev/connect/v1.js"
  data-client-id="발급된-client-id"&gt;
&lt;/script&gt;</pre>
    <p class="muted"><code>data-auth</code>를 생략하면 <code>required</code>입니다. 페이지 진입 즉시 인증 가드가 화면을 잠그고 중앙 SSO를 확인합니다. 중앙 세션이 없으면 로그인 흐름으로 이동하며, 접근 정책을 통과한 뒤에만 페이지를 공개합니다.</p>
    <h3>공개 페이지에서만 optional</h3>
    <pre>&lt;script
  src="https://nakwol-auth.sepsd21.workers.dev/connect/v1.js"
  data-client-id="발급된-client-id"
  data-auth="optional"&gt;
&lt;/script&gt;</pre>
    <p class="muted">optional은 현재 페이지를 그대로 공개하면서 로그인/개인화 기능만 붙입니다. 자동 SSO는 양쪽 모드 모두 기본이며 특별히 끄려면 <code>data-auto-sso="false"</code>를 지정합니다.</p>
    <pre>window.NAKWOL_CONNECT.authMode
window.NAKWOL_CONNECT.user
window.NAKWOL_CONNECT.login()
window.NAKWOL_CONNECT.logout()</pre>

    <h3>공식 Identity Menu</h3>
    <pre>&lt;script type="module"&gt;
  import {
    NakwolAuthClient,
    mountNakwolIdentityMenu,
  } from 'https://nakwol-auth.sepsd21.workers.dev/sdk/v0.3.0/nakwol-auth-web.js';

  const auth = new NakwolAuthClient({
    clientId: '발급된-client-id',
    redirectUri: 'https://your-service.example/',
    autoSso: true,
  });

  mountNakwolIdentityMenu(auth, {
    variant: 'compact',
    theme: 'inherit',
  });
&lt;/script&gt;</pre>
    <p class="muted">페이지 잠금까지 필요한 신규 서비스는 Universal Embed 사용을 권장합니다. SDK를 직접 사용하는 경우 전체 페이지 가드는 애플리케이션에서 직접 구현해야 합니다.</p>
  </section>

  <section class="panel">
    <h2>NAKWOL DATA를 함께 쓰는 경우</h2>
    <div class="grid">
      <div class="card"><strong>profile</strong><span class="muted">profile:read / profile:write</span></div>
      <div class="card"><strong>roster</strong><span class="muted">roster:read / roster:write</span></div>
      <div class="card"><strong>equipment</strong><span class="muted">equipment:read / equipment:write</span></div>
      <div class="card"><strong>decks</strong><span class="muted">decks:read / decks:write</span></div>
    </div>
    <pre>const data = window.NAKWOL_CONNECT.data;
const accounts = await data.accounts.list();
const decks = await data.decks.list(accountId);
const deck = await data.decks.get(accountId, deckId);</pre>
    <p class="muted">가능하면 high-level helper를 사용하고, 현재 helper가 없는 경우에만 data.request()를 사용합니다. 실제 DATA 계약은 <code>nakwol-connect data describe --json</code>으로 확인합니다.</p>
  </section>

  <section class="panel">
    <h2>보안 원칙</h2>
    <ul>
      <li>외부 서비스는 Discord Client Secret을 보유하지 않습니다.</li>
      <li>브라우저에는 Connect CLI token이나 Cloudflare token을 넣지 않습니다.</li>
      <li>callback URL은 등록된 exact redirect만 허용됩니다.</li>
      <li>access token은 앱별 client binding으로 검증됩니다.</li>
      <li>중앙 access policy가 누락되거나 잘못되어도 member-only로 닫힙니다.</li>
      <li>AUTH/DATA D1에 외부 서비스가 직접 접근하지 않습니다.</li>
      <li>DATA 권한은 필요한 scope만 최소로 요청합니다.</li>
      <li>브라우저 인증 가드는 정적 페이지의 표시를 잠그는 역할이며, 민감한 회원 데이터는 반드시 AUTH/DATA가 검증하는 API 뒤에 둡니다.</li>
    </ul>
  </section>

  <section class="panel">
    <h2>공개 자료와 운영 엔드포인트</h2>
    <div class="links">
      <a href="https://github.com/goyoung2/nakwol-auth">GitHub</a>
      <a href="/llms.txt">LLM 안내</a>
      <a href="/account">내 낙월 계정</a>
      <a href="/sdk/manifest.json">Web SDK manifest</a>
      <a href="/connect/cli/manifest.json">Connect CLI manifest</a>
      <a href="https://nakwol-data.sepsd21.workers.dev/openapi.json">DATA OpenAPI 3.1</a>
    </div>
    <div class="footer">NAKWOL AUTH · https://nakwol-auth.sepsd21.workers.dev<br>NAKWOL DATA · https://nakwol-data.sepsd21.workers.dev</div>
  </section>
</main>
</body>
</html>`;
}

export function registerConnectOnboardingRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/connect', (c) => c.html(connectOnboardingPageHtml()));
}
