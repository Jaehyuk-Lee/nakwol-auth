import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveNakwolRole } from '../../src/discord';
import type { Env } from '../../src/types';

const root = (path:string) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

const env = {
  NAKWOL_MEMBER_ROLE_ID: '1553600098661957643',
  // Historical deployments may still carry this variable. It must have no
  // authority after the platform-admin split.
  NAKWOL_ADMIN_ROLE_ID: 'discord-admin',
} as unknown as Env;

test('Discord roles can prove membership but can never grant NAKWOL platform admin', () => {
  assert.equal(resolveNakwolRole(env, null), 'user');
  assert.equal(resolveNakwolRole(env, { roles:['discord-admin'] }), 'user');
  assert.equal(resolveNakwolRole(env, { roles:['1553600098661957643'] }), 'member');
  assert.equal(resolveNakwolRole(env, { roles:['1553600098661957643','discord-admin'] }), 'member');
});

test('DATA Ops does not reinterpret membership role after exact AUTH admin-policy verification', async () => {
  const source = await root('services/data/src/ops-auth.ts');
  assert.match(source, /verifyPrincipal/);
  assert.match(source, /DATA_OPS_CLIENT_ID/);
  assert.doesNotMatch(source, /membershipRole\s*!==\s*'admin'/);
  assert.doesNotMatch(source, /membership admin/);
});
