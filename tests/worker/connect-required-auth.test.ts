import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Connect v1 is protected by default and supports explicit optional mode', async () => {
  const src = await readFile(new URL('../../src/assets/nakwol-connect-v1.js.txt', import.meta.url), 'utf8');

  assert.match(src, /script\.dataset\.auth \|\| 'required'/);
  assert.match(src, /\['required', 'optional'\]\.includes\(authMode\)/);
  assert.match(src, /const authRequired = authMode === 'required'/);
  assert.match(src, /data-nakwol-connect-auth-guard/);
  assert.match(src, /document\.body\.setAttribute\('inert', ''\)/);
  assert.match(src, /setAuthGuardState\('login'\)/);
  assert.match(src, /await client\.login\(\)/);
  assert.match(src, /access_denied/);
  assert.match(src, /releaseAuthGuard\(\)/);
  assert.match(src, /version: '1\.4\.0'/);
  assert.match(src, /authMode, authRequired/);
});

test('required Connect keeps explicit logout locked instead of silently revealing the app', async () => {
  const src = await readFile(new URL('../../src/assets/nakwol-connect-v1.js.txt', import.meta.url), 'utf8');

  assert.match(src, /sso_suppressed/);
  assert.match(src, /if \(suppressed\) \{[\s\S]*setAuthGuardState\('loggedout'\)/);
  assert.match(src, /client\.addEventListener\('logout',[\s\S]*setAuthGuardState\('loggedout'\)/);
});

test('Connect public manifest and admin fallback advertise the same protected defaults', async () => {
  const routes = await readFile(new URL('../../src/connect.ts', import.meta.url), 'utf8');
  const cliGuide = await readFile(new URL('../../CONNECT_CLI.md', import.meta.url), 'utf8');

  assert.match(routes, /sdk:\s*'\/sdk\/v0\.3\.0\/nakwol-auth-web\.js'/);
  assert.match(routes, /default_auth:\s*'required'/);
  assert.match(routes, /default_access_policy:\s*'member'/);
  assert.match(routes, /row\.access_policy === 'public' \? 'guest' : row\.access_policy \?\? 'member'/);
  assert.doesNotMatch(routes, /access_policy:\s*row\.access_policy \?\? 'public'/);

  assert.match(cliGuide, /NAKWOL Connect CLI v0\.5/);
  assert.match(cliGuide, /auth\s*=\s*required/);
  assert.match(cliGuide, /access_policy\s*=\s*member/);
  assert.match(cliGuide, /테스트 페이지, 정적 사이트, Cloudflare Pages라는 이유만으로 공개 서비스라고 판단하지 않습니다/);
  assert.match(cliGuide, /--auth optional --access-policy guest/);
});
