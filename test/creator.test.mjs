import assert from 'node:assert/strict';
import { test } from 'node:test';
import { webcrypto, randomFillSync } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderWrapper } from '../src/wrapper.mjs';
import { createPageViewer, isHtmlFile } from '../src/viewer.mjs';
import { executeHtml, wrapper, createThroughUi } from './helpers/html-harness.mjs';
import { makePayload, decodePayload, verifyPayload } from './helpers/payload.mjs';

const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('opening errors focus the available control without requiring a password field', async () => {
  const bytes = Buffer.alloc(8192, 255);
  for (const access of ['sealed', 'passphrase'])
    for (const page of [false, true]) {
      const file = { name: page ? 'page.html' : 'file.txt', type: page ? 'text/html' : 'text/plain' };
      const content = page ? Buffer.from('<!doctype html><p>' + 'x'.repeat(8192)) : bytes;
      const payload = await makePayload(content, 'test', 160000, file, access, false, page);
      const html = renderWrapper({ title: 'Opening error', payload });
      for (const damaged of [false, true])
        for (const disconnected of [false, true]) {
          const data = damaged ? { ...payload, encoding: 'invalid' } : payload;
          const reader = wrapper(html, data, { globals: { DecompressionStream: undefined } });
          const button = reader.nodes.get('unlock-button');
          const input = reader.nodes.get('password');
          if (input) input.value = 'test';
          button.isConnected = !disconnected;
          if (input) input.isConnected = !disconnected;
          await reader.nodes.get('unlock-form').handlers.submit({ preventDefault() {} });
          assert.equal(button.disabled, false);
          assert.equal(reader.nodes.get('status').dataset.kind, 'error');
          assert.match(
            reader.nodes.get('status').textContent,
            damaged ? (access === 'sealed' ? /Damaged file/ : /Wrong passphrase/) : /gzip decompression support/
          );
          assert.equal(reader.document.activeElement, disconnected ? undefined : input || button);
          if (input && !disconnected) assert.equal(input.selected, true);
        }
    }
});

