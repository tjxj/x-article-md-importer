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
    if (html.trim()) segments.push({ type: 'html', html, text: visibleText(pending) });
    pending = [];
  }

  for (let i = 0; i < tokens.length; i++) {
    if (i === titleHeading) { i += 2; continue; }
    const imageParagraph = imageOnlyParagraph(tokens, i);
    if (imageParagraph) {
      flush();
      for (const image of imageParagraph.images) {
        if (!cover && !firstTextSeen) cover = { src: image.src, alt: image.alt };
        else {
          const item = { type: 'image', src: image.src, alt: image.alt, number: images.length + 1 };
          images.push(item);
          segments.push(item);
        }
      }
      i += imageParagraph.tokenCount - 1;
      continue;
    }
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
      segments.push({ type: 'table', markdown: raw, text: visibleText(tokens.slice(i, end + 1)) });
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
