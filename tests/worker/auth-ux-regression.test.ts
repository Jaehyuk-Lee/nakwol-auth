import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('AUTH UX v1 preserves OAuth, PKCE, state and CORS security guards', async () => {
  const index = await root('src/index.ts');
  const sdk = await root('src/assets/nakwol-auth-web-v0.2.0.js.txt');

  assert.match(index, /INVALID_REDIRECT_URI/);
  assert.match(index, /method\s*!==\s*'S256'/);
  assert.match(index, /CORS_DENIED/);
  assert.match(index, /isAllowedOrigin/);
  assert.match(sdk, /STATE_OR_PKCE_MISMATCH/);
  assert.match(sdk, /sessionStorage/);
  assert.match(sdk, /code_challenge_method/);
  assert.match(sdk, /'S256'/);
});

test('AUTH runtime contract is version 0.2.0 across package, health and landing routes', async () => {
  const pkg = JSON.parse(await root('package.json')) as { version: string };
  const index = await root('src/index.ts');

  assert.equal(pkg.version, '0.2.0');
  assert.match(index, /version:\s*'0\.2\.0'/);
  assert.match(index, /낙월 통합 인증 서비스 v0\.2/);
  assert.match(index, /href="\/account"/);
  assert.match(index, /href="\/lab"/);
});

test('public docs describe AUTH 0.2 as formally released and preserve production evidence', async () => {
  const sdkDoc = await root('WEB_SDK.md');
  const readme = await root('README.md');
  const handoff = await root('CODEX_HANDOFF.md');

  assert.match(sdkDoc, /v0\.1\.0.*immutable/is);
  assert.match(sdkDoc, /sdk\/v0\.2\.0\/nakwol-auth-web\.js/);
  assert.match(sdkDoc, /mountNakwolIdentityMenu/);
  assert.match(sdkDoc, /--nakwol-auth-accent/);
  assert.match(sdkDoc, /--nakwol-auth-shadow/);
  assert.match(sdkDoc, /\/account/);
  assert.match(sdkDoc, /\/lab/);

  for (const doc of [readme, handoff]) {
    assert.match(doc, /AUTH 0\.2\.0/i);
    assert.match(doc, /auth-v0\.2\.0/i);
    assert.match(doc, /154baf448ee45a7b2bcf6e320f09a65866e1f8af/);
    assert.match(doc, /33373705515/);
    assert.match(doc, /b3540665-6d2a-4f85-a61f-4dbfb8837cad/);
    assert.match(doc, /33373908231/);
    assert.match(doc, /Connect.*0\.4\.0/is);
    assert.match(doc, /DATA.*0\.9\.0/is);
    assert.match(doc, /V1.*V12.*completed/is);
    assert.match(doc, /V8-B.*waiver/is);
    assert.doesNotMatch(doc, /formal.*auth-v0\.2\.0.*pending.*final.*stable/is);
  }
});

test('AUTH v0.2 release notes are a final release record with exact provenance', async () => {
  const notes = await root('docs/releases/2026-08-29-nakwol-auth-v0.2.md');

  assert.match(notes, /Formal Release Record/i);
  assert.match(notes, /Status:\s*\*\*released\*\*/i);
  assert.match(notes, /auth-v0\.2\.0/);
  assert.match(notes, /SDK v0\.2/i);
  assert.match(notes, /Account Center/i);
  assert.match(notes, /Auth Lab/i);
  assert.match(notes, /v0\.1.*immutable/is);
  assert.match(notes, /154baf448ee45a7b2bcf6e320f09a65866e1f8af/);
  assert.match(notes, /33373705515/);
  assert.match(notes, /b3540665-6d2a-4f85-a61f-4dbfb8837cad/);
  assert.match(notes, /33373908231/);
  assert.match(notes, /33374685878/);
  assert.match(notes, /V1.*V12/s);
  assert.match(notes, /V8-B.*waiver/is);
  assert.match(notes, /ops\/release\.json.*disabled/is);
  assert.match(notes, /PR #70/);
  assert.match(notes, /no remaining formal release blocker/i);
});

test('production smoke covers AUTH 0.2, Connect 0.4 and DATA 0.9 without mutating device state', async () => {
  const workflow = await root('.github/workflows/production-smoke.yml');

  assert.match(workflow, /AUTH v0\.2, Connect v0\.4 and DATA v0\.9/);
  assert.match(workflow, /sdk\/v0\.2\.0\/nakwol-auth-web\.js/);
  assert.match(workflow, /\/account/);
  assert.match(workflow, /\/lab/);
  assert.match(workflow, /NAKWOL Connect CLI v0\.4/);
  assert.match(workflow, /"version":"0\.9\.0"/);
  assert.match(workflow, /nakwol-account-center/);
  assert.match(workflow, /nakwol-auth-lab/);
  assert.doesNotMatch(workflow, /connect\/cli\/device\/start/);
  assert.doesNotMatch(workflow, /curl[^\n]*\s-d\s/);
});

test('production deploy ignores test-only changes while keeping runtime and verifier triggers', async () => {
  const workflow = await root('.github/workflows/deploy.yml');

  assert.doesNotMatch(workflow, /^\s*-\s*'tests\/\*\*'\s*$/m);
  assert.doesNotMatch(workflow, /^\s*-\s*'!tests\//m);
  for (const runtimePath of ['src/**', 'packages/**', 'migrations/**', 'scripts/**', 'package.json', 'wrangler.jsonc', '.github/workflows/deploy.yml']) {
    assert.ok(workflow.includes(`'${runtimePath}'`), `AUTH deploy must still watch ${runtimePath}`);
  }

  assert.match(workflow, /connect\/manifest\.json/);
  assert.match(workflow, /"default_auth":"required"/);
  assert.match(workflow, /"default_access_policy":"member"/);
  assert.match(workflow, /grep -qi 'authentication policy is REQUIRED BY DEFAULT' \/tmp\/llms/);
  assert.match(workflow, /grep -q 'auth = required' \/tmp\/llms/);
  assert.match(workflow, /grep -q 'access_policy = member' \/tmp\/llms/);
  assert.match(workflow, /NAKWOL_CONNECT_V07_DEPLOY_OK/);
});
