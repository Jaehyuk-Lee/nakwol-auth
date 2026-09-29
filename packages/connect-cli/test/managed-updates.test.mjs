import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { automateProtection, protectionStatus } from '../src/managed-updates.mjs';
import { installProtection, updateProtection } from '../src/protection.mjs';
import { readProjectConfig, writeProjectConfig } from '../src/config.mjs';
import { verifyProtection } from '../src/protection-verify.mjs';
import { RUNTIME_VERSION, createGate } from '../src/server/gate.mjs';
async function fixture(t, provider='cloudflare-workers') {
  const root=await mkdtemp(join(tmpdir(),'nakwol-managed-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'dist'));
  await writeFile(join(root,'index.html'),'<html><body>private</body></html>');
  await writeFile(join(root,'dist/index.html'),'private');
  await writeFile(join(root,'package.json'),JSON.stringify({private:true,scripts:{build:'echo build'}}));
  await writeProjectConfig(root,{clientId:'site',authMode:'required',redirectUris:['https://site.test/']});
  await installProtection({root,provider,assets:'dist',url:'https://site.test/'});
  return root;
}
for(const provider of ['cloudflare-workers','cloudflare-pages']) test(`${provider}: managed update preserves local hooks and deployment distinction`,async t=>{
  const root=await fixture(t,provider);
  const result=await automateProtection({root});
  assert.equal(result.status,'configured-not-deployed');
  const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  assert.equal(pkg.devDependencies['nakwol-connect'],RUNTIME_VERSION);
  assert.equal(pkg.scripts['nakwol:gate'],'nakwol-connect protect update');
  assert.equal(pkg.scripts.build,'echo build');
  if(provider==='cloudflare-pages') await rm(join(root,'dist/_worker.js'));
  await updateProtection({root});
  assert.equal((await readProjectConfig(root)).protection.updateChannel,'managed');
  assert.equal(JSON.parse(await readFile(join(root,'package.json'),'utf8')).scripts['nakwol:gate'],'nakwol-connect protect update');
  const offline=await protectionStatus({root,offline:true,fetchImpl:()=>{throw new Error('unexpected network');}});
  assert.equal(offline.deployed.status,'not-checked');
  const gate=createGate({clientId:'site',siteUrl:'https://site.test/',authOrigin:'https://auth.test',accessPolicy:'member'});
  const fetchImpl=(url,options)=>gate(new Request(url,options),{sessionSecret:'test-secret-with-at-least-32-characters',serveAsset:()=>{throw new Error('private asset leaked');}});
  const live=await protectionStatus({root,fetchImpl});
  assert.equal(live.deployed.status,'version-match');
  const verified=await verifyProtection({root,fetchImpl,expectRuntime:'installed'});
  assert.equal(verified.ok,true);
  assert.deepEqual(verified.observedRuntimeVersions,[RUNTIME_VERSION]);
  const stale=await verifyProtection({root,fetchImpl,expectRuntime:'0.6.3'});
  assert.equal(stale.ok,false);
});
test('existing automation causes refusal before any configuration changes',async t=>{
  const root=await fixture(t);await mkdir(join(root,'.github'));
  await writeFile(join(root,'.github/dependabot.yml'),'owned');
  const before=await readFile(join(root,'package.json'),'utf8');
  await assert.rejects(automateProtection({root}),/Existing automation/);
  assert.equal(await readFile(join(root,'package.json'),'utf8'),before);
  assert.equal(await readFile(join(root,'.github/dependabot.yml'),'utf8'),'owned');
});
test('managed builds reject dependency drift',async t=>{
  const root=await fixture(t);await automateProtection({root});
  const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));pkg.devDependencies['nakwol-connect']='^0.7.1';
  await writeFile(join(root,'package.json'),JSON.stringify(pkg));
  await assert.rejects(updateProtection({root}),/exact installed/);
});
test('old deployed gate remains version-unknown and failed status',async t=>{
  const root=await fixture(t);
  const state=await protectionStatus({root,fetchImpl:async()=>new Response(null,{status:401,headers:{'X-Nakwol-Gate':'v1','Cache-Control':'no-store'}})});
  assert.equal(state.ok,false);assert.equal(state.deployed.status,'version-unknown');
});
test('managed builds do not silently revert to registry hooks',async t=>{
  const root=await fixture(t);await automateProtection({root});
  const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));pkg.scripts['nakwol:gate']='npx --yes nakwol-connect@latest protect update';
  await writeFile(join(root,'package.json'),JSON.stringify(pkg));
  await assert.rejects(updateProtection({root}),/refusing network-based fallback/);
});
test('runtime version matches the published package contract',async()=>{
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(RUNTIME_VERSION,pkg.version);
});
