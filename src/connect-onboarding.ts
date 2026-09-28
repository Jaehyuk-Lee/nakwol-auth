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
    <div class="chips"><span class="chip">AUTH 0.2.0</span><span class="chip">Web SDK 0.3.0</span><span class="chip">Connect CLI 0.6.0</span><span class="chip">required + member 기본값</span><span class="chip">자동 SSO</span><span class="chip">PKCE S256</span><span class="chip">Discord secret 불필요</span></div>
  </section>

  <section class="panel">
    <h2>기본 원칙</h2>
    <div class="callout"><strong>member = 중앙에서 정한 시즌3 역할 보유자입니다.</strong><br>개발자는 역할 ID를 입력하지 않고 <code>member</code>만 선택합니다. 현재 시즌3 역할은 <code>1553600098661957643</code>이며 시즌1·시즌2·Discord 관리자 역할은 대체 조건이 아닙니다. 개발자는 본인 앱의 member/guest 정책을 선택하고, admin 정책과 추가 역할 설정은 AUTH 운영자가 관리합니다.</div>
    <p><strong>Embed 설치와 서버 보호는 다릅니다.</strong> 기본값 <code>auth=required</code> + <code>access-policy=member</code>는 로그인 및 권한 조건입니다. 브라우저에서 화면만 잠그면 이미 전달된 HTML·파일은 보호되지 않습니다. 아래 서버 게이트를 설치·배포하고 직접 주소 차단을 검증해야 합니다.</p>
  </section>

  <section class="panel">
    <h2>가장 빠른 시작</h2>
    <div class="step"><div class="num">1</div><div><strong>NAKWOL developer 권한을 먼저 받습니다.</strong><div class="muted">NAKWOL 운영자는 /admin/developers에서 Discord 사용자 ID를 미리 허가할 수 있습니다. 대상자가 아직 NAKWOL에 로그인한 적이 없어도 되며 Discord 서버 역할과는 무관합니다. 첫 Connect CLI 승인 때 해당 Discord 계정과 자동 연결됩니다.</div></div></div>
    <div class="step"><div class="num">2</div><div><strong>프로젝트 루트에서 공식 CLI를 실행합니다.</strong><pre>npx --yes nakwol-connect init
npx --yes nakwol-connect doctor --json</pre><div class="muted">이 단계는 중앙 앱과 Embed 연결입니다. required 사이트에 서버 게이트가 없으면 doctor는 실패하며, 아래 보호 설치가 필요합니다.</div></div></div>
    <div class="step"><div class="num">3</div><div><strong>DATA도 필요하면 필요한 scope만 추가합니다.</strong><pre>npx --yes nakwol-connect init --scopes roster:read,decks:read
npx --yes nakwol-connect data describe --json
npx --yes nakwol-connect doctor --json</pre></div></div>
    <div class="step"><div class="num">4</div><div><strong>공개 서비스일 때만 명시적으로 완화합니다.</strong><pre>npx --yes nakwol-connect init --auth optional --access-policy guest</pre><div class="muted"><code>optional</code>/<code>guest</code>는 기본값이 아닙니다. 제품 요구사항이 공개 서비스일 때만 사용합니다.</div></div></div>
    <div class="callout">최초 Discord 로그인 후 같은 브라우저의 다른 서비스는 중앙 SSO를 재사용합니다. 단, 각 사이트의 정책을 통과해야 해당 사이트용 토큰을 받습니다.</div>
  </section>

  <section class="panel" id="server-protection">
    <h2>HTML·파일 직접 주소까지 차단하기</h2>
    <p>자동 설치 지원 환경은 <strong>Cloudflare Workers Static Assets의 정적 빌드</strong>입니다. 별도 API 서버, SSR, 기존 Worker 로직, Vercel, Pages Functions는 자동 연결 대상이 아닙니다. 지원되지 않는 환경을 보호 완료로 처리하지 않습니다.</p>
    <p>아래 YOUR-SITE를 실제 HTTPS 사이트 루트로 바꾸세요. 먼저 사이트를 빌드해 index.html이 들어 있는 dist 폴더를 준비합니다. 프로젝트 루트 전체나 비밀 설정 폴더를 지정하지 마세요.</p>
    <pre>npx --yes nakwol-connect init --auth required --access-policy member --url https://YOUR-SITE/
