// Creates a disposable, local-only harness. No test hooks are added to index.html.
// Usage: node test/build-browser-smoke.mjs /absolute/output/directory
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const out = resolve(process.argv[2] || '/tmp/staticseal-browser-smoke');
await mkdir(out, { recursive: true });
const embeddingName = '<!--<script>.txt';
const embeddingBytes = new Uint8Array([0, 1, 128, 255]);
const previewCases = [
  ['source.html', 'text/html', '<script>alert("source only")</script><div title="x">Hello</div>', 'html'],
  ['data.json', 'application/json', '{"key":"<img src=x>","count":42,"ready":true}', 'json'],
  ['note.md', 'text/markdown', '# C#\n\n**Bold**\n\n```js\nconst count = 42;\n```', 'markdown'],
  ['long.txt', 'text/plain', 'ä'.repeat(100000), 'truncated'],
  ['dense.json', 'application/json', '0 '.repeat(65536), 'dense'],
  ['drawing.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="15" fill="green"/></svg>', 'svg']
];
await writeFile(join(out, embeddingName), embeddingBytes);
const cli = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/self-encrypt.mjs', import.meta.url)),
  '--in', join(out, embeddingName), '--out', join(out, 'embedding-cli.html'), '--stdin-password'],
  { input: 'browser-test-only\n', encoding: 'utf8' });
