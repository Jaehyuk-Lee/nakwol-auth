import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import app from '../src/index.ts';
import { createSqliteD1 } from './sqlite-d1.ts';

const file = (name: string) => readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
const base = `${await file('0001_initial.sql')}\n${await file('0002_registry_v02.sql')}\n${await file('0003_equipment_options_v08.sql')}`;
const migration = `${base}\n${await file('0008_pull_events.sql')}`;
const ctx = { waitUntil() {}, passThroughOnException() {} };
const SECRET = 'feed-secret-for-tests';

function setup() {
  const DB = createSqliteD1(migration);
  const env = { DB, AUTH_ORIGIN: 'https://auth.example', PULL_FEED_SECRET: SECRET } as any;
  const now = Date.now();
  for (const user of ['usr_abc', 'usr_other']) DB.raw.prepare('INSERT INTO data_users(id,first_seen_at,last_seen_at) VALUES (?,?,?)').run(user, now, now);
  DB.raw.prepare("INSERT INTO game_accounts(id,user_id,nickname,server_code,is_primary,created_at,updated_at) VALUES ('gac_a','usr_abc','고영','5',1,?,?)").run(now, now);
  DB.raw.prepare("INSERT INTO game_accounts(id,user_id,nickname,server_code,is_primary,created_at,updated_at) VALUES ('gac_b','usr_other','남','5',1,?,?)").run(now, now);
  return { DB, env };
}
function grant(DB: any, ...scopes: string[]) {
  const now = Date.now();
  DB.raw.prepare("INSERT OR IGNORE INTO data_applications(client_id,status,created_at,updated_at) VALUES ('pull-stats','active',?,?)").run(now, now);
  for (const scope of scopes) DB.raw.prepare("INSERT OR IGNORE INTO data_application_scopes(client_id,scope,created_at) VALUES ('pull-stats',?,?)").run(scope, now);
}
async function call(env: any, method: string, path: string, body?: unknown, userId = 'usr_abc') {
  const headers = new Headers({ Authorization: 'Bearer token', 'X-NAKWOL-CLIENT-ID': 'pull-stats' });
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const request = new Request(`https://data.example${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const original = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ ok: true, data: { id: userId, display_name: userId, avatar_url: null, membership: { role: 'member' } } })) as typeof fetch;
  try {
    const response = await (app as any).fetch(request, env, ctx);
    return { status: response.status, body: await response.json() as any };
  } finally { globalThis.fetch = original; }
}
async function feed(env: any, query = '', token = SECRET) {
  const response = await (app as any).fetch(new Request(`https://data.example/internal/pull-events/changes${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }), env, ctx);
  return { status: response.status, body: await response.json() as any };
}
let seq = 0;
const pull = (fields: Record<string, unknown> = {}) => ({
  id: randomUUID(), season: 3, banner: 's3-1', observed_at: new Date().toISOString(), seq: ++seq,
  draws: 5, legendary: 1, officers: 1, tactics: 0, heroic: null, rare: null,
  legend_positions: [3], pity_before: 10, legendary_items: [{ kind: 'officer', name: '장춘화', owned: false }],
  ...fields,
});
const createPath = '/v1/game-accounts/gac_a/pull-events';
const editPath = '/v1/game-accounts/gac_a/pull-events/edits';

test('pull records need pulls scopes and stay inside the owner account', async () => {
  const { DB, env } = setup();
  assert.equal((await call(env, 'POST', createPath, { events: [pull()] })).body.error.code, 'SCOPE_DENIED');
  grant(DB, 'pulls:write', 'pulls:read');
  const other = await call(env, 'POST', '/v1/game-accounts/gac_b/pull-events', { events: [pull()] });
  assert.equal(other.status, 404);
  assert.equal(other.body.error.code, 'GAME_ACCOUNT_NOT_FOUND');
  assert.equal((await call(env, 'GET', '/v1/game-accounts/gac_b/pull-events')).status, 404);
  assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM pull_events').get().n, 0);
});

test('create is idempotent, normalizes card order and rejects changed content as a whole', async () => {
  const { DB, env } = setup();
  grant(DB, 'pulls:write', 'pulls:read');
  const first = pull({ legendary: 2, officers: 2, legend_positions: [2, 4], legendary_items: [{ kind: 'officer', name: '조운' }, { kind: 'officer', name: '관우' }] });
  const second = pull({ legendary: 0, officers: 0, legend_positions: [], pity_before: 3, legendary_items: [] });
  let r = await call(env, 'POST', createPath, { events: [first, second] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data, { accepted: [first.id, second.id], duplicate: [] });
  const stored = JSON.parse(DB.raw.prepare('SELECT event_json FROM pull_events WHERE id = ?').get(first.id).event_json);
  assert.deepEqual(stored.legendary_items.map((card: any) => card.name), ['관우', '조운']);
  assert.equal(stored.rev, 1);
  r = await call(env, 'POST', createPath, { events: [{ ...first, id: first.id.toUpperCase(), legendary_items: [...first.legendary_items].reverse() }] });
  assert.deepEqual(r.body.data, { accepted: [], duplicate: [first.id] });
  const fresh = pull();
  r = await call(env, 'POST', createPath, { events: [fresh, { ...second, pity_before: 4 }] });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'PULL_EVENT_CONFLICT');
  assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM pull_events WHERE id = ?').get(fresh.id).n, 0);
  // The same id under another account is a conflict, not a takeover.
  r = await call(env, 'POST', '/v1/game-accounts/gac_b/pull-events', { events: [second] }, 'usr_other');
  assert.equal(r.status, 409);
});

test('records that break the pity rule or their own counts are refused', async () => {
  const { DB, env } = setup();
  grant(DB, 'pulls:write');
  for (const bad of [
    pull({ legendary: 0, officers: 0, legend_positions: [], legendary_items: [], pity_before: 18 }), // 18 + 5 passes draw 20
    pull({ pity_before: 17, legend_positions: [5] }), // pity forces a legend by card 3
    pull({ legend_positions: [6] }),
    pull({ pity_before: 20 }),
    pull({ draws: 20, legendary: 0, officers: 0, legend_positions: [], legendary_items: [] }),
    pull({ heroic: 1, rare: null }),
    pull({ officers: 1, tactics: 1 }),
    pull({ legendary_items: [{ kind: 'officer', name: '장춘화', owned: 'yes' }] }),
    pull({ banner: 'S3 명장' }),
    pull({ id: 'not-a-uuid' }),
  ]) {
    const r = await call(env, 'POST', createPath, { events: [bad] });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.body.error.code, 'INVALID_PULL_EVENT');
  }
  assert.equal((await call(env, 'POST', createPath, { events: [] })).body.error.code, 'INVALID_PULL_BATCH');
});

