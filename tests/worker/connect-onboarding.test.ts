import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../../src/index';
import { connectOnboardingPageHtml } from '../../src/connect-onboarding';

test('public /connect onboarding is available without authentication', async () => {
  const response = await app.fetch(new Request('https://auth.example/connect'));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/html/);
  const html = await response.text();
  assert.match(html, /NAKWOL Connect 시작하기/);
  assert.match(html, /npx --yes nakwol-connect init/);
  assert.match(html, /npx --yes nakwol-connect doctor --json/);
});

test('onboarding teaches protected-by-default AUTH, Connect and DATA paths', () => {
  const html = connectOnboardingPageHtml();
  assert.match(html, /required \+ member 기본값/);
  assert.match(html, /https:\/\/nakwol-auth\.sepsd21\.workers\.dev\/connect\/v1\.js/);
  assert.match(html, /https:\/\/nakwol-auth\.sepsd21\.workers\.dev\/sdk\/v0\.3\.0\/nakwol-auth-web\.js/);
  assert.match(html, /autoSso: true/);
  assert.match(html, /data-auto-sso="false"/);
  assert.match(html, /mountNakwolIdentityMenu/);
  assert.match(html, /data-auth="optional"/);
  assert.match(html, /테스트 페이지, 정적 사이트, Cloudflare Pages라는 이유만으로 optional\/guest를 추론하지 마/);
  assert.match(html, /설치된 Embed\/설정에서 auth=required이고 access policy=member인지 직접 확인/);
  assert.match(html, /https:\/\/github\.com\/goyoung2\/nakwol-auth/);
  assert.match(html, /nakwol-connect data describe --json/);
  assert.match(html, /profile:read \/ profile:write/);
  assert.match(html, /roster:read \/ roster:write/);
  assert.match(html, /equipment:read \/ equipment:write/);
  assert.match(html, /decks:read \/ decks:write/);
  assert.match(html, /data\.accounts\.list\(\)/);
  assert.match(html, /data\.decks\.get\(accountId, deckId\)/);
});

test('onboarding keeps secret handling out of consumer projects', () => {
  const html = connectOnboardingPageHtml();
  assert.match(html, /Discord secret 불필요/);
  assert.match(html, /Discord Client Secret을 보유하지 않습니다/);
  assert.match(html, /Connect CLI token이나 Cloudflare token을 넣지 않습니다/);
  assert.doesNotMatch(html, /client_secret\s*[:=]/i);
  assert.doesNotMatch(html, /CLOUDFLARE_API_TOKEN\s*[:=]/);
  assert.doesNotMatch(html, /Bearer\s+[A-Za-z0-9_-]{16,}/);
});
