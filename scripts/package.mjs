import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const files = new Set(['manifest.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.txt', 'docs/TESTING.md', 'examples/demo.md']);
for (const item of manifest.content_scripts) {
  for (const file of [...item.js, ...(item.css || [])]) files.add(file);
}
files.add(manifest.background.service_worker);
const archive = {};
for (const file of files) {
  const path = resolve(root, file);
  if (relative(root, path).startsWith('..')) throw new Error(`打包路径超出项目目录：${file}`);
  archive[`x-article-md-importer/${file}`] = new Uint8Array(await readFile(path));
}
const output = resolve(process.argv[2] || resolve(root, 'out', `x-article-md-importer-${pkg.version}.zip`));
await mkdir(dirname(output), { recursive: true });
await writeFile(output, zipSync(archive, { level: 9 }));
console.log(output);