npx --yes nakwol-connect protect install --provider cloudflare-workers --assets dist --url https://YOUR-SITE/</pre>
    <p>설치 후 사이트를 <strong>다시 빌드</strong>합니다. 생성된 wrangler.nakwol.json과 .nakwol/server/를 사용해 배포합니다. 기존 앱에 콜백이 없다면 먼저 <code>nakwol-connect add-url https://YOUR-SITE/</code>를 실행하세요.</p>
    <pre>npx wrangler secret put NAKWOL_SESSION_SECRET --config wrangler.nakwol.json
npx wrangler deploy --config wrangler.nakwol.json
npx --yes nakwol-connect protect verify --url https://YOUR-SITE/ --json
npx --yes nakwol-connect doctor --url https://YOUR-SITE/ --json</pre>
    <p>Secret에는 무작위 32자 이상의 세션 암호화 키를 입력합니다. Discord 봇 토큰이 아닙니다. 소스나 채팅에 기록하지 마세요. Worker 이름은 client ID로 생성되므로 기존 Worker와 충돌하는지 확인하세요. Cloudflare 계정 권한과 배포는 개발자가 관리합니다. 사용자 지정 도메인은 해당 Worker에 연결해야 합니다.</p>
    <p><strong>CI도 --config wrangler.nakwol.json으로 배포해야 합니다.</strong> 예전 정적 배포 명령으로 배포하면 게이트가 적용되지 않습니다. 생성된 설정은 모든 자산에 run_worker_first=true를 사용하고, 등록한 사이트 origin 외에는 거부합니다.</p>
    <h3>검증 결과 읽기</h3>
    <ul>
      <li>configured: 설치만 완료. configured-not-verified: 실제 배포 차단 미검증.</li>
      <li>anonymous-blocking-verified: 현재 빌드 경로의 비로그인 GET·HEAD·Range·잘못된 쿠키 차단 검증 통과.</li>
      <li>401/403 + 공식 게이트 응답 + no-store만 통과합니다. 200·리다이렉트·404·503·시간 초과는 실패입니다.</li>
      <li>시즌3 일반 계정의 정상 로그인, 비멤버 거부, 로그아웃 후 차단은 실제 브라우저로 추가 확인하세요.</li>
    </ul>
    <pre>npx --yes nakwol-connect protect verify --url https://YOUR-SITE/ --alternate-origins https://OLD-SITE/ --paths /private-route --json</pre>
    <p>알고 있는 이전 배포 주소도 검사하세요. 명시하지 않은 도메인이나 공개 스토리지는 자동 검사하지 않습니다. 과거 공개 배포·원본 파일 주소도 비공개화하거나 제거해야 합니다. 삭제된 주소의 404/DNS 오류는 별도 삭제 증거로 확인합니다.</p>
    <h3>로그인·권한 문제가 생겼다면</h3>
    <p>401은 로그인 필요, 403은 접근 권한 부족, 503은 설정/인증 서버 오류입니다. 로그인 반복 시 정확한 콜백 URL·사이트 쿠키 허용·Secret·실제 배포 명령을 확인하세요. 권한 부족 시 시즌3와 추가 역할 조건을 확인한 뒤 다시 Discord 로그인하세요.</p>
    <p>봇 없이 OAuth로 역할을 읽습니다. 기존 SSO는 저장된 역할을 재사용하므로 Discord 역할 제거가 즉시 반영되는 것은 아닙니다. 중앙 세션은 비활동 10일/최대 30일, 앱 토큰은 1시간입니다. 긴급 권한 회수는 AUTH 운영자가 중앙에서 처리해야 합니다.</p>
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
member는 중앙의 시즌3 기준이며 역할 ID를 하드코딩하지 마.
Embed만으로 비공개 완료라고 보고하지 마. 지원되는 정적 Worker는 protect install로 서버 게이트를 구성하고,
재빌드 및 wrangler.nakwol.json 배포 후 protect verify --url 실제주소 --json으로 직접 접근 차단까지 검사해.
미지원 서버/호스팅 환경은 명확히 보고하고, HTML/JSON/다운로드 파일과 이전 배포 주소를 함께 확인해.
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
    <p class="muted">브라우저 가드는 화면 표시만 제어합니다. 직접 주소의 자료 전송 차단은 위 서버 보호 설치가 필요합니다. 공식 설치는 서버 로그아웃도 연결합니다. 직접 SDK를 사용하는 별도 구현은 서버 세션 연결도 필요합니다.</p>
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
