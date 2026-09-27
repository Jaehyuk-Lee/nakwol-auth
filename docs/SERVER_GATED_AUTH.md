# 시즌3 멤버와 서버 접근 제어

## 권한 계약

- Discord 서버: `1493410906456064112`.
- `member`: 시즌3 역할 `1553600098661957643` 보유자만. 다른 시즌, 기존 맹원, Discord 관리자, AUTH 운영자 권한은 대체 조건이 아니다.
- `guest`: 활성 Discord 로그인 사용자. `admin`: 활성 AUTH 운영자(`auth_operators`).
- 앱별 추가 역할은 시즌3와 함께 **모두** 충족해야 한다. 추가 역할 설정이 있으면 guest/admin 정책으로 변경해도 시즌3 검사를 건너뛰지 않는다.
- 빈 멤버 역할 설정은 거부한다. 역할 설정 오류, Discord 장애, 시간 초과, HTTP 429는 과거 허용 기록으로 대체하지 않는다.

## 실제 요청 경로

1. `/authorize`(중앙 SSO 포함), OAuth 콜백, `/token` 교환, `/me`에서 앱 정책을 확인한다.
2. member 판정은 Discord 사용자 ID를 AUTH identity에서 조회하고, 봇 인증으로 `GET /guilds/{guild}/members/{user}`를 호출한다. 과거 membership 및 관리자 role 값으로 허용하지 않는다.
3. 현재 역할을 membership에 기록한다. 이 기록은 조회 정보이며 다음 접근 판정은 다시 Discord를 확인한다.
4. `/me`는 앱에 묶인 토큰의 만료·폐기, 앱 활성 상태, 사용자 활성 상태를 검사한다. 성공 응답은 `{ ok: true, data: user, expires_at: <Unix ms> }`이다.
5. 서버 소비자는 `X-Nakwol-Require-Member: true`를 보내 시즌3 조건을 추가 강제할 수 있다. 이 헤더는 기존 앱 권한을 완화하지 않는다.
6. 포털은 모든 보호 요청마다 `/me`를 호출하고, 성공한 뒤에만 정적 파일을 전달한다. 포털 쿠키는 앱 토큰을 암호화해 보관하며 토큰 만료보다 길게 유지하지 않는다.

역할 제거가 Discord 조회에 반영되면 **다음 서버 요청부터 기존 토큰·쿠키도 거부**된다. 이미 다운로드한 문서·파일을 회수하는 기능은 아니다. 긍정 결과 캐시가 없으므로 Discord 요청 제한 시 접근이 일시 중단될 수 있다. 허용을 캐시하는 변경은 이 계약을 변경하므로 별도 검토가 필요하다.

## 역할 관리

`/admin/apps`의 역할 관리 링크 → `/admin/roles`에서 실제 Discord 역할 목록을 불러오고 앱별 추가 역할을 선택한다. Discord 역할의 생성·사용자에게 부여·회수는 Discord에서 한다. 이 화면은 사이트 접근 조건을 관리한다.

- `/admin/api/roles` GET: 활성 AUTH 운영자와 관리자 앱 토큰 필요.
- `/admin/api/roles` POST 또는 `/admin/roles` POST: 동일 Origin JSON, member 앱만 편집 가능.
- 입력: `{ "client_id": "nakwol-guide", "role_ids": ["추가 역할 ID"] }`. 빈 배열은 시즌3만 요구한다.
- 존재하지 않는 역할, `@everyone`, 잘못된 ID, 25개 초과 목록은 거부한다.
- 변경은 `application.roles.updated` 감사 이벤트에 남긴다.

## 운영 적용 선행 조건

이 문서는 배포 완료 기록이 아니다. 현재 변경은 로컬 개발본이다.

1. AUTH 봇을 위 Discord 서버에 가입시키고 `DISCORD_BOT_TOKEN`을 Worker secret으로 설정한다. 토큰은 파일·PR·대화에 기록하지 않는다. 봇의 관리자/역할 관리 권한은 이 읽기 기능에 필요하지 않다.
2. 배포 환경의 `NAKWOL_GUILD_ID`와 `NAKWOL_MEMBER_ROLE_ID`가 위 값인지 확인한다. 예전 동일 이름 Secret 또는 환경별 설정이 있다면 기존 맹원 ID가 적용되지 않도록 정리한다. 저장소 `wrangler.jsonc`에 비밀이 아닌 두 ID를 명시했다.
3. migrations `0011_season_roles.sql`, `0012_membership_role_ids.sql` 적용이 필요하다. 0012는 기존 membership의 역할 스냅샷을 비멤버로 초기화한다. 사용자/중앙 세션/토큰을 삭제하지 않으며 다음 판정에서 현재 Discord 역할을 읽는다.
4. AUTH는 기존 `dev → main → stable` 승격 절차로 먼저 배포한다. 봇이 준비되지 않은 채 배포하면 member 앱은 접근 불가 상태가 된다. 기존 member 앱 모두 새 시즌3 기준의 영향을 받는다.
5. 포털에 암호학적으로 임의 생성한 `SESSION_SECRET`을 설정하고 서버 게이트를 배포한다. 포털 저장소의 `docs/CONTRACTS.md`와 `docs/DECISIONS.md`의 서버 게이트 계약을 따른다.
6. 운영 브라우저에서 시즌3만 가진 계정 허용 → 역할 제거 → 같은 쿠키의 다음 HTML/JSON/영상 요청 거부를 확인한다. 비맹원, 다른 역할만 있는 운영자, 토큰 폐기, 직접 파일 URL도 확인한다.
7. 운영 캐시/별도 배포 주소에 보호 이전 자료가 남지 않도록 배포 설정을 확인한다. 배포 장애를 이유로 서버 게이트를 우회하는 공개 모드로 되돌리지 않는다.

## 로컬 검증

- `npm run typecheck`
- `npm test`
- `tests/worker/season-access.test.ts`: 실제 Miniflare D1 + 제어된 Discord 응답으로 동일 토큰의 역할 회수, SSO, 코드 교환, 추가 역할, 장애/폐기/비활성 검증.
- `tests/worker/role-settings.test.ts`: SQLite + Hono API 요청으로 운영자 권한, 역할 저장, 감사 기록, 입력/Origin 검증.
- 실제 Discord 계정의 역할 변경 검증은 위 테스트가 대신하지 않는다.
