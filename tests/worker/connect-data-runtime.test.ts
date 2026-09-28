import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Connect v1 embed exposes DATA client contract without changing script URL', async () => {
  const src = await readFile(new URL('../../src/assets/nakwol-connect-v1.js.txt', import.meta.url), 'utf8');

  assert.match(src, /dataset\.dataOrigin/);
  assert.match(src, /dataset\.dataScopes/);
  assert.match(src, /window\.NAKWOL_CONNECT = api/);
  assert.match(src, /window\.NAKWOL_DATA = data/);
  assert.match(src, /getAccessToken\(\)/);
  assert.match(src, /X-NAKWOL-CLIENT-ID/);
  assert.match(src, /NAKWOL_DATA_UNAUTHENTICATED/);
  assert.match(src, /registry\/generals/);
  assert.match(src, /include_hidden=1/);
  assert.match(src, /openapi:\s*dataOpenApi/);
  assert.match(src, /describe:\s*dataOpenApi/);

  const discovery = src.match(/const dataOpenApi = async \(\) => \{[\s\S]*?\n      \};/)?.[0] ?? '';
  assert.match(discovery, /\/openapi\.json/);
  assert.doesNotMatch(discovery, /getAccessToken/);
  assert.doesNotMatch(discovery, /Authorization/);
});

test('Connect v1 default widget uses compact Identity Menu with automatic SSO', async () => {
  const src = await readFile(new URL('../../src/assets/nakwol-connect-v1.js.txt', import.meta.url), 'utf8');

  assert.match(src, /sdk\/v0\.3\.1\/nakwol-auth-web\.js/);
  assert.match(src, /dataset\.autoSso\s*!==\s*'false'/);
  assert.match(src, /new sdk\.NakwolAuthClient\(\{ clientId, redirectUri, authOrigin, autoSso \}\)/);
  assert.match(src, /mountNakwolIdentityMenu/);
  assert.match(src, /variant:\s*'compact'/);
  assert.match(src, /theme:\s*'dark'/);
  assert.doesNotMatch(src, /mountNakwolAuthWidget\(client/);
});
