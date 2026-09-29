import test from 'node:test';
import assert from 'node:assert/strict';
import { createGate, COOKIE } from '../src/server/gate.mjs';

const LEASE = 300000;
const secret = 'lease-fixture-secret-with-more-than-32-characters';
let sequence = 0;
const encoder = new TextEncoder();

async function cookieKey() {
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', encoder.encode(secret)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function unpack(cookie, settings) {
  const [iv, data] = cookie.slice(COOKIE.length + 1).split('.').map(value => Buffer.from(value, 'base64url'));
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(`${new URL(settings.siteUrl).origin}/${settings.clientId}`) }, await cookieKey(), data)));
}
async function pack(value, settings) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(`${new URL(settings.siteUrl).origin}/${settings.clientId}`) }, await cookieKey(), encoder.encode(JSON.stringify(value)));
  return `${COOKIE}=${Buffer.from(iv).toString('base64url')}.${Buffer.from(encrypted).toString('base64url')}`;
}
function fixture(t) {
  const id = ++sequence;
  const settings = { clientId: `lease-${id}`, siteUrl: `https://lease-${id}.test/`, authOrigin: 'https://auth.test', accessPolicy: 'member' };
  const gate = createGate(settings);
  const originalFetch = globalThis.fetch, originalNow = Date.now;
  let now = originalNow(), calls = 0, served = 0, authStatus = 200, delay = 0, elapsedDuringAuth = 0;
  Date.now = () => now;
  t.after(() => { globalThis.fetch = originalFetch; Date.now = originalNow; });
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, settings.authOrigin);
    if (url.pathname === '/logout') return new Response(null, { status: 204 });
    assert.equal(url.pathname, '/me');
    assert.equal(url.searchParams.get('client_id'), settings.clientId);
    assert.equal(init.headers['X-Nakwol-Require-Member'], 'true');
    calls++;
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    now += elapsedDuringAuth;
    if (authStatus !== 200) return new Response(null, { status: authStatus });
    return Response.json({ ok: true, data: { id: `user-${id}`, status: 'active', membership: { is_member: true, checked_at: now } }, application_access: { client_id: settings.clientId, allowed: true, source: 'policy' }, expires_at: now + 7200000 });
  };
  const host = { sessionSecret: secret, serveAsset: async request => {
    served++;
    if (request.headers.get('If-None-Match') === '"fixture"') return new Response(null, { status: 304, headers: { ETag: '"fixture"' } });
    return new Response(request.method === 'HEAD' ? null : 'protected fixture', { status: request.headers.has('Range') ? 206 : 200, headers: { ETag: '"fixture"' } });
  } };
  return {
    settings, host, gate,
    get calls() { return calls; }, get served() { return served; }, get now() { return now; },
    advance(ms) { now += ms; }, fail(status) { authStatus = status; }, delay(ms) { delay = ms; },
    authElapsed(ms) { elapsedDuringAuth = ms; },
    request(path = '/', cookie, options = {}) { return gate(new Request(new URL(path, settings.siteUrl), { ...options, headers: { ...(cookie ? { Cookie: cookie } : {}), ...options.headers } }), host); },
    async login() {
      const response = await gate(new Request(new URL('/__nakwol/session', settings.siteUrl), { method: 'POST', headers: { Origin: new URL(settings.siteUrl).origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: `token-${id}` }) }), host);
      assert.equal(response.status, 204);
      const setCookie = response.headers.get('Set-Cookie');
      for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(setCookie.includes(flag));
      return setCookie.split(';')[0];
    },
  };
}

test('lease: anonymous requests cannot receive any protected asset or conditional response', async t => {
  const f = fixture(t);
  for (const path of ['/', '/image.webp', '/data.json', '/app.js', '/style.css', '/font.woff2', '/download.zip']) {
    for (const options of [{}, { method: 'HEAD' }, { headers: { Range: 'bytes=0-3' } }, { headers: { 'If-None-Match': '"fixture"' } }]) assert.equal((await f.request(path, undefined, options)).status, 401);
  }
  assert.equal(f.served, 0); assert.equal(f.calls, 0);
});

