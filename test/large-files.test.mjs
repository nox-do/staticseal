import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { webcrypto, randomFillSync } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { prepareContent, COMPRESSION_THRESHOLD } from '../src/compression.mjs';
import { inflateContent } from '../src/gzip.mjs';
import { readFile, writeFile, mkdtemp, rm, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createFormat } from '../src/format.mjs';
import { createCrypto } from '../src/crypto.mjs';
import { preparePackage } from '../src/creation.mjs';
import { createPreview } from '../src/preview.mjs';
import { themeStyle } from '../src/cli-theme.mjs';
import { renderWrapper } from '../src/wrapper.mjs';
import { createPageViewer, isHtmlFile } from '../src/viewer.mjs';
import { executeHtml, wrapper, createThroughUi } from './helpers/html-harness.mjs';
import { makePayload, decodePayload, verifyPayload, toBase64Chunks } from './helpers/payload.mjs';

function previewText(node) {
  return node.textContent || (node.innerHTML || '').replace(/<span class="s-[a-z]+">|<\/span>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39);/g, value => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[value]);
}

// Integration harness runs unmodified HTML scripts with DOM stubs, not a real browser.
const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const { fromBase64Chunks, unpackContent, escapeHtml } = createFormat();

test('format rules and metadata bounds survive factory serialization without module scope', async () => {
  const built = await import('../src/reader-factories.mjs');
  for (const factory of [createFormat, built.createFormat]) {
    const format = vm.runInNewContext('(' + factory.toString() + ')()', { Uint8Array, TextDecoder });
    for (const [version, access, compressed] of [
      [2, 'passphrase', false], [3, 'passphrase', true], [4, 'sealed', false], [5, 'sealed', true]
    ]) {
      assert.equal(format.versionFor(access, compressed), version);
      assert.equal(format.isSupportedVersion(version), true);
      assert.equal(format.isEncryptedVersion(version), access === 'passphrase');
      assert.equal(format.isUnencryptedVersion(version), access === 'sealed');
      assert.equal(format.isCompressedVersion(version), compressed);
    }
    const file = { filename: '', contentType: 'text/plain' };
    file.filename = 'x'.repeat(65536 - Buffer.byteLength(JSON.stringify(file)));
    const header = Buffer.from(JSON.stringify(file));
    assert.equal(header.length, 65536);
    const packed = Buffer.alloc(4 + header.length + 1);
    packed.writeUInt32BE(header.length);
    header.copy(packed, 4);
    packed[packed.length - 1] = 255;
    for (const v of [2, 3, 4, 5]) {
      const unpacked = format.unpackContent(packed, { v, encoding: 'metadata' });
      assert.equal(unpacked.filename, file.filename);
      assert.deepEqual(Buffer.from(unpacked.bytes), Buffer.from([255]));
    }
    for (const v of [0, 1, 6, -1, 2.5, '2', null, undefined]) {
      assert.equal(format.isSupportedVersion(v), false);
      assert.throws(() => format.unpackContent(packed, { v, encoding: 'metadata' }), /Unsupported payload format/);
    }
    packed.writeUInt32BE(65537);
    assert.throws(() => format.unpackContent(packed, { v: 2, encoding: 'metadata' }), /Invalid file metadata/);
  }
});

test('authenticated metadata retains its exact historical order and omission rules', () => {
  // Deliberately scramble input insertion order; the literal expected bytes are the wire contract.
  const metadata = { display: 'page', iv: 'iv', salt: 'salt', access: 'passphrase',
    contentType: 'text/html', filename: 'Grüße.html', encoding: 'metadata',
    iterations: 210000, kdf: 'PBKDF2-SHA256', alg: 'AES-GCM', v: 3, ignored: 'extra' };
  const aad = createCrypto().authenticatedDataFor;
  assert.equal(Buffer.from(aad(metadata)).toString('utf8'),
    '{"v":3,"alg":"AES-GCM","kdf":"PBKDF2-SHA256","iterations":210000,"encoding":"metadata","filename":"Grüße.html","contentType":"text/html","access":"passphrase","salt":"salt","iv":"iv","display":"page"}');
  assert.equal(Buffer.from(aad({ ...metadata, filename: undefined, contentType: undefined, display: undefined })).toString('utf8'),
    '{"v":3,"alg":"AES-GCM","kdf":"PBKDF2-SHA256","iterations":210000,"encoding":"metadata","access":"passphrase","salt":"salt","iv":"iv"}');
  assert.equal(Buffer.from(aad({ ...metadata, unlockKey: 'legacy' })).toString('utf8'),
    '{"v":3,"alg":"AES-GCM","kdf":"PBKDF2-SHA256","iterations":210000,"encoding":"metadata","filename":"Grüße.html","contentType":"text/html","access":"passphrase","unlockKey":"legacy","salt":"salt","iv":"iv","display":"page"}');
});

test('historical v2-v5 payloads open in imported helpers and generated readers', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/format-v2-v5.json', import.meta.url), 'utf8'));
  const { renderWrapper } = await import('../src/wrapper.mjs');
  for (const { inputIndex, mode, access, payload } of fixture.cases) {
    const input = fixture.inputs[inputIndex];
    const bytes = Buffer.from(input.text.repeat(input.repeat));
    assert.equal(payload.v, (access === 'sealed' ? 4 : 2) + inputIndex);
    assert.equal(payload.display, mode === 'page' ? 'page' : undefined);
    await verifyPayload(payload, fixture.password, bytes);
    {
      const reader = wrapper(renderWrapper({ title: 'Format compatibility', payload }));
      assert.deepEqual(Buffer.from(await reader.open(fixture.password)), bytes);
      assert.equal((await decodePayload(reader.payload, fixture.password)).filename, 'compat.html');
      assert.equal((await decodePayload(reader.payload, fixture.password)).contentType, 'text/html');
    }
  }
});

test('shared creation preserves metadata order, privacy and raw buffer identity through module imports', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/format-v2-v5.json', import.meta.url), 'utf8'));
  {
    for (const { inputIndex, mode, access, payload } of fixture.cases) for (const privateFilename of [false, true]) {
      const input = fixture.inputs[inputIndex];
      // Nonzero offset ensures that the preparation does not assume a whole backing buffer.
      const storage = Buffer.concat([Buffer.from([255]), Buffer.from(input.text.repeat(input.repeat)), Buffer.from([255])]);
      const bytes = storage.subarray(1, -1);
      const file = { filename: 'compat.html', contentType: 'text/html' };
      const content = await preparePackage(bytes, file, { access, iterations: 100000, salt: payload.salt, iv: payload.iv,
        privateFilename, htmlPage: mode === 'page', chunkSize: 65536 });
      const expectedMetadata = Object.fromEntries(Object.entries(payload).filter(([key]) =>
        !['content', 'ciphertext', 'tag', ...(privateFilename ? ['filename', 'contentType'] : [])].includes(key)));
      assert.equal(JSON.stringify(content.metadata), JSON.stringify(expectedMetadata));
      assert.equal(Buffer.from(content.header).toString('utf8'), JSON.stringify({ ...file,
        ...(inputIndex === 1 ? { originalSize: bytes.length } : {}) }));
      assert.equal(content.lengthPrefix.byteLength, 4);
      assert.equal(Buffer.from(content.lengthPrefix).readUInt32BE(), content.header.byteLength);
      assert.equal(content.binarySize, 4 + content.header.byteLength + content.bytes.byteLength + (access === 'sealed' ? 0 : 16));
      if (inputIndex === 0) assert.equal(content.bytes, bytes, 'raw input must be returned without a file copy');
    }
  }
});

