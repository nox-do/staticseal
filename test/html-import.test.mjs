import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { embedSelectedHtml } from '../src/html-import.mjs';
import { packCollection, createCollection } from '../src/collection.mjs';

const window = new Window({ settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
const parse = text => new window.DOMParser().parseFromString(text, 'text/html');
const selected = (path, body, type = '') => {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return { path, reads: 0, file: { type, size: bytes.length, async arrayBuffer() { this.owner.reads++; return bytes.slice().buffer; } } };
};
function files(...items) {
  items.forEach(item => item.file.owner = item);
  return items;
}
const dataBytes = value => Buffer.from(value.slice(value.indexOf(',') + 1).split('#')[0], 'base64');
const html = result => parse(new TextDecoder().decode(result.bytes));
const imported = (items, options = {}) => embedSelectedHtml(items, items[0], { parse, ...options });
const warning = (result, text) => result.warnings.some(value => value.includes(text));

test('embedded image keeps a working original download link', async () => {
  const png = new Uint8Array([0, 127, 255]);
  const items = files(selected('index.html', '<img src="pic.png"><a download href="pic.png">Original</a>'), selected('pic.png', png, 'image/png'));
  const result = await imported(items), doc = html(result);
  assert.deepEqual(dataBytes(doc.querySelector('a').getAttribute('href')), Buffer.from(png));
  assert.equal(result.warnings.length, 0);
  assert.equal(items[1].reads, 1);
});

test('unrewritten consumers retain an embedded file in collection and ZIP', async () => {
  const png = new Uint8Array([0, 127, 255]);
  const items = files(selected('index.html', '<img src="pic.png"><a href="pic.png">View</a>'), selected('pic.png', png, 'image/png'));
  const result = await imported(items);
  assert.ok(result.used.has(items[1]));
  assert.ok(result.retained.has(items[1]));
  assert.ok(warning(result, 'Link target kept as a separate file'));
  const entries = [{ filename: 'index.html', contentType: 'text/html', bytes: result.bytes, page: true },
    ...items.slice(1).filter(item => !result.used.has(item) || result.retained.has(item)).map(item => ({ filename: item.path, contentType: item.file.type, bytes: png }))];
  const restored = createCollection().unpack(packCollection(entries));
  assert.deepEqual(restored[1].bytes, png);
  assert.ok(new Uint8Array(await createCollection().zip(restored).arrayBuffer()).length > png.length);
});

test('download of embedded CSS restores original bytes, not the transformed stylesheet', async () => {
  const css = 'body{background:url(pic.png)}';
  const items = files(selected('index.html', '<link rel="stylesheet" href="style.css"><a download href="style.css">CSS</a>'), selected('style.css', css, 'text/css'), selected('pic.png', new Uint8Array([1]), 'image/png'));
  const result = await imported(items), doc = html(result);
  assert.equal(dataBytes(doc.querySelector('a').getAttribute('href')).toString(), css);
  assert.ok(dataBytes(doc.querySelector('link').getAttribute('href')).toString().includes('data:image/png'));
});

test('stylesheet context, MIME type and quoted/url imports process extensionless CSS', async () => {
  for (const stylesheet of ['styles', 'styles.css']) for (const importSyntax of ['"nested"', 'url("nested")', '/* context */ url("nested")']) {
    const items = files(selected('index.html', '<link rel="stylesheet" href="' + stylesheet + '">'),
      selected(stylesheet, '@import ' + importSyntax + ';body{background:url(pic.png)}', ''),
      selected('nested', 'h1{background:url(other.png)}', ''),
      selected('pic.png', new Uint8Array([1]), 'image/png'), selected('other.png', new Uint8Array([2]), 'image/png'));
    const result = await imported(items);
    const css = dataBytes(html(result).querySelector('link').getAttribute('href')).toString();
    assert.ok(css.includes('data:image/png;base64,AQ=='));
    const nested = css.match(/@import url\("([^"]+)"\)/)[1];
    assert.ok(dataBytes(nested).toString().includes('data:image/png;base64,Ag=='));
    assert.equal(result.warnings.length, 0);
    assert.equal(result.used.size, 4);
  }
});

test('image-set and SVG use warn and preserve selected dependencies', async () => {
  const items = files(selected('index.html', '<style>body{background-image:image-set("pic.png" 1x)}</style><img src="sprite.svg"><svg><use href="sprite.svg#icon"></use></svg>'),
    selected('pic.png', new Uint8Array([1]), 'image/png'), selected('sprite.svg', '<svg/>', 'image/svg+xml'));
  const result = await imported(items);
  assert.ok(warning(result, 'image-set()'));
  assert.ok(warning(result, 'sprite.svg#icon'));
  assert.ok(result.retained.has(items[1]));
  assert.ok(result.retained.has(items[2]));
  assert.ok(result.used.has(items[2]));
});

test('image-set in a filename is an ordinary URL, not unsupported CSS syntax', async () => {
  const items = files(selected('index.html', '<style>body{background:url(my-image-set.png)}</style>'), selected('my-image-set.png', new Uint8Array([1]), 'image/png'));
  const result = await imported(items);
  assert.equal(result.warnings.length, 0);
  assert.ok(result.used.has(items[1]));
});

test('9 MiB CSS image fits final 25 MiB HTML budget without nested double-counting', async () => {
  const items = files(selected('index.html', '<link rel="stylesheet" href="style.css">'), selected('style.css', 'body{background:url(pic.png)}', 'text/css'), selected('pic.png', new Uint8Array(9 * 1024 * 1024), 'image/png'));
  const result = await imported(items);
  assert.ok(result.bytes.length > 16 * 1024 * 1024 && result.bytes.length < 17 * 1024 * 1024);
  assert.equal(result.warnings.length, 0);
  assert.equal(items[2].reads, 1);
});

test('repeated large references exceeding final HTML budget are rejected', async () => {
  const items = files(selected('index.html', '<img src="pic.png">'.repeat(3)), selected('pic.png', new Uint8Array(7 * 1024 * 1024), 'image/png'));
  await assert.rejects(() => imported(items), /25 MiB/);
  assert.equal(items[1].reads, 1);
});

test('shared stylesheet graph is Base64-encoded once per distinct prepared file', async () => {
  const items = files(selected('index.html', '<link rel="stylesheet" href="0">'),
    ...Array.from({ length: 7 }, (_, n) => selected(String(n), n === 6 ? 'body{color:green}' : '@import "' + (n + 1) + '";@import "' + (n + 1) + '";', 'text/css')));
  const original = globalThis.btoa;
  let encodings = 0;
  globalThis.btoa = text => { encodings++; return original(text); };
  try {
    const result = await imported(items);
    assert.equal(result.warnings.length, 0);
    assert.equal(encodings, 7);
  } finally { globalThis.btoa = original; }
});

test('branching CSS imports reuse prepared output instead of exponential traversal', async () => {
  const items = files(selected('index.html', '<link rel="stylesheet" href="0">'),
    ...Array.from({ length: 18 }, (_, n) => selected(String(n), n === 17 ? 'body{color:green}' : '@import "' + (n + 1) + '";@import "' + (n + 1) + '";', 'text/css')));
  // The resulting nested Base64 grows beyond the content limit, but preparation
  // must remain bounded: one transformation per distinct stylesheet.
  const controller = new AbortController();
  const pending = imported(items, { signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(() => pending, error => error.name === 'AbortError' || /25 MiB/.test(error.message));
  items.forEach(item => assert.ok(item.reads <= 1));
});

test('obsolete import stops before reading further files', async () => {
  const controller = new AbortController();
  const items = files(selected('index.html', '<img src="a.png"><img src="b.png">'), selected('a.png', new Uint8Array([1]), 'image/png'), selected('b.png', new Uint8Array([2]), 'image/png'));
  const firstRead = items[1].file.arrayBuffer.bind(items[1].file);
  items[1].file.arrayBuffer = async () => { controller.abort(); return firstRead(); };
  await assert.rejects(() => imported(items, { signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(items[2].reads, 0);
});

test('selected top-level folder defines website root for absolute resource paths', async () => {
  const items = files(selected('site/index.html', '<img src="/images/pic.png"><link rel="stylesheet" href="/style">'),
    selected('site/images/pic.png', new Uint8Array([1]), 'image/png'), selected('site/style', 'body{background:url(/images/pic.png)}', 'text/css'), selected('loose.txt', 'Additional file', 'text/plain'));
  const result = await imported(items);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.used.size, 2);
  const external = files(selected('site/index.html', '<base href="https://example.invalid/"><img src="/images/pic.png">'), items[1]);
  assert.ok(warning(await imported(external), 'External dependency'));
});

test('cyclic imports and escaped CSS warn without discarding originals', async () => {
  const items = files(selected('index.html', '<link rel="stylesheet" href="a.css">'), selected('a.css', '@import "b.css";', 'text/css'), selected('b.css', '@import "a.css";', 'text/css'));
  const result = await imported(items);
  assert.ok(warning(result, 'Circular CSS reference'));
  assert.ok(result.retained.has(items[1]) && result.retained.has(items[2]));
  items[1] = files(selected('a.css', 'body{background:url(pic\\.png)}', 'text/css'))[0];
  const escaped = await imported(items);
  assert.ok(warning(escaped, 'CSS with escapes'));
  assert.ok(escaped.retained.has(items[1]));
});
