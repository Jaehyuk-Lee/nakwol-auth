import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeProjectConfig,readProjectConfig} from '../src/config.mjs';
import {installProtection} from '../src/protection.mjs';
import {checkRelease} from '../src/release-check.mjs';
import {createGate} from '../src/server/gate.mjs';
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'release-check-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'dist'));await writeFile(join(root,'dist/index.html'),'private');await writeFile(join(root,'index.html'),'<body></body>');await writeFile(join(root,'package.json'),JSON.stringify({scripts:{build:'echo build'}}));
  await writeProjectConfig(root,{clientId:'site',redirectUris:['https://site.test/']});await installProtection({root,provider:'cloudflare-workers',assets:'dist',url:'https://site.test/'});
  const config=await readProjectConfig(root);config.protection.rollback={enabled:true,provider:'cloudflare-workers',accountId:'account',scriptName:'site',serializedDeployments:true};await writeProjectConfig(root,config);
  const gate=createGate({clientId:'site',siteUrl:'https://site.test/',authOrigin:'https://auth.test',accessPolicy:'member'});
  let active='old',leak=false,writes=0;
  const fetchImpl=async(url,init)=>{
    if(init.method==='POST'){writes++;active='recovery';leak=false;return Response.json({success:true,result:{id:active}});}
    const result=String(url).endsWith('/old')?{id:'old',created_on:'2026-09-01T00:00:00Z',versions:[{version_id:'old-version',percentage:100}]}:{deployments:[{id:active,created_on:active==='old'?'2026-09-01T00:00:00Z':'2026-09-02T00:00:00Z'}]};
    return Response.json({success:true,result});
  };
  const verificationFetchImpl=(url,init)=>leak?Promise.resolve(new Response('private leaked')):gate(new Request(url,init),{sessionSecret:'test-only-session-secret-32-characters',serveAsset:()=>{throw Error('leak');}});
  return {root,config,fetchImpl,verificationFetchImpl,setCurrent(id,exposed){active=id;leak=exposed;},writes:()=>writes};
}
test('release check captures baseline then automatically restores an exposed deployment without accepting failed release',async t=>{
  const f=await fixture(t);const outputFile=join(f.root,'release.json');
  const baseline=await checkRelease({...f,apiToken:'test',deploymentId:'old',outputFile,baseline:true});assert.equal(baseline.ok,true);assert.equal(baseline.deploymentId,'old');
  f.config.protection.rollback.previousVerified={deploymentId:'old',runtimeVersion:'0.7.2',report:baseline};await writeProjectConfig(f.root,f.config);
  f.setCurrent('failed',true);
  const result=await checkRelease({...f,apiToken:'test',deploymentId:'failed',outputFile});
  assert.equal(result.ok,false);assert.equal(result.releaseAccepted,false);assert.equal(result.status,'recovery-verified');assert.equal(f.writes(),1);
  const saved=JSON.parse(await readFile(outputFile));assert.equal(saved.failedVerification.deploymentId,'failed');assert.equal(saved.recoveryVerification.ok,true);
});
test('release check refuses stale provider IDs before asset probing',async t=>{
  const f=await fixture(t);await assert.rejects(checkRelease({...f,apiToken:'test',deploymentId:'new',outputFile:join(f.root,'report.json')}),/no longer serving/);assert.equal(f.writes(),0);
});
