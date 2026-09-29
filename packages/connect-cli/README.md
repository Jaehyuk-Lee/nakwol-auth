### 서버 보호 설치와 검증 (Connect 0.7)

**member는 중앙의 시즌3 역할 보유자를 뜻합니다. 개발자는 역할 ID를 입력하지 않습니다.**
개발자 권한을 받은 앱 소유자는 member/guest를 선택할 수 있으며 admin 정책과 추가 역할은 AUTH 운영자가 설정합니다.

**Embed만으로 HTML·파일이 비공개가 되지는 않습니다.** 직접 주소 접근 차단은 서버 게이트 설치와 배포가 필요합니다.
자동 지원은 Cloudflare Workers Static Assets 및 Cloudflare Pages의 정적 빌드입니다. SSR/API/기존 사용자 Worker는 자동 연결하지 않습니다.

```bash
npx --yes nakwol-connect init --auth required --access-policy member --url https://YOUR-SITE/
# 먼저 사이트를 빌드해 dist/index.html을 준비하세요.
npx --yes nakwol-connect protect install --provider cloudflare-workers --assets dist --url https://YOUR-SITE/
# 설치 후 다시 빌드하세요. 아래 Secret에는 무작위 32자 이상 키를 입력하세요.
npx wrangler secret put NAKWOL_SESSION_SECRET --config wrangler.nakwol.json
npx wrangler deploy --config wrangler.nakwol.json
npx --yes nakwol-connect protect verify --url https://YOUR-SITE/ --json
npx --yes nakwol-connect doctor --url https://YOUR-SITE/ --json
```

required의 init·sync·doctor는 서버 게이트와 배포 사이트의 비로그인 차단 검증을 통과하기 전까지 ok:false/종료 코드 1을 반환합니다. 앱 등록과 파일 생성은 보존되므로 배포 후 다시 검사하세요. doctor는 --url 생략 시 저장된 운영 URL을 검사합니다. 로컬 검사만으로 완료되지 않습니다.
빌드가 준비되어 있으면 init에 --provider cloudflare-workers --assets dist를 함께 지정해 서버 게이트까지 설치할 수 있습니다.

### Cloudflare Pages

기존 Pages 프로젝트에 적용할 때는 다음 명령을 사용합니다. 프로젝트 이름은 AUTH client ID와 다를 수 있습니다.

```bash
nakwol-connect protect install --provider cloudflare-pages --project-name YOUR-PAGES-PROJECT --assets dist --url https://YOUR-PAGES-PROJECT.pages.dev/
npx wrangler pages secret put NAKWOL_SESSION_SECRET --project-name YOUR-PAGES-PROJECT
npx wrangler pages deploy dist --project-name YOUR-PAGES-PROJECT --branch YOUR-PRODUCTION-BRANCH
nakwol-connect doctor --json
```

dist/_worker.js와 dist/_routes.json을 반드시 함께 배포합니다. 모든 경로에 인증을 적용하며 라우팅 제외 경로는 없습니다. 재빌드 시 생성된 두 파일을 보존하세요. Pages Functions의 요청 한도 초과 동작도 **fail closed**로 설정해야 합니다. 과거 공개 배포 URL은 새 배포로 사라지지 않으므로 별도 비공개화/삭제가 필요합니다.
configured는 설치만 완료, anonymous-blocking-verified는 검사한 주소·경로의 비로그인 차단 검증 통과입니다.
GET·HEAD·Range·잘못된 쿠키를 검사하며 200·302·404·503은 성공으로 인정하지 않습니다.
이전 배포 주소는 --alternate-origins로 추가하세요. 실제 시즌3/비멤버 로그인과 로그아웃은 브라우저로 별도 확인합니다.
운영 로그인에는 봇이 필요 없으며, OAuth 때 저장한 역할을 쓰므로 Discord 역할 제거가 즉시 반영되지는 않습니다.

