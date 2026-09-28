import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeProjectConfig, readProjectConfig } from '../src/config.mjs';
import { installProtection, inspectProtection, assetInventory } from '../src/protection.mjs';
import { verifyProtection } from '../src/protection-verify.mjs';
import { serveProtected, COOKIE } from '../src/server/gate.mjs';
import { loginPage } from '../src/server/login.mjs';
import { initProject, doctorProject, removeProject } from '../src/commands.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'nakwol-protect-'));
  t.after(() => rm(root, { recursive:true, force:true }));
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'index.html'), '<html><body>PRIVATE</body></html>');
  await writeFile(join(root, 'dist/index.html'), '<html><body>PRIVATE</body></html>');
  await writeFile(join(root, 'dist/private.json'), '{"secret":"PRIVATE"}');
  await writeProjectConfig(root, { clientId:'test-site', framework:'html', redirectUris:['https://site.test/'], integration:'universal-embed', authMode:'required' });
  return root;
}
const options = root => ({ root, provider:'cloudflare-workers', assets:'dist', url:'https://site.test/' });

test('installer preserves existing files, rejects unsafe assets and provides verifiable Worker wiring', async t => {
  const root = await fixture(t);
  await assert.rejects(() => assetInventory(root, '.'), /루트/);
  await assert.rejects(() => installProtection({ ...options(root), provider:'github-pages' }), /지원 환경/);
  await writeFile(join(root,'dist/.env'), 'secret');
  await assert.rejects(() => installProtection(options(root)), /소스/);
  await rm(join(root,'dist/.env'));
  const result = await installProtection(options(root));
  assert.equal(result.protectionStatus, 'configured');
  const wrangler = JSON.parse(await readFile(join(root,'wrangler.nakwol.json'),'utf8'));
  assert.equal(wrangler.assets.run_worker_first, true);
  assert.equal(wrangler.assets.binding, 'ASSETS');
  assert.equal(wrangler.preview_urls, false);
  assert.equal((await inspectProtection(root, await readProjectConfig(root))).ok, true);
  const generatedPath=join(root,'.nakwol/server/gate.mjs');
  await writeFile(generatedPath,(await readFile(generatedPath,'utf8')).replaceAll('\r\n','\n').replaceAll('\n','\r\n'));
  assert.equal((await inspectProtection(root, await readProjectConfig(root))).ok,true,'Windows Git line endings preserve protection integrity');
  await installProtection(options(root));
  const source = await readFile(join(root,'index.html'),'utf8');
  assert.match(source, /data-server-gate="true"/);
  assert.match(source, /data-redirect-uri="https:\/\/site.test\/"/);
  await assert.rejects(() => removeProject({root}), /サーバー|서버 보호/);
  await writeFile(join(root,'.nakwol/server/index.mjs'),'custom changes');
  await assert.rejects(() => installProtection(options(root)), /덮어쓰지/);
  assert.equal(await readFile(join(root,'.nakwol/server/index.mjs'),'utf8'),'custom changes');
});

test('doctor distinguishes an embed from server protection', async t => {
  const root = await fixture(t);
  const result = await doctorProject({root,offline:true});
  assert.equal(result.protectionStatus,'unprotected');
  assert.equal(result.checks.find(c=>c.name==='server_gate').ok,false);
});

test('required doctor cannot bypass live verification with offline or connectionOnly', async t => {
  const root = await fixture(t);
  await installProtection(options(root));
  const result = await doctorProject({ root, offline:true, connectionOnly:true });
  assert.equal(result.ok, false);
  assert.equal(result.checks.find(c => c.name === 'server_gate').ok, true);
  assert.equal(result.checks.find(c => c.name === 'anonymous_blocking').ok, false);
});

