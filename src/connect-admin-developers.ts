import type { Context, Hono } from 'hono';
import {
  grantDiscordDeveloperPregrant,
  isDiscordUserId,
  updateDiscordDeveloperPregrant,
} from './connect-developer-pregrants';
import { authenticateAccessToken, getUserWithMembership, logAuthEvent } from './store';
import type { Env } from './types';

const ADMIN_CLIENT_ID = 'nakwol-connect-admin';

export function canRequestAccessPolicy(isOperator: boolean, policy: string): boolean {
  return policy === 'guest' || policy === 'public' || policy === 'member' || (isOperator && policy === 'admin');
}

export function canManageOwnedApplication(input: {
  isOperator: boolean;
  userId: string;
  ownerUserIds: string[];
}): boolean {
  return input.isOperator || input.ownerUserIds.includes(input.userId);
}

export function nextAvailableClientId(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function resolveAppStatus(current: string, requested?: string): 'active' | 'disabled' {
  if (requested === undefined) return current === 'disabled' ? 'disabled' : 'active';
  return requested === 'disabled' ? 'disabled' : 'active';
}

export function hasConnectAppScope(scopes: string[]): boolean {
  return scopes.includes('connect:apps');
}

function bearer(c: Context<{ Bindings: Env }>): string | null {
  const header = c.req.header('Authorization') || '';
  return header.match(/^Bearer\s+(.+)$/i)?.[1] || null;
}

async function requireOperator(c: Context<{ Bindings: Env }>): Promise<{ userId: string } | Response> {
  const raw = bearer(c);
  if (!raw) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, 401);
  const userId = await authenticateAccessToken(c.env, raw, ADMIN_CLIENT_ID);
  if (!userId) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '유효하지 않은 로그인입니다.' } }, 401);
  const [operator, user] = await Promise.all([
    c.env.DB.prepare(`SELECT role FROM auth_operators WHERE user_id = ?`).bind(userId).first<{ role: string }>(),
    getUserWithMembership(c.env, userId),
  ]);
  if (!operator && user?.membership?.role !== 'admin') {
    return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'NAKWOL Connect 운영 권한이 필요합니다.' } }, 403);
  }
  return { userId };
}