test('edits carry the next revision, repeat safely and roll back together', async () => {
  const { DB, env } = setup();
  grant(DB, 'pulls:write', 'pulls:read');
  const a = pull();
  const b = pull({ legendary: 0, officers: 0, legend_positions: [], pity_before: 0, legendary_items: [] });
  await call(env, 'POST', createPath, { events: [a, b] });
  const renamed = { ...a, rev: 2, legendary_items: [{ kind: 'officer', name: '장춘화', owned: true }] };
  let r = await call(env, 'POST', editPath, { ops: [{ op: 'replace', event: renamed }] });
  assert.deepEqual(r.body.data, { applied: [a.id], duplicate: [] });
  assert.deepEqual((await call(env, 'POST', editPath, { ops: [{ op: 'replace', event: renamed }] })).body.data, { applied: [], duplicate: [a.id] });
  r = await call(env, 'POST', editPath, { ops: [{ op: 'replace', event: { ...renamed, legendary_items: [] } }] });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'PULL_EVENT_REVISION_CONFLICT');
  r = await call(env, 'POST', editPath, { ops: [{ op: 'replace', event: { ...renamed, rev: 3, banner: 's3-2' } }] });
  assert.equal(r.body.error.code, 'PULL_EVENT_IMMUTABLE_FIELD');
  // A late retry of the original create is answered as a duplicate.
  assert.deepEqual((await call(env, 'POST', createPath, { events: [a] })).body.data, { accepted: [], duplicate: [a.id] });
  // One bad op cancels the delete before it.
  r = await call(env, 'POST', editPath, { ops: [{ op: 'delete', id: b.id, rev: 2 }, { op: 'replace', event: { ...renamed, rev: 5 } }] });
  assert.equal(r.status, 409);
  assert.equal(DB.raw.prepare('SELECT deleted FROM pull_events WHERE id = ?').get(b.id).deleted, 0);
  // Two ops on one record in a single request apply in order.
  r = await call(env, 'POST', editPath, { ops: [{ op: 'replace', event: { ...renamed, rev: 3, pity_before: 11 } }, { op: 'delete', id: a.id, rev: 4 }] });
  assert.deepEqual(r.body.data, { applied: [a.id, a.id], duplicate: [] });
  assert.deepEqual((await call(env, 'POST', editPath, { ops: [{ op: 'delete', id: a.id, rev: 4 }] })).body.data, { applied: [], duplicate: [a.id] });
  r = await call(env, 'POST', editPath, { ops: [{ op: 'replace', event: { ...renamed, rev: 5 } }] });
  assert.equal(r.body.error.code, 'PULL_EVENT_DELETED');
  r = await call(env, 'POST', editPath, { ops: [{ op: 'delete', id: randomUUID(), rev: 2 }] });
  assert.equal(r.body.error.code, 'PULL_EVENT_NOT_FOUND');
  r = await call(env, 'POST', editPath, { ops: [{ op: 'delete', id: b.id, rev: 2 }] }, 'usr_other');
  assert.equal(r.status, 404);
  const list = await call(env, 'GET', createPath);
  assert.deepEqual(list.body.data.events.map((event: any) => event.id), [b.id]);
});

