import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createGate } from 'nakwol-connect/server';
import { installProtection, updateProtection, inspectProtection } from '../src/protection.mjs';
import { writeProjectConfig, readProjectConfig } from '../src/config.mjs';

for (const provider of ['cloudflare-workers','cloudflare-pages']) test(`${provider} common gate updates retain settings, build hooks and protect custom changes`, async t => {
  const root=await mkdtemp(join(tmpdir(),'nakwol-common-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'dist'));
  await writeFile(join(root,'index.html'),'<html><body>private</body></html>');
  await writeFile(join(root,'dist/index.html'),'private');
  await writeFile(join(root,'package.json'),JSON.stringify({private:true,scripts:{build:'vite build',postbuild:'node existing-task.mjs'}}));
  await writeProjectConfig(root,{clientId:'site',authMode:'required',redirectUris:['https://site.test/']});
  await installProtection({root,provider,assets:'dist',url:'https://site.test/'});
  const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  assert.equal(pkg.scripts.build,'vite build');
  assert.equal(pkg.scripts.postbuild,'npm run nakwol:gate && node existing-task.mjs');
  assert.equal(pkg.scripts['nakwol:gate'],'npx --yes nakwol-connect@~0.7.0 protect update');
  await writeFile(join(root,'package.json'),JSON.stringify({...pkg,scripts:{...pkg.scripts,'nakwol:gate':'npx --yes nakwol-connect@~0.6.3 protect update'}}));
  if(provider==='cloudflare-pages') {
    await rm(join(root,'dist/_worker.js'));
    await rm(join(root,'dist/_routes.json'));
  }
  const cli=fileURLToPath(new URL('../bin/nakwol-connect.mjs',import.meta.url));
  const result=JSON.parse(execFileSync(process.execPath,[cli,'protect','update','--root',root,'--json'],{encoding:'utf8'}));
  assert.equal(result.protection.runtimeVersion,'0.7.2');
  assert.equal(result.protection.provider,provider);
  assert.equal(result.protection.siteUrl,'https://site.test/');
  assert.equal((await inspectProtection(root,await readProjectConfig(root))).ok,true);
  assert.deepEqual(JSON.parse(await readFile(join(root,'package.json'),'utf8')),pkg);
  const gatePath=join(root,provider==='cloudflare-pages'?'dist/_worker.js':'.nakwol/server/gate.mjs');
  await writeFile(gatePath,'custom edits');
  await assert.rejects(updateProtection({root}), /덮어쓰지/);
  assert.equal(await readFile(gatePath,'utf8'),'custom edits');
});

test('public common gate API protects an arbitrary Request/Response host', async t => {
  const gate=createGate({clientId:'site',accessPolicy:'member',authOrigin:'https://auth.test',siteUrl:'https://site.test/'});
  let served=0,revoked=false;
  const host={sessionSecret:'test-secret-with-at-least-32-characters',serveAsset:async()=>{served++;return new Response('private');}};
  const original=globalThis.fetch, originalNow=Date.now;
  let now=originalNow(); Date.now=()=>now;
  t.after(()=>{globalThis.fetch=original;Date.now=originalNow;});
  globalThis.fetch=async()=>revoked?new Response(null,{status:401}):Response.json({ok:true,data:{id:'fixture-user',status:'active',membership:{is_member:true}},application_access:{client_id:'site',allowed:true,source:'policy'},expires_at:Date.now()+3600000});
  assert.equal((await gate(new Request('https://site.test/data.json'),host)).status,401);
  assert.equal(served,0);
  const session=await gate(new Request('https://site.test/__nakwol/session',{method:'POST',headers:{Origin:'https://site.test','Content-Type':'application/json'},body:JSON.stringify({access_token:'fixture'})}),host);
  assert.equal(session.status,204);
  const headers={Cookie:session.headers.get('Set-Cookie').split(';')[0]};
  assert.equal(await (await gate(new Request('https://site.test/data.json',{headers}),host)).text(),'private');
  revoked=true; now+=300001;
  assert.equal((await gate(new Request('https://site.test/data.json',{headers}),host)).status,401);
  assert.equal(served,1);
});
