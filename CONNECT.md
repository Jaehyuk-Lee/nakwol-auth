# NAKWOL Connect 0.7.1

NAKWOL Connect는 낙월 서비스가 AUTH와 DATA를 공통 방식으로 연결하도록 하는 공식 integration layer입니다.

## 기본은 보호된 서비스

Connect 0.5부터 기본 정책은 다음과 같습니다.

```text
auth = required
access_policy = member
```

둘은 다른 역할을 합니다.

- `auth=required`: 로그인/인증이 끝나기 전에는 페이지 자체를 보여주지 않습니다.
- `access_policy=member`: 로그인한 사용자 중 낙월 맹원만 앱 access token을 받을 수 있습니다.

설정이 빠졌다고 공개되지 않습니다. 중앙 정책에 설정 행이 없거나 알 수 없는 값이 들어 있어도 `member`로 닫힙니다.

## 가장 쉬운 방법

LLM에 맡길 때는 [설치·업데이트 지시문](docs/LLM_INSTALLATION.md)을 전달하세요. 아래 init은 앱/Embed 연결이며 **서버 보호 완료가 아닙니다**. [서버 게이트 설치·배포·검증](docs/CONNECT_SERVER_PROTECTION.md)을 반드시 이어서 진행합니다.

```bash
# 기본: 로그인 필수 + 낙월 맹원 전용
npx --yes nakwol-connect init

# AUTH + DATA, 여전히 required + member
npx --yes nakwol-connect init --scopes roster:read,decks:read

# 항상 검증
npx --yes nakwol-connect doctor --json
```

최초 한 번은 브라우저에서 짧은 device approval이 필요할 수 있습니다. 이후 AUTH 앱 등록/재사용, DATA scope 등록, 프레임워크별 Embed 삽입, `.nakwol-connect.json` 작성, doctor 검증이 자동입니다.

공개 서비스는 예외입니다. 공개가 제품 요구사항일 때만 다음처럼 명시합니다.

```bash
npx --yes nakwol-connect init --auth optional --access-policy guest
```

코딩 에이전트는 사용자 지시 없이 `optional` 또는 `guest`로 완화하면 안 됩니다.

## Universal Embed

CLI가 관리하는 기본 Embed:

```html
<script
  src="https://nakwol-auth.sepsd21.workers.dev/connect/v1.js"
  data-client-id="deck-lab"
  data-data-origin="https://nakwol-data.sepsd21.workers.dev"
  data-data-scopes="decks:read,roster:read">
</script>
```

`data-auth`가 없으면 `required`입니다. 페이지 로드 직후 전체 페이지 인증 가드가 생깁니다.

required 모드의 흐름:

```text
페이지 진입
→ 페이지 잠금
→ 기존 앱 token 확인
→ 없으면 중앙 SSO 자동 확인
→ 중앙 SSO 성공: 앱별 token 발급 후 페이지 공개
→ 중앙 세션 없음: 로그인 흐름 시작
→ 비맹원/access denied: 페이지 잠금 유지
```

같은 브라우저 프로필에서 이미 다른 NAKWOL 서비스에 로그인했다면 사용자가 로그인 버튼을 다시 누르지 않아도 자동으로 연결됩니다.

중앙 로그인 세션은 마지막 사용 후 10일까지 유지되고(사용할 때마다 연장), 로그인 시점부터 최대 30일이 지나면 다시 Discord 로그인을 거칩니다. 앱 토큰은 1시간이며, 새로 발급할 때마다 맹원 자격을 다시 확인합니다.

공개 페이지에서만:

```html
<script
  src="https://nakwol-auth.sepsd21.workers.dev/connect/v1.js"
  data-client-id="public-guide"
  data-auth="optional">
</script>
```

`data-auth="optional"`은 페이지 공개 여부만 바꿉니다. 비맹원에게 앱 권한까지 주려면 중앙 앱 정책도 명시적으로 `guest`여야 합니다. `guest`는 Discord 로그인 사용자만 앱 토큰을 받는 정책이며, 기존 `public` 설정값은 같은 정책으로 해석됩니다.

## 브라우저 API

```js
window.NAKWOL_CONNECT.user
window.NAKWOL_CONNECT.login()
window.NAKWOL_CONNECT.logout()
window.NAKWOL_CONNECT.getAccessToken()
window.NAKWOL_CONNECT.data
```

