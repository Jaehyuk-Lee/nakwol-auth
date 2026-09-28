import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

type CapturedRequest = {
  url: string;
  options: RequestInit;
};

async function bootConnectRuntime() {
  const raw = await readFile(new URL('../../src/assets/nakwol-connect-v1.js.txt', import.meta.url), 'utf8');
  const source = raw.replace(
    'const sdk = await import(`${authOrigin}/sdk/v0.3.2/nakwol-auth-web.js`);',
    'const sdk = __sdk;',
  );
  assert.notEqual(source, raw, 'test harness must replace the runtime SDK import');

  const captured: CapturedRequest[] = [];
  let token: string | null = 'sdk-token';

  class FakeAuthClient {
    constructor(_options: unknown) {}
    getAccessToken() { return token; }
    addEventListener(_name: string, _listener: unknown) {}
    async bootstrap() { return { id: 'usr_sdk_test' }; }
    login() {}
    logout() {}
    getMe() { return { id: 'usr_sdk_test' }; }
    isAuthenticated() { return Boolean(token); }
    isMember() { return true; }
  }

  const sdk = { NakwolAuthClient: FakeAuthClient };
  const windowObject: Record<string, any> = {
    dispatchEvent(_event: unknown) { return true; },
  };
  const documentObject = {
    currentScript: {
      dataset: {
        clientId: 'consumer-sdk-test',
        dataOrigin: 'https://data.example',
        dataScopes: 'profile:read,roster:read,roster:write,equipment:read,equipment:write,decks:read,decks:write',
        ui: 'headless',
        auth: 'optional',
      },
      src: 'https://auth.example/connect/v1.js',
    },
    readyState: 'complete',
    addEventListener() {},
  };
  const locationObject = { origin: 'https://consumer.example', pathname: '/' };
  class FakeCustomEvent {
    constructor(public type: string, public init: unknown) {}
  }

  const fakeFetch = async (input: string | URL | Request, options: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    captured.push({ url, options });
    if (url.endsWith('/decks/dek_fail')) {
      return Response.json(
        { ok: false, error: { code: 'GAME_ACCOUNT_NOT_FOUND', message: 'missing account' } },
        { status: 404 },
      );
    }
    if (url.endsWith('/openapi.json')) {
      return Response.json({ openapi: '3.1.0' });
    }
    return Response.json({ ok: true, data: { url } });
  };

  const execute = new Function(
    '__sdk', 'window', 'document', 'location', 'CustomEvent', 'fetch', 'Headers',
    source,
  );
  execute(sdk, windowObject, documentObject, locationObject, FakeCustomEvent, fakeFetch, Headers);

  for (let i = 0; i < 20 && !windowObject.NAKWOL_CONNECT; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.ok(windowObject.NAKWOL_CONNECT, 'Connect runtime should bootstrap');

  return {
    data: windowObject.NAKWOL_CONNECT.data,
    captured,
    setToken(value: string | null) { token = value; },
  };
}

function expectNamespace(data: any) {
  const methods = [
    data.accounts?.list,
    data.accounts?.create,
    data.roster?.generals?.list,
    data.roster?.generals?.upsert,
    data.roster?.generals?.remove,
    data.roster?.tactics?.list,
    data.roster?.tactics?.upsert,
    data.roster?.tactics?.remove,
    data.equipment?.list,
    data.equipment?.create,
    data.equipment?.update,
    data.equipment?.remove,
    data.decks?.list,
    data.decks?.get,
    data.decks?.create,
    data.decks?.update,
    data.decks?.replaceComposition,
    data.decks?.remove,
    data.snapshots?.list,
    data.snapshots?.get,
    data.snapshots?.create,
    data.registry?.summary,
    data.registry?.generals,
    data.registry?.tactics,
    data.registry?.equipment,
    data.registry?.equipmentTraits,
    data.registry?.stats,
    data.registry?.formations,
    data.registry?.warbooks,
  ];
  for (const method of methods) assert.equal(typeof method, 'function');
  assert.equal(data.accounts.update, undefined, 'SDK must not invent account PATCH');
  assert.equal(data.accounts.remove, undefined, 'SDK must not invent account DELETE');
}

async function expectRequest(
  runtime: Awaited<ReturnType<typeof bootConnectRuntime>>,
  invoke: () => Promise<unknown>,
  expectedPath: string,
  expectedMethod = 'GET',
  expectedBody?: unknown,
) {
  runtime.captured.length = 0;
  await invoke();
  assert.equal(runtime.captured.length, 1);
  const request = runtime.captured[0];
  assert.equal(request.url, `https://data.example${expectedPath}`);
  assert.equal(request.options.method ?? 'GET', expectedMethod);
  const headers = new Headers(request.options.headers);
  assert.equal(headers.get('Authorization'), 'Bearer sdk-token');
  assert.equal(headers.get('X-NAKWOL-CLIENT-ID'), 'consumer-sdk-test');
  if (expectedBody === undefined) {
    assert.equal(request.options.body, undefined);
  } else {
    assert.equal(headers.get('Content-Type'), 'application/json');
    assert.deepEqual(JSON.parse(String(request.options.body)), expectedBody);
  }
}

test('high-level Data SDK exposes the planned namespaces without inventing unsupported account mutations', async () => {
  const runtime = await bootConnectRuntime();
  expectNamespace(runtime.data);
  assert.equal(typeof runtime.data.request, 'function');
  assert.equal(typeof runtime.data.fetch, 'function');
  assert.equal(typeof runtime.data.openapi, 'function');
  assert.equal(typeof runtime.data.describe, 'function');
});

test('high-level Data SDK maps account, roster, equipment, deck and snapshot methods to the production HTTP contract', async () => {
  const runtime = await bootConnectRuntime();
  const { data } = runtime;
  const accountId = 'gac/a b';
  const generalId = 'general:한/글';
  const tacticId = 't:20/010';
  const equipmentId = 'eqp/a b';
  const deckId = 'dek/a b';
  const snapshotId = 'dks/a b';
  const account = encodeURIComponent(accountId);
  const general = encodeURIComponent(generalId);
  const tactic = encodeURIComponent(tacticId);
  const equipment = encodeURIComponent(equipmentId);
  const deck = encodeURIComponent(deckId);
  const snapshot = encodeURIComponent(snapshotId);

  await expectRequest(runtime, () => data.accounts.list(), '/v1/game-accounts');
  await expectRequest(runtime, () => data.accounts.create({ nickname: '테스트', server_code: '5' }), '/v1/game-accounts', 'POST', { nickname: '테스트', server_code: '5' });

  await expectRequest(runtime, () => data.roster.generals.list(accountId), `/v1/game-accounts/${account}/roster/generals`);
  await expectRequest(runtime, () => data.roster.generals.upsert(accountId, generalId, { breakthrough: 5 }), `/v1/game-accounts/${account}/roster/generals/${general}`, 'PUT', { breakthrough: 5 });
  await expectRequest(runtime, () => data.roster.generals.remove(accountId, generalId), `/v1/game-accounts/${account}/roster/generals/${general}`, 'DELETE');

  await expectRequest(runtime, () => data.roster.tactics.list(accountId), `/v1/game-accounts/${account}/roster/tactics`);
  await expectRequest(runtime, () => data.roster.tactics.upsert(accountId, tacticId, { breakthrough: 3 }), `/v1/game-accounts/${account}/roster/tactics/${tactic}`, 'PUT', { breakthrough: 3 });
  await expectRequest(runtime, () => data.roster.tactics.remove(accountId, tacticId), `/v1/game-accounts/${account}/roster/tactics/${tactic}`, 'DELETE');

  await expectRequest(runtime, () => data.equipment.list(accountId), `/v1/game-accounts/${account}/equipment`);
  await expectRequest(runtime, () => data.equipment.create(accountId, { template_id: 'weapon:1' }), `/v1/game-accounts/${account}/equipment`, 'POST', { template_id: 'weapon:1' });
  await expectRequest(runtime, () => data.equipment.update(accountId, equipmentId, { favorite: true }), `/v1/game-accounts/${account}/equipment/${equipment}`, 'PATCH', { favorite: true });
  await expectRequest(runtime, () => data.equipment.remove(accountId, equipmentId), `/v1/game-accounts/${account}/equipment/${equipment}`, 'DELETE');

  await expectRequest(runtime, () => data.decks.list(accountId), `/v1/game-accounts/${account}/decks`);
  await expectRequest(runtime, () => data.decks.get(accountId, deckId), `/v1/game-accounts/${account}/decks/${deck}`);
  await expectRequest(runtime, () => data.decks.create(accountId, { name: '주력덱' }), `/v1/game-accounts/${account}/decks`, 'POST', { name: '주력덱' });
  await expectRequest(runtime, () => data.decks.update(accountId, deckId, { name: '수정덱' }), `/v1/game-accounts/${account}/decks/${deck}`, 'PATCH', { name: '수정덱' });
  const composition = { generals: [{ position: 1, general_id: 'general:1', tactics: [] }] };
  await expectRequest(runtime, () => data.decks.replaceComposition(accountId, deckId, composition), `/v1/game-accounts/${account}/decks/${deck}/composition`, 'PUT', composition);
  await expectRequest(runtime, () => data.decks.remove(accountId, deckId), `/v1/game-accounts/${account}/decks/${deck}`, 'DELETE');

  await expectRequest(runtime, () => data.snapshots.list(), '/v1/deck-snapshots');
  await expectRequest(runtime, () => data.snapshots.get(snapshotId), `/v1/deck-snapshots/${snapshot}`);
  await expectRequest(runtime, () => data.snapshots.create(accountId, deckId, { visibility: 'alliance' }), `/v1/game-accounts/${account}/decks/${deck}/snapshots`, 'POST', { visibility: 'alliance' });
});

test('high-level Data SDK keeps Registry helpers compatible and adds equipmentTraits', async () => {
  const runtime = await bootConnectRuntime();
  const { data } = runtime;
  await expectRequest(runtime, () => data.registry.summary(), '/v1/registry/summary');
  await expectRequest(runtime, () => data.registry.generals(), '/v1/registry/generals');
  await expectRequest(runtime, () => data.registry.generals({ includeHidden: true }), '/v1/registry/generals?include_hidden=1');
  await expectRequest(runtime, () => data.registry.tactics(), '/v1/registry/tactics');
  await expectRequest(runtime, () => data.registry.equipment(), '/v1/registry/equipment');
  await expectRequest(runtime, () => data.registry.equipmentTraits(), '/v1/registry/equipment-traits');
  await expectRequest(runtime, () => data.registry.stats(), '/v1/registry/stats');
  await expectRequest(runtime, () => data.registry.formations(), '/v1/registry/formations');
  await expectRequest(runtime, () => data.registry.warbooks(), '/v1/registry/warbooks');
});

test('high-level Data SDK preserves NakwolDataError details and low-level authentication behavior', async () => {
  const runtime = await bootConnectRuntime();
  await assert.rejects(
    () => runtime.data.decks.get('gac_test', 'dek_fail'),
    (error: any) => {
      assert.equal(error.name, 'NakwolDataError');
      assert.equal(error.code, 'GAME_ACCOUNT_NOT_FOUND');
      assert.equal(error.status, 404);
      assert.equal(error.payload.error.message, 'missing account');
      return true;
    },
  );

  runtime.setToken(null);
  await assert.rejects(
    () => runtime.data.accounts.list(),
    (error: any) => {
      assert.equal(error.name, 'NakwolDataError');
      assert.equal(error.code, 'NAKWOL_DATA_UNAUTHENTICATED');
      assert.equal(error.status, 401);
      return true;
    },
  );
});
