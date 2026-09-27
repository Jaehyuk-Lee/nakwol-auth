import { detectProject } from './project.mjs';
import { installIntegration, inspectIntegration, removeIntegration } from './integration.mjs';
import { readProjectConfig, writeProjectConfig, removeProjectConfig } from './config.mjs';
import { ensureSession, readSession, defaultSessionPath } from './session.mjs';
import { ConnectApi } from './api.mjs';
import { ConnectDataApi } from './data-api.mjs';
import { validateDataOpenApi } from './discovery.mjs';
import { DEFAULT_DATA_ORIGIN, parseDataScopes, sameScopes } from './scopes.mjs';
import { inspectProtection } from './protection.mjs';
import { verifyProtection } from './protection-verify.mjs';

export const DEFAULT_AUTH_ORIGIN = 'https://nakwol-auth.sepsd21.workers.dev';
export { DEFAULT_DATA_ORIGIN };

async function authenticatedApis(options = {}) {
  const authOrigin = options.authOrigin || DEFAULT_AUTH_ORIGIN;
  const dataOrigin = String(options.dataOrigin || DEFAULT_DATA_ORIGIN).replace(/\/$/, '');
  const session = await ensureSession({
    authOrigin,
    sessionPath: options.sessionPath || defaultSessionPath(),
    noOpen: Boolean(options.noOpen),
    output: options.output || console.log,
    fetchImpl: options.fetchImpl || globalThis.fetch,
    sleep: options.sleep,
  });
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  return {
    session,
    authApi: new ConnectApi({ authOrigin, accessToken: session.accessToken, fetchImpl }),
    dataApi: new ConnectDataApi({ dataOrigin, accessToken: session.accessToken, fetchImpl }),
    dataOrigin,
  };
}

function normalizeAuthMode(value) {
  const mode = String(value || 'required').trim().toLowerCase();
  if (!['required', 'optional'].includes(mode)) throw new Error('--auth는 required 또는 optional이어야 합니다.');
  return mode;
}

function normalizeAccessPolicy(value) {
  if (value === undefined) return null;
  const policy = String(value).trim().toLowerCase();
  if (!['guest', 'member', 'admin', 'public'].includes(policy)) throw new Error('--access-policy는 guest, member, admin 중 하나여야 합니다.');
  return policy === 'public' ? 'guest' : policy;
}

function desiredIntegration(existingConfig, options = {}) {
  const dataOrigin = String(options.dataOrigin || existingConfig?.dataOrigin || DEFAULT_DATA_ORIGIN).replace(/\/$/, '');
  const dataScopes = options.scopes !== undefined ? parseDataScopes(options.scopes) : parseDataScopes(existingConfig?.dataScopes || []);
  const authMode = options.authMode !== undefined ? normalizeAuthMode(options.authMode) : normalizeAuthMode(existingConfig?.authMode || 'required');
  if (existingConfig?.protection && authMode === 'optional') throw new Error('서버 보호가 설치된 사이트는 optional 전환 전에 배포 구조를 검토해야 합니다.');
  return { dataOrigin, dataScopes, authMode, serverGate: Boolean(existingConfig?.protection), siteUrl:existingConfig?.protection?.siteUrl };
}

async function resolveApp(root, project, existingConfig, api, options) {
  let app;
  const accessPolicy = normalizeAccessPolicy(options.accessPolicy);
  if (existingConfig?.clientId) {
    try { app = (await api.getApp(existingConfig.clientId)).data; }
    catch (error) { if (error?.status === 404) app = null; else throw error; }
  }
  if (!app) {
    const redirectUris = [...new Set([
      ...(existingConfig?.redirectUris || []),
      ...(options.url ? [options.url] : []),
      ...(project.defaultRedirectUri ? [project.defaultRedirectUri] : []),
    ])];
    app = (await api.createApp({
      name: options.name || project.projectName,
      client_id: options.clientId || existingConfig?.clientId || project.projectName,
      homepage_url: options.url || null,
      framework: project.framework,
      access_policy: accessPolicy || 'member',
      redirect_uris: redirectUris,
    })).data;
  } else {
    if (options.url && !app.redirect_uris.includes(options.url)) {
      app = (await api.addRedirect(app.client_id, options.url)).data;
    }
    if (accessPolicy && app.access_policy !== accessPolicy) {
      app = (await api.patchApp(app.client_id, { access_policy: accessPolicy })).data;
    }
  }
  return app;
}

