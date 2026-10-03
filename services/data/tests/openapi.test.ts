import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildDataOpenApi } from '../src/openapi.ts';

test('OpenAPI describes current public contract and security', () => {
  const doc:any = buildDataOpenApi('https://data.example');
  assert.equal(doc.openapi, '3.1.0');
  assert.equal(doc.info.version, '0.9.0');
  assert.equal(doc.servers[0].url, 'https://data.example');
  assert.equal(doc.components.securitySchemes.bearerAuth.scheme, 'bearer');
  assert.equal(doc.components.securitySchemes.nakwolClientId.name, 'X-NAKWOL-CLIENT-ID');
  assert.equal(doc.paths['/v1/game-accounts'].get['x-nakwol-scope'], 'profile:read');
  assert.equal(doc.paths['/v1/game-accounts/{accountId}/roster/generals/{generalId}'].put['x-nakwol-scope'], 'roster:write');
  assert.equal(doc.paths['/v1/game-accounts/{accountId}/equipment'].post['x-nakwol-scope'], 'equipment:write');
  assert.equal(doc.paths['/v1/game-accounts/{accountId}/decks/{deckId}/composition'].put['x-nakwol-scope'], 'decks:write');
  assert.equal(doc.paths['/v1/registry/equipment-traits'].get['x-nakwol-scope'], 'equipment:read');
  assert.equal(doc.paths['/openapi.json'].get.security, undefined);
  const generalBody = doc.components.schemas.OwnedGeneralInput;
  assert.equal(generalBody.properties.breakthrough.maximum, 5);
  assert.equal(generalBody.properties.promotion.minimum, 0);
  const equipment = doc.components.schemas.EquipmentCreateInput;
  assert.deepEqual(equipment.required, ['template_id']);
  assert.equal(equipment.properties.traits.maxItems, 2);
});

test('OpenAPI covers every app-facing route registered by the worker', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  const routePairs = new Set<string>();
  for (const match of source.matchAll(/app\.(get|post|put|patch|delete)\('([^']+)'/g)) {
    const method = match[1];
    const raw = match[2];
    if (raw.startsWith('/connect/cli/') || raw.startsWith('/internal/')) continue;
    const path = raw.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    routePairs.add(`${method.toLowerCase()} ${path}`);
  }
  const doc:any = buildDataOpenApi('https://data.example');
  const documented = new Set<string>();
  for (const [path, item] of Object.entries<any>(doc.paths)) {
    for (const method of ['get','post','put','patch','delete']) if (item[method]) documented.add(`${method} ${path}`);
  }
  assert.deepEqual([...documented].sort(), [...routePairs].sort());
});
