import test from 'node:test';
import assert from 'node:assert/strict';
import { loginPage } from '../src/server/login.mjs';

for (const path of ['/?deck=123#detail', '/build/100?user=1#unit']) {
  test(`login preserves original URL ${path} across OAuth callback`, async () => {
    const storage = new Map();
    const sessionStorage = { getItem: k => storage.get(k) || null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) };
    const elements = Object.fromEntries(['status','login','retry','recovery'].map(k => [k, {}]));
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
  const elements=Object.fromEntries(['status','login','retry','recovery'].map(k=>[k,{}]));
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

for (const outcome of ['authenticated', 'anonymous', 'error']) test(`login controls wait for automatic SSO: ${outcome}`, async () => {
  const html = loginPage({clientId:'site',authOrigin:'https://auth.test',siteUrl:'https://site.test/'},401);
  const elements = Object.fromEntries(['status','login','retry','recovery'].map(id => [id, {hidden: new RegExp(`<[^>]+id="${id}"[^>]* hidden`).test(html)}]));
  const source = html.split('<script type="module">')[1].split('</script>')[0].replace("await import(settings.authOrigin+'/sdk/v0.3.1/nakwol-auth-web.js')",'sdk');
  let resolveUser, rejectUser;
  const pending = new Promise((resolve,reject) => {resolveUser=resolve;rejectUser=reject;});
  const sdk = {NakwolAuthClient:class {bootstrap(){return pending;} getAccessToken(){return 'fixture';}}};
  const run = new (Object.getPrototypeOf(async function(){}).constructor)('sdk','location','document','sessionStorage','fetch',source);
  let target;
  const completed = run(sdk,{origin:'https://site.test',pathname:'/',search:'',hash:'',replace:p=>{target=p;}},{getElementById:id=>elements[id]},{getItem(){return null;},setItem(){},removeItem(){}},async()=>new Response(null,{status:204}));
  assert.equal(elements.login.hidden,true);
  assert.equal(elements.retry.hidden,true);
  if(outcome==='error') rejectUser(new Error('fixture failure'));
  else resolveUser(outcome==='authenticated'?{}:null);
  await completed;
  assert.equal(elements.login.hidden,outcome==='authenticated');
  assert.equal(target,outcome==='authenticated'?'/':undefined);
  if(outcome==='error') assert.equal(elements.retry.hidden,false);
});
