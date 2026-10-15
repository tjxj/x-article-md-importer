if (!window.__zhangXmdBridge) {
  window.__zhangXmdBridge = true;

  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const compact = text => String(text || '').replace(/[\s\u200b\ufeff]+/g, '');

  function findEditor() {
    return document.querySelector('[data-testid="composer"][contenteditable="true"]')
      || document.querySelector('[data-testid="articleBody"] [contenteditable="true"]')
      || document.querySelector('[data-testid="articleBody"][contenteditable="true"]');
  }

  function editorText() {
    return compact(findEditor()?.innerText || '');
  }

  function moveCaretToEnd() {
    const element = findEditor();
    if (!element) return false;
    element.focus();
    const blocks = Array.from(element.querySelectorAll('[data-block="true"]')).filter(block => block.getAttribute('contenteditable') !== 'false');
    const target = blocks.at(-1)?.querySelector('.public-DraftStyleDefault-block') || blocks.at(-1) || element;
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
    return true;
  }

  function clipboardHtml(fragment) {
    return `<!DOCTYPE html><html><body><!--StartFragment-->${fragment}<!--EndFragment--></body></html>`;
  }

  function richTransfer(html, text) {
    const data = new DataTransfer();
    const fullHtml = clipboardHtml(html);
    data.setData('text/html', fullHtml);
    data.setData('text/plain', text);
    try { data.setData('text', text); } catch { /* 部分浏览器只接受标准 MIME */ }
    try { data.setData('Text', text); } catch { /* 兼容部分旧库 */ }
    try {
      Object.defineProperty(data, 'text/html', { value: fullHtml, configurable: true });
      Object.defineProperty(data, 'text/plain', { value: text, configurable: true });
    } catch { /* 忽略环境只读限制 */ }
    return data;
  }

  function landed(before, expected) {
    const actual = editorText();
    if (!expected) return actual.length > before.length;
    const head = expected.slice(0, Math.min(12, expected.length));
    const tail = expected.slice(-Math.min(18, expected.length));
    return actual.length > before.length && actual.includes(head) && actual.includes(tail);
  }

  async function waitLanded(before, expected, timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (landed(before, expected)) {
        await pause(220);
        if (landed(before, expected)) return true;
      }
      await pause(60);
    }
    return false;
  }

  function fiberOf(node) {
    const key = Object.keys(node).find(name => name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$'));
    return key ? node[key] : null;
  }

  function findPasteHandler(element) {
    let fiber = fiberOf(element);
    const seen = new Set();
    // 优先查找 DraftEditor 等组件实例本身的 _onPaste 方法
    while (fiber && !seen.has(fiber)) {
      seen.add(fiber);
      const instance = fiber.stateNode;
      if (instance && instance !== element && typeof instance._onPaste === 'function') {
        return { fn: instance._onPaste.bind(instance), instance };
      }
      fiber = fiber.return;
    }
    // 其次查找 props.onPaste
    fiber = fiberOf(element);
    seen.clear();
    while (fiber && !seen.has(fiber)) {
      seen.add(fiber);
      if (typeof fiber.memoizedProps?.onPaste === 'function') {
        return { fn: fiber.memoizedProps.onPaste, instance: null };
      }
      fiber = fiber.return;
    }
    const propsKey = Object.keys(element).find(name => name.startsWith('__reactProps$'));
    if (propsKey && typeof element[propsKey].onPaste === 'function') {
      return { fn: element[propsKey].onPaste, instance: null };
    }
    return null;
  }

  function fakePasteEvent(element, data) {
    return {
      type: 'paste',
      bubbles: true,
      cancelable: true,
      defaultPrevented: false,
      isTrusted: true,
      clipboardData: data,
      dataTransfer: data,
      target: element,
      currentTarget: element,
      timeStamp: Date.now(),
      nativeEvent: { isTrusted: true, clipboardData: data, dataTransfer: data, preventDefault() {}, stopPropagation() {} },
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {},
      persist() {}
    };
  }

  function dispatchPaste(element, data) {
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data });
    if (!event.clipboardData) {
      try { Object.defineProperty(event, 'clipboardData', { configurable: true, value: data }); } catch { /* 浏览器不允许覆盖时走 React 处理函数 */ }
    }
    element.dispatchEvent(event);
  }

  async function pasteRich(html, text) {
    const element = findEditor();
    if (!element) return { ok: false, reason: '没有找到正文编辑器' };
    try { window.focus(); } catch { /* 忽略焦点异常 */ }
    element.focus();
    moveCaretToEnd();
    const before = editorText();
    const expected = compact(text);
    const data = richTransfer(html, text);
    dispatchPaste(element, data);
    if (await waitLanded(before, expected, 1200)) return { ok: true, via: 'event' };
    if (editorText().length > before.length) {
      if (await waitLanded(before, expected, 800)) return { ok: true, via: 'event' };
      return { ok: false, reason: '正文已变化，但和当前段落不一致' };
    }

    const handler = findPasteHandler(element);
    if (!handler) return { ok: false, reason: '编辑器没有暴露粘贴处理函数' };
    element.focus();
    moveCaretToEnd();
    if (handler.instance && typeof handler.instance.focus === 'function') {
      try { handler.instance.focus(); } catch { /* 忽略内部 focus 报错 */ }
    }
    try {
      handler.fn(fakePasteEvent(element, data));
    } catch (error) {
      return { ok: false, reason: `编辑器拒绝了富文本：${error.message}` };
    }
    if (await waitLanded(before, expected, 1200)) return { ok: true, via: 'react' };
    return { ok: false, reason: '编辑器未写入这段正文' };
  }

  function findReactHandler(element, names) {
    const fromProps = props => {
      if (!props) return null;
      for (const name of names) if (typeof props[name] === 'function') return props[name];
      return null;
    };
    let fiber = fiberOf(element);
    const seen = new Set();
    let depth = 0;
    while (fiber && !seen.has(fiber) && depth < 8) {
      seen.add(fiber);
      const found = fromProps(fiber.memoizedProps);
      if (found) return found;
      fiber = fiber.return;
      depth += 1;
    }
    const propsKey = Object.keys(element).find(name => name.startsWith('__reactProps$'));
    return propsKey ? fromProps(element[propsKey]) : null;
  }

  function fillTarget(value) {
    const element = document.querySelector('[data-zhang-xmd-target="1"]');
    if (!element) return { ok: false, reason: '没有找到表格输入框' };
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
    if (element._valueTracker) element._valueTracker.setValue('');
    element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    const handler = findReactHandler(element, ['onChange', 'onInput']);
    if (handler) {
      try {
        handler({ target: element, currentTarget: element, preventDefault() {}, stopPropagation() {}, nativeEvent: { target: element } });
      } catch (error) {
        return { ok: false, reason: error.message };
      }
    }
    return { ok: element.value === value };
  }

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== 'zhang-xmd' || !data.requestId) return;
    const reply = payload => window.postMessage({ source: 'zhang-xmd-result', requestId: data.requestId, ...payload }, location.origin);
    if (data.action === 'caret') {
      reply({ ok: moveCaretToEnd() });
      return;
    }
    if (data.action === 'fill') {
      reply(fillTarget(String(data.value || '')));
      return;
    }
    if (data.action === 'paste') {
      pasteRich(String(data.html || ''), String(data.text || '')).then(reply, error => reply({ ok: false, reason: error.message }));
    }
  });
}
