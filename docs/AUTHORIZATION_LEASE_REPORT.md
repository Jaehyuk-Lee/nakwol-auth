# 서버 게이트 authorization lease 변경 보고

2026-09-29. Connect 0.7.0 소스 구현·로컬 검증 완료. 운영 배포/npm 발행은 수행하지 않았다.

## 원인과 실행 경로

수정 전 `packages/connect-cli/src/server/gate.mjs`는 콘텐츠 요청마다 `verifyConcurrent`를 호출했다. 동시 진행 중인 `/me`만 합치므로 브라우저의 다음 요청 묶음에서는 다시 중앙 왕복이 발생했다. 쿠키에는 token/expires만 있었으며 복호화 때마다 SHA-256과 CryptoKey import도 반복했다. Workers 생성기는 이 파일을 복사하고 Pages 생성기는 같은 파일을 묶는다. `nakwol-connect/server`도 동일 파일을 export한다.

- 이전: 요청 → 쿠키 복호화 → `/me`(진행 중인 검사만 병합) → ASSETS.
- 변경: 요청 → AES-GCM 복호화 → origin/clientId/AUTH origin/정책/사용자/승인/시각 검증 → ASSETS.
- `/me` 호출: 최초 서버 세션 교환, 고정 5분 lease 만료 후 재검증, 기존 token-only 쿠키의 최초 업그레이드. 유효한 lease의 모든 자산 요청은 0회다.
- 만료 재검증은 isolate별 single-flight와 완료 결과 캐시를 사용한다. 이전 쿠키를 가진 다음 요청 묶음도 같은 고정 만료 결과를 사용하며, 캐시 적중으로 만료가 늘어나지 않는다.
- 메모리에는 최대 256개 진행 중 검사, 512개 완료 결과/로그아웃 거부 기록, 8개 CryptoKey를 보관한다. 진행 중 검사 한도 초과는 503이다. 모든 이미지마다 D1/KV/R2를 조회하지 않는다.

## 보안과 반영 지연

서버 게이트, required/member, 비로그인 직접 접근 차단, GET/HEAD/Range, AES-GCM, HttpOnly/Secure/SameSite=Lax, 앱·사이트 바인딩을 유지한다. 쿠키 승인 정보는 중앙 `/me` 성공 후에만 생성한다. AUTH 응답의 사용자 ID와 동일 앱의 application_access도 검사한다. Discord OAuth 및 비밀값은 브라우저로 옮기지 않는다.

**권한 결과의 재사용 기간이 기존 0초에서 최대 5분으로 늘었다.** 따라서 중앙 사용자 차단, 앱 정책 변경, 수동 허용 철회, 토큰 폐기는 기존 lease에 최대 5분 늦게 반영될 수 있다. 마지막 Discord 조회로부터 24시간이라는 기존 정책에도 최대 5분이 추가될 수 있다. 봇 없이 Discord 역할 변경을 실시간 감지하는 기능은 이번 변경에 없다.

유효한 lease는 AUTH가 장애여도 만료까지 유효하다. 만료 뒤 AUTH 실패는 401/403/503이며 이전 승인으로 계속 제공하지 않는다. 로그아웃은 브라우저 쿠키를 지우고 현재 isolate에 거부 기록을 남긴다. 다른 isolate 또는 거부 기록이 축출된 isolate에서 탈취 쿠키를 재생하면 남은 lease 동안 접근할 수 있다. 이미 다운로드한 콘텐츠는 회수할 수 없다.

isolate 간 메모리는 공유되지 않는다. 만료 때 여러 isolate가 관여하면 각각 검증할 수 있다. 전역 단 한 번을 보장하는 원격 저장소 호출을 hot path에 추가하지 않았다.

## 캐시 조사

| 자산 | 수정 전/후 성공 응답 | 판단 |
| --- | --- | --- |
| HTML | ETag 있는 200/304: private,no-cache,max-age=0,must-revalidate | 새 요청마다 게이트 통과 유지 |
| API/JSON | 위와 동일, ETag 없으면 private,no-store,max-age=0 | 데이터 캐시 수명 확대 없음 |
| hashed JS/CSS | 위와 동일 | immutable/양수 max-age 추가 안 함 |
| 이미지 | 위와 동일 | 재방문 304로 본문 재다운로드 방지 |
| 폰트·다운로드 | 위와 동일 | 확장자 예외 없음 |

공유 캐시는 금지하고 Vary:Cookie를 유지한다. 비로그인 조건부 요청은 304 대신 401이다. 브라우저 재검증 자체는 남지만 중앙 AUTH 왕복은 유효 lease 안에서 제거된다. 이번 측정에서 312개 재방문 응답이 모두 304였으므로 캐시 헤더는 변경하지 않았다.

## Chrome 측정

실제 CLI가 생성한 Workers Static Assets 게이트를 workerd에서 실행하고 Chrome으로 페이지를 열었다. HTML 1, JS 4, CSS 3, JSON 4, 이미지 300: 총 312개 보호 요청. AUTH는 승인된 테스트 사용자 응답에 100ms 지연을 둔 fixture다. localhost HTTP 어댑터를 사용한 통제 실험이며, 제보 사이트의 운영 CDN·실사용 계정 측정은 아니다. 최초 인증의 `/me` 1회는 양쪽 공통이며 아래 콘텐츠 요청 수치에서 제외한다. 이미지 resource timing 300개를 확인했다.

