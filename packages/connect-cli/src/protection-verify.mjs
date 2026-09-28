import { readProjectConfig } from './config.mjs';
import { assetInventory, inspectProtection, siteUrl, generatedAssetPaths } from './protection.mjs';

function protectedPaths(files) {
  const paths = new Set(['/']);
  for (const file of files) {
    paths.add(file);
    if (file.endsWith('/index.html')) paths.add(file.slice(0, -10));
    else if (file.endsWith('.html')) paths.add(file.slice(0, -5));
  }
  return [...paths];
}
export async function verifyProtection(options = {}) {
  const root = options.root || process.cwd();
  const config = await readProjectConfig(root);
  const installed = await inspectProtection(root, config);
  if (!installed.ok) return { ok: false, protectionStatus: 'unverified', checks: [{ name: 'server_gate', ok: false, detail: installed.detail }] };
  const primary = siteUrl(options.url || config.protection.siteUrl);
  if (primary !== config.protection.siteUrl) throw new Error('--url이 설치 시 지정한 배포 주소와 다릅니다. protect install로 설정을 갱신하세요.');
  const origins = [...new Set([primary, ...String(options.alternateOrigins || '').split(',').filter(Boolean).map(siteUrl)])];
  const inventory = await assetInventory(root, config.protection.assetsDirectory, generatedAssetPaths(config.protection));
  const paths = protectedPaths(inventory.paths);
  if (options.paths) {
    for (const path of String(options.paths).split(',')) {
      if (!path.startsWith('/') || path.startsWith('//') || new URL(path, primary).origin !== new URL(primary).origin || Array.from(path).some(c => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 92 || c === '?' || c === '#')) throw new Error('--paths는 동일 사이트의 절대 경로를 쉼표로 구분하세요.');
      paths.push(path);
    }
  }
  const variants = [
    { name: 'GET', method: 'GET', headers: { Accept: 'text/html' } },
    { name: 'HEAD', method: 'HEAD', headers: {} },
    { name: 'Range', method: 'GET', headers: { Range: 'bytes=0-63' } },
    { name: 'invalid_cookie', method: 'GET', headers: { Cookie: '__Host-nakwol_connect=invalid' } },
  ];
  const jobs = origins.flatMap(origin => [...new Set(paths)].flatMap(path => variants.map(variant => ({ origin, path, variant }))));
  const checks = new Array(jobs.length); let cursor = 0;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  async function run() {
    while (cursor < jobs.length) {
      const index = cursor++, { origin, path, variant } = jobs[index];
      const url = new URL(path, origin);
      // A distinct query reduces false evidence from a stale CDN response.
      url.searchParams.set('__nakwol_probe', `${Date.now()}-${index}`);
      try {
        const res = await fetchImpl(url, { method: variant.method, headers: variant.headers, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(10000) });
        const noStore = (res.headers.get('Cache-Control') || '').includes('no-store');
        const ok = [401, 403].includes(res.status) && res.headers.get('X-Nakwol-Gate') === 'v1' && noStore;
        checks[index] = { name: `${origin.slice(0, -1)}${path} ${variant.name}`, ok, detail: `HTTP ${res.status}; gate=${res.headers.get('X-Nakwol-Gate') || 'missing'}; no-store=${noStore}` };
        await res.body?.cancel();
      } catch (error) {
        checks[index] = { name: `${origin.slice(0, -1)}${path} ${variant.name}`, ok: false, detail: error instanceof Error ? error.message : 'request failed' };
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, run));
  const ok = checks.every(check => check.ok);
  return { ok, protectionStatus: ok ? 'anonymous-blocking-verified' : 'verification-failed', checkedAt: new Date().toISOString(), origins, assetCount: inventory.paths.length, requestCount: checks.length, checks,
    limitations: ['검사한 배포 주소와 현재 로컬 빌드의 경로에 대한 비로그인 차단 결과입니다.', '정상 시즌3 계정 로그인, 권한 없는 계정 거부, 로그아웃은 실제 브라우저로 별도 확인하세요.', '열거하지 않은 이전 배포·원본 스토리지·다른 도메인은 검증하지 않습니다. 자동으로 찾아내거나 삭제하지 않습니다.'] };
}
