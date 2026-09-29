import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { summarizeGateReport, reportProtection } from '../src/gate-reporting.mjs';
import { writeProjectConfig } from '../src/config.mjs';
import { automateProtection } from '../src/managed-updates.mjs';
import { installProtection } from '../src/protection.mjs';
const config={clientId:'site',redirectUris:['https://site.test/'],authOrigin:'https://auth.test',protection:{siteUrl:'https://site.test/',runtimeVersion:'0.7.1'}};
const report={ok:true,inspectionScope:'installed-assets',origins:['https://site.test/'],expectedRuntime:'0.7.1',observedRuntimeVersions:['0.7.1'],requestCount:4,checks:Array.from({length:4},()=>({ok:true,detail:'HTTP 401;'}))};
const options={commit:'a'.repeat(40)};
test('summaries distinguish version evidence, outages, exposure and incomplete probes',()=>{
  assert.equal(summarizeGateReport(report,config,options).status,'verified');
  assert.equal(summarizeGateReport({...report,observedRuntimeVersions:['unknown']},config,options).status,'indeterminate');
  assert.equal(summarizeGateReport({...report,requestCount:5},config,options).status,'indeterminate');
  for(const [detail,status] of [['HTTP 200; gate=missing','failed'],['HTTP 503; gate=missing','indeterminate'],['network failed','indeterminate']]){
    assert.equal(summarizeGateReport({...report,ok:false,checks:report.checks.map((c,i)=>i?c:{ok:false,detail})},config,options).status,status);
  }
  assert.throws(()=>summarizeGateReport({...report,origins:['https://other.test/']},config,options));
});
test('report transmission is origin-bound and excludes raw request details',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gate-report-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeProjectConfig(root,config);const path=join(root,'report.json');await writeFile(path,JSON.stringify(report));
  let calls=0;
  const fetchImpl=async(url,init)=>{calls++;assert.equal(url,'https://auth.test/connect/gate-reports/site');assert.equal(init.redirect,'error');const body=JSON.parse(init.body);assert.equal(body.status,'verified');assert.equal(body.service_url,'https://site.test');assert.equal(body.checks,undefined);return Response.json({ok:true});};
  await assert.rejects(reportProtection({...options,root,report:path,reportToken:'secret',reportAuthOrigin:'https://wrong.test',fetchImpl}));assert.equal(calls,0);
  const result=await reportProtection({...options,root,report:path,reportToken:'secret',reportAuthOrigin:'https://auth.test',fetchImpl});assert.equal(result.status,'reported');assert.equal(calls,1);
});
test('CI reporting is opt-in, environment-bound and requires trusted ancestry before secrets',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gate-report-ci-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'dist'));
  await writeFile(join(root,'dist/index.html'),'protected');await writeFile(join(root,'index.html'),'<html><body>site</body></html>');await writeFile(join(root,'package.json'),JSON.stringify({scripts:{build:'echo build'}}));
  await writeProjectConfig(root,{...config,protection:undefined});await installProtection({root,provider:'cloudflare-workers',assets:'dist',url:'https://site.test/'});
  await automateProtection({root,reports:true});const deployed=await readFile(join(root,'.github/workflows/nakwol-gate-deployed.yml'),'utf8');const pr=await readFile(join(root,'.github/workflows/nakwol-gate-check.yml'),'utf8');
  assert.ok(deployed.includes('environment: production'));assert.ok(deployed.includes("steps.trusted.outcome == 'success'"));assert.ok(deployed.includes('git merge-base --is-ancestor HEAD FETCH_HEAD'));assert.ok(deployed.includes('${{ secrets.NAKWOL_GATE_REPORT_TOKEN }}'));assert.ok(!pr.includes('secrets.'));
});
