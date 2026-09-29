import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve('.');
const packageDir = join(root, 'packages', 'connect-cli');
const outputPath = join(root, 'src', 'assets', 'nakwol-connect-cli.tgz.b64.js.txt');
await writeFile(join(root, 'src/assets/gate-spec.js.txt'), await readFile(join(packageDir, 'GATE_SPEC.md')));
const temp = await mkdtemp(join(tmpdir(), 'nakwol-connect-pack-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

try {
  const result = spawnSync(npm, ['pack', '--json', '--pack-destination', temp], {
    cwd: packageDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) throw new Error(`npm pack failed (${result.status})`);
  const payload = JSON.parse(result.stdout || '[]');
  const filename = payload?.[0]?.filename;
  if (!filename) throw new Error('npm pack did not return a package filename');
  const bytes = await readFile(join(temp, filename));
  await writeFile(outputPath, `${bytes.toString('base64')}\n`);
  console.log(`CONNECT_CLI_PACKAGE_READY:${filename}:${bytes.length}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
