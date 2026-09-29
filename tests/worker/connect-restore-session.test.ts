import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Connect v1 embed를 최소 가짜 DOM에서 실행한다. document.readyState를 'loading'으로 두어
// SDK를 불러오는 start()는 실행되지 않고, 스크립트가 즉시 결정하는 잠금 여부만 검사한다.
async function runEmbed(storageSeed: Record<string, string>, dataset: Record<string, string> = {}) {
  const source = await readFile(new URL('../../src/assets/nakwol-connect-v1.js.txt', import.meta.url), 'utf8');
  const storage = new Map(Object.entries(storageSeed));
  const events: { type: string; detail: unknown }[] = [];
  const appended: any[] = [];
  const element = () => {
    const attrs = new Map<string, string>();
    return {
      style: { display: '' }, dataset: {}, hidden: false, textContent: '', type: '',
      setAttribute: (k: string, v: string) => attrs.set(k, v),
      hasAttribute: (k: string) => attrs.has(k),
      removeAttribute: (k: string) => attrs.delete(k),
      getAttribute: (k: string) => attrs.get(k) ?? null,
      append: () => {}, appendChild: () => {}, remove: () => {}, addEventListener: () => {},
    };
  };
  const created: ReturnType<typeof element>[] = [];
  let timeoutCallback: (() => void) | undefined;
  const body = element();
  const documentElement = { ...element(), style: { overflow: '' }, appendChild: (node: unknown) => appended.push(node) };
  const window: any = {
    sessionStorage: {
      getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
    },
    dispatchEvent: (event: { type: string; detail: unknown }) => events.push({ type: event.type, detail: event.detail }),
  };
  const document = {
    readyState: 'loading',
    currentScript: { src: 'https://auth.example/connect/v1.js', dataset: { clientId: 'guide', ...dataset } },
    body, documentElement,
    createElement: () => { const node = element(); created.push(node); return node; },
    addEventListener: () => {},
  };
  window.document = document;
  const context = vm.createContext({
    window, document, location: { href: 'https://guide.example/decks/', origin: 'https://guide.example', pathname: '/decks/' },
    CustomEvent: class { type: string; detail: unknown; constructor(type: string, init?: { detail?: unknown }) { this.type = type; this.detail = init?.detail; } },
    URL, JSON, Date, console, setTimeout: (callback: () => void) => { timeoutCallback = callback; return 1; }, clearTimeout: () => {},
  });
  vm.runInContext(source, context);
  return { get cardHidden() { return created[1]?.hidden; }, get cardDisplay() { return created[1]?.style.display; }, triggerTimeout: () => timeoutCallback?.(), events, guardShown: appended.length > 0, bodyLocked: body.hasAttribute('inert'), window, storage };
}

const token = (expiresAt: number) => JSON.stringify({ accessToken: 'app-token', expiresAt });
const verified = (tokenExpiresAt: number) => JSON.stringify({ user: { id: 'u1', display_name: '관우' }, tokenExpiresAt });

test('required Connect reveals immediately when the tab holds a verified session bound to the current token', async () => {
  const expiresAt = Date.now() + 60_000;
  const run = await runEmbed({
    'nakwol.auth.guide.token': token(expiresAt),
    'nakwol.auth.guide.connect_verified_user': verified(expiresAt),
  });
  assert.equal(run.guardShown, false);
  assert.equal(run.bodyLocked, false);
  assert.deepEqual(run.events.map((e) => e.type), ['nakwol-session-restored']);
  assert.equal(run.window.NAKWOL_AUTH_USER.display_name, '관우');
});

test('required Connect still locks without a verified-user cache', async () => {
  const run = await runEmbed({ 'nakwol.auth.guide.token': token(Date.now() + 60_000) });
  assert.equal(run.guardShown, true);
  assert.equal(run.bodyLocked, true);
  assert.deepEqual(run.events, []);
});

test('required Connect still locks when the cache belongs to a different token', async () => {
  const expiresAt = Date.now() + 60_000;
  const run = await runEmbed({
    'nakwol.auth.guide.token': token(expiresAt),
    'nakwol.auth.guide.connect_verified_user': verified(expiresAt - 1),
  });
  assert.equal(run.guardShown, true);
  assert.equal(run.bodyLocked, true);
});

test('required Connect still locks when the token has expired', async () => {
  const expiresAt = Date.now() - 1;
  const run = await runEmbed({
    'nakwol.auth.guide.token': token(expiresAt),
    'nakwol.auth.guide.connect_verified_user': verified(expiresAt),
  });
  assert.equal(run.guardShown, true);
  assert.equal(run.bodyLocked, true);
});

test('restored sessions are still re-verified and re-lock on failure', async () => {
  const src = await readFile(new URL('../../src/assets/nakwol-connect-v1.js.txt', import.meta.url), 'utf8');
  // 복원 여부와 무관하게 SDK bootstrap(/me)과 required 강제는 그대로 실행된다.
  assert.match(src, /const user = await enforceRequiredAuth\(await widget\.ready\)/);
  assert.match(src, /const user = await enforceRequiredAuth\(await client\.bootstrap\(\)\)/);
  // 로그아웃·오류 시 검증 캐시를 지운다.
  assert.match(src, /client\.addEventListener\('logout', \(\) => \{\s*api\.user = null;\s*rememberVerifiedUser\(null\);/);
  assert.match(src, /client\.addEventListener\('error', \(event\) => \{\s*rememberVerifiedUser\(null\);/);
});

test('optional Connect never locks and never restores', async () => {
  const expiresAt = Date.now() + 60_000;
  const run = await runEmbed({
    'nakwol.auth.guide.token': token(expiresAt),
    'nakwol.auth.guide.connect_verified_user': verified(expiresAt),
  }, { auth: 'optional' });
  assert.equal(run.guardShown, false);
  assert.deepEqual(run.events, []);
});

 test('pending Connect guard hides its card while keeping content locked; timeout offers recovery', async () => {
  const run = await runEmbed({});
  assert.equal(run.guardShown, true);
  assert.equal(run.bodyLocked, true);
  assert.equal(run.cardHidden, true);
  assert.equal(run.cardDisplay, 'none');
  run.triggerTimeout();
  assert.equal(run.cardHidden, false);
  assert.equal(run.cardDisplay, 'block');
  assert.equal(run.bodyLocked, true);
});
