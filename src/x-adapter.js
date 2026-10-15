const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = text => String(text || '').replace(/[\s\u200b\ufeff]+/g, '');
const visible = element => element && element.getClientRects().length > 0;

export function firstMissingContentStep(bundle, actualText) {
  const normalized = clean(actualText);
  return bundle.segments.findIndex(step => {
    if (step.type === 'image' || step.type === 'table') return false;
    const expected = clean(step.text || step.code || '');
    return expected && !normalized.includes(expected);
  });
}

export async function waitFor(read, message, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await pause(100);
  }
  throw new Error(message);
}

function textButton(root, names) {
  const buttons = Array.from(root.querySelectorAll('button, [role="button"]')).filter(element => visible(element) && !element.disabled);
  for (const name of names) {
    const found = buttons.find(element => element.textContent.trim() === name || element.getAttribute('aria-label') === name);
    if (found) return found;
  }
  return null;
}

function setValue(element, value) {
  const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function editor() {
  const element = document.querySelector('[data-testid="composer"][contenteditable="true"]')
    || document.querySelector('[data-testid="articleBody"] [contenteditable="true"]')
    || document.querySelector('[data-testid="articleBody"][contenteditable="true"]');
  if (!element) throw new Error('没有找到 X Articles 正文编辑器');
  return element;
}

function editorImages() {
  return editor().querySelectorAll('section img, figure img, [data-block="true"] img');
}

function pageCommand(payload, timeout = 5000) {
  const requestId = crypto.randomUUID();
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve({ ok: false, reason: '页面粘贴通道没有响应，请重新加载扩展后再试' });
    }, timeout);
    function onMessage(event) {
      if (event.source !== window || event.origin !== location.origin) return;
      const data = event.data;
      if (!data || data.source !== 'zhang-xmd-result' || data.requestId !== requestId) return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(data);
    }
    window.addEventListener('message', onMessage);
    window.postMessage({ source: 'zhang-xmd', requestId, ...payload }, location.origin);
  });
}

const extensionDisconnectedMessage = '插件已更新或失去连接，请刷新 X 页面后重新选择 Markdown';

async function extensionMessage(message) {
  const runtime = globalThis.chrome?.runtime;
  if (!runtime?.sendMessage) throw new Error(extensionDisconnectedMessage);
  try {
    return await runtime.sendMessage(message);
  } catch (error) {
    const detail = String(error?.message || error || '');
    if (/context invalidated|receiving end does not exist|message port closed|cannot read.*sendMessage/i.test(detail)) {
      throw new Error(extensionDisconnectedMessage);
    }
    throw new Error(`插件通信失败：${detail || '未知错误'}。请刷新 X 页面后重试`);
  }
}

function expectedText(html) {
  return clean(new DOMParser().parseFromString(html, 'text/html').body.textContent);
}

function textLanded(before, expected) {
  const actual = clean(editor().innerText);
  if (!expected) return actual.length > before.length;
  const head = expected.slice(0, Math.min(12, expected.length));
  const tail = expected.slice(-Math.min(18, expected.length));
  return actual.length > before.length && actual.includes(head) && actual.includes(tail);
}

async function waitLanded(before, expected, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (textLanded(before, expected)) {
      // X 会在图片上传后重建尾部段落；短暂出现不代表内容已经稳定保存。
      await pause(900);
      if (textLanded(before, expected)) return true;
    }
    await pause(80);
  }
  return false;
}

async function caretAtEnd() {
  try { window.focus(); } catch { /* 忽略焦点异常 */ }
  const element = editor();
  element.focus();
  const blocks = Array.from(element.querySelectorAll('[data-block="true"]')).filter(block => block.getAttribute('contenteditable') !== 'false');
  const last = blocks.at(-1);
  if (!last) throw new Error('正文末尾没有可编辑段落');
  const target = last.querySelector('.public-DraftStyleDefault-block') || last;
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
  element.dispatchEvent(new Event('select', { bubbles: true }));
  await pageCommand({ action: 'caret' }, 1200);
  await pause(80);
}

