import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureSession } from '../src/session.mjs';
import { initProject, doctorProject } from '../src/commands.mjs';

async function listen(handler) { const server=createServer(handler); await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve)); const address=server.address(); return {server,origin:`http://127.0.0.1:${address.port}`}; }
const available=['profile:read','profile:write','roster:read','roster:write','equipment:read','equipment:write','decks:read','decks:write'];

test('init updates an existing app to the requested guest policy', async () => {
  let accessPolicy = 'member';
  let patched = false;
  const app = () => ({ client_id: 'private-site', redirect_uris: ['http://localhost:5173/'], framework: 'vite', access_policy: accessPolicy, status: 'active' });
  const { server, origin } = await listen(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/connect/cli/me') {
      res.end(JSON.stringify({ ok: true, data: { user: { id: 'usr_1' }, connect: { developer_role: 'developer' } } }));
      return;
    }
    if (req.url === '/connect/cli/apps/private-site' && req.method === 'PATCH') {
      let body = '';
      for await (const chunk of req) body += chunk;
      accessPolicy = JSON.parse(body).access_policy;
      patched = true;
      res.end(JSON.stringify({ ok: true, data: app() }));
      return;
    }
    if (req.url === '/connect/cli/apps/private-site') {
      res.end(JSON.stringify({ ok: true, data: app() }));
      return;
    }
    if (req.url === '/connect/cli/apps/private-site/scopes') {
      res.end(JSON.stringify({ ok: true, data: { client_id: 'private-site', registered: true, status: 'active', scopes: [], available_scopes: available } }));
      return;
    }
    if (req.url === '/openapi.json') {
      res.end(JSON.stringify({ openapi: '3.1.0', 'x-nakwol-data-scopes': available, paths: {} }));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  const root = await mkdtemp(join(tmpdir(), 'nakwol-guest-policy-'));
  const sessionPath = join(root, '.session.json');
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'private-site', dependencies: { vite: '^7' } }));
    await writeFile(join(root, 'index.html'), '<html><body><main>app</main></body></html>');
    await writeFile(join(root, '.nakwol-connect.json'), JSON.stringify({ version: 2, clientId: 'private-site', framework: 'vite', redirectUris: ['http://localhost:5173/'], integration: 'universal-embed', authMode: 'required', dataOrigin: origin, dataScopes: [] }));
    await writeFile(sessionPath, JSON.stringify({ accessToken: 'token', expiresAt: Date.now() + 60_000, authOrigin: origin }));
    const result = await initProject({ root, authOrigin: origin, dataOrigin: origin, sessionPath, accessPolicy: 'guest', noOpen: true, output: () => {} });
    assert.equal(patched, true);
    assert.equal(accessPolicy, 'guest');
    assert.equal(result.ok, false);
    assert.equal(result.doctor.ok, false);
    assert.equal(result.doctor.protectionStatus, 'unprotected');
    assert.equal(result.doctor.checks.find((check) => check.name === 'central_access_policy')?.ok, true);
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('device login starts only without a reusable session', async()=>{let starts=0,polls=0; const {server,origin}=await listen(async(req,res)=>{res.setHeader('Content-Type','application/json'); if(req.url==='/connect/cli/device/start'){starts++;res.end(JSON.stringify({ok:true,device_code:'dev',user_code:'ABCD-EFGH',verification_uri_complete:`${origin}/verify`,expires_in:60,interval:0}));return;} if(req.url==='/connect/cli/device/token'){polls++;res.end(JSON.stringify({access_token:'token-1',expires_in:3600}));return;} if(req.url==='/connect/cli/me'){const auth=req.headers.authorization||'';if(auth==='Bearer token-1')res.end(JSON.stringify({ok:true,data:{user:{id:'usr_1'},connect:{developer_role:'developer'}}}));else{res.statusCode=401;res.end(JSON.stringify({ok:false}));}return;}res.statusCode=404;res.end('{}');});const root=await mkdtemp(join(tmpdir(),'nakwol-session-'));const sessionPath=join(root,'session.json');try{const one=await ensureSession({authOrigin:origin,sessionPath,noOpen:true,output:()=>{},sleep:async()=>{}});const two=await ensureSession({authOrigin:origin,sessionPath,noOpen:true,output:()=>{},sleep:async()=>{}});assert.equal(one.accessToken,'token-1');assert.equal(two.accessToken,'token-1');assert.equal(starts,1);assert.equal(polls,1);}finally{server.close();await rm(root,{recursive:true,force:true});}});

