// Pull (탐방) records. DATA checks the shape and contradictions inside one record only; the
// pity counter is the value the member's device computed, and card names are checked by the
// aggregating service against its own banner catalog.
export const PULL_PITY_LIMIT = 20;
export const PULL_BATCH_LIMIT = 200;
export const PULL_FORMAT_VERSION = 2;

export interface PullCard { kind: 'officer' | 'tactic'; name: string; owned?: boolean; }
export interface PullEvent {
  id: string;
  format_version: 2;
  season: number;
  banner: string;
  observed_at: string;
  seq: number;
  rev: number;
  draws: 1 | 5 | 20;
  legendary: number;
  officers: number;
  tactics: number;
  heroic: number | null;
  rare: number | null;
  legend_positions: number[] | null;
  pity_before: number | null;
  legendary_items: PullCard[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BANNER = /^[a-z0-9][a-z0-9-]{0,39}$/;
const isInt = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;

function invalid(): never { throw new Error('INVALID_PULL_EVENT'); }

// True when the record can follow the counter without breaking the 20th-draw guarantee.
export function consistentWithPity(event: Pick<PullEvent, 'pity_before' | 'legendary' | 'draws' | 'legend_positions'>): boolean {
  const counter = event.pity_before;
  if (counter === null) return true;
  if (event.legendary === 0) return counter + event.draws < PULL_PITY_LIMIT;
  if (!event.legend_positions) return true;
  return event.legend_positions[0] <= PULL_PITY_LIMIT - counter;
}

export function normalizePullEvent(input: unknown): PullEvent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !UUID.test(raw.id)) invalid();
  if (!isInt(raw.season, 1, 1000)) invalid();
  if (typeof raw.banner !== 'string' || !BANNER.test(raw.banner)) invalid();
  const observed = typeof raw.observed_at === 'string' ? Date.parse(raw.observed_at) : Number.NaN;
  if (Number.isNaN(observed)) invalid();
  if (!isInt(raw.seq, 1)) invalid();
  const rev = raw.rev ?? 1;
  if (!isInt(rev, 1)) invalid();
  if (raw.draws !== 1 && raw.draws !== 5 && raw.draws !== 20) invalid();
  const draws = raw.draws;
  if (!isInt(raw.legendary, 0, draws)) invalid();
  const legendary = raw.legendary;
  if (draws === 20 && legendary < 1) invalid();
  if (!isInt(raw.officers, 0) || !isInt(raw.tactics, 0) || raw.officers + raw.tactics > legendary) invalid();
  const heroic = raw.heroic ?? null;
  const rare = raw.rare ?? null;
  if ((heroic === null) !== (rare === null)) invalid();
  if (heroic !== null && (!isInt(heroic, 0) || !isInt(rare, 0) || legendary + heroic + (rare as number) !== draws)) invalid();
  const positions = raw.legend_positions ?? null;
  if (positions !== null) {
    if (!Array.isArray(positions) || positions.length !== legendary) invalid();
    positions.forEach((value, index) => {
      if (!isInt(value, 1, draws) || (index > 0 && value <= positions[index - 1])) invalid();
    });
  }
  const pity = raw.pity_before ?? null;
  if (pity !== null && !isInt(pity, 0, PULL_PITY_LIMIT - 1)) invalid();
  const items = raw.legendary_items ?? [];
  if (!Array.isArray(items) || items.length > legendary) invalid();
  const cards = items.map((card): PullCard => {
    if (!card || typeof card !== 'object') invalid();
    const { kind, name, owned } = card as Record<string, unknown>;
    if (kind !== 'officer' && kind !== 'tactic') invalid();
    if (typeof name !== 'string' || name.trim().length < 1 || name.length > 40) invalid();
    if (owned !== undefined && typeof owned !== 'boolean') invalid();
    return owned === undefined ? { kind, name } : { kind, name, owned };
  });
  // Same content always gives the same JSON, so retries compare equal.
  cards.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name) || String(a.owned).localeCompare(String(b.owned)));
  const event: PullEvent = {
    id: raw.id.toLowerCase(),
    format_version: PULL_FORMAT_VERSION,
    season: raw.season,
    banner: raw.banner,
    observed_at: new Date(observed).toISOString(),
    seq: raw.seq,
    rev,
    draws,
    legendary,
    officers: raw.officers,
    tactics: raw.tactics,
    heroic,
    rare: rare as number | null,
    legend_positions: positions as number[] | null,
    pity_before: pity,
    legendary_items: cards,
  };
  if (!consistentWithPity(event)) invalid();
  return event;
}

export type PullEditOp = { op: 'replace'; event: PullEvent } | { op: 'delete'; id: string; rev: number };

export function normalizePullEditOp(input: unknown): PullEditOp {
  if (!input || typeof input !== 'object') throw new Error('INVALID_PULL_EDIT');
  const raw = input as Record<string, unknown>;
  if (raw.op === 'replace') return { op: 'replace', event: normalizePullEvent(raw.event) };
  if (raw.op === 'delete') {
    if (typeof raw.id !== 'string' || !UUID.test(raw.id) || !isInt(raw.rev, 2)) throw new Error('INVALID_PULL_EDIT');
    return { op: 'delete', id: raw.id.toLowerCase(), rev: raw.rev };
  }
  throw new Error('INVALID_PULL_EDIT');
}
