import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchImageFile, firstMissingContentStep } from '../src/x-adapter.js';

test('扩展更新后旧页面失去通信入口时给出刷新提示', async () => {
  const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
  Object.defineProperty(globalThis, 'chrome', { value: {}, configurable: true });
  try {
    await assert.rejects(
      fetchImageFile('https://r2blog.zhanglearning.com/example.png'),
      /插件已更新或失去连接，请刷新 X 页面后重新选择 Markdown/
    );
  } finally {
    if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
    else delete globalThis.chrome;
  }
});

test('最终核对能发现图片后整段正文被 X 丢弃', () => {
  const bundle = {
    segments: [
      { type: 'html', text: '图片前正文' },
      { type: 'image', src: 'example.png' },
      { type: 'html', text: '图片后必须保留的正文和标题' },
      { type: 'code', code: 'console.log("ok")' }
    ]
  };
  assert.equal(firstMissingContentStep(bundle, '图片前正文 console.log("ok")'), 2);
  assert.equal(firstMissingContentStep(bundle, '图片前正文 图片后必须保留的正文和标题 console.log("ok")'), -1);
});