test('init installs Pages gate but exits incomplete until deployed; optional stays public', async t => {
  const root = await fixture(t);
  const sessionPath = join(root, '.session.json');
  const authOrigin = 'https://auth.test';
  await writeFile(sessionPath, JSON.stringify({ accessToken:'fixture', expiresAt:Date.now()+60000, authOrigin }));
  let deployed = false;
  const fetchImpl = async url => {
    const parsed = new URL(url);
    if (parsed.hostname === 'site.test') return new Response(null, { status:deployed ? 401 : 200, headers:{ 'X-Nakwol-Gate':'v1', 'Cache-Control':'no-store' } });
    if (parsed.pathname.endsWith('/me')) return Response.json({ ok:true, data:{ user:{ id:'test' } } });
    if (parsed.pathname.endsWith('/scopes')) return Response.json({ ok:true, data:{ registered:true, scopes:[], available_scopes:[] } });
    if (parsed.pathname === '/openapi.json') return Response.json({ openapi:'3.1.0', 'x-nakwol-data-scopes':[], paths:{} });
    return Response.json({ ok:true, data:{ client_id:'test-site', status:'active', access_policy:'member', redirect_uris:['https://site.test/'] } });
  };
  const messages = [];
  const opts = { ...options(root), provider:'cloudflare-pages', projectName:'existing-pages-site', authOrigin, dataOrigin:'https://data.test', sessionPath, fetchImpl, output:message => messages.push(message) };
  const pending = await initProject(opts);
  assert.equal(pending.ok, false);
  assert.match(messages[0], /설치 미완료/);
  const routes = JSON.parse(await readFile(join(root, 'dist/_routes.json'), 'utf8'));
  assert.deepEqual(routes, { version:1, include:['/*'], exclude:[] });
  assert.equal(JSON.parse(await readFile(join(root, 'wrangler.nakwol.json'), 'utf8')).name, 'existing-pages-site');
  deployed = true;
  const complete = await initProject(opts);
  assert.equal(complete.ok, true);
  assert.equal(complete.doctor.protectionStatus, 'anonymous-blocking-verified');
  const automatic = await doctorProject({ root, authOrigin, sessionPath, fetchImpl });
  assert.equal(automatic.ok, true, 'stored production URL must be verified without --url');
  await writeFile(join(root, 'dist/_routes.json'), '{"version":1,"include":["/*"],"exclude":["/private.json"]}');
  assert.equal((await inspectProtection(root, await readProjectConfig(root))).ok, false);

  const publicRoot = await fixture(t);
  const publicResult = await initProject({ ...opts, root:publicRoot, provider:undefined, authMode:'optional' });
  assert.equal(publicResult.ok, true);
  assert.equal(publicResult.config.protection, undefined);
});

test('live probe rejects public content, redirects, outage and generic denial without gate evidence', async t => {
  const root = await fixture(t);
  await installProtection(options(root));
  const requests=[];
  const good = async (url, init) => {
    requests.push({url:String(url),...init});
    return new Response(null,{status:401,headers:{'X-Nakwol-Gate':'v1','Cache-Control':'private, no-store'}});
  };
  const result=await verifyProtection({root,fetchImpl:good});
  assert.equal(result.ok,true);
  assert.equal(result.assetCount,2);
  assert.equal(result.requestCount,12);
  assert.equal(requests.some(r=>r.headers.Range),true);
  assert.equal(requests.some(r=>r.method==='HEAD'),true);
  for(const status of [200,206,302,404,503]){
    const failed=await verifyProtection({root,fetchImpl:async()=>new Response(null,{status,headers:{'X-Nakwol-Gate':'v1','Cache-Control':'no-store'}})});
    assert.equal(failed.ok,false,`HTTP ${status} must fail`);
  }
  assert.equal((await verifyProtection({root,fetchImpl:async()=>new Response(null,{status:401})})).ok,false);
  const alternate=await verifyProtection({root,alternateOrigins:'https://old.test/',fetchImpl:async url=>String(url).startsWith('https://old.test')?new Response('LEAK'):good(url,{})});
  assert.equal(alternate.ok,false);
});

