# NAKWOL DATA 탐방 기록 (pull events) 설계

작성: 2026-10-03 · 상태: 초안(구현 브랜치 `feature/data-pull-events`)

## 1. 목적

맹원의 탐방(뽑기) 기록 원본을 DATA가 게임 계정 단위로 보관한다. 첫 소비자는 탐방 통계 서비스이며, 이 서비스는 기록을 기기에 먼저 저장한 뒤 맹원이 "제출하기"를 누를 때 DATA로 보낸다. 공동 집계·천장 판정·전광판은 통계 서비스가 DATA의 변경 기록(change feed)을 읽어 따로 만든다. DATA는 집계 로직을 갖지 않는다.

| 책임 | 소유 |
|---|---|
| 맹원별 탐방 원본, 수정·삭제 이력, 기기 간 복원 | DATA |
| 공동 집계, 천장 분석, 공개 전광판, 카드팩 카드 목록 검증 | 탐방 통계 서비스 |

## 2. 경계

- 기록은 `game_accounts` 소유다. 천장 카운터가 게임 계정마다 따로 돌아가므로 사용자 단위가 아니라 계정 단위로 묶는다.
- 사용자 API는 기존 DATA 계약을 따른다: AUTH 앱 토큰 + `X-NAKWOL-CLIENT-ID`, 앱별 scope, 본인 계정만 접근.
- 새 scope: `pulls:read`, `pulls:write`. 기존 앱 권한은 바뀌지 않는다.
- DATA는 기록 형식과 한 기록 안의 모순만 검사한다. 천장 카운터(`pity_before`)는 맹원 기기가 계산한 값을 그대로 저장한다. 카드 이름이 해당 카드팩에 있는지는 통계 서비스가 집계 때 판단한다.
- 삭제는 표시(`deleted=1`)만 하고 원본과 변경 이력을 보존한다. 게임 계정·사용자 삭제로 행이 실제로 지워질 때도 트리거가 `delete` 변경을 남긴다.

## 3. 기록 형식 (format_version 2)

```json
{
  "id": "6f1c…-uuid",            // 기기가 만든 UUID, 소문자로 저장. 재전송 중복 방지 키
  "season": 3,
  "banner": "s3-1",               // ^[a-z0-9][a-z0-9-]{0,39}$
  "observed_at": "2026-10-03T09:00:00.000Z",
  "seq": 12,                      // 기기 기준 배너별 순번(정렬용, 유일성 보장 안 함)
  "rev": 1,                       // 수정 번호. 생성 1, 수정·삭제마다 +1
  "draws": 5,                     // 1 | 5 | 20
  "legendary": 1,
  "officers": 1, "tactics": 0,    // officers + tactics <= legendary
  "heroic": null, "rare": null,   // 둘 다 null 또는 legendary+heroic+rare = draws
  "legend_positions": [3],        // null(모름) 또는 1..draws 오름차순, 길이 = legendary
  "pity_before": 10,              // null(모름) 또는 0..19
  "legendary_items": [{ "kind": "officer", "name": "장춘화", "owned": false }]
}
```

검사 규칙(위반 시 400 `INVALID_PULL_EVENT`):
- `draws=20`이면 `legendary >= 1`.
- `pity_before`가 있으면 천장 규칙과 모순되지 않아야 한다: 전설 0이면 `pity_before + draws < 20`, 위치를 알면 첫 전설 위치 `<= 20 - pity_before`.
- `legendary_items` 길이 `<= legendary`, `kind`는 officer|tactic, `name` 1~40자, `owned`는 생략 또는 boolean.
- 저장 시 `legendary_items`는 (kind, name, owned) 순으로 정렬해 같은 내용이면 같은 JSON이 되게 한다.

## 4. 사용자 API

| 메서드·경로 | scope | 설명 |
|---|---|---|
| `GET /v1/game-accounts/:accountId/pull-events?after=<cursor>&limit=<1..500>` | `pulls:read` | 삭제되지 않은 기록. 생성 순 cursor 페이지. 새 기기 복원용 |
| `POST /v1/game-accounts/:accountId/pull-events` | `pulls:write` | 새 기록 일괄 생성 `{ events: [...] }`, 1~200건 |
| `POST /v1/game-accounts/:accountId/pull-events/edits` | `pulls:write` | 수정·삭제 일괄 `{ ops: [...] }`, 1~200건 |

생성 응답 `{ ok, data: { accepted: [id], duplicate: [id] } }`:
- 같은 id가 없으면 저장(`accepted`).
- 같은 id·같은 내용이거나, 저장된 rev가 보낸 rev보다 크면(이미 수정된 기록의 늦은 재전송) `duplicate`.
- 같은 id인데 내용이 다르면 요청 전체를 취소하고 409 `PULL_EVENT_CONFLICT`. 다른 계정에 같은 id가 있어도 409.

