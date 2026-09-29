import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as miniflare from 'miniflare';
import { Hono } from 'hono';
import auth from '../../src/index';
import { registerAccessSupportRoutes } from '../../src/access-support';
import { diagnoseApplicationAccess, MEMBERSHIP_MAX_AGE_MS } from '../../src/policy';
import { createSession, findSessionUser, inspectAccessToken, upsertMembership } from '../../src/store';
import { sha256Base64Url } from '../../src/crypto';
import type { Env } from '../../src/types';

test('operator support actions use real D1 and preserve service and identity boundaries', async (t) => {
  const options = { modules: true, script: 'export default {fetch(){return new Response("ok")}}', d1Databases: ['DB'] };
  const mf = new miniflare.Miniflare('convertV4MiniflareOptions' in miniflare ? miniflare.convertV4MiniflareOptions(options) : options);
  t.after(() => mf.dispose());
  const DB = await mf.getD1Database('DB');
  for (const file of ['0001_initial.sql', '0003_nakwol_connect.sql', '0011_season_roles.sql', '0012_membership_role_ids.sql', '0013_access_support.sql']) {
    const sql = await readFile(new URL('../../migrations/' + file, import.meta.url), 'utf8');
    for (const statement of sql.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) await DB.prepare(statement).run();
  }
  const env = { DB, NAKWOL_GUILD_ID: '1493410906456064112', NAKWOL_MEMBER_ROLE_ID: '1553600098661957643',
    DISCORD_CLIENT_ID: 'fixture', DISCORD_CLIENT_SECRET: 'fixture', AUTH_ORIGIN: 'https://auth.test' };
  const app = new Hono<{ Bindings: Env }>();
  registerAccessSupportRoutes(app);
  const discordId = '1553600098661957644';
  for (const id of ['operator', 'ordinary', 'target']) {
    await DB.prepare(`INSERT INTO users VALUES (?, ?, NULL, 'active', 0, 0)`).bind(id, id).run();
    await DB.prepare(`INSERT INTO access_tokens VALUES (?, ?, 'nakwol-connect-admin', ?, NULL, ?)`).bind(await sha256Base64Url(id), id, Date.now() + 60000, Date.now()).run();
  }
  await DB.prepare(`INSERT INTO auth_operators(user_id,created_at) VALUES ('operator',0)`).run();
  for (const id of ['site', 'other']) {
    await DB.prepare(`INSERT INTO applications VALUES (?, ?, '["https://site.test/"]', 'active', 0, 0)`).bind(id, id).run();
  }
  const request = (action: string, token = 'operator', targetId = discordId) => app.request('https://auth.test/admin/api/access/site', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, discord_user_id: targetId, reason: 'fixture support request' }),
  }, env);
  const status = () => diagnoseApplicationAccess(env, 'target', 'site');

  await t.test('anonymous and non-operator cannot grant; malformed identity rejected', async () => {
    assert.equal((await request('grant', 'missing')).status, 401);
    assert.equal((await request('grant', 'ordinary')).status, 403);
    assert.equal((await request('grant', 'operator', 'not-a-discord-id')).status, 400);
    assert.equal((await app.request('https://auth.test/admin/api/access/site', {
      method: 'POST', headers: { Authorization: 'Bearer operator', Origin: 'https://other.test' },
      body: JSON.stringify({ action: 'grant', discord_user_id: discordId, reason: 'fixture' }),
    }, env)).status, 403);
  });
  await t.test('pregrant only links after verified Discord identity and never alters membership', async () => {
    assert.equal((await request('grant')).status, 200);
    assert.equal((await status()).allowed, false);
    await DB.prepare(`INSERT INTO auth_identities VALUES ('target-i','target','discord',?,0,0)`).bind(discordId).run();
    await upsertMembership(env, 'target', false, 'user', []);
    assert.equal((await status()).reason, 'MANUAL_GRANT');
    assert.equal((await diagnoseApplicationAccess(env, 'target', 'other')).allowed, false);
    const member = await DB.prepare(`SELECT role FROM memberships WHERE user_id='target'`).first();
    assert.equal(member?.role, 'user');
  });
  await t.test('manual grant cannot bypass disabled user/app or operator policy', async () => {
    await DB.prepare(`UPDATE users SET status='disabled' WHERE id='target'`).run();
    assert.equal((await status()).reason, 'USER_DISABLED');
    await DB.prepare(`UPDATE users SET status='active' WHERE id='target'`).run();
    await DB.prepare(`UPDATE applications SET status='disabled' WHERE client_id='site'`).run();
    assert.equal((await status()).reason, 'APP_DISABLED');
    await DB.prepare(`UPDATE applications SET status='active' WHERE client_id='site'`).run();
    await DB.prepare(`INSERT INTO application_settings(client_id,access_policy,created_at,updated_at) VALUES ('site','admin',0,0)`).run();
    assert.equal((await request('grant')).status, 400);
    assert.equal((await status()).allowed, false);
    await DB.prepare(`UPDATE application_settings SET access_policy='member' WHERE client_id='site'`).run();
  });
  await t.test('reauthentication invalidates old sessions/tokens and blocks issuance until roles refreshed', async () => {
    const session = await createSession(env, 'target');
    const issued = Date.now() - 1000;
    await DB.prepare(`INSERT INTO access_tokens VALUES (?, 'target', 'site', ?, NULL, ?)`).bind(await sha256Base64Url('old'), Date.now() + 60000, issued).run();
    assert.equal((await request('reauthenticate')).status, 200);
    assert.equal(await findSessionUser(env, session.token), null);
    assert.equal(await inspectAccessToken(env, 'old', 'site'), null);
    assert.equal((await status()).reason, 'REAUTHENTICATION_REQUIRED');
    await upsertMembership(env, 'target', true, 'member', [env.NAKWOL_MEMBER_ROLE_ID]);
    assert.equal((await status()).allowed, true);
    await DB.prepare(`UPDATE access_tokens SET revoked_at=NULL WHERE user_id='target' AND client_id='site'`).run();
    assert.equal(await inspectAccessToken(env, 'old', 'site'), null);
    await DB.prepare(`INSERT INTO access_tokens VALUES (?, 'target', 'site', ?, NULL, ?)`).bind(await sha256Base64Url('fresh'), Date.now() + 60000, Date.now()).run();
    assert.ok(await inspectAccessToken(env, 'fresh', 'site'));
  });
  await t.test('/me exposes scoped manual permission while actual membership remains false; revoke removes access', async () => {
    await upsertMembership(env, 'target', false, 'user', []);
    const response = await auth.request('https://auth.test/me?client_id=site', { headers: { Authorization: 'Bearer fresh', 'X-Nakwol-Require-Member': 'true' } }, env);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.data.membership.is_member, false);
    assert.equal(data.application_access.source, 'manual_grant');
    assert.equal((await request('revoke')).status, 200);
    assert.equal((await status()).reason, 'SEASON_ROLE_MISSING');
    assert.equal(await inspectAccessToken(env, 'fresh', 'site'), null);
  });
  await t.test('role-based access expires after 24 hours and recovers after Discord refresh', async () => {
    await DB.prepare(`DELETE FROM user_reauthentication WHERE user_id='target'`).run();
    await upsertMembership(env, 'target', true, 'member', [env.NAKWOL_MEMBER_ROLE_ID]);
    assert.equal((await status()).allowed, true);
    await DB.prepare(`UPDATE memberships SET checked_at=? WHERE user_id='target'`).bind(Date.now() - MEMBERSHIP_MAX_AGE_MS).run();
    assert.equal((await status()).reason, 'MEMBERSHIP_REFRESH_REQUIRED');
    await upsertMembership(env, 'target', true, 'member', [env.NAKWOL_MEMBER_ROLE_ID]);
    assert.equal((await status()).allowed, true);
  });
  await t.test('operator can inspect target records and action audit; others cannot', async () => {
    const url = 'https://auth.test/admin/api/access/site?discord_id=' + discordId;
    const response = await app.request(url, { headers: { Authorization: 'Bearer operator' } }, env);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const data = await response.json();
    assert.equal(data.user.id, 'target');
    assert.equal(data.grants[0].status, 'revoked');
    assert.ok(data.events.some((e: { event_type: string }) => e.event_type === 'admin.access.reauthenticate'));
    assert.equal((await app.request(url, { headers: { Authorization: 'Bearer ordinary' } }, env)).status, 403);
  });
  await t.test('denied OAuth creates no session or token; retry with new role succeeds', async (t) => {
    let roles: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/oauth2/token')) return Response.json({ access_token: 'discord-fixture' });
      if (url.endsWith('/users/@me')) return Response.json({ id: discordId, username: 'target' });
      return Response.json({ roles });
    });
    const callback = async (requestId: string, cookie = '') => {
      await DB.prepare(`INSERT INTO oauth_requests VALUES (?, 'site', 'https://site.test/', 'challenge', 'state', ?, ?)`)
        .bind(requestId, Date.now() + 60000, Date.now()).run();
      return auth.request('https://auth.test/auth/discord/callback?state=' + requestId + '&code=fixture', { headers: { Cookie: cookie } }, env);
    };
    const oldSession = await createSession(env, 'target');
    const denied = await callback('deny-request', 'nakwol_sid=' + oldSession.token);
    assert.equal(new URL(denied.headers.get('Location') || '').searchParams.get('error'), 'access_denied');
    assert.match(denied.headers.get('Set-Cookie') || '', /Max-Age=0/);
    assert.equal(await findSessionUser(env, oldSession.token), null);
    assert.equal((await DB.prepare(`SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id='target'`).first())?.n, 0);
    assert.equal((await DB.prepare(`SELECT COUNT(*) AS n FROM auth_codes WHERE user_id='target'`).first())?.n, 0);
    roles = [env.NAKWOL_MEMBER_ROLE_ID];
    const accepted = await callback('retry-request');
    assert.ok(new URL(accepted.headers.get('Location') || '').searchParams.get('code'));
    assert.doesNotMatch(accepted.headers.get('Set-Cookie') || '', /Max-Age=0/);
    assert.equal((await DB.prepare(`SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id='target'`).first())?.n, 1);
  });
});
