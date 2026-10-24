import { Window } from 'happy-dom';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

export function readPayload(html) {
  const match = html.match(/<script id="encrypted-payload" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'Expected an embedded payload');
  return JSON.parse(match[1]);
}

// This deliberately small DOM stub does not parse/render HTML or execute page
// scripts. Run unmodified executable script elements; never inject local exports.
export function executeHtml(html, { payload, crypto = webcrypto, globals = {} } = {}) {
  const nodes = new Map(),
    downloads = [],
    blobs = [];
  const window = {
    confirm() {
      return true;
    }
  };
  const document = {
    body: { append() {} },
    head: {
      append(node) {
        document.robots = node;
      }
    },
    open() {},
    close() {},
    write(text) {
      document.writtenHtml = text;
    },
    createElement() {
      return {
        click() {
          downloads.push(this.download);
        },
        remove() {},
        append() {},
        setAttribute() {}
      };
    },
    getElementById(id) {
      if (id === 'password' && !html.includes('id="password"')) return null;
      if (!nodes.has(id))
        nodes.set(id, {
          replaceChildren() {},
          append() {},
          closest() {
            return document.getElementById('drop-zone');
          },
          value: '',
          dataset: {},
          checked: false,
          outerHTML: id === 'seal-logo' ? html.match(/<svg id="seal-logo"[\s\S]*?<\/svg>/)?.[0] : '',
          textContent: id === 'encrypted-payload' ? JSON.stringify(payload ?? readPayload(html)) : '',
          attributes: {},
          setAttribute(name, value) {
            this.attributes[name] = value;
          },
          getBoundingClientRect() {
            return { left: 0, top: 0 };
          },
          isConnected: true,
          handlers: {},
          addEventListener(type, handler) {
            this.handlers[type] = handler;
          },
          focus() {
            document.activeElement = this;
          },
          select() {
            this.selected = true;
          },
          remove() {
            this.isConnected = false;
          },
          querySelector() {
            return null;
          }
        });
      return nodes.get(id);
    }
  };
  const context = vm.createContext({
    document,
    window,
    crypto,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    atob,
    btoa,
    console: { ...console, warn() {}, error() {} },
    Blob,
    Response,
    CompressionStream,
    DecompressionStream,
    DOMException,
    AbortController,
    setTimeout,
    DOMParser: new Window({
      settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableIframePageLoading: true }
    }).DOMParser,
    URL: class extends URL {
      static createObjectURL(blob) {
        blobs.push(blob);
        return 'blob:test';
      }
      static revokeObjectURL() {}
    },
    ...globals
  });
  for (const [, attributes, script] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/type="application\/json"/.test(attributes)) continue;
    assert.ok(!/\bsrc=/.test(attributes), 'Harness supports standalone inline scripts only');
    vm.runInContext(script, context);
  }
  return { nodes, downloads, blobs, document, window };
}

export function wrapper(html, payload, options = {}) {
  payload ??= readPayload(html);
  const harness = executeHtml(html, { ...options, payload });
  return {
    ...harness,
    payload,
    confirmWith(fn) {
      harness.window.confirm = fn;
    },
    async open(password = '') {
      const input = harness.nodes.get('password');
      if (input) input.value = password;
      const before = harness.blobs.length;
      await harness.nodes.get('unlock-form').handlers.submit({ preventDefault() {} });
      const status = harness.nodes.get('status');
      if (status.dataset.kind === 'error') throw new Error(status.textContent);
      if (payload.display === 'page') {
        assert.equal(typeof harness.document.writtenHtml, 'string', 'Reader must write the original webpage');
        return new TextEncoder().encode(harness.document.writtenHtml);
      }
      assert.ok(harness.blobs.length > before, 'Reader must expose the downloadable file');
      return new Uint8Array(await harness.blobs.at(-1).arrayBuffer());
    }
  };
}

export async function createThroughUi(
  html,
  bytes,
  file,
  { password = '', htmlPage = false, title = '', ...environment } = {}
) {
  const ui = executeHtml(html, environment);
  const node = id => ui.nodes.get(id);
  node('source-file').files = [
    {
      ...file,
      size: bytes.byteLength,
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
    }
  ];
  await node('source-file').handlers.change();
  node('password').value = node('password-repeat').value = password;
  ui.document.getElementById('output-title').value = title;
  if (htmlPage && node('html-page').disabled) throw new Error('HTML files only');
  node('html-page').checked = htmlPage;
  await node('html-page').handlers.change();
  if (node('encrypt-button').disabled) throw new Error(node('selection-report').textContent);
  await node('encrypt-form').handlers.submit({ preventDefault() {} });
  if (node('status').dataset.kind === 'error') throw new Error(node('status').textContent);
  assert.equal(ui.blobs.length, 1, 'Creator must download one standalone HTML file');
  return { html: await ui.blobs[0].text(), ui };
}