test('page choice is per-file, HTML-only and captured before asynchronous reads', async () => {
  const ui = executeHtml(source);
  const node = id => ui.nodes.get(id);
  const bytes = Buffer.from('<!doctype html><title>Selected page</title><h1>Hello</h1>');
  const file = {
    name: 'selected.html',
    type: 'text/html',
    size: bytes.length,
    async arrayBuffer() {
      node('html-page').checked = false;
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  };
  node('source-file').files = [file];
  node('source-file').handlers.change();
  assert.equal(node('html-page-option').hidden, false);
  assert.equal(node('html-page').disabled, false);
  assert.equal(node('html-page').checked, false);
  node('html-page').checked = true;
  await node('encrypt-form').handlers.submit({ preventDefault() {} });
  assert.match(ui.downloads[0], /^sealed_\d{6}_\d{4}\.html$/);
  const emitted = wrapper(await ui.blobs[0].text());
  assert.equal(emitted.payload.display, 'page');
  assert.deepEqual(Buffer.from(await emitted.open()), bytes);
  node('source-file').files = [{ name: 'other.txt', type: 'text/plain', size: 1 }];
  node('source-file').handlers.change();
  assert.equal(node('html-page-option').hidden, true);
  assert.equal(node('html-page').disabled, true);
  assert.equal(node('html-page').checked, false);
  node('source-file').files = [file];
  node('source-file').handlers.change();
  assert.equal(node('html-page').checked, false);
  node('source-file').files = [];
  node('source-file').handlers.change();
  assert.equal(node('html-page-option').hidden, true);
});

test('page mode accepts UTF-8 and BOM-marked UTF-16 and rejects unsupported input', async () => {
  const text = '<!doctype html><title>Grüße</title><p>日本語</p>';
  for (const bytes of [Buffer.from(text), Buffer.concat([Buffer.from([255, 254]), Buffer.from(text, 'utf16le')])]) {
    const { html } = await createThroughUi(source, bytes, { name: 'utf.html', type: 'text/html' }, { htmlPage: true });
    const reader = wrapper(html);
    await verifyPayload(reader.payload, '', bytes);
    let written;
    reader.document.open = () => {};
    reader.document.close = () => {};
    reader.document.write = html => {
      reader.document.writtenHtml = written = html;
    };
    reader.document.head = { append() {} };
    await reader.open();
    assert.equal(written, text);
  }
  assert.throws(() => createPageViewer().decodeHtml(Buffer.from([0xc3, 0x28])), /UTF-8 or BOM-marked UTF-16/);
  assert.equal(isHtmlFile('wrong.txt', 'text/plain'), false);
  await assert.rejects(
    createThroughUi(source, Buffer.from([0xc3, 0x28]), { name: 'bad.html', type: 'text/html' }, { htmlPage: true }),
    /UTF-8 or BOM-marked UTF-16/
  );
  await assert.rejects(
    createThroughUi(source, Buffer.from(text), { name: 'wrong.txt', type: 'text/plain' }, { htmlPage: true }),
    /HTML files only/
  );
  const dir = await mkdtemp(join(tmpdir(), 'staticseal-page-input-'));
  try {
    await writeFile(join(dir, 'not-html.txt'), 'Text');
    const invalid = spawnSync(
      process.execPath,
      [
        'bin/self-encrypt.mjs',
        '--in',
        join(dir, 'not-html.txt'),
        '--out',
        join(dir, 'invalid.html'),
        '--html-page',
        '--no-password'
      ],
      { encoding: 'utf8' }
    );
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /requires an HTML file/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sealed envelopes omit crypto and work without Web Crypto, with and without gzip', async () => {
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.from('Unchanged original bytes.'),
    Buffer.alloc(8192),
    randomFillSync(Buffer.alloc(8192)),
    Buffer.concat([randomFillSync(Buffer.alloc(7900)), Buffer.alloc(292)])
  ]) {
    const file = { name: '</script><script>alert(1)</script>.txt', type: 'text/plain' };
    const { html } = await createThroughUi(source, bytes, file, { globals: { crypto: undefined } });
    const payload = wrapper(html).payload;
    assert.equal(payload.v, bytes.length === 8192 && bytes.every(value => value === 0) ? 5 : 4);
    for (const field of ['alg', 'kdf', 'iterations', 'salt', 'iv', 'tag', 'unlockKey', 'ciphertext']) {
      assert.equal(Object.hasOwn(payload, field), false, field);
    }
    for (const token of ['crypto.subtle', 'AES-GCM', 'PBKDF2']) assert.ok(!html.includes(token), token);
    assert.equal(html.includes('DecompressionStream'), payload.v === 5);
    const reader = wrapper(html, undefined, { globals: { crypto: undefined } });
    assert.deepEqual(Buffer.from(await reader.open()), bytes);
    assert.equal((await decodePayload(reader.payload, '')).filename, file.name);
    assert.equal((await decodePayload(reader.payload, '')).contentType, file.type);
    await verifyPayload(payload, '', bytes);
  }
  const dir = await mkdtemp(join(tmpdir(), 'staticseal-no-crypto-'));
  try {
    await writeFile(join(dir, 'input.txt'), Buffer.alloc(8192));
    await writeFile(
      join(dir, 'forbid.cjs'),
      `const crypto = require('node:crypto');
      for (const name of ['pbkdf2Sync', 'randomBytes', 'createCipheriv', 'createDecipheriv']) {
        crypto[name] = () => { throw new Error('Unexpected crypto call: ' + name); };
      }
      require('node:module').syncBuiltinESMExports();`
    );
    const cli = spawnSync(
      process.execPath,
      [
        '--require',
        join(dir, 'forbid.cjs'),
        'bin/self-encrypt.mjs',
        '--in',
        join(dir, 'input.txt'),
        '--out',
        join(dir, 'sealed.html'),
        '--no-password'
      ],
      { cwd: new URL('..', import.meta.url), encoding: 'utf8' }
    );
    assert.equal(cli.status, 0, cli.stderr);
    const reader = wrapper(await readFile(join(dir, 'sealed.html'), 'utf8'));
    assert.equal(reader.payload.v, 5);
    assert.deepEqual(Buffer.from(await reader.open()), Buffer.alloc(8192));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('generator prefills both fields and copy follows edits without stale confirmations', async () => {
  let randomCalls = 0,
    copied,
    finishCopy;
  const crypto = {
    getRandomValues(bytes) {
      randomCalls++;
      bytes.fill(randomCalls);
      return bytes;
    }
  };
  const ui = executeHtml(source, {
    crypto,
    globals: {
      navigator: {
        clipboard: {
          async writeText(value) {
            copied = value;
          }
        }
      }
    }
  });
  const node = id => ui.nodes.get(id);
  const click = id => node(id).handlers.click();
  assert.equal(node('copy-generated').disabled, true);
  node('password').value = 'existing';
  click('generate-password');
  assert.equal(randomCalls, 1);
  assert.match(node('password').value, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(node('password').type, 'text');
  assert.equal(node('password-repeat').type, 'text');
  node('password').handlers.blur();
  assert.equal(node('password').type, 'text', 'generated passphrase stays visible after leaving the field');
  assert.equal(node('password-repeat').value, node('password').value);
  await click('copy-generated');
  assert.equal(copied, node('password').value);
  assert.equal(node('password').type, 'text');
  assert.equal(node('password-repeat').type, 'text');
  assert.equal(node('copy-generated').textContent, 'Copied');
  const generated = node('password').value;
  click('generate-password');
  assert.notEqual(node('password').value, generated);
  assert.equal(node('password-repeat').value, node('password').value);
  assert.equal(node('copy-generated').textContent, 'Copy');
  node('password').value = 'manual secret';
  node('password').handlers.input();
  assert.equal(node('password').type, 'password');
  assert.equal(node('password-repeat').type, 'password');
  assert.equal(node('copy-generated').disabled, true);
  const previouslyCopied = copied;
  await click('copy-generated');
  assert.equal(copied, previouslyCopied, 'mismatched fields must not reach the clipboard');
  node('password-repeat').value = 'manual secret';
  node('password-repeat').handlers.input();
  assert.equal(node('copy-generated').disabled, false);
  await click('copy-generated');
  assert.equal(copied, 'manual secret');
  node('password-repeat').value = 'different';
  node('password-repeat').handlers.input();
  assert.equal(node('copy-generated').disabled, true);
  node('password-repeat').handlers.input();
  assert.equal(node('generator-status').textContent, '');
  node('password').value = '';
  node('password').handlers.input();
  assert.equal(node('copy-generated').disabled, true);
  node('password-repeat').value = '';
  node('password-repeat').handlers.input();
  assert.equal(node('copy-generated').disabled, true, 'matching empty fields are not copyable');
  assert.doesNotMatch(
    source,
    /id="(?:generated-password|use-generated|cancel-generator|kdf-strength|output-title|output-name)"/
  );
  const pending = executeHtml(source, {
    globals: {
      navigator: {
        clipboard: {
          writeText() {
            return new Promise(resolve => {
              finishCopy = resolve;
            });
          }
        }
      }
    }
  });
  pending.nodes.get('password').value = pending.nodes.get('password-repeat').value = 'old';
  const copy = pending.nodes.get('copy-generated').handlers.click();
  pending.nodes.get('password').value = 'new';
  pending.nodes.get('password').handlers.input();
  finishCopy();
  await copy;
  assert.equal(pending.nodes.get('copy-generated').textContent, 'Copy');
  const broken = executeHtml(source, {
    crypto: {
      getRandomValues() {
        throw new Error('unavailable');
      }
    }
  });
  broken.nodes.get('password').value = broken.nodes.get('password-repeat').value = 'keep';
  broken.nodes.get('generate-password').handlers.click();
  assert.equal(broken.nodes.get('password').value, 'keep');
  assert.equal(broken.nodes.get('password-repeat').value, 'keep');
  assert.match(broken.nodes.get('generator-status').textContent, /unavailable/);
  await broken.nodes.get('copy-generated').handlers.click();
  assert.match(broken.nodes.get('generator-status').textContent, /Clipboard unavailable/);
  assert.equal(broken.nodes.get('password').type, 'text');
  broken.nodes.get('password').handlers.blur();
  assert.equal(broken.nodes.get('password').type, 'password');
});

test('browser always hides metadata, captures local minute timestamp and restores original name', async () => {
  let derivations = 0;
  const trackedCrypto = {
    getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
    subtle: new Proxy(webcrypto.subtle, {
      get(target, property) {
        if (property === 'deriveKey')
          return (...args) => {
            derivations++;
            return target.deriveKey(...args);
          };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    })
  };
  let clock = new Date(2026, 9, 23, 14, 32, 59);
  class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [clock.getTime()]));
    }
  }
  const ui = executeHtml(source, { crypto: trackedCrypto, globals: { Date: FixedDate } });
  const node = id => ui.nodes.get(id);
  const file = {
    name: 'Secret-report.pdf',
    type: 'application/pdf',
    size: 3,
    async arrayBuffer() {
      clock = new Date(2026, 9, 23, 14, 33);
      return new Uint8Array([1, 2, 3]).buffer;
    }
  };
  assert.ok(!source.includes('id="private-filename"'));
  node('source-file').files = [file];
  node('password').value = node('password-repeat').value = 'test';
  await node('encrypt-form').handlers.submit({ preventDefault() {} });
  assert.equal(derivations, 1, 'Derive the key once for encryption and verification');
  assert.deepEqual(ui.downloads, ['sealed_261023_1432.html']);
  assert.match(node('status').textContent, /Original: .* → HTML package: /);
  const html = await ui.blobs[0].text();
  assert.ok(!html.includes(file.name));
  assert.match(html, /<title>Protected file<\/title>/);
  const reader = wrapper(html);
  assert.equal(reader.payload.iterations, 210000);
  assert.equal(reader.payload.filename, undefined);
  assert.equal(reader.payload.contentType, undefined);
  assert.deepEqual(Buffer.from(await reader.open('test')), Buffer.from([1, 2, 3]));
  assert.equal(reader.document.title, file.name);
  const metadata = JSON.stringify(reader.payload);
  await reader.open('test');
  assert.equal(JSON.stringify(reader.payload), metadata, 'Repeated opening must not mutate authenticated metadata');
  assert.equal((await decodePayload(reader.payload, 'test')).filename, file.name);
});

test('timestamp filenames zero-pad local calendar values and omit seconds', async () => {
  class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [2026, 0, 2, 3, 4, 59]));
    }
  }
  const file = { name: 'Frühjahr.txt', type: 'text/plain' };
  const { html, ui } = await createThroughUi(source, new TextEncoder().encode('Original content'), file, {
    globals: { Date: FixedDate }
  });
  assert.deepEqual(ui.downloads, ['sealed_260102_0304.html']);
  const reader = wrapper(html);
  assert.equal(reader.payload.filename, undefined);
  await reader.open();
  assert.equal(reader.document.title, file.name);
  assert.ok(reader.document.body.innerHTML.includes('download="Frühjahr.txt"'));
});

