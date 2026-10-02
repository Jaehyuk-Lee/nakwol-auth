# Changelog

## Unreleased

- Add pull (탐방) records owned by a game account: `GET/POST /v1/game-accounts/:accountId/pull-events` and `POST .../pull-events/edits`, under new scopes `pulls:read` / `pulls:write`.
- Creates are idempotent by client UUID; edits and deletes carry the next revision number and apply all-or-nothing. A revision guard aborts an edit batch that lost a race.
- Deletes are soft; an append-only `pull_event_changes` feed (with before/after records) backs `GET /internal/pull-events/changes`, opened only with the `PULL_FEED_SECRET` Worker secret. Hard deletes through account removal still emit a feed delete.
- Migration 0008 rebuilds `data_application_scopes` to admit the new scopes (existing grants copied) and moves DATA to schema 4.
- The test D1 shim now runs `batch()` as a transaction, matching D1.

## 0.9.0 - 2026-08-29

- Add public `GET /openapi.json` with an OpenAPI 3.1 description of every app-facing DATA route.
- Add exact `x-nakwol-scope` metadata to protected operations and document the existing Bearer + `X-NAKWOL-CLIENT-ID` runtime contract.
- Add a route-coverage regression test so new app-facing DATA routes cannot ship without OpenAPI coverage.
- Add `/api/schema` discovery hints for the OpenAPI path/version while keeping DATA schema version 3 and all D1 tables unchanged.
- Keep internal `/connect/cli/` management routes outside the public OpenAPI contract.

## 0.8.0 - 2026-08-27

- Promote 180 Korean-client equipment special-option identities into DATA Registry: 106 `equipment_skill` rows and 74 `equipment_effect` rows with zero unresolved localization entries.
- Add schema 3 evidence model separating canonical trait identity from weapon/mount applicability evidence.
- Add `GET /v1/registry/equipment-traits` under `equipment:read`, exposing identity and applicability evidence independently.
- Add evidence-gated `traits` support to equipment POST/PATCH; writes require both canonical identity and canonical applicability for the target equipment type.
- Preserve atomic whole-trait replacement: all references validate before D1 mutation; PATCH omission preserves traits and `traits: []` clears them.
- Keep duplicate slot invalid while not inventing restrictions on repeated trait IDs or skill/effect combinations without authoritative game evidence.
- Keep generic `stats` writes blocked because the 281 generic stat definitions are not an authoritative equipment-option domain.
- Extend equipment reads with Registry-backed trait display data and freeze trait ID/kind/name/description inside immutable deck snapshots.
- Seed the v0.8 supplement by UPSERT only, preserving existing user-owned rows and all v0.2 Registry counts.
- Initial canonical applicability count is intentionally zero; production trait writes remain closed until authoritative weapon/mount applicability evidence is added.

## 0.7.0 - 2026-08-27

- Add authenticated live-deck list/create/read/update/delete APIs using existing schema-2 deck tables.
- Add atomic whole-composition replacement for up to three general positions and two tactic slots per position.
- Allow planned/research decks to reference enabled Registry generals and canonical equipable tactics even when the account does not own them.
- Reuse the v0.5 canonical tactic predicate and exclude general unique/internal tactic records from equip slots.
- Restrict weapon/mount references to equipment instances owned by the same game account and validate equipment type without inventing duplicate-use rules.
- Add immutable `dks_...` deck snapshots with `format_version: 1` that freeze deck metadata, Registry names, roster breakthrough/promotion state and equipment nickname/locked/favorite state at capture time.
- Keep v0.7 snapshot list/detail owner-only even when snapshot visibility is `alliance` or `public`; cross-user sharing remains deferred.
- Preserve snapshots after live-deck deletion through the existing `source_deck_id ON DELETE SET NULL` behavior.
- Keep DATA schema at version 2; no migration is required.

## 0.6.0 - 2026-08-27

- Add authenticated equipment instance list/create/update/delete APIs on the existing `user_equipment` schema.
- Enforce `equipment:read` for reads and `equipment:write` for mutations.
- Isolate every equipment operation to game accounts owned by the verified AUTH principal.
- Create instances only from enabled weapon/mount Registry templates and generate stable `eqp_...` DATA ids.
- Persist mutable instance state: nickname, locked and favorite; keep `template_id` immutable after creation.
- Explicitly reject `stats` and `traits` writes with `EQUIPMENT_OPTIONS_UNSUPPORTED` until authoritative equipment-option and trait mappings exist.
- Treat `locked` as stored game state only; DATA does not invent a delete prohibition that is not sourced from game rules.
- Keep DATA schema at version 2; no migration is required.

## 0.5.0 - 2026-08-27

- Add authenticated owned-tactic list/upsert/delete APIs on the existing `user_tactics` schema.
- Enforce `roster:read` for reads and `roster:write` for mutations, with game-account ownership isolation.
- Derive canonical user-ownable tactics from authoritative Registry metadata and real chip linkage instead of ID-range heuristics.
- Lock the current Registry invariant at 146 canonical ownable tactic records with 146 unique chip links.
- Reject hidden tactics, chipless internal/content variants, copied variants and tactics referenced as a general's unique tactic.
- Validate tactic breakthrough as 0..5 and keep writes idempotent.
- Keep DATA schema at version 2; no migration is required.

## 0.4.0 - 2026-08-27

- Add authenticated owned-general list/upsert/delete APIs on existing `user_generals` schema.
- Enforce `roster:read` for reads and `roster:write` for mutations.
- Isolate roster access to game accounts owned by the verified AUTH principal.
- Accept only enabled Registry generals for new owned-general records.
- Validate breakthrough as 0..5 and promotion as a non-negative integer.
- Keep DATA schema at version 2; no migration is required.

## 0.3.0 - 2026-08-27

- Add Connect CLI control endpoints for exact DATA scope get/replace.
- Reuse existing Connect CLI device token and AUTH app ownership/operator checks; no new permanent secret.
- Keep DATA schema at version 2.
- Support automated `nakwol-connect init --scopes ...` and online doctor reconciliation.
- Expose browser DATA client through the existing Connect v1 embed.

## 0.2.0 - 2026-08-26

- Import the authoritative S-season research-kit Registry as a reproducible compressed seed.
- Seed 209 generals (140 user-facing), 1,077 tactics, 97 weapons, 37 mounts, 281 stat definitions, 8 formations and 442 warbooks.
- Preserve hidden generals and unresolved unique-tactic native IDs instead of inventing missing links.
- Add schema version 2 with `data_registry_meta`, `game_formations` and `game_warbooks`.
- Add idempotent Registry UPSERT seeding that preserves user-owned roster data.
- Add Registry summary, stats, formations and warbooks endpoints plus optional hidden-general listing.
- Keep promotion items and the complete equipment-trait catalog empty until authoritative source data is supplied.

## 0.1.0 - 2026-08-26

- Create independent `nakwol-data` Worker/D1 foundation.
- Add schema version 1 for game accounts, Registry, permanent roster assets, equipment instances and decks.
- Add AUTH `/me` principal verification and deny-by-default DATA application scopes.
- Add game-account create/list and Registry list foundation routes.
- Add separate bootstrap, deploy and PR verification workflows.