function findMenuItem(names) {
  const items = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"]')).filter(visible);
  const exact = items.find(element => names.includes(element.textContent.trim()) || names.includes(element.getAttribute('aria-label') || ''));
  if (exact) return exact;
  return items.find(element => {
    const label = `${element.getAttribute('aria-label') || ''} ${element.textContent || ''}`.replace(/\s+/g, ' ').trim().toLowerCase();
    return names.some(name => {
      const wanted = name.toLowerCase();
      return label === wanted || label.startsWith(`${wanted} `) || label.startsWith(`${wanted}，`);
    });
  });
}

async function openInsert(names, ready = null) {
  const attempts = ready ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (ready?.()) return;
    let item = findMenuItem(names);
    if (!item) {
      await caretAtEnd();
      const button = document.querySelector('button[aria-label="Add Media"], button[aria-label="添加媒体"]')
        || Array.from(document.querySelectorAll('button, [role="button"]')).find(element => {
          const label = (element.getAttribute('aria-label') || '').trim().toLowerCase();
          return visible(element) && !element.disabled && (label.includes('add media') || label.includes('添加媒体'));
        });
      if (!button) throw new Error('没有找到 X 的 Insert 菜单');
      button.click();
      item = await waitFor(() => findMenuItem(names), `没有找到 ${names[0]} 插入选项`);
    }
    item.click();
    if (!ready) return;
    try {
      await waitFor(ready, `${names[0]} 编辑窗口未出现`, 3500);
      return;
    } catch {
      // X 偶尔会吞掉菜单点击；内容还没写入，重新点击是安全的。
    }
  }
  throw new Error(`X 没有打开 ${names[0]} 编辑窗口，已重试 ${attempts} 次`);
}

function dialogWith(selector, excludedFields = new Set()) {
  return Array.from(document.querySelectorAll('[role="dialog"]'))
    .filter(visible)
    .reverse()
    .find(dialog => {
      const field = dialog.querySelector(selector);
      return visible(field) && !excludedFields.has(field);
    });
}

function assignFile(input, file) {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
  if (setter) setter.call(input, transfer.files);
  else input.files = transfer.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function settleMedia() {
  await waitFor(() => {
    const heading = document.querySelector('#detail-header')?.textContent || '';
    return !/Uploading|Processing|正在上传|正在处理|上传媒体|处理媒体/i.test(heading);
  }, 'X 的媒体处理超过 60 秒，请查看草稿中的上传状态', 60000);
}

export function copyRichViaExecCommand(html, text) {
  const htmlDoc = `<!DOCTYPE html><html><body><!--StartFragment-->${html}<!--EndFragment--></body></html>`;
  let written = false;
  const onCopy = event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.clipboardData) {
      event.clipboardData.setData('text/html', htmlDoc);
      event.clipboardData.setData('text/plain', text);
      try { event.clipboardData.setData('text', text); } catch {}
      written = true;
    }
  };

  const container = document.createElement('div');
  container.contentEditable = 'true';
  container.tabIndex = -1;
  container.setAttribute('aria-hidden', 'true');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '-9999px';
  container.style.width = '1px';
  container.style.height = '1px';
  container.style.opacity = '0';
  container.style.pointerEvents = 'none';
  container.innerHTML = htmlDoc;
  (document.body || document.documentElement).appendChild(container);

  const selection = window.getSelection();
  const previousRanges = [];
  if (selection) {
    for (let i = 0; i < selection.rangeCount; i++) {
      previousRanges.push(selection.getRangeAt(i));
    }
    selection.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(container);
    selection.addRange(range);
  }
  container.focus();

  document.addEventListener('copy', onCopy, { capture: true, once: true });
  try {
    const res = document.execCommand('copy');
    written = written || res;
  } catch {
    // 忽略 execCommand 异常
  } finally {
    document.removeEventListener('copy', onCopy, { capture: true });
    container.remove();
    if (selection) {
      selection.removeAllRanges();
      for (const r of previousRanges) {
        selection.addRange(r);
      }
    }
  }
  return written;
}

