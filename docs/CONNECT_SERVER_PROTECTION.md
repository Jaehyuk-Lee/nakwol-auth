상세 기능 계약: [공통 게이트 명세](../packages/connect-cli/GATE_SPEC.md)

# Connect 서버 보호 설치와 차단 검증

Connect 0.7.1 기준. LLM에게는 [복사용 설치·업데이트 지시문](LLM_INSTALLATION.md)을 전달하세요.

## 누가 무엇을 설정하나요?

- AUTH 운영자는 중앙 `member` 기준을 관리합니다. 현재는 낙월 서버 `1493410906456064112`의 **시즌3 역할 `1553600098661957643`만** 멤버입니다. 시즌1·시즌2·Discord 관리자 역할은 대체 조건이 아닙니다.
- 운영자가 `/admin/developers`에서 허가한 개발자는 **본인 앱**의 `member` 또는 `guest` 정책을 선택합니다. `admin` 정책 설정과 추가 역할 관리는 AUTH 운영자 권한이 필요합니다.
- 개발자는 시즌 역할 ID를 복사하지 않습니다. `member`를 선택하면 중앙 기준을 따릅니다. 추가 역할이 설정된 앱은 시즌3와 추가 역할을 모두 요구합니다.
- `guest`도 Discord 로그인이 필요합니다. `auth=optional`은 브라우저 표시 옵션입니다. 중앙 정책이나 서버 보호를 대체하지 않습니다.

## 무엇이 보호되나요?

Embed만 설치하면 브라우저에서 화면을 잠급니다. 이미 전달한 HTML·JS·JSON·이미지·영상·다운로드 파일은 이 방식으로 비공개가 되지 않습니다.

Connect 0.7.1 서버 게이트는 **자료를 보내기 전에** AES-GCM 쿠키의 앱·사이트·AUTH origin·정책 바인딩과 고정 5분 authorization lease를 로컬에서 확인합니다. 최초 세션 교환, 만료된 lease, 이전 쿠키 형식 업그레이드에서만 AUTH `/me`를 호출합니다. 허용된 경우에만 자산을 제공합니다. 허브 링크로 들어가든 직접 주소를 붙여 넣든 동일합니다. 인증 실패 401, 권한 부족 403, lease 만료 후 AUTH 장애는 503으로 거부하며 성공 응답도 공유 캐시에 저장하지 않습니다.

현재 자동 설치 지원: **Cloudflare Workers Static Assets 또는 Cloudflare Pages의 정적 빌드 결과**. HTML, Vite/React/Vue, CRA의 정적 출력 등입니다. 프로젝트 루트 전체나 소스·비밀 설정 폴더는 배포 대상으로 지정할 수 없습니다. SSR, 별도 API 서버, 기존 Worker 비즈니스 로직, Pages Functions, Next.js 서버, Vercel은 자동 연결 대상이 아닙니다. 미지원 환경에 Embed만 붙이고 보호 완료라고 보고하면 안 됩니다. 다른 서버의 API·R2 공개 URL 등은 이 게이트로 보호되지 않습니다.

## 설치 순서 — Connect 0.7

아래 `https://YOUR-SITE/`를 사용할 실제 HTTPS 사이트 루트로 바꾸세요. 서브경로 설치는 현재 지원하지 않습니다. 기존 서버 설정을 덮어쓰지 않도록 별도 `wrangler.nakwol.json`을 만듭니다.

```bash
npx --yes nakwol-connect init --auth required --access-policy member --url https://YOUR-SITE/
```

사이트를 빌드합니다. 일반적인 Vite 프로젝트는 `npm run build`이고 결과 폴더는 `dist`입니다. 단순 HTML 프로젝트도 배포할 파일만 담은 전용 폴더를 사용하세요. 폴더에는 `index.html`이 필요합니다.

```bash
npx --yes nakwol-connect protect install --provider cloudflare-workers --assets dist --url https://YOUR-SITE/
```

이미 앱이 등록되어 있지만 콜백이 없다면 `nakwol-connect add-url https://YOUR-SITE/`로 먼저 등록합니다. 설치는 `.nakwol/server/`와 `wrangler.nakwol.json`을 생성하고 `.nakwol-connect.json`에 보호 설정을 기록합니다. 브라우저 Embed에도 서버 로그아웃과 루트 콜백을 연결하므로 **설치 후 다시 빌드**합니다.

Cloudflare 로그인 후 해당 Worker에 무작위 32자 이상의 세션 암호화 키를 Secret으로 설정합니다. Discord 봇 토큰이나 OAuth Secret이 아닙니다. 키를 소스·채팅·커밋에 넣지 마세요.

