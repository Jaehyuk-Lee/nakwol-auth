import { readFile, writeFile, mkdir, readdir, realpath, stat } from 'node:fs/promises';
import { resolve, relative, join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { readProjectConfig, writeProjectConfig } from './config.mjs';
import { detectProject } from './project.mjs';
import { installIntegration } from './integration.mjs';

export const WRANGLER_FILE = 'wrangler.nakwol.json';
const GENERATED = '.nakwol/server';
const { version: runtimeVersion } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const UPDATE_COMMAND = 'npx --yes nakwol-connect@~0.7.0 protect update';
// Git may convert generated text to CRLF on Windows; line endings are not a gate change.
const hash = value => createHash('sha256').update(value.toString().replaceAll('\r\n', '\n')).digest('hex');

export function siteUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('--url은 HTTPS 사이트 루트여야 합니다. 예: https://example.com/');
  return url.href;
}
export async function assetInventory(root, directory, generatedPaths = []) {
  if (typeof directory !== 'string' || !directory || isAbsolute(directory)) throw new Error('--assets에 프로젝트 내부의 빌드 결과 폴더를 지정하세요.');
  const base = await realpath(root), target = await realpath(resolve(root, directory));
  const rel = relative(base, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('프로젝트 루트나 외부 폴더를 자산으로 배포할 수 없습니다. dist 같은 전용 출력 폴더를 사용하세요.');
  const paths = [];
  async function walk(folder, prefix = '') {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const local = join(folder, entry.name), path = `${prefix}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`자산 폴더의 심볼릭 링크는 지원하지 않습니다: ${path}`);
      if (entry.isFile() && generatedPaths.includes(relative(base, local).split(String.fromCharCode(92)).join('/'))) continue;
      if (entry.name.startsWith('.') || /^(node_modules|src|__nakwol)$/i.test(entry.name) || /\.(env|pem|key|map)$/i.test(entry.name) || /^(wrangler\.|package(-lock)?\.json|_worker\.js|_redirects|_headers|_routes\.json)/i.test(entry.name)) throw new Error(`공개 자산에 소스/설정 파일이 있습니다: ${path}`);
      if (entry.isDirectory()) await walk(local, path);
      else if (entry.isFile()) paths.push(path.split('/').map(encodeURIComponent).join('/'));
    }
  }
  await walk(target);
  if (!paths.includes('/index.html')) throw new Error('정적 빌드 결과에 index.html이 필요합니다. 먼저 빌드하세요. SSR/API 서버는 자동 설치 대상이 아닙니다.');
  if (paths.length > 10000) throw new Error('현재 검증은 최대 10,000개 자산을 지원합니다.');
  return { directory: relative(base, target).split(String.fromCharCode(92)).join('/'), paths: paths.sort() };
}
function pagesFiles(directory) { return [`${directory}/_worker.js`, `${directory}/_routes.json`, WRANGLER_FILE]; }
export function generatedAssetPaths(protection) {
  return protection?.provider === 'cloudflare-pages' ? pagesFiles(protection.assetsDirectory).slice(0, 2) : [];
}
async function generatedFiles(settings, directory, provider, projectName) {
  const gate = await readFile(new URL('./server/gate.mjs', import.meta.url), 'utf8');
  const login = await readFile(new URL('./server/login.mjs', import.meta.url), 'utf8');
  if (provider === 'cloudflare-pages') return {
    [`${directory}/_worker.js`]: `${login.replace(/^export /gm, '')}\n${gate.replace(/^export /gm, '').replace("import { loginPage } from './login.mjs';", '')}\nconst settings = ${JSON.stringify(settings)};\nexport default { fetch(request, env) { return serveProtected(request, env, settings); } };\n`,
    [`${directory}/_routes.json`]: JSON.stringify({ version:1, include:['/*'], exclude:[] }, null, 2) + '\n',
    [WRANGLER_FILE]: JSON.stringify({ name:projectName, pages_build_output_dir:directory, compatibility_date:'2026-09-01' }, null, 2) + '\n',
  };
  return {
    [`${GENERATED}/gate.mjs`]: gate,
    [`${GENERATED}/login.mjs`]: login,
    [`${GENERATED}/index.mjs`]: `import { serveProtected } from './gate.mjs';\nconst settings = ${JSON.stringify(settings)};\nexport default { fetch(request, env) { return serveProtected(request, env, settings); } };\n`,
    [WRANGLER_FILE]: JSON.stringify({ name: settings.clientId, main: `${GENERATED}/index.mjs`, compatibility_date: '2026-09-01', workers_dev: true, preview_urls: false, assets: { directory, binding: 'ASSETS', run_worker_first: true } }, null, 2) + '\n',
  };
}
export async function inspectProtection(root, config, options = {}) {
  if (!config?.protection) return { installed: false, ok: false, detail: '서버 게이트 미설치. Embed만으로 HTML/파일 직접 접근은 차단되지 않습니다.' };
  const p = config.protection;
  if (!options.allowSettingsChange && (p.accessPolicy !== config.accessPolicy || p.clientId !== config.clientId || p.authOrigin !== config.authOrigin)) return { installed:true, ok:false, detail:'앱 정책/주소와 서버 게이트 설정이 다릅니다. protect install로 갱신 후 배포하세요.' };
  const expectedNames = p.provider === 'cloudflare-pages' ? pagesFiles(p.assetsDirectory) : [`${GENERATED}/gate.mjs`, `${GENERATED}/login.mjs`, `${GENERATED}/index.mjs`, WRANGLER_FILE];
  if (!['cloudflare-workers','cloudflare-pages'].includes(p.provider) || !p.files || Object.keys(p.files).length !== expectedNames.length) return { installed: true, ok: false, detail: '지원하지 않는 보호 설정' };
  for (const file of expectedNames) {
    try { if (hash(await readFile(join(root, file))) !== p.files[file]) return { installed: true, ok: false, detail: `설치 이후 파일 변경: ${file}` }; }
    catch (error) {
      if (options.allowMissingBuildOutputs && error.code === 'ENOENT' && generatedAssetPaths(p).includes(file)) continue;
      return { installed: true, ok: false, detail: `파일 없음: ${file}` };
    }
  }
  return { installed: true, ok: true, runtimeVersion:p.runtimeVersion || 'legacy', updateAvailable:p.runtimeVersion !== runtimeVersion, detail: `서버 게이트 구성 확인 (${p.runtimeVersion || 'legacy'}). ${p.runtimeVersion !== runtimeVersion ? '공통 게이트 갱신: npx --yes nakwol-connect@~0.7.0 protect update 후 재배포. ' : ''}실제 배포 차단은 protect verify로 별도 확인해야 합니다.` };
}
export async function installProtection(options = {}) {
  const root = options.root || process.cwd();
  const config = await readProjectConfig(root);
  if (!config?.clientId) throw new Error('먼저 nakwol-connect init을 실행하세요.');
  if (!['cloudflare-workers','cloudflare-pages'].includes(options.provider)) throw new Error('자동 설치 지원 환경: --provider cloudflare-workers 또는 cloudflare-pages (정적 빌드). Vercel·Netlify 등은 nakwol-connect/server 공통 게이트를 호스팅에 연결한 뒤 protect verify --provider custom --url https://SITE/ --paths /,/data.json 으로 검사하세요. GitHub Pages는 서버 게이트를 실행할 수 없으므로 보호 콘텐츠를 서버가 있는 호스팅으로 옮겨야 합니다. Embed만으로는 파일을 보호하지 못합니다.');
  if (config.protection && config.protection.provider !== options.provider) throw new Error('기존 배포의 공개 경로를 남길 수 있으므로 provider를 자동 변경하지 않습니다.');
  if (config.protection && options.assets && options.assets !== config.protection.assetsDirectory) throw new Error('기존 보호 파일을 보존하기 위해 자산 폴더 변경은 자동 적용하지 않습니다.');
  if (config.authMode !== 'required') throw new Error('공개 페이지(optional)에는 서버 게이트를 자동 적용하지 않습니다. init --auth required로 정책을 먼저 정하세요.');
  const project = await detectProject(root);
  if (!['html','vite','react','vue','cra'].includes(project.framework)) throw new Error('자동 서버 보호 설치는 HTML/Vite/React/Vue/CRA의 정적 빌드만 지원합니다.');
  const url = siteUrl(options.url || config.protection?.siteUrl);
  if (!config.redirectUris.includes(url)) throw new Error(`콜백을 먼저 등록하세요: nakwol-connect add-url ${url}`);
  if (config.protection && !(await inspectProtection(root, config, { allowSettingsChange:true, allowMissingBuildOutputs:options.update === true })).ok) throw new Error('기존 서버 게이트가 변경되어 자동으로 덮어쓰지 않습니다. 변경 사항을 먼저 검토하세요.');
  const inventory = await assetInventory(root, options.assets || config.protection?.assetsDirectory, generatedAssetPaths(config.protection));
  const accessPolicy = config.accessPolicy || 'member';
  if (!['member', 'guest', 'admin'].includes(accessPolicy)) throw new Error('접근 정책을 확인하세요.');
  const authOrigin = config.authOrigin || 'https://nakwol-auth.sepsd21.workers.dev';
  if (new URL(authOrigin).protocol !== 'https:') throw new Error('서버 배포의 AUTH 주소는 HTTPS여야 합니다.');
  const projectName = options.projectName || config.protection?.projectName || config.clientId;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(projectName)) throw new Error('--project-name에 Cloudflare 프로젝트 이름을 지정하세요.');
  const files = await generatedFiles({ clientId: config.clientId, siteUrl: url, authOrigin, accessPolicy }, inventory.directory, options.provider, projectName);
  for (const file of Object.keys(files)) {
    try { await stat(join(root, file)); if (!config.protection) throw new Error(`기존 파일을 덮어쓸 수 없습니다: ${file}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const buildPackage = await updateBuildHook(root, config.protection?.updateChannel === 'managed');
  await installIntegration(root, project, config.clientId, { ...config, serverGate:true, siteUrl:url });
  await mkdir(join(root, GENERATED), { recursive: true });
  for (const [file, content] of Object.entries(files)) await writeFile(join(root, file), content);
  await writeFile(join(root, 'package.json'), JSON.stringify(buildPackage, null, 2) + String.fromCharCode(10));
  const protection = { runtimeVersion, updateChannel:config.protection?.updateChannel === 'managed' ? 'managed' : 'latest', ...(config.protection?.automation ? {automation:config.protection.automation} : {}), provider: options.provider, projectName, siteUrl: url, clientId:config.clientId, accessPolicy, authOrigin, assetsDirectory: inventory.directory, files: Object.fromEntries(Object.entries(files).map(([file, content]) => [file, hash(content)])) };
  await writeProjectConfig(root, { ...config, accessPolicy, authOrigin, protection });
  return { ok: true, protectionStatus: 'configured', protection, nextSteps: [
    'npm run build는 설정된 버전의 공식 공통 게이트를 반영합니다. 별도 빌드 도구/배포 명령은 빌드 후 npm run nakwol:gate를 실행하세요.',
    'Connect의 서버 로그아웃 연동이 반영되도록 사이트를 다시 빌드하세요.',
    options.provider === 'cloudflare-pages' ? `npx wrangler pages secret put NAKWOL_SESSION_SECRET --project-name ${projectName} (무작위 32자 이상)` : `npx wrangler secret put NAKWOL_SESSION_SECRET --config ${WRANGLER_FILE} (무작위 32자 이상, 저장소에 넣지 않기)`,
    options.provider === 'cloudflare-pages' ? `npx wrangler pages deploy ${inventory.directory} --project-name ${projectName} (운영 브랜치를 명시하고 Pages Functions fail-open을 비활성화하세요)` : `npx wrangler deploy --config ${WRANGLER_FILE}`,
    `nakwol-connect protect verify --url ${url}`,
    '기존 Pages/스토리지/미리보기 주소가 자료를 공개하지 않는지 확인하고 필요하면 --alternate-origins로 함께 검사하세요.',
  ] };
}

async function updateBuildHook(root, managed = false) {
  let pkg;
  try { pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; pkg = { private:true }; }
  if (managed && pkg.devDependencies?.['nakwol-connect'] !== runtimeVersion) throw new Error('Managed gate requires an exact installed nakwol-connect version matching package.json.');
  const scripts = { ...pkg.scripts };
  if (managed) {
    if (scripts['nakwol:gate'] !== 'nakwol-connect protect update') throw new Error('Managed gate hook was changed; refusing network-based fallback.');
    return pkg;
  }
  if (scripts['nakwol:gate'] && scripts['nakwol:gate'] !== UPDATE_COMMAND && scripts['nakwol:gate'] !== 'npx --yes nakwol-connect@latest protect update' && scripts['nakwol:gate'] !== 'npx --yes nakwol-connect@~0.6.3 protect update') throw new Error('기존 nakwol:gate 스크립트를 덮어쓰지 않습니다.');
  scripts['nakwol:gate'] = UPDATE_COMMAND;
  if (!scripts.build) scripts.build = 'npm run nakwol:gate';
  else if (scripts.build !== 'npm run nakwol:gate' && !(scripts.postbuild || '').includes('npm run nakwol:gate')) {
    scripts.postbuild = scripts.postbuild ? `npm run nakwol:gate && ${scripts.postbuild}` : 'npm run nakwol:gate';
  }
  return { ...pkg, scripts };
}

export async function updateProtection(options = {}) {
  const root = options.root || process.cwd();
  const config = await readProjectConfig(root);
  if (!config?.protection) throw new Error('먼저 protect install로 공통 게이트를 설치하세요.');
  return installProtection({ ...options, root, provider:config.protection.provider, update:true });
}
