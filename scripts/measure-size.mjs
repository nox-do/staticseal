// Measure real CLI output; keep randomness and product compression selection intact.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}):\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const utf8Bytes = text => Buffer.byteLength(text, 'utf8');

// Rebuild via the normal build only. Keep stdout as a machine-readable JSON report.
run(process.execPath, ['scripts/build.mjs']);
const app = await readFile(new URL('../index.html', import.meta.url));
const fatApp = await readFile(new URL('../fatseal.html', import.meta.url));
const sourceCommit = run('git', ['rev-parse', 'HEAD']);
const trackedChanges = run('git', ['diff', 'HEAD', '--name-only']).split('\n').filter(Boolean);
const options = {
  filename: 'sample.html',
  title: 'Größenmessung – Staticseal',
  buttonLabel: 'Öffnen',
  iterations: 210000,
  chunkSize: 65536,
  password: 'staticseal-size-fixture-only',
  minimal: false,
  theme: null
};
const page = body =>
  '<!doctype html><html lang="de"><meta charset="utf-8">' +
  '<title>Größenmessung</title><body>' +
  body +
  '</body></html>\n';
const paragraph = '<p>Grüße aus Berlin – feste Testdaten für Staticseal. 🔒</p>\n';
const fixtures = [
  { id: 'small-raw', compression: 'raw', bytes: Buffer.from(page(paragraph), 'utf8') },
  { id: 'repeated-gzip', compression: 'gzip', bytes: Buffer.from(page(paragraph.repeat(2048)), 'utf8') }
];
const readers = [];
const directory = await mkdtemp(join(tmpdir(), 'staticseal-size-'));
try {
  for (const fixture of fixtures) {
    const input = join(directory, options.filename);
    const output = join(directory, 'reader.html');
    await writeFile(input, fixture.bytes);
    for (const mode of ['file', 'page'])
      for (const access of ['passphrase', 'sealed']) {
        run(
          process.execPath,
          [
            'bin/self-encrypt.mjs',
            '--in',
            input,
            '--out',
            output,
            '--title',
            options.title,
            '--button-label',
            options.buttonLabel,
            '--iterations',
            String(options.iterations),
            '--chunk-size',
            String(options.chunkSize),
            access === 'passphrase' ? '--stdin-password' : '--no-password',
            ...(mode === 'page' ? ['--html-page'] : [])
          ],
          { input: options.password + '\n' }
        );
        const bytes = await readFile(output);
        const html = bytes.toString('utf8');
        assert.equal(utf8Bytes(html), bytes.byteLength, 'Output must be valid UTF-8');
        // Measure the emitted (HTML-escaped) JSON, not a reserialization of it.
        const blocks = [
          ...html.matchAll(/<script id="encrypted-payload" type="application\/json">([\s\S]*?)<\/script>/g)
        ];
        assert.equal(blocks.length, 1, 'Expected exactly one payload block');
        const json = blocks[0][1];
        const payload = JSON.parse(json);
        const expectedVersion = (access === 'passphrase' ? 2 : 4) + (fixture.compression === 'gzip' ? 1 : 0);
        assert.equal(payload.v, expectedVersion, 'Fixture no longer exercises its intended compression path');
        assert.equal(payload.access, access);
        assert.equal(payload.display, mode === 'page' ? 'page' : undefined);
        const chunks = payload.content ?? payload.ciphertext;
        const payloadJsonBytes = utf8Bytes(json);
        readers.push({
          fixture: fixture.id,
          mode,
          access,
          compression: fixture.compression,
          payloadVersion: payload.v,
          originalBytes: fixture.bytes.byteLength,
          htmlBytes: bytes.byteLength,
          payloadJsonBytes,
          wrapperBytes: bytes.byteLength - payloadJsonBytes,
          binaryPackageBytes:
            chunks.reduce((sum, chunk) => sum + Buffer.from(chunk, 'base64').byteLength, 0) +
            (payload.tag ? Buffer.from(payload.tag, 'base64').byteLength : 0),
          chunks: chunks.length
        });
      }
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
console.log(
  JSON.stringify(
    {
      sourceCommit,
      trackedChanges,
      runtime: { node: process.version, zlib: process.versions.zlib, platform: process.platform, arch: process.arch },
      options,
      fixtures: fixtures.map(({ id, compression, bytes }) => ({
        id,
        compression,
        bytes: bytes.byteLength,
        sha256: sha256(bytes)
      })),
      app: { path: 'index.html', utf8Bytes: app.byteLength, sha256: sha256(app) },
      fatApp: { path: 'fatseal.html', utf8Bytes: fatApp.byteLength, sha256: sha256(fatApp) },
      readers
    },
    null,
    2
  )
);
