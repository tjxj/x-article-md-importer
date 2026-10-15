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
  assert.deepEqual(bundle.segments.find(x => x.type === 'table').rows, [['A', 'B'], ['1', '2']]);
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

test('同一段里连续的图片都拆成独立图片步骤', () => {
  const bundle = convertMarkdown('开头\n\n![](https://r2.zhanglearning.com/a.png)\n![](https://r2.zhanglearning.com/b.png)\n\n结尾', 'article.md');
  assert.equal(bundle.cover, null);
  assert.deepEqual(bundle.images.map(image => image.src), [
    'https://r2.zhanglearning.com/a.png',
    'https://r2.zhanglearning.com/b.png'
  ]);
  assert.deepEqual(bundle.segments.map(segment => segment.type), ['html', 'image', 'image', 'html']);
  assert.equal(bundle.segments.some(segment => segment.html?.includes('<img')), false);
});

test('文字和图片混排时保持顺序，并把图片作为正文图片', () => {
  const bundle = convertMarkdown('先读 **说明** ![图](https://r2.zhanglearning.com/a.png) 再看结论', 'article.md');
  assert.equal(bundle.cover, null);
  assert.deepEqual(bundle.segments.map(segment => segment.type), ['html', 'image', 'html']);
  assert.match(bundle.segments[0].html, /<strong>说明<\/strong>/);
  assert.match(bundle.segments[2].html, /再看结论/);
  assert.equal(bundle.segments.some(segment => segment.html?.includes('<img')), false);
});

test('列表里的图片在解析时给出明确提示', () => {
  assert.throws(() => convertMarkdown('- ![图](https://r2.zhanglearning.com/a.png)', 'article.md'), /列表或引用中的图片/);
});

test('只把 1×1 认作表格尺寸入口', async () => {
  const { isOneByOneTableLabel } = await import('../src/x-adapter.js');
  for (const label of ['Insert a 1 by 1 table', '插入 1 × 1 表格', '插入一个 1x1 表格', '1 行 1 列', '1 by 1']) {
    assert.equal(isOneByOneTableLabel(label), true, label);
  }
  for (const label of ['Insert a 2 by 3 table', '插入 2 × 3 表格', 'Insert a 10 by 1 table', 'Insert a 1 by 10 table', '1 行 2 列', '表格']) {
    assert.equal(isOneByOneTableLabel(label), false, label);
  }
});

test('从 Markdown 表格取出单元格文字，跳过分隔行', async () => {
  const { markdownCells } = await import('../src/x-adapter.js');
  assert.deepEqual(markdownCells('| 测试基准 | 分数 |\n| --- | --- |\n| AIME | 79.2 |'), ['测试基准', '分数', 'AIME', '79.2']);
});

test('表格保留单元格顺序、重复值和转义竖线', () => {
  const bundle = convertMarkdown('| 项目 | 项目 |\n| --- | --- |\n| A\\|B | 42 |', 'article.md');
  assert.deepEqual(bundle.segments[0].rows, [['项目', '项目'], ['A|B', '42']]);
});

test('图片在建草稿前检查封面格式和大小', async () => {
  const { validateImageFile } = await import('../src/x-adapter.js');
  assert.doesNotThrow(() => validateImageFile(new File(['ok'], 'cover.webp', { type: 'image/webp' }), { cover: true }));
  assert.throws(() => validateImageFile(new File(['gif'], 'cover.gif', { type: 'image/gif' }), { cover: true }), /封面支持/);
  assert.throws(() => validateImageFile(new File(['svg'], 'chart.svg', { type: 'image/svg+xml' })), /正文图片支持/);
  assert.throws(() => validateImageFile({ name: 'large.png', type: 'image/png', size: 21 * 1024 * 1024 }), /20 MB/);
});

test('将反引号包裹的完整网址变成可点击链接', () => {
  const bundle = convertMarkdown('模型：`https://huggingface.co/example/model`', 'article.md');
  assert.match(bundle.segments[0].html, /<a href="https:\/\/huggingface.co\/example\/model">/);
});
