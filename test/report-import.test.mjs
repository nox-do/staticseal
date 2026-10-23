import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { Window } from 'happy-dom';
import { bundleReport } from '../bin/lib/report.mjs';
import { createSourceLoader, sourceUrl } from '../bin/lib/source.mjs';
import { readMhtml } from '../bin/lib/mhtml.mjs';
import { wrapper } from './helpers/html-harness.mjs';

const run = args =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['bin/self-encrypt.mjs', ...args]);
    let stdout = '',
      stderr = '';
    child.stdout.on('data', data => (stdout += data));
    child.stderr.on('data', data => (stderr += data));
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
const decodeData = value => Buffer.from(value.slice(value.indexOf(',') + 1), 'base64');
const document = text => {
  const window = new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true
    }
  });
  return new window.DOMParser().parseFromString(text, 'text/html');
};

test('CLI bundles report folders, classic scripts, CSS imports, fonts, images and frames without running scripts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'seal-report-'));
  try {
    await mkdir(join(dir, 'Report-Dateien'));
    const assets = {
      'report.htm':
        '<html><head><link rel="stylesheet" href="Report-Dateien/main.css"></head><body><script src="Report-Dateien/chart.js" defer></script><img src="Report-Dateien/chart.svg"><img srcset="Report-Dateien/chart.svg 1x"><iframe src="Report-Dateien/sheet.htm"></iframe><iframe srcdoc="&lt;img src=&quot;Report-Dateien/chart.svg&quot;&gt;"></iframe><a href="#chart">Chart</a><h1 id="chart">Report</h1></body></html>',
      'Report-Dateien/main.css':
        '@import "palette.css";@font-face{font-family:Report;src:url(font.woff2)}body{background:url(chart.svg)}',
      'Report-Dateien/palette.css': 'h1{color:green}',
      'Report-Dateien/chart.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
      'Report-Dateien/font.woff2': 'test-font',
      'Report-Dateien/chart.js': 'globalThis.REPORT_READY=true;throw Error("must not execute during import");',
      'Report-Dateien/sheet.htm': '<h2 id="chart">Sheet</h2><img src="chart.svg"><a href="#chart">Chart</a>'
    };
    for (const [name, text] of Object.entries(assets)) await writeFile(join(dir, name), text);
    const output = join(dir, 'sealed.html');
    const result = await run([
      '--in',
      pathToFileURL(join(dir, 'report.htm')).href,
      '--out',
      output,
      '--bundle',
      '--no-password'
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /dynamic dependencies/);
    assert.doesNotMatch(result.stderr, /must not execute|Not embedded|Missing or ambiguous/);
    const reader = wrapper(await readFile(output, 'utf8'));
    assert.equal(reader.payload.display, 'page');
    const doc = document(Buffer.from(await reader.open()).toString());
    assert.equal(
      decodeData(doc.querySelector('script[src]').getAttribute('src')).toString(),
      assets['Report-Dateien/chart.js']
    );
    const css = decodeData(doc.querySelector('link').getAttribute('href')).toString();
    assert.match(css, /data:font\/woff2;base64/);
    assert.match(css, /data:image\/svg\+xml;base64/);
    assert.match(decodeData(css.match(/@import url\("([^"]+)/)[1]).toString(), /color:green/);
    assert.match(doc.querySelector('iframe').getAttribute('srcdoc'), /data:image\/svg\+xml;base64/);
    assert.match(doc.querySelectorAll('iframe')[1].getAttribute('srcdoc'), /data:image\/svg\+xml;base64/);
    const sheet = document(doc.querySelector('iframe').getAttribute('srcdoc'));
    const script = sheet.querySelector('script').textContent;
    let handler;
    let scrolled = false;
    let prevented = false;
    sheet.getElementById('chart').scrollIntoView = () => {
      scrolled = true;
    };
    const add = sheet.addEventListener.bind(sheet);
    sheet.addEventListener = (type, listener) => {
      handler = listener;
      add(type, listener);
    };
    new Function('document', script)(sheet);
    handler({
      target: sheet.querySelector('a'),
      button: 0,
      preventDefault() {
        prevented = true;
      }
    });
    assert.ok(prevented && scrolled);
    assert.equal(doc.querySelector('a').getAttribute('href'), '#chart');
    assert.match(doc.querySelector('[srcset]').getAttribute('srcset'), /data:image\/svg\+xml/);
    // The default mode is deliberately byte preserving.
    const plain = await run(['--in', join(dir, 'report.htm'), '--out', output, '--html-page', '--no-password']);
    assert.equal(plain.code, 0, plain.stderr);
    assert.deepEqual(
      Buffer.from(await wrapper(await readFile(output, 'utf8')).open()),
      Buffer.from(assets['report.htm'])
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('HTTP reports follow redirects and base URLs, reuse downloads, ignore CORS and report missing/module dependencies', async () => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    if (req.url === '/start') {
      res.writeHead(302, { location: '/reports/view?id=7' }).end();
      return;
    }
    const values = {
      '/reports/view?id=7': [
        'text/html',
        '<base href="/assets/"><link rel="stylesheet" href="style.css"><img src="chart.svg"><img src="chart.svg"><img src="missing.svg"><script src="chart.js"></script><script type="module" src="module.js"></script><a href="next.html">Next</a>'
      ],
      '/assets/style.css': ['text/css', 'h1{background:url(chart.svg)}'],
      '/assets/chart.svg': ['image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>'],
      '/assets/chart.js': ['text/javascript', 'window.chartLoaded=true']
    };
    const entry = values[req.url];
    if (!entry) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader('Content-Type', entry[0]);
    res.end(entry[1]);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const dir = await mkdtemp(join(tmpdir(), 'seal-http-'));
  try {
    const url = 'http://127.0.0.1:' + server.address().port;
    const result = await run(['--in', url + '/start', '--out', join(dir, 'sealed.html'), '--bundle', '--no-password']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /HTTP 404/);
    assert.match(result.stderr, /modules are not bundled/);
    assert.equal(requests.filter(path => path === '/assets/chart.svg').length, 1);
    assert.ok(!requests.includes('/assets/module.js'));
    assert.ok(!requests.includes('/assets/next.html'));
    const reader = wrapper(await readFile(join(dir, 'sealed.html'), 'utf8'));
    const doc = document(Buffer.from(await reader.open()).toString());
    assert.equal(doc.querySelector('base'), null);
    assert.ok(doc.querySelector('img').src.startsWith('data:image/svg+xml'));
    assert.equal(doc.querySelector('a').getAttribute('href'), url + '/assets/next.html');
    assert.equal(doc.querySelectorAll('img')[2].getAttribute('src'), url + '/assets/missing.svg');
    const failure = await run(['--in', url + '/missing', '--out', join(dir, 'sealed.html'), '--no-password']);
    assert.equal(failure.code, 1);
    assert.match(failure.stderr, /HTTP 404/);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

function archive(parts, boundary = '=_report.+') {
  return Buffer.from(
    'MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="' +
      boundary +
      '"; start="<root>"\r\n\r\n' +
      parts.map(([headers, body]) => '--' + boundary + '\r\n' + headers + '\r\n\r\n' + body + '\r\n').join('') +
      '--' +
      boundary +
      '--\r\n',
    'latin1'
  );
}
test('MHTML exports resolve Content-Location/CID, quoted-printable, charsets and base64 without network access', async () => {
  const bytes = archive([
    [
      'Content-Type: text/html; charset=windows-1252\r\nContent-ID: <root>\r\nContent-Location: https://report.invalid/report.htm\r\nContent-Transfer-Encoding: quoted-printable',
      '<title>Gr=FC=DFe</title><link rel="stylesheet" href="style.css"><img src="cid:chart"><iframe src="cid:sheet"></iframe><p>Report</p>'
    ],
    ['Content-Type: text/css\r\nContent-Location: https://report.invalid/style.css', 'p{color:green}'],
    [
      'Content-Type: image/png\r\nContent-ID: <chart>\r\nContent-Transfer-Encoding: base64',
      Buffer.from([0, 13, 10, 255]).toString('base64')
    ],
    ['Content-Type: text/html\r\nContent-ID: <sheet>', '<h2>Archived sheet</h2><img src="cid:chart">']
  ]);
  let requests = 0;
  const result = await bundleReport(
    { bytes, url: new URL('file:///tmp/report.mht'), name: 'report.mht', type: 'application/octet-stream' },
    () => {
      requests++;
      throw Error('no fetch');
    }
  );
  assert.equal(requests, 0);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.name, 'report.html');
  const doc = document(result.bytes.toString());
  assert.equal(doc.title, 'Grüße');
  assert.deepEqual(decodeData(doc.querySelector('img').src), Buffer.from([0, 13, 10, 255]));
  assert.equal(decodeData(doc.querySelector('link').href).toString(), 'p{color:green}');
  assert.match(doc.querySelector('iframe').getAttribute('srcdoc'), /data:image\/png;base64/);
  assert.throws(
    () => readMhtml(bytes.subarray(0, bytes.length - 30), new URL('file:///tmp/a.mht')),
    /closing boundary/
  );
  const binary = archive([
    ['Content-Type: text/html\r\nContent-ID: <root>', '<h1>Report</h1>'],
    ['Content-Type: image/png\r\nContent-ID: <binary>\r\nContent-Transfer-Encoding: binary', '\x00\n\xff\r\n\x80']
  ]);
  assert.deepEqual(
    readMhtml(binary, new URL('file:///tmp/a.mht')).resources.get('cid:binary').bytes,
    Buffer.from('\x00\n\xff\r\n\x80', 'latin1')
  );
});

test('local report authority rejects traversal and symlinks unless a containing resource root is supplied', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'seal-root-'));
  try {
    await mkdir(join(dir, 'report'));
    await writeFile(join(dir, 'image.svg'), '<svg/>');
    await symlink(join(dir, 'image.svg'), join(dir, 'report/link.svg'));
    const url = pathToFileURL(join(dir, 'report/report.html'));
    const load = createSourceLoader({ root: join(dir, 'report') });
    await assert.rejects(load(new URL('../image.svg', url)), /outside the report directory/);
    await assert.rejects(load(new URL('link.svg', url)), /outside the report directory/);
    assert.equal((await createSourceLoader({ root: dir })(new URL('link.svg', url))).bytes.toString(), '<svg/>');
    await assert.rejects(createSourceLoader()(new URL('ftp://example.com/report')), /Unsupported resource protocol/);
    await assert.rejects(createSourceLoader({ allowFiles: false })(url), /remote report cannot read local files/);
    await assert.rejects(createSourceLoader({ maxBytes: 1 })(sourceUrl(join(dir, 'image.svg'))), /128 MiB/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
