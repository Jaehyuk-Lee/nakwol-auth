# NAKWOL AUTH Web SDK v0.3.2

낙월 서비스용 브라우저 인증 SDK입니다. 각 서비스는 Discord OAuth를 직접 구현하지 않고 중앙 `NAKWOL AUTH`의 Authorization Code + PKCE(S256) 흐름을 사용합니다.

## 버전과 배포 URL

운영 서비스는 버전 고정 URL을 사용합니다.

```text
# 기존 호환 버전 — immutable
https://nakwol-auth.sepsd21.workers.dev/sdk/v0.1.0/nakwol-auth-web.js

# UX v1 버전 — immutable
https://nakwol-auth.sepsd21.workers.dev/sdk/v0.2.0/nakwol-auth-web.js

# 기본 메뉴 간소화 버전 — immutable
https://nakwol-auth.sepsd21.workers.dev/sdk/v0.3.2/nakwol-auth-web.js

# stable alias — 안정 버전 승격 시 대상이 이동할 수 있음
https://nakwol-auth.sepsd21.workers.dev/sdk/nakwol-auth-web.js

# manifest
https://nakwol-auth.sepsd21.workers.dev/sdk/manifest.json
```

`v0.1.0`은 immutable이며 기존 소비자를 위해 계속 유지합니다. v0.2.0은 v0.1의 headless 인증 계약과 `mountNakwolAuthWidget`을 그대로 포함하면서 새 `mountNakwolIdentityMenu`를 추가합니다.

## 사전 조건

NAKWOL AUTH의 `applications`에 다음이 등록되어 있어야 합니다.

- 고유 `client_id`
- 정확한 callback URL 목록인 `redirect_uris`
- `active` 상태

브라우저 코드에는 Discord Client Secret, Cloudflare secret, 중앙 세션 쿠키 같은 비밀값을 넣지 않습니다.

## 권장 연결 — Identity Menu

```html
<script type="module">
  import {
    NakwolAuthClient,
    mountNakwolIdentityMenu,
  } from 'https://nakwol-auth.sepsd21.workers.dev/sdk/v0.3.2/nakwol-auth-web.js';

  const auth = new NakwolAuthClient({
    clientId: 'my-app',
    redirectUri: 'https://my-app.pages.dev/',
  });

  const identity = mountNakwolIdentityMenu(auth, {
    variant: 'compact',
    theme: 'inherit',
  });

  const user = await identity.ready;
</script>
```

`mountNakwolIdentityMenu(client, options)`는 `{ element, ready, refresh, destroy }`를 반환합니다.

옵션:

- `variant`: `button` | `compact` | `menu`
- `theme`: `inherit` | `light` | `dark`
- `container`: 기존 DOM 컨테이너
- `accountUrl`: Account Center URL 재정의
- `showName`: 표시 이름 노출 여부
- `showRole`: 역할 표시 여부 (기본 `false`)
- `showAccountLinks`: 내 낙월 계정·이 서비스 권한 링크 표시 여부 (기본 `false`)

v0.3.2 기본 메뉴는 닉네임과 로그아웃만 표시합니다. 계정 링크가 필요한 서비스만 `showAccountLinks: true`를 지정합니다. 중앙 Embed는 `data-account-links="true"`, 역할 표시는 `data-show-role="true"`로 선택합니다. `/account`와 인증 API는 유지됩니다. 기존 고정 SDK(v0.1.0–v0.3.1)는 변경되지 않으며 새 기본값 적용에는 v0.3.2로 업데이트해야 합니다. 중앙 `/connect/v1.js`는 배포 후 자동으로 새 기본값을 사용합니다. 내 덱·즐겨찾기 같은 서비스별 메뉴 확장은 향후 별도 기능이며 이번 버전에는 포함하지 않습니다. 메뉴는 `aria-haspopup`, `aria-expanded`를 사용하며 Escape/외부 클릭 닫기와 포커스 복귀를 지원합니다.

## 테마 변수

`theme: 'inherit'`에서는 호스트가 아래 공식 CSS 변수를 직접 지정할 수 있습니다. 지정하지 않은 값에는 SDK 기본값이 적용됩니다.

```css
--nakwol-auth-accent
--nakwol-auth-bg
--nakwol-auth-text
--nakwol-auth-muted
--nakwol-auth-border
--nakwol-auth-radius
--nakwol-auth-shadow
```

별도의 `--nakwol-host-*` shadow alias는 사용하지 않습니다.

## 기존 v0.1 Widget 호환

`mountNakwolAuthWidget`은 v0.1.0과 v0.2.0 모두에서 유지됩니다. 기존 서비스가 즉시 UI를 마이그레이션할 필요는 없습니다.

```js
import {
  NakwolAuthClient,
  mountNakwolAuthWidget,
} from 'https://nakwol-auth.sepsd21.workers.dev/sdk/v0.1.0/nakwol-auth-web.js';
```

신규 연동은 `mountNakwolIdentityMenu`를 권장합니다.

## Headless 사용

UI를 서비스가 직접 만들 경우에도 `NakwolAuthClient` 계약은 v0.1과 동일합니다.

