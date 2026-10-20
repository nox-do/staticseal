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
const pageBase = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Self-contained page</title><style>body{margin:0;background:#faf7f0;color:#233d46;font:18px system-ui}h1{color:#c7332b}section{min-height:100vh}</style></head><body><h1>Grüße – the original page</h1><button id="interact">Click me</button><output id="state">Waiting</output><a href="#bottom">Jump to end</a><script>const state=document.getElementById("state");state.textContent="Script ready";document.getElementById("interact").onclick=()=>{state.textContent="Clicked";document.body.classList.add("clicked")};window.addEventListener("load",()=>document.body.dataset.loaded="yes");</script>EXTRA<section id="bottom">Full page end</section></body></html>';
const pageCases = [];
for (const large of [false, true]) for (const access of ['sealed', 'passphrase']) {
  const text = pageBase.replace('EXTRA', large ? '<!--' + 'No page truncation.\n'.repeat(9000) + '-->' : '');
  const cliName = 'page-' + access + '-' + Number(large) + '.html';
  await writeFile(join(out, 'demo-page.html'), text);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/self-encrypt.mjs', import.meta.url)),
    '--in', join(out, 'demo-page.html'), '--out', join(out, cliName), '--html-page',
    access === 'sealed' ? '--no-password' : '--stdin-password', '--private-filename'],
    { input: 'page-test\n', encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'CLI page fixture failed.');
  const generated = await readFile(join(out, cliName), 'utf8');
  const end = generated.lastIndexOf('})();');
  await writeFile(join(out, 'inspect-' + cliName), generated.slice(0, end)
    + ';window.reader = { unlock, renderBlobViewer };' + generated.slice(end));
  pageCases.push({ large, access, text, cliName });
}
let html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const end = html.lastIndexOf('})();');
html = html.slice(0, end) + ';window.smoke = { encryptBytes, renderWrapper };\n' + html.slice(end);
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
      frame.srcdoc = html.slice(0, end) + ';window.reader = { unlock, renderBlobViewer };' + html.slice(end);
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
      wrapped = wrapped.slice(0, end) + ';window.reader = { unlock, renderBlobViewer };' + wrapped.slice(end);
      const frame = document.createElement('iframe');
      const loaded = new Promise(resolve => frame.onload = resolve);
      frame.srcdoc = wrapped;
      document.body.append(frame);
      await loaded;
      try {
        const reader = frame.contentWindow.reader;
        reader.renderBlobViewer(await reader.unlock('preview-test'));
        const doc = frame.contentDocument;
        const pre = doc.getElementById('tp');
        if (kind === 'html' || kind === 'json' || kind === 'dense') {
          check(pre.textContent === text, name + ': source text changed');
          check(!pre.querySelector('script, img, div'), name + ': active source became DOM');
          check(kind === 'dense' ? !pre.querySelector('span') : !!pre.querySelector('.s-' + (kind === 'html' ? 'tag' : 'key')), name + ': highlighting/fallback');
        } else if (kind === 'markdown') {
          check(doc.querySelector('article h1').textContent === 'C#', name + ': heading changed');
          check(doc.querySelector('article strong').textContent === 'Bold', name + ': emphasis');
          check(!!doc.querySelector('article code .s-keyword'), name + ': fenced code colors');
        } else if (kind === 'truncated') {
          check(pre.textContent === text.slice(0, 65536), name + ': truncation boundary');
          check(pre.nextElementSibling.classList.contains('pe'), name + ': missing end notice');
        } else {
          const image = doc.querySelector('.im');
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
      wrapped = wrapped.slice(0, end) + ';window.reader = { unlock, renderBlobViewer };' + wrapped.slice(end);
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
      if (access === 'passphrase') {
        let rejected = false;
        try { await reader.unlock('wrong'); } catch { rejected = true; }
        check(rejected, 'wrong password accepted');
      } else {
        check(!wrapped.includes('crypto.subtle') && !wrapped.includes('PBKDF2'), 'plain reader contains crypto');
        const opened = await reader.unlock('');
        check(opened.length === bytes.length && opened.every((value, i) => value === bytes[i]), 'plain reader needs a password');
      }
      frame.remove();
      log('PASS: ' + size + ' MiB / ' + access + ' / private filename / ' + (access === 'sealed' ? 'no crypto / exact roundtrip + viewer' : '600k / wrapper roundtrip + viewer + wrong password'));
    }
    // The real creator UI must expose the page choice only for the selected HTML file.
    const fileInput = document.getElementById('source-file');
    const choice = document.getElementById('html-page');
    const choiceRow = document.getElementById('html-page-option');
    check(getComputedStyle(choiceRow).display === 'none', 'page choice initially visible');
    const selectFile = file => {
      const transfer = new DataTransfer();transfer.items.add(file);fileInput.files = transfer.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    };
    selectFile(new File(['<h1>Page</h1>'], 'choice.html', { type: 'text/html' }));
    check(!choice.disabled && !choice.checked && getComputedStyle(choiceRow).display !== 'none', 'HTML choice unavailable');
    choice.checked = true;
    selectFile(new File(['text'], 'choice.txt', { type: 'text/plain' }));
    check(choice.disabled && !choice.checked && getComputedStyle(choiceRow).display === 'none', 'non-HTML choice not reset');
    log('PASS: creator / HTML-only page switch / default off / reset on file change');
    for (const row of ${JSON.stringify(pageCases).replaceAll('<', '\\u003c')}) {
      const bytes = new TextEncoder().encode(row.text);
      const payload = await smoke.encryptBytes(bytes, 'page-test', 210000,
        { name: 'demo-page.html', type: 'text/html' }, row.access, true, true);
      const appHtml = smoke.renderWrapper({ title: 'Page', payload });
      for (const generator of ['CLI', 'app']) {
        const frame = document.createElement('iframe');
        const loaded = new Promise(resolve => frame.onload = resolve);
        if (generator === 'app') {
          const end = appHtml.lastIndexOf('})();');
          frame.srcdoc = appHtml.slice(0, end) + ';window.reader={unlock,renderBlobViewer};' + appHtml.slice(end);
        } else frame.src = 'inspect-' + row.cliName;
        document.body.append(frame);await loaded;
        try {
          const reader = frame.contentWindow.reader;
          check(reader, 'page decoder missing');
          const decoded = await reader.unlock('page-test');
          check(decoded.length === bytes.length && decoded.every((value, i) => value === bytes[i]), 'page bytes differ');
          if (row.access === 'passphrase') {
            let rejected = false;try { await reader.unlock('wrong'); } catch { rejected = true; }
            check(rejected, 'page accepted wrong password');
          }
          // document.open() is not an iframe navigation. Wait for the new DOM,
          // rather than requiring a second load event on the parent iframe element.
          const deadline = performance.now() + 5000;
          if (row.access === 'passphrase') frame.contentDocument.getElementById('password').value = 'page-test';
          frame.contentDocument.getElementById('unlock-form').requestSubmit();
          while (frame.contentDocument?.getElementById('state')?.textContent !== 'Script ready') {
            if (performance.now() > deadline) throw new Error('page DOM did not become ready');
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          const doc = frame.contentDocument;
          check(doc.title === 'Self-contained page', 'original page title missing');
          check(!doc.getElementById('unlock-form') && !doc.getElementById('tp'), 'wrapper/preview remains');
          check(doc.getElementById('state').textContent === 'Script ready', 'inline script did not run');
          check(frame.contentWindow.getComputedStyle(doc.body).backgroundColor === 'rgb(250, 247, 240)', 'original CSS missing');
          check(doc.getElementById('bottom').textContent === 'Full page end', 'full page truncated');
          check(doc.querySelector('meta[name="robots"]').content === 'noindex,nofollow,noarchive', 'robots hint lost');
          doc.getElementById('interact').click();
          check(doc.getElementById('state').textContent === 'Clicked' && doc.body.classList.contains('clicked'), 'page interaction broken');
          if (generator === 'CLI') {
            doc.querySelector('a[href="#bottom"]').click();
            check(frame.contentWindow.location.hash === '#bottom' && doc.getElementById('state').textContent === 'Clicked', 'fragment link reloaded the wrapper');
          }
          log('PASS: page / ' + generator + ' / ' + row.access + ' / ' + (row.large ? 'gzip' : 'raw') + ' / CSS + scripts + interaction + full content');
        } finally { frame.remove(); }
      }
    }
    log('DONE');
  } catch (error) { log('FAIL: ' + error.stack); }
})();`;
const bodyEnd = html.lastIndexOf('</body>');
html = html.slice(0, bodyEnd) + '<script>' + runner + '</script>' + html.slice(bodyEnd);
await writeFile(join(out, 'smoke.html'), html);
console.log(join(out, 'smoke.html'));
