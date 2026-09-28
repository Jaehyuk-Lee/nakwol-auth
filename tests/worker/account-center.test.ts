import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Account Center maps only AUTH-level access policies to user-facing permissions', async () => {
  const { permissionLabelsForAccessPolicy, toConnectedServiceSummary } = await import('../../src/account-store');

  assert.deepEqual(permissionLabelsForAccessPolicy('public'), ['NAKWOL 기본 프로필 확인']);
  assert.deepEqual(permissionLabelsForAccessPolicy('member'), ['NAKWOL 기본 프로필 확인', '낙월 맹원 여부 확인']);
  assert.deepEqual(permissionLabelsForAccessPolicy('admin'), ['NAKWOL 기본 프로필 확인', '낙월 관리자 여부 확인']);

  assert.deepEqual(
    toConnectedServiceSummary({
      client_id: 'siege-calculator',
      name: '공성 시간 계산기',
      homepage_url: 'https://siege-calculator.pages.dev/',
      access_policy: 'public',
      last_authorized_at: 123,
    }),
    {
      client_id: 'siege-calculator',
      name: '공성 시간 계산기',
      homepage_url: 'https://siege-calculator.pages.dev/',
      last_authorized_at: 123,
      permissions: ['NAKWOL 기본 프로필 확인'],
    }
  );
});

