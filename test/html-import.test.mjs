import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { embedSelectedHtml, inspectHtmlSelection } from '../src/html-import.mjs';

const window = new Window({
  settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableIframePageLoading: true }
});
const parse = text => new window.DOMParser().parseFromString(text, 'text/html');
const selected = (path, body, type = '') => {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return {
    path,
    reads: 0,
    file: {
      type,
      size: bytes.length,
      async arrayBuffer() {
        this.owner.reads++;
        return bytes.slice().buffer;
      }
    }
  };
};
function files(...items) {
  items.forEach(item => (item.file.owner = item));
  return items;
}
const dataBytes = value => Buffer.from(value.slice(value.indexOf(',') + 1).split('#')[0], 'base64');
const html = result => parse(new TextDecoder().decode(result.bytes));
const imported = (items, options = {}) => embedSelectedHtml(items, items[0], { parse, ...options });
const warning = (result, text) => result.warnings.some(value => value.includes(text));

test('embedded image keeps a working original download link', async () => {
  const png = new Uint8Array([0, 127, 255]);
  const items = files(
    selected('index.html', '<img src="pic.png"><a download href="pic.png">Original</a>'),
    selected('pic.png', png, 'image/png')
  );
  const result = await imported(items),
    doc = html(result);
  assert.deepEqual(dataBytes(doc.querySelector('a').getAttribute('href')), Buffer.from(png));
  assert.equal(result.warnings.length, 0);
  assert.equal(items[1].reads, 1);
});

test('ordinary links to embedded assets work without keeping duplicate collection entries', async () => {
  const png = new Uint8Array([0, 127, 255]);
  const items = files(
    selected('index.html', '<img src="pic.png"><a href="pic.png">View</a>'),
    selected('pic.png', png, 'image/png')
  );
  const result = await imported(items);
  assert.ok(result.used.has(items[1]));
  assert.ok(!result.retained.has(items[1]));
  assert.equal(result.warnings.length, 0);
  assert.deepEqual(dataBytes(html(result).querySelector('a').getAttribute('href')), Buffer.from(png));
});

test('download of embedded CSS restores original bytes, not the transformed stylesheet', async () => {
  const css = 'body{background:url(pic.png)}';
  const items = files(
    selected('index.html', '<link rel="stylesheet" href="style.css"><a download href="style.css">CSS</a>'),
    selected('style.css', css, 'text/css'),
    selected('pic.png', new Uint8Array([1]), 'image/png')
  );
  const result = await imported(items),
    doc = html(result);
  assert.equal(dataBytes(doc.querySelector('a').getAttribute('href')).toString(), css);
  assert.ok(dataBytes(doc.querySelector('link').getAttribute('href')).toString().includes('data:image/png'));
});

