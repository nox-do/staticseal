import { renderWrapper } from './wrapper.mjs';

export const COMPRESSION_THRESHOLD = 4 * 1024;

// Creator only. Compare exact output lengths without encrypting/encoding twice.
export async function prepareContent(bytes, file, metadata, chunkSize, maxOriginalSize = 25 * 1024 * 1024) {
  const encoder = new TextEncoder();
  const header = encoder.encode(JSON.stringify(file));
  if (header.byteLength > 65536) throw new Error('Filename metadata is too large.');
  const rawVersion = metadata.access === 'sealed' ? 4 : 2;
  const original = { bytes, header, v: rawVersion };
  // The browser keeps its original limit; the CLI opts into a larger range.
  if (bytes.byteLength < COMPRESSION_THRESHOLD || bytes.byteLength > maxOriginalSize
      || typeof CompressionStream !== 'function' || typeof DecompressionStream !== 'function') return original;
  const compressed = new Uint8Array(await new Response(
    new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
  ).arrayBuffer());
  if (compressed.byteLength >= bytes.byteLength) return original;
  const compressedHeader = encoder.encode(JSON.stringify({ ...file, originalSize: bytes.byteLength }));
  if (compressedHeader.byteLength > 65536) return original;
  const rawChunkSize = Math.max(3, Math.floor(chunkSize / 4) * 3);
  const packageSize = (v, headerSize, contentSize) => {
    const length = 4 + headerSize + contentSize;
    const chunks = Math.ceil(length / rawChunkSize);
    const html = renderWrapper({ title: '', payload: { ...metadata, v, ...(v >= 4 ? { content: [] } : { tag: '', ciphertext: [] }) } });
    // Base64 chunks are multiples of three bytes, except the last; JSON adds quotes/commas.
    return encoder.encode(html).byteLength + 4 * Math.ceil(length / 3) + 3 * chunks - 1;
  };
  if (packageSize(rawVersion + 1, compressedHeader.byteLength, compressed.byteLength)
      >= packageSize(rawVersion, header.byteLength, bytes.byteLength)) return original;
  return { bytes: compressed, header: compressedHeader, v: rawVersion + 1 };
}
