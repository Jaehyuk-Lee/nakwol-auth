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
