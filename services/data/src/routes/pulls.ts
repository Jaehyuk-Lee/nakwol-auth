import { normalizePullEditOp, normalizePullEvent, PULL_BATCH_LIMIT } from '../pulls-domain.ts';
import { createPullEvents, editPullEvents, listPullChanges, listPullEvents, type PullWriteResult } from '../pulls-store.ts';
import { DataAccessError, runAuthedHandler } from '../http.ts';
import type { DataEnv } from '../types.ts';

type Fetcher=(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;
const fail=(status:number,code:string,message:string)=>Response.json({ok:false,error:{code,message}},{status});

async function parseBatch(request:Request,key:'events'|'ops'):Promise<unknown[]|Response> {
  let body:any;
  try { body=await request.json(); } catch { return fail(400,'INVALID_JSON','JSON object body가 필요합니다.'); }
  const items=body?.[key];
  if(!Array.isArray(items)||items.length<1||items.length>PULL_BATCH_LIMIT) return fail(400,'INVALID_PULL_BATCH',`${key}는 1~${PULL_BATCH_LIMIT}개여야 합니다.`);
  return items;
}

function intParam(url:URL,name:string,fallback:number,min:number,max:number):number|null {
  const raw=url.searchParams.get(name);
  if(raw===null) return fallback;
  const value=Number(raw);
  return Number.isSafeInteger(value)&&value>=min&&value<=max?value:null;
}

function writeResponse(result:PullWriteResult):Response {
  switch(result.kind){
    case 'ok': return Response.json({ok:true,data:{applied:result.applied,duplicate:result.duplicate}});
    case 'account_not_found': throw new DataAccessError('GAME_ACCOUNT_NOT_FOUND',404,'게임 계정을 찾을 수 없습니다.');
    case 'not_found': return fail(404,'PULL_EVENT_NOT_FOUND',`탐방 기록을 찾을 수 없습니다: ${result.id}`);
    case 'invalid': return fail(400,result.code,`바꿀 수 없는 값입니다: ${result.id}`);
    case 'conflict': return fail(409,result.code,`다른 내용으로 이미 저장된 기록입니다: ${result.id}`);
  }
}

export async function handleCreatePullEvents(accountId:string,request:Request,env:DataEnv,fetcher:Fetcher=fetch):Promise<Response> {
  return runAuthedHandler(request,env,'pulls:write',async(principal)=>{
    const items=await parseBatch(request,'events');
    if(items instanceof Response) return items;
    let events;
    try { events=items.map(normalizePullEvent); }
    catch { return fail(400,'INVALID_PULL_EVENT','탐방 기록 형식을 확인해 주세요.'); }
    const result=await createPullEvents(env,principal.userId,accountId,events);
    // Create answers use accepted/duplicate, matching the submit contract.
    if(result.kind==='ok') return Response.json({ok:true,data:{accepted:result.applied,duplicate:result.duplicate}});
    return writeResponse(result);
  },fetcher);
}

export async function handleEditPullEvents(accountId:string,request:Request,env:DataEnv,fetcher:Fetcher=fetch):Promise<Response> {
  return runAuthedHandler(request,env,'pulls:write',async(principal)=>{
    const items=await parseBatch(request,'ops');
    if(items instanceof Response) return items;
    let ops;
    try { ops=items.map(normalizePullEditOp); }
    catch(error){ const code=error instanceof Error&&error.message==='INVALID_PULL_EDIT'?'INVALID_PULL_EDIT':'INVALID_PULL_EVENT'; return fail(400,code,'수정 요청 형식을 확인해 주세요.'); }
    return writeResponse(await editPullEvents(env,principal.userId,accountId,ops));
  },fetcher);
}

export async function handleListPullEvents(accountId:string,request:Request,env:DataEnv,fetcher:Fetcher=fetch):Promise<Response> {
  return runAuthedHandler(request,env,'pulls:read',async(principal)=>{
    const url=new URL(request.url);
    const after=intParam(url,'after',0,0,Number.MAX_SAFE_INTEGER);
    const limit=intParam(url,'limit',500,1,500);
    if(after===null||limit===null) return fail(400,'INVALID_CURSOR','after와 limit을 확인해 주세요.');
    const data=await listPullEvents(env,principal.userId,accountId,after,limit);
    if(!data) throw new DataAccessError('GAME_ACCOUNT_NOT_FOUND',404,'게임 계정을 찾을 수 없습니다.');
    return Response.json({ok:true,data});
  },fetcher);
}

async function digest(value:string):Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
}

// Compares fixed-length digests so the comparison time does not depend on the secret.
async function sameSecret(given:string,expected:string):Promise<boolean> {
  const [a,b]=await Promise.all([digest(given),digest(expected)]);
  let diff=0;
  for(let i=0;i<a.length;i++) diff|=a[i]^b[i];
  return diff===0;
}

// Read-only change feed for aggregating services. Opened only with the PULL_FEED_SECRET
// Worker secret, never with a user app token.
export async function handlePullChangeFeed(request:Request,env:DataEnv):Promise<Response> {
  if(!env.PULL_FEED_SECRET) return fail(503,'PULL_FEED_DISABLED','탐방 변경 기록 API가 설정되지 않았습니다.');
  const token=(request.headers.get('Authorization')??'').match(/^Bearer\s+(.+)$/i)?.[1]??'';
  if(!token||!await sameSecret(token,env.PULL_FEED_SECRET)) return fail(401,'PULL_FEED_UNAUTHORIZED','탐방 변경 기록 API 인증에 실패했습니다.');
  const url=new URL(request.url);
  const after=intParam(url,'after',0,0,Number.MAX_SAFE_INTEGER);
  const limit=intParam(url,'limit',500,1,1000);
  if(after===null||limit===null) return fail(400,'INVALID_CURSOR','after와 limit을 확인해 주세요.');
  return Response.json({ok:true,data:await listPullChanges(env,after,limit)});
}