export function copyPlainTextViaExecCommand(text) {
  let written = false;
  const onCopy = event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.clipboardData) {
      event.clipboardData.setData('text/plain', text);
      try { event.clipboardData.setData('text', text); } catch {}
      written = true;
    }
  };

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.tabIndex = -1;
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '-9999px';
  textarea.style.width = '1px';
  textarea.style.height = '1px';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  (document.body || document.documentElement).appendChild(textarea);

  textarea.focus();
  textarea.select();

  document.addEventListener('copy', onCopy, { capture: true, once: true });
  try {
    const res = document.execCommand('copy');
    written = written || res;
  } catch {
    // 忽略异常
  } finally {
    document.removeEventListener('copy', onCopy, { capture: true });
    textarea.remove();
  }
  return written;
}

export async function writeRichClipboard(html, text) {
  const htmlDoc = `<!DOCTYPE html><html><body><!--StartFragment-->${html}<!--EndFragment--></body></html>`;

  // 1. 若当前窗口/文档具有焦点，优先尝试异步 Clipboard API
  if (typeof document !== 'undefined' && document.hasFocus() && navigator.clipboard?.write && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([htmlDoc], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' })
      })]);
      return true;
    } catch {
      // 捕获 Document is not focused 等异常，无缝降级到 execCommand
    }
  }

  // 2. 降级使用 execCommand('copy')，不受 document.hasFocus() 限制
  if (typeof document !== 'undefined' && copyRichViaExecCommand(html, text)) {
    return true;
  }

  // 3. 兜底再次尝试 Clipboard API
  if (navigator.clipboard?.write && window.ClipboardItem) {
    try { window.focus(); } catch {}
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([htmlDoc], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' })
    })]);
    return true;
  }

  throw new Error('写入剪贴板失败，请允许扩展访问剪贴板');
}

export async function writePlainTextClipboard(text) {
  if (typeof document !== 'undefined' && document.hasFocus() && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 降级
    }
  }

  if (typeof document !== 'undefined' && copyPlainTextViaExecCommand(text)) {
    return true;
  }

  if (navigator.clipboard?.writeText) {
    try { window.focus(); } catch {}
    await navigator.clipboard.writeText(text);
    return true;
  }

  throw new Error('写入剪贴板失败，请允许扩展访问剪贴板');
}

async function systemPaste(html, text) {
  try { window.focus(); } catch {}
  await caretAtEnd();
  editor().focus();
  await writeRichClipboard(html, text);
  await caretAtEnd();
  editor().focus();
  if (!document.execCommand('paste')) throw new Error('Chrome 没有执行扩展粘贴，请允许扩展读取剪贴板后重试');
}

async function insertHtml(step) {
  try { window.focus(); } catch {}
  await caretAtEnd();
  editor().focus();
  const before = clean(editor().innerText);
  const expected = clean(step.text) || expectedText(step.html);
  const viaPage = await pageCommand({ action: 'paste', html: step.html, text: step.text });
  if (await waitLanded(before, expected, viaPage?.ok ? 1600 : 400)) return;
  if (clean(editor().innerText).length > before.length) {
    if (await waitLanded(before, expected, 1200)) return;
    throw new Error('正文已变化，但和当前段落不一致，已停止以免重复粘贴');
  }
  let clipboardError = '';
  try {
    await systemPaste(step.html, step.text);
  } catch (error) {
    clipboardError = error.message;
  }
  if (await waitLanded(before, expected, 4000)) return;
  const detail = [viaPage?.reason, clipboardError].filter(Boolean).join('；');
  throw new Error(`X 没有接受富文本粘贴${detail ? `（${detail}）` : ''}，已保留当前草稿；可用面板中的分段复制继续`);
}

