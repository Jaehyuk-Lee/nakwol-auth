# NAKWOL 공통 서버 게이트 기능 명세

명세 버전: 0.7.0 / 대상: Connect 0.7.0, AUTH의 24시간 역할 재확인 정책.
본 문서는 구현 계약이다. 운영 적용 여부는 배포 기록과 검증 결과로 별도 확인한다.

## 1. 책임과 보호 경계

- AUTH: Discord 로그인, 중앙 세션, 앱 토큰 발급·폐기, 사용자/앱 활성 상태, 정책 및 운영자 수동 허용 판정.
- 공통 게이트: 콘텐츠 전송 전 로컬 authorization lease 검증, 필요 시 AUTH 재확인, 사이트 세션, 로그인 복귀, 거부 응답, 캐시 통제.
- 호스팅 어댑터: 보호 경로 전체와 /__nakwol/*를 게이트로 연결하고 원본 콘텐츠를 비공개로 유지.
- 설치기: 공식 런타임 생성·갱신·버전 기록. 검증기: 지정 배포와 경로의 비로그인 차단 검사.
- 이미 다운로드한 데이터 회수, 모든 외부 원본 자동 발견, Discord 실시간 이벤트 감지는 제공하지 않는다.

## 2. 공개 API

`import { createGate } from 'nakwol-connect/server'`

`createGate({clientId, accessPolicy, authOrigin, siteUrl})`는 async 호환 handler를 반환한다.

| 입력 | 계약 |
| --- | --- |
| clientId | 등록된 앱의 비어 있지 않은 ID |
| accessPolicy | member / guest / admin |
| authOrigin | 인증 서버 HTTPS origin, 사용자 정보·쿼리·해시·서브경로 금지 |
| siteUrl | 등록된 서비스 HTTPS 루트, 동일 제한 |
| handler(request, options) | Web Request를 받아 Promise<Response> 반환 |
| options.sessionSecret | 서버 전용 32자 이상 비밀키, 누락 시 503 |
| options.serveAsset(request) | 승인된 요청만 받으며 Response 또는 Promise<Response> 반환 |

설정 오류는 생성 시 예외. 콘텐츠 핸들러의 예외는 호스팅의 서버 오류로 처리하며 게이트를 우회해 재시도하지 않는다. 브라우저 번들에 서버 API/비밀키를 넣지 않는다.

## 3. 요청 처리와 상태

1. 등록 origin 외의 요청은 403.
2. 비밀키 누락/불량은 503. 쿠키 복호화 실패·중복·만료는 미인증으로 처리.
3. `/__nakwol/session`: 같은 origin의 JSON POST만 수용. 본문 최대 8192 bytes, access_token 문자열 1~2048자. AUTH 승인 후에만 204와 세션 쿠키 발급.
4. `/__nakwol/logout`: 같은 origin POST만 수용. AUTH 토큰 폐기를 시도하고 사이트 쿠키를 삭제. 204의 X-Nakwol-Revoke=confirmed/failed로 원격 폐기 결과 구분. failed는 성공적인 중앙 폐기로 표시하지 않는다.
5. 로그인 경로와 루트 OAuth 콜백은 로그인 bridge로 처리.
6. 콘텐츠는 GET/HEAD만 지원. 다른 메서드는 405. Range도 같은 권한 검사 수행. 쓰기 API의 범용 프록시 기능은 이 버전에 없음.
7. 미인증 401, 권한 거부 403, 중앙 검증이 필요한 요청의 AUTH 통신 오류/시간 초과 503. 이 거부 응답에서는 보호 콘텐츠 핸들러를 호출하지 않음.
8. 승인된 경우에만 콘텐츠 핸들러 호출. 파일 없음 등 콘텐츠 상태는 그대로 전달.

형식/출처 오류는 400/403/413/415, 미지원 메서드는 405. 인증 확인 제한 시간은 7초, 브라우저 세션 교환 대기는 15초.

## 4. 정책과 권한 갱신

- member: 중앙 시즌3 역할 1553600098661957643 및 해당 앱 추가 역할 충족. 시즌1·2나 Discord 관리자 권한은 대체 불가.
- guest: 활성 Discord 로그인 사용자. admin: 활성 AUTH 운영자.
- 운영자의 앱별 수동 허용은 해당 member/guest 앱의 역할 조건만 대체. 사용자/앱 비활성, 재인증 요구, admin/lab 권한을 우회하지 못함.
- 역할 기반 접근은 마지막 Discord 확인으로부터 24시간 미만인 정보만 허용. 누락·미래 시각·24시간 경과는 MEMBERSHIP_REFRESH_REQUIRED로 거부.
- 오래된 SSO로 새 토큰을 발급하지 않음. 직접 로그인하면 Discord OAuth로 역할을 다시 조회. 봇·Discord refresh token 저장은 요구하지 않음.
- guest의 무역할 접근과 명시적 수동 허용은 이 역할 유효기간의 대상이 아님.
- Discord OAuth 역할 정보의 최대 24시간 지연에 게이트 lease가 최대 5분 추가될 수 있다. 운영자 차단/허용 철회/토큰 폐기도 이미 발급된 lease에는 최대 5분 후 반영된다. 진행 중이던 승인 요청과 이미 전달된 데이터는 회수 불가.

## 5. 세션과 실패 복구

- AES-GCM 인증 암호화 쿠키 v2는 origin/clientId 및 AUTH origin/정책에 바인딩하며 사용자 ID, 승인 상태, 검증 시각, lease 만료, 앱 토큰과 세션 만료를 포함한다. __Host- 접두사, Path=/, Secure, HttpOnly, SameSite=Lax.
- 세션 만료는 앱 토큰 만료와 생성 후 1시간 중 빠른 시점. authorization lease는 중앙 검증 시작부터 고정 5분이며 세션 만료를 넘지 않는다. 로컬 요청으로 lease를 연장하지 않는다.
- 최초 세션 교환, lease 만료, 기존 v1 쿠키 업그레이드에서만 `/me`를 호출한다. 유효한 v2 lease의 콘텐츠 요청은 쿠키 복호화·바인딩·승인·시각 검증 후 자산을 제공하며 중앙 네트워크 및 원격 저장소 조회가 없다.
- AUTH 장애 중에도 이미 유효한 lease는 만료까지 사용된다. 만료된 lease 재검증 실패는 503으로 차단하며 오래된 승인으로 대체하지 않는다. 미인증/권한 거부는 401/403이다.
- 로그아웃은 브라우저 쿠키 삭제, 현재 isolate의 용량 제한 토큰 거부 기록, 중앙 토큰 폐기를 수행한다. 다른 isolate 또는 거부 기록이 축출된 isolate에서 재생된 탈취 쿠키에는 최대 5분의 기존 lease가 남을 수 있으며, 중앙 폐기 실패는 X-Nakwol-Revoke=failed로 표시한다.
- 거부된 로그인은 유효한 사이트 쿠키를 발급하지 않고 기존 쿠키를 삭제. 서버 교환 401/403이면 브라우저 SDK의 토큰/사용자 상태와 자동 SSO도 정리.
- 수동 로그인 버튼은 기존 로컬 상태를 정리한 뒤 새 로그인 시작. 권한 부족, 서버 장애, 쿠키 차단 안내와 재시도·계정 복구 링크 제공.
- 60초 안에 반복되는 로그인 복귀 2회 이후에는 자동 리다이렉트를 중단하고 쿠키 안내. 저장소를 사용할 수 없으면 오류 안내; 무한 리다이렉트 금지.
- 복귀 대상은 같은 사이트의 경로·쿼리·해시이며 10분간 유효. 외부/protocol-relative/내부 인증 경로/제어 문자 금지. 콜백이 원래 주소를 덮어쓰지 않음. 유효 대상이 없으면 루트.

## 6. 캐시와 성능

- 거부 응답은 private,no-store,max-age=0; X-Nakwol-Gate:v1, Vary:Cookie, nosniff.
- ETag가 있는 200/304는 private,no-cache,max-age=0,must-revalidate. 그 외는 no-store. 공유 캐시 금지.
- HTML, API/JSON, hashed JS/CSS, 이미지, 폰트, 다운로드 모두 같은 게이트와 캐시 정책을 사용한다. positive max-age나 immutable 브라우저 캐시는 부여하지 않는다.
- 조건부 요청도 유효한 로컬 lease 또는 AUTH 재승인 후에만 304 가능. 로그아웃 후 쿠키 없는 재검증은 거부하며, 중앙 권한 회수는 lease 만료 후 반영된다.
- 같은 바인딩/토큰의 재검증은 isolate 내 single-flight로 합치고, 완료된 결과도 고정 lease 만료까지 용량 제한 메모리 캐시에 보관한다. 오래된 쿠키로 들어온 동시 요청에도 새 승인 쿠키를 발급한다. 실패 후 stale 승인 재사용은 없다.
- isolate 간 메모리는 공유하지 않는다. 여러 isolate의 동시 만료/콜드 시작에서는 각각 AUTH 호출이 발생할 수 있다. 전역 1회 호출을 보장하지 않으며 자산마다 D1/KV/R2를 조회하지 않는다.

## 7. 업데이트, 호환성, 롤백

- 공식 설치: npm 빌드 훅으로 `nakwol-connect@~0.7.0 protect update` 실행. 0.7.x 패치 업데이트를 따라가며 다음 minor/major는 검토 후 명시적 전환.
- 기존 `~0.6.3` 빌드 훅은 0.7.0을 자동 적용하지 않는다. 5분 권한 회수 지연을 검토한 뒤 `npx --yes nakwol-connect@0.7.0 protect update`와 사이트 빌드·배포·검증을 수행한다. AUTH만 배포해서 기존 사이트 게이트가 바뀌지 않는다.
- 기존 공식 설치는 최신 CLI의 protect update로 최초 1회 전환. 자체 호스팅은 공통 API와 패키지 업데이트를 빌드 파이프라인에 연결.
- 앱/정책/주소 보존, 파일 해시 검증, 수정된 설치 파일은 덮어쓰기 거부. Pages clean build의 누락 생성물만 재생성 허용. 실제 사용한 runtimeVersion 기록.
- 빌드/갱신/검증 실패는 새 배포 중단. 실행 중인 정상 배포는 유지. 실행 중 원격 코드를 받아 바꾸지 않음.
- 배포 전에 이전 정상 배포 ID, 소스 commit, runtimeVersion을 기록. 장애 시 호스팅의 이전 정상 배포 복원 또는 보존된 소스/lockfile로 재빌드. 노출됐던 과거 공개 배포를 롤백 대상으로 사용하지 않음.
- 이번 게이트 변경에 DB migration이나 Discord 봇은 필요하지 않다. 0.6.x 롤백 시 v2 쿠키의 로컬 lease를 사용하지 않고 매 요청 중앙 검증으로 돌아간다.

## 8. 필수 합격 기준

| ID | 검증 |
| --- | --- |
| G01 | 비로그인 HTML/JSON/이미지/다운로드, GET/HEAD/Range/잘못된 쿠키가 콘텐츠 없이 401/403 |
| G02 | 정상 member 로그인 성공, 원래 루트 쿼리와 깊은 경로·해시 복귀 |
| G03 | 역할 부족/앱 비활성/사용자 차단 거부, 해당 앱에 한정된 수동 허용 |
| G04 | 거부 뒤 역할 재확인/수동 로그인 가능, 유효 쿠키 및 거부된 SDK 토큰이 남지 않음 |
| G05 | 중앙 AUTH는 역할 확인 24시간 경계에서 거부; 게이트는 기존 lease 만료 뒤 반영, Discord 재확인 후 허용 |
| G06 | 로그아웃 후 쿠키 없는 요청 차단; 중앙 폐기 후 기존 lease 만료 시 기존 쿠키/If-None-Match도 401/403 |
| G07 | 유효 lease는 AUTH 없이 로컬 승인; 만료 후 AUTH 장애·시간 초과는 503이며 보호 콘텐츠 반환 없음 |
| G08 | lease 내 이미지 300개는 `/me` 0회; 동일 isolate 만료 후 동시 300개는 single-flight 재검증; 승인 후에만 304 |
| G09 | 패키지 API import, Workers/Pages 런타임, 빌드 훅 갱신, 수정 파일 보호 |
| G10 | 운영 원본·이전 배포·별도 도메인 목록 확인 및 각 주소 차단/폐쇄 증거 |

protect verify는 열거한 주소·경로만 검증한다. 401/403 + gate header + no-store만 합격; 200/206/302/404/503은 차단 검사 합격이 아니다. 삭제된 주소는 별도 폐쇄 증거로 기록한다. 실사용 OAuth와 호스팅별 라우팅은 운영 검증을 별도로 기록한다.

### 자동 접속 확인 안내

자동 SSO 및 사이트 세션 발급 중에는 `접속 확인 중…`이라는 진행 상태를 표시한다. 확인 결과가 나오기 전에 로그인 필요 문구나 로그인 버튼을 표시하지 않는다. 로그인이 필요하다고 확인되면 로그인 안내를, 권한 부족이나 오류가 확인되면 해당 사유와 복구 수단을 표시한다. 진행 안내는 숨기지 않으며 보호 자산 제공 조건은 변경하지 않는다. 개별 서비스가 자체 작성한 로그인 화면은 해당 서비스의 적용 범위다.

### Runtime version observation and managed updates

Gate responses expose `X-Nakwol-Runtime` in addition to the compatible
`X-Nakwol-Gate: v1` marker. Version observation never authorizes a request and does
not attest all deployed source bytes. Opt-in managed builds must use the exact
installed package matching package.json and the committed npm lockfile. A local
update must not be reported as a verified deployment. `protect verify` preserves
legacy behavior unless `--expect-runtime` is specified; then missing or mismatched
versions fail verification. No secrets or authenticated content appear in version
responses. Managed update PRs require review; no production auto-merge/rollback.
