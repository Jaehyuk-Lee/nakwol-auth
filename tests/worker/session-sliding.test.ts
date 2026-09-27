import test from 'node:test';
import assert from 'node:assert/strict';

const DAY = 24 * 60 * 60 * 1000;

type Call = { sql: string; args: unknown[] };

function fakeEnv(row: Record<string, unknown> | null) {
  const calls: Call[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            calls.push({ sql, args });
            return {
              first: async () => row,
              run: async () => ({ success: true }),
            };
          },
        };
      },
    },
  };
  return { env, calls };
}

test('central session lasts 10 idle days and at most 30 days from login', async () => {
  const store = await import('../../src/store');
  assert.equal(store.SESSION_IDLE_TTL_MS, 10 * DAY);
  assert.equal(store.SESSION_ABSOLUTE_TTL_MS, 30 * DAY);

  const created = 1_000_000_000_000;
  assert.equal(store.sessionExpiry(created, created), created + 10 * DAY);
  assert.equal(store.sessionExpiry(created, created + 5 * DAY), created + 15 * DAY);
  // 25일째 사용하면 10일 연장이 아니라 로그인 후 30일에서 멈춘다.
  assert.equal(store.sessionExpiry(created, created + 25 * DAY), created + 30 * DAY);
});

test('new session stores a 10-day expiry and a 30-day cookie', async () => {
  const store = await import('../../src/store');
  const { env, calls } = fakeEnv(null);
  const before = Date.now();
  const session = await store.createSession(env as never, 'usr_sliding');

  assert.equal(session.maxAgeSeconds, 30 * 24 * 60 * 60);
  const insert = calls.find((c) => /INSERT INTO auth_sessions/.test(c.sql))!;
  const [, , expiresAt, createdAt] = insert.args as number[];
  assert.ok(createdAt >= before);
  assert.equal(expiresAt, createdAt + 10 * DAY);
});

test('using a session slides its expiry forward but never past 30 days', async () => {
  const store = await import('../../src/store');
  const now = Date.now();
  const createdAt = now - 25 * DAY;
  const { env, calls } = fakeEnv({ user_id: 'usr_sliding', expires_at: now + DAY, created_at: createdAt });

  const userId = await store.findSessionUser(env as never, 'raw-session-token');
  assert.equal(userId, 'usr_sliding');

  const select = calls.find((c) => /SELECT user_id, expires_at, created_at FROM auth_sessions/.test(c.sql))!;
  assert.match(select.sql, /expires_at > \? AND created_at > \?/);
  const absoluteFloor = select.args[2] as number;
  assert.ok(Math.abs(absoluteFloor - (now - 30 * DAY)) < 5000);

  const update = calls.find((c) => /UPDATE auth_sessions SET last_used_at = \?, expires_at = \?/.test(c.sql))!;
  assert.equal(update.args[1], createdAt + 30 * DAY);
});

test('expired or unknown sessions are not extended', async () => {
  const store = await import('../../src/store');
  const { env, calls } = fakeEnv(null);
  assert.equal(await store.findSessionUser(env as never, 'raw-session-token'), null);
  assert.equal(calls.some((c) => /UPDATE auth_sessions/.test(c.sql)), false);
  assert.equal(await store.findSessionUser(env as never, undefined), null);
});
