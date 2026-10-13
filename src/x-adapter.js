const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = text => String(text || '').replace(/[\s\u200b\ufeff]+/g, '');
const visible = element => element && element.getClientRects().length > 0;

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
      await pause(220);
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
  const items = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"]'));
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

async function openInsert(names) {
  await caretAtEnd();
  const button = document.querySelector('button[aria-label="Add Media"], button[aria-label="添加媒体"]')
    || Array.from(document.querySelectorAll('button, [role="button"]')).find(element => {
      const label = (element.getAttribute('aria-label') || '').trim().toLowerCase();
      return visible(element) && !element.disabled && (label.includes('add media') || label.includes('添加媒体'));
    });
  if (!button) throw new Error('没有找到 X 的 Insert 菜单');
  button.click();
  const item = await waitFor(() => findMenuItem(names), `没有找到 ${names[0]} 插入选项`);
  item.click();
}

async function modal() {
  return waitFor(() => Array.from(document.querySelectorAll('[role="dialog"]')).find(visible), 'X 插入弹窗没有出现');
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
  await openInsert(['Code', '代码']);
  const dialog = await modal();
  const field = await waitFor(() => dialog.querySelector('textarea[name="code-input"]'), '没有找到代码输入框');
  setValue(field, step.code);
  const language = ({ shell: 'bash', sh: 'bash', js: 'javascript', ts: 'typescript', py: 'python' })[step.language.toLowerCase()] || step.language;
  const languageInput = dialog.querySelector('input[name="programming-language-input"]');
  if (languageInput && language) {
    setValue(languageInput, language);
    try {
      const choice = await waitFor(() => Array.from(dialog.querySelectorAll('button')).find(button => button.textContent.trim().toLowerCase() === language.toLowerCase()), '此代码语言没有匹配项', 3000);
      choice.click();
    } catch {
      setValue(languageInput, '');
    }
  }
  const insert = await waitFor(() => textButton(dialog, ['Insert', '插入']), '代码块插入按钮未就绪');
  insert.click();
  await waitFor(() => editor().querySelectorAll('[data-testid="markdown-code-block"]').length > before, '代码块没有进入正文');
}

async function insertTable(step) {
  const before = new Set(Array.from(editor().querySelectorAll('section[data-block="true"]')).map(section => section.getAttribute('data-offset-key')));
  await openInsert(['Table', '表格']);
  const dialog = await modal();
  const picker = dialog.querySelector('button[aria-label="Insert a 1 by 1 table"]') || Array.from(dialog.querySelectorAll('button')).find(button => /1.*1.*(?:table|表格)/i.test(button.getAttribute('aria-label') || ''));
  if (!picker) throw new Error('没有找到 X 表格尺寸选择器');
  picker.click();
  const section = await waitFor(() => Array.from(editor().querySelectorAll('section[data-block="true"]')).find(item => !before.has(item.getAttribute('data-offset-key')) && item.querySelector('table')), '表格没有进入正文');
  const sectionKey = section.getAttribute('data-offset-key');
  const edit = section.querySelector('button[aria-label="Edit block"],button[aria-label="编辑区块"]');
  if (!edit) throw new Error('没有找到表格编辑按钮');
  edit.click();
  const editDialog = await modal();
  const field = await waitFor(() => editDialog.querySelector('textarea'), '没有找到 Markdown 表格输入框');
  setValue(field, step.markdown);
  const update = await waitFor(() => textButton(editDialog, ['Update', '更新']), '表格更新按钮未就绪');
  update.click();
  await waitFor(() => !document.contains(editDialog), '表格编辑弹窗没有关闭');
  await waitFor(() => {
    const updated = Array.from(editor().querySelectorAll('section[data-block="true"]')).find(item => item.getAttribute('data-offset-key') === sectionKey);
    return updated && clean(updated.textContent).length > 0;
  }, '表格内容未保存');
}

async function insertImage(file) {
  const before = editorImages().length;
  await openInsert(['Media', '媒体']);
  const dialog = await modal();
  const input = await waitFor(() => dialog.querySelector('input[type="file"]'), '没有找到正文图片上传入口');
  assignFile(input, file);
  await waitFor(() => editorImages().length > before, '正文图片没有完成上传', 60000);
  await settleMedia();
}

async function insertCover(file) {
  const input = document.querySelector('input[type="file"][data-testid="fileInput"]');
  if (!input) throw new Error('没有找到文章封面上传入口');
  assignFile(input, file);
  const dialog = await modal();
  const apply = await waitFor(() => textButton(dialog, ['Apply', '应用', 'Done', '完成', 'Save', '保存']), '封面裁剪按钮未就绪', 30000);
  apply.click();
  await waitFor(() => !document.contains(dialog), '封面裁剪弹窗没有关闭');
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
  const response = await chrome.runtime.sendMessage({ type: 'xmd:fetch-image', url: src });
  if (!response?.ok) throw new Error(response?.error || '图片下载失败');
  const bytes = Uint8Array.from(atob(response.base64), char => char.charCodeAt(0));
  return new File([bytes], response.filename, { type: response.type });
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
  onProgress('正在准备文章图片…');
  const sources = [...new Set([bundle.cover?.src, ...bundle.images.map(image => image.src)].filter(Boolean))];
  const files = new Map();
  for (const src of sources) { ensureActive(); files.set(src, await fetchImageFile(src, localFiles)); }

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
    if (step.type === 'html') await insertHtml(step);
    else if (step.type === 'code') await insertCode(step);
    else if (step.type === 'table') await insertTable(step);
    else if (step.type === 'image') await insertImage(files.get(step.src));
    await pause(200);
  }
  await waitFor(() => !/Saving|正在保存|保存中/i.test(document.querySelector('#detail-header')?.textContent || ''), 'X 尚未确认保存，请稍后查看草稿', 30000);
  const codeCount = editor().querySelectorAll('[data-testid="markdown-code-block"]').length;
  const tableCount = editor().querySelectorAll('section table').length;
  const imageCount = editorImages().length;
  if (codeCount !== bundle.statistics.code || tableCount !== bundle.statistics.tables || imageCount < bundle.statistics.images) throw new Error('导入后数量核对不一致，请检查草稿中的图片、代码或表格');
  return { url: location.href, codeCount, tableCount, imageCount };
}
