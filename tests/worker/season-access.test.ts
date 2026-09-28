import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as miniflare from 'miniflare';
import app from '../../src/index';
import { resolveNakwolRole } from '../../src/discord';
import { isApplicationAccessAllowed } from '../../src/policy';
import { createAuthorizationCode, createSession, exchangeAuthorizationCode, upsertMembership } from '../../src/store';
import { sha256Base64Url } from '../../src/crypto';

const season = '1553600098661957643';
const extra = '1493413577489649715';
const guild = '1493410906456064112';
const discordUser = '1493410906456064113';

test('OAuth season membership gates tokens and additional roles without a bot', async (t) => {
  const options = { modules: true, script: 'export default {fetch(){return new Response("ok")}}', d1Databases: ['DB'] };
  const mf = new miniflare.Miniflare('convertV4MiniflareOptions' in miniflare ? miniflare.convertV4MiniflareOptions(options) : options);
  t.after(() => mf.dispose());
  const DB = await mf.getD1Database('DB');
  for (const file of ['0001_initial.sql', '0003_nakwol_connect.sql', '0011_season_roles.sql', '0012_membership_role_ids.sql', '0013_access_support.sql']) {
    const sql = await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');
    for (const statement of sql.replace(/^--.*$/gm, '').split(';').map(value => value.trim()).filter(Boolean)) {
      await DB.prepare(statement).run();
    }
  }
  const env = { DB, NAKWOL_GUILD_ID: guild, NAKWOL_MEMBER_ROLE_ID: season,
    DISCORD_CLIENT_ID: 'test-client', DISCORD_CLIENT_SECRET: 'test-secret', AUTH_ORIGIN: 'https://auth.test' };
  await DB.prepare("INSERT INTO users VALUES ('u', 'Tester', NULL, 'active', 0, 0)").run();
  await DB.prepare("INSERT INTO auth_identities VALUES ('i','u','discord',?,0,0)").bind(discordUser).run();
  await DB.prepare("INSERT INTO applications VALUES ('site','Site','[\"https://site.test/\"]','active',0,0)").run();
  await DB.prepare("INSERT INTO application_settings(client_id,access_policy,created_at,updated_at) VALUES ('site','member',0,0)").run();
  const expiresAt = Date.now() + 60000;
  await DB.prepare("INSERT INTO access_tokens VALUES (?, 'u', 'site', ?, NULL, 0)").bind(await sha256Base64Url('existing-token'), expiresAt).run();
  let roles = [season];
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { throw new Error('Authorization must not call Discord bot API'); };
  const refresh = () => upsertMembership(env, 'u', true, roles.includes(season) ? 'member' : 'user', roles);
  const me = async (force = false) => {
    await refresh();
    return app.request('https://auth.test/me?client_id=site', {
      headers: { Authorization: 'Bearer existing-token', ...(force ? { 'X-Nakwol-Require-Member': 'true' } : {}) },
    }, env);
  };

  await t.test('season3 alone allows and exposes actual token expiry', async () => {
    const response = await me();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const body = await response.json();
    assert.equal(body.expires_at, expiresAt);
    assert.equal(body.data.membership.is_member, true);
  });
  await t.test('same token denied after OAuth refresh observes season role removal', async () => {
    roles = [extra, '1519965362827956315'];
    const response = await me();
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    roles = [season];
    assert.equal((await me()).status, 200);
  });
  await t.test('additional roles are all-of and never substitute for season3', async () => {
    await DB.prepare("INSERT INTO application_role_requirements VALUES ('site', ?, 0)").bind(JSON.stringify([extra])).run();
    assert.equal((await me()).status, 403);
    roles = [season, extra];
    assert.equal((await me()).status, 200);
    roles = [extra];
    assert.equal((await me()).status, 403);
    await DB.prepare("DELETE FROM application_role_requirements WHERE client_id='site'").run();
    roles = [season];
  });
  await t.test('existing authorization code rechecks role at token exchange', async () => {
    const verifier = 'test-verifier';
    const code = await createAuthorizationCode(env, 'u', 'site', 'https://site.test/', await sha256Base64Url(verifier));
    roles = [];
    await refresh();
    await assert.rejects(exchangeAuthorizationCode(env, { code, clientId: 'site', redirectUri: 'https://site.test/', codeVerifier: verifier }), /ACCESS_DENIED/);
    roles = [season];
  });
  await t.test('central SSO session cannot mint a code after role removal', async () => {
    const session = await createSession(env, 'u');
    const url = new URL('https://auth.test/authorize');
    for (const [key, value] of Object.entries({ client_id: 'site', redirect_uri: 'https://site.test/', code_challenge: 'challenge', code_challenge_method: 'S256', prompt: 'none' })) url.searchParams.set(key, value);
    roles = [];
    await refresh();
    const denied = await app.request(url.toString(), { headers: { Cookie: `nakwol_sid=${session.token}` } }, env);
    assert.equal(denied.status, 302);
    assert.equal(new URL(denied.headers.get('Location') ?? '').searchParams.get('error'), 'access_denied');
    roles = [season];
    await refresh();
    assert.match(denied.headers.get('Set-Cookie') || '', /Max-Age=0/);
    const freshSession = await createSession(env, 'u');
    const allowed = await app.request(url.toString(), { headers: { Cookie: `nakwol_sid=${freshSession.token}` } }, env);
    assert.equal(allowed.status, 302);
    assert.ok(new URL(allowed.headers.get('Location') ?? '').searchParams.get('code'));
  });
  await t.test('existing OAuth membership works without bot configuration or network access', async () => {
    roles = [season];
    await refresh();
    assert.equal(await isApplicationAccessAllowed(env, 'u', 'site'), true);
    await DB.prepare("UPDATE memberships SET role_ids='invalid-json'").run();
    assert.equal(await isApplicationAccessAllowed(env, 'u', 'site'), false);
  });
  await t.test('guest and AUTH operator do not bypass explicit member requirement', async () => {
    roles = [];
    await DB.prepare("UPDATE application_settings SET access_policy='guest' WHERE client_id='site'").run();
    assert.equal((await me()).status, 200);
    assert.equal((await me(true)).status, 403);
    await DB.prepare("INSERT INTO auth_operators(user_id,created_at) VALUES ('u',0)").run();
    await DB.prepare("UPDATE application_settings SET access_policy='admin' WHERE client_id='site'").run();
    assert.equal((await me()).status, 200);
    assert.equal((await me(true)).status, 403);
    await DB.prepare("UPDATE application_settings SET access_policy='member' WHERE client_id='site'").run();
    roles = [season];
  });
  await t.test('revoked token and disabled app are denied without relying on Discord', async () => {
    await DB.prepare("UPDATE access_tokens SET revoked_at=1").run();
    assert.equal((await me()).status, 401);
    await DB.prepare("UPDATE access_tokens SET revoked_at=NULL").run();
    await DB.prepare("UPDATE applications SET status='disabled' WHERE client_id='site'").run();
    assert.equal((await me()).status, 401);
  });
  assert.equal(resolveNakwolRole({ ...env, NAKWOL_MEMBER_ROLE_ID: '' }, { roles: [season] }), 'user');
  assert.equal(resolveNakwolRole(env, { roles: [extra] }), 'user');
});