test('lease: invalid, tampered, duplicate and expired cookies fail closed', async t => {
  const f = fixture(t), cookie = await f.login();
  const value = await unpack(cookie, f.settings);
  for (const invalid of [`${COOKIE}=invalid`, cookie.slice(0, -8) + 'AAAAAAAA', `${cookie}; ${cookie}`, await pack({ ...value, expires: f.now - 1 }, f.settings)]) assert.equal((await f.request('/image.webp', invalid)).status, 401);
  assert.equal(f.served, 0);
});

test('lease: client, site origin, AUTH origin and policy bindings cannot be reused', async t => {
  const f = fixture(t), cookie = await f.login();
  for (const change of [{ clientId: 'different-client' }, { siteUrl: 'https://different.test/' }, { authOrigin: 'https://different-auth.test' }, { accessPolicy: 'guest' }]) {
    const settings = { ...f.settings, ...change };
    const response = await createGate(settings)(new Request(settings.siteUrl, { headers: { Cookie: cookie } }), f.host);
    assert.ok([401, 403].includes(response.status));
  }
  assert.equal(f.calls, 1); assert.equal(f.served, 0);
});

test('lease: member cookie authorizes 300 images locally and preserves HEAD Range and 304', async t => {
  const f = fixture(t), cookie = await f.login();
  const responses = await Promise.all(Array.from({ length: 300 }, (_, index) => f.request(`/images/${index}.webp`, cookie)));
  assert.ok(responses.every(response => response.status === 200));
  assert.equal(f.calls, 1, 'only initial authentication may call AUTH');
  assert.equal((await f.request('/data.json', cookie)).status, 200);
  assert.equal((await f.request('/image.webp', cookie, { method: 'HEAD' })).status, 200);
  assert.equal((await f.request('/image.webp', cookie, { headers: { Range: 'bytes=0-3' } })).status, 206);
  const conditional = await f.request('/image.webp', cookie, { headers: { 'If-None-Match': '"fixture"' } });
  assert.equal(conditional.status, 304);
  assert.equal(conditional.headers.get('Cache-Control'), 'private, no-cache, max-age=0, must-revalidate');
  assert.match(conditional.headers.get('Vary'), /Cookie/);
  assert.equal(f.calls, 1);
});

test('lease: expiry coalesces 300 requests and subsequent old-cookie waves without sliding renewal', async t => {
  const f = fixture(t), cookie = await f.login();
  f.advance(LEASE + 1); f.delay(50);
  const responses = await Promise.all(Array.from({ length: 300 }, (_, index) => f.request(`/images/${index}.webp`, cookie)));
  assert.ok(responses.every(response => response.status === 200));
  assert.equal(f.calls, 2, 'one revalidation per session and isolate');
  assert.ok(responses.some(response => response.headers.has('Set-Cookie')), 'refreshed lease reaches browser');
  f.advance(LEASE - 1);
  assert.equal((await f.request('/late.webp', cookie)).status, 200);
  assert.equal(f.calls, 2);
  f.advance(2);
  assert.equal((await f.request('/next.webp', cookie)).status, 200);
  assert.equal(f.calls, 3, 'cache hit must not extend fixed verified time');
});

for (const status of [401, 403, 500]) test(`lease: expired proof and AUTH ${status} never serve assets`, async t => {
  const f = fixture(t), cookie = await f.login();
  f.advance(LEASE + 1); f.fail(status);
  const response = await f.request('/image.webp', cookie);
  assert.equal(response.status, status === 500 ? 503 : status);
  assert.equal(f.served, 0);
  assert.match(response.headers.get('Cache-Control'), /no-store/);
});