test('Node encryption receives prefix, header and original input separately without a plaintext concat', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'staticseal-parts-'));
  try {
    const inputPath = join(dir, 'raw.bin');
    await writeFile(inputPath, randomFillSync(Buffer.alloc(8192)));
    await writeFile(join(dir, 'parts.cjs'), `const assert = require('node:assert/strict');
      const fs = require('node:fs/promises');
      const crypto = require('node:crypto');
      let inputBytes;
      const readFile = fs.readFile;
      fs.readFile = async (...args) => {
        const bytes = await readFile(...args);
        if (args[0] === ${JSON.stringify(inputPath)}) inputBytes = bytes;
        return bytes;
      };
      const concat = Buffer.concat;
      Buffer.concat = (parts, ...args) => {
        assert.ok(!inputBytes || !parts.includes(inputBytes), 'must not concatenate the original plaintext');
        return concat(parts, ...args);
      };
      const createCipheriv = crypto.createCipheriv;
      crypto.createCipheriv = (...args) => {
        const cipher = createCipheriv(...args);
        const update = cipher.update.bind(cipher);
        let count = 0, headerLength;
        cipher.update = bytes => {
          if (count === 0) { assert.equal(bytes.byteLength, 4); headerLength = Buffer.from(bytes).readUInt32BE(); }
          else if (count === 1) assert.equal(bytes.byteLength, headerLength);
          else if (count === 2) assert.equal(bytes, inputBytes, 'cipher must receive the original buffer');
          count++;
          return update(bytes);
        };
        process.on('exit', () => assert.equal(count, 3));
        return cipher;
      };
      require('node:module').syncBuiltinESMExports();`);
    const result = spawnSync(process.execPath, ['--require', join(dir, 'parts.cjs'), 'bin/self-encrypt.mjs',
      '--in', inputPath, '--out', join(dir, 'reader.html'), '--iterations', '100000', '--stdin-password'],
      { cwd: new URL('..', import.meta.url), input: 'test\n', encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const reader = wrapper(await readFile(join(dir, 'reader.html'), 'utf8'));
    assert.equal(reader.payload.v, 2);
    assert.deepEqual(Buffer.from(await reader.open('test')), await readFile(inputPath));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('minimal opening screens and custom button labels preserve access modes and errors', async () => {
  const { renderWrapper } = await import('../src/wrapper.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'staticseal-minimal-'));
  const bytes = Buffer.from('<!doctype html><title>Impressum</title><h1>Impressum</h1>');
  const label = 'Impressum öffnen $& </button><script>bad()</script>';
  const safeLabel = label.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  try {
    await writeFile(join(dir, 'page.html'), bytes);
    for (const access of ['sealed', 'passphrase']) for (const minimal of [false, true]) {
      const payload = await makePayload(bytes, 'minimal-test', 100000,
        { name: 'page.html', type: 'text/html' }, access, false, true);
      const result = spawnSync(process.execPath, ['bin/self-encrypt.mjs', '--in', join(dir, 'page.html'),
        '--out', join(dir, 'output.html'), '--html-page', '--title', 'Impressum', '--button-label', label,
        '--iterations', '100000', access === 'sealed' ? '--no-password' : '--stdin-password', ...(minimal ? ['--minimal'] : [])],
      { cwd: new URL('..', import.meta.url), input: 'minimal-test\n', encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      for (const html of [renderWrapper({ title: 'Impressum', payload, minimal, buttonLabel: label }),
        renderWrapper({ title: 'Impressum', payload, minimal, buttonLabel: label }),
        await readFile(join(dir, 'output.html'), 'utf8')]) {
        assert.ok(html.includes('<h1>Impressum</h1>'));
        assert.ok(html.includes('id="wrapper-brand"'));
        assert.equal(html.includes('id="password"'), access === 'passphrase');
        assert.equal(html.includes('<label for="password">'), access === 'passphrase');
        assert.ok(html.includes('type="submit">' + safeLabel + '</button>'));
        assert.ok(!html.includes('<script>bad()'));
        assert.ok(!html.includes('Anyone with this file can open it.'));
        assert.ok(!html.includes('Passphrase protection depends on'));
        assert.equal(html.includes('in your browser.'), !minimal);
        const reader = wrapper(html);
        assert.equal(reader.nodes.get('status').textContent, access === 'sealed' && !minimal ? 'No passphrase required.' : '');
        if (access === 'passphrase') {
          reader.nodes.get('password').value = '';
          await reader.nodes.get('unlock-form').handlers.submit({ preventDefault() {} });
          assert.equal(reader.nodes.get('status').textContent, 'Enter the passphrase.');
        }
        assert.deepEqual(Buffer.from(await reader.open('minimal-test')), bytes);
      }
    }
    const defaults = renderWrapper({ title: 'Default', payload: { access: 'sealed', v: 4, content: [] } });
    assert.ok(defaults.includes('type="submit">Open sealed file</button>'));
    const invalid = spawnSync(process.execPath, ['bin/self-encrypt.mjs', '--button-label'], { encoding: 'utf8' });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /Missing value for --button-label/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('opening errors focus the available control without requiring a password field', async () => {
  const bytes = Buffer.alloc(8192, 255);
  for (const access of ['sealed', 'passphrase']) for (const page of [false, true]) {
    const file = { name: page ? 'page.html' : 'file.txt', type: page ? 'text/html' : 'text/plain' };
    const content = page ? Buffer.from('<!doctype html><p>' + 'x'.repeat(8192)) : bytes;
    const payload = await makePayload(content, 'test', 160000, file, access, false, page);
    const html = renderWrapper({ title: 'Opening error', payload });
    for (const damaged of [false, true]) for (const disconnected of [false, true]) {
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
      assert.match(reader.nodes.get('status').textContent, damaged
        ? access === 'sealed' ? /Damaged file/ : /Wrong passphrase/
        : /gzip decompression support/);
      assert.equal(reader.document.activeElement, disconnected ? undefined : input || button);
      if (input && !disconnected) assert.equal(input.selected, true);
    }
  }
});

test('optional CLI themes affect only opening-screen CSS and preserve payload roundtrips', async () => {
  const { renderWrapper } = await import('../src/wrapper.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'staticseal-theme-'));
  const bytes = Buffer.from('<!doctype html><title>Theme</title><p>Original page</p>');
  const themedArgs = ['--theme-bg', '#181818', '--theme-text', '#eee', '--theme-accent', '#e98663',
    '--theme-panel', '#252525', '--theme-font', '"Georgia", serif', '--theme-radius', '0'];
  try {
    await writeFile(join(dir, 'page.html'), bytes);
    const run = args => spawnSync(process.execPath, ['bin/self-encrypt.mjs', '--in', join(dir, 'page.html'),
      '--out', join(dir, 'output.html'), '--iterations', '100000', ...args],
    { cwd: new URL('..', import.meta.url), input: 'theme-test\n', encoding: 'utf8' });
    for (const page of [false, true]) for (const encrypted of [false, true]) {
      const mode = [...(page ? ['--html-page'] : []), encrypted ? '--stdin-password' : '--no-password'];
      for (const themed of [false, true]) {
        const result = run([...mode, ...(themed ? themedArgs : [])]);
        assert.equal(result.status, 0, result.stderr);
        const html = await readFile(join(dir, 'output.html'), 'utf8');
        const reader = wrapper(html);
        assert.deepEqual(Buffer.from(await reader.open('theme-test')), bytes);
        const plain = renderWrapper({ title: 'page.html - protected file', payload: reader.payload });
        if (!themed) assert.equal(html, plain);
        else {
          const css = themeStyle({ bg: '#181818', text: '#eee', accent: '#e98663', panel: '#252525', font: '"Georgia", serif', radius: '0' });
          assert.equal(html, plain.replace('</head>', `<style>${css}</style></head>`));
          assert.match(css, /body:not\(\.vp\)/);
          assert.match(css, /--muted:#eee/);
          assert.match(css, /outline-color:var\(--accent\)/);
        }
      }
    }
    for (const args of [['--theme-bg'], ['--theme-bg', '--html-page'], ['--theme-bg', 'red'],
      ['--theme-accent', '#fff;display:none'], ['--theme-font', '</style><script>alert(1)</script>'],
      ['--theme-font', 'serif; color:red'], ['--theme-radius', '-1px'], ['--theme-radius', 'url(x)']]) {
      const result = run(['--no-password', ...args]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /theme-/);
    }
    assert.equal(themeStyle(), '');
    for (const radius of ['0', '4px', '.5rem', '1.2em']) assert.match(themeStyle({ radius }), /border-radius:/);
    for (const bg of ['#abc', '#abcd', '#aabbcc', '#aabbccdd']) assert.match(themeStyle({ bg }), /--bg:/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('page mode emits only its renderer and restores full HTML across module-created and CLI variants', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'staticseal-page-'));
  const small = '<!doctype html><html><head><title>Page test</title><style>body{color:teal}</style></head><body><h1>Grüße</h1><button id="count">0</button><script>document.getElementById("count").onclick=e=>e.target.textContent="1";</script></body></html>';
  try {
    for (const large of [false, true]) for (const access of ['sealed', 'passphrase']) for (const privateName of [false, true]) {
      const text = small.replace('</body>', (large ? '<!--' + 'Full page, no preview truncation.\n'.repeat(6000) + '-->' : '') + '</body>');
      const bytes = Buffer.from(text);
      const file = { name: 'page.html', type: 'text/html' };
      const payload = await makePayload(bytes, 'page-test', 160000, file, access, privateName, true);
      assert.equal(payload.display, 'page');
      assert.equal(payload.v, access === 'sealed' ? (large ? 5 : 4) : (large ? 3 : 2));
      const html = renderWrapper({ title: 'Page', payload });
      await writeFile(join(dir, file.name), bytes);
      const cli = spawnSync(process.execPath, ['bin/self-encrypt.mjs', '--in', join(dir, file.name),
        '--out', join(dir, 'sealed.html'), '--html-page', '--iterations', '160000',
        access === 'sealed' ? '--no-password' : '--stdin-password', ...(privateName ? ['--private-filename'] : [])],
        { cwd: new URL('..', import.meta.url), input: 'page-test\n', encoding: 'utf8' });
      assert.equal(cli.status, 0, cli.stderr);
      for (const emitted of [html, await readFile(join(dir, 'sealed.html'), 'utf8')]) {
        assert.ok(!emitted.includes('Preview limited to'));
        assert.equal(emitted.includes('DecompressionStream'), large);
        assert.equal(emitted.includes('crypto.subtle'), access === 'passphrase');
        const reader = wrapper(emitted);
        assert.equal((await decodePayload(reader.payload, 'page-test')).filename, file.name);
        assert.equal((await decodePayload(reader.payload, 'page-test')).contentType, file.type);
        let written, opened = 0, closed = 0, meta;
        reader.document.open = () => opened++;
        reader.document.write = text => { reader.document.writtenHtml = written = text; };
        reader.document.close = () => closed++;
        reader.document.head = { append(node) { meta = node; } };
        assert.deepEqual(Buffer.from(await reader.open('page-test')), bytes);
        assert.equal(written, text);
        assert.equal(opened, 1);
        assert.equal(closed, 1);
        assert.equal(meta.name, 'robots');
        assert.equal(meta.content, 'noindex,nofollow,noarchive');
        await verifyPayload(reader.payload, 'page-test', bytes);
        if (access === 'passphrase') {
          await assert.rejects(wrapper(emitted).open('wrong'));
          await assert.rejects(wrapper(emitted, { ...reader.payload, display: undefined }).open('page-test'));
        }
        if (privateName) assert.ok(!emitted.includes(file.name));
      }
      if (!large) {
        const preview = await makePayload(bytes, 'page-test', 160000, file, access, privateName);
        const previewHtml = renderWrapper({ title: 'File preview', payload: preview });
        assert.equal(preview.display, undefined);
        assert.ok(previewHtml.includes('Preview limited to'));
        assert.ok(!previewHtml.includes('document.write'));
        assert.ok(Buffer.byteLength(html) < Buffer.byteLength(previewHtml));
      }
    }
    await writeFile(join(dir, 'not-html.txt'), 'Text');
    const invalid = spawnSync(process.execPath, ['bin/self-encrypt.mjs', '--in', join(dir, 'not-html.txt'),
      '--out', join(dir, 'invalid.html'), '--html-page', '--no-password'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /requires an HTML file/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('page choice is per-file, HTML-only and captured before asynchronous reads', async () => {
  const ui = executeHtml(source);
  const node = id => ui.nodes.get(id);
  const bytes = Buffer.from('<!doctype html><title>Selected page</title><h1>Hello</h1>');
  const file = { name: 'selected.html', type: 'text/html', size: bytes.length, async arrayBuffer() {
    node('html-page').checked = false;
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  } };
  node('source-file').files = [file];
  node('source-file').handlers.change();
  assert.equal(node('html-page-option').hidden, false);
  assert.equal(node('html-page').disabled, false);
  assert.equal(node('html-page').checked, false);
  node('html-page').checked = true;
  node('kdf-strength').value = '210000';
  await node('encrypt-form').handlers.submit({ preventDefault() {} });
  assert.deepEqual(ui.downloads, ['selected_sealed.html']);
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
    reader.document.write = html => { reader.document.writtenHtml = written = html; };
    reader.document.head = { append() {} };
    await reader.open();
    assert.equal(written, text);
  }
  assert.throws(() => createPageViewer().decodeHtml(Buffer.from([0xc3, 0x28])), /UTF-8 or BOM-marked UTF-16/);
  assert.equal(isHtmlFile('wrong.txt', 'text/plain'), false);
  await assert.rejects(createThroughUi(source, Buffer.from([0xc3, 0x28]),
    { name: 'bad.html', type: 'text/html' }, { htmlPage: true }), /UTF-8 or BOM-marked UTF-16/);
  await assert.rejects(createThroughUi(source, Buffer.from(text),
    { name: 'wrong.txt', type: 'text/plain' }, { htmlPage: true }), /HTML files only/);
});

test('sealed envelopes omit crypto and work without Web Crypto, with and without gzip', async () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from('Unchanged original bytes.'), Buffer.alloc(8192),
    randomFillSync(Buffer.alloc(8192)), Buffer.concat([randomFillSync(Buffer.alloc(7900)), Buffer.alloc(292)])])
    for (const privateName of [false, true]) {
    const file = { name: '</script><script>alert(1)</script>.txt', type: 'text/plain' };
    const { html } = await createThroughUi(source, bytes, file, { privateFilename: privateName, globals: { crypto: undefined } });
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
    await writeFile(join(dir, 'forbid.cjs'), `const crypto = require('node:crypto');
      for (const name of ['pbkdf2Sync', 'randomBytes', 'createCipheriv', 'createDecipheriv']) {
        crypto[name] = () => { throw new Error('Unexpected crypto call: ' + name); };
      }
      require('node:module').syncBuiltinESMExports();`);
    const cli = spawnSync(process.execPath, ['--require', join(dir, 'forbid.cjs'), 'bin/self-encrypt.mjs',
      '--in', join(dir, 'input.txt'), '--out', join(dir, 'sealed.html'), '--no-password'],
      { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    const reader = wrapper(await readFile(join(dir, 'sealed.html'), 'utf8'));
    assert.equal(reader.payload.v, 5);
    assert.deepEqual(Buffer.from(await reader.open()), Buffer.alloc(8192));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('gzip threshold, total-package savings and native API fallback', async () => {
  const metadata = { v: 2, access: 'passphrase', filename: '内部.bin', contentType: 'application/octet-stream' };
  const file = { filename: metadata.filename, contentType: metadata.contentType };
  const { renderWrapper } = await import('../src/wrapper.mjs');
  const asHtml = (content, chunkSize = 65536) => {
    const ciphertext = Buffer.alloc(4 + content.header.length + content.bytes.length);
    return renderWrapper({ title: 'Size test', payload: { ...metadata, v: content.v, tag: '',
      ciphertext: toBase64Chunks(ciphertext, chunkSize) } });
  };
  const incompressible = randomFillSync(Buffer.alloc(8192));
  const partlyCompressible = Buffer.concat([randomFillSync(Buffer.alloc(7000)), Buffer.alloc(1192)]);
  const smallGain = Buffer.concat([randomFillSync(Buffer.alloc(7900)), Buffer.alloc(292)]);
  assert.ok(gzipSync(smallGain).length < smallGain.length);
  assert.equal((await prepareContent(smallGain, file, metadata, 65536)).v, 2,
    'reject gzip savings that do not pay for the embedded decoder');
  for (const chunkSize of [40, 65, 65536]) {
    for (const bytes of [Buffer.alloc(COMPRESSION_THRESHOLD - 1), Buffer.alloc(COMPRESSION_THRESHOLD),
      incompressible, partlyCompressible, smallGain, Buffer.alloc(65536)]) {
      const result = await prepareContent(bytes, file, metadata, chunkSize);
      const raw = { bytes, header: Buffer.from(JSON.stringify(file)), v: 2 };
      const compressed = { bytes: gzipSync(bytes),
        header: Buffer.from(JSON.stringify({ ...file, originalSize: bytes.length })), v: 3 };
      const worthwhile = bytes.length >= COMPRESSION_THRESHOLD
        && Buffer.byteLength(asHtml(compressed, chunkSize)) < Buffer.byteLength(asHtml(raw, chunkSize));
      assert.equal(result.v, worthwhile ? 3 : 2, `size ${bytes.length}, chunk width ${chunkSize}`);
      assert.ok(Buffer.byteLength(asHtml(result, chunkSize)) <= Buffer.byteLength(asHtml(raw, chunkSize)));
      if (result.v === 2) assert.ok(!asHtml(result).includes('DecompressionStream'));
    }
  }
  const fileInfo = { name: 'fallback.txt', type: 'text/plain' };
  for (const missing of ['CompressionStream', 'DecompressionStream']) {
    const { html } = await createThroughUi(source, Buffer.alloc(8192), fileInfo,
      { password: 'test', iterations: 160000, globals: { [missing]: undefined } });
    const payload = wrapper(html).payload;
    assert.equal(payload.v, 2);
    assert.ok(!html.includes('DecompressionStream'));
  }
  const overLimit = Buffer.alloc(25 * 1024 * 1024 + 1);
  assert.equal((await prepareContent(overLimit, file, metadata, 65536)).v, 2);
});

test('compressed module-created and CLI envelopes restore 25 MiB exactly with both access and filename modes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'staticseal-gzip-'));
  try {
    const bytes = Buffer.alloc(25 * 1024 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i & 255;
    const file = { name: 'compressed.bin', type: 'application/octet-stream' };
    await writeFile(join(dir, file.name), bytes);
    for (const access of ['passphrase', 'sealed']) for (const privateName of [false, true]) {
      const payload = await makePayload(bytes, 'test', 160000, file, access, privateName);
      assert.equal(payload.v, access === 'sealed' ? 5 : 3);
      const appHtml = renderWrapper({ title: 'Compressed', payload });
      assert.ok(appHtml.includes('DecompressionStream'));
      assert.ok(!appHtml.includes('CompressionStream'));
      assert.ok(Buffer.byteLength(appHtml) < 200000);
      const cli = spawnSync(process.execPath, ['bin/self-encrypt.mjs', '--in', join(dir, file.name),
        '--out', join(dir, 'sealed.html'), '--iterations', '160000',
        '--chunk-size', privateName ? '65' : '65536',
        access === 'sealed' ? '--no-password' : '--stdin-password', ...(privateName ? ['--private-filename'] : [])],
        { cwd: new URL('..', import.meta.url), input: 'test\n', encoding: 'utf8' });
      assert.equal(cli.status, 0, cli.stderr);
      const cliHtml = await readFile(join(dir, 'sealed.html'), 'utf8');
      for (const html of [appHtml, cliHtml]) {
        const reader = wrapper(html);
        const secret = reader.payload.unlockKey ?? 'test';
        assert.equal(reader.payload.v, access === 'sealed' ? 5 : 3);
        assert.deepEqual(Buffer.from(await reader.open(secret)), bytes);
        assert.equal((await decodePayload(reader.payload, 'test')).filename, file.name);
        assert.equal((await decodePayload(reader.payload, 'test')).contentType, file.type);
        await verifyPayload(reader.payload, secret, bytes);
        if (access === 'passphrase') {
          await assert.rejects(reader.open('wrong-password'));
          const changed = { ...reader.payload, v: 2 };
          await assert.rejects(wrapper(html, changed).open(secret));
        } else {
          assert.ok(!html.includes('crypto.subtle'));
          assert.ok(!html.includes('PBKDF2'));
          assert.deepEqual(Buffer.from(await reader.open('any-value')), bytes);
        }
        if (privateName) assert.ok(!html.includes(file.name));
      }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('gzip restoration rejects damaged streams, invalid sizes and unsupported browsers', async () => {
  const bytes = Buffer.alloc(8192, 255);
  const content = { bytes: gzipSync(bytes), originalSize: bytes.length, filename: 'test.bin', contentType: 'application/octet-stream' };
  assert.deepEqual(Buffer.from((await inflateContent(content, createFormat().MAX_EXPANDED_BYTES)).bytes), bytes);
  // Exercise the serialized minified helper too; it must have no module closure.
  const built = await import('../src/reader-factories.mjs');
  for (const helper of [inflateContent, built.inflateContent]) {
    const inflate = vm.runInNewContext('(' + helper.toString() + ')', { Blob, DecompressionStream, Uint8Array, DOMException });
    assert.deepEqual(Buffer.from((await inflate(content, createFormat().MAX_EXPANDED_BYTES)).bytes), bytes);
    await assert.rejects(inflate(content), /Invalid or oversized compressed content/);
    for (const originalSize of [undefined, -1, 1.5, 128 * 1024 * 1024 + 1, bytes.length - 1, bytes.length + 1]) {
      await assert.rejects(inflate({ ...content, originalSize }, createFormat().MAX_EXPANDED_BYTES));
    }
    for (const data of [new Uint8Array([1, 2, 3]), content.bytes.subarray(0, -1)]) {
      await assert.rejects(inflate({ ...content, bytes: data }, createFormat().MAX_EXPANDED_BYTES));
    }
  }
  const payload = await makePayload(bytes, 'test', 160000,
    { name: content.filename, type: content.contentType }, 'passphrase');
  const html = renderWrapper({ title: 'Unsupported browser', payload });
  const reader = wrapper(html, undefined, { globals: { DecompressionStream: undefined } });
  reader.nodes.get('password').value = 'test';
  await reader.nodes.get('unlock-form').handlers.submit({ preventDefault() {} });
  assert.match(reader.nodes.get('status').textContent, /gzip decompression support/);
});

for (const size of [10, 25]) {
  for (const access of ['passphrase', 'sealed']) {
   for (const privateName of [false, true]) {
    test(`${size} MiB / ${access} / private name ${privateName}: shared modules, CLI and generated readers`, async () => {
      // Reserve 1 KiB for metadata/tag under the CLI binary package limit.
      const bytes = randomFillSync(Buffer.alloc(size * 1024 * 1024 - 1024));
      const password = 'regression-test-password';
      const payload = await makePayload(bytes, password, 210000,
        { name: 'large.bin', type: 'application/octet-stream' }, access, privateName);
      const packedSize = bytes.length + 4 + Buffer.byteLength(JSON.stringify({ filename: 'large.bin', contentType: 'application/octet-stream' }));
      assert.equal((payload.content || payload.ciphertext).length, Math.ceil(packedSize / 49152));
      await verifyPayload(payload, password, bytes);
      const html = renderWrapper({ title: 'Test', payload, sourceName: 'large.bin' });
      assert.deepEqual(Buffer.from(await wrapper(html).open(password)), bytes);

      const dir = await mkdtemp(join(tmpdir(), 'staticseal-test-'));
      try {
        await writeFile(join(dir, 'large.bin'), bytes);
        const result = spawnSync(process.execPath, ['bin/self-encrypt.mjs', '--in', join(dir, 'large.bin'),
          '--out', join(dir, 'locked.html'), access === 'sealed' ? '--no-password' : '--stdin-password', ...(privateName ? ['--private-filename'] : [])],
          { cwd: new URL('..', import.meta.url), input: password + '\n', encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        const cliHtml = await readFile(join(dir, 'locked.html'), 'utf8');
        const cli = wrapper(cliHtml);
        assert.equal(payload.v, access === 'sealed' ? 4 : 2);
        assert.equal(payload.encoding, 'metadata');
        assert.equal(cli.payload.v, access === 'sealed' ? 4 : 2);
        assert.equal(cli.payload.encoding, 'metadata');
        if (privateName) {
          assert.ok(!html.includes('large.bin'));
          assert.ok(!cliHtml.includes('large.bin'));
        } else {
          assert.ok(html.includes('<title>Test</title>'));
          assert.ok(cliHtml.includes('large.bin - protected file'));
        }
        const secret = cli.payload.unlockKey ?? password;
        assert.equal((cli.payload.content || cli.payload.ciphertext).length, Math.ceil(packedSize / 49152));
        assert.deepEqual(Buffer.from(await cli.open(secret)), bytes);
        assert.equal((await decodePayload(cli.payload, secret)).filename, 'large.bin');
        assert.equal((await decodePayload(cli.payload, secret)).contentType, 'application/octet-stream');
        await verifyPayload(cli.payload, secret, bytes);
        for (const [generated, data, key] of access === 'passphrase' ? [[html, payload, password], [cliHtml, cli.payload, secret]] : []) {
          await assert.rejects(wrapper(generated).open('wrong-password'));
          await assert.rejects(verifyPayload(data, 'wrong-password', bytes));
          for (const field of ['filename', 'contentType', 'access', 'unlockKey']) {
            const changed = { ...data, [field]: 'tampered' };
            await assert.rejects(wrapper(generated, changed).open(key));
            await assert.rejects(verifyPayload(changed, key, bytes));
          }
          const changed = { ...data, tag: Buffer.alloc(16).toString('base64') };
          await assert.rejects(wrapper(generated, changed).open(key));
        }
        console.log(`${size} MiB ${access}: ${(payload.content || payload.ciphertext).length} chunks, module-created HTML ${Buffer.byteLength(html)} bytes`);
      } finally { await rm(dir, { recursive: true, force: true }); }
    });
   }
  }
}

test('public metadata with HTML control sequences survives JSON embedding and wrapper decryption', async () => {
  const bytes = new Uint8Array([0, 1, 128, 255]);
  const names = ['<!--<script>.txt', '</script><script>alert(1)</script>.txt', 'a"&<>内部.txt'];
  for (const name of names) {
    const payload = await makePayload(bytes, 'test', 210000,
      { name, type: 'text/plain' }, 'passphrase');
    const html = renderWrapper({ title: name, sourceName: name, payload });
    const embedded = html.match(/<script id="encrypted-payload" type="application\/json">([\s\S]*?)<\/script>/)[1];
    assert.ok(!embedded.includes('<'), 'JSON must not contain raw HTML control sequences');
    const reader = wrapper(html);
    assert.equal(reader.payload.filename, name);
    assert.deepEqual(Buffer.from(await reader.open('test')), Buffer.from(bytes));
    assert.equal((await decodePayload(reader.payload, 'test')).filename, name);
  }
  // Full HTML parsing for both generators is covered by build-browser-smoke.mjs.
});

test('compact JSON preserves every payload value and template-like user text', async () => {
  const { renderWrapper } = await import('../src/wrapper.mjs');
  const name = 'STATICSEAL_TITLE_STATICSEAL_READER_$&_$`_内部.txt';
  const bytes = new Uint8Array([0, 1, 128, 255]);
  const payload = await makePayload(bytes, 'test', 210000,
    { name, type: 'text/plain' }, 'passphrase');
  {
    const html = renderWrapper({ title: name, payload });
    const json = html.match(/<script id="encrypted-payload" type="application\/json">([\s\S]*?)<\/script>/)[1].trim();
    assert.ok(!json.includes('\n'), 'Payload JSON has no formatting line breaks');
    assert.deepEqual(JSON.parse(json), JSON.parse(JSON.stringify(payload)));
    assert.ok(html.includes('<title>' + name.replace('&', '&amp;') + '</title>'));
    assert.deepEqual(Buffer.from(await wrapper(html).open('test')), Buffer.from(bytes));
  }
});

test('chunk boundaries, empty input, independently padded chunks and tag', () => {
  assert.deepEqual(fromBase64Chunks([]), new Uint8Array(0));
  assert.deepEqual(fromBase64Chunks(['YQ==', 'YmM=', 'ZGVm']), new TextEncoder().encode('abcdef'));
  for (const size of [0, 1, 2, 3, 49_151, 49_152, 49_153]) {
    const bytes = Buffer.alloc(size, 255);
    const chunks = [bytes.subarray(0, 49152).toString('base64'), bytes.subarray(49152).toString('base64')];
    assert.deepEqual(Buffer.from(fromBase64Chunks(chunks, new Uint8Array([1, 2]))), Buffer.concat([bytes, Buffer.from([1, 2])]));
  }
});

test('every authenticated metadata field rejects tampering, including KDF parameters', async () => {
  const bytes = new Uint8Array([0, 1, 2, 255]);
  const key = 'test-secret';
  const payload = await makePayload(bytes, key, 210000,
    { name: 'small.bin', type: 'application/octet-stream' }, 'passphrase');
  const html = renderWrapper({ title: 'Test', payload, sourceName: 'small.bin' });
  for (const field of ['v', 'alg', 'kdf', 'iterations', 'encoding', 'filename', 'contentType',
    'access', 'unlockKey', 'salt', 'iv', 'display']) {
    let value = typeof payload[field] === 'number' ? payload[field] + 1 : 'tampered';
    if (field === 'salt' || field === 'iv') {
      const raw = Buffer.from(payload[field], 'base64');
      raw[0] ^= 1;
      value = raw.toString('base64');
    }
    const changed = { ...payload, [field]: value };
    await assert.rejects(verifyPayload(changed, key, bytes), field);
    await assert.rejects(wrapper(html, changed).open(key), field);
  }
});

test('five KDF choices, one derivation per creation, private metadata and generator isolation', async () => {
  let derivations = 0;
  const trackedCrypto = {
    getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
    subtle: new Proxy(webcrypto.subtle, { get(target, property) {
      if (property === 'deriveKey') return (...args) => {
        derivations++;
        return target.deriveKey(...args);
      };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    } })
  };
  const file = { name: 'Quartalszahlen_内部.pdf', type: 'application/pdf' };
  for (const iterations of [160000, 210000, 420000, 600000, 1200000]) {
    const before = derivations;
    const bytes = new Uint8Array([0, 255, 128]);
    const { html } = await createThroughUi(source, bytes, file,
      { password: 'test', iterations, privateFilename: true, crypto: trackedCrypto });
    const payload = wrapper(html).payload;
    assert.equal(derivations, before + 1);
    assert.equal(payload.iterations, iterations);
    assert.equal(payload.filename, undefined);
    assert.equal(payload.contentType, undefined);
    assert.ok(!html.includes(file.name));
    const reader = wrapper(html);
    assert.deepEqual(Buffer.from(await reader.open('test')), Buffer.from(bytes));
    assert.equal((await decodePayload(reader.payload, 'test')).filename, file.name);
    assert.equal((await decodePayload(reader.payload, 'test')).contentType, file.type);
    // Repeated unlock must not modify authenticated outer metadata.
    assert.deepEqual(Buffer.from(await reader.open('test')), Buffer.from(bytes));
  }
});

test('private metadata parser rejects malformed headers and unsupported versions', () => {
  const meta = { v: 2, encoding: 'metadata' };
  for (const bytes of [new Uint8Array(0), new Uint8Array([0, 0, 0, 8]), new Uint8Array([255,255,255,255]),
    new Uint8Array([0,0,0,2,123,125]), new Uint8Array([0,0,0,1,255])]) {
    assert.throws(() => unpackContent(bytes, meta));
  }
  for (const unsupported of [{ v: 1, encoding: 'bytes' }, { v: 2, encoding: 'private-metadata' }, { v: 6, encoding: 'metadata' }]) {
    assert.throws(() => unpackContent(new Uint8Array(0), unsupported), /Unsupported payload format/);
  }
});

test('generator uses browser randomness without hashing, supports explicit adoption and cancellation', () => {
  let randomCalls = 0;
  const crypto = { getRandomValues(bytes) { randomCalls++; return webcrypto.getRandomValues(bytes); } };
  const ui = executeHtml(source, { crypto });
  const node = id => ui.nodes.get(id);
  const click = id => node(id).handlers.click();
  node('password').value = 'existing';
  click('generate-password');
  assert.equal(randomCalls, 1);
  assert.match(node('generated-password').value, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(node('password').value, 'existing');
  const generated = node('generated-password').value;
  click('use-generated');
  assert.equal(node('password').value, generated);
  assert.equal(node('password-repeat').value, generated);
  assert.equal(node('generated-password').value, '');
  click('generate-password');
  click('cancel-generator');
  assert.equal(node('password').value, generated);
  const broken = executeHtml(source, { crypto: { subtle: webcrypto.subtle, getRandomValues() { throw new Error('unavailable'); } } });
  broken.nodes.get('generate-password').handlers.click();
  assert.equal(broken.nodes.get('generator-result').hidden, true);
  assert.equal(broken.nodes.get('use-generated').disabled, true);
  assert.match(broken.nodes.get('generator-status').textContent, /unavailable/);
});

test('CLI derives only once per creation and accepts both additional KDF settings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'staticseal-kdf-'));
  try {
    await writeFile(join(dir, 'empty.txt'), '');
    await writeFile(join(dir, 'count.cjs'), `const crypto = require('node:crypto');
      const original = crypto.pbkdf2Sync;
      let calls = 0;
      crypto.pbkdf2Sync = (...args) => { calls++; return original(...args); };
      require('node:module').syncBuiltinESMExports();
      process.on('exit', () => { if (calls !== 1) process.exitCode = 99; });`);
    for (const iterations of [600000, 1200000]) {
      const result = spawnSync(process.execPath, ['--require', join(dir, 'count.cjs'), 'bin/self-encrypt.mjs',
        '--in', join(dir, 'empty.txt'), '--out', join(dir, 'private.html'), '--private-filename',
        '--iterations', String(iterations), '--stdin-password'],
        { cwd: new URL('..', import.meta.url), input: 'test\n', encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const reader = wrapper(await readFile(join(dir, 'private.html'), 'utf8'));
      assert.equal(reader.payload.iterations, iterations);
      assert.equal((await reader.open('test')).byteLength, 0);
      assert.equal((await decodePayload(reader.payload, 'test')).filename, 'empty.txt');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('private filename UI neutralizes fields and captures privacy before asynchronous reads', async () => {
  const ui = executeHtml(source);
  const node = id => ui.nodes.get(id);
  const file = { name: 'Secret-report.pdf', type: 'application/pdf', size: 3,
    async arrayBuffer() {
      // Simulate the user editing controls while File.arrayBuffer is pending.
      node('private-filename').checked = false;
      node('output-name').value = file.name + '.html';
      node('output-title').value = file.name;
      return new Uint8Array([1,2,3]).buffer;
    } };
  node('source-file').files = [file];
  node('output-title').value = file.name;
  node('output-name').value = file.name + '.html';
  node('private-filename').checked = true;
  node('private-filename').handlers.change();
  assert.equal(node('output-title').value, 'Protected file');
  assert.equal(node('output-name').value, 'protected_file.html');
  assert.equal(node('output-name').disabled, true);
  node('password').value = node('password-repeat').value = 'test';
  node('kdf-strength').value = '600000';
  await node('encrypt-form').handlers.submit({ preventDefault() {} });
  assert.deepEqual(ui.downloads, ['protected_file.html']);
  assert.match(node('status').textContent, /Original: .* → HTML package: /);
  const html = await ui.blobs[0].text();
  assert.ok(!html.includes(file.name));
  const reader = wrapper(html);
  assert.deepEqual(Buffer.from(await reader.open('test')), Buffer.from([1,2,3]));
  assert.equal((await decodePayload(reader.payload, 'test')).filename, file.name);
});


test('both generated viewers restrict previews and require PDF confirmation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'staticseal-preview-'));
  const bytes = Buffer.from('Original bytes remain unchanged.');
  try {
    for (const [extension, type, preview] of [
      ['png', 'image/png', true], ['jpg', 'image/jpeg', true],
      ['gif', 'image/gif', true], ['webp', 'image/webp', true],
      ['html', 'text/html', false], ['xhtml', 'application/xhtml+xml', false],
      ['svg', 'image/svg+xml', true], ['bmp', 'image/bmp', false],
      ['txt', 'text/plain', false], ['pdf', 'application/pdf', false],
      ['md', 'text/markdown', false], ['json', 'application/json', false], ['ts', 'text/plain', false],
      ['constructor', 'application/octet-stream', false], ['__proto__', 'application/octet-stream', false]
    ]) {
      const name = 'example.' + extension;
      const payload = await makePayload(bytes, 'test', 210000, { name, type }, 'passphrase', true);
      const appHtml = renderWrapper({ title: 'Test', payload, sourceName: name });
      await writeFile(join(dir, name), bytes);
      const cli = spawnSync(process.execPath, ['bin/self-encrypt.mjs', '--in', join(dir, name),
        '--out', join(dir, 'locked.html'), '--private-filename', '--stdin-password'],
        { cwd: new URL('..', import.meta.url), input: 'test\n', encoding: 'utf8' });
      assert.equal(cli.status, 0, cli.stderr);
      for (const html of [appHtml, await readFile(join(dir, 'locked.html'), 'utf8')]) {
        const reader = wrapper(html);
        await reader.open('test');
        const viewer = reader.nodes.get('vc');
        assert.equal(viewer.innerHTML.includes('<img '), preview, extension);
        assert.ok(!viewer.innerHTML.includes('<iframe'), extension);
        assert.ok(!reader.nodes.get('vc').innerHTML.includes('<object'), 'No document embedding');
        if (['txt', 'html', 'xhtml', 'json', 'ts'].includes(extension)) {
          assert.equal(previewText(reader.nodes.get('tp')), bytes.toString());
        }
        if (extension === 'md') assert.ok(viewer.innerHTML.includes('<article><p>Original bytes remain unchanged.</p></article>'));
        assert.deepEqual(Buffer.from(await reader.blobs[0].arrayBuffer()), bytes);
        if (extension === 'pdf') {
          let confirmations = 0;
          reader.confirmWith(() => { confirmations++; return false; });
          reader.nodes.get('pdf').handlers.click();
          assert.equal(confirmations, 1);
          assert.ok(!viewer.innerHTML.includes('<iframe'));
          reader.confirmWith(() => { confirmations++; return true; });
          reader.nodes.get('pdf').handlers.click();
          assert.equal(confirmations, 2);
          assert.ok(viewer.innerHTML.includes('<iframe'));
        }
      }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('compact Markdown escapes HTML and permits only explicit safe link schemes', () => {
  const { renderMarkdown, previewKind, inferContentType } = createPreview();
  const rendered = renderMarkdown('# Title\n\n**bold** and *italic* and `code`\n\n- One\n- Two\n\n1. First\n2. Second\n\n> Quote\n\n```html\n<script>alert(1)</script>\n```\n\n[Safe](https://example.com) [Mail](mailto:a@example.com) [Bad](javascript:alert)\n\n<img src=x onerror=alert(1)>\n\n![Remote](https://example.com/track.png)');
  for (const part of ['<h1>Title</h1>', '<strong>bold</strong>', '<em>italic</em>', '<code>code</code>',
    '<ul><li>One</li><li>Two</li></ul>', '<ol><li>First</li><li>Second</li></ol>', '<blockquote><p>Quote</p></blockquote>',
    '&lt;script&gt;', '&lt;img', 'href="https://example.com"', 'href="mailto:a@example.com"']) assert.ok(rendered.replace(/<span class="s-[a-z]+">|<\/span>/g, '').includes(part), part);
  for (const part of ['<script', '<img', 'href="javascript:', 'src="https:']) assert.ok(!rendered.includes(part), part);
  for (const href of ['data:text/html,test', 'file:///tmp/test', '//example.com', 'javascript&#58;alert', 'java\tscript:alert', 'https://example.com/"onclick="alert']) {
    const result = renderMarkdown('[click](' + href + ')');
    assert.ok(!result.includes(' onclick='));
    assert.ok(!result.includes('href="data:') && !result.includes('href="file:') && !result.includes('href="//'));
  }
  assert.equal(previewKind('README.MD', 'text/plain'), 'markdown');
  assert.equal(previewKind('example.ts', 'application/octet-stream'), 'text');
  assert.equal(previewKind('example.svg', 'application/octet-stream'), 'image');
  assert.equal(previewKind('example.bin', 'application/octet-stream'), 'download');
  assert.equal(previewKind('example.json', 'application/json; charset=utf-8'), 'text');
  assert.equal(inferContentType('README'), 'text/plain');
});

test('generated text/Markdown previews preserve bytes, bound output and handle encodings', async () => {
  for (const [name, bytes, expected] of [
    ['source.html', Buffer.from('<script>alert("hello")</script>'), '<script>alert("hello")</script>'],
    ['text.txt', Buffer.from('\ufeffGrüße 日本語', 'utf16le'), 'Grüße 日本語'],
    ['large.txt', Buffer.concat([Buffer.alloc(128 * 1024 - 1, 97), Buffer.from('€tail')]), 'a'.repeat(128 * 1024 - 1)],
    ['exact.txt', Buffer.alloc(128 * 1024, 97), 'a'.repeat(128 * 1024)],
    ['large.md', Buffer.from('# Title\n\n' + 'a'.repeat(128 * 1024)), null],
    ['invalid.txt', Buffer.from([0xff, 0xff]), null],
    ['note.md', Buffer.from('# Hello\n\n<script>alert(1)</script>'), null]
  ]) {
    const payload = await makePayload(bytes, 'test', 160000, { name, type: 'application/octet-stream' }, 'sealed', true);
    const reader = wrapper(renderWrapper({ title: 'Test', payload, sourceName: name }));
    await reader.open('test');
    const html = reader.nodes.get('vc').innerHTML;
    assert.deepEqual(Buffer.from(await reader.blobs[0].arrayBuffer()), bytes);
    if (expected !== null) assert.equal(previewText(reader.nodes.get('tp')), expected);
    if (name.startsWith('large.')) {
      assert.ok(html.includes('first 128 KiB'));
      assert.ok(html.includes('Preview ends here — the file continues.'));
      assert.ok(html.indexOf('class="pn pe"') > html.indexOf(name.endsWith('.md') ? '</article>' : '</pre>'));
    } else assert.ok(!html.includes('class="pn pe"'));
    if (name === 'invalid.txt') assert.ok(html.includes('Unsupported text encoding'));
    if (name === 'note.md') {
      assert.ok(html.includes('<h1>Hello</h1>'));
      assert.ok(html.includes('&lt;script&gt;'));
      assert.ok(!html.includes('<script>'));
    }
  }
});

test('small highlighter preserves source text and escapes active content in supported languages', async () => {
  const { codeLanguage, highlightCode, renderMarkdown } = createPreview();
  const cases = [
    ['example.JS', 'text/plain', 'const name = "<img src=x onerror=alert(1)>"; // comment\nlet count = 42;\nconst ready = true;', ['keyword', 'string', 'comment', 'number']],
    ['data.json', 'application/json', '{"key": "</script>&", "count": -3.25e+2, "ready": false, "empty": null}', ['key', 'string', 'number', 'keyword']],
    ['example.html', 'text/html', '<!-- comment -->\n<script>console.log("test")</script>\n<div title="a & b" onclick="alert(1)">Hello</div>', ['comment', 'tag', 'key', 'string']],
    ['unknown.txt', 'application/javascript; charset=utf-8', 'export default 123;', ['keyword', 'number']],
    ['data', 'application/ld+json', '{"value": true}', ['key', 'keyword']]
  ];
  for (const [name, type, text, kinds] of cases) {
    const highlighted = highlightCode(text, codeLanguage(name, type));
    assert.equal(previewText({ innerHTML: highlighted }), text);
    assert.ok(!/<(script|img|div)\b/i.test(highlighted));
    for (const kind of kinds) assert.ok(highlighted.includes('class="s-' + kind + '"'), name + ': ' + kind);
    const bytes = Buffer.from(text);
    const payload = await makePayload(bytes, 'test', 160000, { name, type }, 'sealed');
    const reader = wrapper(renderWrapper({ title: 'Test', payload, sourceName: name }));
    await reader.open('test');
    assert.equal(previewText(reader.nodes.get('tp')), text);
    assert.ok(reader.nodes.get('tp').innerHTML.includes('s-'));
    assert.deepEqual(Buffer.from(await reader.blobs[0].arrayBuffer()), bytes);
  }
  assert.equal(highlightCode('<img src=x> & "text"', 'python'), '&lt;img src=x&gt; &amp; &quot;text&quot;');
  const fenced = renderMarkdown('```js\nconst count = 42;\n```');
  assert.ok(fenced.includes('<span class="s-keyword">const</span>'));
  assert.equal(previewText({ innerHTML: fenced.replace('<pre><code>', '').replace('</code></pre>', '') }), 'const count = 42;');
  // Long incomplete tokens can occur at the preview boundary.
  for (const language of ['html', 'json', 'javascript']) {
    const text = '<a '.repeat(10000) + '"unfinished & <';
    assert.equal(previewText({ innerHTML: highlightCode(text, language) }), text);
  }
});

test('preview review regressions: arbitrary filenames, heading text and bounded formatting', () => {
  const { inferContentType, previewKind, renderMarkdown, highlightCode } = createPreview();
  for (const name of ['constructor', '__proto__', 'sample.constructor', 'sample.__proto__', 'hasOwnProperty']) {
    assert.equal(inferContentType(name), 'application/octet-stream');
    assert.equal(previewKind(name, 'application/octet-stream'), 'download');
  }
  for (const [input, title] of [['# C#', 'C#'], ['## C##', 'C##'], ['# Heading ###  ', 'Heading'], ['# ###', ''], ['#', '']]) {
    assert.equal(renderMarkdown(input), '<h' + input.match(/^#+/)[0].length + '>' + title + '</h' + input.match(/^#+/)[0].length + '>');
  }
  const spaced = 'a' + ' '.repeat(128 * 1024 - 4) + 'b';
  assert.equal(renderMarkdown('# ' + spaced), '<h1>' + spaced + '</h1>');
  for (const [text, language] of [['0 '.repeat(65536), 'json'], ['<a ' + 'title="x" '.repeat(10000) + '>', 'html']]) {
    const output = highlightCode(text, language);
    assert.equal(previewText({ innerHTML: output }), text);
    assert.ok(!output.includes('<span'), 'Dense code falls back to escaped plain text');
  }
  for (const text of ['- a\n'.repeat(32768), '*a* '.repeat(32768)]) {
    const output = renderMarkdown(text);
    assert.ok(output.startsWith('<p class="pn">Formatting simplified'));
    assert.ok(output.includes('<pre>' + text + '</pre>'));
    assert.ok(!output.includes('<li>') && !output.includes('<em>'));
  }
});

test('built app and CLI renderer emit matching markup and payload with one logo', async () => {
  const { renderWrapper } = await import('../src/wrapper.mjs');
  const bytes = new Uint8Array([1, 2, 3]);
  const file = { name: '<!--<script>.txt', type: 'text/plain' };
  const { html: appHtml } = await createThroughUi(source, bytes, file, { password: 'test' });
  const payload = wrapper(appHtml).payload;
  const options = { title: '<!--<script>', payload };
  // Factory-local names can differ after minifying the app and CLI modules.
  // Both actual reader scripts are exercised above; compare their surrounding HTML.
  const normalize = html => html.replace(/<script>[\s\S]*?<\/script>/, '<script>READER</script>');
  assert.equal(normalize(appHtml), normalize(renderWrapper(options)));
  assert.equal((appHtml.match(/<svg id="seal-logo"/g) || []).length, 1);
  assert.equal((source.match(/<svg id="seal-logo"/g) || []).length, 1);
});

test('built creator and reader forms cover raw/gzip, access, privacy and both display modes', async () => {
  for (const compressed of [false, true]) for (const page of [false, true]) for (const encrypted of [false, true]) {
    const bytes = Buffer.from('<!doctype html><meta charset="utf-8"><p>Grüße 🔒</p>' + (compressed ? 'Repeated text.\n'.repeat(2048) : ''));
    const password = encrypted ? 'form-roundtrip' : '';
    const privateFilename = compressed !== page;
    const { html } = await createThroughUi(source, bytes, { name: 'original.html', type: 'text/html' },
      { password, privateFilename, htmlPage: page });
    const reader = wrapper(html);
    assert.equal(reader.payload.v, (encrypted ? 2 : 4) + Number(compressed));
    assert.equal(reader.payload.display, page ? 'page' : undefined);
    assert.equal(reader.payload.filename, privateFilename ? undefined : 'original.html');
    if (privateFilename) assert.ok(!html.includes('original.html'));
    assert.deepEqual(Buffer.from(await reader.open(password)), bytes);
    await verifyPayload(reader.payload, password, bytes);
    if (encrypted) {
      const failed = wrapper(html);
      await assert.rejects(failed.open('wrong-password'));
      assert.equal(failed.blobs.length, 0, 'rejected opening must not expose a downloadable file');
      assert.equal(failed.document.writtenHtml, undefined, 'rejected opening must not write a page');
    }
  }
});

test('browser UI keeps warning, confirmation and rejection boundaries before file reading', async () => {
  for (const size of [5 * 1024 * 1024 - 1, 5 * 1024 * 1024, 10 * 1024 * 1024,
    10 * 1024 * 1024 + 1, 25 * 1024 * 1024, 25 * 1024 * 1024 + 1]) {
    const ui = executeHtml(source), node = id => ui.nodes.get(id);
    let reads = 0, confirmations = 0;
    node('source-file').files = [{ name: 'boundary.txt', type: 'text/plain', size,
      async arrayBuffer() { reads++; return new Uint8Array([65]).buffer; } }];
    ui.window.confirm = () => { confirmations++; return false; };
    node('source-file').handlers.change();
    if (size < 5 * 1024 * 1024) assert.equal(node('status').textContent, '');
    else assert.equal(node('status').dataset.kind, 'error');
    await node('encrypt-form').handlers.submit({ preventDefault() {} });
    assert.equal(confirmations, size > 10 * 1024 * 1024 && size <= 25 * 1024 * 1024 ? 1 : 0);
    assert.equal(reads, size <= 10 * 1024 * 1024 ? 1 : 0);
    if (size > 25 * 1024 * 1024) assert.match(node('status').textContent, /25 MiB/);
    else if (size > 10 * 1024 * 1024) assert.match(node('status').textContent, /cancelled/);
  }
});

test('CLI accepts 128 MiB HTML and rejects original, binary and HTML budget overflow without overwriting output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'staticseal-cli-limits-'));
  const inputPath = join(dir, 'page.html');
  const outputPath = join(dir, 'sealed.html');
  const run = (...args) => spawnSync(process.execPath, ['bin/self-encrypt.mjs', '--in', inputPath,
    '--out', outputPath, ...args], { cwd: new URL('..', import.meta.url), input: 'test\n', encoding: 'utf8' });
  try {
    const bytes = Buffer.alloc(128 * 1024 * 1024, 32);
    bytes.write('<!doctype html><title>Large page</title><script>globalThis.ready=true</script>');
    await writeFile(inputPath, bytes);
    for (const access of ['--no-password', '--stdin-password']) {
      const result = run(access, '--html-page', '--private-filename');
      assert.equal(result.status, 0, result.stderr);
      const reader = wrapper(await readFile(outputPath, 'utf8'));
      assert.equal(reader.payload.display, 'page');
      assert.equal(reader.payload.v, access === '--no-password' ? 5 : 3);
      assert.deepEqual(Buffer.from(await reader.open('test')), bytes);
    }
    await writeFile(outputPath, 'keep existing output');
    await truncate(inputPath, 128 * 1024 * 1024 + 1);
    let result = run('--no-password');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /128 MiB CLI limit/);
    assert.equal(await readFile(outputPath, 'utf8'), 'keep existing output');
    // A raw 25 MiB file cannot fit once metadata and the length prefix are included.
    await writeFile(inputPath, randomFillSync(Buffer.alloc(25 * 1024 * 1024)));
    for (const access of ['--no-password', '--stdin-password']) {
      result = run(access);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Binary package exceeds the 25 MiB/);
      assert.equal(await readFile(outputPath, 'utf8'), 'keep existing output');
    }
    // Small Base64 chunks increase JSON overhead beyond the transport budget.
    await truncate(inputPath, 25 * 1024 * 1024 - 1024);
    result = run('--no-password', '--chunk-size', '40');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /HTML package exceeds the 35 MiB/);
    assert.equal(await readFile(outputPath, 'utf8'), 'keep existing output');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
