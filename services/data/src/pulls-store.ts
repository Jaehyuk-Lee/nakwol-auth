import type { PullEditOp, PullEvent } from './pulls-domain.ts';
import type { DataEnv } from './types.ts';

type DB = Pick<DataEnv, 'DB'>;
interface StoredPull { id:string; account_id:string; rev:number; deleted:number; event_json:string; banner:string; seq:number; }
type Statement = ReturnType<DataEnv['DB']['prepare']>;

export type PullWriteResult =
  | { kind:'ok'; applied:string[]; duplicate:string[] }
  | { kind:'account_not_found' }
  | { kind:'not_found'; id:string }
  | { kind:'conflict'; code:string; id:string }
  | { kind:'invalid'; code:string; id:string };

async function ownedAccount(env:DB, userId:string, accountId:string) {
  return env.DB.prepare('SELECT id,nickname FROM game_accounts WHERE id = ? AND user_id = ?').bind(accountId,userId).first<{ id:string; nickname:string }>();
}

async function storedPull(env:DB, id:string) {
  return env.DB.prepare('SELECT id,account_id,rev,deleted,event_json,banner,seq FROM pull_events WHERE id = ?').bind(id).first<StoredPull>();
}

function logChange(env:DB, row:{ eventId:string; accountId:string; userId:string; nickname:string; rev:number; action:'create'|'replace'|'delete'; event:string|null; previous:string|null; at:number }):Statement {
  return env.DB.prepare('INSERT INTO pull_event_changes(event_id,account_id,user_id,account_nickname,rev,action,event_json,previous_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(row.eventId,row.accountId,row.userId,row.nickname,row.rev,row.action,row.event,row.previous,row.at);
}

// Aborts the surrounding batch when the UPDATE right before it matched no row, i.e. another
// request changed the record after it was read.
function revisionGuard(env:DB):Statement {
  return env.DB.prepare('INSERT INTO pull_event_guard(ok) SELECT NULL WHERE changes() = 0');
}

const isGuardFailure = (error:unknown) => /NOT NULL constraint failed: pull_event_guard/i.test(String((error as Error)?.message ?? error));
const isPrimaryKeyRace = (error:unknown) => /UNIQUE constraint failed: pull_events\.id/i.test(String((error as Error)?.message ?? error));

// New records. Same id with the same content, or a stored revision newer than the one sent
// (a late retry after an edit), counts as a duplicate. Anything else rejects the whole request.
export async function createPullEvents(env:DB, userId:string, accountId:string, events:PullEvent[], retried = false):Promise<PullWriteResult> {
  const account = await ownedAccount(env,userId,accountId);
  if (!account) return { kind:'account_not_found' };
  const accepted:string[] = [];
  const duplicate:string[] = [];
  const seen = new Map<string,string>();
  const statements:Statement[] = [];
  const now = Date.now();
  for (const event of events) {
    const json = JSON.stringify(event);
    if (seen.has(event.id)) {
      if (seen.get(event.id) !== json) return { kind:'conflict', code:'PULL_EVENT_CONFLICT', id:event.id };
      duplicate.push(event.id);
      continue;
    }
    seen.set(event.id,json);
    const existing = await storedPull(env,event.id);
    if (existing) {
      if (existing.account_id !== accountId) return { kind:'conflict', code:'PULL_EVENT_CONFLICT', id:event.id };
      if (existing.event_json === json || existing.rev > event.rev) { duplicate.push(event.id); continue; }
      return { kind:'conflict', code:'PULL_EVENT_CONFLICT', id:event.id };
    }
    statements.push(
      env.DB.prepare('INSERT INTO pull_events(id,account_id,user_id,banner,seq,rev,deleted,event_json,observed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,0,?,?,?,?)')
        .bind(event.id,accountId,userId,event.banner,event.seq,event.rev,json,Date.parse(event.observed_at),now,now),
      logChange(env,{ eventId:event.id, accountId, userId, nickname:account.nickname, rev:event.rev, action:'create', event:json, previous:null, at:now }),
    );
    accepted.push(event.id);
  }
  if (statements.length) {
    try { await env.DB.batch(statements); }
    catch (error) {
      // Another request created one of these ids first: classify again against what it stored.
      if (!retried && isPrimaryKeyRace(error)) return createPullEvents(env,userId,accountId,events,true);
      throw error;
    }
  }
  return { kind:'ok', applied:accepted, duplicate };
}

// Edits and deletes of stored records. Each op carries the next revision number; an op that
// was already applied is a duplicate. The batch applies completely or not at all.
export async function editPullEvents(env:DB, userId:string, accountId:string, ops:PullEditOp[]):Promise<PullWriteResult> {
  const account = await ownedAccount(env,userId,accountId);
  if (!account) return { kind:'account_not_found' };
  const applied:string[] = [];
  const duplicate:string[] = [];
  const current = new Map<string,StoredPull>();
  const statements:Statement[] = [];
  const now = Date.now();
  for (const op of ops) {
    const id = op.op === 'delete' ? op.id : op.event.id;
    const row = current.get(id) ?? await storedPull(env,id);
    if (!row || row.account_id !== accountId) return { kind:'not_found', id };
    if (op.op === 'delete') {
      if (row.deleted && row.rev === op.rev) { duplicate.push(id); continue; }
      if (row.deleted || op.rev !== row.rev + 1) return { kind:'conflict', code:'PULL_EVENT_REVISION_CONFLICT', id };
      statements.push(
        env.DB.prepare('UPDATE pull_events SET deleted = 1, rev = ?, updated_at = ? WHERE id = ? AND rev = ? AND deleted = 0').bind(op.rev,now,id,row.rev),
        revisionGuard(env),
        logChange(env,{ eventId:id, accountId, userId, nickname:account.nickname, rev:op.rev, action:'delete', event:null, previous:row.event_json, at:now }),
      );
      current.set(id,{ ...row, deleted:1, rev:op.rev });
    } else {
      const event = op.event;
      const json = JSON.stringify(event);
      if (row.deleted) return { kind:'conflict', code:'PULL_EVENT_DELETED', id };
      if (event.banner !== row.banner || event.seq !== row.seq) return { kind:'invalid', code:'PULL_EVENT_IMMUTABLE_FIELD', id };
      if (row.rev === event.rev && row.event_json === json) { duplicate.push(id); continue; }
      if (event.rev !== row.rev + 1) return { kind:'conflict', code:'PULL_EVENT_REVISION_CONFLICT', id };
      statements.push(
        env.DB.prepare('UPDATE pull_events SET event_json = ?, rev = ?, observed_at = ?, updated_at = ? WHERE id = ? AND rev = ? AND deleted = 0')
          .bind(json,event.rev,Date.parse(event.observed_at),now,id,row.rev),
        revisionGuard(env),
        logChange(env,{ eventId:id, accountId, userId, nickname:account.nickname, rev:event.rev, action:'replace', event:json, previous:row.event_json, at:now }),
      );
      current.set(id,{ ...row, rev:event.rev, event_json:json });
    }
    applied.push(id);
  }
  if (statements.length) {
    try { await env.DB.batch(statements); }
    catch (error) {
      if (isGuardFailure(error)) return { kind:'conflict', code:'PULL_EVENT_REVISION_CONFLICT', id:applied[0] ?? '' };
      throw error;
    }
  }
  return { kind:'ok', applied, duplicate };
}

const parseEvent = (json:string) => JSON.parse(json) as PullEvent;

// Live records of one account in creation order, for restoring a new device.
export async function listPullEvents(env:DB, userId:string, accountId:string, after:number, limit:number) {
  const account = await ownedAccount(env,userId,accountId);
  if (!account) return null;
  const result = await env.DB.prepare('SELECT rowid AS cursor,event_json FROM pull_events WHERE account_id = ? AND deleted = 0 AND rowid > ? ORDER BY rowid LIMIT ?')
    .bind(accountId,after,limit).all<{ cursor:number; event_json:string }>();
  const rows = result.results ?? [];
  return { events:rows.map((row) => parseEvent(row.event_json)), next:rows.length === limit ? rows.at(-1)!.cursor : null };
}

// Change feed for aggregating services, oldest first.
export async function listPullChanges(env:DB, after:number, limit:number) {
  const result = await env.DB.prepare('SELECT cursor,event_id,account_id,user_id,account_nickname,rev,action,event_json,previous_json,created_at FROM pull_event_changes WHERE cursor > ? ORDER BY cursor LIMIT ?')
    .bind(after,limit).all<{ cursor:number; event_id:string; account_id:string; user_id:string; account_nickname:string|null; rev:number; action:string; event_json:string|null; previous_json:string|null; created_at:number }>();
  const rows = result.results ?? [];
  return {
    changes: rows.map((row) => ({
      cursor:row.cursor, event_id:row.event_id, account_id:row.account_id, account_nickname:row.account_nickname, user_id:row.user_id,
      rev:row.rev, action:row.action, event:row.event_json ? parseEvent(row.event_json) : null,
      previous:row.previous_json ? parseEvent(row.previous_json) : null, at:row.created_at,
    })),
    next: rows.length ? rows.at(-1)!.cursor : after,
  };
}
