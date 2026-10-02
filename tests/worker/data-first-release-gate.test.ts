import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const repo = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('AUTH production deploy waits for live DATA v0.9 OpenAPI before Worker mutation', async () => {
  const workflow = await repo('.github/workflows/deploy.yml');
  const wait = 'Wait for required DATA v0.9 contract';
  const deploy = 'Deploy existing Worker without replacing dashboard variables';
  assert.match(workflow, new RegExp(wait.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok(workflow.indexOf(wait) < workflow.indexOf(deploy), 'DATA readiness gate must run before AUTH deploy');
  assert.match(workflow, /nakwol-data\.sepsd21\.workers\.dev/);
  assert.match(workflow, /"version":"0\.9\.0"/);
  // DATA may still be on schema 3 or already on 4 while both stable deploys run.
  assert.match(workflow, /"schema_version":\(3\|4\)/);
  assert.match(workflow, /openapi\.json/);
  assert.match(workflow, /"openapi":"3\.1\.0"/);
  assert.match(workflow, /NAKWOL_DATA_V09_READY_FOR_AUTH_DEPLOY/);
  assert.match(workflow, /refusing AUTH\/Connect deploy/);
});

test('stable promotion carries the DATA v0.9 deploy trigger', async () => {
  const flag = await repo('ops/data-deploy.flag');
  assert.match(flag, /nakwol-data 0\.9\.0/i);
  assert.match(flag, /openapi/i);
});