수정 op:
- `{ "op": "replace", "event": {...} }` — `event.rev = 저장된 rev + 1`, `banner`·`seq`는 바꿀 수 없다.
- `{ "op": "delete", "id": "...", "rev": 저장된 rev + 1 }`
- 이미 반영된 op를 다시 보내면 `duplicate`. 번호가 맞지 않으면 409 `PULL_EVENT_REVISION_CONFLICT`, 없는 기록은 404 `PULL_EVENT_NOT_FOUND`, 삭제된 기록의 replace는 409.
- 응답 `{ ok, data: { applied: [id], duplicate: [id] } }`.

모든 일괄 요청은 전부 반영되거나 전부 취소된다(D1 batch 트랜잭션 + revision guard, §6).

## 5. 변경 기록 API (서비스 전용)

`GET /internal/pull-events/changes?after=<cursor>&limit=<1..1000>`

- 인증: `Authorization: Bearer <PULL_FEED_SECRET>`. Worker secret이 없으면 503 `PULL_FEED_DISABLED`. 사용자 앱 토큰으로는 열리지 않는다.
- 통계 Worker는 DATA에 service binding으로 연결해 호출한다. 비밀값은 두 Worker의 secret에만 둔다.
- 응답:

```json
{ "ok": true, "data": {
  "changes": [{
    "cursor": 1042, "event_id": "…", "account_id": "gac_…", "account_nickname": "닉네임",
    "user_id": "…", "rev": 2, "action": "create|replace|delete",
    "event": { … } | null,          // 이 변경 뒤의 기록(delete면 null)
    "previous": { … } | null,       // 이 변경 전의 기록(create면 null)
    "at": 1780000000000
  }],
  "next": 1042
}}
```

- 통계 서비스는 `previous`를 빼고 `event`를 더하는 증분 집계로 한 변경당 일정한 작업만 한다. 처리한 `cursor`를 자기 저장소에 남겨 재시작 후 이어 읽는다.
- 이 API는 읽기 전용이다. 공개 전광판의 맹원 이름은 `account_nickname`을 쓰며, 이름 공개는 통계 서비스가 첫 로그인 때 고지한다.

## 6. 저장 구조 (migration 0008)

- `data_application_scopes`의 scope CHECK에 `pulls:read`, `pulls:write`를 추가한다(SQLite 제약 변경을 위해 표를 다시 만든다).
- `pull_events(id PK, account_id FK→game_accounts ON DELETE CASCADE, user_id, banner, seq, rev, deleted, event_json, observed_at, created_at, updated_at)`
- `pull_event_changes(cursor INTEGER PK AUTOINCREMENT, event_id, account_id, user_id, account_nickname, rev, action, event_json, previous_json, created_at)` — 외래 키 없음. 계정이 지워져도 이력은 남는다.
- `AFTER DELETE ON pull_events` 트리거: 삭제 표시가 없던 행이 실제로 지워지면 `delete` 변경을 남긴다.
- 동시 수정 방지: 수정 batch는 `UPDATE … WHERE id=? AND rev=?` 다음에 `pull_event_guard(ok NOT NULL)`에 `SELECT NULL WHERE changes()=0`을 넣는다. 다른 요청이 먼저 바꿨다면 NOT NULL 위반으로 batch 전체가 취소되고 409를 돌려준다.

## 7. 통계 서비스 연동

1. 앱 등록: `npx --yes nakwol-connect init --auth optional --access-policy member --scopes profile:read,profile:write,pulls:read,pulls:write`. 읽기 공개는 사용자 확정 사항이다.
2. 제출: 기기 → DATA 사용자 API(위 §4). 기존 통계 서비스의 로컬 개발 서버는 같은 경로·형식을 흉내 내어 DATA 배포 전에도 개발한다.
3. 집계: 통계 Worker가 1분 cron과 제출 직후 알림으로 §5를 읽어 Durable Object의 집계를 갱신한다.
4. 게임 계정이 없는 맹원은 통계 서비스에서 닉네임·서버로 계정을 만든다(`profile:write`).

## 8. 하지 않는 것

- DATA 안의 탐방 집계, 확률 판정, 카드팩 카드 목록.
- 전설 획득으로 보유 장수·전법 자동 변경. 이후 별도 기능으로 검토한다.
- 다른 맹원의 기록 조회 API.

## 9. 검증

- scope 거부, 소유자 격리, 생성 중복·충돌 rollback, 늦은 재전송, 수정 번호, 삭제 후 replace 거부, 일괄 rollback.
- 변경 기록: secret 없음/틀림 거부, cursor 이어 읽기, previous/event 정합, 계정 삭제 트리거.
- migration 후 기존 scope 행 보존.
