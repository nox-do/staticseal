import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SOURCE_MAX_BYTES } from '../../src/limits.mjs';
import { createFileTypes } from '../../src/preview.mjs';

const { inferContentType } = createFileTypes();
export const sourceUrl = value => (/^(?:https?:|file:)/i.test(value) ? new URL(value) : pathToFileURL(resolve(value)));
export function createSourceLoader({ root, allowFiles = true, maxBytes = SOURCE_MAX_BYTES, maxFiles = 1000 } = {}) {
  const cache = new Map();
  let total = 0;
  const account = length => {
    total += length;
    if (total > maxBytes) throw new Error('Source content exceeds the 128 MiB CLI limit.');
  };
  return async function load(value) {
    const url = new URL(value);
    url.hash = '';
    if (!cache.has(url.href)) {
      if (cache.size >= maxFiles) throw new Error('Maximum 1,000 source resources.');
      cache.set(
        url.href,
        (async () => {
          let bytes,
            type,
            final = url;
          if (url.protocol === 'file:') {
            if (!allowFiles) throw new Error('A remote report cannot read local files: ' + url.href);
            const path = root ? await realpath(fileURLToPath(url)) : fileURLToPath(url);
            if (root) {
              const offset = relative(await realpath(root), path);
              if (
                offset === '..' ||
                offset.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) ||
                isAbsolute(offset)
              )
                throw new Error('Local resource is outside the report directory: ' + url.href);
            }
            const size = (await stat(path)).size;
            account(size);
            bytes = await readFile(path);
            if (bytes.length > size) account(bytes.length - size);
          } else if (url.protocol === 'https:' || url.protocol === 'http:') {
            const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
            if (!response.ok) {
              await response.body?.cancel();
              throw new Error('HTTP ' + response.status + ': ' + url.href);
            }
            final = new URL(response.url);
            type = response.headers.get('content-type');
            const length = Number(response.headers.get('content-length'));
            if (length > maxBytes - total) {
              await response.body?.cancel();
              throw new Error('Source content exceeds the 128 MiB CLI limit.');
            }
            const chunks = [];
            for await (const chunk of response.body) {
              account(chunk.length);
              chunks.push(chunk);
            }
            bytes = Buffer.concat(chunks);
          } else throw new Error('Unsupported resource protocol: ' + url.protocol);
          const name = basename(decodeURIComponent(final.pathname)) || 'report.html';
          return {
            bytes,
            url: final,
            name,
            type:
              type ||
              {
                css: 'text/css',
                js: 'text/javascript',
                mjs: 'text/javascript',
                woff: 'font/woff',
                woff2: 'font/woff2',
                ttf: 'font/ttf',
                ico: 'image/x-icon'
              }[name.split('.').pop().toLowerCase()] ||
              inferContentType(name)
          };
        })()
      );
    }
    return cache.get(url.href);
  };
}
export const reportRoot = url => (url.protocol === 'file:' ? dirname(fileURLToPath(url)) : undefined);
