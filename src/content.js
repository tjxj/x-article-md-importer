import { convertMarkdown, inlineRichHtml } from './core.js';
import { importArticle, writeRichClipboard, writePlainTextClipboard } from './x-adapter.js';

if (!document.getElementById('zhang-xmd-launcher')) {
  const launcher = document.createElement('button');
  launcher.id = 'zhang-xmd-launcher';
  launcher.type = 'button';
  launcher.textContent = '导入 MD';
  launcher.title = '将 Markdown 准备成 X Articles 富文本';
  document.body.appendChild(launcher);

  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.md,.markdown,text/markdown,text/plain';
  picker.hidden = true;
  document.body.appendChild(picker);
  const imagePicker = document.createElement('input');
  imagePicker.type = 'file';
  imagePicker.accept = 'image/*';
  imagePicker.multiple = true;
  imagePicker.hidden = true;
  document.body.appendChild(imagePicker);

  let bundle = null;
  let activeStep = 0;
  let panel = null;
  let localFiles = [];
  let importController = null;
  let importing = false;
  let lastPath = '';
  function updateVisibility() {
    if (lastPath === location.pathname) return;
    lastPath = location.pathname;
    launcher.hidden = !lastPath.startsWith('/compose/articles');
  }
  updateVisibility();
  new MutationObserver(updateVisibility).observe(document.body, { childList: true, subtree: true });

  function setStatus(message, isError = false) {
    const status = panel?.querySelector('.zhang-xmd-status');
    if (status) {
      status.textContent = message;
      status.classList.toggle('error', isError);
    }
  }

  async function copyContent(html, plain) {
    await writeRichClipboard(html, plain);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function stepLabel(step) {
    if (step.type === 'html') return '正文富文本';
    if (step.type === 'image') return `正文图片 ${step.number}`;
    if (step.type === 'code') return `代码块 ${step.language || '文本'}`;
    return '原生表格';
  }

  function stepHint(step) {
    if (step.type === 'html') return '点击复制，切到正文光标处按 ⌘V';
    if (step.type === 'image') return '打开原图并保存，然后在 X 的「Insert → Media」上传';
    if (step.type === 'code') return '在 X 的「Insert → Code」新建代码块，再粘贴代码';
    return '在 X 的「Insert → Table」建表，点编辑图标，将 Markdown 粘入';
  }

  function createPanel() {
    panel?.remove();
    panel = document.createElement('aside');
    panel.id = 'zhang-xmd-panel';
    panel.innerHTML = `
      <header class="zhang-xmd-header">
        <div><strong>Markdown → X Articles</strong><small>选择文章，自动生成 X 草稿</small></div>
        <button type="button" data-action="close" aria-label="关闭">×</button>
      </header>
      <div class="zhang-xmd-body">
        <label>标题</label><div class="zhang-xmd-title">${escapeHtml(bundle.title)}</div>
        <button type="button" class="zhang-xmd-import" data-action="import">新建并自动导入草稿</button>
        <div class="zhang-xmd-actions"><button type="button" data-action="local">选择本地图片</button><button type="button" data-action="preview">预览草稿</button><button type="button" data-action="stop" hidden>停止</button></div>
        <p class="zhang-xmd-note">自动填入标题、封面、正文图片、原生代码和表格。支持老章 R2 图床及手动选择的本地图片。完成后在 X 预览并发布。</p>
        <div class="zhang-xmd-cover"><b>封面</b> <a href="${escapeHtml(bundle.cover?.src || '#')}" target="_blank" rel="noopener noreferrer">${bundle.cover ? '打开原图' : '文章无封面图'}</a><small>保存后用 X 顶部封面上传入口添加</small></div>
        <div class="zhang-xmd-count">${bundle.segments.length} 步 · ${bundle.statistics.images} 张正文图 · ${bundle.statistics.code} 个代码块 · ${bundle.statistics.tables} 张表格</div>
        <details><summary>分段复制与手动续传</summary><div class="zhang-xmd-actions"><button type="button" data-action="title">复制标题</button><button type="button" data-action="all">复制全文富文本</button></div><p class="zhang-xmd-note">全文模式用占位符标出图片、代码和表格，需逐一补入</p><ol class="zhang-xmd-steps"></ol></details>
        <div class="zhang-xmd-status" role="status">请选择导入方式</div>
      </div>`;
    document.body.appendChild(panel);
    const list = panel.querySelector('.zhang-xmd-steps');
    bundle.segments.forEach((step, index) => {
      const item = document.createElement('li');
      item.dataset.index = String(index);
      item.innerHTML = `<div class="zhang-xmd-step-top"><b>${index + 1}. ${escapeHtml(stepLabel(step))}</b><button type="button" data-action="step" data-index="${index}">${step.type === 'image' ? '打开原图' : '复制'}</button></div><small>${escapeHtml(stepHint(step))}</small>`;
      list.appendChild(item);
    });
    markActive();
    panel.addEventListener('click', onPanelClick);
  }

  function markActive() {
    panel?.querySelectorAll('.zhang-xmd-steps li').forEach((item, index) => item.classList.toggle('active', index === activeStep));
  }

  async function onPanelClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button || !bundle) return;
    const action = button.dataset.action;
    if (action === 'close') { if (importing) { setStatus('导入进行中，请先点「停止」'); return; } panel.remove(); panel = null; return; }
    if (action === 'stop') { importController?.abort(); setStatus('将在当前步骤完成后停止，草稿会保留'); return; }
    if (importing) return;
    try {
      if (action === 'import') {
        importing = true;
        importController = new AbortController();
        panel.querySelector('[data-action="import"]').disabled = true;
        panel.querySelector('[data-action="stop"]').hidden = false;
        try {
          const result = await importArticle(bundle, { localFiles, signal: importController.signal, onProgress: message => setStatus(message) });
          setStatus(`草稿已导入：${result.imageCount} 张正文图、${result.codeCount} 个代码块、${result.tableCount} 张表格。请预览确认`);
        } finally {
          importing = false;
          panel.querySelector('[data-action="import"]').disabled = false;
          panel.querySelector('[data-action="stop"]').hidden = true;
        }
      } else if (action === 'local') {
        imagePicker.click();
      } else if (action === 'preview') {
        const link = document.querySelector('a[href$="/preview"]');
        if (!link) throw new Error('请先打开一个 X Article 草稿');
        link.click();
      } else if (action === 'title') {
        await writePlainTextClipboard(bundle.title);
        setStatus('标题已复制，粘贴到 X 的标题框');
      } else if (action === 'all') {
        const html = inlineRichHtml(bundle);
        await copyContent(html, bundle.segments.map(segment => segment.text || segment.code || segment.markdown || segment.alt || '').join('\n\n'));
        setStatus('全文富文本已复制，点 X 的正文编辑区后按 ⌘V');
      } else if (action === 'step') {
        const index = Number(button.dataset.index);
        const step = bundle.segments[index];
        if (step.type === 'image') {
          window.open(step.src, '_blank', 'noopener,noreferrer');
          setStatus(`图片 ${step.number} 已打开，请保存后用 X「Insert → Media」上传`);
        } else if (step.type === 'html') {
          await copyContent(step.html, step.text);
          setStatus(`第 ${index + 1} 段富文本已复制，回到正文按 ⌘V`);
        } else {
          await writePlainTextClipboard(step.type === 'code' ? step.code : step.markdown);
          setStatus(`第 ${index + 1} 步已复制，请使用 X 的原生${step.type === 'code' ? '代码块' : '表格'}入口`);
        }
        activeStep = Math.min(index + 1, bundle.segments.length - 1);
        markActive();
      }
    } catch (error) {
      setStatus(`操作失败：${error.message}`, true);
    }
  }

  launcher.addEventListener('click', () => picker.click());
  imagePicker.addEventListener('change', () => {
    localFiles = Array.from(imagePicker.files || []);
    setStatus(`已选择 ${localFiles.length} 张本地图片`);
  });
  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    if (!file) return;
    try {
      bundle = convertMarkdown(await file.text(), file.name);
      activeStep = 0;
      createPanel();
      setStatus('文章已就绪，点击「新建并自动导入草稿」开始');
    } catch (error) {
      alert(`Markdown 解析失败：${error.message}`);
    } finally {
      picker.value = '';
    }
  });
}
