import test from 'node:test';
import assert from 'node:assert/strict';
import { isApplicationAccessAllowed } from '../../src/policy';
import type { Env } from '../../src/types';

type Role = 'user' | 'member' | 'admin';

type MembershipState = {
  user_id: string;
  guild_id: string;
  is_guild_member: number;
  role: Role;
  status: 'active' | 'inactive';
  checked_at: number;
};

function createV8Env() {
  let membership: MembershipState | null = null;

  const env = {
    NAKWOL_GUILD_ID: '1493410906456064112',
    NAKWOL_MEMBER_ROLE_ID: '1553600098661957643',
    DISCORD_BOT_TOKEN: 'test-bot',
    NAKWOL_ADMIN_ROLE_ID: 'role-admin',
    DISCORD_CLIENT_ID: 'discord-client',
    DISCORD_CLIENT_SECRET: 'discord-secret',
    AUTH_ORIGIN: 'https://auth.example.test',
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async first() {
                if (sql.includes("SELECT provider_user_id FROM auth_identities")) {
                  return { provider_user_id: '1493410906456064113' };
                }
                if (sql.includes("FROM auth_identities WHERE provider = 'discord'")) {
                  return { user_id: 'usr_v8' };
                }
                if (sql.includes('SELECT access_policy FROM application_settings')) {
                  return { access_policy: 'member' };
                }
                if (sql.includes('SELECT id, display_name, avatar_url, status FROM users')) {
                  return {
                    id: 'usr_v8',
                    display_name: 'V8 Tester',
                    avatar_url: null,
                    status: 'active',
                  };
                }
                if (sql.includes('SELECT user_id, guild_id, is_guild_member, role, status, checked_at FROM memberships')) {
                  return membership;
                }
                return null;
              },
              async run() {
                if (sql.includes('INSERT INTO memberships')) {
                  membership = {
                    user_id: String(args[0]),
                    guild_id: String(args[1]),
                    is_guild_member: Number(args[2]),
                    role: args[3] as Role,
                    status: args[4] as 'active' | 'inactive',
                    checked_at: Number(args[5]),
                  };
                }
                return { success: true };
              },
            };
          },
        };
      },
    },
  } as unknown as Env;

  return {
    env,
    membership: () => membership,
  };
}

test('V8 refreshes Discord member -> user -> member and access policy follows the refreshed membership', async () => {
  const store = await import('../../src/store');
  const refreshDiscordMembership = (store as typeof store & {
    refreshDiscordMembership?: (
      env: Env,
      discordAccessToken: string,
    ) => Promise<{ userId: string; role: Role }>;
  }).refreshDiscordMembership;

  assert.equal(
    typeof refreshDiscordMembership,
    'function',
    'V8 needs one testable fresh-Discord membership refresh orchestration path',
  );
  if (!refreshDiscordMembership) return;

  const { env, membership } = createV8Env();
  const originalFetch = globalThis.fetch;
  let roles = ['1553600098661957643'];

  globalThis.fetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/users/@me')) {
      return new Response(JSON.stringify({
        id: '1493410906456064113',
        username: 'v8-user',
        global_name: 'V8 Tester',
        avatar: null,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/users/@me/guilds/1493410906456064112/member') || url.includes('/guilds/1493410906456064112/members/1493410906456064113')) {
      return new Response(JSON.stringify({ nick: 'V8 Tester', roles }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected Discord URL: ${url}`);
  };

  try {
    const asMember = await refreshDiscordMembership(env, 'discord-token-v8');
    assert.equal(asMember.userId, 'usr_v8');
    assert.equal(asMember.role, 'member');
    assert.equal(membership()?.role, 'member');
    assert.equal(membership()?.status, 'active');
    assert.equal(await isApplicationAccessAllowed(env, 'usr_v8', 'siege-calculator'), true);

    roles = [];
    const asUser = await refreshDiscordMembership(env, 'discord-token-v8');
    assert.equal(asUser.role, 'user');
    assert.equal(membership()?.is_guild_member, 1, 'role removal does not mean the Discord user left the guild');
    assert.equal(membership()?.role, 'user');
    assert.equal(membership()?.status, 'inactive');
    assert.equal(await isApplicationAccessAllowed(env, 'usr_v8', 'siege-calculator'), false);

    roles = ['1553600098661957643'];
    const restored = await refreshDiscordMembership(env, 'discord-token-v8');
    assert.equal(restored.role, 'member');
    assert.equal(membership()?.role, 'member');
    assert.equal(membership()?.status, 'active');
    assert.equal(await isApplicationAccessAllowed(env, 'usr_v8', 'siege-calculator'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
