// Static GitHub Pages examples. No example code is included in either app.
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { embedSelectedHtml } from '../src/html-import.mjs';
import { packCollection, createCollection } from '../src/collection.mjs';
import { preparePackage } from '../src/creation.mjs';
import { createFormat } from '../src/format.mjs';
import { inflateContent } from '../src/gzip.mjs';
import { renderWrapper } from '../src/wrapper.mjs';

const root = new URL('../examples/fatseal/', import.meta.url);
const checking = process.argv.includes('--check');
const window = new Window({
  settings: {
    disableJavaScriptEvaluation: true,
    disableCSSFileLoading: true,
    disableIframePageLoading: true
  }
});
const files = [];
const types = { html: 'text/html', css: 'text/css', svg: 'image/svg+xml', md: 'text/markdown' };
async function walk(path = '') {
  for (const item of (await readdir(new URL('website/' + path, root), { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name, 'en')
  )) {
    if (item.name.startsWith('.')) continue;
    const name = path + item.name;
    if (item.isDirectory()) await walk(name + '/');
    else {
      const bytes = await readFile(new URL('website/' + name, root));
      files.push({
        path: 'Website/' + name,
        bytes,
        file: {
          type: types[name.split('.').pop()] || 'application/octet-stream',
          size: bytes.length,
          arrayBuffer: async () => Uint8Array.from(bytes).buffer
        }
      });
    }
  }
}
async function save(path, bytes) {
  if (checking)
    assert.deepEqual(await readFile(new URL(path, root)), Buffer.from(bytes), path + ' is stale; run npm run build.');
  else await writeFile(new URL(path, root), bytes);
}
async function sealedExample(output, plain, file, collection = false, readerFiles) {
  const content = await preparePackage(plain, file, {
    readerFiles,
    access: 'sealed',
    htmlPage: !collection,
    collection,
    chunkSize: 65536
  });
  const payload = {
    ...content.metadata,
    content: [Buffer.concat([content.lengthPrefix, content.header, content.bytes]).toString('base64')]
  };
  const html = renderWrapper({ payload, files: readerFiles });
  if (checking) {
    // Gzip bytes can differ across Node/zlib versions. Check the emitted reader,
    // public metadata and decoded original bytes rather than a compressor snapshot.
    const current = await readFile(output, 'utf8');
    const actual = JSON.parse(
      current.match(/<script id="encrypted-payload" type="application\/json">([\s\S]*?)<\/script>/)[1]
    );
    assert.equal(current, renderWrapper({ payload: actual, files: readerFiles }), 'Example reader is stale.');
    const { content: chunks, v, ...metadata } = actual;
    const { v: expectedVersion, ...expectedMetadata } = content.metadata;
    assert.ok(v === expectedVersion || v === (expectedVersion === 4 ? 5 : 4));
    assert.deepEqual(metadata, expectedMetadata);
    const format = createFormat();
    let decoded = format.unpackContent(format.fromBase64Chunks(chunks), actual);
    if (format.isCompressedVersion(v)) decoded = await inflateContent(decoded, format.MAX_EXPANDED_BYTES);
    assert.equal(decoded.filename, file.filename);
    assert.equal(decoded.contentType, file.contentType);
    assert.deepEqual(Buffer.from(decoded.bytes), Buffer.from(plain), 'Example contents are stale.');
  } else await writeFile(output, html);
}
async function example(id, selected) {
  const entry = selected.find(item => item.path === 'Website/index.html');
  const imported = await embedSelectedHtml(selected, entry, {
    parse: text => new window.DOMParser().parseFromString(text, 'text/html')
  });
  assert.equal(imported.pageCount, 3, 'Example must exercise both subpages.');
  assert.equal(imported.warnings.length > 0, id === 'warning', 'Unexpected example warnings.');
  const entries = [{ filename: entry.path, contentType: 'text/html', bytes: imported.bytes, page: true }];
  for (const item of selected) {
    if (item !== entry && (!imported.used.has(item) || imported.retained.has(item))) {
      entries.push({ filename: item.path, contentType: item.file.type, bytes: item.bytes });
    }
  }
  const collection = entries.length !== 1 || imported.warnings.length > 0;
  assert.equal(entries.length, id === 'extras' ? 3 : 1);
  const file = collection
    ? { filename: 'files.seal', contentType: 'application/vnd.staticseal.collection' }
    : { filename: 'index.html', contentType: 'text/html' };
  const plain = collection ? packCollection(entries) : imported.bytes;
  await sealedExample(new URL('demo-' + id + '.html', root), plain, file, collection, entries);
  await save(
    (id === 'website' ? 'website' : id === 'extras' ? 'website-mit-extras' : 'website-mit-luecke') + '.zip',
    new Uint8Array(
      await createCollection()
        .zip(selected.map(item => ({ filename: item.path, bytes: item.bytes })))
        .arrayBuffer()
    )
  );
}
try {
  await walk();
  const clean = files.filter(item => !/\/(?:extra\.svg|packliste\.md)$/.test(item.path));
  await example('website', clean);
  await example('extras', files);
  await example(
    'warning',
    clean.filter(item => !item.path.endsWith('/ausflug.svg'))
  );
  const jupyter = new URL('../jupyter/', root);
  const report = await readFile(new URL('bericht.html', jupyter));
  await sealedExample(new URL('sealed.html', jupyter), report, { filename: 'bericht.html', contentType: 'text/html' });
  const sources = [
    'bericht.ipynb',
    'auswertung.py',
    'requirements.txt',
    'offline.html.j2',
    'bericht.html',
    'sealed.html'
  ];
  const archive = new Uint8Array(
    await createCollection()
      .zip(
        await Promise.all(
          sources.map(async filename => ({
            filename: 'Jupyter-Beispiel/' + filename,
            bytes: await readFile(new URL(filename, jupyter))
          }))
        )
      )
      .arrayBuffer()
  );
  const archivePath = new URL('jupyter.zip', jupyter);
  if (checking) assert.deepEqual(await readFile(archivePath), Buffer.from(archive), 'Jupyter ZIP is stale.');
  else await writeFile(archivePath, archive);
  console.log(checking ? 'Examples are current.' : 'Built Staticseal examples and source ZIPs.');
} finally {
  await window.happyDOM.close();
}
