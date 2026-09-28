import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_DATA_ORIGIN, parseDataScopes } from './scopes.mjs';

export const PROJECT_CONFIG_FILE = '.nakwol-connect.json';
function normalizeAuthMode(value) { const mode=String(value || 'required').trim().toLowerCase(); return mode==='optional'?'optional':'required'; }
export async function readProjectConfig(root = process.cwd()) {
  try {
    const value = JSON.parse(await readFile(join(root, PROJECT_CONFIG_FILE), 'utf8'));
    if (!value || ![1,2].includes(value.version)) return null;
    return {
      ...value,
      authMode: normalizeAuthMode(value.authMode),
      dataOrigin: value.version === 2 && value.dataOrigin ? String(value.dataOrigin).replace(/\/$/,'') : DEFAULT_DATA_ORIGIN,
      dataScopes: value.version === 2 ? parseDataScopes(value.dataScopes || []) : [],
    };
  } catch { return null; }
}
export async function writeProjectConfig(root, config) {
  const value = {
    version: 2,
    clientId: config.clientId,
    framework: config.framework,
    redirectUris: [...new Set(config.redirectUris || [])],
    integration: config.integration,
    authMode: normalizeAuthMode(config.authMode),
    dataOrigin: String(config.dataOrigin || DEFAULT_DATA_ORIGIN).replace(/\/$/, ''),
    dataScopes: parseDataScopes(config.dataScopes || []),
    accessPolicy: config.accessPolicy || 'member',
    authOrigin: config.authOrigin || 'https://nakwol-auth.sepsd21.workers.dev',
    ...(config.protection ? { protection: config.protection } : {}),
  };
  await writeFile(join(root, PROJECT_CONFIG_FILE), `${JSON.stringify(value, null, 2)}\n`);
  return value;
}
export async function removeProjectConfig(root = process.cwd()) { await rm(join(root, PROJECT_CONFIG_FILE), { force: true }); }
