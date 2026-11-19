import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Window } from 'happy-dom';

test('published pages share canonical sitemap URLs and are discoverable from the creator', async t => {
  const base = 'https://nox-do.github.io/staticseal/';
  const pages = ['index.html', 'examples/index.html', 'examples/cli/index.html'];
  const urls = [base, base + 'examples/', base + 'examples/cli/'];
  const window = new Window({
    settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableIframePageLoading: true }
  });
  t.after(() => window.happyDOM.close());
  const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
  const parse = (text, type = 'text/html') => new window.DOMParser().parseFromString(text, type);
  const sitemap = parse(await read('sitemap.xml'), 'application/xml');
  assert.deepEqual(
    [...sitemap.querySelectorAll('loc')].map(loc => loc.textContent),
    urls
  );
  const navigation = new Map();
  for (const [index, page] of pages.entries()) {
    const doc = parse(await read(page));
    assert.deepEqual(
      [...doc.head.querySelectorAll('link[rel="canonical"]')].map(link => link.getAttribute('href')),
      [urls[index]],
      page
    );
    for (const meta of doc.head.querySelectorAll('meta[name="robots"], meta[name="googlebot"]')) {
      assert.doesNotMatch(meta.content, /noindex|none/i, page);
    }
    const links = [...doc.querySelectorAll('a[href]')].map(link => {
      const url = new URL(link.getAttribute('href'), urls[index]);
      url.hash = '';
      return url.href;
    });
    for (const target of pages) {
      assert.ok(!links.includes(new URL(target, base).href), page + ': links must use canonical directory URLs');
    }
    navigation.set(
      urls[index],
      links.filter(link => urls.includes(link))
    );
  }
  const reachable = new Set([base]);
  for (const url of reachable) {
    for (const link of navigation.get(url)) reachable.add(link);
  }
  assert.deepEqual([...reachable].sort(), [...urls].sort(), 'All sitemap pages must be linked from the creator');
});