test('connected services come only from this user successful AUTH evidence and exclude internal apps', async () => {
  const source = await root('src/account-store.ts');

  assert.match(source, /FROM auth_events e/);
  assert.match(source, /e\.user_id\s*=\s*\?/);
  assert.match(source, /discord\.login\.success/);
  assert.match(source, /authorize\.sso/);
  assert.match(source, /a\.status\s*=\s*'active'/);
  assert.match(source, /COALESCE\(s\.framework,'?'?'?\)\s*<>\s*'internal'/);
  assert.doesNotMatch(source, /services\/data|roster:|decks:|equipment:/);
});

test('account summary API requires an Account Center-bound access token and stays same-origin', async () => {
  const source = await root('src/account.ts');

  assert.match(source, /app\.get\('\/account\/api\/summary'/);
  assert.match(source, /Authorization/);
  assert.match(source, /authenticateAccessToken\(c\.env,\s*token,\s*ACCOUNT_CLIENT_ID\)/);
  assert.match(source, /getUserWithMembership\(c\.env,\s*userId\)/);
  assert.match(source, /listConnectedServices\(c\.env,\s*userId\)/);
  assert.match(source, /401/);
  assert.match(source, /404/);
  assert.doesNotMatch(source, /Access-Control-Allow-Origin|withCorsHeaders/);
});

test('Account Center UI uses pinned SDK v0.3.2 and explicit account states/actions', async () => {
  const { accountPageHtml } = await import('../../src/account');
  const html = accountPageHtml();

  for (const text of [
    '/sdk/v0.3.2/nakwol-auth-web.js',
    'nakwol-account-center',
    'Discord로 낙월 로그인',
    'NAKWOL ID',
    '이용한 서비스',
    '고객지원 정보',
    'Discord로 다시 확인',
    '마지막 확인',
    '서비스 권한',
    '모든 낙월 서비스에서 로그아웃',
    '아직 표시할 연결 서비스 기록이 없습니다.',
  ]) {
    assert.ok(html.includes(text), `Account Center HTML must include: ${text}`);
  }

  for (const id of [
    'account-identity',
    'logged-out',
    'login',
    'account-content',
    'profile-card',
    'membership-card',
    'services-card',
    'services',
    'permissions',
    'permission-detail',
    'global-logout',
    'account-error',
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }

  assert.match(html, /new NakwolAuthClient\(\{\s*clientId:\s*ACCOUNT_CLIENT_ID/);
  assert.match(html, /redirectUri:\s*location\.origin\s*\+\s*'\/account'/);
  assert.match(html, /fetch\('\/account\/api\/summary'/);
  assert.match(html, /auth\.getAccessToken\(\)/);
  assert.match(html, /textContent/);
  assert.match(html, /new URLSearchParams\(location\.search\).*client_id/s);
  assert.match(html, /location\.hash\s*===\s*'#permissions'/);
  assert.match(html, /confirm\(/);
  assert.match(html, /auth\.logout\(\{\s*global:\s*true,\s*returnTo:\s*location\.origin\s*\+\s*'\/account'\s*\}\)/);
});

test('account recheck clears only browser SSO and the next authorize reaches Discord', async (t) => {
  const miniflare = await import('miniflare');
  const { default: app } = await import('../../src/index');
  const { registerAccountRoutes } = await import('../../src/account');
  registerAccountRoutes(app);
  const { createSession, findSessionUser, authenticateAccessToken } = await import('../../src/store');
  const { sha256Base64Url } = await import('../../src/crypto');
  const options = { modules: true, script: 'export default {fetch(){return new Response("ok")}}', d1Databases: ['DB'] };
  const mf = new miniflare.Miniflare('convertV4MiniflareOptions' in miniflare ? miniflare.convertV4MiniflareOptions(options) : options);
  t.after(() => mf.dispose());
  const DB = await mf.getD1Database('DB');
  for (const file of ['0001_initial.sql', '0003_nakwol_connect.sql', '0011_season_roles.sql', '0012_membership_role_ids.sql', '0013_access_support.sql']) {
    const sql = await root('migrations/' + file);
    for (const statement of sql.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) await DB.prepare(statement).run();
  }
  const env = { DB, NAKWOL_GUILD_ID: 'guild', NAKWOL_MEMBER_ROLE_ID: 'season3', DISCORD_CLIENT_ID: 'fixture', DISCORD_CLIENT_SECRET: 'fixture', AUTH_ORIGIN: 'https://auth.test' };
  await DB.prepare("INSERT INTO users VALUES ('user', '계정 검증', NULL, 'active', 0, 0)").run();
  await DB.prepare(`INSERT INTO applications VALUES ('nakwol-account-center', '계정', '["https://auth.test/account"]', 'active', 0, 0)`).run();
  await DB.prepare("INSERT INTO application_settings(client_id,access_policy,created_at,updated_at) VALUES ('nakwol-account-center','guest',0,0)").run();
  for (const client of ['nakwol-account-center', 'other-service']) {
    await DB.prepare(`INSERT OR IGNORE INTO applications VALUES (?, ?, '["https://auth.test/account"]', 'active', 0, 0)`).bind(client, client).run();
    await DB.prepare("INSERT INTO access_tokens VALUES (?, 'user', ?, ?, NULL, ?)").bind(await sha256Base64Url(client), client, Date.now() + 60000, Date.now()).run();
  }
  const session = await createSession(env, 'user');
  const otherSession = await createSession(env, 'user');
  const request = (token: string, origin = 'https://auth.test') => app.request('https://auth.test/account/api/recheck', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, Origin: origin, Cookie: 'nakwol_sid=' + session.token },
  }, env);
  assert.equal((await request('missing')).status, 401);
  assert.equal((await request('other-service')).status, 401);
  assert.equal((await request('nakwol-account-center', 'https://evil.test')).status, 403);
  assert.equal(await findSessionUser(env, session.token), 'user');
  const response = await request('nakwol-account-center');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.match(response.headers.get('Set-Cookie') || '', /Max-Age=0/);
  assert.equal(await findSessionUser(env, session.token), null);
  assert.equal(await findSessionUser(env, otherSession.token), 'user');
  assert.equal(await authenticateAccessToken(env, 'other-service', 'other-service'), 'user');
  const next = await app.request('https://auth.test/authorize?client_id=nakwol-account-center&redirect_uri=https%3A%2F%2Fauth.test%2Faccount&code_challenge=fixture&code_challenge_method=S256&state=fixture', {
    headers: { Cookie: 'nakwol_sid=' + session.token },
  }, env);
  assert.equal(next.status, 302);
  assert.match(next.headers.get('Location') || '', /^https:\/\/discord.com\/oauth2\/authorize\?/);
});
