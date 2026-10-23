import { Window } from 'happy-dom';
import { embedSelectedHtml } from '../../src/html-import.mjs';
import { process as parseSrcset, serialize as serializeSrcset } from '../../src/srcset-parser.mjs';
import { decodeText, readMhtml } from './mhtml.mjs';

import { PREPARED_MAX_BYTES } from '../../src/limits.mjs';
export async function bundleReport(source, load) {
  const window = new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true
    }
  });
  const parse = text => new window.DOMParser().parseFromString(text, 'text/html');
  const warnings = new Set();
  const files = [],
    resources = new Map();
  let resourceIndex = 0;
  const archive =
    /(?:multipart\/related|message\/rfc822)/i.test(source.type) || /\.mht(?:ml)?$/i.test(source.name)
      ? readMhtml(source.bytes, source.url)
      : null;
  if (archive) source = { ...archive.entry, name: source.name.replace(/\.mht(?:ml)?$/i, '.html') };
  else if (!/^text\/html\b/i.test(source.type) && !/\.html?$/i.test(source.name))
    throw new Error('--bundle requires an HTML or MHTML report.');
  const get = async url => {
    if (!archive) return load(url);
    const key = new URL(url);
    key.hash = '';
    const part = archive.resources.get(key.href);
    if (!part) throw new Error('Missing MHTML resource: ' + key.href);
    const location = part.location
      ? new URL(part.location, source.url)
      : key.protocol === 'cid:'
        ? new URL('#' + encodeURIComponent(key.href), source.url)
        : key;
    return { ...part, url: location };
  };
  const text = value => decodeText(value.bytes, value.type);
  const data = (type, bytes) => 'data:' + type + ';base64,' + Buffer.from(bytes).toString('base64');
  const add = (path, bytes, type) => {
    files.push({ path, file: { type, arrayBuffer: async () => bytes } });
  };
  function resolveRef(ref, base) {
    if (!ref || /^(?:data:|#)/i.test(ref)) return null;
    try {
      return new URL(ref, base);
    } catch {
      warnings.add('Unrecognized reference: ' + ref);
      return null;
    }
  }
  async function resource(ref, base, kind = '') {
    const url = resolveRef(ref, base);
    if (!url) return ref;
    const fragment = url.hash;
    url.hash = '';
    const key = url.href + ':' + kind;
    try {
      if (!resources.has(key)) {
        const value = await get(url);
        if (resources.size >= 999) throw new Error('Maximum 1,000 source resources.');
        const path = 'resource-' + resourceIndex++ + (kind === 'css' ? '.css' : '.bin');
        resources.set(key, path);
        let bytes = value.bytes;
        if (kind === 'css') bytes = Buffer.from(await css(text(value), value.url));
        add(path, bytes, kind === 'css' ? 'text/css' : value.type.split(';')[0]);
      }
      return '/' + resources.get(key) + fragment;
    } catch (error) {
      resources.delete(key);
      warnings.add(error.message);
      return new URL(ref, base).href;
    }
  }
  async function css(value, base) {
    // Same conservative URL grammar as the offline importer; it reports escapes/image-set.
    const pattern =
      /\/\*[\s\S]*?\*\/|@import\b(?:\s|\/\*[\s\S]*?\*\/)*(["'])(.*?)\1|(?:@import\b(?:\s|\/\*[\s\S]*?\*\/)*)?\burl\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^)'"\s]*))\s*\)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gi;
    let result = '',
      offset = 0;
    for (const match of value.matchAll(pattern)) {
      result += value.slice(offset, match.index);
      if (/^(?:\/\*|["'])/.test(match[0])) result += match[0];
      else {
        const ref = match[2] ?? match[3] ?? match[4] ?? match[5];
        const imported = /^@import\b/i.test(match[0]);
        const target = await resource(ref, base, imported ? 'css' : '');
        result +=
          target === ref ? match[0] : (imported ? '@import ' : '') + 'url("' + target.replaceAll('"', '%22') + '")';
      }
      offset = match.index + match[0].length;
      if (result.length > PREPARED_MAX_BYTES) throw new Error('Prepared content exceeds the 128 MiB working limit.');
    }
    return result + value.slice(offset);
  }
  async function html(value, ancestors = new Set()) {
    if (ancestors.size >= 10 || ancestors.has(value.url.href))
      throw new Error('Circular or deeply nested HTML frame: ' + value.url.href);
    const next = new Set(ancestors);
    next.add(value.url.href);
    const doc = parse(text(value));
    const base = new URL(doc.querySelector('base[href]')?.getAttribute('href') || '', value.url);
    for (const element of doc.querySelectorAll('base')) element.remove();
    for (const element of doc.querySelectorAll(
      'img[src],input[type="image"][src],video[poster],image[href],image[xlink\\:href],link[rel~="icon"][href]'
    )) {
      const attr = ['poster', 'src', 'data', 'href', 'xlink:href'].find(name => element.hasAttribute(name));
      element.setAttribute(attr, await resource(element.getAttribute(attr), base));
    }
    for (const element of doc.querySelectorAll(
      'link[rel="apple-touch-icon"][href],audio[src],video[src],source[src],track[src],object[data],embed[src]'
    )) {
      const attr = ['src', 'data', 'href'].find(name => element.hasAttribute(name));
      const url = resolveRef(element.getAttribute(attr), base);
      if (!url) continue;
      try {
        const asset = await get(url);
        element.setAttribute(attr, data(asset.type.split(';')[0], asset.bytes));
      } catch (error) {
        warnings.add(error.message);
        element.setAttribute(attr, url.href);
      }
    }
    for (const element of doc.querySelectorAll('link[rel~="stylesheet"][href]')) {
      element.setAttribute('href', await resource(element.getAttribute('href'), base, 'css'));
      element.removeAttribute('integrity');
    }
    for (const element of doc.querySelectorAll('img[srcset],source[srcset]')) {
      const candidates = parseSrcset(element.getAttribute('srcset'));
      for (const candidate of candidates) candidate.url = await resource(candidate.url, base);
      element.setAttribute('srcset', serializeSrcset(candidates));
    }
    for (const element of doc.querySelectorAll('style')) element.textContent = await css(element.textContent, base);
    for (const element of doc.querySelectorAll('[style]'))
      element.setAttribute('style', await css(element.getAttribute('style'), base));
    for (const element of doc.querySelectorAll('script[src]')) {
      const ref = element.getAttribute('src');
      const url = resolveRef(ref, base);
      if (!url) continue;
      if (element.getAttribute('type')?.toLowerCase() === 'module') {
        warnings.add('JavaScript modules are not bundled: ' + url.href);
        element.setAttribute('src', url.href);
        continue;
      }
      try {
        const script = await get(url);
        element.setAttribute('src', data('text/javascript;charset=utf-8', Buffer.from(text(script))));
        element.removeAttribute('integrity');
        element.removeAttribute('crossorigin');
      } catch (error) {
        warnings.add(error.message);
        element.setAttribute('src', url.href);
      }
    }
    const inspectedFrames = new Set();
    let frameIndex = 0;
    for (const element of doc.querySelectorAll('iframe[src],frame[src],iframe[srcdoc]')) {
      const inline = element.hasAttribute('srcdoc');
      const url = inline
        ? new URL('#seal-srcdoc-' + ancestors.size + '-' + frameIndex++, base)
        : resolveRef(element.getAttribute('src'), base);
      if (!url) continue;
      try {
        const frame = doc.createElement('iframe');
        for (const attribute of element.attributes)
          if (attribute.name !== 'src') frame.setAttribute(attribute.name, attribute.value);
        const content = inline
          ? { bytes: Buffer.from(element.getAttribute('srcdoc')), type: 'text/html', url }
          : await get(url);
        const preparedFrame = await html(content, next);
        inspectedFrames.add(preparedFrame);
        frame.setAttribute('srcdoc', preparedFrame);
        element.replaceWith(frame);
      } catch (error) {
        warnings.add(error.message);
        element.setAttribute('src', url.href);
      }
    }
    for (const element of doc.querySelectorAll('frameset')) {
      warnings.add('Legacy frameset layout was converted; check sheet navigation and layout.');
      const container = doc.createElement('div');
      container.setAttribute('style', 'display:flex;flex-wrap:wrap;min-height:100vh');
      container.append(...element.childNodes);
      element.replaceWith(container);
    }
    for (const element of doc.querySelectorAll('a[href],area[href],form[action]')) {
      const attr = element.hasAttribute('action') ? 'action' : 'href';
      const ref = element.getAttribute(attr);
      if (!ref || ref.startsWith('#') || /^(?:data:|javascript:|mailto:|tel:)/i.test(ref)) continue;
      element.setAttribute(attr, new URL(ref, base).href);
      warnings.add('Navigation and form targets still require their original location.');
    }
    if (doc.querySelector('script'))
      warnings.add('JavaScript runs after opening; dynamic dependencies and server behavior are not captured.');
    if (/<!--\s*\[if\b/i.test(text(value))) warnings.add('Office/IE conditional markup requires manual checking.');
    for (const meta of doc.querySelectorAll('meta[charset],meta[http-equiv="Content-Type" i]')) meta.remove();
    const charset = doc.createElement('meta');
    charset.setAttribute('charset', 'utf-8');
    doc.head.prepend(charset);
    if (ancestors.size && doc.querySelector('a[href^="#"],area[href^="#"]')) {
      const script = doc.createElement('script');
      script.textContent = '(' + scrollFragments.toString() + ')(document);';
      doc.body.append(script);
    }
    const entry = {
      path: 'report.html',
      file: {
        type: 'text/html',
        arrayBuffer: async () => Buffer.from('<!doctype html>\n' + doc.documentElement.outerHTML)
      }
    };
    const prepared = await embedSelectedHtml([entry, ...files], entry, { parse, inspectedFrames });
    prepared.warnings.forEach(warning => warnings.add(warning));
    return Buffer.from(prepared.bytes).toString('utf8');
  }
  try {
    const bytes = Buffer.from(await html(source));
    if (bytes.length > PREPARED_MAX_BYTES) throw new Error('Prepared content exceeds the 128 MiB working limit.');
    return {
      bytes,
      name: /\.html?$/i.test(source.name) ? source.name : 'report.html',
      type: 'text/html',
      warnings: [...warnings]
    };
  } finally {
    await window.happyDOM.close();
  }
}

// Only included in frame documents containing local fragment links.
function scrollFragments(document) {
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[href^="#"],area[href^="#"]');
    if (!link || event.defaultPrevented || event.button !== 0) return;
    event.preventDefault();
    try {
      const name = decodeURIComponent(link.getAttribute('href').slice(1));
      const target = document.getElementById(name) || document.getElementsByName(name)[0];
      if (target) target.scrollIntoView();
      else if (!name || name.toLowerCase() === 'top') document.defaultView.scrollTo(0, 0);
    } catch {
      /* Ignore malformed fragments. */
    }
  });
}
