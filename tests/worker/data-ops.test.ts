import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = (path:string) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('DATA Ops uses a dedicated internal AUTH application with exact admin policy and callback', async () => {
  const sql = await root('migrations/0008_data_ops.sql');

  assert.match(sql, /'nakwol-data-ops'/);
  assert.match(sql, /https:\/\/nakwol-data\.sepsd21\.workers\.dev\/ops/);
  assert.match(sql, /'internal'/);
  assert.match(sql, /'admin'/);
  assert.doesNotMatch(sql, /'lab'/);
  assert.match(sql, /ON CONFLICT\(client_id\) DO UPDATE SET/g);
  assert.doesNotMatch(sql, /DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i);
});

test('AUTH admin policy uses explicit platform operators, never Discord membership admin or Lab developer privilege', async () => {
  const policy = await root('src/policy.ts');
  assert.match(policy, /ApplicationAccessPolicy\s*=.*'admin'/s);
  assert.match(policy, /SELECT role_ids FROM memberships/);
  assert.doesNotMatch(policy, /fetchCurrentGuildMember/);
  assert.doesNotMatch(policy, /return Boolean\(user\.membership\?\.is_member\)/);
  assert.match(policy, /FROM auth_operators/);
  assert.match(policy, /isPlatformAdmin/);
  assert.doesNotMatch(policy, /membership\?\.role\s*===\s*'admin'/);
  assert.match(policy, /case 'lab':[\s\S]*getAuthLabPrivilege/);
});

test('platform admin authority migration preserves legacy operators and removes Discord admin semantics', async () => {
  const sql = await root('migrations/0009_platform_admin_authority.sql');
  assert.match(sql, /INSERT INTO auth_operators/);
  assert.match(sql, /FROM memberships/);
  assert.match(sql, /FROM connect_developers/);
  assert.match(sql, /cd\.role = 'operator'/);
  assert.match(sql, /cd\.status = 'active'/);
  assert.match(sql, /UPDATE memberships/);
  assert.match(sql, /WHERE role = 'admin'/);
  assert.match(sql, /THEN 'member'/);
});

test('AUTH production deployment verifies the DATA Ops client after migrations', async () => {
  const workflow = await root('.github/workflows/deploy.yml');
  assert.match(workflow, /nakwol-data-ops/);
});