function developerPage(): string {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NAKWOL Connect · 개발자 관리</title><style>
:root{font-family:Inter,Pretendard,system-ui,-apple-system,"Segoe UI",sans-serif;color:#e5e7eb;background:#080c14;--panel:#111827;--line:#263244;--muted:#94a3b8;--accent:#6366f1}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#080c14}header{height:70px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;border-bottom:1px solid var(--line)}a{color:#c7d2fe;text-decoration:none}main{max-width:1050px;margin:0 auto;padding:24px}.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:20px;margin-bottom:16px}.head{display:flex;justify-content:space-between;align-items:center;gap:12px}.muted{color:var(--muted)}button,input,select{font:inherit}button{border:0;border-radius:9px;padding:8px 12px;font-weight:750;cursor:pointer}.primary{background:var(--accent);color:white}.ghost{background:#273349;color:#e5e7eb}.row{display:grid;grid-template-columns:minmax(250px,1fr) 130px 120px 110px auto;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid #1f2937}.row small{display:block;color:var(--muted);margin-top:3px;overflow-wrap:anywhere}.form{display:grid;grid-template-columns:1fr 170px auto;gap:10px}.form input,.form select{background:#0b1220;color:#f8fafc;border:1px solid #334155;border-radius:9px;padding:10px}.bad{color:#fecaca}.ok{color:#86efac}.pending{color:#fde68a}@media(max-width:720px){.row,.form{grid-template-columns:1fr}.row{padding:14px 0}}
</style></head><body>
<header><div><b>落月 · NAKWOL Connect</b><div class="muted">개발자 권한 · Discord ID 사전 허가</div></div><div><a href="/admin/apps">← 앱 관리</a> <button id="login" class="primary" type="button">로그인</button></div></header>
<main><section class="card"><div class="head"><div><h2>개발자 사전 권한</h2><p class="muted">Discord 사용자 ID만 미리 등록할 수 있습니다. 상대가 아직 NAKWOL에 로그인한 적이 없어도 되며, 첫 Connect CLI 승인 시 해당 Discord 계정과 자동 연결됩니다.</p></div><button id="refresh" class="ghost" type="button">새로고침</button></div><div class="form"><input id="discord-user-id" inputmode="numeric" pattern="[0-9]{15,22}" placeholder="Discord 사용자 ID (예: 123456789012345678)"><select id="role"><option value="developer">developer</option><option value="operator">operator</option></select><button id="grant" class="primary" type="button">사전 권한 부여</button></div><div id="status" class="muted" style="margin-top:12px"></div></section>
<section class="card"><div id="list"></div></section></main>
<script type="module">
import { NakwolAuthClient } from '/sdk/v0.1.0/nakwol-auth-web.js';
const auth = new NakwolAuthClient({ clientId:'nakwol-connect-admin', redirectUri: location.origin + '/admin/developers', authOrigin: location.origin });
const $=(s)=>document.querySelector(s); const status=$('#status'), list=$('#list');
const api=async(path,options={})=>{const h=new Headers(options.headers||{});const t=auth.getAccessToken();if(t)h.set('Authorization','Bearer '+t);if(options.body)h.set('Content-Type','application/json');const r=await fetch(path,{...options,headers:h});const p=await r.json().catch(()=>({}));if(!r.ok)throw new Error(p?.error?.message||p?.error?.code||('HTTP '+r.status));return p;};
async function load(){list.textContent='불러오는 중…';try{const p=await api('/admin/api/developers');list.textContent='';for(const d of p.data||[]){const row=document.createElement('div');row.className='row';const who=document.createElement('div');const b=document.createElement('b');b.textContent=d.display_name||'아직 NAKWOL 미가입';const sm=document.createElement('small');const bits=[];if(d.pregrant_discord_id||d.discord_user_id)bits.push('Discord '+(d.pregrant_discord_id||d.discord_user_id));if(d.user_id)bits.push(d.user_id);if(d.grant_source)bits.push(d.grant_source);sm.textContent=bits.join(' · ');who.append(b,sm);const role=document.createElement('span');role.textContent=d.developer_role||'member';const st=document.createElement('span');st.textContent=d.developer_status||'-';if(!d.user_id&&d.pregrant_discord_id)st.className='pending';const count=document.createElement('span');count.textContent=(d.owned_app_count||0)+' apps';const actions=document.createElement('div');if(d.developer_role){const btn=document.createElement('button');btn.className='ghost';btn.textContent=d.developer_status==='disabled'?'활성화':'비활성화';btn.onclick=async()=>{try{const next=d.developer_status==='disabled'?'active':'disabled';if(d.pregrant_discord_id){await api('/admin/api/developer-pregrants/'+encodeURIComponent(d.pregrant_discord_id),{method:'PATCH',body:JSON.stringify({role:d.developer_role,status:next})});}else if(d.user_id){await api('/admin/api/developers/'+encodeURIComponent(d.user_id),{method:'PATCH',body:JSON.stringify({role:d.developer_role,status:next})});}await load();}catch(e){status.textContent=e.message;status.className='bad';}};actions.append(btn);}row.append(who,role,st,count,actions);list.append(row);}status.textContent='';status.className='muted';}catch(e){list.textContent='';status.textContent=e.message;status.className='bad';}}
$('#login').onclick=()=>auth.login();$('#refresh').onclick=load;$('#grant').onclick=async()=>{try{const discordUserId=$('#discord-user-id').value.trim();await api('/admin/api/developers',{method:'POST',body:JSON.stringify({discord_user_id:discordUserId,role:$('#role').value})});status.textContent='Discord ID 사전 권한을 반영했습니다.';status.className='ok';$('#discord-user-id').value='';await load();}catch(e){status.textContent=e.message;status.className='bad';}};
try{const user=await auth.bootstrap();if(user){$('#login').textContent=user.display_name||'로그인됨';await load();}}catch(e){status.textContent=e.message;status.className='bad';}
</script></body></html>`;
}

export function registerConnectDeveloperAdminRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/admin/developers', (c) => c.html(developerPage()));

  app.get('/admin/api/developers', async (c) => {
    const identity = await requireOperator(c);
    if (identity instanceof Response) return identity;
    const [result, pending] = await Promise.all([
      c.env.DB.prepare(
        `SELECT u.id AS user_id, u.display_name, u.avatar_url,
                COALESCE(cd.role, CASE WHEN ao.user_id IS NOT NULL THEN 'operator' ELSE NULL END) AS developer_role,
                COALESCE(cd.status, CASE WHEN ao.user_id IS NOT NULL THEN 'active' ELSE NULL END) AS developer_status,
                cd.grant_source,
                cd.discord_user_id,
                p.discord_user_id AS pregrant_discord_id,
                COUNT(DISTINCT ow.client_id) AS owned_app_count
           FROM users u
           LEFT JOIN connect_developers cd ON cd.user_id = u.id
           LEFT JOIN connect_developer_pregrants p ON p.discord_user_id = cd.discord_user_id
           LEFT JOIN auth_operators ao ON ao.user_id = u.id
           LEFT JOIN application_owners ow ON ow.user_id = u.id
          GROUP BY u.id, u.display_name, u.avatar_url, cd.role, cd.status, cd.grant_source, cd.discord_user_id, p.discord_user_id, ao.user_id
          ORDER BY CASE WHEN ao.user_id IS NOT NULL OR cd.role = 'operator' THEN 0 WHEN cd.role = 'developer' THEN 1 ELSE 2 END,
                   u.display_name ASC`,
      ).all(),
      c.env.DB.prepare(
        `SELECT discord_user_id AS pregrant_discord_id,
                NULL AS user_id,
                NULL AS display_name,
                NULL AS avatar_url,
                role AS developer_role,
                status AS developer_status,
                'discord_pregrant' AS grant_source,
                discord_user_id,
                0 AS owned_app_count
           FROM connect_developer_pregrants
          WHERE linked_user_id IS NULL
          ORDER BY updated_at DESC`,
      ).all(),
    ]);
    return c.json({ ok: true, data: [...(result.results || []), ...(pending.results || [])] });
  });

  app.post('/admin/api/developers', async (c) => {
    const identity = await requireOperator(c);
    if (identity instanceof Response) return identity;
    const body: { user_id?: string; discord_user_id?: string; role?: string } = await c.req.json().catch(() => ({} as { user_id?: string; discord_user_id?: string; role?: string }));
    const role = body.role === 'operator' ? 'operator' : 'developer';
    const discordUserId = String(body.discord_user_id || '').trim();

    if (discordUserId) {
      if (!isDiscordUserId(discordUserId)) {
        return c.json({ ok: false, error: { code: 'INVALID_DISCORD_USER_ID', message: 'Discord 사용자 ID는 숫자로 된 사용자 ID여야 합니다.' } }, 400);
      }
      const granted = await grantDiscordDeveloperPregrant(c.env, {
        discordUserId,
        role,
        createdByUserId: identity.userId,
      });
      await logAuthEvent(c.env, 'connect.developer.pregrant.granted', identity.userId, null, {
        discord_user_id: discordUserId,
        role,
        linked_user_id: granted.linkedUserId,
      });
      return c.json({ ok: true, data: { discord_user_id: discordUserId, linked_user_id: granted.linkedUserId } });
    }

    const userId = String(body.user_id || '').trim();
    if (!userId || !await getUserWithMembership(c.env, userId)) {
      return c.json({ ok: false, error: { code: 'USER_NOT_FOUND', message: 'NAKWOL 사용자를 찾을 수 없습니다.' } }, 404);
    }
    const now = Date.now();
    await c.env.DB.prepare(
      `INSERT INTO connect_developers(user_id, role, status, created_at, updated_at, created_by_user_id, grant_source, discord_user_id)
       VALUES (?, ?, 'active', ?, ?, ?, 'manual', NULL)
       ON CONFLICT(user_id) DO UPDATE SET
         role = excluded.role,
         status = 'active',
         updated_at = excluded.updated_at,
         grant_source = 'manual',
         discord_user_id = NULL`,
    ).bind(userId, role, now, now, identity.userId).run();
    await logAuthEvent(c.env, 'connect.developer.granted', identity.userId, null, { user_id: userId, role });
    return c.json({ ok: true });
  });

  app.patch('/admin/api/developer-pregrants/:discordUserId', async (c) => {
    const identity = await requireOperator(c);
    if (identity instanceof Response) return identity;
    const discordUserId = c.req.param('discordUserId').trim();
    if (!isDiscordUserId(discordUserId)) {
      return c.json({ ok: false, error: { code: 'INVALID_DISCORD_USER_ID', message: '올바른 Discord 사용자 ID가 아닙니다.' } }, 400);
    }
    const body: { status?: string; role?: string } = await c.req.json().catch(() => ({} as { status?: string; role?: string }));
    const status = body.status === 'disabled' ? 'disabled' : 'active';
    const role = body.role === 'operator' ? 'operator' : 'developer';
    const updated = await updateDiscordDeveloperPregrant(c.env, { discordUserId, role, status });
    if (!updated) return c.json({ ok: false, error: { code: 'PREGRANT_NOT_FOUND', message: 'Discord ID 사전 권한을 찾을 수 없습니다.' } }, 404);
    await logAuthEvent(c.env, 'connect.developer.pregrant.updated', identity.userId, null, { discord_user_id: discordUserId, role, status });
    return c.json({ ok: true });
  });

  app.patch('/admin/api/developers/:userId', async (c) => {
    const identity = await requireOperator(c);
    if (identity instanceof Response) return identity;
    const target = c.req.param('userId');
    const body: { status?: string; role?: string } = await c.req.json().catch(() => ({} as { status?: string; role?: string }));
    const status = body.status === 'disabled' ? 'disabled' : 'active';
    const role = body.role === 'operator' ? 'operator' : 'developer';
    const result = await c.env.DB.prepare(
      `UPDATE connect_developers SET role = ?, status = ?, updated_at = ? WHERE user_id = ?`,
    ).bind(role, status, Date.now(), target).run();
    if (Number(result.meta?.changes ?? 0) < 1) return c.json({ ok: false, error: { code: 'DEVELOPER_NOT_FOUND', message: '개발자 등록을 찾을 수 없습니다.' } }, 404);
    await logAuthEvent(c.env, 'connect.developer.updated', identity.userId, null, { user_id: target, role, status });
    return c.json({ ok: true });
  });

  app.post('/admin/api/apps/:clientId/owners', async (c) => {
    const identity = await requireOperator(c);
    if (identity instanceof Response) return identity;
    const clientId = c.req.param('clientId');
    const body: { user_id?: string } = await c.req.json().catch(() => ({} as { user_id?: string }));
    const target = String(body.user_id || '').trim();
    if (!target) return c.json({ ok: false, error: { code: 'USER_ID_REQUIRED', message: 'user_id가 필요합니다.' } }, 400);
    const [appRow, developer] = await Promise.all([
      c.env.DB.prepare(`SELECT client_id FROM applications WHERE client_id = ?`).bind(clientId).first(),
      c.env.DB.prepare(`SELECT status FROM connect_developers WHERE user_id = ?`).bind(target).first<{ status: string }>(),
    ]);
    if (!appRow) return c.json({ ok: false, error: { code: 'APP_NOT_FOUND', message: '앱을 찾을 수 없습니다.' } }, 404);
    if (developer?.status !== 'active' && !await c.env.DB.prepare(`SELECT user_id FROM auth_operators WHERE user_id = ?`).bind(target).first()) {
      return c.json({ ok: false, error: { code: 'DEVELOPER_REQUIRED', message: '활성 개발자에게만 앱을 할당할 수 있습니다.' } }, 400);
    }
    await c.env.DB.prepare(
      `INSERT INTO application_owners(client_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)
       ON CONFLICT(client_id, user_id) DO NOTHING`,
    ).bind(clientId, target, Date.now()).run();
    await logAuthEvent(c.env, 'connect.app.owner.assigned', identity.userId, clientId, { user_id: target });
    return c.json({ ok: true });
  });
}