test('browser UI keeps warning, confirmation and rejection boundaries before file reading', async () => {
  for (const size of [
    5 * 1024 * 1024 - 1,
    5 * 1024 * 1024,
    10 * 1024 * 1024,
    10 * 1024 * 1024 + 1,
    25 * 1024 * 1024 + 1,
    128 * 1024 * 1024,
    128 * 1024 * 1024 + 1
  ]) {
    const ui = executeHtml(source),
      node = id => ui.nodes.get(id);
    let reads = 0,
      confirmations = 0;
    node('source-file').files = [
      {
        name: 'boundary.txt',
        type: 'text/plain',
        size,
        async arrayBuffer() {
          reads++;
          return new Uint8Array([65]).buffer;
        }
      }
    ];
    ui.window.confirm = () => {
      confirmations++;
      return false;
    };
    node('source-file').handlers.change();
    if (size < 5 * 1024 * 1024) assert.equal(node('status').textContent, '');
    else assert.equal(node('status').dataset.kind, 'error');
    await node('encrypt-form').handlers.submit({ preventDefault() {} });
    assert.equal(confirmations, size > 10 * 1024 * 1024 && size <= 128 * 1024 * 1024 ? 1 : 0);
    assert.equal(reads, size <= 10 * 1024 * 1024 ? 1 : 0);
    if (size > 128 * 1024 * 1024) assert.match(node('status').textContent, /128 MiB/);
    else if (size > 10 * 1024 * 1024) assert.match(node('status').textContent, /cancelled/);
  }
});
