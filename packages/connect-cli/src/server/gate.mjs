import { loginPage } from './login.mjs';

export const COOKIE = '__Host-nakwol_connect';
export const AUTHORIZATION_LEASE_MS = 5 * 60 * 1000;
const encoder = new TextEncoder();
const keys = new Map();
const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function response(body, status, headers = {}) {
  return new Response(body, { status, headers: {
    'Cache-Control': 'private, no-store, max-age=0',
    'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff',
    'X-Nakwol-Gate': 'v1', ...headers,
  } });
}
function denied(request, status, settings) {
  const html = request.method === 'GET' && request.headers.get('Accept')?.includes('text/html') && !request.headers.has('Range');
  return response(html ? loginPage(settings, status) : null, status, {
    'Content-Type': html ? 'text/html; charset=utf-8' : 'text/plain',
    ...([401, 403].includes(status) ? { 'Set-Cookie': clearCookie } : {}),
  });
}
async function key(secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('NAKWOL_SESSION_SECRET must contain at least 32 characters');
  if (keys.has(secret)) return keys.get(secret);
  if (keys.size >= 8) keys.delete(keys.keys().next().value);
  const imported = crypto.subtle.digest('SHA-256', encoder.encode(secret))
    .then(bytes => crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']))
    .catch(error => { keys.delete(secret); throw error; });
  keys.set(secret, imported);
  return imported;
}
function encode(bytes) { return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
function decode(value) { return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)); }
async function seal(session, secret, audience) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(audience) }, await key(secret), encoder.encode(JSON.stringify(session)));
  return `${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}
async function readSession(request, secret, audience) {
  const cookies = (request.headers.get('Cookie') || '').split(';').map(v => v.trim()).filter(v => v.startsWith(`${COOKIE}=`));
  if (cookies.length !== 1 || cookies[0].length > 4096) return null;
  try {
    const parts = cookies[0].slice(COOKIE.length + 1).split('.');
    if (parts.length !== 2) return null;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(parts[0]), additionalData: encoder.encode(audience) }, await key(secret), decode(parts[1]));
    const session = JSON.parse(new TextDecoder().decode(plain));
    return typeof session.token === 'string' && Number.isFinite(session.expires) && session.expires > Date.now() ? session : null;
  } catch { return null; } // Untrusted or obsolete cookies never grant access.
}
async function verify(token, settings) {
  const verifiedAt = Date.now();
  try {
    const url = new URL('/me', settings.authOrigin);
    url.searchParams.set('client_id', settings.clientId);
    const result = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, ...(settings.accessPolicy === 'member' ? { 'X-Nakwol-Require-Member': 'true' } : {}) },
      cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(7000),
    });
    if (result.status !== 200) return { status: [401, 403].includes(result.status) ? result.status : 503 };
    const body = await result.json();
    if (body.ok !== true || body.data?.status !== 'active' || typeof body.data.id !== 'string' || !body.data.id || body.data.id.length > 256) return { status: 403 };
    if (body.application_access?.client_id !== settings.clientId || body.application_access?.allowed !== true
      || !['policy', 'manual_grant'].includes(body.application_access.source)) return { status: 403 };
    const manualGrant = body.application_access?.client_id === settings.clientId
      && body.application_access?.allowed === true && body.application_access?.source === 'manual_grant';
    if (settings.accessPolicy === 'member' && body.data?.membership?.is_member !== true && !manualGrant) return { status: 403 };
    if (!Number.isFinite(body.expires_at) || body.expires_at <= Date.now()) return { status: 401 };
    const leaseUntil = Math.min(body.expires_at, verifiedAt + AUTHORIZATION_LEASE_MS);
    if (leaseUntil <= Date.now()) return { status: 503 };
    return { status: 200, expires: body.expires_at, authorization: {
      clientId: settings.clientId, siteOrigin: new URL(settings.siteUrl).origin,
      authOrigin: settings.authOrigin, accessPolicy: settings.accessPolicy,
      userId: body.data.id, allowed: true, source: body.application_access.source,
      verifiedAt, leaseUntil,
    } };
  } catch { return { status: 503 }; } // AUTH outages fail closed at the request boundary.
}

// Isolate-local, bounded state. Valid encrypted leases never need remote storage.
const pendingChecks = new Map();
const completedChecks = new Map();
const revokedSessions = new Map();
function sessionId(token, settings) {
  return JSON.stringify([settings.authOrigin, settings.clientId, settings.siteUrl, settings.accessPolicy, token]);
}
function remember(map, id, value) {
  if (!map.has(id) && map.size >= 512) map.delete(map.keys().next().value);
  map.set(id, value);
}
function isRevoked(id) {
  const until = revokedSessions.get(id);
  if (until > Date.now()) return true;
  revokedSessions.delete(id);
  return false;
}
function verifyConcurrent(token, settings, fresh = false) {
  const id = sessionId(token, settings);
  if (isRevoked(id)) return Promise.resolve({ status: 401 });
  const cached = completedChecks.get(id);
  if (!fresh && cached?.authorization.leaseUntil > Date.now()) return Promise.resolve(cached);
  completedChecks.delete(id);
  const pending = pendingChecks.get(id);
  if (pending) return pending;
  if (pendingChecks.size >= 256) return Promise.resolve({ status: 503 });
  const check = verify(token, settings).then(result => {
    // Logout may finish while /me is in flight: never resurrect that grant.
    if (isRevoked(id)) return { status: 401 };
    if (result.status === 200) remember(completedChecks, id, result);
    return result;
  }).finally(() => pendingChecks.delete(id));
  pendingChecks.set(id, check);
  return check;
}
function validAuthorization(session, settings) {
  const a = session.authorization;
  return session.version === 2 && a?.allowed === true
    && a.clientId === settings.clientId && a.siteOrigin === new URL(settings.siteUrl).origin
    && a.authOrigin === settings.authOrigin && a.accessPolicy === settings.accessPolicy
    && typeof a.userId === 'string' && a.userId.length > 0 && a.userId.length <= 256
    && ['policy', 'manual_grant'].includes(a.source)
    && Number.isFinite(a.verifiedAt) && a.verifiedAt > 0 && a.verifiedAt <= Date.now()
    && Number.isFinite(a.leaseUntil) && a.leaseUntil > a.verifiedAt
    && a.leaseUntil <= a.verifiedAt + AUTHORIZATION_LEASE_MS && a.leaseUntil <= session.expires;
}
async function sessionCookie(session, secret, audience) {
  const cookie = await seal(session, secret, audience);
  return COOKIE + '=' + cookie + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + Math.max(0, Math.floor((session.expires - Date.now()) / 1000));
}

export async function serveProtected(request, env, settings) {
  const url = new URL(request.url);
  // Only the explicitly registered deployment origin can serve protected content.
  if (url.origin !== new URL(settings.siteUrl).origin) return response(null, 403);
  if (typeof env.NAKWOL_SESSION_SECRET !== 'string' || env.NAKWOL_SESSION_SECRET.length < 32) return denied(request, 503, settings);
  const audience = `${url.origin}/${settings.clientId}`;
  const session = await readSession(request, env.NAKWOL_SESSION_SECRET, audience);
  if (['/__nakwol/session', '/__nakwol/logout'].includes(url.pathname)) {
    if (request.method !== 'POST') return response(null, 405);
    if (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return response(null, 403);
    if (url.pathname.endsWith('/logout')) {
      let revoked = !session;
      if (session) {
        const id = sessionId(session.token, settings);
        remember(revokedSessions, id, session.expires);
        completedChecks.delete(id);
        try {
          const result = await fetch(new URL('/logout', settings.authOrigin), { method: 'POST', headers: { Authorization: `Bearer ${session.token}` }, redirect: 'manual', signal: AbortSignal.timeout(7000) });
          revoked = result.ok;
        } catch { revoked = false; }
      }
      return response(null, 204, { 'Set-Cookie': clearCookie, 'X-Nakwol-Revoke': revoked ? 'confirmed' : 'failed' });
    }
    if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') return response(null, 415);
    // Bound the body before buffering it, including chunked requests.
    const reader = request.body?.getReader();
    if (!reader) return response(null, 400);
    const chunks = []; let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 8192) { await reader.cancel(); return response(null, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let token;
    try { token = JSON.parse(new TextDecoder().decode(bytes)).access_token; } catch { return response(null, 400); }
    if (typeof token !== 'string' || token.length < 1 || token.length > 2048) return response(null, 400);
    const checked = await verifyConcurrent(token, settings, true);
    if (checked.status !== 200) return denied(request, checked.status, settings);
    const expires = Math.min(checked.expires, Date.now() + 3600000);
    const authorization = { ...checked.authorization, leaseUntil: Math.min(checked.authorization.leaseUntil, expires) };
    const cookie = await sessionCookie({ version: 2, token, expires, authorization }, env.NAKWOL_SESSION_SECRET, audience);
    if (isRevoked(sessionId(token, settings))) return denied(request, 401, settings);
    return response(null, 204, { 'Set-Cookie': cookie });
  }
  if (!['GET', 'HEAD'].includes(request.method)) return response(null, 405);
  if (url.pathname === '/__nakwol/login' || (url.pathname === '/' && (url.searchParams.has('code') || url.searchParams.has('error')))) return denied(request, 401, settings);
  if (!session) return denied(request, 401, settings);
  if (isRevoked(sessionId(session.token, settings))) return denied(request, 401, settings);
  // Only the previously shipped token-only format can migrate via central validation.
  const legacy = session.version === undefined && session.authorization === undefined;
  if (!legacy && !validAuthorization(session, settings)) return denied(request, 403, settings);
  let renewedCookie;
  if (legacy || session.authorization.leaseUntil <= Date.now()) {
    const checked = await verifyConcurrent(session.token, settings);
    if (checked.status !== 200) return denied(request, checked.status, settings);
    const expires = Math.min(session.expires, checked.expires);
    if (expires <= Date.now()) return denied(request, 401, settings);
    const authorization = { ...checked.authorization, leaseUntil: Math.min(checked.authorization.leaseUntil, expires) };
    renewedCookie = await sessionCookie({ version: 2, token: session.token, expires, authorization }, env.NAKWOL_SESSION_SECRET, audience);
  }
  if (isRevoked(sessionId(session.token, settings))) return denied(request, 401, settings);
  const asset = await env.ASSETS.fetch(request);
  const headers = new Headers(asset.headers);
  // Conditional requests also require a valid authorization lease before returning 304.
  headers.set('Cache-Control', asset.headers.has('ETag') && [200, 304].includes(asset.status)
    ? 'private, no-cache, max-age=0, must-revalidate' : 'private, no-store, max-age=0');
  headers.set('Vary', [headers.get('Vary'), 'Cookie'].filter(Boolean).join(', '));
  if (renewedCookie) headers.set('Set-Cookie', renewedCookie);
  headers.set('X-Nakwol-Gate', 'v1');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(asset.body, { status: asset.status, headers });
}

// Public server API: hosts provide only their secret and protected content handler.
export function createGate(settings) {
  const config = Object.freeze({ ...settings });
  for (const name of ['siteUrl', 'authOrigin']) {
    const url = new URL(config[name]);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error(`${name} must be HTTPS`);
  }
  if (!config.clientId || !['member', 'guest', 'admin'].includes(config.accessPolicy)) throw new Error('clientId and accessPolicy are required');
  return (request, { sessionSecret, serveAsset }) => serveProtected(request, {
    NAKWOL_SESSION_SECRET: sessionSecret,
    ASSETS: { fetch: serveAsset },
  }, config);
}
