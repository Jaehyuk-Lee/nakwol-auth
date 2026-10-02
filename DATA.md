# NAKWOL DATA

NAKWOL DATA는 NAKWOL AUTH와 분리된 게임 데이터 계층입니다. AUTH는 “누구인가/어떤 앱인가”를 판정하고, DATA는 영구 게임 자산·Registry·덱 데이터를 관리합니다.

## Runtime boundary

```text
NAKWOL AUTH Worker/D1
        │  /me + Connect app ownership verification
        ▼
NAKWOL DATA Worker/D1
        ├─ game accounts
        ├─ Game Registry
        ├─ owned generals / tactics
        ├─ equipment / mounts
        └─ decks / snapshots
```

DATA는 AUTH D1에 직접 접근하지 않습니다.

## Current production golden

- DATA service: `0.8.0`
- DATA schema: `3`
- production Worker Version ID: `2bea00a2-c4b1-4f8c-a521-8c64f18f10be`
- release merge commit: `509b74259891a54adf81cef29a0a3d84f2d01b43`
- deploy trigger commit: `5cfe6c7511be8c2e90d98dfe10d85d7b57f49d61`
- production workflow run: `33051511909`
- production workflow job: `98447911107`
- verification: 70/70 tests, typecheck, Worker bundle, exact D1, schema-3 migration, Registry UPSERT/count gate, production health/schema passed
- Registry production gate: generals 209 / enabled generals 140 / tactics 1077 / equipment templates 134 / stat types 281 / formations 8 / warbooks 442 / canonical skill traits 106 / canonical effect traits 74 / canonical applicability 0
- release record: `docs/releases/2026-08-27-nakwol-data-v0.8.md`

이 기준은 장수 보유(v0.4), 전법 보유(v0.5), 무기·탈것 인스턴스(v0.6), live deck 편집과 불변 snapshot(v0.7), 장비 특기/이펙트 canonical identity와 evidence-gated mutation 및 snapshot trait 동결(v0.8)까지 운영 배포가 검증된 현재 DATA 골든 기준입니다.

## v0.8 production boundary

v0.8.0은 장비 특기/이펙트의 canonical identity와 weapon/mount applicability evidence를 분리하는 schema 3 릴리스입니다.

운영 반영 범위:

- schema `2 -> 3` migration
- 한국 클라이언트 기반 특기 `equipment_skill` 106개 + 이펙트 `equipment_effect` 74개 = canonical identity 180개
- `GET /v1/registry/equipment-traits` — `equipment:read`
- evidence state: `canonical` / `observed` / `unresolved`
- equipment POST/PATCH의 `traits` whole-set mutation 계약
- canonical identity + canonical target-type applicability를 모두 요구하는 write gate
- 잘못된 trait 참조가 하나라도 있으면 기존 trait set을 보존하는 원자성
- equipment read 응답에 trait ID/kind/name/description 포함
- deck snapshot에 당시 trait display state 동결
- generic `stats` 쓰기 계속 차단
- 대량 장비 목록에서 D1 100-bound-parameter 한계를 넘지 않도록 trait read를 100개 단위로 chunk

초기 supplement에는 **canonical applicability가 0개**입니다. 이는 미완성이 아니라 안전 경계입니다. `equipment_skill`/`equipment_effect`의 ID·이름·설명은 authoritative client source로 확정됐지만, 각 항목이 weapon/mount 중 어디에 적용 가능한지를 완전하게 확정하는 별도 근거는 아직 부족합니다. 따라서 production에서 trait mutation 요청은 canonical applicability가 추가되기 전까지 `EQUIPMENT_TRAIT_UNVERIFIED_FOR_TYPE`으로 거부됩니다.

운영 배포는 migration `0003_equipment_options_v08.sql`, v0.2 Registry + v0.8 supplement seed, 106/74/0 특기 count gate, Worker deploy 및 `0.8.0 / schema 3` production smoke까지 통과했습니다. 상세 기록은 `docs/releases/2026-08-27-nakwol-data-v0.8.md`에 남깁니다.

## v0.2 Registry

`nslg-s-season-raw-research-kit-v1`의 확정 카탈로그를 재현 가능한 Seed Source로 사용합니다.

- 장수 209개, 기본 후보 140개
- 전법/스킬 1,077개
- 무기 97개
- 탈것 37개
- 스탯/속성 281개
- 진형 8개
- 병서 442개

승품 재료처럼 authoritative source가 아직 없는 도메인은 임의로 채우지 않습니다.

## v0.3 Connect 자동 연동

개발자가 D1을 직접 수정하지 않습니다.

```bash
npx --yes nakwol-connect init --scopes roster:read,decks:read
npx --yes nakwol-connect doctor --json
```

Connect CLI는 기존 short-lived device CLI token을 DATA control endpoint에 전달합니다. DATA Worker는 그 token을 저장하거나 자체 해석하지 않고 AUTH의 기존 앱 관리 API로 전달하여 해당 개발자가 앱 owner/operator인지 매 요청마다 확인합니다. 검증 성공 후에만 `data_applications`와 `data_application_scopes`를 exact desired state로 UPSERT합니다.