```js
import { NakwolAuthClient } from 'https://nakwol-auth.sepsd21.workers.dev/sdk/v0.2.0/nakwol-auth-web.js';

const auth = new NakwolAuthClient({
  clientId: 'my-app',
  redirectUri: 'https://my-app.pages.dev/',
});

const user = await auth.bootstrap();
if (!user) loginButton.onclick = () => auth.login();
```

주요 API:

- `await auth.bootstrap()` — callback 처리, state/PKCE 검증, token 교환, `/me` 조회
- `await auth.login()` — PKCE verifier/challenge와 state 생성 후 `/authorize` 이동
- `await auth.getMe()` — 현재 앱에 묶인 access token으로 `/me` 조회
- `auth.getAccessToken()` — 현재 앱의 유효한 access token 또는 `null`
- `auth.isAuthenticated()` — 현재 앱 token 존재 여부
- `auth.isMember()` — 마지막 사용자 정보 기준 member/admin 여부
- `await auth.logout()` — 현재 앱 token만 폐기
- `await auth.logout({ global: true, returnTo })` — 현재 앱 token과 중앙 SSO 세션 로그아웃

`NakwolAuthClient`는 `loading`, `loginstart`, `token`, `user`, `ready`, `logout`, `error` 이벤트를 발생시키는 `EventTarget`입니다.

## Account Center와 Auth Lab

- `/account`: 일반 사용자를 위한 Account Center. NAKWOL ID, membership, 실제 성공 인증 기록이 있는 연결 서비스와 AUTH 수준 권한을 보여줍니다.
- `/lab`: AUTH 검증용 Auth Lab. NAKWOL 관리자 또는 활성 Connect developer/operator만 diagnostics를 사용할 수 있습니다.

두 내부 페이지 모두 별도 app-bound OAuth client를 사용합니다. `/account/api/summary`와 `/lab/api/diagnostics`는 다른 앱에서 발급된 access token을 허용하지 않습니다.

## 보안 기준

- Authorization Code + PKCE(S256)
- OAuth `state` 검증
- callback URL exact allowlist
- access token의 client binding
- 기본 브라우저 token 저장소는 `sessionStorage`
- `/token`, `/me`, `/logout` CORS는 등록 redirect origin 기준 제한
- Discord Client Secret은 중앙 Worker에만 존재
- 서비스는 AUTH/DATA D1에 직접 접근하지 않음
- UI의 사용자/서비스 데이터는 DOM API와 `textContent`로 렌더링
- Auth Lab은 raw access token, token hash, session cookie, PKCE verifier, client secret을 표시하지 않음

## 버전 정책

- `/sdk/v0.1.0/...`: immutable legacy contract
- `/sdk/v0.2.0/...`: immutable UX v1 contract
- `/sdk/nakwol-auth-web.js`: stable alias, 안정 버전 승격에 따라 이동 가능
- 새 breaking/minor 계약은 새 pinned URL을 만들고 기존 pinned URL은 유지

첫 외부 레퍼런스 통합은 별도 계획에 따라 `siege-calculator.pages.dev`에서 진행하며, AUTH v0.2.0의 stable production smoke가 끝나기 전에는 소비자 전환을 진행하지 않습니다.

## 접속 문제의 공통 복구 경로

오류 화면에 `https://nakwol-auth.sepsd21.workers.dev/account?client_id=YOUR_CLIENT_ID&recovery=1` 링크를 **계정 확인·접속 문제 해결**로 표시할 수 있습니다. 자동 이동시키지 말고 현재 서비스의 로그인 재시도 버튼과 함께 제공하세요.

계정 페이지는 등록된 서비스 이름, 확인된 접근 상태 안내, Discord 역할 재확인, 서비스 복귀 버튼을 제공합니다. 복귀 주소는 AUTH에 등록된 Redirect URI에서만 선택하며 전달된 임의의 `return_to` 주소는 사용하지 않습니다. 관리자 차단·운영자 전용·서비스 설정 문제는 재로그인으로 해결되지 않는다고 안내합니다.

중앙 `/connect/v1.js` 오류 화면에는 새로고침 후 적용됩니다. Connect CLI 0.6.1로 생성한 서버 보호 로그인 화면에도 포함됩니다. 이미 생성·배포한 서버 코드는 설치에 사용한 `protect` 명령으로 다시 생성하고 사이트를 재배포해야 합니다. 자체 제작 오류 화면은 위 링크를 직접 연결해야 합니다. 복구 링크 자체가 서버의 접근 권한 검사를 대체하지는 않습니다.

npm 레지스트리 반영과 무관하게 이번 공식 패키지는 AUTH의 `/connect/cli/v0.6.1/package.tgz`에서 받을 수 있습니다. 기존 서버 보호 설정을 보존하면서 해당 프로젝트에서 다음 형태로 실행합니다(assets·url은 기존 설정 사용).

```bash
npm exec --yes --package=https://nakwol-auth.sepsd21.workers.dev/connect/cli/v0.6.1/package.tgz -- nakwol-connect protect install --provider cloudflare-workers --assets dist --url https://YOUR-SITE/
```

이후 기존 사이트 배포 명령과 `protect verify`로 직접 접근 차단을 확인합니다.
