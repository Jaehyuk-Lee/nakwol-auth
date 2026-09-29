import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:https';
import assert from 'node:assert/strict';
const run=promisify(execFile);
if(!process.env.npm_execpath)throw Error('Run npm run test:managed.');
const root=await mkdtemp(join(tmpdir(),'nakwol-managed-e2e-'));
let server;
try {
  const pkg=resolve('packages/connect-cli');
  const packed=JSON.parse((await run(process.execPath,[process.env.npm_execpath,'pack',pkg,'--pack-destination',root,'--json'])).stdout);
  const tarball=join(root,packed[0].filename);
  await writeFile(join(root,'package.json'),JSON.stringify({name:'managed-smoke',private:true,type:'module',scripts:{build:'node build.mjs'}}));
  await writeFile(join(root,'index.html'),'<html><body>protected</body></html>');
  await writeFile(join(root,'build.mjs'),"import {mkdir,writeFile} from 'node:fs/promises';await mkdir('dist',{recursive:true});for(const name of ['index.html','data.json','image.webp','style.css','font.woff2'])await writeFile('dist/'+name,'private');");
  await run(process.execPath,[process.env.npm_execpath,'install','--save-dev','--ignore-scripts',tarball],{cwd:root});
  const cli=join(root,'node_modules/nakwol-connect/bin/nakwol-connect.mjs');
  const {createGate}=await import(pathToFileURL(join(root,'node_modules/nakwol-connect/src/server/gate.mjs')));
  const cert=join(root,'cert.pem'),key=join(root,'key.pem');
  await run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost']);
  let gate;
  server=createServer({key:await readFile(key),cert:await readFile(cert)},async(req,res)=>{
    const response=await gate(new Request(`https://localhost:${server.address().port}${req.url}`,{method:req.method,headers:req.headers}),{sessionSecret:'test-only-32-characters-long-secret',serveAsset:()=>{throw Error('Anonymous asset leak');}});
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`https://localhost:${server.address().port}/`;
  gate=createGate({clientId:'smoke',siteUrl:url,authOrigin:'https://auth.test',accessPolicy:'member'});
  await writeFile(join(root,'.nakwol-connect.json'),JSON.stringify({version:2,clientId:'smoke',authOrigin:'https://auth.test',redirectUris:[url]}));
  const env={...process.env,NODE_EXTRA_CA_CERTS:cert};
  const command=async(...args)=>JSON.parse((await run(process.execPath,[cli,...args,'--json'],{cwd:root,env})).stdout);
  await run(process.execPath,[process.env.npm_execpath,'run','build'],{cwd:root});
  await command('protect','install','--provider','cloudflare-workers','--assets','dist','--url',url);
  await command('protect','automate','--reports');
  // This release candidate is not in npm yet. Preserve the local tarball resolution in this isolated lockfile.
  const packageJson=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  const lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));lock.packages[''].devDependencies=packageJson.devDependencies;
  await writeFile(join(root,'package-lock.json'),JSON.stringify(lock));
  await run(process.execPath,[process.env.npm_execpath,'ci','--ignore-scripts'],{cwd:root});
  await run(process.execPath,[process.env.npm_execpath,'run','build'],{cwd:root});
  await run(process.execPath,[process.env.npm_execpath,'run','nakwol:gate'],{cwd:root});
  const status=await command('protect','status');assert.equal(status.deployed.status,'version-match');
  const verified=await command('protect','verify','--expect-runtime','installed');assert.equal(verified.ok,true);assert.ok(verified.requestCount>=20);
  console.log(JSON.stringify({ok:true,packagedVersion:status.installedPackageVersion,requestCount:verified.requestCount,flow:'pack/install/automate/npm-ci/build/update/live-HTTPS-status/verify'}));
} finally {if(server)await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
