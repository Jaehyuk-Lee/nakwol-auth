# Connect 서버 보호 설치와 차단 검증

## 누가 무엇을 설정하나요?

- AUTH 운영자는 중앙 `member` 기준을 관리합니다. 현재는 낙월 서버 `1493410906456064112`의 **시즌3 역할 `1553600098661957643`만** 멤버입니다. 시즌1·시즌2·Discord 관리자 역할은 대체 조건이 아닙니다.
- 운영자가 `/admin/developers`에서 허가한 개발자는 **본인 앱**의 `member` 또는 `guest` 정책을 선택합니다. `admin` 정책 설정과 추가 역할 관리는 AUTH 운영자 권한이 필요합니다.
- 개발자는 시즌 역할 ID를 복사하지 않습니다. `member`를 선택하면 중앙 기준을 따릅니다. 추가 역할이 설정된 앱은 시즌3와 추가 역할을 모두 요구합니다.
- `guest`도 Discord 로그인이 필요합니다. `auth=optional`은 브라우저 표시 옵션입니다. 중앙 정책이나 서버 보호를 대체하지 않습니다.

## 무엇이 보호되나요?

Embed만 설치하면 브라우저에서 화면을 잠급니다. 이미 전달한 HTML·JS·JSON·이미지·영상·다운로드 파일은 이 방식으로 비공개가 되지 않습니다.

서버 게이트를 배포하면 **자료를 보내기 전에** AUTH `/me`로 토큰·앱·사용자·정책을 확인합니다. 허용된 경우에만 자산을 제공합니다. 허브 링크로 들어가든 직접 주소를 붙여 넣든 동일합니다. 인증 실패 401, 권한 부족 403, AUTH 장애 503으로 거부하며 성공 응답도 공유 캐시에 저장하지 않습니다.

현재 자동 설치 지원: **Cloudflare Workers Static Assets의 정적 빌드 결과**. HTML, Vite/React/Vue, CRA의 정적 출력 등입니다. 프로젝트 루트 전체나 소스·비밀 설정 폴더는 배포 대상으로 지정할 수 없습니다. SSR, 별도 API 서버, 기존 Worker 비즈니스 로직, Pages Functions, Next.js 서버, Vercel은 자동 연결 대상이 아닙니다. 미지원 환경에 Embed만 붙이고 보호 완료라고 보고하면 안 됩니다. 다른 서버의 API·R2 공개 URL 등은 이 게이트로 보호되지 않습니다.

## 설치 순서 — Connect 0.6

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
5. 앱 비활성/토큰 폐기 후 기존 쿠키로 접근할 수 없는지 확인합니다.

로그인 실패 반복: 콜백 URL 일치, 사이트 쿠키 허용, Secret 설정, 실제 배포 명령부터 확인하세요. 역할 부족이면 시즌3와 앱의 추가 역할 조건을 확인하고 Discord 인증을 다시 진행합니다. 서버 장애를 이유로 공개 모드로 전환하지 않습니다.

## 봇 없이 동작하는 현재 권한 갱신 한계

현재 AUTH는 Discord OAuth 때 본인의 서버 역할을 조회해 저장합니다. 봇은 로그인에 필요하지 않습니다. 게이트는 매 요청마다 **AUTH에 저장된 최신 역할 정보**를 검사하며 Discord를 직접 조회하지 않습니다. 중앙 SSO가 재사용되면 역할이 다시 조회되지 않을 수 있습니다. 중앙 세션은 비활동 10일/절대 30일, 앱 토큰은 1시간입니다. Discord 역할을 방금 제거했다고 즉시 차단되는 구조는 아닙니다. 이 기능 추가는 그 갱신 정책을 바꾸지 않습니다. 긴급 회수는 AUTH 운영자가 사용자 비활성 등 중앙 권한을 회수해야 합니다.
