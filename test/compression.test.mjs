import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { randomFillSync } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { prepareContent, COMPRESSION_THRESHOLD } from '../src/compression.mjs';
import { inflateContent } from '../src/gzip.mjs';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createFormat } from '../src/format.mjs';
import { renderWrapper } from '../src/wrapper.mjs';
import { wrapper, createThroughUi } from './helpers/html-harness.mjs';
import { makePayload, decodePayload, toBase64Chunks } from './helpers/payload.mjs';

const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('gzip threshold, total-package savings and native API fallback', async () => {
  const metadata = { v: 2, access: 'passphrase', filename: '内部.bin', contentType: 'application/octet-stream' };
  const file = { filename: metadata.filename, contentType: metadata.contentType };
  const { renderWrapper } = await import('../src/wrapper.mjs');
  const asHtml = (content, chunkSize = 65536) => {
    const ciphertext = Buffer.alloc(4 + content.header.length + content.bytes.length);
    return renderWrapper({
      title: 'Size test',
      payload: { ...metadata, v: content.v, tag: '', ciphertext: toBase64Chunks(ciphertext, chunkSize) }
    });
  };
  const incompressible = randomFillSync(Buffer.alloc(8192));
  const partlyCompressible = Buffer.concat([randomFillSync(Buffer.alloc(7000)), Buffer.alloc(1192)]);
  const smallGain = Buffer.concat([randomFillSync(Buffer.alloc(7900)), Buffer.alloc(292)]);
  assert.ok(gzipSync(smallGain).length < smallGain.length);
  assert.equal(
    (await prepareContent(smallGain, file, metadata, 65536)).v,
    2,
    'reject gzip savings that do not pay for the embedded decoder'
  );
  for (const chunkSize of [40, 65, 65536]) {
    for (const bytes of [
      Buffer.alloc(COMPRESSION_THRESHOLD - 1),
      Buffer.alloc(COMPRESSION_THRESHOLD),
      incompressible,
      partlyCompressible,
      smallGain,
      Buffer.alloc(65536)
    ]) {
      const result = await prepareContent(bytes, file, metadata, chunkSize);
      const raw = { bytes, header: Buffer.from(JSON.stringify(file)), v: 2 };
      const compressed = {
        bytes: gzipSync(bytes),
        header: Buffer.from(JSON.stringify({ ...file, originalSize: bytes.length })),
        v: 3
      };
      const worthwhile =
        bytes.length >= COMPRESSION_THRESHOLD &&
        Buffer.byteLength(asHtml(compressed, chunkSize)) < Buffer.byteLength(asHtml(raw, chunkSize));
      assert.equal(result.v, worthwhile ? 3 : 2, `size ${bytes.length}, chunk width ${chunkSize}`);
      assert.ok(Buffer.byteLength(asHtml(result, chunkSize)) <= Buffer.byteLength(asHtml(raw, chunkSize)));
      if (result.v === 2) assert.ok(!asHtml(result).includes('DecompressionStream'));
    }
  }
  const fileInfo = { name: 'fallback.txt', type: 'text/plain' };
  for (const missing of ['CompressionStream', 'DecompressionStream']) {
    const { html } = await createThroughUi(source, Buffer.alloc(8192), fileInfo, {
      password: 'test',
      globals: { [missing]: undefined }
    });
    const payload = wrapper(html).payload;
    assert.equal(payload.v, 2);
    assert.ok(!html.includes('DecompressionStream'));
  }
  const overLimit = Buffer.alloc(25 * 1024 * 1024 + 1);
  assert.equal((await prepareContent(overLimit, file, metadata, 65536)).v, 2);
});

