# NAKWOL Platform Core

낙월(落月) 서비스들이 **로그인과 공통 게임 데이터를 같은 방식으로 재사용**하도록 만든 중앙 플랫폼입니다.

새 서비스에서 Discord OAuth를 직접 구현하지 않습니다. 공식 **NAKWOL Connect**를 붙이면 NAKWOL AUTH의 중앙 로그인/SSO와, 필요한 경우 NAKWOL DATA까지 연결됩니다.

- **NAKWOL AUTH** — Discord 기반 중앙 로그인/SSO, 앱별 access token, `/me`, Account Center
- **NAKWOL Connect** — 새 프로젝트에 AUTH/DATA를 설치·등록·검증하는 공식 CLI + Universal Embed
- **NAKWOL DATA** — 장수·전법·장비·덱 등 낙월 서비스가 공유하는 사용자 게임 데이터

## 설치·업데이트 안내 (Connect 0.7.1)

**LLM에게 맡기려면 [복사용 설치·업데이트 지시문](docs/LLM_INSTALLATION.md)을 사용하세요.** 신규 설치, 기존 연동 보존, 호스팅별 서버 보호, 운영 검증까지 포함합니다.

| 필요한 작업 | 안내 |
|---|---|
| LLM으로 설치 또는 업데이트 | [복사용 지시문](docs/LLM_INSTALLATION.md) |
| Workers / Pages 정적 빌드 보호 | [설치·배포·차단 검사](docs/CONNECT_SERVER_PROTECTION.md) |
| Vercel / Netlify / 자체 서버 | [공식 공통 게이트 어댑터](docs/CONNECT_SERVER_PROTECTION.md#자체-서버-공식-api-호출) |
| 업데이트 PR·버전 확인·관리자 보고 | [관리형 업데이트](docs/MANAGED_GATE_UPDATES.md) |
| 명시적 자동 복구 설정 | [Cloudflare 롤백](docs/DEPLOYMENT_ROLLBACK.md) |
| 보안·캐시·세션 계약 | [서버 게이트 명세](packages/connect-cli/GATE_SPEC.md) |

**Embed는 로그인 UI이며 HTML·파일 직접 접근을 차단하지 않습니다.** 보호 사이트는 공식 서버 게이트를 설치하고 사이트를 배포해야 합니다. 자동 설치는 Workers Static Assets / Pages 정적 빌드에 제공하며, 다른 서버는 공통 `createGate`를 연결합니다. GitHub Pages 자체에서는 서버 게이트를 실행할 수 없습니다.

## 기본 정책: 낙월 맹원 전용

NAKWOL Connect의 **기본 인증 정책은 required + member**입니다. 서버 보호 여부와는 별도로 확인합니다.

기본 설치값은 다음 두 가지가 함께 적용됩니다.

```text
auth = required
access_policy = member
```

서버 게이트까지 배포한 서비스는 **중앙의 시즌3 member 정책을 통과한 사용자만 보호 콘텐츠를 받을 수 있습니다.** init만 실행한 상태는 보호 설치 완료가 아닙니다.

- 중앙 SSO 세션이 있으면 로그인 버튼을 다시 누르지 않고 자동 인증합니다.
- 중앙 세션이 없으면 페이지를 잠근 상태에서 로그인 흐름을 시작합니다.
- 로그인했지만 낙월 맹원이 아니면 `access_denied`로 페이지를 계속 잠급니다.
- 설정이 누락되거나 잘못된 앱 정책도 안전하게 `member`로 판정합니다.
- 공개 서비스는 개발자가 명시적으로 `optional` / `guest`를 선택해야 합니다.

## 가장 빠른 설치

공개 안내 페이지:

**https://nakwol-auth.sepsd21.workers.dev/connect**

현재 공식 CLI는 **`nakwol-connect@0.7.1`**입니다.

프로젝트 루트에서:

```bash
npx --yes nakwol-connect init
npx --yes nakwol-connect doctor --json
```

이 기본 명령은 **로그인 필수 + 시즌3 정책의 Embed**를 설치합니다. 서버 보호는 [호스팅별 설치·배포 절차](docs/CONNECT_SERVER_PROTECTION.md)를 이어서 진행합니다. required의 init은 보호 배포 전 ok:false/exit 1일 수 있습니다. JSON의 실패 항목을 확인하고 이미 만들어진 앱과 설정을 보존하세요.

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

Web SDK stable은 **0.3.1**이며 Universal Embed는 같은 브라우저의 중앙 SSO를 자동 사용합니다.

## 코딩/LLM 에이전트에게 맡기기

[최신 복사용 지시문](docs/LLM_INSTALLATION.md)을 전달하세요. 기존 사이트는 새 앱 생성 대신 현재 clientId·정책·Secret을 보존해 업데이트합니다.

### 이미 설치한 사이트의 반영 시점

중앙 Embed 변경은 중앙 스크립트를 사용하는 사이트에 반영되지만, 서버 게이트는 **패키지 업데이트 → 사이트 빌드 → 배포**가 필요합니다. AUTH 배포만으로 소비자 서버 코드는 교체되지 않습니다.

0.7.1 공통 게이트는 유효한 5분 authorization lease 동안 자산마다 중앙 AUTH를 호출하지 않고 암호화 쿠키를 로컬 검증합니다. 중앙 권한 회수에는 최대 5분의 추가 지연이 있으며, Discord 역할 정보의 최대 24시간 지연과 별개입니다. lease 만료 후 AUTH 장애는 차단합니다.

관리형 업데이트는 exact dependency와 lockfile, 패치 업데이트 PR 및 배포 후 검사 흐름을 제공합니다. 자동 병합·배포·롤백을 기본으로 켜지 않습니다. [설정과 한계](docs/MANAGED_GATE_UPDATES.md)를 확인하세요.

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
- Web SDK stable: **0.3.1**
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

- CLI/distribution: **Connect 0.7.1**
- npm package: **`nakwol-connect@0.7.1`**
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
