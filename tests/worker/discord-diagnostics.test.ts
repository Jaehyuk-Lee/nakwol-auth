import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCurrentGuildMember } from '../../src/discord';
import type { Env } from '../../src/types';

test('bot lookup errors retain HTTP status without exposing Discord response or token', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const env = { DISCORD_BOT_TOKEN: 'secret-test-token', NAKWOL_GUILD_ID: '1493410906456064112' } as Env;
  for (const status of [401, 403, 429, 500]) {
    globalThis.fetch = async () => new Response('sensitive response', { status });
    await assert.rejects(fetchCurrentGuildMember(env, '1493410906456064113'), {
      message: `DISCORD_MEMBERSHIP_UNAVAILABLE (HTTP ${status})`,
    });
  }
});

test('replacement bot token takes precedence over original bot token', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (_input, init) => {
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bot replacement-token');
    return Response.json({ roles: ['1553600098661957643'] });
  };
  const env = { DISCORD_BOT_TOKEN: 'old-token', DISCORD_BOT_TOKEN2: 'replacement-token', NAKWOL_GUILD_ID: '1493410906456064112' } as Env;
  await fetchCurrentGuildMember(env, '1493410906456064113');
});
