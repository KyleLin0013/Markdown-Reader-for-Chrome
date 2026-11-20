import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('extension/licenses', { recursive: true });
await build({ entryPoints: ['src/reader.js'], outfile: 'extension/reader.js', bundle: true, minify: true, format: 'iife', target: 'chrome120', legalComments: 'eof' });
await build({ entryPoints: ['src/background.js'], outfile: 'extension/background.js', bundle: true, minify: true, format: 'iife', target: 'chrome120', legalComments: 'eof' });
for (const [name, file] of [['marked', 'LICENSE.md'], ['github-slugger', 'license'], ['dompurify', 'LICENSE']]) {
  await copyFile(`node_modules/${name}/${file}`, `extension/licenses/${name}.txt`);
}
console.log('Built extension/reader.js (all dependencies bundled; no CDN).');
