# 서버 게이트 업데이트 운영

## 제공 범위 (0.7.1 출시 후보)

공식 정적 Workers/Pages 설치와 루트 npm 프로젝트에 적용합니다. 중앙 AUTH,
사이트에 설치한 패키지, 실제 사이트에 배포된 게이트는 각각 다른 상태입니다.
이 문서의 소스 버전은 npm 게시/운영 배포 완료를 뜻하지 않습니다.

## 최초 한 번 설정

기존 공식 게이트가 정상 설치된 사이트에서 새 CLI로 실행합니다.

```sh
npx --yes nakwol-connect@0.7.1 protect automate --environment production
npm install --package-lock-only --ignore-scripts
npm ci
npm run build
npm run nakwol:gate
npm exec -- nakwol-connect protect status --offline --json
```

0.7.1 게시 전에는 이 명령을 운영 사이트에서 실행하지 마세요. 개발 시에는
저장소의 `packages/connect-cli/bin/nakwol-connect.mjs`를 직접 사용합니다.

생성/변경된 package.json, package-lock.json, .nakwol-connect.json, GitHub 설정,
추적 중인 게이트 파일을 검토하여 PR로 커밋합니다. 잠금 파일 생성은 npm이
담당하며 CLI는 임의 integrity 값을 만들지 않습니다. `npm ci`가 잠금 파일과
manifest 불일치를 거부하므로 이 단계가 빠진 설치는 CI를 통과하지 못합니다.

기존 Dependabot/workflow는 덮어쓰지 않습니다. 존재하면 명령은 쓰기 전에
중단합니다. 기존 자동화에 이 문서의 계약을 수동으로 병합해야 합니다.
다른 패키지 관리자/워크스페이스/직접 만든 게이트는 자동 변환하지 않습니다.

## 업데이트 순서

1. 기본 브랜치에 설정을 합치면 Dependabot이 매주 nakwol-connect의 패치
   업데이트만 PR로 제안합니다. `versioning-strategy: increase`로 exact pin을
   갱신하며 package-lock.json 변경도 함께 검토합니다.
2. 읽기 전용 PR CI가 `npm ci`, 사이트 빌드, 공통 게이트 재생성 및 로컬 검사를
   실행합니다. 배포 Secret은 주입하지 않으며 pull_request_target은 쓰지 않습니다.
3. 관리자는 변경 내용과 보안 정책을 확인하고 승인합니다. 자동 병합은 설치하지
   않습니다. minor/major 또는 권한 정책 변경은 별도 명시적으로 검토합니다.
4. 기존 사이트 배포 절차로 배포합니다. 이 도구가 배포 계정을 생성하거나
   Cloudflare Secret을 요청/복사하거나 기존 배포 workflow를 변경하지 않습니다.
5. 배포 시스템이 지정 환경의 성공 `deployment_status` 이벤트를 보내면 해당
   배포 SHA를 checkout해 빌드/검증합니다. 이벤트가 없다면 Actions에서
   `NAKWOL deployed gate verification`을 **실제 배포 commit ref**로 실행합니다.
6. 검증은 프로젝트에 저장된 운영 URL의 빌드 자산 전체에 GET/HEAD/Range/잘못된
   쿠키 차단을 확인하며, X-Nakwol-Runtime 값이 로컬 구성 버전과 같은지도
   검사합니다. 오류는 workflow를 실패시키며 JSON 결과를 실행별 artifact로 남깁니다.

GitHub 저장소에서 Dependabot 및 Actions를 허용해야 합니다. PR check를 필수로
설정하는 branch rules는 운영자가 적용해야 합니다. 별도 GitHub App은 필요 없습니다.
일반 fork PR도 실행되므로 PR job에 배포 자격 증명을 추가하면 안 됩니다.

## 상태 확인

```sh
npm exec -- nakwol-connect protect status --json
npm exec -- nakwol-connect protect verify --expect-runtime installed --json
```

- `not-checked`: 오프라인이거나 로컬 구성이 실패해 운영 조회 안 함.
- `version-match`: 운영 루트 HEAD의 차단 응답과 버전이 로컬 구성과 일치.
- `version-mismatch`: 운영 버전이 다름. 로컬 업데이트를 운영 완료로 표시하지 않음.
- `version-unknown`: 구버전 게이트가 버전을 보고하지 않음. 추정하지 않음.
- `unexpected-response` / `unreachable`: 차단 응답 부적합 또는 연결 실패.

`status`는 루트 HEAD 확인입니다. 전체 보호 검사는 반드시 `protect verify`로
수행합니다. `--expect-runtime` 생략 시 기존 차단 검증 계약을 유지합니다.
직접 만든 게이트는 `--provider custom --paths /,/data.json --expect-runtime 0.7.1`
처럼 예상 버전을 명시할 수 있습니다. 응답 헤더는 관측 정보이며 암호학적 배포
증명이 아닙니다. 계정별 로그인·거부·로그아웃은 실제 브라우저 검증이 필요합니다.

## 실패와 복구

PR 실패는 병합하지 않습니다. 운영 검증 실패는 로그와 artifact를 보존하고
호스팅의 이전 정상 배포로 되돌린 뒤, 그 배포와 일치하는 소스/잠금 파일에서
다시 검증합니다. 이전 공개 Pages 주소 등 우회 경로는 별도 관리합니다.
자동 롤백은 아래의 명시적 Cloudflare 복구 설정 및 배포 job 연동을 사용합니다.

## 관리자 화면과의 경계