`getAccessToken()`은 현재 앱의 유효한 토큰 또는 `null`을 반환합니다. 서버 게이트의 세션 교환에 사용하며 토큰을 URL이나 로그에 넣지 않습니다.

`member`는 시즌3 역할 보유자만 허용합니다. `/admin/roles`에서 사이트별 추가 역할을 관리합니다. Embed의 화면 잠금만으로는 HTML·데이터 직접 접근을 막지 못하므로 보호 사이트는 서버에서 매 요청을 검사해야 합니다. [서버 접근 제어 계약과 운영 설정](docs/SERVER_GATED_AUTH.md)을 참고하세요.

Web SDK stable은 `0.3.2`입니다. Universal Embed는 automatic SSO를 기본으로 사용합니다.

### 검증된 세션 복원 (Embed v1.4)

`auth=required`에서도 같은 탭에 **유효한 앱 토큰**과 **그 토큰으로 `/me` 검증에 성공한 사용자 기록**이 함께 있으면, 인증 화면 없이 페이지를 먼저 보여 줍니다.

- 페이지를 새로고침하거나 정적 사이트에서 다른 페이지로 이동할 때 매번 뜨던 "NAKWOL 인증 확인 중…" 화면이 사라집니다.
- `/me` 재검증은 매 로드마다 뒤에서 그대로 실행합니다. 토큰 만료·맹원 자격 상실·오류가 확인되면 즉시 다시 잠그고 로그인 흐름으로 보냅니다.
- 사용자 기록은 토큰의 만료 시각에 묶여 있어 다른 토큰에는 쓰이지 않습니다. 로그아웃·오류 시 삭제됩니다.
- 새 탭은 `sessionStorage`가 비어 있으므로 기존처럼 인증 화면을 거칩니다(중앙 SSO가 있으면 자동 인증).

이벤트:

```js
window.addEventListener('nakwol-session-restored', (e) => { /* e.detail: 복원한 사용자, 재검증 전 */ });
window.addEventListener('nakwol-ready', (e) => { /* e.detail: /me로 검증된 사용자 또는 null */ });
window.addEventListener('nakwol-logout', () => {});
```

`nakwol-session-restored`는 화면 표시용 신호입니다. 권한 판단은 `nakwol-ready` 이후 값이나 DATA Worker 응답을 기준으로 합니다.

## LLM/코딩 에이전트 규칙

[단일 복사용 지시문](docs/LLM_INSTALLATION.md)에 신규 설치·기존 업데이트·호스팅 분기·완료 조건을 모았습니다. 서버 보호 없이 Embed만 설치한 상태, 로컬 빌드만 된 상태, 배포 차단만 확인하고 실제 로그인을 검사하지 않은 상태는 구분해서 보고합니다.

## High-level DATA SDK

```js
const data = window.NAKWOL_CONNECT.data;

const accounts = await data.accounts.list();
const generals = await data.roster.generals.list(accountId);
const tactics = await data.roster.tactics.list(accountId);
const equipment = await data.equipment.list(accountId);
const decks = await data.decks.list(accountId);
const deck = await data.decks.get(accountId, deckId);
```

지원 namespace:

```text
data.accounts
data.roster.generals
data.roster.tactics
data.equipment
data.decks
data.snapshots
data.registry
```

기존 low-level API도 호환성 때문에 계속 지원합니다.

```js
await data.request('/v1/game-accounts');
await data.fetch('/v1/game-accounts');
await data.describe();
await data.openapi();
```

## 보안 경계

- Discord Client Secret은 AUTH Worker에만 존재합니다.
- Connect CLI token은 사용자 홈 session에만 있고 브라우저/프로젝트에 들어가지 않습니다.
- callback URL은 등록된 exact redirect만 허용됩니다.
- access token은 앱별 client binding으로 검증됩니다.
- 기본 앱 정책은 member-only이며 누락/오류도 fail-closed입니다.
- DATA 권한 판정은 DATA Worker가 수행합니다.
- AUTH D1과 DATA D1은 서로 직접 접근하지 않습니다.

## 관리 UI

- Apps: `https://nakwol-auth.sepsd21.workers.dev/admin/apps`
- Developers: `https://nakwol-auth.sepsd21.workers.dev/admin/developers`
