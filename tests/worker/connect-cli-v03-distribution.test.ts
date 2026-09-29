import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Connect v0.7 package, distribution and protected agent guidance stay aligned', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../packages/connect-cli/package.json', import.meta.url), 'utf8'));
  const dist = await readFile(new URL('../../src/connect-cli-distribution.ts', import.meta.url), 'utf8');
  const publish = await readFile(new URL('../../.github/workflows/publish-npm.yml', import.meta.url), 'utf8');

  assert.equal(pkg.version, '0.7.0');
  assert.match(dist, /CONNECT_CLI_VERSION = '0\.7\.0'/);
  assert.match(dist, /embed_is_server_protection:false/);
  assert.match(dist, /protect verify/);
  assert.match(dist, /SERVER_PROTECTION_GUIDANCE \+/);
  assert.match(dist, /default_auth:'required'/);
  assert.match(dist, /default_access_policy:'member'/);
  assert.match(dist, /npm_public_command:'npx --yes nakwol-connect init --auth optional --access-policy guest'/);
  assert.match(dist, /Unless the user explicitly says the service is public/);
  assert.match(dist, /Never infer optional\/guest from the fact that the site is static, a demo, a test page, or hosted on Cloudflare Pages/);
  assert.match(dist, /confirm the installed state is auth=required and access_policy=member/);
  assert.match(dist, /init --scopes roster:read,decks:read/);
  assert.match(dist, /data describe --json/);
  assert.match(dist, /data_openapi/);
  assert.match(dist, /openapi\.json/);
  assert.match(dist, /window\.NAKWOL_CONNECT\.data/);
  assert.match(dist, /sdk\/v0\.3\.0\/nakwol-auth-web\.js/);
  assert.doesNotMatch(publish, /NAKWOL Connect CLI v0\.2/);
  assert.match(publish, /CLI_SERIES/);
});