async function insertCode(step) {
  const before = editor().querySelectorAll('[data-testid="markdown-code-block"]').length;
  const existingFields = new Set(document.querySelectorAll('textarea[name="code-input"]'));
  const codeDialog = () => dialogWith('textarea[name="code-input"]', existingFields);
  await openInsert(['Code', '代码'], codeDialog);
  const dialog = codeDialog();
  const field = dialog.querySelector('textarea[name="code-input"]');
  await fillField(field, step.code);
  if (field.value !== step.code) throw new Error('代码内容没有写进输入框');
  const language = ({ shell: 'bash', sh: 'bash', js: 'javascript', ts: 'typescript', py: 'python' })[step.language.toLowerCase()] || step.language;
  const languageInput = dialog.querySelector('input[name="programming-language-input"]');
  if (languageInput && language) {
    await fillField(languageInput, language);
    try {
      const choice = await waitFor(() => Array.from(dialog.querySelectorAll('button')).find(button => button.textContent.trim().toLowerCase() === language.toLowerCase()), '此代码语言没有匹配项', 3000);
      choice.click();
    } catch {
      await fillField(languageInput, '');
    }
  }
  const insert = await waitFor(() => textButton(dialog, ['Insert', '插入']), '代码块插入按钮未就绪');
  insert.click();
  await waitFor(() => {
    const blocks = Array.from(editor().querySelectorAll('[data-testid="markdown-code-block"]'));
    return blocks.length > before && clean(blocks.at(-1).innerText).includes(clean(step.code));
  }, '代码块内容没有进入正文');
}

export function isOneByOneTableLabel(label) {
  const text = String(label || '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  if (/insert a 1 by 1 table/i.test(text)) return true;
  if (/1\s*行\s*1\s*列/.test(text) && !/1\s*行\s*1\s*列\d/.test(text) && !/\d1\s*行/.test(text)) return true;
  return /(?:^|[^0-9])1\s*(?:by|x|×|\*|乘)\s*1(?:\s*(?:的)?\s*(?:table|表格|列))?(?:\s|$)/i.test(text)
    && !/(?:^|[^0-9])1\s*(?:by|x|×|\*|乘)\s*1\d/i.test(text);
}

function tableControlLabel(element) {
  return `${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''}`;
}

function pointAt(element) {
  const rect = element.getBoundingClientRect();
  const init = { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  element.dispatchEvent(new MouseEvent('mouseover', init));
  element.dispatchEvent(new MouseEvent('mousemove', init));
}

function findSizeCell(root, { allowUnlabeledGrid = false } = {}) {
  if (!root?.querySelectorAll) return null;
  const nodes = Array.from(root.querySelectorAll('button, [role="button"], [role="gridcell"]'));
  const labeled = nodes.find(element => visible(element) && isOneByOneTableLabel(tableControlLabel(element)));
  if (labeled) return labeled;
  if (!allowUnlabeledGrid) return null;
  const grid = root.getAttribute?.('role') === 'grid' ? root : root.querySelector('[role="grid"]');
  const cell = grid && Array.from(grid.querySelectorAll('button, [role="button"], [role="gridcell"], td')).find(visible);
  if (cell) return cell;
  const squares = nodes.filter(element => {
    if (!visible(element)) return false;
    const rect = element.getBoundingClientRect();
    return rect.width >= 10 && rect.width <= 40 && rect.height >= 10 && rect.height <= 40 && Math.abs(rect.width - rect.height) < 8;
  });
  if (squares.length < 9) return null;
  const rows = new Set(squares.map(element => Math.round(element.getBoundingClientRect().top / 10))).size;
  if (rows < 3) return null;
  squares.sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return ra.top - rb.top || ra.left - rb.left;
  });
  return squares[0];
}

function findTableSurface(knownDialogs) {
  const fresh = [
    ...Array.from(document.querySelectorAll('[role="dialog"]')).filter(element => visible(element) && !knownDialogs.has(element)),
    ...Array.from(document.querySelectorAll('[role="menu"]')).filter(visible)
  ];
  for (const surface of fresh) {
    const cell = findSizeCell(surface, { allowUnlabeledGrid: true });
    if (cell) return { kind: 'cell', cell, root: surface };
    const field = Array.from(surface.querySelectorAll('textarea[name="markdown-input"]')).find(visible);
    if (field) return { kind: 'markdown', field, root: surface };
  }
  for (const dialog of Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible)) {
    const cell = findSizeCell(dialog, { allowUnlabeledGrid: false });
    if (cell) return { kind: 'cell', cell, root: dialog };
  }
  return null;
}