export async function initProject(options = {}) {
  const root = options.root || process.cwd();
  const authOrigin = options.authOrigin || DEFAULT_AUTH_ORIGIN;
  const output = options.output || console.log;
  const project = await detectProject(root);
  if (!project.targetFile || project.framework === 'unknown') throw new Error('지원되는 웹 프로젝트를 찾지 못했습니다.');
  const existingConfig = await readProjectConfig(root);
  const desired = desiredIntegration(existingConfig, options);
  const { authApi, dataApi } = await authenticatedApis({ ...options, authOrigin, dataOrigin: desired.dataOrigin, output });
  const app = await resolveApp(root, project, existingConfig, authApi, options);
  const dataState = (await dataApi.setScopes(app.client_id, desired.dataScopes)).data;
  const install = await installIntegration(root, project, app.client_id, desired);
  const config = await writeProjectConfig(root, {
    clientId: app.client_id,
    framework: project.framework,
    redirectUris: app.redirect_uris,
    integration: install.integration,
    accessPolicy: app.access_policy,
    authOrigin,
    ...(existingConfig?.protection ? { protection: existingConfig.protection } : {}),
    ...desired,
  });
  const doctor = await doctorProject({ ...options, url: undefined, connectionOnly: true, root, authOrigin, dataOrigin: desired.dataOrigin, offline: false });
  if (!doctor.ok) throw new Error(`Connect 설치 검증 실패: ${doctor.checks.filter((c) => !c.ok).map((c) => c.name).join(', ')}`);
  output(`NAKWOL Connect + DATA 연결 완료: ${app.client_id} (${config.authMode}). 서버 보호: ${doctor.protectionStatus}.`);
  if (config.authMode === 'required') output('HTML/파일 직접 접근 차단은 protect install → 배포 → protect verify가 필요합니다. Embed 검사 통과는 보호 완료가 아닙니다.');
  return { clientId: app.client_id, project, config, app, data: dataState, doctor };
}

