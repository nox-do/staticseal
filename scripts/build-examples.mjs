// Static GitHub Pages examples. Example code stays out of the browser app.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { embedSelectedHtml, inspectHtmlSelection } from '../src/html-import.mjs';
import { packCollection, createCollection } from '../src/collection.mjs';
import { preparePackage } from '../src/creation.mjs';
import { createFormat } from '../src/format.mjs';
import { createCrypto } from '../src/crypto.mjs';
import { inflateContent } from '../src/gzip.mjs';
import { renderWrapper } from '../src/wrapper.mjs';
import { bundleReport } from '../bin/lib/report.mjs';
import { createSourceLoader } from '../bin/lib/source.mjs';

const root = new URL('../examples/', import.meta.url);
const checking = process.argv.includes('--check');
const window = new Window({
  settings: {
    disableJavaScriptEvaluation: true,
    disableCSSFileLoading: true,
    disableIframePageLoading: true
  }
});
async function save(path, bytes) {
  if (checking)
    assert.deepEqual(await readFile(new URL(path, root)), Buffer.from(bytes), path + ' is stale; run npm run build.');
  else await writeFile(new URL(path, root), bytes);
}
async function sealedExample(output, plain, file, collection = false, readerFiles) {
  const content = await preparePackage(plain, file, {
    readerFiles,
    access: 'sealed',
    htmlPage: !collection && file.contentType === 'text/html',
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
async function protectedJupyterExample(folder, report) {
  const title = 'Demo-Passwort: seal';
  const output = new URL('sealed.html', folder);
  async function verify() {
    const html = await readFile(output, 'utf8');
    const payload = JSON.parse(
      html.match(/<script id="encrypted-payload" type="application\/json">([\s\S]*?)<\/script>/)[1]
    );
    const format = createFormat();
    assert.ok(format.isEncryptedVersion(payload.v), 'Jupyter example must be encrypted.');
    assert.equal(payload.access, 'passphrase');
    assert.equal(payload.display, 'page');
    assert.equal(
      html,
      renderWrapper({ title, payload, files: [{ filename: 'bericht.html', contentType: 'text/html' }] }),
      'Jupyter reader is stale.'
    );
    const plain = await createCrypto().decryptPayload(payload, 'seal', format.fromBase64, format.fromBase64Chunks);
    let decoded = format.unpackContent(plain, payload);
    if (format.isCompressedVersion(payload.v)) decoded = await inflateContent(decoded, format.MAX_EXPANDED_BYTES);
    assert.equal(decoded.filename, 'bericht.html');
    assert.equal(decoded.contentType, 'text/html');
    assert.deepEqual(Buffer.from(decoded.bytes), report, 'Jupyter contents are stale.');
  }
  if (checking) return verify();
  try {
    await verify();
  } catch {
    execFileSync(
      process.execPath,
      [
        fileURLToPath(new URL('../bin/self-encrypt.mjs', import.meta.url)),
        '--in',
        fileURLToPath(new URL('bericht.html', folder)),
        '--out',
        fileURLToPath(output),
        '--html-page',
        '--title',
        title,
        '--stdin-password'
      ],
      { input: 'seal\n', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    await verify();
  }
}
async function protectedPdfExample(entries) {
  const output = new URL('pdf/sealed.html', root);
  const title = 'Demo-Passwort: seal';
  const file = { filename: 'dokumente.seal', contentType: 'application/vnd.staticseal.collection' };
  const plain = packCollection(entries);
  const format = createFormat();
  async function verify() {
    const html = await readFile(output, 'utf8');
    const payload = JSON.parse(
      html.match(/<script id="encrypted-payload" type="application\/json">([\s\S]*?)<\/script>/)[1]
    );
    assert.ok(format.isEncryptedVersion(payload.v), 'PDF example must be encrypted.');
    assert.equal(payload.access, 'passphrase');
    assert.equal(payload.display, 'collection');
    assert.equal(html, renderWrapper({ title, payload, files: entries }), 'PDF reader is stale.');
    const decrypted = await createCrypto().decryptPayload(payload, 'seal', format.fromBase64, format.fromBase64Chunks);
    let decoded = format.unpackContent(decrypted, payload);
    if (format.isCompressedVersion(payload.v)) decoded = await inflateContent(decoded, format.MAX_EXPANDED_BYTES);
    assert.equal(decoded.filename, file.filename);
    assert.equal(decoded.contentType, file.contentType);
    assert.deepEqual(Buffer.from(decoded.bytes), Buffer.from(plain), 'PDF collection is stale.');
  }
  if (checking) return verify();
  try {
    await verify();
  } catch {
    const content = await preparePackage(plain, file, {
      access: 'passphrase',
      collection: true,
      readerFiles: entries,
      iterations: 210000,
      salt: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64'),
      iv: Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString('base64'),
      chunkSize: 65536
    });
    const payload = content.metadata;
    const helper = createCrypto();
    const key = await helper.deriveKey('seal', format.fromBase64(payload.salt), payload.iterations, ['encrypt']);
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: format.fromBase64(payload.iv), additionalData: helper.authenticatedDataFor(payload) },
        key,
        Buffer.concat([content.lengthPrefix, content.header, content.bytes])
      )
    );
    payload.ciphertext = [Buffer.from(encrypted.subarray(0, -16)).toString('base64')];
    payload.tag = Buffer.from(encrypted.subarray(-16)).toString('base64');
    await writeFile(output, renderWrapper({ title, payload, files: entries }));
    await verify();
  }
}
async function buildFilesExample() {
  const names = ['umsatz.svg', 'notiz.md'];
  const entries = await Promise.all(
    names.map(async filename => ({
      filename,
      contentType: filename.endsWith('.svg') ? 'image/svg+xml' : 'text/markdown',
      bytes: await readFile(new URL('files/' + filename, root))
    }))
  );
  await sealedExample(
    new URL('files/sealed.html', root),
    packCollection(entries),
    { filename: 'briefing.seal', contentType: 'application/vnd.staticseal.collection' },
    true,
    entries
  );
  await save('files/sources.zip', new Uint8Array(await createCollection().zip(entries).arrayBuffer()));
}
async function buildHtmlExamples() {
  const htmlSources = await Promise.all(
    [
      ['index.html', 'text/html'],
      ['prozess.png', 'image/png'],
      ['site.css', 'text/css'],
      ['methodik/annahmen.html', 'text/html']
    ].map(async ([filename, contentType]) => {
      const bytes = await readFile(new URL('html/' + filename, root));
      return {
        filename,
        contentType,
        bytes,
        path: filename,
        file: { type: contentType, arrayBuffer: async () => bytes }
      };
    })
  );
  assert.equal(inspectHtmlSelection(htmlSources).entry, htmlSources[0], 'Website entry must be detected.');
  const prepared = await embedSelectedHtml(htmlSources, htmlSources[0], {
    parse: text => new window.DOMParser().parseFromString(text, 'text/html')
  });
  assert.deepEqual(prepared.warnings, [], 'HTML scenario must embed its PNG without warnings.');
  assert.ok(
    !new TextDecoder().decode(prepared.bytes).includes('example-guide-title'),
    'Plain website must omit the example guide.'
  );
  assert.ok(prepared.used.has(htmlSources[1]), 'HTML scenario must use its PNG.');
  assert.equal(prepared.pageCount, 2, 'Website must include its linked methodology page.');
  assert.ok(prepared.used.has(htmlSources[2]), 'Website must embed the shared stylesheet.');
  assert.ok(prepared.used.has(htmlSources[3]), 'Linked page must not remain an independent attachment.');
  const preparedDocument = new window.DOMParser().parseFromString(
    new TextDecoder().decode(prepared.bytes),
    'text/html'
  );
  assert.ok(
    preparedDocument
      .querySelector('script')
      .textContent.includes('data:image/png;base64,' + htmlSources[1].bytes.toString('base64')),
    'Scenario PNG bytes must be preserved.'
  );
  await sealedExample(new URL('html/sealed.html', root), prepared.bytes, {
    filename: 'index.html',
    contentType: 'text/html'
  });
  await save('html/sources.zip', new Uint8Array(await createCollection().zip(htmlSources).arrayBuffer()));
  const missingImage = await embedSelectedHtml(htmlSources.slice(0, 1), htmlSources[0], {
    parse: text => new window.DOMParser().parseFromString(text, 'text/html')
  });
  assert.ok(
    missingImage.warnings.some(warning => warning.includes('prozess.png')),
    'Missing scenario image must produce a warning.'
  );
  const noteBytes = await readFile(new URL('html/notizen.md', root));
  const note = {
    filename: 'notizen.md',
    path: 'notizen.md',
    bytes: noteBytes,
    file: { type: 'text/markdown', arrayBuffer: async () => noteBytes }
  };
  const guide = await readFile(new URL('../templates/example-html-guide.html', import.meta.url), 'utf8');
  const extrasSources = htmlSources.map(source => {
    if (source.contentType !== 'text/html') return source;
    const bytes = Buffer.from(source.bytes.toString().replace('<body>', '<body>\n' + guide));
    return { ...source, bytes, file: { type: source.contentType, arrayBuffer: async () => bytes } };
  });
  const withExtras = [...extrasSources, note];
  const importedExtras = await embedSelectedHtml(withExtras, extrasSources[0], {
    parse: text => new window.DOMParser().parseFromString(text, 'text/html')
  });
  assert.deepEqual(importedExtras.warnings, [], 'Additional files must not cause an import warning.');
  assert.ok(
    new TextDecoder().decode(importedExtras.bytes).includes('example-guide-title'),
    'Attachment example must include its separate explanation.'
  );
  assert.ok(importedExtras.used.has(htmlSources[1]), 'PNG must be embedded.');
  assert.equal(importedExtras.pageCount, 2, 'Attachment variant must preserve both website pages.');
  assert.ok(!importedExtras.used.has(note), 'Note must remain independent.');
  const extraEntries = [{ filename: 'index.html', contentType: 'text/html', page: true, bytes: importedExtras.bytes }];
  for (const item of withExtras) {
    if (item !== extrasSources[0] && (!importedExtras.used.has(item) || importedExtras.retained.has(item))) {
      extraEntries.push({ filename: item.path, contentType: item.file.type, bytes: item.bytes });
    }
  }
  assert.deepEqual(
    extraEntries.map(item => item.filename),
    ['index.html', 'notizen.md']
  );
  await sealedExample(
    new URL('html/sealed-extras.html', root),
    packCollection(extraEntries),
    {
      filename: 'files.seal',
      contentType: 'application/vnd.staticseal.collection'
    },
    true,
    extraEntries
  );
  await save('html/sources-extras.zip', new Uint8Array(await createCollection().zip(withExtras).arrayBuffer()));
}
async function buildPdfExample() {
  const pdfEntries = await Promise.all(
    ['brief.pdf', 'plan.pdf'].map(async filename => ({
      filename,
      contentType: 'application/pdf',
      bytes: await readFile(new URL('pdf/' + filename, root))
    }))
  );
  await protectedPdfExample(pdfEntries);
  await save('pdf/sources.zip', new Uint8Array(await createCollection().zip(pdfEntries).arrayBuffer()));
}
async function buildPythonReport() {
  const folder = new URL('python-report/', root);
  const load = createSourceLoader({ root: folder });
  const source = await load(new URL('bericht.html', folder));
  const sourceDocument = new window.DOMParser().parseFromString(source.bytes.toString(), 'text/html');
  assert.equal(sourceDocument.querySelector('img').getAttribute('src'), 'umsatz.png');
  assert.equal(sourceDocument.querySelector('link[rel="stylesheet"]').getAttribute('href'), 'bericht.css');
  const report = await bundleReport(source, load);
  assert.deepEqual(report.warnings, [], 'Python report must bundle without warnings.');
  const document = new window.DOMParser().parseFromString(report.bytes.toString(), 'text/html');
  const png = await readFile(new URL('umsatz.png', folder));
  const css = await readFile(new URL('bericht.css', folder));
  assert.equal(document.querySelector('img').getAttribute('src'), 'data:image/png;base64,' + png.toString('base64'));
  assert.equal(
    document.querySelector('link[rel="stylesheet"]').getAttribute('href'),
    'data:text/css;base64,' + css.toString('base64')
  );
  await sealedExample(new URL('sealed.html', folder), report.bytes, {
    filename: 'bericht.html',
    contentType: 'text/html'
  });
  const sources = [
    'README.md',
    'requirements.txt',
    'generate.py',
    'bericht.html.j2',
    'bericht.css',
    'bericht.html',
    'umsatz.png',
    'sealed.html'
  ];
  const entries = await Promise.all(
    sources.map(async filename => ({ filename, bytes: await readFile(new URL(filename, folder)) }))
  );
  await save('python-report/sources.zip', new Uint8Array(await createCollection().zip(entries).arrayBuffer()));
}
async function buildJupyterExample() {
  const jupyter = new URL('jupyter/', root);
  const report = await readFile(new URL('bericht.html', jupyter));
  const reportDocument = new window.DOMParser().parseFromString(report.toString(), 'text/html');
  assert.ok(
    reportDocument.querySelector('img')?.getAttribute('src').startsWith('data:image/png;base64,'),
    'Jupyter export must already contain its chart.'
  );
  await protectedJupyterExample(jupyter, report);
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
}
async function verifyExampleNavigation() {
  for (const [path, expectedSamples] of [
    ['index.html', 4],
    ['cli/index.html', 2]
  ]) {
    const pageUrl = new URL(path, root);
    const doc = new window.DOMParser().parseFromString(await readFile(pageUrl, 'utf8'), 'text/html');
    let samples = 0;
    for (const link of doc.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href');
      if (/^(?:[a-z][\w+.-]*:|#)/i.test(href)) continue;
      await readFile(new URL(href, pageUrl));
      if (!/\/sealed(?:-extras)?\.html$/.test(href)) continue;
      samples++;
      assert.equal(link.getAttribute('target'), '_blank', 'Samples must keep their overview open.');
      assert.ok(link.relList.contains('noopener'), 'Sample tabs must be independent of their overview.');
    }
    assert.equal(samples, expectedSamples, 'All sample entry points must be checked.');
  }
}
try {
  await buildFilesExample();
  await buildHtmlExamples();
  await buildPdfExample();
  await buildJupyterExample();
  await buildPythonReport();
  await verifyExampleNavigation();
  console.log(checking ? 'Examples are current.' : 'Built Staticseal examples and source ZIPs.');
} finally {
  await window.happyDOM.close();
}
