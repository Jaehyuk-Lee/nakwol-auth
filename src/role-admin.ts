import type { Context, Hono } from 'hono';
import { authenticateAccessToken, logAuthEvent } from './store';
import { getRequiredRoleIds, parseRequiredRoleIds, RoleSettingsError } from './role-settings';
import type { Env } from './types';

type Role = { readonly id: string; readonly name: string };
class RoleCatalogError extends Error {}

async function requireOperator(c: Context<{ Bindings: Env }>): Promise<{ userId: string } | Response> {
  const token = c.req.header('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return c.json({ error: { code: 'UNAUTHORIZED' } }, 401);
  const userId = await authenticateAccessToken(c.env, token, 'nakwol-connect-admin');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED' } }, 401);
  const operator = await c.env.DB.prepare("SELECT ao.role FROM auth_operators ao JOIN users u ON u.id = ao.user_id WHERE ao.user_id = ? AND u.status = 'active'").bind(userId).first();
  if (!operator) return c.json({ error: { code: 'FORBIDDEN' } }, 403);
  return { userId };
}

export async function fetchRoleCatalog(env: Env): Promise<readonly Role[]> {
  const botToken = env.DISCORD_BOT_TOKEN2 || env.DISCORD_BOT_TOKEN;
  if (!botToken || !/^[0-9]{17,20}$/.test(env.NAKWOL_GUILD_ID)) throw new RoleCatalogError('Discord 봇 토큰과 서버 설정이 필요합니다.');
  let data: unknown;
  try {
    const response = await fetch(`https://discord.com/api/v10/guilds/${env.NAKWOL_GUILD_ID}/roles`, {
      headers: { Authorization: `Bot ${botToken}` },
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    if (!response.ok) throw new RoleCatalogError('Discord 역할 목록을 불러오지 못했습니다.');
    data = await response.json();
  } catch (error) {
    if (error instanceof RoleCatalogError) throw error;
    throw new RoleCatalogError('Discord 역할 목록을 불러오지 못했습니다.');
  }
  if (!Array.isArray(data)) throw new RoleCatalogError('Discord 역할 응답이 올바르지 않습니다.');
  const roles: Role[] = [];
  for (const item of data) {
    if (typeof item !== 'object' || item === null || typeof item.id !== 'string' || !/^[0-9]{17,20}$/.test(item.id) || typeof item.name !== 'string') throw new RoleCatalogError('Discord 역할 응답이 올바르지 않습니다.');
    // @everyone is the guild ID, not an explicit member role.
    if (item.id !== env.NAKWOL_GUILD_ID) roles.push({ id: item.id, name: item.name });
  }
  return roles;
}

function rolePage(): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NAKWOL · 역할 관리</title>
<style>:root{font-family:system-ui,sans-serif;color:#e5e7eb;background:#080c14}body{max-width:960px;margin:auto;padding:24px}a{color:#c7d2fe}section{background:#111827;border:1px solid #263244;border-radius:12px;padding:20px;margin:18px 0}button{padding:9px 15px;cursor:pointer}label{display:block;padding:6px}small{color:#94a3b8}#status{white-space:pre-wrap}</style></head><body>
<nav><a href="/admin/apps">← 앱 관리</a></nav><h1>사이트별 역할 관리</h1>
<p>멤버 사이트는 시즌3 역할이 반드시 필요합니다. 추가로 선택한 세부 역할도 모두 보유해야 입장할 수 있습니다. AUTH 운영 권한은 멤버 입장 권한을 대신하지 않습니다.</p>
<p id="season"></p><button id="login">운영자 로그인</button> <button id="reload">역할 새로고침</button><p id="status" role="status"></p><main id="apps"></main>
<script type="module">
import { NakwolAuthClient } from '/sdk/v0.1.0/nakwol-auth-web.js';
const auth=new NakwolAuthClient({clientId:'nakwol-connect-admin',redirectUri:location.origin+'/admin/apps',authOrigin:location.origin});
const status=document.querySelector('#status'), apps=document.querySelector('#apps');
async function api(options={}){const headers=new Headers({'Authorization':'Bearer '+(auth.getAccessToken()||'')});if(options.body)headers.set('Content-Type','application/json');const r=await fetch('/admin/api/roles',{...options,headers});const p=await r.json();if(!r.ok)throw new Error(p.error?.message||p.error?.code||'요청 실패');return p;}
async function load(){status.textContent='불러오는 중…';apps.replaceChildren();try{const data=await api();document.querySelector('#season').textContent='필수 시즌3 역할: '+data.season_role.name+' ('+data.season_role.id+')';for(const app of data.applications){const card=document.createElement('section'),title=document.createElement('h2'),hint=document.createElement('small');title.textContent=app.name;hint.textContent=app.client_id+' · '+app.access_policy;card.append(title,hint);const checked=new Set(app.required_role_ids);for(const role of data.roles){if(role.id===data.season_role.id)continue;const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=checked.has(role.id);input.disabled=app.access_policy!=='member';input.onchange=()=>input.checked?checked.add(role.id):checked.delete(role.id);label.append(input,document.createTextNode(' '+role.name+' ('+role.id+')'));card.append(label);}const missing=app.required_role_ids.filter(id=>!data.roles.some(role=>role.id===id));if(missing.length){const warning=document.createElement('p');warning.textContent='삭제된 Discord 역할: '+missing.join(', ')+' — 저장하면 목록에서 제거됩니다.';card.append(warning);for(const id of missing)checked.delete(id);}const save=document.createElement('button');save.textContent='요구 역할 저장';save.disabled=app.access_policy!=='member';save.onclick=async()=>{save.disabled=true;try{await api({method:'POST',body:JSON.stringify({client_id:app.client_id,role_ids:[...checked].filter(id=>id!==data.season_role.id)})});status.textContent=app.name+' 역할 조건을 저장했습니다.';}catch(e){status.textContent=e.message;}finally{save.disabled=false;}};card.append(save);apps.append(card);}status.textContent='현재 Discord 역할을 불러왔습니다.';}catch(e){status.textContent=e.message;}}
document.querySelector('#login').onclick=()=>auth.login();document.querySelector('#reload').onclick=load;
try{const user=await auth.bootstrap();if(user)await load();else status.textContent='로그인 후 앱 관리에서 역할 관리로 이동하세요.';}catch(e){status.textContent=e.message;}
</script></body></html>`;
}

export function registerRoleAdminRoutes(app: Hono<{ Bindings: Env }>): void {
  for (const path of ['/admin/roles', '/admin/api/roles']) {
    app.use(path, async (c, next) => {
      c.header('Cache-Control', 'no-store');
      await next();
    });
  }
  app.get('/admin/roles', (c) => c.html(rolePage()));
  app.get('/admin/api/roles', async (c) => {
    const identity = await requireOperator(c);
    if (identity instanceof Response) return identity;
    try {
      const roles = await fetchRoleCatalog(c.env);
      const seasonRole = roles.find(role => role.id === c.env.NAKWOL_MEMBER_ROLE_ID);
      if (!seasonRole) throw new RoleCatalogError('필수 시즌3 역할이 서버에 없습니다.');
      const rows = await c.env.DB.prepare(`SELECT a.client_id, a.name, COALESCE(s.access_policy, 'member') AS access_policy FROM applications a LEFT JOIN application_settings s ON s.client_id = a.client_id ORDER BY a.name`).all<{ client_id: string; name: string; access_policy: string }>();
      const applications = await Promise.all(rows.results.map(async row => ({ ...row, required_role_ids: await getRequiredRoleIds(c.env, row.client_id) })));
      return c.json({ ok: true, roles, season_role: seasonRole, applications });
    } catch (error) {
      if (error instanceof RoleSettingsError || error instanceof RoleCatalogError) return c.json({ error: { code: 'ROLE_CONFIGURATION_UNAVAILABLE', message: error.message } }, 503);
      throw error;
    }
  });

  const save = async (c: Context<{ Bindings: Env }>) => {
    const identity = await requireOperator(c);
    if (identity instanceof Response) return identity;
    if (c.req.header('Origin') !== new URL(c.env.AUTH_ORIGIN).origin) return c.json({ error: { code: 'INVALID_ORIGIN' } }, 403);
    if (!c.req.header('Content-Type')?.toLowerCase().startsWith('application/json')) return c.json({ error: { code: 'JSON_REQUIRED' } }, 415);
    let body: unknown;
    try { body = await c.req.json(); }
    catch { return c.json({ error: { code: 'INVALID_JSON' } }, 400); }
    if (!body || typeof body !== 'object' || !('client_id' in body) || typeof body.client_id !== 'string' || !('role_ids' in body)) return c.json({ error: { code: 'INVALID_ROLE_SETTINGS' } }, 400);
    let roleIds: readonly string[];
    try { roleIds = parseRequiredRoleIds(body.role_ids); }
    catch (error) {
      if (error instanceof RoleSettingsError) return c.json({ error: { code: error.code, message: error.message } }, 400);
      throw error;
    }
    const row = await c.env.DB.prepare(`SELECT COALESCE(s.access_policy, 'member') AS access_policy FROM applications a LEFT JOIN application_settings s ON s.client_id = a.client_id WHERE a.client_id = ?`).bind(body.client_id).first<{ access_policy: string }>();
    if (!row) return c.json({ error: { code: 'APP_NOT_FOUND' } }, 404);
    if (row.access_policy !== 'member') return c.json({ error: { code: 'MEMBER_POLICY_REQUIRED' } }, 400);
    try {
      const roles = await fetchRoleCatalog(c.env);
      if (!roles.some(role => role.id === c.env.NAKWOL_MEMBER_ROLE_ID)) throw new RoleCatalogError('필수 시즌3 역할이 서버에 없습니다.');
      if (roleIds.some(id => !roles.some(role => role.id === id))) return c.json({ error: { code: 'UNKNOWN_ROLE' } }, 400);
    } catch (error) {
      if (error instanceof RoleCatalogError) return c.json({ error: { code: 'ROLE_CATALOG_UNAVAILABLE', message: error.message } }, 503);
      throw error;
    }
    const additional = roleIds.filter(id => id !== c.env.NAKWOL_MEMBER_ROLE_ID);
    await c.env.DB.prepare(`INSERT INTO application_role_requirements(client_id, role_ids, updated_at) VALUES (?, ?, ?) ON CONFLICT(client_id) DO UPDATE SET role_ids = excluded.role_ids, updated_at = excluded.updated_at`).bind(body.client_id, JSON.stringify(additional), Date.now()).run();
    await logAuthEvent(c.env, 'application.roles.updated', identity.userId, body.client_id, { role_ids: additional, season_role_id: c.env.NAKWOL_MEMBER_ROLE_ID });
    return c.json({ ok: true, required_role_ids: additional });
  };
  app.post('/admin/roles', save);
  app.post('/admin/api/roles', save);
}
