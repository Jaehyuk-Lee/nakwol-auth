export function loginPage(settings, status) {
  const data = JSON.stringify({ clientId: settings.clientId, authOrigin: settings.authOrigin, redirectUri: settings.siteUrl, status }).replaceAll('<', '\u003c');
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>NAKWOL 로그인</title>
<style>body{font:18px system-ui;background:#f6f3eb;color:#182235;margin:0}main{max-width:520px;margin:12vh auto;padding:24px}button{font:inherit;padding:12px;margin:6px 6px 6px 0}p{line-height:1.6}</style>
<main><h1>NAKWOL</h1><p id="status">접속 확인 중…</p><button id="login" hidden>Discord로 로그인</button><button id="retry" hidden>다시 확인</button><p><a id="recovery" hidden>계정 확인·접속 문제 해결</a></p><noscript><p>로그인하려면 JavaScript를 켜 주세요.</p></noscript></main>
<script type="module">
const settings=${data};
const statusEl=document.getElementById('status'), login=document.getElementById('login'), retry=document.getElementById('retry');
const recovery=document.getElementById('recovery');
const recoveryUrl=new URL('/account',settings.authOrigin);recoveryUrl.searchParams.set('client_id',settings.clientId);recoveryUrl.searchParams.set('recovery','1');recovery.href=recoveryUrl.href;
const key='nakwol:server:return:'+settings.clientId;
const safe=p=>typeof p==='string' && p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/__nakwol/') && !/[\\\\\\u0000-\\u001f]/.test(p) && new URL(p,location.origin).origin===location.origin;
const currentPath=location.pathname+location.search+location.hash;
const callback=new URLSearchParams(location.search);
const isCallback=callback.has('state')&&(callback.has('code')||callback.has('error'));
try { if(!isCallback && currentPath!=='/' && safe(currentPath)) sessionStorage.setItem(key,JSON.stringify({path:currentPath,at:Date.now()})); } catch { /* Return to root when storage is unavailable. */ }
retry.onclick=()=>location.reload();
const fail=(code)=>{login.hidden=false;recovery.hidden=false;statusEl.textContent=code==='access_denied'||code===403?'이 사이트의 접근 권한이 없습니다. member 사이트는 시즌3 역할이 필요하며 추가 역할 조건이 있을 수 있습니다. 역할을 받았다면 계정 페이지에서 다시 확인해 주세요. 관리자 차단이나 서비스 설정 문제는 관리자 확인이 필요합니다.':code===503?'인증 서버를 확인할 수 없습니다. 잠시 후 다시 확인해 주세요.':'로그인을 완료하지 못했습니다. 다시 로그인해 주세요.';login.disabled=false;retry.hidden=false;};
try {
 const {NakwolAuthClient}=await import(settings.authOrigin+'/sdk/v0.3.1/nakwol-auth-web.js');
 const auth=new NakwolAuthClient({...settings,autoSso:settings.status===401});
 login.onclick=()=>{login.disabled=true;auth.clearLocalState();auth.login().catch(e=>fail(e.code));};
 if(settings.status===503){fail(503);}else{
 const user=await auth.bootstrap();
 if(!user){login.hidden=false;statusEl.textContent='Discord로 로그인하면 사이트 접근 권한을 확인합니다.';}else{
 const result=await fetch('/__nakwol/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({access_token:auth.getAccessToken()}),signal:AbortSignal.timeout(15000)});
 if(!result.ok){if(result.status===401||result.status===403)auth.clearDeniedLogin({code:'access_denied'});fail(result.status);}else{
 // A disabled cookie must not cause an endless successful-login redirect loop.
 const attemptsKey=key+':attempts'; const attempts=JSON.parse(sessionStorage.getItem(attemptsKey)||'[]').filter(t=>Date.now()-t<60000);
 if(attempts.length>=2){sessionStorage.removeItem(attemptsKey);statusEl.textContent='로그인 쿠키를 저장하지 못했습니다. 이 사이트의 쿠키를 허용한 뒤 다시 확인해 주세요.';retry.hidden=false;recovery.hidden=false;}else{
 sessionStorage.setItem(attemptsKey,JSON.stringify([...attempts,Date.now()]));
 let target='/';try{const saved=JSON.parse(sessionStorage.getItem(key)||'null');sessionStorage.removeItem(key);if(saved&&Date.now()-saved.at<600000&&safe(saved.path))target=saved.path;}catch{}
 location.replace(target);
 }
 }
 }
 }
} catch(error){fail(error.code);}
</script></html>`;
}