export async function doctorProject(options = {}) {
  const root = options.root || process.cwd();
  const config = await readProjectConfig(root);
  const project = await detectProject(root);
  const marker = await inspectIntegration(root, project);
  const checks = [
    { name:'config', ok:Boolean(config?.clientId), detail:config?.clientId || '.nakwol-connect.json missing' },
    { name:'framework', ok:Boolean(project.targetFile && project.framework !== 'unknown'), detail:project.framework },
    { name:'marker', ok:marker.present, detail:project.targetFile || 'target missing' },
  ];
  if (config?.clientId && marker.present) {
    checks.push({ name:'marker_client_id', ok:marker.clientId === config.clientId, detail:marker.clientId || 'missing' });
    checks.push({ name:'marker_auth_mode', ok:marker.authMode === config.authMode, detail:marker.authMode || 'required' });
    if (config.version === 2) {
      checks.push({ name:'marker_data_origin', ok:marker.dataOrigin === config.dataOrigin, detail:marker.dataOrigin || 'missing' });
      checks.push({ name:'marker_data_scopes', ok:sameScopes(marker.dataScopes, config.dataScopes), detail:marker.dataScopes.join(',') });
    }
  }
  if (!options.offline && config?.clientId) {
    const session = await readSession(options.sessionPath || defaultSessionPath());
    if (!session?.accessToken) checks.push({ name:'central_app', ok:false, detail:'CLI session missing; run init' });
    else {
      const authOrigin = options.authOrigin || DEFAULT_AUTH_ORIGIN;
      const fetchImpl = options.fetchImpl || globalThis.fetch;
      try {
        const api = new ConnectApi({ authOrigin, accessToken:session.accessToken, fetchImpl });
        const app = (await api.getApp(config.clientId)).data;
        checks.push({ name:'central_app', ok:Boolean(app?.client_id) && app.status === 'active', detail:app?.status || 'not found' });
        checks.push({ name:'redirects', ok:(config.redirectUris || []).every((uri) => app.redirect_uris.includes(uri)), detail:`${app.redirect_uris.length} registered` });
        const requestedPolicy = normalizeAccessPolicy(options.accessPolicy || config.accessPolicy);
        if (requestedPolicy) checks.push({ name:'central_access_policy', ok:(app.access_policy === 'public' ? 'guest' : app.access_policy) === requestedPolicy, detail:app.access_policy || 'missing' });
      } catch (error) { checks.push({ name:'central_app', ok:false, detail:error.message }); }
      if (config.version === 2) {
        try {
          const dataApi = new ConnectDataApi({ dataOrigin:config.dataOrigin, accessToken:session.accessToken, fetchImpl });
          const state = (await dataApi.getScopes(config.clientId)).data;
          checks.push({ name:'data_registered', ok:state?.registered === true, detail:state?.status || 'not registered' });
          checks.push({ name:'data_scopes', ok:sameScopes(state?.scopes || [], config.dataScopes), detail:(state?.scopes || []).join(',') });
          const available = state?.available_scopes || [];
          checks.push({ name:'data_available_scopes', ok:config.dataScopes.every((scope) => available.includes(scope)), detail:`${available.length} available` });
          const discovery = validateDataOpenApi(await dataApi.describe(), config.dataScopes);
          checks.push({ name:'data_openapi', ok:discovery.ok, detail:discovery.detail });
        } catch (error) { checks.push({ name:'data_registered', ok:false, detail:error.message }); }
      }
    }
  }
  const protection = await inspectProtection(root, config);
  if (config?.protection || (config?.authMode === 'required' && !options.connectionOnly)) checks.push({ name:'server_gate', ok:protection.ok, detail:protection.detail });
  const blocking = options.url && !options.offline ? await verifyProtection({ ...options, root }) : null;
  if (blocking) checks.push(...blocking.checks);
  return { ok:checks.every((item) => item.ok), checks, config, project, marker,
    protectionStatus: blocking?.protectionStatus || (protection.ok ? 'configured-not-verified' : 'unprotected'),
    protection: blocking || protection };
}

export async function statusProject(options = {}) {
  const root = options.root || process.cwd();
  const config = await readProjectConfig(root);
  const project = await detectProject(root);
  const marker = await inspectIntegration(root, project);
  const local = { configured:Boolean(config), config, project, marker:marker.present, integration:marker };
  if (!config?.clientId) return { ok:false, local, central:null, data:null };
  const session = await readSession(options.sessionPath || defaultSessionPath());
  if (!session?.accessToken) return { ok:true, local, central:null, data:null, note:'CLI session missing' };
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  try {
    const api = new ConnectApi({ authOrigin:options.authOrigin || DEFAULT_AUTH_ORIGIN, accessToken:session.accessToken, fetchImpl });
    const central = (await api.getApp(config.clientId)).data;
    let data = null;
    if (config.version === 2) data = (await new ConnectDataApi({ dataOrigin:config.dataOrigin, accessToken:session.accessToken, fetchImpl }).getScopes(config.clientId)).data;
    return { ok:true, local, central, data };
  } catch (error) { return { ok:false, local, central:null, data:null, error:error.message }; }
}

export async function addUrlProject(url, options = {}) {
  const root = options.root || process.cwd();
  const config = await readProjectConfig(root);
  if (!config?.clientId) throw new Error('.nakwol-connect.json이 없습니다. 먼저 init을 실행하세요.');
  const project = await detectProject(root);
  const desired = desiredIntegration(config, options);
  const { authApi } = await authenticatedApis({ ...options, dataOrigin:desired.dataOrigin });
  const app = (await authApi.addRedirect(config.clientId, url)).data;
  const install = await installIntegration(root, project, config.clientId, desired);
  const updated = await writeProjectConfig(root, { ...config, redirectUris:app.redirect_uris, integration:install.integration, ...desired });
  return { ok:true, clientId:config.clientId, redirectUris:updated.redirectUris, changedFiles:install.changedFiles };
}