```bash
npx wrangler secret put NAKWOL_SESSION_SECRET --config wrangler.nakwol.json
npx wrangler deploy --config wrangler.nakwol.json
```

처음 생성되는 Worker의 이름은 앱의 client ID입니다. 기존 Worker와 이름이 겹치는지 배포 전에 확인하세요. 배포 및 Secret 입력은 Cloudflare 계정 권한이 필요하며 Connect가 임의로 실행하지 않습니다. 사용자 지정 도메인은 Cloudflare에서 이 Worker에 연결해야 합니다. 설치 시 지정한 사이트 origin 외의 주소는 게이트가 403으로 차단합니다. 과거 공개 배포는 자동 삭제하지 않습니다.

**CI 배포 명령도 반드시 `--config wrangler.nakwol.json`을 사용해야 합니다.** 예전 정적 배포 명령을 그대로 쓰면 보호가 적용되지 않습니다. `assets.run_worker_first=true`가 모든 파일 요청을 게이트로 먼저 보냅니다. [Cloudflare 공식 설정](https://developers.cloudflare.com/workers/static-assets/binding/)

## Cloudflare Pages 정적 빌드

기존 Pages 프로젝트 이름은 AUTH clientId와 다를 수 있습니다. 위 init과 최초 빌드 후 Workers 대신 다음을 사용합니다.

```sh
npx --yes nakwol-connect@0.7.1 protect install --provider cloudflare-pages --project-name YOUR-PAGES-PROJECT --assets dist --url https://YOUR-PAGES-PROJECT.pages.dev/
npm run build
# 최초 설치에서만 서버 Secret 등록. 기존 Secret은 보존합니다.
npx wrangler pages secret put NAKWOL_SESSION_SECRET --project-name YOUR-PAGES-PROJECT
npx wrangler pages deploy dist --project-name YOUR-PAGES-PROJECT --branch YOUR-PRODUCTION-BRANCH
```

생성된 dist/_worker.js와 dist/_routes.json을 함께 배포하고 Pages Functions의 한도 초과 정책을 fail closed로 설정합니다. clean build 후 게이트 파일이 재생성됐는지 확인하세요. 이전 공개 배포 URL은 새 배포만으로 사라지지 않습니다. 아래 검증을 동일하게 수행합니다.

## 검증

```bash
npx --yes nakwol-connect protect verify --url https://YOUR-SITE/ --json
npx --yes nakwol-connect doctor --url https://YOUR-SITE/ --json
```

- 현재 빌드 폴더의 모든 파일과 HTML 경로를 읽어, 쿠키 없이 GET·HEAD·Range 요청 및 잘못된 쿠키 요청을 보냅니다.
- **401/403 + 공식 게이트 응답 + no-store**만 통과합니다. 200·206·302·404·503, 타임아웃은 실패입니다. 로그인 화면이 200으로 나와도 통과하지 않습니다.
- 미설치/설치 파일 변경은 실패합니다. 로컬 검사는 배포 증거가 아닙니다.
- `protectionStatus=configured`는 설치만 완료, `configured-not-verified`는 배포 미검증, `anonymous-blocking-verified`는 **검사한 주소·경로의 비로그인 차단 검증 통과**입니다. 실패 시 CLI 종료 코드는 1입니다.
- `init` 안의 연결 검사가 성공해도 서버 보호 완료가 아닙니다. 일반 `doctor`는 required 사이트에 서버 게이트가 없으면 실패합니다.

이전 주소도 알고 있다면 함께 검사합니다.

```bash
npx --yes nakwol-connect protect verify --url https://YOUR-SITE/ --alternate-origins https://OLD-SITE/,https://PREVIEW-SITE/ --paths /private-route --json
```

검증은 주소를 자동 검색하지 않습니다. 폐쇄한 옛 주소의 404나 DNS 오류도 공식 게이트 차단 성공으로 인정하지 않으므로, 삭제 증거를 별도로 기록하세요. 검사하지 않은 도메인·원본 스토리지·과거 다운로드까지 보호됐다는 뜻은 아닙니다. 과거 배포 주소와 공개 스토리지를 비공개화하거나 제거해야 합니다.

## 실제 사용자 확인도 필요합니다

1. 시크릿 창에서 페이지·JSON·영상 직접 주소가 거부되는지 확인합니다.
2. 시즌3 일반 사용자로 Discord 로그인 후 원래 페이지와 파일이 열리는지 확인합니다.
3. 시즌3 없는 계정에는 권한 부족 안내가 표시되는지 확인합니다.
4. `await window.NAKWOL_CONNECT.logout()` 후 새로고침/파일 요청이 차단되는지 확인합니다. 직접 SDK를 사용하는 별도 로그아웃 구현은 서버 로그아웃 연결도 필요합니다.
5. 앱 비활성/토큰 폐기 후 최대 5분의 기존 lease 만료 뒤 기존 쿠키로 접근할 수 없는지 확인합니다.

로그인 실패/버튼 무반응: 먼저 SDK 요청이 200이며 JavaScript인지, AUTH 주소에 `//sdk/`가 생기지 않았는지 확인하세요. 로그인 실패 반복은 콜백 URL 일치, 사이트 쿠키 허용, Secret 설정, 실제 배포 명령부터 확인하세요. 역할 부족이면 시즌3와 앱의 추가 역할 조건을 확인하고 Discord 인증을 다시 진행합니다. 서버 장애를 이유로 공개 모드로 전환하지 않습니다.

## 봇 없이 동작하는 현재 권한 갱신 한계

현재 AUTH는 Discord OAuth 때 본인의 서버 역할을 조회해 저장합니다. 봇은 로그인에 필요하지 않습니다. 게이트는 세션 생성과 lease 만료 시 **AUTH에 저장된 역할 정보**를 검사하며 Discord를 직접 조회하지 않습니다. 중앙 SSO가 재사용되면 역할이 다시 조회되지 않을 수 있습니다. 중앙 세션은 비활동 10일/절대 30일, 앱 토큰은 1시간입니다. Discord 역할을 방금 제거했다고 즉시 차단되는 구조는 아닙니다. 0.7.1 lease는 중앙 권한 변경 반영에 최대 5분을 추가합니다. 역할 기반 접근은 마지막 Discord 확인 후 24시간이 지나면 재로그인을 요구합니다. 회수는 AUTH 운영자가 사용자 비활성 등 중앙 권한을 회수해야 하며 기존 lease에는 최대 5분 후 반영됩니다. Discord 역할 제거는 OAuth 역할 정보의 24시간에 lease 5분이 더해질 수 있습니다.

## Cloudflare 이외의 호스팅

Vercel·Netlify·자체 서버도 `nakwol-connect/server`의 공식 공통 게이트를 사용합니다. 인증·쿠키·권한·로그인 복귀 로직을 직접 작성하지 않습니다. 각 호스팅은 보호 콘텐츠를 반환하는 함수만 연결합니다. 해당 호스팅의 라우팅 연결은 아직 CLI 자동 생성 대상이 아닙니다. Embed 설치만으로 대체하지 마세요.

GitHub Pages처럼 서버 코드를 실행할 수 없는 정적 호스팅은 공개 파일에 이 게이트를 적용할 수 없습니다. 보호 파일을 Cloudflare Workers/Pages 또는 다른 서버 실행 환경으로 옮기고, 이전 공개 주소도 닫아야 합니다.

### 호스팅 연결이 지켜야 할 계약

- HTML뿐 아니라 JS·JSON·이미지·다운로드·API의 모든 경로와 GET/HEAD/Range가 게이트를 거쳐야 합니다. 원본 스토리지나 미들웨어 제외 경로로 우회할 수 없어야 합니다.
- AUTH SDK로 로그인하고, 등록된 같은 사이트 콜백으로 돌아온 뒤 토큰을 서버 세션으로 교환합니다. 토큰을 URL에 넣지 않습니다.
- 세션은 서버에 보관하거나 인증 암호화(AES-GCM 등)한 쿠키로 보관합니다. 쿠키는 HttpOnly/Secure/SameSite와 만료를 설정하고, 암호화 쿠키는 사이트·앱에 바인딩합니다. 세션 생성/로그아웃 POST는 Origin을 검사합니다.
- 공식 공통 게이트가 최초 세션 교환과 만료 재검증에서 AUTH `/me?client_id=앱ID`를 Bearer 토큰으로 호출하고, 활성 사용자·토큰 만료·앱 정책을 검사합니다. 유효한 5분 lease에서는 로컬 암호학적 검증만 수행합니다. member는 `X-Nakwol-Require-Member: true`를 보내며, 수동 허용은 동일 앱에 대한 응답만 인정합니다. Discord 역할 ID를 사이트에서 별도로 하드코딩하지 않습니다.
- 인증 실패는 401, 권한 부족은 403, 만료된 lease 재검증 중 AUTH 장애는 503으로 차단합니다. 유효 lease는 만료까지 계속 사용합니다. 거부 응답에는 보호 데이터를 넣지 않고 `Cache-Control: private, no-store`와 `X-Nakwol-Gate: v1`을 반환합니다. 헤더만 달았다고 보호되는 것은 아닙니다.
- 공유 캐시는 금지합니다. 조건부 요청/304도 권한 확인 후 처리합니다. 서버 로그아웃은 AUTH 토큰 폐기와 사이트 쿠키 삭제를 연결합니다.
- 로그인 전 같은 사이트의 원래 경로·쿼리·해시를 저장하고, 로그인 성공 후 복원합니다. 외부 주소, 내부 인증 경로, OAuth code/state를 복귀 주소로 사용하지 않습니다.

### 호스팅과 무관한 차단 검사

```bash
npx --yes nakwol-connect protect verify --provider custom --url https://YOUR-SITE/ --paths /,/data.json,/images/private.png,/api/private --json
```

이 모드는 로컬 Connect 설정 없이 실행됩니다. `--expect-runtime 0.7.1`을 추가하면 관측 버전도 검사합니다. `--paths`에는 실제 보호 대상 경로를 열거하세요. 이전 배포 주소는 `--alternate-origins`로 추가합니다. 각 경로에서 GET·HEAD·Range·잘못된 쿠키가 모두 401/403, 게이트 헤더, no-store를 반환해야 통과합니다.

결과의 `inspectionScope=explicit-paths`는 **열거한 경로만 검사했다는 뜻**입니다. 전체 파일, 게이트 내부 암호화, 실제 로그인, 앱 정책 및 권한 회수까지 인증하는 검사는 아닙니다. 공식 설치 구성을 검사하는 `doctor`를 우회하지 않습니다. 공식 `createGate`를 수동 연결한 어댑터는 생성형 설치 메타데이터가 없어 doctor가 미설치로 보고할 수 있습니다. 이 경우 경고를 그대로 기록하고, 어댑터 경로·정책·버전·비로그인 차단·실제 로그인 결과를 별도로 제시하세요.

## 로그인 복귀와 로딩 개선 적용

서버 로그인 화면은 `/?deck=123#detail`을 포함해 원래 주소를 보존하며, OAuth 콜백이 그 주소를 덮어쓰지 않습니다. 유효 lease 동안 정적 자산 요청의 `/me` 호출은 0회입니다. 만료 재검증은 같은 isolate의 single-flight로 합치며 완료 결과를 고정 lease 만료까지 용량 제한 메모리 캐시에 보관합니다. isolate 간 동시 갱신은 각각 호출할 수 있습니다. 정상 자산 요청에 원격 저장소 조회를 추가하지 않습니다. ETag가 있는 파일은 브라우저에서 보관할 수 있지만 매번 게이트를 통과해 로컬 lease 또는 중앙 권한 재검증을 통과해야 합니다. HTML·API/JSON·hashed JS/CSS·이미지·폰트 모두 ETag가 있는 200/304는 `private,no-cache,max-age=0,must-revalidate`, 그 외는 `private,no-store,max-age=0`입니다. positive 브라우저 캐시 TTL이나 immutable을 추가하지 않습니다. 인증 거부 응답은 계속 no-store입니다.

**이미 설치된 사이트의 게이트는 AUTH 배포만으로 교체되지 않습니다.** 0.7.1의 최대 5분 권한 회수 지연을 수용한 뒤 명시적으로 `npx --yes nakwol-connect@0.7.1 protect update`를 실행하고, 사이트를 빌드·배포한 뒤 `protect verify`로 확인하세요. 게이트를 직접 수정했다면 자동 덮어쓰기가 거부되므로 변경 내용을 먼저 비교해야 합니다.

## 공식 공통 게이트와 업데이트

### Workers / Pages: 빌드할 때 최신 게이트 적용

새 `protect install`은 `package.json`에 `nakwol:gate` 스크립트와 빌드 후 갱신 단계를 등록합니다. 기존 build/postbuild 작업은 유지합니다. 빌드 명령이 없는 HTML 프로젝트에는 게이트 생성용 build를 제공합니다.

```bash
npm run build
```

이 과정에서 `npx --yes nakwol-connect@~0.7.1 protect update`가 저장된 앱·역할 정책·배포 주소로 공식 패키지의 게이트를 재생성합니다. 배포 전에 갱신이 실패하면 빌드도 실패하므로 실패를 무시하고 배포하지 마세요. `npm ci --ignore-scripts` 등으로 훅을 비활성화하거나 npm 외 빌드 명령을 쓰면 빌드 후 `npm run nakwol:gate`를 명시적으로 실행하세요. Pages의 clean build로 사라진 `_worker.js`와 `_routes.json`도 복원합니다.

기존 `~0.6.3` 훅은 0.7.1을 자동 적용하지 않습니다. 아래 명령으로 **명시적으로 한 번 전환**하면 이후 0.7.x 패치만 빌드 시 따라갑니다. 0.7.1은 게시되어 있습니다. 다만 로컬 업데이트만으로 운영 반영을 주장하지 않습니다. 이후 게이트 소스를 직접 편집할 필요가 없습니다.

```bash
npx --yes nakwol-connect@0.7.1 protect update
```

빌드한 결과를 기존 배포 경로로 배포하고 `protect verify`를 실행하세요. `runtimeVersion`은 생성에 사용한 공통 게이트 버전입니다. 설치 파일을 직접 수정했다면 자동 갱신은 중단하며 변경 내용을 보존합니다.

### 자체 서버: 공식 API 호출

```js
import { createGate } from 'nakwol-connect/server';

const gate = createGate({
  clientId: 'YOUR_CLIENT_ID',
  accessPolicy: 'member',
  authOrigin: 'https://nakwol-auth.sepsd21.workers.dev',
  siteUrl: 'https://YOUR-SITE/',
});

// 호스팅 어댑터가 Request와 비밀키, 비공개 콘텐츠 핸들러를 전달합니다.
export function handle(request, sessionSecret, serveProtectedContent) {
  return gate(request, { sessionSecret, serveAsset: serveProtectedContent });
}
```

**0.7.1 설정 주의:** `authOrigin`은 위 예시처럼 끝에 `/` 없이 입력하세요. 현재 로그인 스크립트 경로가 문자열로 합쳐지므로 `/`를 붙이면 `//sdk/`가 되어 404로 로그인이 실패합니다. 실제 SDK 로딩까지 확인해야 하며 401 차단 검사만으로는 이 오류를 발견할 수 없습니다. 복수 사이트는 각 콜백을 등록하고 각 배포 origin으로 게이트를 구성하세요.

`serveProtectedContent(request)`는 Web Response를 반환하며, 공통 게이트가 권한을 승인한 경우에만 호출됩니다. 모든 보호 경로와 `/__nakwol/*`를 이 핸들러로 연결하고 원본 파일을 별도로 공개하지 마세요. AUTH OAuth를 따로 구현하지 않습니다.

자체 서버는 `npm install --save-exact nakwol-connect@0.7.1`로 버전을 고정하고 package.json과 lockfile을 함께 검토·커밋합니다. CI는 `npm ci`로 같은 버전을 재현한 뒤 테스트·빌드·배포합니다. 이후 패치 갱신은 기존 의존성 업데이트 PR 흐름에 포함하세요. 실행 중에 원격 JavaScript를 받아 실행하는 구조는 아닙니다.

**공통 로직 수정은 공식 패키지 한 곳에서 합니다. 반영 시점은 각 사이트의 다음 빌드·배포입니다.** 사이트를 재배포하지 않고 이미 실행 중인 서버 코드가 바뀌지는 않습니다. 아직 공식 공통 게이트를 사용하지 않는 자체 구현은 최초 한 번 위 API로 연결해야 합니다.

## 세션과 장애의 경계

서버 세션은 앱 토큰 만료와 생성 후 1시간 중 빠른 시점에 만료됩니다. lease는 중앙 검증 시작부터 고정 5분이며 요청이나 메모리 캐시 조회로 연장되지 않습니다. 잘못된 쿠키, 다른 앱/사이트/정책 쿠키, 만료 세션은 차단합니다. 이전 버전 쿠키는 중앙 검증 후 v2로 교환합니다.

로그아웃은 브라우저 쿠키를 삭제하고 현재 isolate에 토큰 거부를 기록하며 중앙 폐기를 시도합니다. 다른 isolate에서 재생된 쿠키는 최대 5분 후 차단됩니다. AUTH 장애 때 만료된 lease를 재사용하는 fail-open은 없습니다. 이미 다운로드한 자료와 브라우저 뒤로가기 화면을 원격으로 회수하는 기능은 아닙니다.

### 관리형 업데이트 선택

0.7.1부터 `protect automate`로 exact dependency + lockfile + GitHub
업데이트 PR 흐름을 선택할 수 있습니다. 이 모드에서는 위의 범위 기반 빌드 훅
대신 설치된 로컬 CLI를 사용합니다. 설정 후 별도의 npm 잠금 파일 갱신/커밋과
사이트 배포 연결이 필요합니다. [운영 절차](MANAGED_GATE_UPDATES.md)를 따르세요.