DATA control API:

- `GET /connect/cli/apps/:clientId/scopes`
- `PUT /connect/cli/apps/:clientId/scopes`

지원 scope:

- `profile:read`, `profile:write`
- `roster:read`, `roster:write`
- `equipment:read`, `equipment:write`
- `decks:read`, `decks:write`

## v0.4 사용자 장수 보유 API

- `GET /v1/game-accounts/:accountId/roster/generals` — `roster:read`
- `PUT /v1/game-accounts/:accountId/roster/generals/:generalId` — `roster:write`
- `DELETE /v1/game-accounts/:accountId/roster/generals/:generalId` — `roster:write`

모든 endpoint는 AUTH principal이 실제 소유한 game account만 읽고 쓸 수 있습니다. 새 보유 장수는 `game_generals.enabled=1`인 Registry 항목만 허용합니다. 돌파는 0~5, 승품은 0 이상의 정수로 검증합니다.

## v0.5 사용자 전법 보유 API

- `GET /v1/game-accounts/:accountId/roster/tactics` — `roster:read`
- `PUT /v1/game-accounts/:accountId/roster/tactics/:tacticId` — `roster:write`
- `DELETE /v1/game-accounts/:accountId/roster/tactics/:tacticId` — `roster:write`

보유 가능한 정식 전법은 ID 대역을 추측하지 않고 Registry 메타데이터로 판정합니다.

- `enabled=1`
- `class=5`
- `learn=1`
- `get=3`
- `copy=0`
- `chip>0`
- 어떤 장수의 `unique_tactic_id`로도 참조되지 않음

현재 확정 Seed에서는 이 조건을 만족하는 정식 보유 전법이 146개이고 chip도 146개 모두 1:1로 유일합니다.

## v0.6 사용자 무기·탈것 인스턴스 API

- `GET /v1/game-accounts/:accountId/equipment` — `equipment:read`
- `POST /v1/game-accounts/:accountId/equipment` — `equipment:write`
- `PATCH /v1/game-accounts/:accountId/equipment/:equipmentId` — `equipment:write`
- `DELETE /v1/game-accounts/:accountId/equipment/:equipmentId` — `equipment:write`

장비 ID는 `eqp_...` 형태로 발급합니다. `template_id`는 생성 후 변경할 수 없고 `nickname`, `locked`, `favorite`를 저장합니다. 모든 작업은 AUTH principal이 소유한 game account 내부로 격리됩니다.

v0.6 당시에는 장비 특기 authoritative 사전이 부족해 `stats`/`traits`를 모두 차단했습니다. v0.8에서 특기 identity 근거가 추가됐지만 generic `stats`는 여전히 차단합니다.

## v0.7 덱 편집 API

- `GET /v1/game-accounts/:accountId/decks` — `decks:read`
- `POST /v1/game-accounts/:accountId/decks` — `decks:write`
- `GET /v1/game-accounts/:accountId/decks/:deckId` — `decks:read`
- `PATCH /v1/game-accounts/:accountId/decks/:deckId` — `decks:write`
- `DELETE /v1/game-accounts/:accountId/decks/:deckId` — `decks:write`
- `PUT /v1/game-accounts/:accountId/decks/:deckId/composition` — `decks:write`

composition은 장수 position 1~3, 각 장수 전법 slot 1~2, 같은 game account의 무기·탈것 인스턴스를 한 요청으로 전체 교체합니다. 요청 전체를 먼저 검증하고 D1 batch를 실행하므로 실패 시 기존 구성을 보존합니다.

연구/후보덱은 미보유 장수·전법도 사용할 수 있습니다. 장수는 활성 Registry, 전법은 v0.5 canonical 장착 전법이어야 합니다. 중복 사용 금지 같은 출처 미확정 게임 규칙은 DATA가 임의로 만들지 않습니다.

## v0.7 불변 덱 스냅샷

- `POST /v1/game-accounts/:accountId/decks/:deckId/snapshots` — `decks:write`
- `GET /v1/deck-snapshots` — `decks:read`
- `GET /v1/deck-snapshots/:snapshotId` — `decks:read`

스냅샷은 `dks_...` ID와 `format_version: 1` JSON을 생성하며 account/deck/장수/전법/장비 상태를 생성 시점에 동결합니다. live deck 삭제 시 snapshot은 유지되고 `source_deck_id`만 NULL이 됩니다. `visibility=alliance|public`은 저장 메타데이터이며 현재 list/detail은 owner-only입니다.

## v0.8 장비 특기/이펙트 Registry

Canonical identity source:

- repository: `goyoung2/nslg-warroom`
- path: `viewer/enemy-decks/gear-catalog.json`
- blob SHA: `c1f94bc603be73c7498aa7258ba5b68cb8c32536`
- 원천: 한국 클라이언트 `decompiled_lua/Data/Scenario2001/equipment.lua` + 한국어 번역 테이블
- skill 106 / effect 74 / unresolved 0

Stable ID:

- `ets:<native_id>` — `equipment_skill`
- `ete:<native_id>` — `equipment_effect`

Schema 3은 `game_equipment_traits`에 `native_id`, `kind`, `evidence_state`를 추가하고 `game_equipment_trait_applicability`를 새로 둡니다. Identity가 canonical이라는 사실과 특정 equipment type에 적용 가능하다는 사실은 별도 증거로 관리합니다.

Registry API:

- `GET /v1/registry/equipment-traits` — `equipment:read`

## v0.8 evidence-gated trait mutation

Equipment POST/PATCH에서 다음 shape의 `traits`를 지원합니다.

```json
{
  "traits": [
    { "slot": 1, "trait_id": "ets:56" },
    { "slot": 2, "trait_id": "ete:54" }
  ]
}
```

- slot은 1/2, 최대 2개, slot 중복은 거부합니다.
- 동일 trait ID의 두 슬롯 사용이나 skill/effect 조합 제한은 authoritative 근거가 없어 임의로 금지하지 않습니다.
- identity가 enabled + canonical이어야 합니다.
- 대상 `weapon`/`mount` applicability도 canonical이어야 합니다.
- PATCH에서 traits 생략은 기존값 유지, `traits: []`는 전체 제거입니다.
- 모든 참조를 검증한 뒤 batch로 쓰므로 부분 교체가 없습니다.
- `stats`는 계속 `EQUIPMENT_OPTIONS_UNSUPPORTED`입니다.

새 오류 코드:

- `INVALID_EQUIPMENT_TRAITS`
- `DUPLICATE_EQUIPMENT_TRAIT_SLOT`
- `EQUIPMENT_TRAIT_NOT_FOUND`
- `EQUIPMENT_TRAIT_UNVERIFIED`
- `EQUIPMENT_TRAIT_UNVERIFIED_FOR_TYPE`

## v0.8 snapshot extension

스냅샷의 weapon/mount 객체에 생성 당시 trait의 `slot`, `trait_id`, `kind`, `name`, `description`을 함께 복사합니다. 이후 Registry 명칭이나 live 장비 trait가 변경돼도 기존 snapshot JSON을 다시 조인하거나 계산하지 않습니다.

## 탐방 기록 API (개발 중, schema 4)

설계: [docs/superpowers/specs/2026-10-03-nakwol-data-pull-events-design.md](docs/superpowers/specs/2026-10-03-nakwol-data-pull-events-design.md)

- `GET /v1/game-accounts/:accountId/pull-events?after=&limit=` — `pulls:read`
- `POST /v1/game-accounts/:accountId/pull-events` `{ events }` — `pulls:write`, 기기 UUID로 재전송 중복 방지
- `POST /v1/game-accounts/:accountId/pull-events/edits` `{ ops }` — `pulls:write`, 다음 수정 번호(`rev`)로 수정·삭제, 전부 반영 또는 전부 취소
- `GET /internal/pull-events/changes?after=&limit=` — 집계 서비스 전용, `PULL_FEED_SECRET` Bearer. 변경 전후 기록을 순서대로 제공

DATA는 기록 형식과 한 기록 안의 천장 모순만 검사한다. 천장 카운터는 맹원 기기가 계산한 값이고, 공동 집계와 카드팩 카드 검증은 탐방 통계 서비스가 한다. 운영 배포 전 `PULL_FEED_SECRET`을 DATA와 통계 Worker에 secret으로 설정해야 한다.

## Registry APIs

- `GET /v1/registry/summary`
- `GET /v1/registry/generals`
- `GET /v1/registry/generals?include_hidden=1`
- `GET /v1/registry/tactics`
- `GET /v1/registry/equipment`
- `GET /v1/registry/equipment-traits`
- `GET /v1/registry/stats`
- `GET /v1/registry/formations`
- `GET /v1/registry/warbooks`

## Deployment

Registry seed는 DELETE/TRUNCATE 없이 UPSERT만 수행합니다. v0.8 normal deploy는 기존 exact D1에 `0003_equipment_options_v08.sql` migration을 적용한 뒤 v0.2 Registry와 v0.8 supplement를 함께 seed합니다.

v0.8 production gate는 기존 카운트와 함께 다음을 검증합니다.

- canonical skill traits: 106
- canonical effect traits: 74
- canonical applicability: 0 (초기 supplement 기준)
- health: service `nakwol-data`, version `0.8.0`
- schema: `3`

## Next

1. weapon/mount canonical applicability source 보강 및 검증된 조합 실제 개방
2. 장비 기본 능력치 option subset/수치 범위 authoritative Registry 보강
3. 승품 재료 Registry 보강
4. `deck_settings` 진형/병서 모델과 공개 API 설계