test('compressed module-created and CLI envelopes restore exactly 25 MiB in both access modes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'staticseal-gzip-'));
  try {
    const bytes = Buffer.alloc(25 * 1024 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i & 255;
    const file = { name: 'compressed.bin', type: 'application/octet-stream' };
    await writeFile(join(dir, file.name), bytes);
    for (const access of ['passphrase', 'sealed']) {
      const payload = await makePayload(bytes, 'test', 160000, file, access, true);
      assert.equal(payload.v, access === 'sealed' ? 5 : 3);
      const appHtml = renderWrapper({ title: 'Compressed', payload });
      assert.ok(appHtml.includes('DecompressionStream'));
      assert.ok(!appHtml.includes('CompressionStream'));
      assert.ok(Buffer.byteLength(appHtml) < 200000);
      const cli = spawnSync(
        process.execPath,
        [
          'bin/self-encrypt.mjs',
          '--in',
          join(dir, file.name),
          '--out',
          join(dir, 'sealed.html'),
          '--iterations',
          '160000',
          '--chunk-size',
          '65',
          '--private-filename',
          access === 'sealed' ? '--no-password' : '--stdin-password'
        ],
        { cwd: new URL('..', import.meta.url), input: 'test\n', encoding: 'utf8' }
      );
      assert.equal(cli.status, 0, cli.stderr);
      const cliHtml = await readFile(join(dir, 'sealed.html'), 'utf8');
      for (const html of [appHtml, cliHtml]) {
        const reader = wrapper(html);

        assert.equal(reader.payload.v, access === 'sealed' ? 5 : 3);
        assert.deepEqual(Buffer.from(await reader.open('test')), bytes);
        const restored = await decodePayload(reader.payload, 'test');
        assert.equal(restored.filename, file.name);
        assert.equal(restored.contentType, file.type);
        if (access === 'passphrase') {
          await assert.rejects(reader.open('wrong-password'));
          const changed = { ...reader.payload, v: 2 };
          await assert.rejects(wrapper(html, changed).open('test'));
        } else {
          assert.ok(!html.includes('crypto.subtle'));
          assert.ok(!html.includes('PBKDF2'));
        }
        assert.ok(!html.includes(file.name));
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('gzip restoration rejects damaged streams, invalid sizes and unsupported browsers', async () => {
  const bytes = Buffer.alloc(8192, 255);
  const content = {
    bytes: gzipSync(bytes),
    originalSize: bytes.length,
    filename: 'test.bin',
    contentType: 'application/octet-stream'
  };
  // Exercise the serialized minified helper too; it must have no module closure.
  const built = await import('../src/reader-factories.mjs');
  for (const helper of [inflateContent, built.inflateContent]) {
    const inflate = vm.runInNewContext('(' + helper.toString() + ')', {
      Blob,
      DecompressionStream,
      Uint8Array,
      DOMException
    });
    assert.deepEqual(Buffer.from((await inflate(content, createFormat().MAX_EXPANDED_BYTES)).bytes), bytes);
    await assert.rejects(inflate(content), /Invalid or oversized compressed content/);
    for (const originalSize of [undefined, -1, 1.5, 128 * 1024 * 1024 + 1, bytes.length - 1, bytes.length + 1]) {
      await assert.rejects(inflate({ ...content, originalSize }, createFormat().MAX_EXPANDED_BYTES));
    }
    for (const data of [new Uint8Array([1, 2, 3]), content.bytes.subarray(0, -1)]) {
      await assert.rejects(inflate({ ...content, bytes: data }, createFormat().MAX_EXPANDED_BYTES));
    }
  }
  const payload = await makePayload(
    bytes,
    'test',
    160000,
    { name: content.filename, type: content.contentType },
    'passphrase'
  );
  const html = renderWrapper({ title: 'Unsupported browser', payload });
  const reader = wrapper(html, undefined, { globals: { DecompressionStream: undefined } });
  reader.nodes.get('password').value = 'test';
  await reader.nodes.get('unlock-form').handlers.submit({ preventDefault() {} });
  assert.match(reader.nodes.get('status').textContent, /gzip decompression support/);
});