test('lease: invalid authenticated authorization claims cannot grant access', async t => {
  const f = fixture(t), cookie = await f.login(), value = await unpack(cookie, f.settings);
  assert.equal(value.version, 2);
  assert.equal(value.authorization.userId.startsWith('user-'), true);
  assert.equal(value.authorization.allowed, true);
  assert.ok(value.authorization.leaseUntil - value.authorization.verifiedAt <= LEASE);
  for (const change of [{ allowed: false }, { userId: '' }, { verifiedAt: f.now + 1000 }, { leaseUntil: f.now + LEASE + 1 }]) {
    const invalid = await pack({ ...value, authorization: { ...value.authorization, ...change } }, f.settings);
    assert.ok([401, 403].includes((await f.request('/data.json', invalid)).status));
  }
  assert.equal(f.served, 0);
});

test('lease: logout clears browser cookie and rejects replay on the same isolate', async t => {
  const f = fixture(t), cookie = await f.login();
  const response = await f.request('/__nakwol/logout', cookie, { method: 'POST', headers: { Origin: new URL(f.settings.siteUrl).origin } });
  assert.equal(response.status, 204);
  assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/);
  assert.equal((await f.request('/image.webp', cookie)).status, 401);
  assert.equal(f.served, 0);
});

test('lease: deployed legacy encrypted session upgrades only after central validation', async t => {
  const f = fixture(t);
  const cookie = await pack({ token: `legacy-${sequence}`, expires: f.now + 3600000 }, f.settings);
  const response = await f.request('/image.webp', cookie);
  assert.equal(response.status, 200); assert.equal(f.calls, 1);
  const upgraded = response.headers.get('Set-Cookie')?.split(';')[0];
  assert.ok(upgraded);
  assert.equal((await unpack(upgraded, f.settings)).version, 2);
  assert.equal((await f.request('/second.webp', upgraded)).status, 200);
  assert.equal(f.calls, 1);
});

test('lease: verification start anchors expiration and AUTH latency cannot extend it', async t => {
  const f = fixture(t), started = f.now;
  f.authElapsed(4000);
  const cookie = await f.login(), value = await unpack(cookie, f.settings);
  assert.equal(value.authorization.verifiedAt, started);
  assert.equal(value.authorization.leaseUntil, started + LEASE);
});

test('lease: valid local proof needs no AUTH availability until its fixed deadline', async t => {
  const f = fixture(t), cookie = await f.login();
  f.fail(500); f.advance(LEASE - 1);
  assert.equal((await f.request('/image.webp', cookie)).status, 200);
  assert.equal(f.calls, 1);
  f.advance(2);
  assert.equal((await f.request('/image.webp', cookie)).status, 503);
  assert.equal(f.served, 1);
});

test('lease: logout during revalidation prevents an in-flight success from restoring access', async t => {
  const f = fixture(t), cookie = await f.login();
  f.advance(LEASE + 1);
  const fetchFixture = globalThis.fetch;
  let release, entered;
  const pending = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  globalThis.fetch = async (input, init) => {
    if (new URL(input).pathname === '/me') { entered(); await pending; }
    return fetchFixture(input, init);
  };
  const asset = f.request('/image.webp', cookie);
  await started;
  const logout = await f.request('/__nakwol/logout', cookie, { method: 'POST', headers: { Origin: new URL(f.settings.siteUrl).origin } });
  assert.equal(logout.status, 204);
  release();
  const response = await asset;
  assert.equal(response.status, 401);
  assert.ok(!response.headers.has('Set-Cookie') || response.headers.get('Set-Cookie').includes('Max-Age=0'));
  assert.equal((await f.request('/after.webp', cookie)).status, 401);
  assert.equal(f.served, 0);
});

test('lease: failed initial member authorization never issues a usable session', async t => {
  const f = fixture(t);
  const fetchFixture = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const response = await fetchFixture(input, init), body = await response.json();
    body.data.membership.is_member = false;
    return Response.json(body);
  };
  const response = await f.request('/__nakwol/session', undefined, { method: 'POST', headers: { Origin: new URL(f.settings.siteUrl).origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: 'non-member' }) });
  assert.equal(response.status, 403);
  assert.ok(!response.headers.has('Set-Cookie') || response.headers.get('Set-Cookie').includes('Max-Age=0'));
  assert.equal(f.served, 0);
});
