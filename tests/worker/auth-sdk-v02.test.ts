import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const root = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

const THEME_VARIABLES = [
  '--nakwol-auth-accent',
  '--nakwol-auth-bg',
  '--nakwol-auth-text',
  '--nakwol-auth-muted',
  '--nakwol-auth-border',
  '--nakwol-auth-radius',
  '--nakwol-auth-shadow',
];

test('v0.1 stays pinned and v0.2 adds the Identity Menu contract', async () => {
  const oldSdk = await root('src/assets/nakwol-auth-web.js.txt');
  const nextSdk = await root('src/assets/nakwol-auth-web-v0.2.0.js.txt');
  const routes = await root('src/sdk.ts');

  assert.match(oldSdk, /NAKWOL_AUTH_SDK_VERSION\s*=\s*'0\.1\.0'/);
  assert.doesNotMatch(oldSdk, /mountNakwolIdentityMenu/);

  const upgradedV01 = oldSdk.replace(
    "export const NAKWOL_AUTH_SDK_VERSION = '0.1.0';",
    "export const NAKWOL_AUTH_SDK_VERSION = '0.2.0';"
  );
  assert.ok(
    nextSdk.startsWith(upgradedV01),
    'v0.2 must preserve the complete v0.1 implementation and extend only the new immutable asset'
  );

  assert.match(nextSdk, /NAKWOL_AUTH_SDK_VERSION\s*=\s*'0\.2\.0'/);
  assert.match(nextSdk, /export function mountNakwolIdentityMenu/);
  assert.match(nextSdk, /button.*compact.*menu/s);
  assert.match(nextSdk, /inherit.*light.*dark/s);

  for (const variable of THEME_VARIABLES) {
    assert.ok(nextSdk.includes(variable), `${variable} must be part of the v0.2 theming contract`);
  }

  assert.match(nextSdk, /내 낙월 계정/);
  assert.match(nextSdk, /이 서비스 권한/);
  assert.match(nextSdk, /Escape/);

  const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: nextSdk,
    encoding: 'utf8',
  });
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout || 'v0.2 SDK syntax check failed');

  assert.match(routes, /\/sdk\/v0\.1\.0\/nakwol-auth-web\.js/);
  assert.match(routes, /\/sdk\/v0\.2\.0\/nakwol-auth-web\.js/);
  assert.match(routes, /\/sdk\/v0\.3\.0\/nakwol-auth-web\.js/);
  assert.match(routes, /NAKWOL_AUTH_WEB_SDK_VERSION\s*=\s*'0\.3\.2'/);
  assert.match(routes, /module:\s*'\/sdk\/v0\.3\.2\/nakwol-auth-web\.js'/);
});

test('inherit theme consumes the documented host CSS variables without shadow aliases', async () => {
  const nextSdk = await root('src/assets/nakwol-auth-web-v0.2.0.js.txt');

  assert.doesNotMatch(
    nextSdk,
    /--nakwol-host-auth-/,
    'inherit must use the documented --nakwol-auth-* variables directly'
  );

  const baseRule = nextSdk.match(/\.nakwol-identity\{([\s\S]*?)position:relative/)?.[1] || '';
  for (const variable of THEME_VARIABLES) {
    assert.ok(
      !baseRule.includes(`${variable}:`),
      `${variable} must remain inheritable from the host when theme=inherit`
    );
  }
});
