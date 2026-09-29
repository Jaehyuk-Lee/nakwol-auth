import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { Hono } from 'hono';
import { registerConnectCliAppRoutes } from '../../src/connect-cli-apps';
import { sha256Base64Url } from '../../src/crypto';
import type { Env } from '../../src/types';

const textLoader = registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith('.txt')) return { format: 'module', source: `export default ${JSON.stringify(readFileSync(new URL(url), 'utf8'))}`, shortCircuit: true };
  return nextLoad(url, context);
} });
const { registerGateReportRoutes } = await import('../../src/gate-reports');
textLoader.deregister();

const summary = { schema_version: 1, installed_version: '0.3.0', runtime_version: '0.3.0', commit_sha: 'a'.repeat(40), status: 'verified', checked_count: 5, failure_count: 0, service_url: 'https://site.test' };

async function fixture() {
  const db = new DatabaseSync(':memory:');
  const dir = new URL('../../migrations/', import.meta.url);
  for (const name of readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(name, dir), 'utf8'));
  db.exec(`INSERT INTO applications VALUES('site','Site','["https://site.test/callback"]','active',0,0),('other','Other','["https://other.test/"]','active',0,0);
    INSERT INTO users VALUES('owner','Owner',NULL,'active',0,0),('outsider','Other',NULL,'active',0,0),('admin','Admin',NULL,'active',0,0);
    INSERT INTO application_settings(client_id,homepage_url,framework,access_policy,created_at,updated_at) VALUES('site','https://site.test','other','member',0,0);
    INSERT INTO application_owners VALUES('site','owner','owner',0);
    INSERT INTO connect_developers(user_id,role,status,created_at,updated_at,created_by_user_id) VALUES('owner','developer','active',0,0,NULL),('outsider','developer','active',0,0,NULL);
    INSERT INTO auth_operators VALUES('admin','operator',0,NULL);`);
  for (const user of ['owner', 'outsider']) {
    db.prepare('INSERT INTO connect_cli_tokens VALUES(?,?,?,?,NULL,0,0)').run(await sha256Base64Url(user), user, '["connect:apps"]', Date.now()+60000);
  }
  db.prepare('INSERT INTO access_tokens VALUES(?,?,?,?,NULL,0)').run(await sha256Base64Url('admin'), 'admin', 'nakwol-connect-admin', Date.now()+60000);
  function prepare(sql: string, args: (string | number | null)[] = []) {
    return {
      bind(...values: (string | number | null)[]) { return prepare(sql, values); },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async all() { return { results: db.prepare(sql).all(...args), success: true }; },
      async run() { return db.prepare(sql).run(...args); },
    };
  }
  const env = { DB: { prepare, async batch(statements: ReturnType<typeof prepare>[]) { return Promise.all(statements.map((statement) => statement.run())); } }, NAKWOL_GUILD_ID: 'guild', AUTH_ORIGIN: 'https://auth.test' } as Env;
  const app = new Hono<{ Bindings: Env }>();
  registerGateReportRoutes(app);
  registerConnectCliAppRoutes(app);
  function request(path: string, method = 'GET', token = '', body?: unknown) {
    return app.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }, env);
  }
  async function issue() {
    const response = await request('/connect/cli/apps/site/gate-report-token', 'POST', 'owner');
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const data: { data: { token: string } } = await response.json();
    return data.data.token;
  }
  return { db, request, issue };
}

test('report tokens are owner-scoped, hashed, report-only, rotated, expired and revoked', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/connect/cli/apps/site/gate-report-token','POST','outsider')).status,403);
    assert.equal((await f.request('/connect/cli/apps/site/gate-report-token','POST')).status,401);
    const token = await f.issue();
    assert.notEqual(f.db.prepare('SELECT token_hash FROM gate_report_tokens').get()?.token_hash, token);
    assert.equal((await f.request('/connect/gate-reports/site','POST',token,summary)).status,201);
    assert.equal((await f.request('/connect/gate-reports/other','POST',token,summary)).status,401);
    assert.equal((await f.request('/connect/cli/apps/site','PATCH',token,{name:'hacked'})).status,401);
    const rotated = await f.issue();
    assert.equal((await f.request('/connect/gate-reports/site','POST',token,summary)).status,401);
    assert.equal((await f.request('/connect/gate-reports/site','POST',rotated,summary)).status,201);
    f.db.exec('UPDATE gate_report_tokens SET expires_at=0');
    assert.equal((await f.request('/connect/gate-reports/site','POST',rotated,summary)).status,401);
    const finalToken = await f.issue();
    assert.equal((await f.request('/connect/cli/apps/site/gate-report-token','DELETE','owner')).status,200);
    assert.equal((await f.request('/connect/gate-reports/site','POST',finalToken,summary)).status,401);
  } finally { f.db.close(); }
});

test('ingestion rejects malformed/oversized/private summaries, foreign URLs and disabled apps', async () => {
  const f = await fixture();
  try {
    const token = await f.issue();
    for (const body of ['{broken', {...summary,raw_token:'secret'}, {...summary,service_url:'https://other.test'}, {...summary,service_url:'https://site.test/user/123'}, {...summary,service_url:'https://site.test/?email=x'}, {...summary,commit_sha:'abc'}, {...summary,failure_count:1}, {...summary,checked_count:0}, {...summary,status:'failed'}, {...summary,runtime_version:null}]) {
      assert.equal((await f.request('/connect/gate-reports/site','POST',token,body)).status,400);
    }
    assert.equal((await f.request('/connect/gate-reports/site','POST',token,'x'.repeat(16385))).status,413);
    assert.equal((await f.request('/connect/gate-reports/site','POST',token,{...summary,status:'failed',failure_count:1,runtime_version:null})).status,201);
    f.db.exec("UPDATE applications SET status='disabled' WHERE client_id='site'");
    assert.equal((await f.request('/connect/gate-reports/site','POST',token,summary)).status,401);
  } finally { f.db.close(); }
});

test('history is bounded, owner/admin restricted and informational without token material', async () => {
  const f = await fixture();
  try {
    const token = await f.issue();
    for (let i=0;i<102;i++) assert.equal((await f.request('/connect/gate-reports/site','POST',token,{...summary,deployment_id:`deploy-${i}`})).status,201);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM gate_reports').get()?.count,100);
    assert.equal((await f.request('/connect/cli/apps/site/gate-reports','GET','outsider')).status,403);
    assert.equal((await f.request('/admin/api/apps/site/gate-reports')).status,401);
    assert.equal((await f.request('/admin/api/apps/site/gate-reports','GET',token)).status,401);
    for (const [path, credential] of [['/connect/cli/apps/site/gate-reports','owner'], ['/admin/api/apps/site/gate-reports','admin']]) {
      const response = await f.request(path,'GET',credential);
      assert.equal(response.status,200);
      const body: { data: { informational: boolean; reports: {deployment_id: string}[] } } = await response.json();
      assert.equal(body.data.informational,true);
      assert.equal(body.data.reports.length,100);
      assert.equal(body.data.reports[0].deployment_id,'deploy-101');
      assert.equal(JSON.stringify(body).includes(token),false);
      assert.equal(JSON.stringify(body).includes('token_hash'),false);
    }
    assert.equal(f.db.prepare("SELECT access_policy FROM application_settings WHERE client_id='site'").get()?.access_policy,'member');
  } finally { f.db.close(); }
});
