import { decodePayload } from './helpers/payload.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { webcrypto, randomFillSync } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { wrapper, createThroughUi } from './helpers/html-harness.mjs';

const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');

for (const access of ['passphrase', 'sealed']) {
  test(`18 MiB raw / ${access}: built app, CLI and raw reader roundtrips`, async () => {
    // Base64, metadata and the reader must fit inside 25 MiB of final HTML.
    const oversized = randomFillSync(Buffer.alloc(20 * 1024 * 1024));
    await assert.rejects(
      createThroughUi(
        source,
        oversized,
        { name: 'large.bin', type: 'application/octet-stream' },
        { password: access === 'sealed' ? '' : 'test' }
      ),
      /HTML package exceeds the 25 MiB/
    );
    const bytes = oversized.subarray(0, 18 * 1024 * 1024);
    const password = access === 'sealed' ? '' : 'regression-test-password';
    const file = { name: 'large.bin', type: 'application/octet-stream' };
    const { html: appHtml } = await createThroughUi(source, bytes, file, { password });
    const dir = await mkdtemp(join(tmpdir(), 'staticseal-test-'));
    try {
      await writeFile(join(dir, file.name), bytes);
      const result = spawnSync(
        process.execPath,
        [
          'bin/self-encrypt.mjs',
          '--in',
          join(dir, file.name),
          '--out',
          join(dir, 'locked.html'),
          access === 'sealed' ? '--no-password' : '--stdin-password'
        ],
        { cwd: new URL('..', import.meta.url), input: password + '\n', encoding: 'utf8' }
      );
      assert.equal(result.status, 0, result.stderr);
      const packedSize =
        bytes.length + 4 + Buffer.byteLength(JSON.stringify({ filename: file.name, contentType: file.type }));
      for (const html of [appHtml, await readFile(join(dir, 'locked.html'), 'utf8')]) {
        assert.ok(Buffer.byteLength(html) <= 25 * 1024 * 1024);
        const reader = wrapper(html);
        assert.equal(reader.payload.v, access === 'sealed' ? 4 : 2);
        assert.equal((reader.payload.content || reader.payload.ciphertext).length, Math.ceil(packedSize / 49152));
        assert.deepEqual(Buffer.from(await reader.open(password)), bytes);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test('browser and CLI roundtrip matrix preserves privacy, viewer isolation and standalone readers', async () => {
  const factories = await import('../src/reader-factories.mjs');
  assert.deepEqual(Object.keys(factories).sort(), [
    'collectionViewerSource',
    'createCodePreview',
    'createCollection',
    'createCollectionReader',
    'createCollectionViewer',
    'createCrypto',
    'createFileTypes',
    'createFileViewer',
    'createFormat',
    'createFramedPageViewer',
    'createMarkdownPreview',
    'createPageViewer',
    'createPreview',
    'createZip',
    'inflateContent',
    'isHtmlFile',
    'openWebsite',
    'renderImagePreview',
    'renderPageFrame',
    'renderPdfPreview',
    'renderTextPreview'
  ]);
  const readOnlyCrypto = {
    getRandomValues() {
      assert.fail('Reader must not generate creation randomness');
    },
    subtle: new Proxy(webcrypto.subtle, {
      get(target, property) {
        if (['encrypt', 'generateKey', 'wrapKey'].includes(property))
          return () => assert.fail('Reader must not use ' + property);
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    })
  };
  assert.equal((source.match(/<svg id=(?:"seal-logo"|seal-logo(?=[\s>]))/g) || []).length, 1);
  const dir = await mkdtemp(join(tmpdir(), 'staticseal-reader-audit-'));
  try {
    for (const compressed of [false, true]) {
      const bytes = Buffer.from(
        '<!doctype html><meta charset="utf-8"><title>Original page</title><style>p{color:teal}</style><p>Eigenständiger Reader 🔒</p><script>globalThis.pageReady=true</script>' +
          (compressed ? 'Repeated reader audit content.\n'.repeat(6000) : '')
      );
      const file = { name: 'reader-audit.html', type: 'text/html' };
      await writeFile(join(dir, file.name), bytes);
      for (const page of [false, true])
        for (const encrypted of [false, true]) {
          const password = encrypted ? 'standalone-audit-only' : '';
          const { html: browserHtml } = await createThroughUi(source, bytes, file, { password, htmlPage: page });
          const result = spawnSync(
            process.execPath,
            [
              'bin/self-encrypt.mjs',
              '--in',
              join(dir, file.name),
              '--out',
              join(dir, 'reader.html'),
              '--iterations',
              '160000',
              ...(page ? ['--html-page'] : []),
              encrypted ? '--stdin-password' : '--no-password'
            ],
            { cwd: new URL('..', import.meta.url), input: password + '\n', encoding: 'utf8' }
          );
          assert.equal(result.status, 0, result.stderr);
          for (const html of [browserHtml, await readFile(join(dir, 'reader.html'), 'utf8')]) {
            assert.doesNotMatch(html, /STATICSEAL_/);
            assert.equal((html.match(/<svg id=(?:"seal-logo"|seal-logo(?=[\s>]))/g) || []).length, 1);
            assert.equal(html.includes('DecompressionStream'), compressed);
            assert.equal(html.includes('crypto.subtle'), encrypted);
            assert.equal(html.includes('Preview limited to'), !page);
            assert.equal(html.includes('document.write'), page);
            assert.ok(!html.includes(file.name));
            assert.doesNotMatch(html, /<script\b[^>]*\bsrc=|<link\b[^>]*\bhref=/i);
            const reader = wrapper(html, undefined, {
              globals: {
                crypto: encrypted ? readOnlyCrypto : undefined,
                CompressionStream: undefined,
                Response: undefined,
                fetch: undefined
              }
            });
            assert.equal(reader.payload.display, page ? 'page' : undefined);
            assert.equal(reader.payload.filename, undefined);
            assert.equal(reader.payload.contentType, undefined);
            assert.equal(reader.payload.v, (encrypted ? 2 : 4) + Number(compressed));
            const opened = Buffer.from(await reader.open(password));
            const expected =
              page && html === browserHtml ? Buffer.from((await decodePayload(reader.payload, password)).bytes) : bytes;
            assert.deepEqual(opened, expected);
            if (page && html === browserHtml) {
              assert.match(opened.toString(), /<title>Original page<\/title>/);
              assert.match(opened.toString(), /globalThis.pageReady=true/);
            }
            if (page) {
              assert.equal(reader.document.writtenHtml, expected.toString());
              assert.equal(reader.document.robots.name, 'robots');
              assert.equal(reader.document.robots.content, 'noindex,nofollow,noarchive');
            }
            if (encrypted && !compressed) {
              const rejected = wrapper(html);
              await assert.rejects(rejected.open('wrong-password'));
              assert.equal(rejected.blobs.length, 0);
              assert.equal(rejected.document.writtenHtml, undefined);
              if (page) await assert.rejects(wrapper(html, { ...reader.payload, display: undefined }).open(password));
            }
          }
        }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
