# NAKWOL Connect CLI v0.5

NAKWOL Connect CLI는 코딩 에이전트가 NAKWOL AUTH와 NAKWOL DATA를 프로젝트에 연결하고, 현재 DATA API 계약까지 자동 발견하는 공식 도구입니다.

## 기본 정책

NAKWOL Connect는 **낙월 맹원 전용을 기본값**으로 사용합니다.

```text
auth = required
access_policy = member
```

따라서 일반적인 설치에서는 별도 보안 옵션을 붙이지 않습니다.

```bash
npx --yes nakwol-connect init
npx --yes nakwol-connect doctor --json
```

이 상태에서 페이지는 인증이 완료되기 전까지 잠기며, 중앙 NAKWOL SSO가 있으면 자동 인증하고, 세션이 없으면 로그인 흐름으로 이동합니다. 로그인했더라도 낙월 맹원이 아니면 접근이 거부됩니다.

테스트 페이지, 정적 사이트, Cloudflare Pages라는 이유만으로 공개 서비스라고 판단하지 않습니다. 공개가 제품 요구사항일 때만 개발자가 명시적으로 완화합니다.

```bash
npx --yes nakwol-connect init --auth optional --access-policy guest
```

## LLM/코딩 에이전트에게 시키는 말

```text
이 프로젝트에 공식 NAKWOL Connect를 붙여줘.

공식 npm 패키지는 nakwol-connect이고 프로젝트 루트에서
npx --yes nakwol-connect ... 형태로 실행한다.
Discord OAuth나 PKCE를 직접 구현하지 말고 공식 CLI와 Universal Embed를 사용해.

내가 이 서비스를 공개 서비스라고 명시하지 않는 한 반드시 다음 기본 정책을 유지해:
- auth=required
- access_policy=member
- 인증 전에는 페이지를 공개하지 않음
- 중앙 NAKWOL SSO가 있으면 자동 인증
- 중앙 세션이 없으면 로그인 흐름으로 이동
- 로그인한 비맹원은 access denied

테스트 페이지나 정적 Cloudflare Pages라는 이유로 --auth optional 또는 --access-policy guest를 임의로 쓰지 마.
공개 서비스라고 내가 명시한 경우에만 보안을 완화해.

현재 서비스의 실제 production URL을 exact callback으로 등록해.
기존 Connect 연동이 있다면 별도 OAuth 구현을 추가하지 말고 공식 Connect 방식으로 정리해.

DATA가 필요하면 필요한 scope만 최소로 추가하고
npx --yes nakwol-connect data describe --json 으로 현재 OpenAPI 계약을 먼저 읽어.
high-level data.accounts / data.roster / data.equipment / data.decks / data.snapshots helper를 우선 사용하고,
helper가 없는 경우에만 data.request()를 사용해.

브라우저 코드나 저장소에는 Discord Client Secret, Cloudflare secret, Connect CLI token을 넣지 마.

마지막에 npx --yes nakwol-connect doctor --json 을 실행해.
설치된 설정과 Embed에서 auth=required, access_policy=member인지 직접 확인하고,
다르면 성공이라고 보고하지 말고 먼저 수정해.
```

예를 들어 장수/전법 DATA까지 필요한 기본 보호 서비스라면 에이전트가 실행할 명령은 다음과 같습니다.

```bash
npx --yes nakwol-connect init --scopes roster:read
npx --yes nakwol-connect data describe --json
npx --yes nakwol-connect doctor --json
```

최초 한 번은 브라우저에서 짧은 device authorization 승인이 필요할 수 있습니다. 그 이후에는 AUTH 앱 등록/재사용, DATA scope 등록, 프로젝트 코드 설치, `.nakwol-connect.json` 작성, 검증이 자동입니다. `data describe` 자체는 공개 OpenAPI를 읽으므로 device 승인이 필요 없습니다.

## auth mode와 access policy