test('stylesheet context, MIME type and quoted/url imports process extensionless CSS', async () => {
  for (const stylesheet of ['styles', 'styles.css'])
    for (const importSyntax of ['"nested"', 'url("nested")', '/* context */ url("nested")']) {
      const items = files(
        selected('index.html', '<link rel="stylesheet" href="' + stylesheet + '">'),
        selected(stylesheet, '@import ' + importSyntax + ';body{background:url(pic.png)}', ''),
        selected('nested', 'h1{background:url(other.png)}', ''),
        selected('pic.png', new Uint8Array([1]), 'image/png'),
        selected('other.png', new Uint8Array([2]), 'image/png')
      );
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
  const items = files(
    selected(
      'index.html',
      '<style>body{background-image:image-set("pic.png" 1x)}</style><img src="sprite.svg"><svg><use href="sprite.svg#icon"></use></svg>'
    ),
    selected('pic.png', new Uint8Array([1]), 'image/png'),
    selected('sprite.svg', '<svg/>', 'image/svg+xml')
  );
  const result = await imported(items);
  assert.ok(warning(result, 'image-set()'));
  assert.ok(warning(result, 'sprite.svg#icon'));
  assert.ok(result.retained.has(items[1]));
  assert.ok(result.retained.has(items[2]));
  assert.ok(result.used.has(items[2]));
});

test('image-set in a filename is an ordinary URL, not unsupported CSS syntax', async () => {
  const items = files(
    selected('index.html', '<style>body{background:url(my-image-set.png)}</style>'),
    selected('my-image-set.png', new Uint8Array([1]), 'image/png')
  );
  const result = await imported(items);
  assert.equal(result.warnings.length, 0);
  assert.ok(result.used.has(items[1]));
});

test('15 MiB CSS image prepares beyond 25 MiB without nested double-counting', async () => {
  const items = files(
    selected('index.html', '<link rel="stylesheet" href="style.css">'),
    selected('style.css', 'body{background:url(pic.png)}', 'text/css'),
    selected('pic.png', new Uint8Array(15 * 1024 * 1024), 'image/png')
  );
  const result = await imported(items);
  assert.ok(result.bytes.length > 26 * 1024 * 1024 && result.bytes.length < 27 * 1024 * 1024);
  assert.equal(result.warnings.length, 0);
  assert.equal(items[2].reads, 1);
});

test('repeated large references exceeding the 128 MiB working budget are rejected', async () => {
  const items = files(
    selected('index.html', '<img src="pic.png">'.repeat(3)),
    selected('pic.png', new Uint8Array(33 * 1024 * 1024), 'image/png')
  );
  await assert.rejects(() => imported(items), /128 MiB/);
  assert.equal(items[1].reads, 1);
});

test('shared stylesheet graph is Base64-encoded once per distinct prepared file', async () => {
  const items = files(
    selected('index.html', '<link rel="stylesheet" href="0">'),
    ...Array.from({ length: 7 }, (_, n) =>
      selected(
        String(n),
        n === 6 ? 'body{color:green}' : '@import "' + (n + 1) + '";@import "' + (n + 1) + '";',
        'text/css'
      )
    )
  );
  const original = globalThis.btoa;
  let encodings = 0;
  globalThis.btoa = text => {
    encodings++;
    return original(text);
  };
  try {
    const result = await imported(items);
    assert.equal(result.warnings.length, 0);
    assert.equal(encodings, 7);
  } finally {
    globalThis.btoa = original;
  }
});

test('branching CSS imports reuse prepared output instead of exponential traversal', async () => {
  const items = files(
    selected('index.html', '<link rel="stylesheet" href="0">'),
    ...Array.from({ length: 18 }, (_, n) =>
      selected(
        String(n),
        n === 17 ? 'body{color:green}' : '@import "' + (n + 1) + '";@import "' + (n + 1) + '";',
        'text/css'
      )
    )
  );
  // The resulting nested Base64 grows beyond the content limit, but preparation
  // must remain bounded: one transformation per distinct stylesheet.
  const controller = new AbortController();
  const pending = imported(items, { signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(
    () => pending,
    error => error.name === 'AbortError' || /128 MiB/.test(error.message)
  );
  items.forEach(item => assert.ok(item.reads <= 1));
});

test('obsolete or declined preparation stops before reading further files', async () => {
  for (const declined of [false, true]) {
    const controller = new AbortController();
    const items = files(
      selected('index.html', '<img src="a.png"><img src="b.png">'),
      selected('a.png', new Uint8Array(128), 'image/png'),
      selected('b.png', new Uint8Array([2]), 'image/png')
    );
    const firstRead = items[1].file.arrayBuffer.bind(items[1].file);
    items[1].file.arrayBuffer = async () => {
      if (!declined) controller.abort();
      return firstRead();
    };
    await assert.rejects(
      () =>
        imported(items, {
          signal: controller.signal,
          onSize(size) {
            if (declined && size > 256) throw new Error('Preparation cancelled.');
          }
        }),
      error => (declined ? /Preparation cancelled/.test(error.message) : error.name === 'AbortError')
    );
    assert.equal(items[2].reads, 0);
  }
});

test('selected top-level folder defines website root for absolute resource paths', async () => {
  const items = files(
    selected('site/index.html', '<img src="/images/pic.png"><link rel="stylesheet" href="/style">'),
    selected('site/images/pic.png', new Uint8Array([1]), 'image/png'),
    selected('site/style', 'body{background:url(/images/pic.png)}', 'text/css'),
    selected('loose.txt', 'Additional file', 'text/plain')
  );
  const result = await imported(items);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.used.size, 2);
  const external = files(
    selected('site/index.html', '<base href="https://example.invalid/"><img src="/images/pic.png">'),
    items[1]
  );
  assert.ok(warning(await imported(external), 'External dependency'));
});

test('cyclic imports and escaped CSS warn without discarding originals', async () => {
  const items = files(
    selected('index.html', '<link rel="stylesheet" href="a.css">'),
    selected('a.css', '@import "b.css";', 'text/css'),
    selected('b.css', '@import "a.css";', 'text/css')
  );
  const result = await imported(items);
  assert.ok(warning(result, 'Circular CSS reference'));
  assert.ok(result.retained.has(items[1]) && result.retained.has(items[2]));
  items[1] = files(selected('a.css', 'body{background:url(pic\\.png)}', 'text/css'))[0];
  const escaped = await imported(items);
  assert.ok(warning(escaped, 'CSS with escapes'));
  assert.ok(escaped.retained.has(items[1]));
});

const websiteData = result => {
  const script = html(result).querySelector('body > script').textContent;
  return JSON.parse(script.slice(script.lastIndexOf(')([') + 2, -2));
};
const websitePages = result => {
  const [pages, assets, prefix] = websiteData(result);
  return pages.map(text => parse(text.replace(new RegExp(prefix + '(\\d+);', 'g'), (match, n) => assets[n] ?? match)));
};

test('linked pages form a finite website with directory indexes, anchors, cycles and shared resources', async () => {
  const items = files(
    selected('site/index.html', '<a href="guide/#section">Guide</a><a href="pic.png">Image</a>'),
    selected(
      'site/guide/index.htm',
      '<link rel="stylesheet" href="../style.css"><img src="../pic.png"><a href="deep.html">Deep</a><a href="/index.html#top">Home</a><h1 id="section">Guide</h1>'
    ),
    selected(
      'site/guide/deep.html',
      '<link rel="stylesheet" href="../style.css"><a href="../guide/">Back</a><script>window.deepReady=true</script>'
    ),
    selected('site/style.css', 'body{background:url(pic.png)}', 'text/css'),
    selected('site/pic.png', new Uint8Array([1, 2]), 'image/png'),
    selected('site/unlinked.html', '<h1>Independent attachment</h1>')
  );
  const result = await imported(items);
  const pages = websitePages(result);
  assert.equal(result.pageCount, 3);
  assert.equal(pages.length, 3);
  assert.equal(pages[0].querySelector('a').dataset.sealPage, '1');
  assert.equal(pages[0].querySelector('a').getAttribute('href'), '#section');
  assert.equal(pages[1].querySelectorAll('a')[1].dataset.sealPage, '0');
  assert.equal(pages[2].querySelector('a').dataset.sealPage, '1');
  assert.ok(pages[2].querySelector('script').textContent.includes('deepReady'));
  assert.deepEqual(dataBytes(pages[0].querySelectorAll('a')[1].getAttribute('href')), Buffer.from([1, 2]));
  assert.equal(result.warnings.length, 0);
  assert.ok(items.slice(1, 5).every(item => result.used.has(item) && !result.retained.has(item)));
  assert.ok(!result.used.has(items[5]));
  assert.ok(items.slice(0, 5).every(item => item.reads === 1));
});

test('subpage warnings preserve missing links and original HTML download bytes', async () => {
  const body =
    '<h1>Subpage</h1><img src="missing.png"><a href="absent.html">Missing</a><a download href="sub.html">Source</a>';
  const items = files(selected('index.html', '<a href="sub.html">Sub</a>'), selected('sub.html', body));
  const result = await imported(items);
  const pages = websitePages(result);
  assert.ok(warning(result, 'missing.png') && warning(result, 'absent.html'));
  assert.equal(pages[1].querySelector('a').getAttribute('href'), 'absent.html');
  assert.equal(dataBytes(pages[1].querySelector('a[download]').getAttribute('href')).toString(), body);
});

test('aggregate website size rejects expansion across pages instead of limiting each page separately', async () => {
  const items = files(
    selected('index.html', '<img src="pic.png"><a href="a.html">A</a>'),
    selected('a.html', '<img src="pic.png"><a href="b.html">B</a>'),
    selected('b.html', '<img src="pic.png">'),
    selected('pic.png', new Uint8Array(33 * 1024 * 1024), 'image/png')
  );
  await assert.rejects(() => imported(items), /128 MiB/);
  assert.equal(items[3].reads, 1);
});

test('shared website data is stored once without confusing literal resource-marker text', async () => {
  const css = '/* shared font/style fixture */'.repeat(100) + 'h1{color:green}';
  const literal = 'seal-resource:' + ':'.repeat(50000) + '0;';
  const items = files(
    selected('index.html', '<link rel="stylesheet" href="style.css"><p>' + literal + '</p><a href="sub.html">Sub</a>'),
    selected('sub.html', '<link rel="stylesheet" href="style.css"><p>seal-resource:1:0;</p>'),
    selected('style.css', css, 'text/css')
  );
  const result = await imported(items);
  const [pages, assets, prefix] = websiteData(result);
  assert.equal(assets.length, 1);
  assert.equal(prefix, 'seal-resource:2:');
  assert.ok(pages.every(text => text.includes(prefix + '0;')));
  assert.ok(pages.every(text => !text.includes('data:text/css;base64,')));
  assert.ok(result.bytes.length < css.length * 2 + literal.length);
  const restored = websitePages(result);
  assert.equal(restored[0].querySelector('p').textContent, literal);
  assert.equal(restored[1].querySelector('p').textContent, 'seal-resource:1:0;');
  for (const page of restored) assert.equal(dataBytes(page.querySelector('link').getAttribute('href')).toString(), css);
});

test('a nested index does not displace a report above it', () => {
  const selection = paths => inspectHtmlSelection(paths.map(path => ({ path })));
  assert.equal(selection(['bericht.html', 'unterseiten/index.html']).entry, null);
  assert.equal(selection(['site/index.html', 'site/sub/index.html']).entry.path, 'site/index.html');
  assert.equal(selection(['a/index.html', 'b/index.html']).entry, null);
});

test('uninspected embedded documents and blob resources produce warnings', async () => {
  for (const source of [
    `<iframe srcdoc="&lt;img src='missing.png'&gt;"></iframe>`,
    '<frameset><frame src="missing.htm"></frameset>',
    '<img src="blob:https://example.invalid/id">',
    '<link rel="stylesheet" href="data:text/css,body{background:url(missing.png)}">',
    '<iframe src="data:text/html,%3Cimg%20src=missing.png%3E"></iframe>'
  ]) {
    const result = await imported(files(selected('index.html', source)));
    assert.ok(result.warnings.length, source);
  }
  const result = await imported(files(selected('index.html', '<img src="data:image/png;base64,AA==">')));
  assert.deepEqual(result.warnings, []);
});
