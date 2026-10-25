// MIME decoding for report exports; never executes or fetches archive contents.
function fields(text) {
  const result = new Map();
  for (const line of text.replace(/\r?\n[\t ]+/g, ' ').split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0) result.set(line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim());
  }
  return result;
}
const parameter = (value, key) => {
  const match = value?.match(new RegExp('(?:^|;)\\s*' + key + '\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))', 'i'));
  return match && (match[1] ?? match[2]);
};
export function decodeText(bytes, type = '') {
  const prefix = bytes.subarray(0, 2048).toString('latin1');
  const encoding =
    bytes[0] === 255 && bytes[1] === 254
      ? 'utf-16le'
      : bytes[0] === 254 && bytes[1] === 255
        ? 'utf-16be'
        : parameter(type, 'charset') ||
          prefix.match(/<meta\b[^>]*charset\s*=\s*["']?([\w-]+)/i)?.[1] ||
          prefix.match(/^\s*@charset\s+["']([^"']+)/i)?.[1] ||
          'utf-8';
  return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}
export function readMhtml(bytes, fallback) {
  const parts = [];
  let start;
  function visit(text, depth = 0) {
    if (depth > 10) throw new Error('MHTML nesting exceeds 10 levels.');
    const separator = /\r?\n\r?\n/.exec(text);
    if (!separator) throw new Error('Invalid MHTML: missing MIME headers.');
    const headers = fields(text.slice(0, separator.index));
    const body = text.slice(separator.index + separator[0].length);
    const type = headers.get('content-type') || 'text/plain';
    if (/^multipart\//i.test(type)) {
      const boundary = parameter(type, 'boundary');
      if (!boundary || /[\r\n]/.test(boundary)) throw new Error('Invalid MHTML boundary.');
      if (depth === 0) start = parameter(type, 'start');
      const delimiter = new RegExp(
        '(?:^|\\r?\\n)--' + boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(--)?[ \\t]*(?:\\r?\\n|$)',
        'g'
      );
      let offset,
        closed = false;
      for (const match of body.matchAll(delimiter)) {
        if (offset !== undefined) visit(body.slice(offset, match.index), depth + 1);
        if (match[1]) {
          closed = true;
          break;
        }
        offset = match.index + match[0].length;
      }
      if (!closed) throw new Error('Invalid MHTML: missing closing boundary.');
      return;
    }
    if (parts.length >= 1000) throw new Error('Maximum 1,000 MHTML parts.');
    const transfer = (headers.get('content-transfer-encoding') || '8bit').toLowerCase();
    let content;
    if (transfer === 'base64') {
      const encoded = body.replace(/\s/g, '');
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) throw new Error('Invalid MHTML base64.');
      content = Buffer.from(encoded, 'base64');
    } else if (transfer === 'quoted-printable') {
      content = Buffer.from(
        body.replace(/=\r?\n/g, '').replace(/=([\da-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))),
        'latin1'
      );
    } else if (['7bit', '8bit', 'binary'].includes(transfer)) content = Buffer.from(body, 'latin1');
    else throw new Error('Unsupported MHTML transfer encoding: ' + transfer);
    parts.push({ bytes: content, type, location: headers.get('content-location'), id: headers.get('content-id') });
  }
  visit(bytes.toString('latin1'));
  const entry = start ? parts.find(part => part.id === start) : parts.find(part => /^text\/html\b/i.test(part.type));
  if (!entry || !/^text\/html\b/i.test(entry.type)) throw new Error('MHTML contains no HTML start page.');
  const base = entry.location ? new URL(entry.location, fallback) : fallback;
  const resources = new Map();
  const add = (key, part) => {
    if (resources.has(key)) throw new Error('Ambiguous MHTML resource: ' + key);
    resources.set(key, part);
  };
  for (const part of parts) {
    if (part.location) add(new URL(part.location, base).href, part);
    if (part.id) add('cid:' + part.id.replace(/^<|>$/g, ''), part);
  }
  return { entry: { ...entry, url: base }, resources };
}
