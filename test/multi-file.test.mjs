import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createCollection, packCollection } from '../src/collection.mjs';
import { inspectHtmlSelection } from '../src/html-import.mjs';
import { preparePackage } from '../src/creation.mjs';
import { renderWrapper } from '../src/wrapper.mjs';
import { makePayload, decodePayload } from './helpers/payload.mjs';

const codec = createCollection();
const files = [
  { filename: 'docs/Grüße.pdf', contentType: 'application/pdf', bytes: new Uint8Array([0, 127, 255]) },
  { filename: 'image.png', contentType: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) },
  { filename: 'index.html', contentType: 'text/html', bytes: new TextEncoder().encode('<h1>Example</h1>'), page: true }
];

test('collection keeps original bytes, paths and page flags and disambiguates duplicate names', () => {
  const entries = codec.unpack(packCollection([...files, files[1]]));
  assert.deepEqual(
    entries.map(file => file.filename),
    ['docs/Grüße.pdf', 'image.png', 'index.html', 'image (2).png']
  );
  entries.forEach((entry, n) => assert.deepEqual(entry.bytes, [...files, files[1]][n].bytes));
  assert.equal(entries[2].page, true);
  assert.equal(entries[0].page, undefined);
});

test('collection rejects traversal, corrupt lengths, overlapping entries and oversized inputs', () => {
  for (const filename of ['../a', '/a', 'a/../b', 'a\\b', 'a:b', 'a//b'])
    assert.throws(() => packCollection([{ ...files[0], filename }]));
  assert.throws(() => packCollection([{ ...files[0], bytes: new Uint8Array(128 * 1024 * 1024) }]));
  const bytes = packCollection(files);
  assert.throws(() => codec.unpack(bytes.subarray(0, -1)));
  assert.throws(() => codec.unpack(new Uint8Array([...bytes, 0])));
  const corrupt = bytes.slice();
  new DataView(corrupt.buffer).setUint32(0, 0xffffffff);
  assert.throws(() => codec.unpack(corrupt));
  const header = new TextEncoder().encode(
    JSON.stringify({ v: 1, entries: [{ filename: 'a', contentType: 'text/plain', offset: 1, size: 0 }] })
  );
  const invalid = new Uint8Array(4 + header.length);
  new DataView(invalid.buffer).setUint32(0, header.length);
  invalid.set(header, 4);
  assert.throws(() => codec.unpack(invalid));
});

test('HTML detection accepts unique index variants and a single named page, otherwise falls back', () => {
  const inspect = paths => inspectHtmlSelection(paths.map(path => ({ path })));
  assert.equal(inspect(['folder/INDEX.HTM', 'folder/about.html']).entry.path, 'folder/INDEX.HTM');
  assert.equal(inspect(['site/index.html', 'site/help/index.htm']).entry.path, 'site/index.html');
  assert.equal(inspect(['report.html', 'a.png']).entry.path, 'report.html');
  for (const paths of [
    ['index.html', 'index.htm'],
    ['a/index.html', 'b/index.html'],
    ['a.html', 'b.html']
  ]) {
    assert.equal(inspect(paths).entry, null);
    assert.equal(inspect(paths).ambiguous, true);
  }
  assert.equal(inspect(['a.pdf', 'b.png']).ambiguous, false);
});

test('ZIP output carries UTF-8 paths, all original bytes and valid CRC32', async () => {
  const entries = codec.unpack(packCollection(files));
  const bytes = new Uint8Array(await codec.zip(entries).arrayBuffer());
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (const file of files) {
    assert.equal(view.getUint32(offset, true), 0x04034b50);
    assert.equal(view.getUint16(offset + 6, true), 0x800);
    const nameLength = view.getUint16(offset + 26, true);
    assert.equal(new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength)), file.filename);
    assert.deepEqual(
      bytes.subarray(offset + 30 + nameLength, offset + 30 + nameLength + file.bytes.length),
      file.bytes
    );
    offset += 30 + nameLength + file.bytes.length;
  }
  assert.equal(view.getUint32(offset, true), 0x02014b50);
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(bytes.length - 12, true), files.length);
  // Known CRC32 vector, independent of our implementation.
  const known = new Uint8Array(
    await codec.zip([{ filename: 'test', bytes: new TextEncoder().encode('123456789') }]).arrayBuffer()
  );
  assert.equal(new DataView(known.buffer).getUint32(14, true), 0xcbf43926);
});

test('collection display is authenticated and normal reader output omits collection logic', async () => {
  const prepared = await preparePackage(
    packCollection(files),
    { filename: 'files.seal', contentType: 'application/vnd.staticseal.collection' },
    { access: 'sealed', collection: true, chunkSize: 65536 }
  );
  assert.equal(prepared.metadata.display, 'collection');
  const normal = await makePayload(
    new Uint8Array([1, 2]),
    '',
    210000,
    { name: 'a.bin', type: 'application/octet-stream' },
    'sealed'
  );
  const normalHtml = renderWrapper({ title: 'file', payload: normal });
  assert.ok(!normalHtml.includes('Download all (ZIP)'));
  const storage = new Uint8Array(4 + prepared.header.length + prepared.bytes.length);
  storage.set(prepared.lengthPrefix);
  storage.set(prepared.header, 4);
  storage.set(prepared.bytes, 4 + prepared.header.length);
  const payload = { ...prepared.metadata, content: [Buffer.from(storage).toString('base64')] };
  assert.ok(renderWrapper({ title: 'collection', payload }).includes('Download all (ZIP)'));
  assert.ok(!renderWrapper({ title: 'collection', payload }).includes('Select between 1 and 1,000 files.'));
  assert.equal(createCollection().pack, undefined);
  const factories = await import('../src/reader-factories.mjs');
  assert.equal(factories.packCollection, undefined);
  assert.deepEqual(
    codec.unpack((await decodePayload(payload)).bytes).map(file => file.filename),
    files.map(file => file.filename)
  );
  const large = packCollection([{ ...files[0], bytes: new Uint8Array(30 * 1024 * 1024) }, files[1]]);
  for (const access of ['sealed', 'passphrase']) {
    const encrypted = await makePayload(
      large,
      'collection-test',
      100000,
      { name: 'files.seal', type: 'application/vnd.staticseal.collection' },
      access,
      true,
      false,
      true
    );
    assert.equal(encrypted.display, 'collection');
    assert.equal(encrypted.v, access === 'sealed' ? 5 : 3);
    assert.deepEqual((await decodePayload(encrypted, 'collection-test')).bytes, large);
    if (access !== 'sealed') {
      await assert.rejects(() => decodePayload(encrypted, 'wrong'));
      await assert.rejects(() => decodePayload({ ...encrypted, display: 'page' }, 'collection-test'));
    }
  }
});

test('the standalone creator includes folder selection and HTML import', async () => {
  const app = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(app.includes('id="source-folder"'));
  assert.ok(app.includes('webkitdirectory'));
  assert.ok(app.includes('Missing or ambiguous resource:'));
  assert.ok(!app.includes('privateFilename'));
  assert.ok(!app.includes('id="private-filename"'));
  assert.equal((app.match(/PDFs may contain/g) || []).length, 1);
});
