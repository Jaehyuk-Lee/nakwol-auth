# NAKWOL Platform Core

낙월(落月) 서비스들이 **로그인과 공통 게임 데이터를 같은 방식으로 재사용**하도록 만든 중앙 플랫폼입니다.

새 서비스에서 Discord OAuth를 직접 구현하지 않습니다. 공식 **NAKWOL Connect**를 붙이면 NAKWOL AUTH의 중앙 로그인/SSO와, 필요한 경우 NAKWOL DATA까지 연결됩니다.

- **NAKWOL AUTH** — Discord 기반 중앙 로그인/SSO, 앱별 access token, `/me`, Account Center
- **NAKWOL Connect** — 새 프로젝트에 AUTH/DATA를 설치·등록·검증하는 공식 CLI + Universal Embed
- **NAKWOL DATA** — 장수·전법·장비·덱 등 낙월 서비스가 공유하는 사용자 게임 데이터

## 기본 정책: 낙월 맹원 전용

NAKWOL Connect는 **protected by default**입니다.

기본 설치값은 다음 두 가지가 함께 적용됩니다.

```text
auth = required
access_policy = member
```

즉, 별도 옵션 없이 Connect를 설치한 서비스는 페이지 진입 즉시 인증을 확인하고 **낙월 맹원으로 확인된 사용자만 페이지를 사용할 수 있습니다.**

- 중앙 SSO 세션이 있으면 로그인 버튼을 다시 누르지 않고 자동 인증합니다.
- 중앙 세션이 없으면 페이지를 잠근 상태에서 로그인 흐름을 시작합니다.
- 로그인했지만 낙월 맹원이 아니면 `access_denied`로 페이지를 계속 잠급니다.
- 설정이 누락되거나 잘못된 앱 정책도 안전하게 `member`로 판정합니다.
- 공개 서비스는 개발자가 명시적으로 `optional` / `guest`를 선택해야 합니다.

## 가장 빠른 설치

공개 안내 페이지:

**https://nakwol-auth.sepsd21.workers.dev/connect**

현재 공식 CLI는 **`nakwol-connect@0.5.0`**입니다.

프로젝트 루트에서:

```bash
npx --yes nakwol-connect init
npx --yes nakwol-connect doctor --json
```

이 기본 명령만으로 **로그인 필수 + 낙월 맹원 전용**으로 설치됩니다.

DATA도 함께 쓰는 경우 필요한 scope만 선언합니다.

```bash
npx --yes nakwol-connect init --scopes roster:read,decks:read
npx --yes nakwol-connect data describe --json
npx --yes nakwol-connect doctor --json
```

정말 공개 페이지가 필요한 경우에만 명시적으로 완화합니다.

```bash
npx --yes nakwol-connect init --auth optional --access-policy guest
```

`--auth optional`은 **페이지를 로그인 없이 보여줄 수 있는가**, `--access-policy guest`는 **Discord에 로그인한 비맹원도 앱 토큰을 받을 수 있는가**를 뜻합니다. 서로 다른 설정입니다. 접근 정책은 `guest`(Discord 로그인 사용자), `member`(낙월 맹원, 기본값), `admin`(AUTH 운영자) 중 선택합니다. 기존 `public` 설정값은 `guest`로 해석됩니다.

## Universal Embed

CLI가 프로젝트에 넣는 기본 형태는 다음과 같습니다.

```html
<script
  src="https://nakwol-auth.sepsd21.workers.dev/connect/v1.js"
  data-client-id="발급된-client-id">
</script>
```

`data-auth`를 생략하면 자동으로 `required`입니다. 공개 페이지에만 다음을 명시합니다.

```html
<script
  src="https://nakwol-auth.sepsd21.workers.dev/connect/v1.js"
  data-client-id="발급된-client-id"
  data-auth="optional">
</script>
```

브라우저 런타임:

```js
window.NAKWOL_CONNECT.user
window.NAKWOL_CONNECT.login()
window.NAKWOL_CONNECT.logout()
window.NAKWOL_CONNECT.data
```

Web SDK stable은 **0.3.0**이며 Universal Embed는 같은 브라우저의 중앙 SSO를 자동 사용합니다.

## 코딩/LLM 에이전트에게 그대로 줄 지시문

아래 블록을 그대로 전달하면 됩니다.

