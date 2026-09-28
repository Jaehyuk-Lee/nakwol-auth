import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as miniflare from 'miniflare';
import { build } from 'esbuild';
import { writeProjectConfig } from '../src/config.mjs';
import { verifyProtection } from '../src/protection-verify.mjs';

test('generated Worker runs in workerd with asset-first bypass disabled and live CLI probes', async t => {
  const root=await mkdtemp(join(tmpdir(),'nakwol-worker-runtime-'));
  await mkdir(join(root,'dist'));
  for(const file of ['index.html','private.json','video.mp4'])await writeFile(join(root,'dist',file),'PRIVATE-CONTENT');
  await writeFile(join(root,'index.html'),'<html><body>PRIVATE-CONTENT</body></html>');
  await writeProjectConfig(root,{clientId:'test-site',framework:'html',redirectUris:['https://site.test/'],integration:'universal-embed',authMode:'required'});
  const cli=fileURLToPath(new URL('../bin/nakwol-connect.mjs',import.meta.url));
  const installed=JSON.parse(execFileSync(process.execPath,[cli,'protect','install','--root',root,'--provider','cloudflare-workers','--assets','dist','--url','https://site.test/','--json'],{encoding:'utf8'}));
  assert.equal(installed.protectionStatus,'configured');
  const wrangler=JSON.parse(await readFile(join(root,'wrangler.nakwol.json'),'utf8'));
  let revoked=false;
  const bundle=await build({entryPoints:[join(root,wrangler.main)],bundle:true,format:'esm',write:false});
  const mfOptions={compatibilityDate:wrangler.compatibility_date,modules:true,script:bundle.outputFiles[0].text,bindings:{NAKWOL_SESSION_SECRET:'test-only-secret-not-production-123456789'},assets:{...wrangler.assets,directory:join(root,'dist'),routerConfig:{has_user_worker:true}},outboundService:async request=>{
    const url=new URL(request.url);
    if(url.pathname==='/logout'){revoked=true;return new Response(null,{status:204});}
    if(revoked)return new Response(null,{status:401});
    if(request.headers.get('Authorization')!=='Bearer fixture-member-token')return new Response(null,{status:403});
    return Response.json({ok:true,data:{status:'active',membership:{is_member:true}},expires_at:Date.now()+60000});
  }};
  const mf=new miniflare.Miniflare('convertV4MiniflareOptions' in miniflare?miniflare.convertV4MiniflareOptions(mfOptions):mfOptions);
  t.after(async()=>{await mf.dispose();await rm(root,{recursive:true,force:true});});
  const preflight=await mf.dispatchFetch('https://site.test/',{headers:{Accept:'text/html'}});
  assert.equal(preflight.status,401,await preflight.text());
  const report=await verifyProtection({root,fetchImpl:(url,init)=>mf.dispatchFetch(String(url),init)});
  assert.equal(report.ok,true,JSON.stringify(report.checks.filter(c=>!c.ok)));
  assert.equal(report.requestCount,16);
  const login=await mf.dispatchFetch('https://site.test/',{headers:{Accept:'text/html'}});
  assert.equal(login.status,401);assert.doesNotMatch(await login.text(),/PRIVATE-CONTENT/);
  const session=await mf.dispatchFetch('https://site.test/__nakwol/session',{method:'POST',headers:{Origin:'https://site.test','Content-Type':'application/json'},body:JSON.stringify({access_token:'fixture-member-token'})});
  assert.equal(session.status,204);
  const cookie=session.headers.get('Set-Cookie').split(';')[0];
  const granted=await mf.dispatchFetch('https://site.test/private.json',{headers:{Cookie:cookie}});
  assert.equal(granted.status,200);assert.equal(await granted.text(),'PRIVATE-CONTENT');
  const range=await mf.dispatchFetch('https://site.test/video.mp4',{headers:{Cookie:cookie,Range:'bytes=0-6'}});
  // Static Assets may return the full entity when Range is unsupported locally.
  assert.ok([200,206].includes(range.status));
  assert.equal(await range.text(),range.status===206?'PRIVATE':'PRIVATE-CONTENT');
  const logout=await mf.dispatchFetch('https://site.test/__nakwol/logout',{method:'POST',headers:{Cookie:cookie,Origin:'https://site.test'}});
  assert.equal(logout.status,204);assert.equal(revoked,true);
  assert.equal((await mf.dispatchFetch('https://site.test/private.json',{headers:{Cookie:cookie}})).status,401);
});
