#!/usr/bin/env node
import {
  DEFAULT_AUTH_ORIGIN, DEFAULT_DATA_ORIGIN,
  initProject, doctorProject, statusProject, addUrlProject, syncProject, removeProject,
  dataStatusProject, dataSetProject, dataAddProject, dataRemoveProject,
} from '../src/commands.mjs';
import { dataDescribeProject } from '../src/discovery.mjs';
import { installProtection, updateProtection } from '../src/protection.mjs';
import { automateProtection, protectionStatus } from '../src/managed-updates.mjs';
import { readFile } from 'node:fs/promises';
const {version:cliVersion}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
import { verifyProtection } from '../src/protection-verify.mjs';

function parse(argv) {
  const args=[...argv]; const command=args.shift()||'init'; const options={}; const positionals=[];
  while(args.length){const value=args.shift();if(!value.startsWith('--')){positionals.push(value);continue;}const key=value.slice(2);if(['json','no-open','offline'].includes(key)){options[key==='no-open'?'noOpen':key]=true;continue;}const next=args.shift();if(next==null)throw new Error(`--${key} 값이 필요합니다.`);const map={'auth-origin':'authOrigin','data-origin':'dataOrigin','client-id':'clientId','access-policy':'accessPolicy','auth':'authMode','project-name':'projectName','alternate-origins':'alternateOrigins','expect-runtime':'expectRuntime'};options[map[key]||key]=next;}
  return {command,options,positionals};
}
function human(result){if(result?.checks){for(const check of result.checks)console.log(`${check.ok?'✓':'×'} ${check.name}: ${check.detail||''}`);if(result.protectionStatus)console.log(`서버 보호: ${result.protectionStatus}`);for(const note of result.limitations||[])console.log(note);return;}console.log(JSON.stringify(result,null,2));}
async function main(){
  const{command,options,positionals}=parse(process.argv.slice(2));options.authOrigin||=process.env.NAKWOL_AUTH_ORIGIN||DEFAULT_AUTH_ORIGIN;if(!options.dataOrigin&&process.env.NAKWOL_DATA_ORIGIN)options.dataOrigin=process.env.NAKWOL_DATA_ORIGIN;options.output=options.json?()=>{}:console.log;let result;
  if(command==='protect'){
    if(positionals[0]==='install')result=await installProtection(options);
    else if(positionals[0]==='update')result=await updateProtection(options);
    else if(positionals[0]==='automate')result=await automateProtection(options);
    else if(positionals[0]==='status')result=await protectionStatus(options);
    else if(positionals[0]==='verify')result=await verifyProtection(options);
    else throw new Error('사용법: nakwol-connect protect install --provider <cloudflare-workers|cloudflare-pages> --assets dist --url https://SITE/ 또는 protect verify --url https://SITE/ [--alternate-origins URL,URL] [--paths /api/private]');
  }
  else if(command==='init')result=await initProject(options);else if(command==='doctor')result=await doctorProject(options);else if(command==='status')result=await statusProject(options);else if(command==='add-url'){if(!positionals[0])throw new Error('사용법: nakwol-connect add-url <URL>');result=await addUrlProject(positionals[0],options);}else if(command==='sync')result=await syncProject(options);else if(command==='remove')result=await removeProject(options);else if(command==='data'){const op=positionals[0]||'status';const scopes=positionals[1]||'';if(op==='status')result=await dataStatusProject(options);else if(op==='describe')result=await dataDescribeProject(options);else if(op==='set')result=await dataSetProject(scopes,options);else if(op==='add')result=await dataAddProject(scopes,options);else if(op==='remove')result=await dataRemoveProject(scopes,options);else throw new Error('사용법: nakwol-connect data <status|describe|set|add|remove> [scopes]');}
  else if(command==='help'||command==='--help'||command==='-h'){console.log(`NAKWOL Connect CLI v${cliVersion}\n\nCommands:\n  init       프로젝트 감지 → AUTH 앱 → DATA scope → Connect 설치\n  doctor     연결 + 배포 사이트의 실제 차단 검사 (required는 검증 전 실패)
  protect install --provider <cloudflare-workers|cloudflare-pages> --assets dist --url https://SITE/
             정적 빌드의 서버 게이트 설치 (배포는 별도)
  protect automate [--environment production]  고정 버전 및 GitHub 업데이트 CI 설치
  protect status [--offline]  로컬 및 실제 배포 버전 비교
  protect update   저장된 설정으로 공통 게이트 갱신 (재배포 필요)
  protect verify --url https://SITE/ [--alternate-origins URL,URL] [--paths /private]
  protect verify --provider custom --url https://SITE/ --paths /,/data.json
             직접 구현한 게이트도 명시한 경로의 비로그인 차단 검사 가능
             비로그인 GET/HEAD/Range/잘못된 쿠키 차단 검증\n  status     현재 프로젝트 연결 상태 출력\n  add-url    Redirect URI 추가\n  sync       중앙/로컬 desired state 동기화\n  data       DATA status/describe/set/add/remove\n  remove     로컬 Connect 설치 제거\n\nOptions:\n  --json\n  --url <URL>\n  --name <NAME>\n  --client-id <ID>\n  --access-policy <guest|member|admin>\n  --auth <required|optional>   기본값 required\n  --scopes <scope,scope>\n  --data-origin <URL>\n  --no-open\n  --auth-origin <URL>`);return;}else throw new Error(`알 수 없는 명령: ${command}`);
  if(options.json)console.log(JSON.stringify(result,null,2));else human(result);if(result?.ok===false)process.exitCode=1;
}
main().catch((error)=>{console.error(error?.message||String(error));process.exitCode=1;});
