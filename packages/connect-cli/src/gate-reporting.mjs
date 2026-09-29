import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { readProjectConfig } from './config.mjs';
import { ensureSession } from './session.mjs';
import { ConnectApi } from './api.mjs';

async function project(options) {
  const root = options.root || process.cwd();
  const config = await readProjectConfig(root);
  if (!config?.clientId || !config.protection?.siteUrl) throw new Error('Install server protection before configuring reports.');
  const origin = new URL(config.authOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== config.authOrigin) throw new Error('Report authentication requires an exact HTTPS AUTH origin.');
  return { root, config };
}

export async function manageReportToken(options = {}) {
  const { root, config } = await project(options);
  let outputPath;
  if (!options.revoke) {
    if (!options.outputFile) throw new Error('--output-file outside the project is required. The secret is never printed.');
    outputPath = resolve(options.outputFile);
    const parent = await realpath(dirname(outputPath));
    const distance = relative(await realpath(root), parent);
    if (!distance || (distance !== '..' && !distance.startsWith('..' + sep) && !isAbsolute(distance))) throw new Error('Save the reporting secret outside the project.');
  }
  const session = await ensureSession({ authOrigin: config.authOrigin, sessionPath: options.sessionPath, noOpen: options.noOpen, output:options.output || console.log, fetchImpl:options.fetchImpl || fetch });
  const api = new ConnectApi({authOrigin:config.authOrigin, accessToken:session.accessToken, fetchImpl:options.fetchImpl || fetch});
  const path = `/connect/cli/apps/${encodeURIComponent(config.clientId)}/gate-report-token`;
  if (options.revoke) { await api.request(path,{method:'DELETE',redirect:'error'}); return {ok:true,status:'revoked',clientId:config.clientId}; }
  // Reserve the output before rotating the server credential; never overwrite an existing secret.
  const { open } = await import('node:fs/promises');
  const file = await open(outputPath,'wx',0o600);
  try {
    const {payload} = await api.request(path,{method:'POST',redirect:'error'});
    if (!payload?.data?.token) throw new Error('AUTH did not return a reporting credential.');
    await file.writeFile(payload.data.token,'utf8');
    return {ok:true,status:'issued',clientId:config.clientId,expiresAt:payload.data.expires_at,outputFile:outputPath};
  } finally { await file.close(); }
}

export function summarizeGateReport(report, config, options = {}) {
  if (!/^[a-f0-9]{40}$/i.test(options.commit || '')) throw new Error('--commit requires the deployed 40-character Git SHA.');
  if (!Array.isArray(report.checks) || !report.origins?.includes(config.protection.siteUrl)) throw new Error('The verification report must belong to the configured site.');
  const failures = report.checks.filter(check => check.ok !== true);
  const complete = report.checks.length > 0 && report.requestCount === report.checks.length && report.inspectionScope === 'installed-assets';
  const versions = report.observedRuntimeVersions || [];
  const observed = versions.length===1 && /^[0-9]+[.][0-9]+[.][0-9]+$/.test(versions[0]) ? versions[0] : null;
  const verified = complete && !failures.length && report.ok === true && report.expectedRuntime === config.protection.runtimeVersion && observed === report.expectedRuntime;
  const status = verified ? 'verified' : complete && failures.some(check => /^HTTP [234][0-9]{2};/.test(check.detail || '')) ? 'failed' : 'indeterminate';
  return {schema_version:1,installed_version:config.protection.runtimeVersion,runtime_version:observed,commit_sha:options.commit,status,checked_count:report.checks.length,failure_count:failures.length,service_url:new URL(config.protection.siteUrl).origin,
    ...(options.deploymentId ? {deployment_id:options.deploymentId} : {})};
}

export async function reportProtection(options = {}) {
  const {config} = await project(options);
  const token = options.reportToken || process.env.NAKWOL_GATE_REPORT_TOKEN;
  const trustedOrigin = options.reportAuthOrigin || process.env.NAKWOL_REPORT_AUTH_ORIGIN;
  if (!token || trustedOrigin !== config.authOrigin) throw new Error('Set NAKWOL_GATE_REPORT_TOKEN and NAKWOL_REPORT_AUTH_ORIGIN matching the configured AUTH origin.');
  if (!options.report) throw new Error('--report is required.');
  const report = JSON.parse(await readFile(options.report,'utf8'));
  let summary;
  if (report.rollbackAccepted === true && report.failedVerification) {
    summary = summarizeGateReport(report.recoveryVerification || report.failedVerification,config,options);
    const recovery = report.recoveryVerification;
    const previous = config.protection.rollback?.previousVerified;
    const recovered = recovery?.ok === true && recovery.requestCount > 0 && recovery.checks?.length === recovery.requestCount && recovery.checks.every(check=>check.ok===true) && recovery.expectedRuntime === previous?.runtimeVersion && recovery.observedRuntimeVersions?.length === 1 && recovery.observedRuntimeVersions[0] === previous?.runtimeVersion;
    summary.status = recovered ? 'recovered' : 'rollback-failed';
    summary.deployment_id = report.recoveryDeploymentId || report.targetDeploymentId;
    summary.previous_deployment_id = report.failedDeploymentId;
  } else summary = summarizeGateReport(report,config,options);
  const response = await (options.fetchImpl || fetch)(`${trustedOrigin}/connect/gate-reports/${encodeURIComponent(config.clientId)}`,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(summary),
  });
  if (!response.ok) throw new Error(`Gate reporting failed (HTTP ${response.status}).`);
  await response.body?.cancel();
  return {ok:true,status:'reported',summary};
}
