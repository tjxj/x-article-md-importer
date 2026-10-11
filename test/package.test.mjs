import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unzipSync, strFromU8 } from 'fflate';

test('安装包资源完整，且不包含私人输出或依赖目录', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xmd-package-'));
  try {
    const output = join(directory, 'extension.zip');
    await promisify(execFile)(process.execPath, [resolve('scripts/package.mjs'), output]);
    const archive = unzipSync(new Uint8Array(await readFile(output)));
    const prefix = 'x-article-md-importer/';
    const manifest = JSON.parse(strFromU8(archive[prefix + 'manifest.json']));
    for (const content of manifest.content_scripts) {
      for (const file of [...content.js, ...(content.css || [])]) assert.ok(archive[prefix + file]?.length, file);
    }
    assert.ok(archive[prefix + manifest.background.service_worker]?.length);
    assert.ok(archive[prefix + 'LICENSE']?.length);
    assert.ok(archive[prefix + 'docs/TESTING.md']?.length);
    for (const name of Object.keys(archive)) {
      assert.ok(name.startsWith(prefix), name);
      assert.doesNotMatch(name, /(?:node_modules|\/out\/|验证记录|\.env|\.jpg$|\.png$|saluki-bundle)/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
