import test from 'node:test';
import assert from 'node:assert/strict';
import { convertMarkdown, inlineRichHtml } from '../src/core.js';

test('拆开封面、正文图、代码和原生表格，保留富文本', () => {
  const source = `---\ntitle: .md\n---\n![封面](https://r2blog.zhanglearning.com/a.png)\n\n### 标题\n\n有 **加粗**、[链接](https://example.com)\n\n![插图](https://r2blog.zhanglearning.com/b.png)\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n\`\`\`shell\necho ok\n\`\`\`\n`;
  const bundle = convertMarkdown(source, '2026-10-10-示例.md');
  assert.equal(bundle.title, '示例');
  assert.equal(bundle.cover.src, 'https://r2blog.zhanglearning.com/a.png');
  assert.deepEqual(bundle.statistics, { html: 1, images: 1, code: 1, tables: 1 });
  assert.match(bundle.segments[0].html, /<h1>标题<\/h1>/);
  assert.match(bundle.segments[0].html, /<strong>加粗<\/strong>/);
  assert.match(bundle.segments[0].html, /href="https:\/\/example.com"/);
  assert.match(bundle.segments.find(x => x.type === 'table').markdown, /\| 1 \| 2 \|/);
  assert.equal(bundle.segments.find(x => x.type === 'code').code, 'echo ok');
  assert.match(inlineRichHtml(bundle), /【图片1：插图】/);
  assert.doesNotMatch(inlineRichHtml(bundle), /title: \.md/);
});

test('首个 H1 做标题，危险 HTML 作为文本处理', () => {
  const bundle = convertMarkdown('# 我的文章\n\n<script>alert(1)</script>\n\n内容', 'fallback.md');
  assert.equal(bundle.title, '我的文章');
  assert.match(bundle.segments[0].html, /&lt;script&gt;/);
  assert.doesNotMatch(bundle.segments[0].html, /<script>/);
});

test('将 Markdown 深层标题适配到 X 支持的两级标题', () => {
  const bundle = convertMarkdown('### 主章节\n\n内容\n\n#### 小章节\n\n细节', 'article.md');
  assert.match(bundle.segments[0].html, /<h1>主章节<\/h1>/);
  assert.match(bundle.segments[0].html, /<h2>小章节<\/h2>/);
});

test('将反引号包裹的完整网址变成可点击链接', () => {
  const bundle = convertMarkdown('模型：`https://huggingface.co/example/model`', 'article.md');
  assert.match(bundle.segments[0].html, /<a href="https:\/\/huggingface.co\/example\/model">/);
});