| 지표 | 수정 전 | 수정 후 |
| --- | ---: | ---: |
| 최초 콘텐츠 요청 수 | 312 | 312 |
| 최초 `/me` / 중앙 왕복 | 53 | 0 |
| HTML TTFB | 136.8ms | 28.7ms |
| 이미지 TTFB 평균 | 118.7ms | 17.9ms |
| 이미지 300개 전체 요청 구간 | 6,529.2ms | 1,281.9ms |
| 페이지 load event | 6,710.2ms | 1,376.4ms |
| Worker 내부 인증 경과시간 평균 | 102.94ms | 0.16ms |
| 재방문 `/me` | 53 | 0 |
| 재방문 load event | 6,636.9ms | 1,024.9ms |
| 재방문 304 | 312 | 312 |

Worker 내부 수치는 대기 시간을 포함한 wall clock이며 CPU 시간은 아니다. 개별 파일의 TTFB와 전체 원본 수치는 `docs/benchmarks/*.json`에 보존한다. 별도 workerd 드라이버의 0ms/100ms 지연 비교에서 기존 구조는 약 5.11초가 추가됐고 로컬 lease 구조는 중앙 지연과 무관했다. 정확한 실행별 수치와 재현 명령은 benchmark README를 참고한다.

동시 300개 요청: 기존도 모두 겹치면 1회로 병합됐다. 문제가 된 것은 순차적인 요청 묶음이다. 수정 후 유효 lease에서는 0회, lease를 만료시킨 실제 workerd의 동시 300개 요청에서는 1회였다.

## 검증

- 새 `authorization-lease.test.mjs`: 15개 통과. 익명 모든 자산/GET/HEAD/Range/304, 위변조·중복·만료 쿠키, 다른 앱/origin/AUTH/정책, 정상 member, 300개 로컬 승인, 만료 후 300개 및 후속 요청 묶음, AUTH 실패, 고정 만료, logout 재검증 경합, 구형 쿠키 업그레이드, 초기 권한 거절 포함.
- 기존 공통 API/설치기/Workers·Pages 실제 workerd 테스트: 13개 통과. 이전 ~0.6.3 빌드 훅의 명시적 0.7 전환 테스트도 통과.
- 전체 AUTH/CLI 177개 실행: 176개 통과, 배포 성공 표시를 V06으로 고정한 기존 테스트 1개 실패. V07로 정합성을 수정한 뒤 해당 파일 6개 모두 재검증 통과. 기능 테스트를 제거하거나 약화하지 않았다.
- `protect verify`: 동일 benchmark 자산 전체 1,252개 요청 전/후 모두 통과. 공식 Workers/Pages 생성물 검사도 각각 16개 통과.
- TypeScript `tsc --noEmit`, CLI 패키징, Wrangler `deploy --dry-run` 번들 검사 통과. dry-run은 운영 배포가 아니다.
- 독립 보안 리뷰: 관련 28개 테스트 재현, 차단할 결함 없음.

## 제보 사이트 및 적용

`https://nslgkr-web.nslgkr-web.workers.dev/`에 대한 직접 비로그인 요청은 401 NO_SESSION 및 `nslgkr_session` 삭제 쿠키를 반환했다. HTML Accept 요청은 `/login.html?next=%2F`로 302였다. 공식 게이트의 쿠키/로그인 응답과 다르므로 자체 구현 여부를 소스에서 확인해야 한다. 이 사이트의 인증된 운영 로딩 성능을 측정했거나 수정·배포했다고 주장하지 않는다. 해당 소스 경로를 사용자에게 요청했다.

기존 ~0.6.3 설치는 자동으로 0.7.0을 채택하지 않는다. 발행 후 명시적으로 `nakwol-connect@0.7.0 protect update`, 사이트 빌드·배포·protect verify가 필요하다. AUTH만 배포해서 사이트 코드가 바뀌지 않는다. 자체 구현은 공식 공통 API에 연결해야 이번 개선을 받는다.

## 변경 파일

- Runtime/설치: `packages/connect-cli/src/server/gate.mjs`, `src/protection.mjs`(동일 패키지 내부).
- 테스트: `packages/connect-cli/test/authorization-lease.test.mjs`, `common-gate.test.mjs`, `server-protection.test.mjs`, `server-worker-runtime.test.mjs`; `tests/worker/connect-cli-v03-distribution.test.ts`, `auth-ux-regression.test.ts`.
- 문서: `packages/connect-cli/GATE_SPEC.md`, `README.md`; `docs/SERVER_GATED_AUTH.md`, `CONNECT_SERVER_PROTECTION.md`, 본 보고서 및 `docs/benchmarks/`.
- 버전/배포 정합성: `packages/connect-cli/package.json`, `src/connect-cli-distribution.ts`, `.github/workflows/deploy.yml`, `verify.yml`, `ops/npm-publish.flag`.
- 재현 도구: `packages/connect-cli/benchmark/authorization-lease.mjs`.