test('init registers AUTH then DATA before local installation and writes config v2', async()=>{let created=false,dataConfigured=false;const {server,origin}=await listen(async(req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/connect/cli/me'){res.end(JSON.stringify({ok:true,data:{user:{id:'usr_1'},connect:{developer_role:'developer'}}}));return;}if(req.url==='/connect/cli/apps'&&req.method==='POST'){created=true;res.statusCode=201;res.end(JSON.stringify({ok:true,data:{client_id:'battle-map',redirect_uris:['http://localhost:5173/'],framework:'react',access_policy:'member',status:'active'}}));return;}if(req.url==='/connect/cli/apps/battle-map'){res.end(JSON.stringify({ok:true,data:{client_id:'battle-map',redirect_uris:['http://localhost:5173/'],framework:'react',access_policy:'member',status:'active'}}));return;}if(req.url==='/connect/cli/apps/battle-map/scopes'&&req.method==='PUT'){assert.equal(created,true);dataConfigured=true;let body='';for await(const c of req)body+=c;const scopes=JSON.parse(body).scopes;res.end(JSON.stringify({ok:true,data:{client_id:'battle-map',registered:true,status:'active',scopes,available_scopes:available}}));return;}if(req.url==='/connect/cli/apps/battle-map/scopes'){res.end(JSON.stringify({ok:true,data:{client_id:'battle-map',registered:true,status:'active',scopes:[],available_scopes:available}}));return;}if(req.url==='/openapi.json'){res.end(JSON.stringify({openapi:'3.1.0','x-nakwol-data-scopes':available,paths:{}}));return;}res.statusCode=404;res.end(JSON.stringify({ok:false}));});const root=await mkdtemp(join(tmpdir(),'nakwol-init-'));const sessionPath=join(root,'.session.json');try{await writeFile(join(root,'package.json'),JSON.stringify({name:'battle-map',dependencies:{react:'^19',vite:'^7'}}));await writeFile(join(root,'index.html'),'<html><body><main>app</main></body></html>');await writeFile(sessionPath,JSON.stringify({accessToken:'token',expiresAt:Date.now()+60_000,authOrigin:origin}));const result=await initProject({root,authOrigin:origin,dataOrigin:origin,sessionPath,noOpen:true,output:()=>{}});assert.equal(created,true);assert.equal(dataConfigured,true);assert.equal(result.clientId,'battle-map');const html=await readFile(join(root,'index.html'),'utf8');assert.match(html,/NAKWOL-CONNECT:START/);assert.match(html,/data-data-origin=/);const config=JSON.parse(await readFile(join(root,'.nakwol-connect.json'),'utf8'));assert.equal(config.version,2);assert.equal(config.clientId,'battle-map');assert.deepEqual(config.dataScopes,[]);}finally{server.close();await rm(root,{recursive:true,force:true});}});

test('init does not create a duplicate when configured app is owned by someone else', async()=>{let created=false;const {server,origin}=await listen(async(req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/connect/cli/me'){res.end(JSON.stringify({ok:true,data:{user:{id:'usr_2'},connect:{developer_role:'developer'}}}));return;}if(req.url==='/connect/cli/apps/battle-map'){res.statusCode=403;res.end(JSON.stringify({ok:false,error:{code:'APP_OWNERSHIP_REQUIRED',message:'not owner'}}));return;}if(req.url==='/connect/cli/apps'&&req.method==='POST'){created=true;res.statusCode=201;res.end(JSON.stringify({ok:true,data:{client_id:'battle-map-2'}}));return;}res.statusCode=404;res.end('{}');});const root=await mkdtemp(join(tmpdir(),'nakwol-owned-'));const sessionPath=join(root,'.session.json');try{await writeFile(join(root,'package.json'),JSON.stringify({name:'battle-map',dependencies:{vite:'^7'}}));await writeFile(join(root,'index.html'),'<html><body></body></html>');await writeFile(join(root,'.nakwol-connect.json'),JSON.stringify({version:1,clientId:'battle-map',framework:'vite',redirectUris:['http://localhost:5173/'],integration:'universal-embed'}));await writeFile(sessionPath,JSON.stringify({accessToken:'token',expiresAt:Date.now()+60_000,authOrigin:origin}));await assert.rejects(()=>initProject({root,authOrigin:origin,dataOrigin:origin,sessionPath,noOpen:true,output:()=>{}}),/not owner/);assert.equal(created,false);}finally{server.close();await rm(root,{recursive:true,force:true});}});

test('doctor fails deterministically when integration marker is missing', async()=>{const root=await mkdtemp(join(tmpdir(),'nakwol-doctor-'));try{await writeFile(join(root,'package.json'),JSON.stringify({name:'battle-map',dependencies:{vite:'^7'}}));await writeFile(join(root,'index.html'),'<html><body></body></html>');await writeFile(join(root,'.nakwol-connect.json'),JSON.stringify({version:1,clientId:'battle-map',framework:'vite',redirectUris:['http://localhost:5173/'],integration:'universal-embed'}));const result=await doctorProject({root,offline:true});assert.equal(result.ok,false);assert.equal(result.checks.find((item)=>item.name==='marker')?.ok,false);}finally{await rm(root,{recursive:true,force:true});}});
