import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { registerRoleAdminRoutes } from '../../src/role-admin';
import { getRequiredRoleIds, parseRequiredRoleIds, RoleSettingsError } from '../../src/role-settings';
import { sha256Base64Url } from '../../src/crypto';
import type { Env } from '../../src/types';

const season = '1553600098661957643';
const subdivision = '1553600098661957644';
const guild = '1493410906456064112';

async function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE applications(client_id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE users(id TEXT PRIMARY KEY, status TEXT);
    CREATE TABLE application_settings(client_id TEXT PRIMARY KEY, access_policy TEXT);
    CREATE TABLE auth_operators(user_id TEXT PRIMARY KEY, role TEXT);
    CREATE TABLE access_tokens(token_hash TEXT PRIMARY KEY,user_id TEXT,client_id TEXT,expires_at INTEGER,revoked_at INTEGER);
    CREATE TABLE auth_events(id TEXT,user_id TEXT,client_id TEXT,event_type TEXT,detail TEXT,created_at INTEGER);
    INSERT INTO applications VALUES ('site','사이트');
    INSERT INTO application_settings VALUES ('site','member');
    INSERT INTO auth_operators VALUES ('operator','operator');
    INSERT INTO users VALUES ('operator','active');`);
  db.exec(readFileSync(new URL('../../migrations/0011_season_roles.sql', import.meta.url), 'utf8'));
  for (const [token, user, client] of [['admin-token','operator','nakwol-connect-admin'], ['wrong-client','operator','site'], ['member-token','member','nakwol-connect-admin']]) {
    db.prepare('INSERT INTO access_tokens VALUES(?,?,?,?,NULL)').run(await sha256Base64Url(token), user, client, Date.now()+60000);
  }
  function prepare(sql: string, args: (string | number | null)[] = []) {
    return {
      bind(...values: (string | number | null)[]) { return prepare(sql, values); },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...args), success: true }; },
      async run() { return db.prepare(sql).run(...args); },
    };
  }
  const env = { DB: { prepare }, NAKWOL_GUILD_ID:guild, NAKWOL_MEMBER_ROLE_ID:season, DISCORD_BOT_TOKEN:'test-bot', AUTH_ORIGIN:'https://auth.test' } as Env;
  const app = new Hono<{Bindings:Env}>();
  registerRoleAdminRoutes(app);
  function request(body: string, token='admin-token', origin='https://auth.test') {
    return app.request('https://auth.test/admin/roles', {method:'POST', headers:{ Authorization:`Bearer ${token}`, Origin:origin, 'Content-Type':'application/json' }, body}, env);
  }
  return { db, env, app, request };
}

test('role parser rejects malformed or oversized requirements', () => {
  for (const input of [null, {}, ['not-a-role'], [23], Array(26).fill(subdivision)]) assert.throws(()=>parseRequiredRoleIds(input), RoleSettingsError);
  assert.deepEqual(parseRequiredRoleIds([subdivision, subdivision]), [subdivision]);
});

test('stored requirements fail closed and absent rows have no supplementary role', async () => {
  const { db, env } = await fixture();
  try {
    assert.deepEqual(await getRequiredRoleIds(env, 'site'), []);
    db.prepare('INSERT INTO application_role_requirements VALUES(?,?,0)').run('site','["invalid"]');
    await assert.rejects(getRequiredRoleIds(env,'site'), RoleSettingsError);
    db.exec('PRAGMA ignore_check_constraints=ON');
    db.prepare('UPDATE application_role_requirements SET role_ids=?').run('{bad');
    await assert.rejects(getRequiredRoleIds(env,'site'), RoleSettingsError);
  } finally { db.close(); }
});

test('role admin enforces operator token audience, origin, member scope and live roles; successful save persists and audits', async (t) => {
  const { db, env, app, request } = await fixture();
  const catalog = [{id:guild,name:'@everyone'},{id:season,name:'시즌3'},{id:subdivision,name:'<script>alert(1)</script>'}];
  let calls=0;
  t.mock.method(globalThis,'fetch',async (url: string, options: RequestInit) => {
    calls++;
    assert.equal(url,`https://discord.com/api/v10/guilds/${guild}/roles`);
    assert.equal(new Headers(options.headers).get('Authorization'),'Bot test-bot');
    return Response.json(catalog);
  });
  const valid = JSON.stringify({client_id:'site',role_ids:[subdivision]});
  try {
    assert.equal((await app.request('/admin/api/roles',{},env)).status,401);
    assert.equal((await request(valid,'wrong-client')).status,401);
    assert.equal((await request(valid,'member-token')).status,403);
    db.prepare('UPDATE users SET status=?').run('disabled');
    assert.equal((await request(valid)).status,403);
    db.prepare('UPDATE users SET status=?').run('active');
    assert.equal((await request(valid,'admin-token','https://evil.test')).status,403);
    assert.equal((await request(valid,'admin-token','')).status,403);
    assert.equal((await request('{broken')).status,400);
    assert.equal((await request(JSON.stringify({client_id:'site',role_ids:['bogus']}))).status,400);
    assert.equal(calls,0);
    assert.equal((await request(JSON.stringify({client_id:'missing',role_ids:[]}))).status,404);
    db.prepare('UPDATE application_settings SET access_policy=?').run('guest');
    assert.equal((await request(valid)).status,400);
    db.prepare('UPDATE application_settings SET access_policy=?').run('member');
    assert.equal((await request(JSON.stringify({client_id:'site',role_ids:['1553600098661957699']}))).status,400);
    assert.equal((await request(JSON.stringify({client_id:'site',role_ids:[guild]}))).status,400);
    assert.deepEqual(await getRequiredRoleIds(env,'site'),[]);
    assert.equal((await request(JSON.stringify({client_id:'site',role_ids:[season,subdivision]}))).status,200);
    assert.deepEqual(await getRequiredRoleIds(env,'site'),[subdivision]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_events').get()?.n,1);
    const loaded=await app.request('/admin/api/roles',{headers:{Authorization:'Bearer admin-token'}},env);
    assert.equal(loaded.status,200);
    assert.equal(loaded.headers.get('Cache-Control'),'no-store');
    const payload=await loaded.json();
    assert.equal(payload.season_role.id,season);
    assert.deepEqual(payload.applications[0].required_role_ids,[subdivision]);
    assert.equal(payload.roles.some((role: {id:string})=>role.id===guild),false);
    const html=await (await app.request('/admin/roles',{},env)).text();
    assert.ok(!html.includes('<script>alert(1)</script>'));
    catalog.splice(1,1);
    assert.equal((await request(valid)).status,503);
    assert.deepEqual(await getRequiredRoleIds(env,'site'),[subdivision]);
    t.mock.method(globalThis,'fetch',async () => { throw new Error('secret transport detail'); });
    const unavailable=await request(valid);
    assert.equal(unavailable.status,503);
    assert.ok(!(await unavailable.text()).includes('secret transport detail'));
  } finally { db.close(); }
});