test('an edit that loses a race to another request changes nothing', async () => {
  const { DB, env } = setup();
  grant(DB, 'pulls:write');
  const a = pull();
  const b = pull({ legendary: 0, officers: 0, legend_positions: [], pity_before: 0, legendary_items: [] });
  await call(env, 'POST', createPath, { events: [a, b] });
  // Another request bumps record a between this request's read and its batch.
  const batch = env.DB.batch.bind(env.DB);
  env.DB.batch = async (statements: any[]) => { DB.raw.prepare('UPDATE pull_events SET rev = 2 WHERE id = ?').run(a.id); env.DB.batch = batch; return batch(statements); };
  const r = await call(env, 'POST', editPath, { ops: [{ op: 'delete', id: b.id, rev: 2 }, { op: 'delete', id: a.id, rev: 2 }] });
  assert.equal(r.status, 409);
  assert.equal(DB.raw.prepare('SELECT deleted FROM pull_events WHERE id = ?').get(b.id).deleted, 0);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM pull_event_changes WHERE action = 'delete'").get().n, 0);
  assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM pull_event_guard').get().n, 0);
});

test('list pages live records in creation order', async () => {
  const { DB, env } = setup();
  grant(DB, 'pulls:write', 'pulls:read');
  const events = [pull(), pull(), pull()];
  await call(env, 'POST', createPath, { events });
  let r = await call(env, 'GET', `${createPath}?limit=2`);
  assert.deepEqual(r.body.data.events.map((event: any) => event.id), [events[0].id, events[1].id]);
  r = await call(env, 'GET', `${createPath}?limit=2&after=${r.body.data.next}`);
  assert.deepEqual(r.body.data.events.map((event: any) => event.id), [events[2].id]);
  assert.equal(r.body.data.next, null);
  assert.equal((await call(env, 'GET', `${createPath}?limit=0`)).status, 400);
});

test('change feed needs the service secret and replays every change with before and after', async () => {
  const { DB, env } = setup();
  grant(DB, 'pulls:write');
  assert.equal((await feed({ ...env, PULL_FEED_SECRET: undefined })).status, 503);
  assert.equal((await feed(env, '', '')).status, 401);
  assert.equal((await feed(env, '', 'wrong')).status, 401);
  const a = pull();
  await call(env, 'POST', createPath, { events: [a] });
  await call(env, 'POST', editPath, { ops: [{ op: 'replace', event: { ...a, rev: 2, pity_before: 12 } }] });
  const b = pull({ legendary: 0, officers: 0, legend_positions: [], pity_before: 0, legendary_items: [] });
  await call(env, 'POST', createPath, { events: [b] });
  let r = await feed(env, '?limit=2');
  assert.equal(r.status, 200);
  const [created, replaced] = r.body.data.changes;
  assert.equal(created.action, 'create');
  assert.equal(created.previous, null);
  assert.equal(created.event.pity_before, 10);
  assert.equal(created.account_nickname, '고영');
  assert.equal(replaced.action, 'replace');
  assert.equal(replaced.rev, 2);
  assert.equal(replaced.previous.pity_before, 10);
  assert.equal(replaced.event.pity_before, 12);
  r = await feed(env, `?after=${r.body.data.next}`);
  assert.deepEqual(r.body.data.changes.map((change: any) => change.event_id), [b.id]);
  // Removing the game account still leaves a delete for each live record.
  DB.raw.prepare("DELETE FROM game_accounts WHERE id = 'gac_a'").run();
  r = await feed(env, `?after=${r.body.data.next}`);
  assert.deepEqual(r.body.data.changes.map((change: any) => [change.action, change.event_id, change.event]).sort(), [['delete', a.id, null], ['delete', b.id, null]].sort());
  assert.ok(r.body.data.changes.every((change: any) => change.previous));
});

test('migration 0008 keeps existing scope grants and accepts the pulls scopes', async () => {
  const DB = createSqliteD1(base);
  const now = Date.now();
  DB.raw.prepare("INSERT INTO data_applications(client_id,status,created_at,updated_at) VALUES ('deck-lab','active',?,?)").run(now, now);
  DB.raw.prepare("INSERT INTO data_application_scopes(client_id,scope,created_at) VALUES ('deck-lab','decks:read',?)").run(now);
  assert.throws(() => DB.raw.prepare("INSERT INTO data_application_scopes(client_id,scope,created_at) VALUES ('deck-lab','pulls:read',?)").run(now));
  DB.raw.exec(await file('0008_pull_events.sql'));
  assert.deepEqual(DB.raw.prepare("SELECT scope FROM data_application_scopes WHERE client_id='deck-lab'").all().map((row: any) => row.scope), ['decks:read']);
  DB.raw.prepare("INSERT INTO data_application_scopes(client_id,scope,created_at) VALUES ('deck-lab','pulls:read',?)").run(now);
  assert.equal(DB.raw.prepare("SELECT value FROM data_schema_meta WHERE key='schema_version'").get().value, '4');
  DB.raw.prepare("DELETE FROM data_applications WHERE client_id='deck-lab'").run();
  assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM data_application_scopes').get().n, 0); // cascade survives the rebuild
});
