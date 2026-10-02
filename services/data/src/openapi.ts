import { DATA_SCOPES, DATA_SERVICE_VERSION, type DataScope } from './domain.ts';

const runtimeSecurity = [{ bearerAuth: [], nakwolClientId: [] }];
const json = (schema: unknown) => ({ 'application/json': { schema } });
const success = { description: 'Success', content: json({ $ref: '#/components/schemas/SuccessEnvelope' }) };
const created = { description: 'Created', content: json({ $ref: '#/components/schemas/SuccessEnvelope' }) };
const error = { description: 'Error', content: json({ $ref: '#/components/schemas/ErrorEnvelope' }) };
const responses = { '200': success, '400': error, '401': error, '403': error, '404': error };
const createdResponses = { '201': created, '400': error, '401': error, '403': error, '404': error };
const body = (schema: string) => ({ required: true, content: json({ $ref: `#/components/schemas/${schema}` }) });
const pathParam = (name: string, description: string) => ({ name, in: 'path', required: true, description, schema: { type: 'string', minLength: 1 } });

function publicOperation(summary: string, extra: Record<string, unknown> = {}) { return { summary, ...extra }; }
function authedOperation(summary: string, extra: Record<string, unknown> = {}) { return { summary, security: runtimeSecurity, ...extra }; }
function scopedOperation(summary: string, scope: DataScope, extra: Record<string, unknown> = {}) { return { summary, security: runtimeSecurity, 'x-nakwol-scope': scope, ...extra }; }

const accountId = pathParam('accountId', 'NAKWOL DATA game account ID');
const generalId = pathParam('generalId', 'Registry general ID, for example general:1000');
const tacticId = pathParam('tacticId', 'Registry tactic ID');
const equipmentId = pathParam('equipmentId', 'Owned equipment instance ID');
const deckId = pathParam('deckId', 'Owned deck ID');
const snapshotId = pathParam('snapshotId', 'Deck snapshot ID');
const cursorParams = (max: number) => [
  { name: 'after', in: 'query', required: false, description: 'Cursor from the previous page; 0 or omitted starts from the beginning.', schema: { type: 'integer', minimum: 0 } },
  { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: max, default: Math.min(500, max) } },
];

