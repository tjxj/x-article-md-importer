const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = text => String(text || '').replace(/\s+/g, '');
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
  return Array.from(root.querySelectorAll('button, [role="button"]')).find(element => visible(element) && names.includes(element.textContent.trim()) && !element.disabled);
}

function setValue(element, value) {
  const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function editor() {
  const element = document.querySelector('[data-testid="composer"][contenteditable="true"]');
  if (!element) throw new Error('没有找到 X Articles 正文编辑器');
  return element;
}

async function caretAtEnd() {
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
  await pause(100);
}

async function openInsert(names) {
  await caretAtEnd();
  const button = document.querySelector('button[aria-label="Add Media"], button[aria-label="添加媒体"]');
  if (!button) throw new Error('没有找到 X 的 Insert 菜单');
  button.click();
  const item = await waitFor(() => Array.from(document.querySelectorAll('[role="menuitem"]')).find(element => names.includes(element.textContent.trim())), `没有找到 ${names[0]} 插入选项`);
  item.click();
}

async function modal() {
  return waitFor(() => Array.from(document.querySelectorAll('[role="dialog"]')).find(visible), 'X 插入弹窗没有出现');
}

function assignFile(input, file) {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function settleMedia() {
  await waitFor(() => {
    const heading = document.querySelector('#detail-header')?.textContent || '';
    return !/Uploading|Processing|正在上传|正在处理|上传媒体|处理媒体/i.test(heading);
  }, 'X 的媒体处理超过 60 秒，请查看草稿中的上传状态', 60000);
}

async function insertHtml(step) {
  await caretAtEnd();
  const element = editor();
  const before = clean(element.textContent);
  const data = new DataTransfer();
  data.setData('text/html', step.html);
  data.setData('text/plain', step.text);
  element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  const parsed = new DOMParser().parseFromString(step.html, 'text/html');
  const expected = clean(parsed.body.textContent);
  await waitFor(() => {
    const actual = clean(editor().textContent);
    return actual.length > before.length && actual.includes(expected.slice(-Math.min(48, expected.length)));
  }, 'X 没有接受富文本粘贴，已保留当前草稿；可用面板中的分段复制继续', 5000);
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
  const before = editor().querySelectorAll('section img').length;
  await openInsert(['Media', '媒体']);
  const dialog = await modal();
  const input = await waitFor(() => dialog.querySelector('input[type="file"]'), '没有找到正文图片上传入口');
  assignFile(input, file);
  await waitFor(() => editor().querySelectorAll('section img').length > before, '正文图片没有完成上传', 60000);
  await settleMedia();
}

async function insertCover(file) {
  const input = document.querySelector('input[type="file"][data-testid="fileInput"]');
  if (!input) throw new Error('没有找到文章封面上传入口');
  assignFile(input, file);
  const dialog = await modal();
  const apply = await waitFor(() => textButton(dialog, ['Apply', '应用']), '封面裁剪按钮未就绪', 30000);
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

export async function importArticle(bundle, { onProgress = () => {}, localFiles = [], signal } = {}) {
  const ensureActive = () => { if (signal?.aborted) throw new Error('导入已停止，当前草稿已保留'); };
  ensureActive();
  onProgress('正在准备文章图片…');
  const sources = [...new Set([bundle.cover?.src, ...bundle.images.map(image => image.src)].filter(Boolean))];
  const files = new Map();
  for (const src of sources) { ensureActive(); files.set(src, await fetchImageFile(src, localFiles)); }

  ensureActive();
  onProgress('正在新建 X Article 草稿…');
  const oldPath = location.pathname;
  const create = document.querySelector('button[aria-label="create"]');
  if (!create) throw new Error('请先回到 X Articles 列表或普通编辑模式，再导入');
  create.click();
  await waitFor(() => {
    const titleField = document.querySelector('textarea[name="Article Title"]');
    const bodyField = document.querySelector('[data-testid="composer"]');
    return location.pathname !== oldPath && /\/compose\/articles\/edit\/\d+/.test(location.pathname) && titleField && titleField.value === '' && bodyField && !clean(bodyField.textContent);
  }, '空白新草稿未出现，已停止导入以免覆盖现有内容');
  setValue(document.querySelector('textarea[name="Article Title"]'), bundle.title);
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
  const imageCount = editor().querySelectorAll('section img').length;
  if (codeCount !== bundle.statistics.code || tableCount !== bundle.statistics.tables || imageCount < bundle.statistics.images) throw new Error('导入后数量核对不一致，请检查草稿中的图片、代码或表格');
  return { url: location.href, codeCount, tableCount, imageCount };
}