export async function syncProject(options = {}) {
  const root = options.root || process.cwd();
  const config = await readProjectConfig(root);
  if (!config?.clientId) return initProject(options);
  const project = await detectProject(root);
  const desired = desiredIntegration(config, options);
  const { authApi, dataApi } = await authenticatedApis({ ...options, dataOrigin:desired.dataOrigin });
  let app = (await authApi.getApp(config.clientId)).data;
  const accessPolicy = normalizeAccessPolicy(options.accessPolicy);
  if (accessPolicy && app.access_policy !== accessPolicy) {
    app = (await authApi.patchApp(config.clientId, { access_policy: accessPolicy })).data;
  }
  const dataState = (await dataApi.setScopes(config.clientId, desired.dataScopes)).data;
  const install = await installIntegration(root, project, config.clientId, desired);
  const updated = await writeProjectConfig(root, { ...config, accessPolicy:app.access_policy, framework:project.framework, redirectUris:app.redirect_uris, integration:install.integration, ...desired });
  const doctor = await doctorProject({ ...options, url:undefined, connectionOnly:true, root, dataOrigin:desired.dataOrigin, offline:false });
  return { ok:doctor.ok, clientId:config.clientId, config:updated, data:dataState, changedFiles:install.changedFiles, doctor };
}

async function requireDataProject(options = {}) {
  const root = options.root || process.cwd();
  const config = await readProjectConfig(root);
  if (!config?.clientId) throw new Error('.nakwol-connect.json이 없습니다. 먼저 init을 실행하세요.');
  const project = await detectProject(root);
  const { dataApi } = await authenticatedApis({ ...options, dataOrigin:options.dataOrigin || config.dataOrigin });
  return { root, config, project, dataApi };
}
export async function dataStatusProject(options = {}) {
  const { config, dataApi } = await requireDataProject(options);
  return { ok:true, clientId:config.clientId, localScopes:config.dataScopes, central:(await dataApi.getScopes(config.clientId)).data };
}
export async function dataSetProject(scopes, options = {}) {
  const ctx = await requireDataProject(options);
  const desired = {
    authMode: normalizeAuthMode(ctx.config.authMode || 'required'),
    dataOrigin:String(options.dataOrigin || ctx.config.dataOrigin || DEFAULT_DATA_ORIGIN).replace(/\/$/,''),
    dataScopes:parseDataScopes(scopes),
    serverGate:Boolean(ctx.config.protection),
    siteUrl:ctx.config.protection?.siteUrl,
  };
  const dataState = (await ctx.dataApi.setScopes(ctx.config.clientId, desired.dataScopes)).data;
  const install = await installIntegration(ctx.root, ctx.project, ctx.config.clientId, desired);
  const config = await writeProjectConfig(ctx.root, { ...ctx.config, integration:install.integration, ...desired });
  return { ok:true, clientId:ctx.config.clientId, config, data:dataState, changedFiles:install.changedFiles };
}
export async function dataAddProject(scopes, options = {}) {
  const config = await readProjectConfig(options.root || process.cwd());
  if (!config) throw new Error('.nakwol-connect.json이 없습니다. 먼저 init을 실행하세요.');
  return dataSetProject([...config.dataScopes, ...parseDataScopes(scopes)], options);
}
export async function dataRemoveProject(scopes, options = {}) {
  const config = await readProjectConfig(options.root || process.cwd());
  if (!config) throw new Error('.nakwol-connect.json이 없습니다. 먼저 init을 실행하세요.');
  const remove = new Set(parseDataScopes(scopes));
  return dataSetProject(config.dataScopes.filter((scope) => !remove.has(scope)), options);
}

export async function removeProject(options = {}) {
  const root = options.root || process.cwd();
  const project = await detectProject(root);
  const config = await readProjectConfig(root);
  if (config?.protection) throw new Error('서버 보호가 설치된 프로젝트입니다. remove로 보호 설정을 지우지 않습니다. 공개 전환은 배포 설정과 보호 파일을 별도로 검토하세요.');
  const removed = await removeIntegration(root, project);
  await removeProjectConfig(root);
  return { ok:true, clientId:config?.clientId || null, changedFiles:removed.changedFiles, centralAppPreserved:true, centralDataPreserved:true };
}
