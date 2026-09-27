import test from 'node:test';
import assert from 'node:assert/strict';
import { getApplicationAccessPolicy, isApplicationAccessAllowed } from '../../src/policy';
import type { Env } from '../../src/types';

function envWithPolicy(accessPolicy: string | null, status = 'active', role = 'user'): Env {
  return {
    DB: {
      prepare(query: string) {
        return {
          bind() {
            return {
              async first() {
                if (query.includes('FROM application_settings')) return accessPolicy == null ? null : { access_policy: accessPolicy };
                if (query.includes('FROM users')) return { id: 'user-1', display_name: 'User', avatar_url: null, status };
                if (query.includes('FROM memberships')) return { user_id: 'user-1', guild_id: 'guild-1', is_guild_member: role === 'user' ? 0 : 1, role, status: 'active', checked_at: 0 };
                return null;
              },
            };
          },
        };
      },
    } as unknown as D1Database,
  } as Env;
}

test('application access policy is member when settings are missing', async () => {
  assert.equal(await getApplicationAccessPolicy(envWithPolicy(null), 'missing-app'), 'member');
});

test('application access policy fails closed to member when stored value is malformed', async () => {
  assert.equal(await getApplicationAccessPolicy(envWithPolicy('unexpected'), 'broken-app'), 'member');
  assert.equal(await getApplicationAccessPolicy(envWithPolicy(''), 'empty-policy-app'), 'member');
});

test('guest policy and stored public alias resolve to guest', async () => {
  assert.equal(await getApplicationAccessPolicy(envWithPolicy('guest'), 'guest-app'), 'guest');
  assert.equal(await getApplicationAccessPolicy(envWithPolicy('public'), 'legacy-app'), 'guest');
  assert.equal(await getApplicationAccessPolicy(envWithPolicy('member'), 'member-app'), 'member');
  assert.equal(await getApplicationAccessPolicy(envWithPolicy('admin'), 'admin-app'), 'admin');
  assert.equal(await getApplicationAccessPolicy(envWithPolicy('lab'), 'lab-app'), 'lab');
});

test('guest requires an active Discord login while member still requires membership', async () => {
  assert.equal(await isApplicationAccessAllowed(envWithPolicy('guest'), 'user-1', 'guest-app'), true);
  assert.equal(await isApplicationAccessAllowed(envWithPolicy('public'), 'user-1', 'legacy-app'), true);
  assert.equal(await isApplicationAccessAllowed(envWithPolicy('guest', 'disabled'), 'user-1', 'guest-app'), false);
  assert.equal(await isApplicationAccessAllowed(envWithPolicy('member'), 'user-1', 'member-app'), false);
  assert.equal(await isApplicationAccessAllowed(envWithPolicy('member', 'active', 'member'), 'user-1', 'member-app'), true);
});
