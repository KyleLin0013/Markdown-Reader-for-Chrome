import { execFileSync } from 'node:child_process';
import { mkdir, rm, readFile } from 'node:fs/promises';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const filename = `MDReader-${version}.zip`;
await mkdir('release', { recursive: true });
await rm(`release/${filename}`, { force: true });
execFileSync('zip', ['-qr', `../release/${filename}`, '.', '-x', '*.DS_Store'], { cwd: 'extension' });
console.log(`Packaged release/${filename}`);