export function buildDataOpenApi(origin = 'https://nakwol-data.sepsd21.workers.dev') {
  const server = String(origin).replace(/\/$/, '');
  return {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: { title: 'NAKWOL DATA API', version: DATA_SERVICE_VERSION, description: 'Shared NAKWOL game-data API. Runtime requests use the app-bound NAKWOL access token plus X-NAKWOL-CLIENT-ID. DATA scopes are centrally granted by NAKWOL Connect.' },
    servers: [{ url: server }],
    'x-nakwol-discovery-version': 1,
    'x-nakwol-data-scopes': [...DATA_SCOPES],
    paths: {
      '/api/health': { get: publicOperation('Read DATA service health', { tags: ['system'], responses: { '200': { description: 'Health', content: json({ $ref: '#/components/schemas/HealthResponse' }) } } }) },
      '/api/schema': { get: publicOperation('Read DATA schema and discovery metadata', { tags: ['system'], responses: { '200': { description: 'Schema metadata', content: json({ $ref: '#/components/schemas/SchemaResponse' }) } } }) },
      '/openapi.json': { get: publicOperation('Read this OpenAPI document', { tags: ['system'], responses: { '200': { description: 'OpenAPI 3.1 document' } } }) },
      '/v1/me': { get: authedOperation('Read current NAKWOL DATA principal', { tags: ['profile'], responses }) },
      '/v1/game-accounts': {
        get: scopedOperation('List current user game accounts', 'profile:read', { tags: ['profile'], responses }),
        post: scopedOperation('Create a game account', 'profile:write', { tags: ['profile'], requestBody: body('GameAccountCreateInput'), responses: createdResponses }),
      },
      '/v1/game-accounts/{accountId}/roster/generals': { get: scopedOperation('List owned generals', 'roster:read', { tags: ['roster'], parameters: [accountId], responses }) },
      '/v1/game-accounts/{accountId}/roster/generals/{generalId}': {
        put: scopedOperation('Create or replace owned-general state', 'roster:write', { tags: ['roster'], parameters: [accountId, generalId], requestBody: body('OwnedGeneralInput'), responses }),
        delete: scopedOperation('Remove owned-general state', 'roster:write', { tags: ['roster'], parameters: [accountId, generalId], responses }),
      },
      '/v1/game-accounts/{accountId}/roster/tactics': { get: scopedOperation('List owned tactics', 'roster:read', { tags: ['roster'], parameters: [accountId], responses }) },
      '/v1/game-accounts/{accountId}/roster/tactics/{tacticId}': {
        put: scopedOperation('Create or replace owned-tactic state', 'roster:write', { tags: ['roster'], parameters: [accountId, tacticId], requestBody: body('OwnedTacticInput'), responses }),
        delete: scopedOperation('Remove owned-tactic state', 'roster:write', { tags: ['roster'], parameters: [accountId, tacticId], responses }),
      },
      '/v1/game-accounts/{accountId}/equipment': {
        get: scopedOperation('List owned equipment instances', 'equipment:read', { tags: ['equipment'], parameters: [accountId], responses }),
        post: scopedOperation('Create an equipment instance', 'equipment:write', { tags: ['equipment'], parameters: [accountId], requestBody: body('EquipmentCreateInput'), responses: createdResponses }),
      },
      '/v1/game-accounts/{accountId}/equipment/{equipmentId}': {
        patch: scopedOperation('Patch an equipment instance', 'equipment:write', { tags: ['equipment'], parameters: [accountId, equipmentId], requestBody: body('EquipmentPatchInput'), responses }),
        delete: scopedOperation('Delete an equipment instance', 'equipment:write', { tags: ['equipment'], parameters: [accountId, equipmentId], responses }),
      },
      '/v1/game-accounts/{accountId}/decks': {
        get: scopedOperation('List saved decks', 'decks:read', { tags: ['decks'], parameters: [accountId], responses }),
        post: scopedOperation('Create a saved deck', 'decks:write', { tags: ['decks'], parameters: [accountId], requestBody: body('DeckCreateInput'), responses: createdResponses }),
      },
      '/v1/game-accounts/{accountId}/decks/{deckId}/snapshots': { post: scopedOperation('Create an immutable deck snapshot', 'decks:write', { tags: ['snapshots'], parameters: [accountId, deckId], requestBody: body('SnapshotCreateInput'), responses: createdResponses }) },
      '/v1/game-accounts/{accountId}/decks/{deckId}/composition': { put: scopedOperation('Replace deck composition', 'decks:write', { tags: ['decks'], parameters: [accountId, deckId], requestBody: body('DeckCompositionInput'), responses }) },
      '/v1/game-accounts/{accountId}/decks/{deckId}': {
        get: scopedOperation('Read one saved deck', 'decks:read', { tags: ['decks'], parameters: [accountId, deckId], responses }),
        patch: scopedOperation('Patch saved deck metadata', 'decks:write', { tags: ['decks'], parameters: [accountId, deckId], requestBody: body('DeckPatchInput'), responses }),
        delete: scopedOperation('Delete a saved deck', 'decks:write', { tags: ['decks'], parameters: [accountId, deckId], responses }),
      },
      '/v1/game-accounts/{accountId}/pull-events': {
        get: scopedOperation('List live pull records of a game account in creation order', 'pulls:read', { tags: ['pulls'], parameters: [accountId, ...cursorParams(500)], responses }),
        post: scopedOperation('Create pull records; retries with the same id are duplicates', 'pulls:write', { tags: ['pulls'], parameters: [accountId], requestBody: body('PullEventBatchInput'), responses: { ...responses, '409': error } }),
      },
      '/v1/game-accounts/{accountId}/pull-events/edits': { post: scopedOperation('Replace or delete stored pull records with the next revision number', 'pulls:write', { tags: ['pulls'], parameters: [accountId], requestBody: body('PullEditBatchInput'), responses: { ...responses, '409': error } }) },
      '/v1/deck-snapshots': { get: scopedOperation('List visible deck snapshots', 'decks:read', { tags: ['snapshots'], responses }) },
      '/v1/deck-snapshots/{snapshotId}': { get: scopedOperation('Read a visible deck snapshot', 'decks:read', { tags: ['snapshots'], parameters: [snapshotId], responses }) },
      '/v1/registry/summary': { get: authedOperation('Read Registry provenance and counts', { tags: ['registry'], responses }) },
      '/v1/registry/generals': { get: scopedOperation('List general Registry rows', 'roster:read', { tags: ['registry'], parameters: [{ name: 'include_hidden', in: 'query', required: false, description: 'Set to 1 to include preserved hidden rows.', schema: { type: 'string', enum: ['1'] } }], responses }) },
      '/v1/registry/tactics': { get: scopedOperation('List tactic Registry rows', 'roster:read', { tags: ['registry'], responses }) },
      '/v1/registry/equipment': { get: scopedOperation('List equipment template Registry rows', 'equipment:read', { tags: ['registry'], responses }) },
      '/v1/registry/equipment-traits': { get: scopedOperation('List evidence-backed equipment trait identities', 'equipment:read', { tags: ['registry'], responses }) },
      '/v1/registry/stats': { get: scopedOperation('List generic stat Registry rows', 'equipment:read', { tags: ['registry'], responses }) },
      '/v1/registry/formations': { get: scopedOperation('List formation Registry rows', 'decks:read', { tags: ['registry'], responses }) },
      '/v1/registry/warbooks': { get: scopedOperation('List warbook Registry rows', 'decks:read', { tags: ['registry'], responses }) },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'NAKWOL access token', description: 'App-bound user access token issued by NAKWOL AUTH.' },
        nakwolClientId: { type: 'apiKey', in: 'header', name: 'X-NAKWOL-CLIENT-ID', description: 'The same client_id registered through NAKWOL Connect.' },
      },
      schemas: {
        ErrorEnvelope: { type: 'object', required: ['ok','error'], additionalProperties: false, properties: { ok: { const: false }, error: { type: 'object', required: ['code','message'], properties: { code: { type: 'string' }, message: { type: 'string' } }, additionalProperties: true } } },
        SuccessEnvelope: { type: 'object', required: ['ok','data'], properties: { ok: { const: true }, data: {} }, additionalProperties: true },
        HealthResponse: { type: 'object', required: ['ok','service','version','schema_version'], properties: { ok: { const: true }, service: { const: 'nakwol-data' }, version: { type: 'string' }, schema_version: { type: 'integer' } }, additionalProperties: false },
        SchemaResponse: { type: 'object', required: ['ok','service','version','schema_version','scopes','openapi_path','openapi_version'], properties: { ok: { const: true }, service: { const: 'nakwol-data' }, version: { type: 'string' }, schema_version: { type: 'integer' }, scopes: { type: 'array', items: { type: 'string', enum: [...DATA_SCOPES] } }, openapi_path: { const: '/openapi.json' }, openapi_version: { const: '3.1.0' } }, additionalProperties: true },
        GameAccountCreateInput: { type: 'object', required: ['nickname','server_code'], additionalProperties: false, properties: { nickname: { type: 'string', minLength: 1 }, server_code: { type: 'string', minLength: 1 }, is_primary: { type: 'boolean', default: false } } },
        OwnedGeneralInput: { type: 'object', additionalProperties: false, properties: { breakthrough: { type: 'integer', minimum: 0, maximum: 5, default: 0 }, promotion: { type: 'integer', minimum: 0, default: 0 }, favorite: { type: 'boolean', default: false }, note: { type: ['string','null'] } } },
        OwnedTacticInput: { type: 'object', additionalProperties: false, properties: { breakthrough: { type: 'integer', minimum: 0, maximum: 5, default: 0 }, favorite: { type: 'boolean', default: false }, note: { type: ['string','null'] } } },
        EquipmentTraitInput: { type: 'object', required: ['slot','trait_id'], additionalProperties: false, properties: { slot: { type: 'integer', enum: [1,2] }, trait_id: { type: 'string', minLength: 1 } } },
        EquipmentCreateInput: { type: 'object', required: ['template_id'], additionalProperties: false, properties: { template_id: { type: 'string', minLength: 1 }, nickname: { type: ['string','null'] }, locked: { type: 'boolean', default: false }, favorite: { type: 'boolean', default: false }, traits: { type: 'array', maxItems: 2, items: { $ref: '#/components/schemas/EquipmentTraitInput' } } }, description: 'Generic stats are intentionally unsupported until an authoritative equipment option catalog exists.' },
        EquipmentPatchInput: { type: 'object', minProperties: 1, additionalProperties: false, properties: { nickname: { type: ['string','null'] }, locked: { type: 'boolean' }, favorite: { type: 'boolean' }, traits: { type: 'array', maxItems: 2, items: { $ref: '#/components/schemas/EquipmentTraitInput' } } } },
        DeckCreateInput: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: { type: 'string', minLength: 1 }, season_id: { type: ['string','null'] }, status: { type: 'string', enum: ['active','candidate','research','archived'], default: 'active' }, visibility: { type: 'string', enum: ['private','alliance','public'], default: 'private' }, note: { type: ['string','null'] }, is_primary: { type: 'boolean', default: false } } },
        DeckPatchInput: { type: 'object', minProperties: 1, additionalProperties: false, properties: { name: { type: 'string', minLength: 1 }, season_id: { type: ['string','null'] }, status: { type: 'string', enum: ['active','candidate','research','archived'] }, visibility: { type: 'string', enum: ['private','alliance','public'] }, note: { type: ['string','null'] }, is_primary: { type: 'boolean' } } },
        DeckCompositionTacticInput: { type: 'object', required: ['slot','tactic_id'], additionalProperties: false, properties: { slot: { type: 'integer', minimum: 1, maximum: 2 }, tactic_id: { type: 'string', minLength: 1 } } },
        DeckCompositionGeneralInput: { type: 'object', required: ['position','general_id'], additionalProperties: false, properties: { position: { type: 'integer', minimum: 1, maximum: 3 }, general_id: { type: 'string', minLength: 1 }, weapon_instance_id: { type: ['string','null'] }, mount_instance_id: { type: ['string','null'] }, tactics: { type: 'array', maxItems: 2, items: { $ref: '#/components/schemas/DeckCompositionTacticInput' } } } },
        DeckCompositionInput: { type: 'object', required: ['generals'], additionalProperties: false, properties: { generals: { type: 'array', maxItems: 3, items: { $ref: '#/components/schemas/DeckCompositionGeneralInput' } } } },
        PullCard: { type: 'object', required: ['kind','name'], additionalProperties: false, properties: { kind: { type: 'string', enum: ['officer','tactic'] }, name: { type: 'string', minLength: 1, maxLength: 40 }, owned: { type: 'boolean', description: 'Whether the card was owned before this draw.' } } },
        PullEvent: { type: 'object', required: ['id','season','banner','observed_at','seq','draws','legendary','officers','tactics'], properties: { id: { type: 'string', format: 'uuid', description: 'Client-generated id; retries reuse it.' }, season: { type: 'integer', minimum: 1 }, banner: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,39}$' }, observed_at: { type: 'string', format: 'date-time' }, seq: { type: 'integer', minimum: 1, description: 'Per-banner order on the recording device.' }, rev: { type: 'integer', minimum: 1, default: 1 }, draws: { type: 'integer', enum: [1,5,20] }, legendary: { type: 'integer', minimum: 0 }, officers: { type: 'integer', minimum: 0 }, tactics: { type: 'integer', minimum: 0 }, heroic: { type: ['integer','null'], minimum: 0 }, rare: { type: ['integer','null'], minimum: 0 }, legend_positions: { type: ['array','null'], items: { type: 'integer', minimum: 1, maximum: 20 }, description: '1-based card numbers of the legends, ascending; null when unknown.' }, pity_before: { type: ['integer','null'], minimum: 0, maximum: 19, description: 'Pity counter before the batch as computed on the device; null when unknown.' }, legendary_items: { type: 'array', items: { $ref: '#/components/schemas/PullCard' } } } },
        PullEventBatchInput: { type: 'object', required: ['events'], additionalProperties: false, properties: { events: { type: 'array', minItems: 1, maxItems: 200, items: { $ref: '#/components/schemas/PullEvent' } } } },
        PullEditOp: { oneOf: [ { type: 'object', required: ['op','event'], additionalProperties: false, properties: { op: { const: 'replace' }, event: { $ref: '#/components/schemas/PullEvent' } } }, { type: 'object', required: ['op','id','rev'], additionalProperties: false, properties: { op: { const: 'delete' }, id: { type: 'string', format: 'uuid' }, rev: { type: 'integer', minimum: 2 } } } ] },
        PullEditBatchInput: { type: 'object', required: ['ops'], additionalProperties: false, properties: { ops: { type: 'array', minItems: 1, maxItems: 200, items: { $ref: '#/components/schemas/PullEditOp' } } } },
        SnapshotCreateInput: { type: 'object', additionalProperties: false, properties: { visibility: { type: 'string', enum: ['alliance','public'], default: 'alliance' } } },
      },
    },
  } as const;
}

export function openApiResponse(request: Request): Response {
  const origin = new URL(request.url).origin;
  const response = Response.json(buildDataOpenApi(origin));
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Cache-Control', 'public, max-age=300');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}