```text
이 프로젝트에 공식 NAKWOL Connect를 붙여줘.

NAKWOL Connect의 npm 패키지는 `nakwol-connect`이고 프로젝트 루트에서
`npx --yes nakwol-connect ...` 형태로 실행한다. Discord OAuth나 PKCE를 직접 구현하지 말고 반드시 공식 CLI와 Universal Embed를 사용해.

이 서비스는 특별히 공개 서비스라고 명시하지 않는 한 반드시 NAKWOL 기본 보안 정책을 유지해야 한다:
- auth mode = required
- access policy = member
- 페이지 진입 즉시 인증 가드를 적용
- 중앙 NAKWOL SSO 세션이 있으면 사용자 조작 없이 자동 인증
- 세션이 없으면 페이지를 공개하지 말고 로그인 흐름으로 연결
- 로그인했지만 낙월 맹원이 아니면 페이지를 공개하지 말고 access denied 처리

따라서 일반적인 설치는 `npx --yes nakwol-connect init`을 사용한다.
`--auth optional` 또는 `--access-policy guest`는 내가 이 서비스가 공개 서비스라고 명시적으로 요청한 경우에만 사용한다. 임의로 보안을 완화하지 마.

현재 서비스의 실제 production URL을 callback으로 정확히 등록해. 기존 NAKWOL Connect 연동이 있다면 별도 OAuth 구현을 추가하지 말고 공식 Connect 방식으로 정리해.

브라우저 코드나 저장소에는 Discord Client Secret, Cloudflare secret, Connect CLI token을 넣지 마.
DATA가 필요하면 필요한 scope만 최소로 선언하고, 현재 계약은 `npx --yes nakwol-connect data describe --json`으로 확인해.

작업 후 반드시 다음을 실행해 검증해:
`npx --yes nakwol-connect doctor --json`

마지막으로 설치된 Embed/설정에서 auth가 required이고 access policy가 member인지 확인해서 결과를 보고해.
```

## 개발자 권한

NAKWOL 운영자는 `https://nakwol-auth.sepsd21.workers.dev/admin/developers`에서 Discord 사용자 ID를 기준으로 Connect 개발자 권한을 사전 등록할 수 있습니다.

- 대상자가 아직 NAKWOL에 로그인한 적이 없어도 등록할 수 있습니다.
- Discord 서버 역할/서버 관리자 권한과 Connect 개발자 권한은 별개입니다.
- `developer`는 자기 앱을 생성·관리할 수 있습니다.
- `operator`는 Connect 전체 앱을 관리할 수 있습니다.
- NAKWOL 플랫폼 관리자(`auth_operators`) 권한은 Connect operator와 별개입니다.

앱 관리: **https://nakwol-auth.sepsd21.workers.dev/admin/apps**

## 현재 구성

### NAKWOL AUTH

- production runtime: **AUTH 0.2.0**
- Web SDK stable: **0.3.0**
- origin: `https://nakwol-auth.sepsd21.workers.dev`
- Discord OAuth, NAKWOL ID, membership, Authorization Code + PKCE(S256), 앱별 access token, `/me`, 중앙 SSO를 담당합니다.

#### AUTH 0.2 formal release provenance

아래 값은 현재 Connect 0.5 안내와 별개로 보존하는 **AUTH 0.2.0 정식 릴리스 증거**입니다.

- formal component release/tag: **`auth-v0.2.0` — released 2026-08-31**
- formal release target stable SHA: `154baf448ee45a7b2bcf6e320f09a65866e1f8af`
- final AUTH v0.2 deploy workflow: `33373705515` — success
- final AUTH v0.2 Worker Version ID: `b3540665-6d2a-4f85-a61f-4dbfb8837cad`
- final production smoke workflow: `33373908231` — success
- 당시 cross-component compatibility baseline: **Connect 0.4.0**, **DATA 0.9.0**
- Auth Lab **V1–V12 release matrix: completed**
- V8-B 실제 Discord 역할 변경 검증은 외부 역할관리 권한 의존 항목으로 release **waiver**가 승인됨

### NAKWOL Connect

- CLI/distribution: **Connect 0.5.0**
- npm package: **`nakwol-connect@0.5.0`**
- 기본값: **`required + member`**
- 앱 등록/재사용, callback 등록, AUTH/DATA 자동 연동, doctor, DATA OpenAPI discovery를 담당합니다.

### NAKWOL DATA

- production runtime: **DATA 0.9.0**
- schema: **3**
- origin: `https://nakwol-data.sepsd21.workers.dev`
- OpenAPI 3.1: `/openapi.json`

DATA scopes:

- `profile:read`, `profile:write`
- `roster:read`, `roster:write`
- `equipment:read`, `equipment:write`
- `decks:read`, `decks:write`

## 보안 경계

- 외부 서비스는 Discord Client Secret을 보유하지 않습니다.
- Connect CLI token은 브라우저 코드나 프로젝트 저장소에 넣지 않습니다.
- 앱은 AUTH/DATA 공개 API와 SDK만 사용하며 D1에 직접 접근하지 않습니다.
- access token은 앱별 client binding으로 검증됩니다.
- 공개 전환은 반드시 명시적이어야 하며, 누락/오류 설정은 member-only로 닫힙니다.
- DATA scope는 필요한 권한만 최소로 요청합니다.

상세 계약은 [CONNECT.md](./CONNECT.md), [WEB_SDK.md](./WEB_SDK.md), [DATA.md](./DATA.md)를 참고하세요.
