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
자동 롤백은 호스팅별 권한/배포 ID가 필요하므로 이번 버전에는 제공하지 않습니다.

## 관리자 화면과의 경계

현재 결과는 CLI와 GitHub Actions에서 확인합니다. 중앙 관리자 페이지의 사이트별
버전/검증 이력 수집 API, 배포 연결 버튼, 단계적 배포와 자동 롤백은 후속 기능입니다.
출시 후보를 운영 완료나 중앙 관리 기능 완성으로 표시하지 않습니다.
