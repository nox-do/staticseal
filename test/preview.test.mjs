import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPreview } from '../src/preview.mjs';
import { renderWrapper } from '../src/wrapper.mjs';
import { wrapper } from './helpers/html-harness.mjs';
import { makePayload } from './helpers/payload.mjs';

function previewText(node) {
  return (
    node.textContent ||
    (node.innerHTML || '')
      .replace(/<span class="s-[a-z]+">|<\/span>/g, '')
      .replace(
        /&(?:amp|lt|gt|quot|#39);/g,
        value => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[value]
      )
  );
}

test('PDF notice appears after opening for current and legacy metadata', async () => {
  for (const access of ['sealed', 'passphrase'])
    for (const privateFilename of [false, true]) {
      const payload = await makePayload(
        Buffer.from('%PDF-test'),
        'test',
        100000,
        { name: 'document.pdf', type: 'application/pdf' },
        access,
        privateFilename
      );
      for (const minimal of [false, true]) {
        const html = renderWrapper({ title: 'Document', payload, minimal });
        const opening = html.split('<script')[0];
        assert.equal(opening.includes('PDFs may contain'), false);
        assert.ok(!html.includes('No passphrase'));
        const reader = wrapper(html);
        await reader.open('test');
        assert.equal(reader.nodes.get('vc').innerHTML.includes('PDFs may contain'), true);
        reader.confirmWith(() => assert.fail('Unexpected confirmation'));
        assert.equal(reader.nodes.get('vc').innerHTML.includes('<iframe'), false);
        reader.nodes.get('pdf').handlers.click();
        assert.match(reader.nodes.get('vc').innerHTML, /<iframe/);
      }
    }
});

test('file viewer routes supported formats and keeps downloads byte-exact', async () => {
  const bytes = Buffer.from('Original bytes remain unchanged.');
  for (const [extension, type, preview] of [
    ['png', 'image/png', true],
    ['jpg', 'image/jpeg', true],
    ['gif', 'image/gif', true],
    ['webp', 'image/webp', true],
    ['html', 'text/html', false],
    ['xhtml', 'application/xhtml+xml', false],
    ['svg', 'image/svg+xml', true],
    ['bmp', 'image/bmp', false],
    ['txt', 'text/plain', false],
    ['pdf', 'application/pdf', false],
    ['md', 'text/markdown', false],
    ['json', 'application/json', false],
    ['ts', 'text/plain', false],
    ['constructor', 'application/octet-stream', false],
    ['__proto__', 'application/octet-stream', false]
  ]) {
    const name = 'example.' + extension;
    const payload = await makePayload(bytes, '', 100000, { name, type }, 'sealed', true);
    const html = renderWrapper({ payload, files: [{ filename: name, contentType: type }] });
    assert.equal(html.includes('Formatting simplified for this large document'), extension === 'md');
    assert.equal(html.includes('PDFs may contain'), extension === 'pdf');
    assert.equal(html.includes('Preview limited to'), ['txt', 'html', 'xhtml', 'json', 'ts', 'md'].includes(extension));
    const reader = wrapper(html);
    await reader.open();
    const viewer = reader.nodes.get('vc');
    assert.equal(viewer.innerHTML.includes('<img '), preview, extension);
    assert.ok(!viewer.innerHTML.includes('<iframe'), extension);
    assert.ok(!reader.nodes.get('vc').innerHTML.includes('<object'), 'No document embedding');
    if (['txt', 'html', 'xhtml', 'json', 'ts'].includes(extension)) {
      assert.equal(previewText(reader.nodes.get('tp')), bytes.toString());
    }
    if (extension === 'md')
      assert.ok(viewer.innerHTML.includes('<article><p>Original bytes remain unchanged.</p></article>'));
    assert.deepEqual(Buffer.from(await reader.blobs[0].arrayBuffer()), bytes);
    if (extension === 'pdf') {
      assert.ok(viewer.innerHTML.includes('PDFs may contain'));
      reader.confirmWith(() => {
        assert.fail('PDF preview must not open a confirmation dialog');
      });
      reader.nodes.get('pdf').handlers.click();
      assert.ok(viewer.innerHTML.includes('<iframe'));
    }
  }
});

test('compact Markdown escapes HTML and permits only explicit safe link schemes', () => {
  const { renderMarkdown, previewKind, inferContentType } = createPreview();
  const rendered = renderMarkdown(
    '# Title\n\n**bold** and *italic* and `code`\n\n- One\n- Two\n\n1. First\n2. Second\n\n> Quote\n\n```html\n<script>alert(1)</script>\n```\n\n[Safe](https://example.com) [Mail](mailto:a@example.com) [Bad](javascript:alert)\n\n<img src=x onerror=alert(1)>\n\n![Remote](https://example.com/track.png)'
  );
  for (const part of [
    '<h1>Title</h1>',
    '<strong>bold</strong>',
    '<em>italic</em>',
    '<code>code</code>',
    '<ul><li>One</li><li>Two</li></ul>',
    '<ol><li>First</li><li>Second</li></ol>',
    '<blockquote><p>Quote</p></blockquote>',
    '&lt;script&gt;',
    '&lt;img',
    'href="https://example.com"',
    'href="mailto:a@example.com"'
  ])
    assert.ok(rendered.replace(/<span class="s-[a-z]+">|<\/span>/g, '').includes(part), part);
  for (const part of ['<script', '<img', 'href="javascript:', 'src="https:']) assert.ok(!rendered.includes(part), part);
  for (const href of [
    'data:text/html,test',
    'file:///tmp/test',
    '//example.com',
    'javascript&#58;alert',
    'java\tscript:alert',
    'https://example.com/"onclick="alert'
  ]) {
    const result = renderMarkdown('[click](' + href + ')');
    assert.ok(!result.includes(' onclick='));
    assert.ok(!result.includes('href="data:') && !result.includes('href="file:') && !result.includes('href="//'));
  }
  assert.equal(previewKind('README.MD', 'text/plain'), 'markdown');
  assert.equal(previewKind('example.ts', 'application/octet-stream'), 'text');
  assert.equal(previewKind('example.svg', 'application/octet-stream'), 'image');
  assert.equal(previewKind('example.bin', 'application/octet-stream'), 'download');
  assert.equal(previewKind('example.json', 'application/json; charset=utf-8'), 'text');
  assert.equal(inferContentType('README'), 'text/plain');
});

test('generated text/Markdown previews preserve bytes, bound output and handle encodings', async () => {
  for (const [name, bytes, expected] of [
    ['source.html', Buffer.from('<script>alert("hello")</script>'), '<script>alert("hello")</script>'],
    ['text.txt', Buffer.from('\ufeffGrüße 日本語', 'utf16le'), 'Grüße 日本語'],
    ['large.txt', Buffer.concat([Buffer.alloc(128 * 1024 - 1, 97), Buffer.from('€tail')]), 'a'.repeat(128 * 1024 - 1)],
    ['exact.txt', Buffer.alloc(128 * 1024, 97), 'a'.repeat(128 * 1024)],
    ['large.md', Buffer.from('# Title\n\n' + 'a'.repeat(128 * 1024)), null],
    ['invalid.txt', Buffer.from([0xff, 0xff]), null],
    ['note.md', Buffer.from('# Hello\n\n<script>alert(1)</script>'), null]
  ]) {
    const payload = await makePayload(
      bytes,
      'test',
      160000,
      { name, type: 'application/octet-stream' },
      'sealed',
      true
    );
    const reader = wrapper(renderWrapper({ title: 'Test', payload }));
    await reader.open('test');
    const html = reader.nodes.get('vc').innerHTML;
    assert.deepEqual(Buffer.from(await reader.blobs[0].arrayBuffer()), bytes);
    if (expected !== null) assert.equal(previewText(reader.nodes.get('tp')), expected);
    if (name.startsWith('large.')) {
      assert.ok(html.includes('first 128 KiB'));
      assert.ok(html.includes('Preview ends here — the file continues.'));
      assert.ok(html.indexOf('class="pn pe"') > html.indexOf(name.endsWith('.md') ? '</article>' : '</pre>'));
    } else assert.ok(!html.includes('class="pn pe"'));
    if (name === 'invalid.txt') assert.ok(html.includes('Unsupported text encoding'));
    if (name === 'note.md') {
      assert.ok(html.includes('<h1>Hello</h1>'));
      assert.ok(html.includes('&lt;script&gt;'));
      assert.ok(!html.includes('<script>'));
    }
  }
});

test('small highlighter preserves source text and escapes active content in supported languages', async () => {
  const { codeLanguage, highlightCode, renderMarkdown } = createPreview();
  const cases = [
    [
      'example.JS',
      'text/plain',
      'const name = "<img src=x onerror=alert(1)>"; // comment\nlet count = 42;\nconst ready = true;',
      ['keyword', 'string', 'comment', 'number']
    ],
    [
      'data.json',
      'application/json',
      '{"key": "</script>&", "count": -3.25e+2, "ready": false, "empty": null}',
      ['key', 'string', 'number', 'keyword']
    ],
    [
      'example.html',
      'text/html',
      '<!-- comment -->\n<script>console.log("test")</script>\n<div title="a & b" onclick="alert(1)">Hello</div>',
      ['comment', 'tag', 'key', 'string']
    ],
    ['unknown.txt', 'application/javascript; charset=utf-8', 'export default 123;', ['keyword', 'number']],
    ['data', 'application/ld+json', '{"value": true}', ['key', 'keyword']]
  ];
  for (const [name, type, text, kinds] of cases) {
    const highlighted = highlightCode(text, codeLanguage(name, type));
    assert.equal(previewText({ innerHTML: highlighted }), text);
    assert.ok(!/<(script|img|div)\b/i.test(highlighted));
    for (const kind of kinds) assert.ok(highlighted.includes('class="s-' + kind + '"'), name + ': ' + kind);
    const bytes = Buffer.from(text);
    const payload = await makePayload(bytes, 'test', 160000, { name, type }, 'sealed');
    const reader = wrapper(renderWrapper({ title: 'Test', payload }));
    await reader.open('test');
    assert.equal(previewText(reader.nodes.get('tp')), text);
    assert.ok(reader.nodes.get('tp').innerHTML.includes('s-'));
    assert.deepEqual(Buffer.from(await reader.blobs[0].arrayBuffer()), bytes);
  }
  assert.equal(highlightCode('<img src=x> & "text"', 'python'), '&lt;img src=x&gt; &amp; &quot;text&quot;');
  const fenced = renderMarkdown('```js\nconst count = 42;\n```');
  assert.ok(fenced.includes('<span class="s-keyword">const</span>'));
  assert.equal(
    previewText({ innerHTML: fenced.replace('<pre><code>', '').replace('</code></pre>', '') }),
    'const count = 42;'
  );
  // Long incomplete tokens can occur at the preview boundary.
  for (const language of ['html', 'json', 'javascript']) {
    const text = '<a '.repeat(10000) + '"unfinished & <';
    assert.equal(previewText({ innerHTML: highlightCode(text, language) }), text);
  }
});

test('preview review regressions: arbitrary filenames, heading text and bounded formatting', () => {
  const { inferContentType, previewKind, renderMarkdown, highlightCode } = createPreview();
  for (const name of ['constructor', '__proto__', 'sample.constructor', 'sample.__proto__', 'hasOwnProperty']) {
    assert.equal(inferContentType(name), 'application/octet-stream');
    assert.equal(previewKind(name, 'application/octet-stream'), 'download');
  }
  for (const [input, title] of [
    ['# C#', 'C#'],
    ['## C##', 'C##'],
    ['# Heading ###  ', 'Heading'],
    ['# ###', ''],
    ['#', '']
  ]) {
    assert.equal(
      renderMarkdown(input),
      '<h' + input.match(/^#+/)[0].length + '>' + title + '</h' + input.match(/^#+/)[0].length + '>'
    );
  }
  const spaced = 'a' + ' '.repeat(128 * 1024 - 4) + 'b';
  assert.equal(renderMarkdown('# ' + spaced), '<h1>' + spaced + '</h1>');
  for (const [text, language] of [
    ['0 '.repeat(65536), 'json'],
    ['<a ' + 'title="x" '.repeat(10000) + '>', 'html']
  ]) {
    const output = highlightCode(text, language);
    assert.equal(previewText({ innerHTML: output }), text);
    assert.ok(!output.includes('<span'), 'Dense code falls back to escaped plain text');
  }
  for (const text of ['- a\n'.repeat(32768), '*a* '.repeat(32768)]) {
    const output = renderMarkdown(text);
    assert.ok(output.startsWith('<p class="pn">Formatting simplified'));
    assert.ok(output.includes('<pre>' + text + '</pre>'));
    assert.ok(!output.includes('<li>') && !output.includes('<em>'));
  }
});
