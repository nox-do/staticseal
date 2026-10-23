import { renderWrapper } from './wrapper.mjs';
import { createFormat } from './format.mjs';
import { BROWSER_FILE_MAX_BYTES } from './browser-limits.mjs';

export const COMPRESSION_THRESHOLD = 4 * 1024;

// Creator only. Compare exact output lengths without encrypting/encoding twice.
export async function prepareContent(bytes, file, metadata, chunkSize, maxOriginalSize = BROWSER_FILE_MAX_BYTES) {
  const format = createFormat();
  const encoder = new TextEncoder();
  const header = encoder.encode(JSON.stringify(file));
  if (header.byteLength > format.MAX_METADATA_BYTES) throw new Error('Filename metadata is too large.');
  const rawVersion = format.versionFor(metadata.access);
  const compressedVersion = format.versionFor(metadata.access, true);
  const original = { bytes, header, v: rawVersion };
  // The browser keeps its original limit; the CLI opts into a larger range.
  if (
    bytes.byteLength < COMPRESSION_THRESHOLD ||
    bytes.byteLength > maxOriginalSize ||
    typeof CompressionStream !== 'function' ||
    typeof DecompressionStream !== 'function'
  )
    return original;
  const compressed = new Uint8Array(
    await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
  );
  if (compressed.byteLength >= bytes.byteLength) return original;
  const compressedHeader = encoder.encode(JSON.stringify({ ...file, originalSize: bytes.byteLength }));
  if (compressedHeader.byteLength > format.MAX_METADATA_BYTES) return original;
  const rawChunkSize = Math.max(3, Math.floor(chunkSize / 4) * 3);
  const packageSize = (v, headerSize, contentSize) => {
    const length = format.HEADER_LENGTH_BYTES + headerSize + contentSize;
    const chunks = Math.ceil(length / rawChunkSize);
    const html = renderWrapper({
      title: '',
      payload: { ...metadata, v, ...(format.isUnencryptedVersion(v) ? { content: [] } : { tag: '', ciphertext: [] }) }
    });
    // Base64 chunks are multiples of three bytes, except the last; JSON adds quotes/commas.
    return encoder.encode(html).byteLength + 4 * Math.ceil(length / 3) + 3 * chunks - 1;
  };
  if (
    packageSize(compressedVersion, compressedHeader.byteLength, compressed.byteLength) >=
    packageSize(rawVersion, header.byteLength, bytes.byteLength)
  )
    return original;
  return { bytes: compressed, header: compressedHeader, v: compressedVersion };
}
