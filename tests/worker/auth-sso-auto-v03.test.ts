import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const root = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('SDK v0.3 layers automatic SSO on immutable v0.2', async () => {
  const sdk = await root('src/assets/nakwol-auth-web-v0.3.0.js.txt');
  const routes = await root('src/sdk.ts');

  assert.match(sdk, /from '\.\.\/v0\.2\.0\/nakwol-auth-web\.js'/);
  assert.match(sdk, /NAKWOL_AUTH_SDK_VERSION\s*=\s*'0\.3\.0'/);
  assert.match(sdk, /class NakwolAuthClient extends NakwolAuthClientV02/);
  assert.match(sdk, /options\.autoSso/);
  assert.match(sdk, /url\.searchParams\.set\('prompt', 'none'\)/);
  assert.match(sdk, /location\.replace\(url\.toString\(\)\)/);
  assert.match(sdk, /params\.get\('error'\) === 'login_required'/);
  assert.match(sdk, /STATE_OR_PKCE_MISMATCH/);
  assert.match(sdk, /sso_suppressed/);

  const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: sdk,
    encoding: 'utf8',
  });
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout || 'v0.3 SDK syntax check failed');

  assert.match(routes, /sdkV03Source/);
  assert.match(routes, /\/sdk\/v0\.3\.0\/nakwol-auth-web\.js/);
  assert.match(routes, /NAKWOL_AUTH_WEB_SDK_VERSION\s*=\s*'0\.3\.1'/);
  assert.match(routes, /module:\s*'\/sdk\/v0\.3\.1\/nakwol-auth-web\.js'/);
});

test('authorize prompt=none checks only the central session and never opens Discord when absent', async () => {
  const source = await root('src/index.ts');
  const authorizeStart = source.indexOf("app.get('/authorize'");
  const callbackStart = source.indexOf("app.get('/auth/discord/callback'", authorizeStart);
  const authorize = source.slice(authorizeStart, callbackStart);

  assert.match(authorize, /const prompt = c\.req\.query\('prompt'\) \?\? ''/);
  assert.match(authorize, /prompt && prompt !== 'none'/);
  assert.match(authorize, /prompt === 'none' \? 'authorize\.sso_auto' : 'authorize\.sso'/);
  assert.match(authorize, /if \(prompt === 'none'\)/);
  assert.match(authorize, /error: 'login_required'/);

  const silentMiss = authorize.indexOf("if (prompt === 'none')");
  const createRequest = authorize.indexOf('const requestId = `req_');
  const discordRedirect = authorize.indexOf('buildDiscordAuthorizeUrl');
  assert.ok(silentMiss >= 0 && silentMiss < createRequest && createRequest < discordRedirect);
});

test('Connect Universal Embed enables automatic SSO by default with an explicit opt-out', async () => {
  const connect = await root('src/assets/nakwol-connect-v1.js.txt');

  assert.match(connect, /dataset\.autoSso !== 'false'/);
  assert.match(connect, /sdk\/v0\.3\.1\/nakwol-auth-web\.js/);
  assert.match(connect, /new sdk\.NakwolAuthClient\(\{ clientId, redirectUri, authOrigin, autoSso \}\)/);
});
