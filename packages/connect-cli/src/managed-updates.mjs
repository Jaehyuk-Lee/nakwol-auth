import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { readProjectConfig, writeProjectConfig } from './config.mjs';
import { reportWorkflowStep } from './report-workflow.mjs';
import { inspectProtection } from './protection.mjs';
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const workflowFiles = ['.github/dependabot.yml', '.github/workflows/nakwol-gate-check.yml', '.github/workflows/nakwol-gate-deployed.yml'];

export async function automateProtection(options = {}) {
  const root = options.root || process.cwd();
  const config = await readProjectConfig(root);
  const inspection = await inspectProtection(root, config);
  if (!inspection.ok) throw new Error(inspection.detail);
  const environment = options.environment || 'production';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(environment)) throw new Error('--environment must be a simple GitHub deployment environment name.');
  // Validate every output before making any changes. Never overwrite operator CI.
  for (const name of ['.github', '.github/workflows', 'package.json', ...workflowFiles, '.github/dependabot.yaml']) {
    try {
      const entry = await lstat(join(root, name));
      if (entry.isSymbolicLink()) throw new Error(`Symbolic link is not supported: ${name}`);
      if (workflowFiles.includes(name) || name === '.github/dependabot.yaml') throw new Error(`Existing automation must be merged manually: ${name}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (pkg.workspaces || pkg.packageManager && !pkg.packageManager.startsWith('npm@')) throw new Error('Managed updates v1 require a root npm project without workspaces.');
  if (pkg.dependencies?.['nakwol-connect']) throw new Error('Keep one nakwol-connect dependency: review the existing production dependency first.');
  const oldHook = pkg.scripts?.['nakwol:gate'];
  if (!/^npx --yes nakwol-connect@(?:latest|~?\d+\.\d+\.\d+) protect update$/.test(oldHook || '') && oldHook !== 'nakwol-connect protect update') throw new Error('Custom nakwol:gate hook must be reviewed manually.');
  const updated = { ...pkg, devDependencies: { ...pkg.devDependencies, 'nakwol-connect': version }, scripts: { ...pkg.scripts, 'nakwol:gate': 'nakwol-connect protect update' } };
  const dependabot = `version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    versioning-strategy: increase
    allow:
      - dependency-name: nakwol-connect
    ignore:
      - dependency-name: nakwol-connect
        update-types: [version-update:semver-major, version-update:semver-minor]
    open-pull-requests-limit: 1
`;
  const check = `name: NAKWOL gate update check
on: pull_request
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm run nakwol:gate
      - run: node node_modules/nakwol-connect/bin/nakwol-connect.mjs protect status --offline --json
`;
  let deployed = `name: NAKWOL deployed gate verification
on:
  deployment_status:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  verify:
    if: >-
      github.event_name == 'workflow_dispatch' ||
      (github.event.deployment_status.state == 'success' && github.event.deployment.environment == '${environment}')
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.deployment.sha || github.sha }}
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm run nakwol:gate
      - name: Check every built protected asset on the configured production site
        run: |
          mkdir -p .nakwol/reports
          node node_modules/nakwol-connect/bin/nakwol-connect.mjs protect verify --expect-runtime installed --json > .nakwol/reports/deployed.json
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: nakwol-gate-\${{ github.event.deployment.sha || github.sha }}-\${{ github.run_id }}
          path: .nakwol/reports/deployed.json
          if-no-files-found: warn
`;
  if (options.reports) {
    const branch = String.fromCharCode(36) + '{{ github.event.repository.default_branch }}';
    const trusted = `      - name: Require deployed code from the trusted default branch
        id: trusted
        env:
          DEFAULT_BRANCH: ${branch}
        run: |
          git fetch --no-tags origin "$DEFAULT_BRANCH"
          git merge-base --is-ancestor HEAD FETCH_HEAD
`;
    deployed = deployed.replace('    timeout-minutes: 30', '    environment: ' + environment + String.fromCharCode(10) + '    timeout-minutes: 30');
    deployed = deployed.replace('      - uses: actions/setup-node@v4', () => trusted + '      - uses: actions/setup-node@v4');
    deployed = deployed.replace('      - uses: actions/upload-artifact@v4', () => reportWorkflowStep(config.authOrigin) + '      - uses: actions/upload-artifact@v4');
  }
  await mkdir(join(root, '.github/workflows'), { recursive: true });
  for (const [i, content] of [dependabot, check, deployed].entries()) await writeFile(join(root, workflowFiles[i]), content, {flag:'wx'});
  await writeFile(join(root, 'package.json'), JSON.stringify(updated, null, 2) + '\n');
  await writeProjectConfig(root, {...config, protection:{...config.protection, updateChannel:'managed', automation:{environment, version:2, reports:Boolean(options.reports)}}});
  return {ok:true, status:'configured-not-deployed', version, files:workflowFiles, nextSteps:[
    'Run npm install --package-lock-only --ignore-scripts; review and commit package.json, package-lock.json, .nakwol-connect.json and generated workflows.',
    'Run npm ci, npm run build and npm run nakwol:gate. Commit generated gate changes where tracked.',
    'Merge the setup PR to the default branch to enable Dependabot. Patch PRs require review; other updates need explicit version selection.',
    `Connect existing deployment to GitHub deployment_status (${environment}), or manually dispatch verification at the deployed commit ref.`,
    'Require the PR check in branch rules. On verification failure restore the previous host deployment and verify again. Automatic rollback is not installed.',
  ]};
}

export async function protectionStatus(options = {}) {
  const root = options.root || process.cwd();
  const config = await readProjectConfig(root);
  const local = await inspectProtection(root, config);
  const result = {ok:local.ok, local, installedPackageVersion:version, configuredRuntime:config?.protection?.runtimeVersion || null, updateChannel:config?.protection?.updateChannel || null, deployed:{status:'not-checked', runtimeVersion:null}};
  if (!local.ok || options.offline) return result;
  try {
    const url = new URL(config.protection.siteUrl); url.searchParams.set('__nakwol_version',Date.now().toString());
    const response = await (options.fetchImpl || fetch)(url,{method:'HEAD',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(10000)});
    const runtime = response.headers.get('X-Nakwol-Runtime');
    const blocked = [401,403].includes(response.status) && response.headers.get('X-Nakwol-Gate')==='v1' && (response.headers.get('Cache-Control')||'').includes('no-store');
    result.deployed = {status:!blocked?'unexpected-response':!runtime?'version-unknown':runtime===result.configuredRuntime?'version-match':'version-mismatch', runtimeVersion:runtime, checkedAt:new Date().toISOString(), httpStatus:response.status, scope:'root-HEAD-only'};
    result.ok = blocked && runtime===result.configuredRuntime;
    await response.body?.cancel();
  } catch(error) {result.ok=false;result.deployed={status:'unreachable',runtimeVersion:null,detail:error.message};}
  return result;
}