test('server gate enforces authentication on content, HEAD and Range; rechecks revoked sessions', async t => {
  const originalFetch=globalThis.fetch; t.after(()=>{globalThis.fetch=originalFetch;});
  let authStatus=200, member=true, assetCalls=0, manualClient=null;
  const settings={clientId:'test-site',authOrigin:'https://auth.test',siteUrl:'https://site.test/',accessPolicy:'member'};
  globalThis.fetch=async(url,init)=>{
    if(new URL(url).pathname==='/logout')return new Response(null,{status:204});
    assert.equal(new URL(url).searchParams.get('client_id'),'test-site');
    assert.equal(init.headers['X-Nakwol-Require-Member'],'true');
    return authStatus===200?Response.json({ok:true,data:{status:'active',membership:{is_member:member}},application_access:{client_id:manualClient,allowed:true,source:'manual_grant'},expires_at:Date.now()+60000}):new Response(null,{status:authStatus});
  };
  const env={NAKWOL_SESSION_SECRET:'a'.repeat(40),ASSETS:{fetch:async()=>{assetCalls++;return new Response('PRIVATE',{headers:{'Cache-Control':'public'}});}}};
  const request=(path='/',init={})=>serveProtected(new Request('https://site.test'+path,init),env,settings);
  for(const init of [{},{method:'HEAD'},{headers:{Range:'bytes=0-5'}},{headers:{Cookie:`${COOKIE}=invalid`}}])assert.equal((await request('/private.json',init)).status,401);
  assert.equal(assetCalls,0);
  const html=await (await request('/',{headers:{Accept:'text/html'}})).text();
  assert.match(html,/NAKWOL 로그인/); assert.doesNotMatch(html,/PRIVATE/);
  const establish=()=>request('/__nakwol/session',{method:'POST',headers:{Origin:'https://site.test','Content-Type':'application/json'},body:JSON.stringify({access_token:'test-token'})});
  member=false;assert.equal((await establish()).status,403);
  manualClient='other-site';assert.equal((await establish()).status,403);
  manualClient='test-site';assert.equal((await establish()).status,204);
  manualClient=null;member=true;
  const session=await establish(); assert.equal(session.status,204);
  const cookie=session.headers.get('Set-Cookie').split(';')[0];
  assert.match(session.headers.get('Set-Cookie'),/HttpOnly; Secure; SameSite=Lax/);
  const allowed=await request('/private.json',{headers:{Cookie:cookie}});
  assert.equal(await allowed.text(),'PRIVATE');assert.match(allowed.headers.get('Cache-Control'),/no-store/);
  authStatus=403;
  const deniedSession=await request('/private.json',{headers:{Cookie:cookie}});
  assert.equal(deniedSession.status,403);
  assert.match(deniedSession.headers.get('Set-Cookie'),/Max-Age=0/);
  authStatus=401;assert.equal((await request('/private.json',{headers:{Cookie:cookie}})).status,401);
  authStatus=503;assert.equal((await request('/private.json',{headers:{Cookie:cookie}})).status,503);
  assert.equal(assetCalls,1);
  assert.equal((await request('/__nakwol/session',{method:'POST',headers:{Origin:'https://evil.test'}})).status,403);
  assert.equal((await serveProtected(new Request('https://alternate.test/'),env,settings)).status,403);
  assert.equal((await serveProtected(new Request('https://site.test/'),{...env,NAKWOL_SESSION_SECRET:''},settings)).status,503);
});

test('login bridge module parses and provides explicit denial and cookie failure messages',()=>{
  const page=loginPage({clientId:'site',authOrigin:'https://auth.test',siteUrl:'https://site.test/'},401);
  const script=page.split('<script type="module">')[1].split('</script>')[0];
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  assert.doesNotThrow(()=>new AsyncFunction(script));
  assert.match(script,/access_denied/);
  assert.match(script,/쿠키를 허용/);
});

test('login page driver restores deep links and explains role denial without reload loops',async()=>{
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const settings={clientId:'site',authOrigin:'https://auth.test',siteUrl:'https://site.test/'};
  const source=loginPage(settings,401).split('<script type="module">')[1].split('</script>')[0].replace("await import(settings.authOrigin+'/sdk/v0.3.1/nakwol-auth-web.js')",'sdk');
  const execute=new AsyncFunction('sdk','location','document','sessionStorage','fetch',source);
  const storage=new Map();
  const sessionStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
  const elements={status:{},login:{},retry:{hidden:true},recovery:{hidden:true}};
  const document={getElementById:id=>elements[id]};
  let target=null,denied=false;
  const location={origin:'https://site.test',pathname:'/private/deck',search:'',hash:'',replace:p=>{target=p;},reload(){}};
  const sdk={NakwolAuthClient:class{
    async bootstrap(){if(denied)throw {code:'access_denied'};return {id:'member'};}
    getAccessToken(){return 'fixture-token';}
    async login(){}
  }};
  await execute(sdk,location,document,sessionStorage,async()=>new Response(null,{status:204}));
  assert.equal(target,'/private/deck');
  target=null;denied=true;
  await execute(sdk,location,document,sessionStorage,async()=>{throw new Error('should not establish');});
  assert.equal(target,null);assert.match(elements.status.textContent,/시즌3/);assert.equal(elements.login.disabled,false);
  assert.equal(elements.recovery.hidden,false);
  const recoveryUrl=new URL(elements.recovery.href);
  assert.equal(recoveryUrl.pathname,'/account');
  assert.equal(recoveryUrl.searchParams.get('client_id'),'site');
  assert.equal(recoveryUrl.searchParams.get('recovery'),'1');
  denied=false;storage.set('nakwol:server:return:site:attempts',JSON.stringify([Date.now(),Date.now()]));
  await execute(sdk,location,document,sessionStorage,async()=>new Response(null,{status:204}));
  assert.equal(target,null);assert.match(elements.status.textContent,/쿠키를 허용/);
});