상세 절차: [온라인 설치 안내](https://nakwol-auth.sepsd21.workers.dev/connect#server-protection)

 nakwol-connect

Official agent-first CLI for connecting web projects to NAKWOL AUTH and NAKWOL DATA.

## Protected by default

NAKWOL Connect defaults to required authentication. Server protection must be installed separately. Unless the developer explicitly asks for a public service, preserve both defaults:

```text
auth=required
access-policy=member
```

A plain Embed install only covers the page visually. Required installation remains incomplete until a server gate is deployed and verified. Missing or malformed central access-policy settings fail closed to `member`.

Do not infer that a page should be public merely because it is static, a demo, a test page, or hosted on Cloudflare Pages.

## Fast path

Default protected service:

```bash
npx --yes nakwol-connect init
npx --yes nakwol-connect doctor --json
```

AUTH + shared NAKWOL DATA, still protected:

```bash
npx --yes nakwol-connect init --scopes roster:read,decks:read
npx --yes nakwol-connect data describe --json
npx --yes nakwol-connect doctor --json
```

Only when the user explicitly wants the page visible without login:

```bash
npx --yes nakwol-connect init --auth optional
```

Only when the user explicitly wants a fully public service, including non-member authenticated users:

```bash
npx --yes nakwol-connect init --auth optional --access-policy guest
```

The first machine authorization opens a short-lived browser approval once. After that the CLI automatically creates/reuses the AUTH app, configures exact DATA scopes, installs or updates the project marker, writes `.nakwol-connect.json`, and verifies local + AUTH + DATA + OpenAPI state.

No Discord secret, Cloudflare credential, permanent admin key, or CLI token is written into the project.

## Authentication mode vs access policy

These are separate controls:

```text
auth=required   page is locked until authentication succeeds (default)
auth=optional   page is public; login is available for identity/personalization

access-policy=guest    any authenticated Discord user
access-policy=member   authenticated NAKWOL members only (default)
access-policy=admin    NAKWOL AUTH operators only
```

At runtime the Universal Embed uses `data-auth="required"` or `data-auth="optional"`. If the attribute is omitted, `required` is assumed.

## Rules for coding agents

When an LLM/coding agent performs an integration, it must follow these rules:

```text
Use the official nakwol-connect CLI.
Do not implement Discord OAuth or PKCE separately.
Use npx --yes nakwol-connect init for normal services.
Do not add --auth optional or --access-policy guest unless the user explicitly requests a public service. Stored `public` policies remain a legacy alias for `guest`.
Register the exact production callback URL.
Reuse and normalize an existing Connect integration instead of stacking a second auth implementation.
Do not place Discord Client Secret, Cloudflare secrets, or CLI tokens in browser code or the repository.
Discover DATA with nakwol-connect data describe --json and request minimum scopes only.
Run nakwol-connect doctor --json at the end.
Explicitly confirm the installed auth mode is required and access policy is member unless an exception was requested.
```

## DATA discovery and commands

`data describe` reads the live public OpenAPI 3.1 document without a CLI session. Coding agents should use it instead of inventing endpoint paths.

```text
nakwol-connect data describe --json
nakwol-connect data status
nakwol-connect data set roster:read,decks:read
nakwol-connect data add equipment:read
nakwol-connect data remove decks:read
```

Available DATA scopes:

```text
profile:read profile:write
roster:read roster:write
equipment:read equipment:write
decks:read decks:write
```

## Browser runtime

The installed `connect/v1.js` exposes authentication and DATA automatically. With the default required mode it places a full-page authentication guard over the app immediately, attempts central SSO, and redirects to NAKWOL/Discord login when no reusable NAKWOL session exists. The app is revealed only after the current service receives its own valid access token. Access denial leaves the guard in place.

Same-browser NAKWOL SSO does not share app tokens: every service still receives its own client-bound access token.

Prefer the high-level helpers for the current DATA contract:

```js
const { data } = window.NAKWOL_CONNECT;
const openapi = await data.describe();
const accounts = await data.accounts.list();
const generals = await data.roster.generals.list(accountId);
const decks = await data.decks.list(accountId);
const deck = await data.decks.get(accountId, deckId);
```

Available high-level namespaces:

```text
data.accounts
data.roster.generals
data.roster.tactics
data.equipment
data.decks
data.snapshots
data.registry
```

Writes use the same server contract:

```js
await data.roster.tactics.upsert(accountId, tacticId, {
  breakthrough: 5,
  favorite: true,
});

await data.decks.replaceComposition(accountId, deckId, composition);
```

All user-owned path IDs are URL-encoded. JSON helpers set `Content-Type: application/json`. The helpers return the existing `{ ok, data }` DATA envelope and preserve `NakwolDataError.code`, `.status`, and `.payload`. Unsupported game-account update/delete methods are intentionally absent because the server does not expose those operations.

Low-level access remains available for current or future operations not yet wrapped:

```js
const custom = await data.request('/v1/game-accounts');
```

Bearer tokens and `X-NAKWOL-CLIENT-ID` are injected by the runtime for protected DATA calls. `data.describe()` / `data.openapi()` are public discovery calls and work before user login. The embedded scope list is informational; `data.hasScope()` is only a UX hint and the DATA Worker remains authoritative.

The browser guard controls page UX, but static HTML/JS files on a public host are still retrievable directly. Sensitive member data must continue to be served by AUTH/DATA-protected APIs rather than embedded as secrets in the static bundle.

## Commands

```text
init                 detect → AUTH app → DATA scopes → install → verify
doctor               validate local, AUTH, DATA and OpenAPI desired state
status               show local/AUTH/DATA state
add-url <URL>        add Redirect URI
sync                 re-apply desired AUTH/DATA/local state
data describe        read live DATA OpenAPI without device authorization
data ...             manage DATA scopes
remove               remove local integration/config; central state preserved
```

Useful options:

```text
--auth <required|optional>              default: required
--access-policy <guest|member|admin>    default: member
```

## Discovery

```text
https://github.com/goyoung2/nakwol-auth
https://nakwol-auth.sepsd21.workers.dev/connect
https://nakwol-auth.sepsd21.workers.dev/llms.txt
https://nakwol-auth.sepsd21.workers.dev/connect/cli/manifest.json
https://nakwol-data.sepsd21.workers.dev/openapi.json
```

Requirements: Node.js 20+, network access to NAKWOL AUTH and DATA. License: MIT.

## Server gate 0.7.0 authorization lease

The common `nakwol-connect/server` runtime issues an AES-GCM authenticated cookie bound to client ID, site origin, AUTH origin and policy. It contains the user ID and a fixed five-minute authorization lease. Valid leases authorize HTML, JS/CSS, JSON, images, fonts and downloads locally; these requests make **zero `/me` calls** and no remote storage lookup. Initial session exchange, expired leases and legacy-cookie upgrades call `/me`. Sessions expire at the earlier of token expiry and one hour after creation.

Renewal uses bounded isolate-local completed-result caching plus single-flight; multiple isolates may each renew. Requests never extend the original lease. AUTH outages do not invalidate an already-issued lease, but expired-lease failures return 503 without stale authorization. Central revocation can take **up to five additional minutes**. OAuth role snapshots can already lag by 24 hours, so Discord role removal may take 24 hours plus five minutes. Logout clears the browser cookie, denies the token in the current isolate and attempts central revocation; replay in another isolate is bounded by the existing lease.

ETag 200/304 responses remain `private,no-cache,max-age=0,must-revalidate`; others remain `private,no-store,max-age=0`. Conditional requests pass authorization first. No shared cache or positive browser cache TTL is introduced.

Existing `~0.6.3` build hooks **do not adopt 0.7.0 automatically**. Once 0.7.0 is published, explicitly run `npx --yes nakwol-connect@0.7.0 protect update`, then build, deploy and run `protect verify` and `doctor`. New hooks follow `~0.7.0`. An AUTH-only deployment cannot replace installed site gates. Source version changes are not publication or deployment evidence.

See [the complete gate specification](GATE_SPEC.md) for security, cache, recovery and adapter contracts.

### Managed updates (0.7.1 release candidate)

`protect automate [--environment production]` opts an existing official gate into
an exact local npm dependency and GitHub patch-update PR/build/deployment-check
workflows. Commit a reviewed npm lockfile before running CI. Existing CI is never
overwritten. `protect status [--offline]` distinguishes local configuration from
observed deployment version; `protect verify --expect-runtime installed` requires
both anonymous blocking and the expected gate version. No auto-merge, deployment
credentials or automated rollback are installed. See
[managed update operations](../../docs/MANAGED_GATE_UPDATES.md) for setup and limits.
