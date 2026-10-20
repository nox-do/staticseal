// Standalone: serialized into compressed envelopes only.
export async function inflateContent(content) {
  const size = content.originalSize;
  if (!Number.isSafeInteger(size) || size < 0 || size > 25 * 1024 * 1024) {
    throw new Error('Invalid or oversized compressed content.');
  }
  if (typeof DecompressionStream !== 'function') {
    throw new DOMException('This file needs a browser with gzip decompression support.', 'NotSupportedError');
  }
  const reader = new Blob([content.bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const parts = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > size - total) {
        await reader.cancel();
        throw new Error('Expanded content exceeds its declared size.');
      }
      total += value.byteLength;
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total !== size) throw new Error('Expanded content size mismatch.');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return { bytes, filename: content.filename, contentType: content.contentType };
}
