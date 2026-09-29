import test from 'node:test';
import assert from 'node:assert/strict';
import { loginPage } from '../src/server/login.mjs';

for (const path of ['/?deck=123#detail', '/build/100?user=1#unit']) {
  test(`login preserves original URL ${path} across OAuth callback`, async () => {
    const storage = new Map();
    const sessionStorage = { getItem: k => storage.get(k) || null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) };
    const elements = Object.fromEntries(['status','login','retry','recovery','auth-panel'].map(k => [k, {}]));
    let authenticated = false, target;
    const sdk = { NakwolAuthClient: class { async bootstrap() { return authenticated ? {} : null; } getAccessToken() { return 'test'; } } };
    const source = loginPage({ clientId: 'site', authOrigin: 'https://auth.test', siteUrl: 'https://site.test/' }, 401).split('<script type="module">')[1].split('</script>')[0].replace("await import(settings.authOrigin+'/sdk/v0.3.1/nakwol-auth-web.js')", 'sdk');
    const run = new (Object.getPrototypeOf(async function(){}).constructor)('sdk','location','document','sessionStorage','fetch',source);
    async function visit(path) {
      const url = new URL(path, 'https://site.test');
      await run(sdk, { origin:url.origin, pathname:url.pathname, search:url.search, hash:url.hash, replace:p=>{target=p;} }, {getElementById:k=>elements[k]}, sessionStorage, async()=>new Response(null,{status:204}));
    }
    await visit(path);
    authenticated = true;
    await visit('/?code=oauth-code&state=oauth-state');
    assert.equal(target, path);
  });
}

for (const status of [401,403]) test(`server session denial ${status} clears credentials and allows manual retry`, async () => {
  const source=loginPage({clientId:'site',authOrigin:'https://auth.test',siteUrl:'https://site.test/'},401).split('<script type="module">')[1].split('</script>')[0].replace("await import(settings.authOrigin+'/sdk/v0.3.1/nakwol-auth-web.js')",'sdk');
  const run=new (Object.getPrototypeOf(async function(){}).constructor)('sdk','location','document','sessionStorage','fetch',source);
  let cleared=0,denied=0,retried=0;
  const elements=Object.fromEntries(['status','login','retry','recovery','auth-panel'].map(k=>[k,{}]));
  const sdk={NakwolAuthClient:class{
    async bootstrap(){return {};}
    getAccessToken(){return 'fixture';}
    clearDeniedLogin(error){assert.equal(error.code,'access_denied');denied++;}
    clearLocalState(){cleared++;}
    async login(){retried++;}
  }};
  await run(sdk,{origin:'https://site.test',pathname:'/',search:'',hash:'',replace(){throw new Error('must not redirect');}},{getElementById:k=>elements[k]},{getItem(){return null;},setItem(){},removeItem(){}},async()=>new Response(null,{status}));
  assert.equal(denied,1);
  assert.equal(elements.login.disabled,false);
  elements.login.onclick();
  assert.equal(cleared,1);
  assert.equal(retried,1);
});

for (const outcome of ['success','anonymous','denied','outage']) test(`quiet bridge stays hidden until ${outcome} is resolved`, async () => {
  let resolveUser;
  const pending=new Promise(resolve=>{resolveUser=resolve;});
  const elements=Object.fromEntries(['status','login','retry','recovery','auth-panel'].map(k=>[k,{hidden:true}]));
  let target=null,exchanges=0;
  const sdk={NakwolAuthClient:class{async bootstrap(){return pending;}getAccessToken(){return 'fixture';}clearDeniedLogin(){}}};
  const source=loginPage({clientId:'quiet',authOrigin:'https://auth.test',siteUrl:'https://site.test/'},401).split('<script type="module">')[1].split('</script>')[0].replace("await import(settings.authOrigin+'/sdk/v0.3.1/nakwol-auth-web.js')",'sdk');
  const run=new (Object.getPrototypeOf(async function(){}).constructor)('sdk','location','document','sessionStorage','fetch','setTimeout','clearTimeout',source);
  let timeout;
  const task=run(sdk,{origin:'https://site.test',pathname:'/',search:'',hash:'',replace:p=>{target=p;}},{getElementById:k=>elements[k]},{getItem(){return null;},setItem(){},removeItem(){}},async()=>{exchanges++;return new Response(null,{status:outcome==='denied'?403:outcome==='outage'?503:204});},callback=>{timeout=callback;return 1;},()=>{});
  assert.equal(elements['auth-panel'].hidden,true);
  assert.equal(exchanges,0);
  assert.equal(typeof timeout,'function');
  resolveUser(outcome==='anonymous'?null:{id:'member'});
  await task;
  assert.equal(elements['auth-panel'].hidden,outcome==='success');
  assert.equal(target,outcome==='success'?'/':null);
  assert.equal(exchanges,outcome==='anonymous'?0:1);
});

test('quiet bridge stalled SDK exposes recovery after bounded wait', async()=>{
  let resolveSdk,timeout;
  const sdkPending=new Promise(resolve=>{resolveSdk=resolve;});
  const elements=Object.fromEntries(['status','login','retry','recovery','auth-panel'].map(k=>[k,{hidden:true}]));
  const source=loginPage({clientId:'quiet',authOrigin:'https://auth.test',siteUrl:'https://site.test/'},401).split('<script type="module">')[1].split('</script>')[0].replace("await import(settings.authOrigin+'/sdk/v0.3.1/nakwol-auth-web.js')",'await sdkPending');
  const run=new (Object.getPrototypeOf(async function(){}).constructor)('sdkPending','location','document','sessionStorage','setTimeout','clearTimeout',source);
  const task=run(sdkPending,{origin:'https://site.test',pathname:'/',search:'',hash:''},{getElementById:k=>elements[k]},{getItem(){return null;},setItem(){}},(callback,ms)=>{assert.equal(ms,15000);timeout=callback;return 1;},()=>{});
  assert.equal(elements['auth-panel'].hidden,true);
  timeout();
  assert.equal(elements['auth-panel'].hidden,false);
  assert.equal(elements.retry.hidden,false);
  assert.equal(elements.recovery.hidden,false);
  resolveSdk({NakwolAuthClient:class{async bootstrap(){return null;}}});
  await task;
});