function editorBlocks() {
  return Array.from(editor().querySelectorAll('[data-block="true"]'));
}

function editableTailBlock() {
  return editorBlocks().filter(block => block.getAttribute('contenteditable') !== 'false').at(-1) || null;
}

function editorContentText() {
  return clean(editorBlocks()
    .filter(block => !block.querySelector('img'))
    .map(block => block.innerText || '')
    .join(''));
}

function isTableBlock(block) {
  if (!block) return false;
  if (block.querySelector('table, [role="table"], [role="grid"] td, td')) return true;
  return /table/i.test(`${block.getAttribute('data-testid') || ''} ${block.getAttribute('aria-label') || ''}`);
}

function tableSnapshot() {
  return {
    blocks: new Set(editorBlocks()),
    count: editorBlocks().filter(isTableBlock).length
  };
}

function locateNewTable(snapshot) {
  const blocks = editorBlocks();
  const fresh = blocks.find(block => !snapshot.blocks.has(block) && isTableBlock(block));
  if (fresh) return fresh;
  if (blocks.filter(isTableBlock).length > snapshot.count) return blocks.filter(isTableBlock).at(-1) || null;
  return null;
}

function dialogWithTableField() {
  return dialogWith('textarea[name="markdown-input"]');
}

export function markdownCells(markdown) {
  return String(markdown || '').split('\n')
    .map(line => line.trim())
    .filter(line => line.includes('|') && !/^[:|\-\s]+$/.test(line))
    .flatMap(line => line.split('|').map(clean).filter(Boolean));
}

function tableMatches(section, step) {
  const rows = Array.from(section?.querySelector('table')?.querySelectorAll('tr') || [])
    .map(row => Array.from(row.querySelectorAll('th, td')).map(cell => clean(cell.innerText)));
  const expected = step.rows || [];
  return expected.length > 0 && rows.length === expected.length
    && rows.every((row, index) => row.length === expected[index].length
      && row.every((cell, column) => cell === clean(expected[index][column])));
}

async function fillField(field, value) {
  document.querySelectorAll('[data-zhang-xmd-target]').forEach(node => node.removeAttribute('data-zhang-xmd-target'));
  field.setAttribute('data-zhang-xmd-target', '1');
  try {
    await pageCommand({ action: 'fill', value }, 2000);
  } finally {
    field.removeAttribute('data-zhang-xmd-target');
  }
  if (field.value !== value) setValue(field, value);
}

async function pressTableButton(root) {
  const names = ['Update', '更新', 'Insert', '插入', 'Save', '保存', 'Add', '添加'];
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    const button = textButton(root, names);
    if (button) {
      button.click();
      return true;
    }
    await pause(80);
  }
  return false;
}

async function fillTableDialog(root, field, markdown) {
  await fillField(field, markdown);
  if (field.value !== markdown) throw new Error('表格内容没有写进编辑框');
  await pause(120);
  if (!await pressTableButton(root)) throw new Error('表格插入按钮未就绪');
}

