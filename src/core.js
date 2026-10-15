import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false, typographer: false });
const defaultInlineCode = markdown.renderer.rules.code_inline;
markdown.renderer.rules.code_inline = (tokens, index, options, env, renderer) => {
  const content = tokens[index].content;
  if (/^https?:\/\/\S+$/i.test(content) && markdown.validateLink(content)) {
    const url = markdown.utils.escapeHtml(content);
    return `<a href="${url}">${url}</a>`;
  }
  return defaultInlineCode(tokens, index, options, env, renderer);
};

function metadataAndBody(source) {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return { metadata: {}, body: normalized };
  const metadata = {};
  for (const line of match[1].split('\n')) {
    const field = line.match(/^([\w-]+):\s*(.*?)\s*$/);
    if (field) metadata[field[1].toLowerCase()] = field[2].replace(/^['"]|['"]$/g, '');
  }
  return { metadata, body: normalized.slice(match[0].length) };
}

function filenameTitle(filename) {
  return filename
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/\.md$/i, '')
    .replace(/^\d{4}-\d{2}-\d{2}[- _]*/, '')
    .trim();
}

function imageOnlyParagraph(tokens, position) {
  if (tokens[position]?.type !== 'paragraph_open' || tokens[position + 1]?.type !== 'inline' || tokens[position + 2]?.type !== 'paragraph_close') return null;
  const images = [];
  for (const child of tokens[position + 1].children ?? []) {
    if (child.type === 'softbreak' || child.type === 'hardbreak') continue;
    if (child.type === 'text' && !child.content.trim()) continue;
    if (child.type !== 'image') return null;
    images.push({ src: child.attrGet('src'), alt: child.content || '' });
  }
  if (!images.length) return null;
  return { images, tokenCount: 3 };
}

function visibleText(tokens) {
  return tokens.filter(token => token.type === 'inline').map(token => (token.children || []).map(child => {
    if (child.type === 'softbreak' || child.type === 'hardbreak') return '\n';
    if (child.type === 'text' || child.type === 'code_inline') return child.content;
    return '';
  }).join('')).join('\n');
}

function tableRows(tokens) {
  const rows = [];
  let row = null;
  for (const token of tokens) {
    if (token.type === 'tr_open') row = [];
    else if (token.type === 'tr_close' && row) { rows.push(row); row = null; }
    else if (token.type === 'inline' && row) row.push(visibleText([token]));
  }
  return rows;
}

export function convertMarkdown(source, filename = 'article.md') {
  const { metadata, body } = metadataAndBody(source);
  const lines = body.split('\n');
  const tokens = markdown.parse(body, {});
  const segments = [];
  const images = [];
  let pending = [];
  let cover = null;
  let firstTextSeen = false;
  let title = metadata.title && !/^\.?(?:md|markdown)$/i.test(metadata.title) ? metadata.title : '';
  const firstH1 = tokens.findIndex(token => token.type === 'heading_open' && token.tag === 'h1');
  const isTitleHeading = firstH1 >= 0 && !tokens.slice(0, firstH1).some(token => token.type === 'inline' && token.children?.some(child => child.type !== 'image' && child.type !== 'softbreak' && child.content.trim()));
  const titleHeading = isTitleHeading ? firstH1 : -1;
  if (!title && titleHeading >= 0) title = tokens[titleHeading + 1].content.trim();
  const levels = tokens.filter((token, index) => token.type === 'heading_open' && index !== titleHeading).map(token => Number(token.tag.slice(1)));
  const baseHeadingLevel = levels.length ? Math.min(...levels) : 1;

  function flush() {
    if (!pending.length) return;
    const html = markdown.renderer.render(pending, markdown.options, {});
    if (/<img\b/i.test(html)) throw new Error('列表或引用中的图片暂不能自动导入，请把图片单独放成正文段落');
    if (html.trim()) segments.push({ type: 'html', html, text: visibleText(pending) });
    pending = [];
  }

  function addImage(image, mayBeCover) {
    if (mayBeCover && !cover && !firstTextSeen) cover = image;
    else {
      const item = { type: 'image', ...image, number: images.length + 1 };
      images.push(item);
      segments.push(item);
    }
  }

  function splitMixedImageParagraph(position) {
    const opening = tokens[position];
    const inline = tokens[position + 1];
    if (opening?.type !== 'paragraph_open' || inline?.type !== 'inline' || tokens[position + 2]?.type !== 'paragraph_close') return false;
    if (!inline.children?.some(child => child.type === 'image')) return false;
    if (opening.level !== 0) throw new Error('列表或引用中的图片暂不能自动导入，请把图片单独放成正文段落');
    flush();
    const active = [];
    let chunk = [];
    let hasText = false;
    function flushChunk() {
      if (!hasText) return;
      const completed = [...chunk, ...active.slice().reverse().map(token => ({ ...token, type: token.type.replace(/_open$/, '_close'), nesting: -1 }))];
      const part = { ...inline, children: completed };
      segments.push({ type: 'html', html: markdown.renderer.render([opening, part, tokens[position + 2]], markdown.options, {}), text: visibleText([part]) });
      firstTextSeen = true;
    }
    for (const child of inline.children) {
      if (child.type === 'image') {
        flushChunk();
        addImage({ src: child.attrGet('src'), alt: child.content || '' }, false);
        firstTextSeen = true;
        chunk = active.slice();
        hasText = false;
      } else {
        chunk.push(child);
        if (child.type.endsWith('_open')) active.push(child);
        else if (child.type.endsWith('_close')) active.pop();
        if (['text', 'code_inline'].includes(child.type) && child.content.trim()) hasText = true;
      }
    }
    flushChunk();
    return true;
  }

  for (let i = 0; i < tokens.length; i++) {
    if (i === titleHeading) { i += 2; continue; }
    const imageParagraph = imageOnlyParagraph(tokens, i);
    if (imageParagraph) {
      if (tokens[i].level !== 0) throw new Error('列表或引用中的图片暂不能自动导入，请把图片单独放成正文段落');
      flush();
      for (const image of imageParagraph.images) addImage(image, true);
      i += imageParagraph.tokenCount - 1;
      continue;
    }
    if (splitMixedImageParagraph(i)) { i += 2; continue; }
    const token = tokens[i];
    if (token.type === 'heading_open' || token.type === 'heading_close') token.tag = Number(token.tag.slice(1)) === baseHeadingLevel ? 'h1' : 'h2';
    if (token.type === 'fence' || token.type === 'code_block') {
      flush();
      segments.push({ type: 'code', language: token.info.trim().split(/\s+/)[0] || '', code: token.content.replace(/\n$/, '') });
      firstTextSeen = true;
      continue;
    }
    if (token.type === 'table_open') {
      flush();
      let end = i;
      while (end < tokens.length && tokens[end].type !== 'table_close') end++;
      const raw = lines.slice(token.map?.[0] ?? 0, token.map?.[1] ?? 0).join('\n');
      const tableTokens = tokens.slice(i, end + 1);
      segments.push({ type: 'table', markdown: raw, text: visibleText(tableTokens), rows: tableRows(tableTokens) });
      firstTextSeen = true;
      i = end;
      continue;
    }
    pending.push(token);
    if (token.type === 'inline' && token.content.trim()) firstTextSeen = true;
  }
  flush();
  title = (title || filenameTitle(filename) || '未命名文章').slice(0, 100);
  return { title, cover, images, segments, statistics: {
    html: segments.filter(segment => segment.type === 'html').length,
    images: images.length,
    code: segments.filter(segment => segment.type === 'code').length,
    tables: segments.filter(segment => segment.type === 'table').length
  } };
}

export function inlineRichHtml(bundle) {
  return bundle.segments.map(segment => {
    if (segment.type === 'html') return segment.html;
    if (segment.type === 'image') return `<p>【图片${segment.number}：${markdown.utils.escapeHtml(segment.alt || '配图')}】</p>`;
    if (segment.type === 'code') return `<p>【代码块：${markdown.utils.escapeHtml(segment.language || '文本')}】</p>`;
    return '<p>【表格】</p>';
  }).join('\n');
}
