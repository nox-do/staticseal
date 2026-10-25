import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createFormat } from '../src/format.mjs';
import { PREPARED_MAX_BYTES } from '../src/limits.mjs';
import { createCrypto } from '../src/crypto.mjs';
import { preparePackage } from '../src/creation.mjs';
import { renderWrapper } from '../src/wrapper.mjs';
import { wrapper } from './helpers/html-harness.mjs';
import { makePayload, decodePayload, verifyPayload } from './helpers/payload.mjs';

const { fromBase64Chunks, escapeHtml } = createFormat();

test('format rules and metadata bounds survive factory serialization without module scope', async () => {
  const built = await import('../src/reader-factories.mjs');
  for (const factory of [createFormat, built.createFormat]) {
    const format = vm.runInNewContext('(' + factory.toString() + ')()', { Uint8Array, TextDecoder });
    assert.equal(format.MAX_EXPANDED_BYTES, PREPARED_MAX_BYTES);
    for (const [version, access, compressed] of [
      [2, 'passphrase', false],
      [3, 'passphrase', true],
      [4, 'sealed', false],
      [5, 'sealed', true]
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
    for (const invalid of [
      new Uint8Array(0),
      new Uint8Array([0, 0, 0, 8]),
      new Uint8Array([255, 255, 255, 255]),
      new Uint8Array([0, 0, 0, 2, 123, 125]),
      new Uint8Array([0, 0, 0, 1, 255])
    ]) {
      assert.throws(() => format.unpackContent(invalid, { v: 2, encoding: 'metadata' }));
    }
    for (const encoding of ['bytes', 'private-metadata']) {
      assert.throws(() => format.unpackContent(packed, { v: 2, encoding }), /Unsupported payload format/);
    }
    packed.writeUInt32BE(65537);
    assert.throws(() => format.unpackContent(packed, { v: 2, encoding: 'metadata' }), /Invalid file metadata/);
  }
});

test('authenticated metadata retains its exact historical order and omission rules', () => {
  // Deliberately scramble input insertion order; the literal expected bytes are the wire contract.
  const metadata = {
    display: 'page',
    iv: 'iv',
    salt: 'salt',
    access: 'passphrase',
    contentType: 'text/html',
    filename: 'Grüße.html',
    encoding: 'metadata',
    iterations: 210000,
    kdf: 'PBKDF2-SHA256',
    alg: 'AES-GCM',
    v: 3,
    ignored: 'extra'
  };
  const aad = createCrypto().authenticatedDataFor;
  assert.equal(
    Buffer.from(aad(metadata)).toString('utf8'),
    '{"v":3,"alg":"AES-GCM","kdf":"PBKDF2-SHA256","iterations":210000,"encoding":"metadata","filename":"Grüße.html","contentType":"text/html","access":"passphrase","salt":"salt","iv":"iv","display":"page"}'
  );
  assert.equal(
    Buffer.from(aad({ ...metadata, filename: undefined, contentType: undefined, display: undefined })).toString('utf8'),
    '{"v":3,"alg":"AES-GCM","kdf":"PBKDF2-SHA256","iterations":210000,"encoding":"metadata","access":"passphrase","salt":"salt","iv":"iv"}'
  );
  assert.equal(
    Buffer.from(aad({ ...metadata, unlockKey: 'legacy' })).toString('utf8'),
    '{"v":3,"alg":"AES-GCM","kdf":"PBKDF2-SHA256","iterations":210000,"encoding":"metadata","filename":"Grüße.html","contentType":"text/html","access":"passphrase","unlockKey":"legacy","salt":"salt","iv":"iv","display":"page"}'
  );
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
    for (const { inputIndex, mode, access, payload } of fixture.cases) {
      const input = fixture.inputs[inputIndex];
      // Nonzero offset ensures that the preparation does not assume a whole backing buffer.
      const storage = Buffer.concat([
        Buffer.from([255]),
        Buffer.from(input.text.repeat(input.repeat)),
        Buffer.from([255])
      ]);
      const bytes = storage.subarray(1, -1);
      const file = { filename: 'compat.html', contentType: 'text/html' };
      const content = await preparePackage(bytes, file, {
        access,
        iterations: 100000,
        salt: payload.salt,
        iv: payload.iv,
        htmlPage: mode === 'page',
        chunkSize: 65536
      });
      const expectedMetadata = Object.fromEntries(
        Object.entries(payload).filter(
          ([key]) => !['content', 'ciphertext', 'tag', 'filename', 'contentType'].includes(key)
        )
      );
      assert.equal(JSON.stringify(content.metadata), JSON.stringify(expectedMetadata));
      assert.equal(
        Buffer.from(content.header).toString('utf8'),
        JSON.stringify({ ...file, ...(inputIndex === 1 ? { originalSize: bytes.length } : {}) })
      );
      assert.equal(content.lengthPrefix.byteLength, 4);
      assert.equal(Buffer.from(content.lengthPrefix).readUInt32BE(), content.header.byteLength);
      if (inputIndex === 0) assert.equal(content.bytes, bytes, 'raw input must be returned without a file copy');
    }
  }
});

test('public metadata with HTML control sequences survives JSON embedding and wrapper decryption', async () => {
  const bytes = new Uint8Array([0, 1, 128, 255]);
  const names = [
    '<!--<script>.txt',
    '</script><script>alert(1)</script>.txt',
    'a"&<>内部.txt',
    'STATICSEAL_TITLE_STATICSEAL_READER_$&_$`_内部.txt'
  ];
  for (const name of names) {
    const payload = await makePayload(bytes, 'test', 210000, { name, type: 'text/plain' }, 'passphrase');
    const html = renderWrapper({ title: name, payload });
    const embedded = html.match(/<script id="encrypted-payload" type="application\/json">([\s\S]*?)<\/script>/)[1];
    assert.deepEqual(JSON.parse(embedded), payload);
    assert.ok(!embedded.includes('\n'), 'Payload JSON stays compact');
    assert.ok(html.includes('<title>' + escapeHtml(name) + '</title>'));
    assert.ok(!embedded.includes('<'), 'JSON must not contain raw HTML control sequences');
    const reader = wrapper(html);
    assert.equal(reader.payload.filename, name);
    assert.deepEqual(Buffer.from(await reader.open('test')), Buffer.from(bytes));
    assert.equal((await decodePayload(reader.payload, 'test')).filename, name);
  }
  // Full HTML parsing for both generators is covered by build-browser-smoke.mjs.
});

test('chunk boundaries, empty input, independently padded chunks and tag', () => {
  assert.deepEqual(fromBase64Chunks([]), new Uint8Array(0));
  assert.deepEqual(fromBase64Chunks(['YQ==', 'YmM=', 'ZGVm']), new TextEncoder().encode('abcdef'));
  for (const size of [0, 1, 2, 3, 49_151, 49_152, 49_153]) {
    const bytes = Buffer.alloc(size, 255);
    const chunks = [bytes.subarray(0, 49152).toString('base64'), bytes.subarray(49152).toString('base64')];
    assert.deepEqual(
      Buffer.from(fromBase64Chunks(chunks, new Uint8Array([1, 2]))),
      Buffer.concat([bytes, Buffer.from([1, 2])])
    );
  }
});

test('every authenticated metadata field rejects tampering, including KDF parameters', async () => {
  const bytes = new Uint8Array([0, 1, 2, 255]);
  const key = 'test-secret';
  const payload = await makePayload(
    bytes,
    key,
    210000,
    { name: 'small.bin', type: 'application/octet-stream' },
    'passphrase'
  );
  const html = renderWrapper({ title: 'Test', payload });
  for (const field of [
    'v',
    'alg',
    'kdf',
    'iterations',
    'encoding',
    'filename',
    'contentType',
    'access',
    'unlockKey',
    'salt',
    'iv',
    'display'
  ]) {
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
  for (const field of ['tag', 'ciphertext']) {
    const changed = { ...payload };
    const encoded = field === 'tag' ? payload.tag : payload.ciphertext[0];
    const corrupted = Buffer.from(encoded, 'base64');
    corrupted[0] ^= 1;
    changed[field] =
      field === 'tag' ? corrupted.toString('base64') : [corrupted.toString('base64'), ...payload.ciphertext.slice(1)];
    await assert.rejects(verifyPayload(changed, key, bytes), field);
    await assert.rejects(wrapper(html, changed).open(key), field);
  }
});
