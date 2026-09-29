// Controlled workerd benchmark; timings are request completion, not browser paint.
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createServer } from 'node:http';
import * as miniflare from 'miniflare';
import { build } from 'esbuild';
import { writeProjectConfig } from '../src/config.mjs';
import { verifyProtection } from '../src/protection-verify.mjs';

const output = resolve(process.argv[2] || 'docs/benchmarks/authorization-lease.json');
const delayMs = Number(process.argv[3] || 100);
const root = await mkdtemp(join(tmpdir(), 'nakwol-lease-benchmark-'));
const files = [
  ...Array.from({ length: 4 }, (_, i) => [`/app-${i}.js`, 'window.benchmarkLoaded=true;']),
  ...Array.from({ length: 3 }, (_, i) => [`/style-${i}.css`, 'body{background:#fff}']),
  ...Array.from({ length: 4 }, (_, i) => [`/data-${i}.json`, JSON.stringify({ fixture: true, index: i })]),
  ...Array.from({ length: 300 }, (_, i) => [`/image-${i}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="rgb(${i % 255},40,80)"/></svg>`]),
];
let mf;
try {
  await mkdir(join(root, 'dist'));
  const browserScript=process.env.BENCH_BROWSER_PORT ? `<script>const jsonReady=Promise.all([0,1,2,3].map(i=>fetch('/data-'+i+'.json').then(r=>r.json())));window.addEventListener('load',async()=>{await jsonReady;setTimeout(async()=>{const navigation=performance.getEntriesByType('navigation')[0].toJSON();const resources=performance.getEntriesByType('resource').map(r=>r.toJSON());const report=await fetch('/bench/report',{method:'POST',body:JSON.stringify({navigation,resources})}).then(r=>r.json());const pre=document.createElement('pre');pre.id='benchmark-result';pre.textContent=JSON.stringify(report,null,2);document.body.prepend(pre);},0);});</script>` : '';
  const html = `<!doctype html><html><head><script>performance.setResourceTimingBufferSize(1000)</script>${files.filter(([p])=>p.endsWith('.css')).map(([p])=>`<link rel="stylesheet" href="${p}">`).join('')}</head><body>${files.filter(([p])=>p.endsWith('.svg')).map(([p])=>`<img src="${p}" width="64" height="64">`).join('')}${files.filter(([p])=>p.endsWith('.js')).map(([p])=>`<script src="${p}"></script>`).join('')}${browserScript}</body></html>`;
  await writeFile(join(root, 'index.html'), html);
  await writeFile(join(root, 'dist/index.html'), html);
  await Promise.all(files.map(([path, body])=>writeFile(join(root, 'dist', path.slice(1)), body)));
  await writeProjectConfig(root, { clientId:'benchmark-site', framework:'html', redirectUris:['https://site.test/'], integration:'universal-embed', authMode:'required', accessPolicy:'member' });
  const cli=fileURLToPath(new URL('../bin/nakwol-connect.mjs',import.meta.url));
  execFileSync(process.execPath,[cli,'protect','install','--root',root,'--provider','cloudflare-workers','--assets','dist','--url','https://site.test/','--json']);
  const wrangler=JSON.parse(await readFile(join(root,'wrangler.nakwol.json'),'utf8'));
  const canonical=process.env.BENCH_GATE_REF ? execFileSync('git',['show',`${process.env.BENCH_GATE_REF}:packages/connect-cli/src/server/gate.mjs`],{encoding:'utf8'}) : await readFile(join(root,'.nakwol/server/gate.mjs'),'utf8');
  await writeFile(join(root,'.nakwol/server/gate.mjs'),canonical);
  const originalEntry=await readFile(join(root,wrangler.main),'utf8');
  // Instrument only the generated fixture adapter. Canonical gate stays byte-for-byte unchanged.
  const instrumented=`const benchmarkDateNow=Date.now.bind(Date);let benchmarkOffset=0;Date.now=()=>benchmarkDateNow()+benchmarkOffset;\n`+originalEntry.replace('return serveProtected(request, env, settings);', `if(new URL(request.url).pathname==='/__bench/advance'){benchmarkOffset+=300001;return new Response(null,{status:204});}const start=performance.now();let authMs=null;const assets=env.ASSETS;return serveProtected(request,{...env,ASSETS:{async fetch(r){authMs=performance.now()-start;return assets.fetch(r);}}},settings).then(result=>{const headers=new Headers(result.headers);if(authMs!==null)headers.set('X-Benchmark-Auth-Ms',String(authMs));return new Response(result.body,{status:result.status,headers});});`);
  await writeFile(join(root,wrangler.main),instrumented);
  const bundle=await build({entryPoints:[join(root,wrangler.main)],bundle:true,format:'esm',write:false});
  let checks=0, centralWallMs=0;
  const options={compatibilityDate:wrangler.compatibility_date,modules:true,script:bundle.outputFiles[0].text,bindings:{NAKWOL_SESSION_SECRET:'benchmark-secret-only-never-production-123456789'},assets:{...wrangler.assets,directory:join(root,'dist'),routerConfig:{has_user_worker:true}},outboundService:async request=>{
    if(new URL(request.url).pathname!=='/me')return new Response(null,{status:404});
    checks++;const start=performance.now();await new Promise(r=>setTimeout(r,delayMs));centralWallMs+=performance.now()-start;
    return Response.json({ok:true,data:{id:'benchmark-user',status:'active',membership:{is_member:true,checked_at:Date.now()}},expires_at:Date.now()+3600000,application_access:{client_id:'benchmark-site',allowed:true,source:'policy'}});
  }};
  mf=new miniflare.Miniflare('convertV4MiniflareOptions' in miniflare?miniflare.convertV4MiniflareOptions(options):options);
  await mf.ready;
  const session=await mf.dispatchFetch('https://site.test/__nakwol/session',{method:'POST',headers:{Origin:'https://site.test','Content-Type':'application/json'},body:JSON.stringify({access_token:'benchmark-member-token'})});
  if(session.status!==204)throw new Error(`Session failed ${session.status} ${await session.text()}`);
  let cookie=session.headers.get('Set-Cookie').split(';')[0];
  if(process.env.BENCH_BROWSER_PORT){
    let runChecks=checks, runCentralWall=centralWallMs, runName='first-page';const observed=[];
    const server=createServer(async(req,res)=>{try{
      const path=req.url;
      if(path==='/bench/start'||path==='/bench/reload'){runChecks=checks;runCentralWall=centralWallMs;observed.length=0;runName=path.endsWith('reload')?'reload':'first-page';res.writeHead(302,{Location:'/',...(path.endsWith('start')?{'Set-Cookie':`${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax`}:{})});res.end();return;}
      if(path==='/bench/report'){
        let body='';for await(const chunk of req)body+=chunk;
        const browser=JSON.parse(body),images=browser.resources.filter(r=>r.name.includes('/image-'));const mean=v=>v.reduce((a,b)=>a+b,0)/v.length;
        if(images.length!==300)throw new Error(`Expected 300 image timing entries, got ${images.length}`);
        const report={name:runName,meCalls:checks-runChecks,centralWaitSumMs:centralWallMs-runCentralWall,requestCount:observed.length,imageTimingCount:images.length,htmlTtfbMs:browser.navigation.responseStart-browser.navigation.requestStart,imageTtfbMeanMs:mean(images.map(r=>r.responseStart-r.requestStart)),imageBatchMs:Math.max(...images.map(r=>r.responseEnd))-Math.min(...images.map(r=>r.startTime)),loadEventMs:browser.navigation.loadEventEnd,workerAuthWallMeanMs:mean(observed.map(r=>r.authWallMs)),responses304:observed.filter(r=>r.status===304).length,gateSha256:createHash('sha256').update(canonical).digest('hex'),authDelayMs:delayMs,measurement:'Chrome via HTTP localhost adapter to generated gate in workerd; local six-connection HTTP transport; controlled AUTH fixture'};
        await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output.replace('.json',`-${runName}.json`),JSON.stringify({report,browser,observed},null,2)+'\n');res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(report));return;
      }
      const headers=new Headers();for(const [key,value]of Object.entries(req.headers))if(value&&key!=='host')headers.set(key,Array.isArray(value)?value.join(','):value);
      const start=performance.now(),response=await mf.dispatchFetch('https://site.test'+path,{method:req.method,headers});
      observed.push({path,status:response.status,ttfbMs:performance.now()-start,authWallMs:Number(response.headers.get('X-Benchmark-Auth-Ms'))});
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    }catch(error){res.writeHead(500);res.end(String(error));}});
    await new Promise(resolve=>server.listen(Number(process.env.BENCH_BROWSER_PORT),'127.0.0.1',resolve));
    console.log(`Browser fixture ready http://localhost:${process.env.BENCH_BROWSER_PORT}/bench/start`);
    await new Promise(resolve=>{process.once('SIGTERM',resolve);process.once('SIGINT',resolve);});await new Promise(resolve=>server.close(resolve));
    process.exitCode=0;
  } else {
  const etags=new Map();
  async function request(path,revisit=false){
    const headers={Cookie:cookie};if(revisit&&etags.has(path))headers['If-None-Match']=etags.get(path);
    const start=performance.now();const response=await mf.dispatchFetch('https://site.test'+path,{headers});const ttfb=performance.now()-start;
    const bytes=(await response.arrayBuffer()).byteLength;
    if(![200,304].includes(response.status))throw new Error(`${path}: ${response.status}`);
    if(response.headers.has('Set-Cookie'))cookie=response.headers.get('Set-Cookie').split(';')[0];
    if(response.headers.has('ETag'))etags.set(path,response.headers.get('ETag'));
    return {path,status:response.status,startedMs:start,endedMs:performance.now(),ttfbMs:ttfb,totalMs:performance.now()-start,authWallMs:Number(response.headers.get('X-Benchmark-Auth-Ms')),bytes,cacheControl:response.headers.get('Cache-Control')};
  }
  async function run(name,revisit,concurrency,onlyImages=false){
    const before=checks,wallBefore=centralWallMs,start=performance.now(),requests=[];
    if(!onlyImages)requests.push(await request('/',revisit));
    const queue=files.filter(([p])=>!onlyImages||p.endsWith('.svg')).map(([p])=>p);let index=0;const imagesStart=performance.now();
    await Promise.all(Array.from({length:concurrency},async()=>{while(index<queue.length){const path=queue[index++];requests.push(await request(path,revisit));}}));
    const totalMs=performance.now()-start,images= requests.filter(r=>r.path.endsWith('.svg'));
    const mean=values=>values.reduce((a,b)=>a+b,0)/values.length;
    return {name,requestCount:requests.length,meCalls:checks-before,centralRoundTrips:checks-before,centralWaitSumMs:centralWallMs-wallBefore,totalLoadMs:totalMs,resourceBatchMs:performance.now()-imagesStart,imageBatchMs:Math.max(...images.map(r=>r.endedMs))-Math.min(...images.map(r=>r.startedMs)),htmlTtfbMs:requests.find(r=>r.path==='/')?.ttfbMs??null,imageTtfbMeanMs:mean(images.map(r=>r.ttfbMs)),imageTtfbP95Ms:images.map(r=>r.ttfbMs).sort((a,b)=>a-b)[Math.floor(images.length*.95)],workerAuthWallMeanMs:mean(requests.map(r=>r.authWallMs)),responses304:requests.filter(r=>r.status===304).length,bytes:requests.reduce((n,r)=>n+r.bytes,0),requests};
  }
  const runs=[];
  runs.push(await run('first-page',false,6));
  runs.push(await run('reload-conditional',true,6));
  runs.push(await run('300-concurrent-images',true,300,true));
  if(process.env.BENCH_EXPIRED){
    await mf.dispatchFetch('https://site.test/__bench/advance');
    runs.push(await run('expired-lease-300-concurrent-images',true,300,true));
  }
  // Integrity checks use pristine generated adapter; measurement instrumentation is not production code.
  await writeFile(join(root,wrangler.main),originalEntry);
  // Restore the installed source for CLI integrity metadata when replaying a historical gate.
  if(process.env.BENCH_GATE_REF)await writeFile(join(root,'.nakwol/server/gate.mjs'),await readFile(new URL('../src/server/gate.mjs',import.meta.url)));
  const protection=await verifyProtection({root,fetchImpl:(url,init)=>mf.dispatchFetch(String(url),init)});
  const result={at:new Date().toISOString(),sourceCommit:process.env.BENCH_GATE_REF || execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),gateSha256:createHash('sha256').update(canonical).digest('hex'),fixture:{runtime:'real generated Cloudflare Workers Static Assets gate in Miniflare/workerd',auth:'controlled member /me fixture, not production AUTH',authDelayMs:delayMs,images:300,js:4,css:3,json:4,html:1,concurrency:6,measurement:'Node dispatchFetch request driver; no browser paint, HTTP transport or production CDN timing; worker auth wall clock is not CPU time'},sessionCreationMeCalls:1,runs,protectVerify:{ok:protection.ok,requestCount:protection.requestCount,failed:protection.checks.filter(c=>!c.ok)}};
  await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({...result,runs:runs.map(({requests,...run})=>run)},null,2));
  }
} finally {if(mf)await mf.dispose();await rm(root,{recursive:true,force:true});}
