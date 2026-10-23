// Creator only: selected File objects are the entire resource authority. Never fetch URLs.
import { process as parseSrcset, serialize as serializeSrcset } from './srcset-parser.mjs';

export function inspectHtmlSelection(files) {
  const html = files.filter(file => /\.html?$/i.test(file.path));
  const indexes = html.filter(file => /(^|\/)index\.html?$/i.test(file.path));
  const entry = indexes.length === 1 ? indexes[0] : indexes.length === 0 && html.length === 1 ? html[0] : null;
  return { entry, ambiguous: html.length > 0 && !entry };
}

export async function embedSelectedHtml(files, entry, {
  parse = text => new DOMParser().parseFromString(text, 'text/html'), signal
} = {}) {
  const base = 'https://staticseal.invalid/';
  const limit = 25 * 1024 * 1024;
  const pathUrl = path => new URL(path.split('/').map(encodeURIComponent).join('/'), base).href;
  const entryUrl = pathUrl(entry.path);
  // The selected top-level folder containing the entry is the website root.
  // Additional loose files must not change that root.
  const root = entry.path.includes('/') ? pathUrl(entry.path.split('/')[0] + '/') : base;
  const byUrl = new Map(), used = new Set(), retained = new Set(), warnings = new Set();
  const cache = new Map(), prepared = new Map();
  let steps = 0;
  const check = () => signal?.throwIfAborted();
  const sizeCheck = size => { if (size > limit) throw new Error('Prepared content exceeds the 25 MiB total limit.'); };
  const checkpoint = async () => {
    check();
    if (++steps % 32 === 0) { await new Promise(resolve => setTimeout(resolve, 0)); check(); }
  };
  const flat = files.every(file => !file.path.includes('/'));
  files.forEach(file => {
    const url = pathUrl(file.path);
    byUrl.set(url, byUrl.has(url) ? null : file);
  });
  const toBase64 = bytes => {
    let text = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) text += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    return btoa(text);
  };
  const read = async file => {
    check();
    if (!cache.has(file)) cache.set(file, file.file.arrayBuffer().then(buffer => new Uint8Array(buffer)));
    const bytes = await cache.get(file);
    check();
    return bytes;
  };
  const type = file => file.file.type || ({ css: 'text/css', js: 'text/javascript', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf' }[file.path.split('.').pop().toLowerCase()] || 'application/octet-stream');
  function find(ref, from) {
    if (!ref || /^(?:data:|blob:|#)/i.test(ref)) return null;
    let url;
    try {
      url = new URL(ref, from);
      if (url.origin === new URL(base).origin && ref.startsWith('/') && !ref.startsWith('//')) url = new URL(ref.slice(1), root);
    }
    catch { warnings.add('Unrecognized reference: ' + ref); return null; }
    if (url.origin !== new URL(base).origin) { warnings.add('External dependency: ' + ref); return null; }
    const fragment = url.hash;
    url.hash = ''; url.search = '';
    let file = byUrl.get(url.href);
    if (file === undefined && flat) {
      try { file = byUrl.get(pathUrl(decodeURIComponent(url.pathname.split('/').pop()))); }
      catch { warnings.add('Unrecognized reference: ' + ref); return null; }
    }
    if (!file) { warnings.add('Missing or ambiguous resource: ' + ref); return null; }
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
    const isCss = kind === 'css' || kind !== 'raw' && (/^text\/css(?:;|$)/i.test(type(file)) || /\.css$/i.test(file.path));
    const key = pathUrl(file.path) + (isCss ? ':css' : ':raw');
    if (!prepared.has(key)) {
      let bytes = await read(file);
      if (isCss) {
        const next = new Set(ancestors); next.add(file);
        bytes = new TextEncoder().encode(await css(new TextDecoder('utf-8', { fatal: true }).decode(bytes), pathUrl(file.path), next));
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
    let offset = 0, length = 0;
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
    return replaceAsync(text, /\/\*[\s\S]*?\*\/|@import\b(?:\s|\/\*[\s\S]*?\*\/)*(["'])(.*?)\1|(?:@import\b(?:\s|\/\*[\s\S]*?\*\/)*)?\burl\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^)'"\s]*))\s*\)|\b(?:-webkit-)?image-set\s*\(|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gi, async match => {
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
    });
  }
  const decodeHtml = bytes => new TextDecoder(bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8', { fatal: true }).decode(bytes);
  const doc = parse(decodeHtml(await read(entry)));
  let htmlCharacters = doc.documentElement.outerHTML.length + 16;
  function attribute(element, name, value) {
    htmlCharacters += value.length - (element.getAttribute(name) || '').length;
    sizeCheck(htmlCharacters);
    element.setAttribute(name, value);
  }
  if (doc.querySelector('meta[http-equiv="Content-Security-Policy" i]')) warnings.add('The page security policy may block embedded resources. Check the prepared HTML.');
  const baseElement = doc.querySelector('base[href]');
  const htmlBase = baseElement ? new URL(baseElement.getAttribute('href'), entryUrl).href : entryUrl;
  if (baseElement) warnings.add('Page declares a base URL; links may still require the original location.');
  for (const element of doc.querySelectorAll('img[src],input[type="image"][src],video[poster],image[href],image[xlink\\:href],link[rel~="icon"][href]')) {
    const attr = element.hasAttribute('poster') ? 'poster' : element.hasAttribute('src') ? 'src' : element.hasAttribute('href') ? 'href' : 'xlink:href';
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
    if (value !== ref) { attribute(element, 'href', value); element.removeAttribute('integrity'); }
  }
  for (const element of doc.querySelectorAll('style')) {
    const value = await css(element.textContent, htmlBase);
    htmlCharacters += value.length - element.textContent.length;
    sizeCheck(htmlCharacters);
    element.textContent = value;
  }
  for (const element of doc.querySelectorAll('[style]')) attribute(element, 'style', await css(element.getAttribute('style'), htmlBase));
  for (const element of doc.querySelectorAll('script[src],iframe[src],audio[src],video[src],source[src],track[src],object[data],embed[src],use[href],use[xlink\\:href]')) {
    unsupported(element.getAttribute('src') || element.getAttribute('data') || element.getAttribute('href') || element.getAttribute('xlink:href'), htmlBase);
  }
  for (const element of doc.querySelectorAll('a[href]')) {
    const ref = element.getAttribute('href');
    // Ordinary external hyperlinks are navigation, not page dependencies.
    if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(ref) && !element.hasAttribute('download')) continue;
    const resolved = find(ref, htmlBase);
    if (!resolved) continue;
    if (element.hasAttribute('download') && used.has(resolved.file)) {
      // A stylesheet download must keep the original bytes, not its transformed
      // contents. Other non-embedded attachments stay separate in the collection.
      attribute(element, 'href', await data(ref, htmlBase, new Set(), 'raw'));
    } else {
      retained.add(resolved.file);
      warnings.add('Link target kept as a separate file; link is not rewritten: ' + ref);
    }
  }
  if (doc.querySelector('script[type="module"]')) warnings.add('JavaScript module dependencies are not bundled.');
  for (const meta of doc.querySelectorAll('meta[charset],meta[http-equiv="Content-Type" i]')) meta.remove();
  const charset = doc.createElement('meta'); charset.setAttribute('charset', 'utf-8'); doc.head.prepend(charset);
  check();
  const bytes = new TextEncoder().encode('<!DOCTYPE html>\n' + doc.documentElement.outerHTML);
  sizeCheck(bytes.length);
  return { bytes, used, retained, warnings: Array.from(warnings) };
}
