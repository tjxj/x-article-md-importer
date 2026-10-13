import test from 'node:test';
import assert from 'node:assert/strict';
import { copyRichViaExecCommand, copyPlainTextViaExecCommand, writeRichClipboard, writePlainTextClipboard } from '../src/x-adapter.js';

test('当 document.hasFocus() 为 false 时，writeRichClipboard 通过 execCommand 降级写入剪贴板，不抛出 Document is not focused', async () => {
  let capturedHtml = '';
  let capturedText = '';
  let execCommandCalled = false;

  const mockListeners = new Map();
  const mockDocument = {
    hasFocus() { return false; },
    body: {
      appendChild(node) { return node; }
    },
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        style: {},
        innerHTML: '',
        value: '',
        contentEditable: 'true',
        tabIndex: -1,
        setAttribute() {},
        focus() {},
        select() {},
        remove() {}
      };
    },
    createRange() {
      return {
        selectNodeContents() {}
      };
    },
    addEventListener(event, listener) {
      if (!mockListeners.has(event)) mockListeners.set(event, []);
      mockListeners.get(event).push(listener);
    },
    removeEventListener(event, listener) {
      const list = mockListeners.get(event);
      if (list) {
        const index = list.indexOf(listener);
        if (index >= 0) list.splice(index, 1);
      }
    },
    execCommand(command) {
      if (command === 'copy') {
        execCommandCalled = true;
        const listeners = mockListeners.get('copy') || [];
        const evt = {
          preventDefault() {},
          stopImmediatePropagation() {},
          clipboardData: {
            setData(type, val) {
              if (type === 'text/html') capturedHtml = val;
              if (type === 'text/plain') capturedText = val;
            }
          }
        };
        for (const listener of [...listeners]) {
          listener(evt);
        }
        return true;
      }
      return false;
    }
  };

  const mockWindow = {
    focus() {},
    getSelection() {
      return {
        rangeCount: 0,
        removeAllRanges() {},
        addRange() {}
      };
    }
  };

  const originalDoc = globalThis.document;
  const originalWin = globalThis.window;
  const originalNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  globalThis.document = mockDocument;
  globalThis.window = mockWindow;
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      clipboard: {
        write() {
          throw new Error("Failed to execute 'write' on 'Clipboard': Document is not focused.");
        }
      }
    },
    configurable: true
  });

  try {
    const ok = await writeRichClipboard('<b>你好</b>', '你好');
    assert.equal(ok, true);
    assert.equal(execCommandCalled, true);
    assert.match(capturedHtml, /<!--StartFragment--><b>你好<\/b><!--EndFragment-->/);
    assert.equal(capturedText, '你好');
  } finally {
    globalThis.document = originalDoc;
    globalThis.window = originalWin;
    if (originalNavDesc) {
      Object.defineProperty(globalThis, 'navigator', originalNavDesc);
    } else {
      delete globalThis.navigator;
    }
  }
});

test('当 document.hasFocus() 为 false 时，writePlainTextClipboard 降级使用 execCommand 成功复制纯文本', async () => {
  let capturedText = '';
  let execCommandCalled = false;

  const mockListeners = new Map();
  const mockDocument = {
    hasFocus() { return false; },
    body: {
      appendChild(node) { return node; }
    },
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        style: {},
        innerHTML: '',
        value: '',
        tabIndex: -1,
        setAttribute() {},
        focus() {},
        select() {},
        remove() {}
      };
    },
    addEventListener(event, listener) {
      if (!mockListeners.has(event)) mockListeners.set(event, []);
      mockListeners.get(event).push(listener);
    },
    removeEventListener(event, listener) {
      const list = mockListeners.get(event);
      if (list) {
        const index = list.indexOf(listener);
        if (index >= 0) list.splice(index, 1);
      }
    },
    execCommand(command) {
      if (command === 'copy') {
        execCommandCalled = true;
        const listeners = mockListeners.get('copy') || [];
        const evt = {
          preventDefault() {},
          stopImmediatePropagation() {},
          clipboardData: {
            setData(type, val) {
              if (type === 'text/plain') capturedText = val;
            }
          }
        };
        for (const listener of [...listeners]) {
          listener(evt);
        }
        return true;
      }
      return false;
    }
  };

  const originalDoc = globalThis.document;
  const originalWin = globalThis.window;
  const originalNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  globalThis.document = mockDocument;
  globalThis.window = { focus() {} };
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      clipboard: {
        writeText() {
          throw new Error("Failed to execute 'writeText' on 'Clipboard': Document is not focused.");
        }
      }
    },
    configurable: true
  });

  try {
    const ok = await writePlainTextClipboard('标题文本');
    assert.equal(ok, true);
    assert.equal(execCommandCalled, true);
    assert.equal(capturedText, '标题文本');
  } finally {
    globalThis.document = originalDoc;
    globalThis.window = originalWin;
    if (originalNavDesc) {
      Object.defineProperty(globalThis, 'navigator', originalNavDesc);
    } else {
      delete globalThis.navigator;
    }
  }
});
