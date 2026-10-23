// Build a disposable real-browser harness. Production HTML is copied unchanged.
// Usage: node test/build-browser-smoke.mjs /absolute/output/directory
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const out = resolve(process.argv[2] || '/tmp/staticseal-browser-smoke');
await mkdir(out, { recursive: true });
const embeddingName = '<!--<script>.txt';
const previewCases = [
  ['source.html', 'text/html', '<script>alert("source only")</script><div title="x">Hello</div>', 'html'],
  ['data.json', 'application/json', '{"key":"<img src=x>","count":42,"ready":true}', 'json'],
  ['note.md', 'text/markdown', '# C#\n\n**Bold**\n\n```js\nconst count = 42;\n```', 'markdown'],
  ['long.txt', 'text/plain', 'ä'.repeat(100000), 'truncated'],
  ['dense.json', 'application/json', '0 '.repeat(65536), 'dense'],
  [
    'drawing.svg',
    'image/svg+xml',
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="15" fill="green"/></svg>',
    'svg'
  ]
];
function cli(input, output, args, password) {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('../bin/self-encrypt.mjs', import.meta.url)),
      '--in',
      join(out, input),
      '--out',
      join(out, output),
      ...args
    ],
    { input: password + '\n', encoding: 'utf8' }
  );
  if (result.status !== 0) throw new Error(result.stderr || 'CLI fixture generation failed.');
}
await writeFile(join(out, embeddingName), new Uint8Array([0, 1, 128, 255]));
cli(embeddingName, 'embedding-cli.html', ['--stdin-password'], 'browser-test-only');
const pageBase =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Self-contained page</title><style>body{margin:0;background:#faf7f0;color:#233d46;font:18px system-ui}h1{color:#c7332b}section{min-height:100vh}</style></head><body><h1>Grüße – the original page</h1><button id="interact">Click me</button><output id="state">Waiting</output><a href="#bottom">Jump to end</a><script>const state=document.getElementById("state");state.textContent="Script ready";document.getElementById("interact").onclick=()=>{state.textContent="Clicked";document.body.classList.add("clicked")};window.addEventListener("load",()=>document.body.dataset.loaded="yes");</script>EXTRA<section id="bottom">Full page end</section></body></html>';
const pageCases = [];
for (const large of [false, true])
  for (const access of ['sealed', 'passphrase']) {
    const text = pageBase.replace('EXTRA', large ? '<!--' + 'No page truncation.\n'.repeat(9000) + '-->' : '');
    const cliName = 'page-' + access + '-' + Number(large) + '.html';
    await writeFile(join(out, 'demo-page.html'), text);
    cli(
      'demo-page.html',
      cliName,
      ['--html-page', access === 'sealed' ? '--no-password' : '--stdin-password'],
      'page-test'
    );
    pageCases.push({ large, access, text, cliName });
  }
await writeFile(join(out, 'creator.html'), await readFile(new URL('../index.html', import.meta.url)));
await writeFile(join(out, 'smoke.js'), await readFile(new URL('./browser-smoke-runner.js', import.meta.url)));
await writeFile(join(out, 'fixtures.json'), JSON.stringify({ embeddingName, previewCases, pageCases }));
await writeFile(
  join(out, 'smoke.html'),
  '<!doctype html><meta charset="utf-8"><title>Staticseal browser smoke</title><h1>Staticseal browser smoke</h1><pre id="smoke-results"></pre><script src="smoke.js"></script>\n'
);
const fat = await readFile(new URL('../fatseal.html', import.meta.url), 'utf8');
const multiRunner = await readFile(new URL('./multi-file-smoke-runner.js', import.meta.url), 'utf8');
await writeFile(
  join(out, 'fatseal-smoke.html'),
  fat.replace(/<\/body>\s*<\/html>\s*$/, () => '<script>' + multiRunner + '</script></body></html>')
);
await writeFile(
  join(out, 'index.html'),
  '<!doctype html><meta charset="utf-8"><title>Browser checks</title><h1>Browser checks</h1><p><a href="smoke.html">Staticseal</a></p><p><a href="fatseal-smoke.html">FatSeal</a></p><p><a href="readers.html">Specialized readers</a></p>'
);
console.log(out);

// Exercise specialized readers in a real browser, including the one-page warning view.
const { makePayload } = await import('./helpers/payload.mjs');
const { packCollection } = await import('../src/collection.mjs');
const { renderWrapper } = await import('../src/wrapper.mjs');
const readerCases = [];
for (const [kind, files] of [
  [
    'image',
    [
      {
        filename: 'pixel.svg',
        contentType: 'image/svg+xml',
        bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>')
      }
    ]
  ],
  [
    'markdown',
    [
      {
        filename: 'note.md',
        contentType: 'text/markdown',
        bytes: Buffer.from('# Heading\n\n```json\n{"ok":true}\n```')
      }
    ]
  ],
  [
    'framed',
    [
      {
        filename: 'report.html',
        contentType: 'text/html',
        page: true,
        bytes: Buffer.from(
          '<h1>Report</h1><a href="#end">Jump</a><div style="height:900px"></div><h2 id="end">End</h2>'
        )
      }
    ]
  ],
  [
    'collection',
    [
      { filename: 'note.txt', contentType: 'text/plain', bytes: Buffer.from('First entry') },
      {
        filename: 'image.svg',
        contentType: 'image/svg+xml',
        bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>')
      }
    ]
  ]
]) {
  const collection = kind === 'framed' || kind === 'collection';
  const payload = await makePayload(
    collection ? packCollection(files) : files[0].bytes,
    '',
    100000,
    {
      name: collection ? 'files.seal' : files[0].filename,
      type: collection ? 'application/vnd.staticseal.collection' : files[0].contentType
    },
    'sealed',
    true,
    false,
    collection
  );
  readerCases.push({ kind, html: renderWrapper({ payload, files }) });
}
await writeFile(
  join(out, 'readers.html'),
  '<!doctype html><title>Reader checks running</title><h1>Specialized reader checks</h1><div id="results"></div><script>window.readerCases=' +
    JSON.stringify(readerCases).replaceAll('<', '\\u003c') +
    ';</script><script src="readers.js"></script>'
);
await writeFile(join(out, 'readers.js'), await readFile(new URL('./readers-smoke-runner.js', import.meta.url)));
