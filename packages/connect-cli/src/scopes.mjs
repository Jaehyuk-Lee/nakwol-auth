export const DEFAULT_DATA_ORIGIN = 'https://nakwol-data.sepsd21.workers.dev';
export const DATA_SCOPES = Object.freeze([
  'profile:read','profile:write','roster:read','roster:write',
  'equipment:read','equipment:write','decks:read','decks:write',
  'pulls:read','pulls:write',
]);
export function parseDataScopes(value) {
  const raw = Array.isArray(value) ? value : value == null || value === '' ? [] : String(value).split(',');
  const scopes = raw.map((item) => String(item).trim()).filter(Boolean);
  const invalid = scopes.filter((scope) => !DATA_SCOPES.includes(scope));
  if (invalid.length) throw new Error(`지원하지 않는 NAKWOL DATA scope: ${[...new Set(invalid)].join(', ')}`);
  return [...new Set(scopes)].sort();
}
export function sameScopes(a, b) {
  return JSON.stringify(parseDataScopes(a)) === JSON.stringify(parseDataScopes(b));
}
