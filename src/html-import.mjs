// Creator only: selected File objects are the entire resource authority. Never fetch URLs.
import { process as parseSrcset, serialize as serializeSrcset } from './srcset-parser.mjs';
import { PREPARED_MAX_BYTES } from './limits.mjs';
import { openWebsite } from './reader-factories.mjs';

export function inspectHtmlSelection(files) {
  const html = files.filter(file => /\.html?$/i.test(file.path));
  const indexes = html.filter(file => /(^|\/)index\.html?$/i.test(file.path));
  const roots = indexes.filter(file =>
    html.every(other => other.path.startsWith(file.path.slice(0, file.path.lastIndexOf('/') + 1)))
  );
  const entry = roots.length === 1 ? roots[0] : indexes.length === 0 && html.length === 1 ? html[0] : null;
  return { entry, ambiguous: html.length > 0 && !entry };
}

export async function embedSelectedHtml(
  files,
  entry,
  { parse = text => new DOMParser().parseFromString(text, 'text/html'), signal, onSize, inspectedFrames } = {}
) {
  const base = 'https://staticseal.invalid/';
  const limit = PREPARED_MAX_BYTES;
  const pathUrl = path => new URL(path.split('/').map(encodeURIComponent).join('/'), base).href;
  // The selected top-level folder containing the entry is the website root.
  // Additional loose files must not change that root.
  const root = entry.path.includes('/') ? pathUrl(entry.path.split('/')[0] + '/') : base;
  const byUrl = new Map(),
    used = new Set(),
    retained = new Set(),
    warnings = new Set();
  const cache = new Map(),
    prepared = new Map();
  const pageFiles = [entry],
    pages = [],
    pageIndexes = new Map([[entry, 0]]),
    links = [];
  let websiteCharacters = 0;
  let steps = 0;
  const check = () => signal?.throwIfAborted();
  const sizeCheck = size => {
    if (size > limit) throw new Error('Prepared content exceeds the 128 MiB working limit.');
    onSize?.(size);
  };
  const checkpoint = async () => {
    check();
    if (++steps % 32 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
      check();
    }
  };
  const flat = files.every(file => !file.path.includes('/'));
  files.forEach(file => {
    const url = pathUrl(file.path);
    byUrl.set(url, byUrl.has(url) ? null : file);
  });
  for (const file of files.filter(file => /(^|\/)index\.html?$/i.test(file.path))) {
    const url = pathUrl(file.path.replace(/index\.html?$/i, ''));
    byUrl.set(url, byUrl.has(url) ? null : file);
  }
  const toBase64 = bytes => {
    let text = '';
    for (let offset = 0; offset < bytes.length; offset += 32768)
      text += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    return btoa(text);
  };
  const read = async file => {
    check();
    if (!cache.has(file))
      cache.set(
        file,
        file.file.arrayBuffer().then(buffer => new Uint8Array(buffer))
      );
    const bytes = await cache.get(file);
    check();
    return bytes;
  };
  const type = file =>
    file.file.type ||
    {
      css: 'text/css',
      js: 'text/javascript',
      svg: 'image/svg+xml',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      gif: 'image/gif',
      avif: 'image/avif',
      ico: 'image/x-icon',
      woff: 'font/woff',
      woff2: 'font/woff2',
      ttf: 'font/ttf',
      otf: 'font/otf'
    }[file.path.split('.').pop().toLowerCase()] ||
    'application/octet-stream';
  function find(ref, from) {
    if (/^blob:/i.test(ref)) warnings.add('Non-portable blob reference: ' + ref);
    if (/^data:(?:text\/(?:html|css)|application\/xhtml\+xml|image\/svg\+xml)[;,]/i.test(ref))
      warnings.add('Embedded document dependencies need manual checking.');
    if (!ref || /^(?:data:|blob:|#)/i.test(ref)) return null;
    let url;
    try {
      url = new URL(ref, from);
      if (url.origin === new URL(base).origin && ref.startsWith('/') && !ref.startsWith('//'))
        url = new URL(ref.slice(1), root);
    } catch {
      warnings.add('Unrecognized reference: ' + ref);
      return null;
    }
    if (url.origin !== new URL(base).origin) {
      warnings.add('External dependency: ' + ref);
      return null;
    }
    const fragment = url.hash;
    url.hash = '';
    url.search = '';
    let file = byUrl.get(url.href);
    if (file === undefined) file = byUrl.get(url.href + '/');
    if (file === undefined && flat && !url.pathname.endsWith('/')) {
      try {
        file = byUrl.get(pathUrl(decodeURIComponent(url.pathname.split('/').pop())));
      } catch {
        warnings.add('Unrecognized reference: ' + ref);
        return null;
      }
    }
    if (!file) {
      warnings.add('Missing or ambiguous resource: ' + ref);
      return null;
    }
    return { file, fragment };
  }
  function unsupported(ref, from) {
    const resolved = find(ref, from);
    if (resolved) {
      retained.add(resolved.file);
      warnings.add('Not embedded in this version: ' + ref);
    }
    return resolved;
  }
  function retainAll(message) {
    warnings.add(message);
    files.forEach(file => retained.add(file));
  }
  async function data(ref, from, ancestors = new Set(), kind = '') {
    await checkpoint();
    const resolved = find(ref, from);
    if (!resolved) return ref;
    const { file, fragment } = resolved;
    if (ancestors.has(file)) {
      ancestors.forEach(item => retained.add(item));
      retained.add(file);
      warnings.add('Circular CSS reference: ' + ref);
      return ref;
    }
    const isCss =
      kind === 'css' || (kind !== 'raw' && (/^text\/css(?:;|$)/i.test(type(file)) || /\.css$/i.test(file.path)));
    const key = pathUrl(file.path) + (isCss ? ':css' : ':raw');
    if (!prepared.has(key)) {
      let bytes = await read(file);
      if (isCss) {
        const next = new Set(ancestors);
        next.add(file);
        bytes = new TextEncoder().encode(
          await css(new TextDecoder('utf-8', { fatal: true }).decode(bytes), pathUrl(file.path), next)
        );
      }
      const prefix = 'data:' + (isCss ? 'text/css' : type(file)) + ';base64,';
      // Bound each intermediate result independently; nested CSS encoding must
      // not count the same image against the final HTML limit several times.
      sizeCheck(prefix.length + 4 * Math.ceil(bytes.length / 3) + fragment.length);
      const value = prefix + toBase64(bytes);
      prepared.set(key, value);
      used.add(file);
      return value + fragment;
    }
    used.add(file);
    return prepared.get(key) + fragment;
  }
  async function replaceAsync(text, pattern, replacer) {
    const parts = [];
    let offset = 0,
      length = 0;
    for (const match of text.matchAll(pattern)) {
      await checkpoint();
      const value = await replacer(match);
      const prefix = text.slice(offset, match.index);
      length += prefix.length + value.length;
      sizeCheck(length);
      parts.push(prefix, value);
      offset = match.index + match[0].length;
    }
    sizeCheck(length + text.length - offset);
    parts.push(text.slice(offset));
    return parts.join('');
  }
  async function css(text, from, ancestors = new Set()) {
    // Retain possible dependencies when unsupported syntax prevents analysis.
    if (text.includes('\\')) {
      retainAll('CSS with escapes needs manual checking: ' + from.replace(base, ''));
      return text;
    }
    return replaceAsync(
      text,
      /\/\*[\s\S]*?\*\/|@import\b(?:\s|\/\*[\s\S]*?\*\/)*(["'])(.*?)\1|(?:@import\b(?:\s|\/\*[\s\S]*?\*\/)*)?\burl\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^)'"\s]*))\s*\)|\b(?:-webkit-)?image-set\s*\(|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gi,
      async match => {
        if (/^(?:\/\*|["'])/.test(match[0])) return match[0];
        if (/^(?:-webkit-)?image-set\s*\(/i.test(match[0])) {
          retainAll('CSS image-set() needs manual checking: ' + from.replace(base, ''));
          return match[0];
        }
        const ref = match[2] ?? match[3] ?? match[4] ?? match[5];
        // @import url(...) and quoted @import both establish stylesheet context.
        const isImport = /^@import\b/i.test(match[0]);
        const kind = isImport ? 'css' : '';
        const value = await data(ref, from, ancestors, kind);
        return value === ref ? match[0] : (isImport ? '@import ' : '') + 'url("' + value + '")';
      }
    );
  }
  const decodeHtml = bytes =>
    new TextDecoder(
      bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8',
      { fatal: true }
    ).decode(bytes);
  async function page(pageFile) {
    const doc = parse(decodeHtml(await read(pageFile)));
    websiteCharacters += doc.documentElement.outerHTML.length + 16;
    sizeCheck(websiteCharacters);
    function attribute(element, name, value) {
      const delta = value.length - (element.getAttribute(name) || '').length;
      websiteCharacters += delta;
      sizeCheck(websiteCharacters);
      element.setAttribute(name, value);
    }
    if (doc.querySelector('meta[http-equiv="Content-Security-Policy" i]'))
      warnings.add('The page security policy may block embedded resources. Check the prepared HTML.');
    const baseElement = doc.querySelector('base[href]');
    const pageUrl = pathUrl(pageFile.path);
    const htmlBase = baseElement ? new URL(baseElement.getAttribute('href'), pageUrl).href : pageUrl;
    if (baseElement) warnings.add('Page declares a base URL; links may still require the original location.');
    for (const element of doc.querySelectorAll(
      'img[src],input[type="image"][src],video[poster],image[href],image[xlink\\:href],link[rel~="icon"][href]'
    )) {
      const attr = element.hasAttribute('poster')
        ? 'poster'
        : element.hasAttribute('src')
          ? 'src'
          : element.hasAttribute('href')
            ? 'href'
            : 'xlink:href';
      attribute(element, attr, await data(element.getAttribute(attr), htmlBase));
    }
    for (const element of doc.querySelectorAll('img[srcset],source[srcset]')) {
      const candidates = parseSrcset(element.getAttribute('srcset'));
      for (const candidate of candidates) candidate.url = await data(candidate.url, htmlBase);
      attribute(element, 'srcset', serializeSrcset(candidates));
    }
    for (const element of doc.querySelectorAll('link[rel~="stylesheet"][href]')) {
      const ref = element.getAttribute('href');
      const value = await data(ref, htmlBase, new Set(), 'css');
      if (value !== ref) {
        attribute(element, 'href', value);
        element.removeAttribute('integrity');
      }
    }
    for (const element of doc.querySelectorAll('style')) {
      const value = await css(element.textContent, htmlBase);
      const delta = value.length - element.textContent.length;
      websiteCharacters += delta;
      sizeCheck(websiteCharacters);
      element.textContent = value;
    }
    for (const element of doc.querySelectorAll('[style]'))
      attribute(element, 'style', await css(element.getAttribute('style'), htmlBase));
    for (const element of doc.querySelectorAll(
      'script[src],iframe[src],frame[src],audio[src],video[src],source[src],track[src],object[data],embed[src],use[href],use[xlink\\:href]'
    )) {
      unsupported(
        element.getAttribute('src') ||
          element.getAttribute('data') ||
          element.getAttribute('href') ||
          element.getAttribute('xlink:href'),
        htmlBase
      );
    }
    for (const element of doc.querySelectorAll('iframe[srcdoc]')) {
      if (!inspectedFrames?.has(element.getAttribute('srcdoc')))
        retainAll('Embedded frame dependencies need manual checking.');
    }
    for (const element of doc.querySelectorAll('a[href]')) {
      const ref = element.getAttribute('href');
      // Ordinary external hyperlinks are navigation, not page dependencies.
      if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(ref) && !element.hasAttribute('download')) continue;
      const resolved = find(ref, htmlBase);
      if (!resolved) continue;
      const target = resolved.file;
      if (
        !element.hasAttribute('download') &&
        (/\.html?$/i.test(target.path) || /^text\/html(?:;|$)/i.test(type(target)))
      ) {
        if (!pageIndexes.has(target)) {
          pageIndexes.set(target, pageFiles.length);
          pageFiles.push(target);
          used.add(target);
        }
        attribute(element, 'data-seal-page', String(pageIndexes.get(target)));
        attribute(element, 'href', resolved.fragment || '#');
      } else {
        links.push({ element, ref, htmlBase, target, attribute });
      }
    }
    if (doc.querySelector('script[type="module"]')) warnings.add('JavaScript module dependencies are not bundled.');
    for (const meta of doc.querySelectorAll('meta[charset],meta[http-equiv="Content-Type" i]')) meta.remove();
    const charset = doc.createElement('meta');
    charset.setAttribute('charset', 'utf-8');
    doc.head.prepend(charset);
    check();
    return doc;
  }
  const documents = [];
  for (const file of pageFiles) {
    documents.push(await page(file));
  }
  // Resolve attachment links after every page's resources are known, independent
  // of link order. Downloads use original bytes, including transformed CSS.
  for (const { element, ref, htmlBase, target, attribute } of links) {
    if (used.has(target) || pageIndexes.has(target))
      attribute(element, 'href', await data(ref, htmlBase, new Set(), 'raw'));
    else {
      retained.add(target);
      warnings.add('Link target kept as a separate file; link is not rewritten: ' + ref);
    }
  }
  let total = 0;
  for (const doc of documents) {
    const text = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
    const bytes = new TextEncoder().encode(text);
    total += bytes.length;
    sizeCheck(total);
    pages.push(text);
  }
  let bytes = new TextEncoder().encode(pages[0]);
  if (pages.length > 1) {
    // Store shared data URLs once; expand only the page being shown. Choose a
    // marker absent from the original HTML so literal page text cannot collide.
    const assets = [];
    let prefix = 'seal-resource:',
      token = 0;
    while (pages.some(text => text.includes(prefix))) {
      await checkpoint();
      prefix = 'seal-resource:' + ++token + ':';
    }
    for (const value of [...new Set(prepared.values())].sort((a, b) => b.length - a.length)) {
      await checkpoint();
      if (value.length < 128 || pages.filter(text => text.includes(value)).length < 2) continue;
      const marker = prefix + assets.length + ';';
      for (let n = 0; n < pages.length; n++) pages[n] = pages[n].split(value).join(marker);
      assets.push(value);
    }
    const shell = parse(
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style></head><body></body></html>'
    );
    shell.title = documents[0].title;
    const icon = documents[0].querySelector('link[rel~="icon"]');
    if (icon) shell.head.append(icon.cloneNode(true));
    const script = shell.createElement('script');
    script.textContent =
      '(' + openWebsite.toString() + ')(' + JSON.stringify([pages, assets, prefix]).replaceAll('<', '\\u003c') + ');';
    shell.body.append(script);
    bytes = new TextEncoder().encode('<!DOCTYPE html>\n' + shell.documentElement.outerHTML);
    sizeCheck(bytes.length);
  }
  return { bytes, used, retained, pageCount: pages.length, warnings: Array.from(warnings) };
}
