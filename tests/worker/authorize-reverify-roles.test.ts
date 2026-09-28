import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('interactive login re-reads Discord roles when a stored session is denied', async () => {
  const src = await readFile(new URL('../../src/index.ts', import.meta.url), 'utf8');
  const authorize = src.slice(src.indexOf("app.get('/authorize'"), src.indexOf("app.get('/auth/discord/callback'"));

  // 허용된 세션은 그대로 SSO 코드를 발급한다.
  assert.match(authorize, /if \(await isApplicationAccessAllowed\(c\.env, sessionUserId, clientId\)\) \{[\s\S]*createAuthorizationCode[\s\S]*return c\.redirect/);
  // 조용한 자동 로그인은 Discord로 보내지 않고 거절한다.
  assert.match(authorize, /if \(prompt === 'none'\) \{\s*await deleteSession[\s\S]*error: 'access_denied'[\s\S]*clearSessionCookie/);
  // 직접 로그인은 거절 대신 Discord 인증으로 이어져 역할을 새로 읽는다.
  assert.ok(authorize.indexOf("'authorize.access_denied'") < authorize.indexOf('buildDiscordAuthorizeUrl'));
});

test('Discord callback still re-checks access with the refreshed roles', async () => {
  const src = await readFile(new URL('../../src/index.ts', import.meta.url), 'utf8');
  const callback = src.slice(src.indexOf("app.get('/auth/discord/callback'"), src.indexOf("app.post('/token'"));

  assert.match(callback, /refreshDiscordMembership[\s\S]*isApplicationAccessAllowed\(c\.env, userId, requestRow\.client_id\)/);
  assert.match(callback, /if \(!allowed\) \{[\s\S]*error: 'access_denied'/);
});
