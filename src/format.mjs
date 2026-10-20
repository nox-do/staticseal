// Shared by the creator, CLI and generated browser decoder.
export function createFormat(decodeChunk) {
const escapeHtml = (value) => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const fromBase64 = decodeChunk || ((value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0)));
const fromBase64Chunks = (chunks, tail = new Uint8Array(0)) => {
    const total = chunks.reduce((sum, chunk) => sum + Math.floor(chunk.length * 3 / 4)
      - (chunk.endsWith('==') ? 2 : chunk.endsWith('=') ? 1 : 0), tail.byteLength);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      const part = fromBase64(chunk);
      out.set(part, offset);
      offset += part.byteLength;
    }
    out.set(tail, offset);
    return out;
  };
const unpackContent = (bytes, metadata) => {
  if ((metadata.v !== 2 && metadata.v !== 3 && metadata.v !== 4 && metadata.v !== 5) || metadata.encoding !== 'metadata') {
    throw new Error('Unsupported payload format.');
  }
  if (bytes.byteLength < 4) throw new Error('Invalid file metadata.');
  const length = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0);
  if (length > 65536 || length > bytes.byteLength - 4) throw new Error('Invalid file metadata.');
  const inner = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(4, 4 + length)));
  if (typeof inner.filename !== 'string' || typeof inner.contentType !== 'string') {
    throw new Error('Invalid file metadata.');
  }
  return { bytes: bytes.subarray(4 + length), filename: inner.filename, contentType: inner.contentType,
    originalSize: inner.originalSize };
};
  return { escapeHtml, fromBase64, fromBase64Chunks, unpackContent };
}