```text
auth=required   인증 전 페이지 잠금. 기본값
auth=optional   로그인 없이 페이지 표시

access-policy=guest    Discord 로그인 사용자 모두 앱 사용
access-policy=member   낙월 맹원만 앱 사용. 기본값
access-policy=admin    NAKWOL AUTH 운영자만
```

두 설정은 독립적입니다. 페이지 자체를 공개하려면 `optional`, 비맹원에게 앱 권한까지 주려면 `guest`를 각각 명시해야 합니다. 기존 `public` 정책값은 `guest`로 해석됩니다.

## 프로젝트 상태

비밀값이 없는 config version 2를 사용하며 `authMode`도 저장합니다.

```json
{
  "version": 2,
  "clientId": "deck-lab",
  "framework": "vite",
  "redirectUris": ["https://deck-lab.pages.dev/"],
  "integration": "universal-embed",
  "authMode": "required",
  "dataOrigin": "https://nakwol-data.sepsd21.workers.dev",
  "dataScopes": ["decks:read", "roster:read"]
}
```

중앙 앱의 `access_policy`는 별도로 `member`가 기본이며, 설정 누락이나 잘못된 값도 `member`로 fail-closed 됩니다.

## DATA scope

```text
profile:read profile:write
roster:read roster:write
equipment:read equipment:write
decks:read decks:write
```

```bash
nakwol-connect data describe --json
nakwol-connect data status
nakwol-connect data set roster:read,decks:read
nakwol-connect data add equipment:read
nakwol-connect data remove decks:read
```

## OpenAPI discovery

NAKWOL DATA는 현재 앱 API를 `GET /openapi.json`에서 OpenAPI 3.1로 공개합니다. 보호된 operation에는 필요한 `x-nakwol-scope`가 들어 있습니다. 코딩 에이전트는 이 문서를 먼저 읽고 그 문서에 있는 path/method/request shape만 사용해야 합니다.

```bash
npx --yes nakwol-connect data describe --json
```

## 브라우저 코드

Universal Embed 기본 형태:

```html
<script
  src="https://nakwol-auth.sepsd21.workers.dev/connect/v1.js"
  data-client-id="deck-lab">
</script>
```

`data-auth`를 생략하면 `required`입니다. 공개 페이지에서만 `data-auth="optional"`을 사용합니다.

DATA runtime:

```js
const data = window.NAKWOL_CONNECT.data;
const contract = await data.describe();
const generals = await data.registry.generals();
const accounts = await data.accounts.list();
const decks = await data.decks.list(accountId);
```

High-level helper namespace:

```text
data.accounts.list/create
data.roster.generals.list/upsert/remove
data.roster.tactics.list/upsert/remove
data.equipment.list/create/update/remove
data.decks.list/get/create/update/replaceComposition/remove
data.snapshots.list/get/create
data.registry.summary/generals/tactics/equipment/equipmentTraits/stats/formations/warbooks
```

기존 low-level 호출도 계속 유효합니다.

```js
const custom = await data.request('/v1/game-accounts');
```

보호된 DATA 호출은 현재 앱 access token과 client ID를 자동으로 붙입니다. `data.describe()` / `data.openapi()`는 공개 discovery라 로그인 전에도 사용할 수 있습니다. CLI token, Discord secret, Cloudflare token은 브라우저나 프로젝트에 들어가지 않습니다. `data.hasScope()`는 UI용 hint이며 실제 권한은 DATA Worker가 판정합니다.

## doctor

`doctor --json`은 로컬 marker/config, `authMode`, AUTH 앱/redirect, DATA 앱 등록/scope, DATA OpenAPI 3.1과 로컬 scope 선언을 비교합니다. desired state와 다르면 `ok:false`와 non-zero exit로 종료합니다.

## 배포

현재 npm 패키지는 `nakwol-connect@0.5.0`입니다. npm 패키지는 Trusted Publishing OIDC로 배포하며 공개 패키지와 Worker fallback 배포는 항상 같은 버전을 유지합니다.
