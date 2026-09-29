import { readProjectConfig } from './config.mjs';
import { verifyProtection } from './protection-verify.mjs';

const identifier = /^[a-zA-Z0-9_-]+$/;
function requireId(value, name) {
  if (typeof value !== 'string' || !identifier.test(value)) throw new Error(`Invalid rollback ${name}.`);
  return value;
}
function validateTarget(config) {
  const policy = config?.protection?.rollback;
  if (policy?.enabled !== true) throw new Error('Deployment rollback requires explicit opt-in.');
  if (!['cloudflare-workers', 'cloudflare-pages'].includes(policy.provider)) throw new Error('Unsupported rollback provider.');
  if (config.protection.provider !== policy.provider) throw new Error('Rollback provider differs from installed protection provider.');
  requireId(policy.accountId, 'accountId');
  requireId(policy.provider === 'cloudflare-workers' ? policy.scriptName : policy.projectName, 'resource name');
  if (policy.serializedDeployments !== true) throw new Error('Rollback requires externally serialized deployments.');
  return policy;
}

export function validateRollbackConfig(config) {
  const policy = validateTarget(config);
  const previous = policy.previousVerified;
  requireId(previous?.deploymentId, 'previous deployment ID');
  if (!/^\d+\.\d+\.\d+$/.test(previous.runtimeVersion || '')) throw new Error('Previous verified runtime version is required.');
  const report = previous.report;
  if (report?.ok !== true || report.deploymentId !== previous.deploymentId || report.protectionStatus !== 'anonymous-blocking-verified' || !report.checks?.length || !report.checks.every(c => c.ok === true) || report.inspectionScope !== 'installed-assets' || report.requestCount !== report.checks.length || report.requestCount < 4 || !Number.isFinite(Date.parse(report.checkedAt)) || report.observedRuntimeVersions?.length !== 1 || report.observedRuntimeVersions[0] !== previous.runtimeVersion || !report.origins?.includes(config.protection.siteUrl) || report.expectedRuntime !== previous.runtimeVersion) throw new Error('Previous deployment needs a matching successful verification report.');
  return policy;
}


function cloudflareClient(policy, options) {
  const token = options.apiToken || process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN is required for deployment rollback.');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const base = `https://api.cloudflare.com/client/v4/accounts/${policy.accountId}`;
  return async function api(path, body) {
    const response = await fetchImpl(base + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    if (!response.ok || data.success !== true || !data.result) throw new Error(`Cloudflare rollback API failed (HTTP ${response.status}).`);
    return data.result;
  };
}

export async function readCurrentDeployment(config, options = {}) {
  const policy = validateTarget(config);
  const api = cloudflareClient(policy, options);
  const workers = policy.provider === 'cloudflare-workers';
  const resource = workers ? `/workers/scripts/${policy.scriptName}/deployments` : `/pages/projects/${policy.projectName}`;
  const result = await api(resource);
  const deployment = workers ? result.deployments?.[0] : result.canonical_deployment;
  requireId(deployment?.id, 'current deployment ID');
  if (!Number.isFinite(Date.parse(deployment.created_on))) throw new Error('Cannot establish current deployment timestamp.');
  return deployment;
}

// No history guessing: the deployment IDs and evidence are supplied by the serialized deployment job.
export async function rollbackProtection(options = {}) {
  const root = options.root || process.cwd();
  const config = options.config || await readProjectConfig(root);
  const policy = validateRollbackConfig(config);
  const failedId = requireId(options.failedDeploymentId, 'failed deployment ID');
  const previous = policy.previousVerified;
  if (failedId === previous.deploymentId) throw new Error('Failed and previous deployment IDs must differ.');
  const failure = options.failureReport;
  const observedExposure = failure?.checks?.some(c => c.ok === false && /^HTTP 2\d\d;/.test(c.detail || ''));
  if (failure?.ok !== false || failure.deploymentId !== failedId || !failure.origins?.includes(config.protection.siteUrl) || !observedExposure) {
    return { ok: false, rollbackAccepted: false, status: 'not-eligible', recoveryVerification: null };
  }
  const api = cloudflareClient(policy, options);
  const workers = policy.provider === 'cloudflare-workers';
  const resource = workers ? `/workers/scripts/${policy.scriptName}/deployments` : `/pages/projects/${policy.projectName}`;
  const current = () => readCurrentDeployment(config, options);
  const active = await current();
  if (active?.id !== failedId) throw new Error('Current deployment differs from the failed deployment; rollback refused.');
  const target = await api(workers ? `${resource}/${previous.deploymentId}` : `${resource}/deployments/${previous.deploymentId}`);
  if (target.id !== previous.deploymentId || !(Date.parse(target.created_on) < Date.parse(active.created_on))) throw new Error('Rollback target must be the specified older deployment.');
  if (workers) {
    if (!Array.isArray(target.versions) || target.versions.length !== 1 || target.versions[0].percentage !== 100) throw new Error('Rollback requires a fully deployed verified Worker version.');
    requireId(target.versions[0].version_id, 'Worker version ID');
  } else if (target.environment !== 'production' || target.latest_stage?.status !== 'success') throw new Error('Pages rollback target must be a successful production deployment.');
  if ((await current())?.id !== failedId) throw new Error('Deployment changed before rollback; rollback refused.');
  const result = await api(workers ? resource : `${resource}/deployments/${previous.deploymentId}/rollback`, workers ? { strategy: 'percentage', versions: target.versions.map(({ version_id, percentage }) => ({ version_id, percentage })) } : {});
  const response = { ok: false, rollbackAccepted: true, status: 'recovery-unverified', failedDeploymentId: failedId, targetDeploymentId: previous.deploymentId, recoveryDeploymentId: result.id || null, recoveryVerification: null };
  try {
    const verify = options.verifyImpl || verifyProtection;
    response.recoveryVerification = await verify({ root, url: config.protection.siteUrl, alternateOrigins: previous.report.origins.filter(origin => origin !== config.protection.siteUrl).join(','), expectRuntime: previous.runtimeVersion, fetchImpl: options.verificationFetchImpl || globalThis.fetch });
    response.ok = response.recoveryVerification.ok === true;
    response.status = response.ok ? 'recovery-verified' : 'recovery-failed';
  } catch {
    response.status = 'recovery-indeterminate';
  }
  return response;
}
