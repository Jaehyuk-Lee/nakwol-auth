import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyProtection } from '../src/protection-verify.mjs';

test('custom gate verification needs explicit paths and checks every request variant without local config', async () => {
  await assert.rejects(verifyProtection({provider:'custom',url:'https://site.test/'}), /--paths/);
  const seen=[];
  const options={provider:'custom',url:'https://site.test/',paths:'/data.json,/private.png',fetchImpl:async(url,init)=>{
    seen.push([url.pathname,init.method,init.headers]);
    return new Response(null,{status:401,headers:{'X-Nakwol-Gate':'v1','Cache-Control':'private, no-store'}});
  }};
  const result=await verifyProtection(options);
  assert.equal(result.ok,true);
  assert.equal(result.inspectionScope,'explicit-paths');
  assert.equal(result.requestCount,12);
  assert.equal(seen.filter(v=>v[1]==='HEAD').length,3);
  assert.equal(seen.filter(v=>v[2].Range).length,3);
  const leaked=await verifyProtection({...options,fetchImpl:async()=>new Response('PRIVATE',{headers:{'X-Nakwol-Gate':'v1','Cache-Control':'no-store'}})});
  assert.equal(leaked.ok,false);
  await assert.rejects(verifyProtection({...options,paths:'//other.test/data'}), /同|동일/);
});
