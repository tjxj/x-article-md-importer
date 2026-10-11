import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { convertMarkdown, inlineRichHtml } from '../src/core.js';

const input = process.argv[2];
if (!input) {
  console.error('用法: npm run bundle -- /absolute/path/to/article.md [output.json]');
  process.exit(2);
}
const path = resolve(input);
const output = resolve(process.argv[3] || 'out/article-bundle.json');
const source = await readFile(path, 'utf8');
const bundle = convertMarkdown(source, basename(path));
bundle.allRichHtml = inlineRichHtml(bundle);
await import('node:fs/promises').then(({ mkdir }) => mkdir(resolve(output, '..'), { recursive: true }));
await writeFile(output, JSON.stringify(bundle, null, 2));
console.log(JSON.stringify({ output, title: bundle.title, cover: bundle.cover?.src, statistics: bundle.statistics, steps: bundle.segments.length }, null, 2));