if (cli.status !== 0) throw new Error(cli.stderr || 'CLI fixture generation failed.');
let html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const end = html.lastIndexOf('})();');
html = html.slice(0, end) + 'window.smoke = { encryptBytes, renderWrapper };\n' + html.slice(end);
const runner = `
(async () => {
  const results = document.createElement('pre');
  results.id = 'smoke-results';
  document.body.prepend(results);
  const log = text => results.textContent += text + '\\n';
  log('Browser: ' + navigator.userAgent);
  const check = (ok, label) => { if (!ok) throw new Error(label); };
  try {
    const embeddingName = ${JSON.stringify(embeddingName).replaceAll('<', '\\u003c')};
    const embeddingBytes = new Uint8Array([0, 1, 128, 255]);
    const embeddingPayload = await smoke.encryptBytes(embeddingBytes, 'browser-test-only', 210000,
      { name: embeddingName, type: 'text/plain' }, 'passphrase', false);
    for (const [generator, html] of [
      ['app', smoke.renderWrapper({ title: embeddingName, sourceName: embeddingName, payload: embeddingPayload })],
      ['CLI', await (await fetch('embedding-cli.html')).text()]
    ]) {
      const end = html.lastIndexOf('})();');
      const frame = document.createElement('iframe');
      const loaded = new Promise(resolve => frame.onload = resolve);
      frame.srcdoc = html.slice(0, end) + 'window.reader = { unlock, renderBlobViewer };' + html.slice(end);
      document.body.append(frame);
      await loaded;
      try {
        // The browser must parse the complete generated document, not extracted scripts.
        const parsed = JSON.parse(frame.contentDocument.getElementById('encrypted-payload').textContent);
        check(parsed.filename === embeddingName, generator + ': filename changed during HTML parsing');
        check(frame.contentWindow.reader, generator + ': unlock script did not execute');
        const decoded = await frame.contentWindow.reader.unlock('browser-test-only');
        check(decoded.length === embeddingBytes.length && decoded.every((value, i) => value === embeddingBytes[i]),
          generator + ': embedding roundtrip mismatch');
        frame.contentWindow.reader.renderBlobViewer(decoded);
        check(frame.contentDocument.body.textContent.includes(embeddingName), generator + ': name not restored');
        log('PASS: ' + generator + ' / public filename with HTML script-parser control sequences');
      } finally { frame.remove(); }
    }
    for (const [name, type, text, kind] of ${JSON.stringify(previewCases).replaceAll('<', '\\u003c')}) {
      const bytes = new TextEncoder().encode(text);
      const payload = await smoke.encryptBytes(bytes, 'preview-test', 210000, { name, type }, 'sealed', true);
      let wrapped = smoke.renderWrapper({ title: name, sourceName: name, payload });
      const end = wrapped.lastIndexOf('})();');
      wrapped = wrapped.slice(0, end) + 'window.reader = { unlock, renderBlobViewer };' + wrapped.slice(end);
      const frame = document.createElement('iframe');
      const loaded = new Promise(resolve => frame.onload = resolve);
      frame.srcdoc = wrapped;
      document.body.append(frame);
      await loaded;
      try {
        const reader = frame.contentWindow.reader;
        reader.renderBlobViewer(await reader.unlock('preview-test'));
        const doc = frame.contentDocument;
        const pre = doc.getElementById('text-preview');
        if (kind === 'html' || kind === 'json' || kind === 'dense') {
          check(pre.textContent === text, name + ': source text changed');
          check(!pre.querySelector('script, img, div'), name + ': active source became DOM');
          check(kind === 'dense' ? !pre.querySelector('span') : !!pre.querySelector('.syntax-' + (kind === 'html' ? 'tag' : 'key')), name + ': highlighting/fallback');
        } else if (kind === 'markdown') {
          check(doc.querySelector('article h1').textContent === 'C#', name + ': heading changed');
          check(doc.querySelector('article strong').textContent === 'Bold', name + ': emphasis');
          check(!!doc.querySelector('article code .syntax-keyword'), name + ': fenced code colors');
        } else if (kind === 'truncated') {
          check(pre.textContent === text.slice(0, 65536), name + ': truncation boundary');
          check(pre.nextElementSibling.classList.contains('preview-end'), name + ': missing end notice');
        } else {
          const image = doc.querySelector('.image-frame');
          await image.decode();
          check(image.naturalWidth === 40, name + ': SVG image did not render');
        }
        log('PASS: preview / ' + kind + ' / real DOM');
      } finally { frame.remove(); }
    }
    for (const size of [10, 25]) for (const access of ['passphrase', 'sealed']) {
      const bytes = new Uint8Array(size * 1024 * 1024);
      for (let i=0; i<bytes.length; i++) bytes[i] = i & 255;
      const file = { name: 'Private-test.bin', type: 'application/octet-stream' };
      const secret = 'browser-test-only';
      const payload = await smoke.encryptBytes(bytes, secret, 600000, file, access, true);
      let wrapped = smoke.renderWrapper({ title: file.name, sourceName: file.name, payload });
      check(!wrapped.includes(file.name), 'filename leaked');
      const end = wrapped.lastIndexOf('})();');
      wrapped = wrapped.slice(0, end) + 'window.reader = { unlock, renderBlobViewer };' + wrapped.slice(end);
      const frame = document.createElement('iframe');
      const loaded = new Promise(resolve => frame.onload = resolve);
      frame.srcdoc = wrapped;
      document.body.append(frame);
      await loaded;
      const reader = frame.contentWindow.reader;
      const decoded = await reader.unlock(secret);
      check(decoded.length === bytes.length, 'length mismatch');
      for (let i=0; i<bytes.length; i++) check(decoded[i] === bytes[i], 'byte mismatch');
      reader.renderBlobViewer(decoded);
      check(frame.contentDocument.body.textContent.includes(file.name), 'name not restored');
      let rejected = false;
      try { await reader.unlock('wrong'); } catch { rejected = true; }
      check(rejected, 'wrong password accepted');
      frame.remove();
      log('PASS: ' + size + ' MiB / ' + access + ' / private filename / 600k / wrapper roundtrip + viewer + wrong password');
    }
    log('DONE');
  } catch (error) { log('FAIL: ' + error.stack); }
})();`;
const bodyEnd = html.lastIndexOf('</body>');
html = html.slice(0, bodyEnd) + '<script>' + runner + '</script>' + html.slice(bodyEnd);
await writeFile(join(out, 'smoke.html'), html);
console.log(join(out, 'smoke.html'));