async function insertTable(step) {
  const snapshot = tableSnapshot();
  const knownDialogs = new Set(document.querySelectorAll('[role="dialog"]'));
  const tableSurface = () => findTableSurface(knownDialogs);
  await openInsert(['Table', '表格'], tableSurface);
  const surface = tableSurface();
  if (surface.kind === 'markdown') {
    await fillTableDialog(surface.root, surface.field, step.markdown);
  } else {
    surface.cell.click();
  }
  const section = await waitFor(() => locateNewTable(snapshot), '表格没有进入正文', 12000);
  if (tableMatches(section, step)) return;
  pointAt(section);
  await pause(120);
  const edit = section.querySelector('button[aria-label="Edit block"], button[aria-label="编辑区块"], [role="button"][aria-label="Edit block"], [role="button"][aria-label="编辑区块"]')
    || Array.from(section.querySelectorAll('button, [role="button"]')).find(element => /edit block|编辑区块|^edit$|^编辑$/i.test((element.getAttribute('aria-label') || '').trim()));
  if (!edit) throw new Error('没有找到表格编辑按钮');
  edit.click();
  const editDialog = await waitFor(() => dialogWithTableField(), '没有找到 Markdown 表格输入框');
  await fillTableDialog(editDialog, editDialog.querySelector('textarea[name="markdown-input"]'), step.markdown);
  await waitFor(() => !document.contains(editDialog), '表格编辑弹窗没有关闭');
  await waitFor(() => tableMatches(section, step), '表格内容未完整保存');
}

async function insertImage(file) {
  const before = editorImages().length;
  const existingFields = new Set(document.querySelectorAll('[role="dialog"] input[type="file"]'));
  const mediaDialog = () => dialogWith('input[type="file"]', existingFields);
  await openInsert(['Media', '媒体'], mediaDialog);
  const dialog = mediaDialog();
  const input = dialog.querySelector('input[type="file"]');
  assignFile(input, file);
  await waitFor(() => editorImages().length > before, '正文图片没有完成上传', 60000);
  await settleMedia();
  let tail = await waitFor(() => editableTailBlock(), '图片后没有出现可继续写入的正文位置');
  await pause(1000);
  if (!document.contains(tail) || editableTailBlock() !== tail) {
    tail = await waitFor(() => editableTailBlock(), '图片后的正文位置尚未稳定');
    await pause(1000);
    if (!document.contains(tail) || editableTailBlock() !== tail) throw new Error('图片后的正文位置持续变化，请稍后重试');
  }
}

async function insertCover(file) {
  const input = document.querySelector('input[type="file"][data-testid="fileInput"]');
  if (!input) throw new Error('没有找到文章封面上传入口');
  assignFile(input, file);
  const apply = await waitFor(() => Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible)
    .map(dialog => ({ dialog, button: textButton(dialog, ['Apply', '应用', 'Done', '完成', 'Save', '保存']) }))
    .find(item => item.button), '封面裁剪按钮未就绪', 30000);
  apply.button.click();
  await waitFor(() => !document.contains(apply.dialog), '封面裁剪弹窗没有关闭');
  await settleMedia();
}

