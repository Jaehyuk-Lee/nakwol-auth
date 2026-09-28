import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

test('SDK clears denied credentials, suppresses automatic retry and permits explicit fresh login', async () => {
  const base = await readFile(new URL('../../src/assets/nakwol-auth-web-v0.2.0.js.txt', import.meta.url), 'utf8');
  const sdk = await readFile(new URL('../../src/assets/nakwol-auth-web-v0.3.1.js.txt', import.meta.url), 'utf8');
  const values = new Map<string, string>();
  const storage = { getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) };
  let destination = '';
  const location = { href: 'https://site.test/?error=access_denied&state=s', search: '?error=access_denied&state=s',
    assign: (url: string) => { destination = url; }, replace: () => { throw new Error('Automatic redirect must stay suppressed'); } };
  const context = createContext({ window: {}, document: { title: 'Fixture' }, location,
    history: { replaceState: () => { location.href = 'https://site.test/'; location.search = ''; } },
    EventTarget, CustomEvent, URL, URLSearchParams, TextEncoder, crypto, btoa,
    opts: { clientId: 'site', redirectUri: 'https://site.test/', autoSso: true, storage,
      fetchImpl: async () => Response.json({ ok: false, error: { code: 'ACCESS_DENIED' } }, { status: 403 }) } });
  runInContext('globalThis.base = (() => {' + base.replace(/\bexport /g, '')
    + '; return {NakwolAuthClient,NakwolAuthError}; })()', context);
  const executable = sdk.replace(/import \{[\s\S]*?\} from '[^']+';/,
    'const NakwolAuthClientV02=base.NakwolAuthClient; const NakwolAuthError=base.NakwolAuthError;')
    .replace(/export \{[\s\S]*?\};/, '').replace(/\bexport /g, '');
  runInContext(executable + '; globalThis.client = new NakwolAuthClient(opts);', context);
  values.set('nakwol.auth.site.token', JSON.stringify({ accessToken: 'old', expiresAt: Date.now() + 60000 }));
  values.set('nakwol.auth.site.connect_verified_user', '{"id":"old"}');
  await assert.rejects(runInContext('client.bootstrap()', context), { code: 'access_denied' });
  assert.equal(values.has('nakwol.auth.site.token'), false);
  assert.equal(values.has('nakwol.auth.site.connect_verified_user'), false);
  assert.equal(values.get('nakwol.auth.site.sso_suppressed'), '1');
  assert.equal(await runInContext('client.bootstrap()', context), null);
  await runInContext('client.login()', context);
  assert.equal(new URL(destination).searchParams.has('prompt'), false);
  assert.equal(values.has('nakwol.auth.site.sso_suppressed'), false);
  assert.ok(values.has('nakwol.auth.site.transaction'));
  values.set('nakwol.auth.site.token', JSON.stringify({ accessToken: 'old', expiresAt: Date.now() + 60000 }));
  await assert.rejects(runInContext('client.getMe()', context), { code: 'ACCESS_DENIED' });
  assert.equal(values.has('nakwol.auth.site.token'), false);
  assert.equal(values.get('nakwol.auth.site.sso_suppressed'), '1');
});