결과는 CLI, GitHub Actions, 보고를 연결한 중앙 관리자 페이지에서 확인합니다.
호스팅 연결 버튼과 단계적 트래픽 배포는 현재 제공하지 않습니다.
출시 후보를 운영 완료나 중앙 관리 기능 완성으로 표시하지 않습니다.

## 중앙 배포 현황 보고 (0.7.1)

운영 AUTH에 `0014_gate_reports.sql` migration과 이 버전의 Worker를 배포한 뒤 사용합니다. 이전 AUTH는 새 명령의 API를 제공하지 않습니다. 기존 사이트의 인증·게이트 동작은 보고 설정만으로 바뀌지 않습니다.

1. 앱 소유자 또는 AUTH 운영자가 `nakwol-connect protect report-token --output-file <프로젝트 밖의 파일>`을 실행하고 기존 CLI 연결을 승인합니다. 출력에는 토큰이 나오지 않습니다. 파일 내용을 GitHub **production environment secret** `NAKWOL_GATE_REPORT_TOKEN`에 등록합니다. 이 토큰은 해당 앱 보고만 제출하며 앱 수정·로그인·사용자 권한 부여에는 사용할 수 없습니다. 90일 뒤 만료하고, 재발급하면 이전 토큰은 즉시 무효입니다.
2. 최초 자동화 설치에서 `nakwol-connect protect automate --reports --environment production`을 사용합니다. 기존 workflow가 있으면 자동 덮어쓰지 않으므로 생성 예제와 수동 병합합니다. PR job에는 비밀값이 없습니다. 보고 job은 지정한 GitHub environment를 사용하며 배포 SHA가 기본 브랜치의 이력에 속하는지 확인합니다. environment의 승인자·브랜치 제한도 설정하세요.
3. 개별 CI 연결은 아래처럼 실행합니다. `NAKWOL_REPORT_AUTH_ORIGIN`은 신뢰하는 AUTH origin을 CI 설정에 고정하고, 프로젝트 설정과 일치해야 합니다. 토큰을 명령행에 넣지 않습니다.

```sh
nakwol-connect protect verify --expect-runtime installed --json > deployed.json
# 실패한 검사 결과도 보고하려면 CI의 always 조건에서 다음 단계를 실행합니다.
nakwol-connect protect report --report deployed.json --commit "$DEPLOYED_SHA" --deployment-id "$PROVIDER_DEPLOYMENT_ID" --json
```

`/admin/apps`에서 앱을 선택하면 **서버 보호 배포 현황**에 최근 100건이 표시됩니다. 설치 버전과 실제 응답에서 관측한 버전, 실패 수, 제출 시각, commit/deployment ID가 구분됩니다. 보고가 없으면 미보고로 표시합니다. 토큰 취소는 `protect report-token --revoke`입니다.

이 기록은 인증된 게시자가 제출한 진단입니다. 중앙 서버가 배포 소스나 검사 내용을 증명한 기록이 아닙니다. 사용자 접근 정책에 사용하지 않습니다. 원문 요청 경로·쿠키·토큰·사용자 ID는 전송하지 않으며, 등록된 서비스 origin과 요약만 저장합니다.

## 배포 후 자동 복구

[Cloudflare 복구 설정](DEPLOYMENT_ROLLBACK.md)을 먼저 완료합니다. `protect release-check --deployment-id "$PROVIDER_DEPLOYMENT_ID" --output-file release.json --json`을 **기존 배포 job의 마지막 단계**로 연결합니다. 이 명령은 현재 Cloudflare 배포 ID를 검사 전후 확인하고, 실제 익명 HTTP 2xx 노출이 확인되면 명시한 정상 배포로 롤백한 뒤 다시 검사합니다. 복구가 성공해도 실패한 릴리스를 성공 처리하지 않으므로 종료 코드는 실패입니다.

첫 정상 배포를 기준으로 삼을 때는 같은 명령에 `--baseline`을 붙입니다. 결과 JSON 전체와 `deploymentId`, `expectedRuntime`을 `protection.rollback.previousVerified`에 보관합니다. 검증 대상이 바뀌지 않은 배포만 기준으로 채택하세요. 결과 JSON은 CI artifact로 보관하고, `protect report --report release.json ...`으로 복구 결과까지 보고할 수 있습니다.

`CLOUDFLARE_API_TOKEN`은 해당 서비스 배포 권한만 가진 별도 환경 secret입니다. 모든 배포 경로가 같은 직렬화 규칙을 따라야 하며, CLI는 Cloudflare 콘솔에서 실행한 동시 배포를 원자적으로 잠글 수 없습니다. GitHub job에서만 lock을 잡고 콘솔 배포를 병행하는 구성은 지원하지 않습니다. 자동화 생성기는 이 강한 권한을 임의로 설치하지 않습니다. 기존 배포 job에서 명시적으로 연결해야 합니다.

현재 자동 복구는 Workers/Pages 배포 트래픽만 대상으로 합니다. Vercel/Netlify, DB migration, Secret, 외부 데이터 변경은 복구하지 않습니다. 타임아웃·5xx·버전 불일치만 있는 경우 자동 롤백하지 않습니다. 정상 계정 로그인은 별도로 확인해야 합니다.

## 릴리스 후보 검증

`npm run test:managed`는 실제 tarball을 임시 npm 프로젝트에 설치하고, 고정 lockfile로 `npm ci` → build → 로컬 공통 gate update → TLS 검증을 유지한 로컬 HTTPS 서버의 status/전체 자산 verify를 실행합니다. 공개 npm 게시 전 후보를 검사하기 위해 이 fixture의 lockfile만 로컬 tarball을 가리킵니다. 소비자 프로젝트나 운영 설정을 수정하지 않습니다.