export async function fetchImageFile(src, localFiles = []) {
  if (/^https?:\/\//i.test(src)) {
    const filename = decodeURIComponent(new URL(src).pathname.split('/').pop());
    const matches = localFiles.filter(file => file.name === filename);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error(`本地图片重名，请保留唯一文件：${filename}`);
  }
  if (!/^https?:\/\//i.test(src)) {
    const name = decodeURIComponent(src).replace(/\\/g, '/').replace(/^\.\//, '');
    const matches = localFiles.filter(file => file.webkitRelativePath === name || file.webkitRelativePath?.endsWith('/' + name) || file.name === name.split('/').pop());
    if (matches.length !== 1) throw new Error(matches.length ? `本地图片重名，请保留唯一文件：${name}` : `缺少本地图片：${name}，请用「选择本地图片」添加`);
    return matches[0];
  }
  const response = await extensionMessage({ type: 'xmd:fetch-image', url: src });
  if (!response?.ok) throw new Error(response?.error || '图片下载失败');
  const bytes = Uint8Array.from(atob(response.base64), char => char.charCodeAt(0));
  return new File([bytes], response.filename, { type: response.type });
}

export function validateImageFile(file, { cover = false } = {}) {
  const type = file.type || ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' })[file.name.split('.').pop().toLowerCase()];
  const allowed = cover ? ['image/png', 'image/jpeg', 'image/webp'] : ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  if (!allowed.includes(type)) throw new Error(`${file.name} 格式不受 X ${cover ? '封面' : '正文图片'}支持，请使用 ${cover ? 'PNG、JPEG 或 WebP' : 'PNG、JPEG、WebP 或 GIF'}`);
  if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} 超过 20 MB，请压缩后重试`);
  return file;
}

function titleField() {
  return document.querySelector('textarea[name="Article Title"]');
}

function bodyIsEmpty() {
  try { return !clean(editor().innerText); } catch { return false; }
}

async function ensureDraft() {
  const onEdit = /\/compose\/articles\/edit\/\d+/.test(location.pathname);
  if (onEdit && titleField() && bodyIsEmpty()) return;
  const create = document.querySelector('button[aria-label="create"], button[aria-label="Create"], button[aria-label="创建"]');
  if (!create) throw new Error('请先回到 X Articles 列表，或打开一篇空白草稿，再导入');
  const oldPath = location.pathname;
  create.click();
  await waitFor(() => {
    const field = titleField();
    if (!field || location.pathname === oldPath || !/\/compose\/articles\/edit\/\d+/.test(location.pathname)) return null;
    if (field.value !== '') return null;
    try {
      if (clean(editor().innerText)) return null;
    } catch { return null; }
    return true;
  }, '空白新草稿未出现，已停止导入以免覆盖现有内容');
}

export async function importArticle(bundle, { onProgress = () => {}, localFiles = [], signal } = {}) {
  const ensureActive = () => { if (signal?.aborted) throw new Error('导入已停止，当前草稿已保留'); };
  ensureActive();
  const connection = await extensionMessage({ type: 'xmd:ping' });
  if (!connection?.ok) throw new Error(extensionDisconnectedMessage);
  onProgress('正在准备文章图片…');
  const sources = [...new Set([bundle.cover?.src, ...bundle.images.map(image => image.src)].filter(Boolean))];
  const files = new Map();
  for (const src of sources) { ensureActive(); files.set(src, await fetchImageFile(src, localFiles)); }
  for (const [src, file] of files) validateImageFile(file, { cover: bundle.cover?.src === src });

  ensureActive();
  onProgress('正在新建 X Article 草稿…');
  await ensureDraft();
  const field = titleField();
  if (!field) throw new Error('没有找到 X Articles 标题框');
  setValue(field, bundle.title);
  if (bundle.cover) {
    ensureActive();
    onProgress('正在上传封面…');
    await insertCover(files.get(bundle.cover.src));
  }

  for (let index = 0; index < bundle.segments.length; index++) {
    ensureActive();
    const step = bundle.segments[index];
    const label = { html: '正文', image: '图片', code: '代码块', table: '表格' }[step.type];
    onProgress(`正在导入 ${index + 1}/${bundle.segments.length}：${label}`);
    try {
      if (step.type === 'html') await insertHtml(step);
      else if (step.type === 'code') await insertCode(step);
      else if (step.type === 'table') await insertTable(step);
      else if (step.type === 'image') await insertImage(files.get(step.src));
    } catch (error) {
      throw new Error(`第 ${index + 1}/${bundle.segments.length} 步（${label}）失败：${error.message}。当前草稿已保留`);
    }
    await pause(200);
  }
  await waitFor(() => !/Saving|正在保存|保存中/i.test(document.querySelector('#detail-header')?.textContent || ''), 'X 尚未确认保存，请稍后查看草稿', 30000);
  const codeCount = editor().querySelectorAll('[data-testid="markdown-code-block"]').length;
  const tableCount = editor().querySelectorAll('section table').length;
  const imageCount = editorImages().length;
  if (codeCount !== bundle.statistics.code || tableCount !== bundle.statistics.tables || imageCount < bundle.statistics.images) throw new Error('导入后数量核对不一致，请检查草稿中的图片、代码或表格');
  const missingTextStep = firstMissingContentStep(bundle, editorContentText());
  if (missingTextStep >= 0) throw new Error(`导入后发现第 ${missingTextStep + 1}/${bundle.segments.length} 步正文缺失，已保留草稿，请不要直接发布`);
  return { url: location.href, codeCount, tableCount, imageCount };
}
