// Shared by the creator, CLI and generated browser decoder.
// Keep all rules inside this factory: generated readers serialize it without imports.
export function createFormat(decodeChunk) {
  const ENCRYPTED_RAW_VERSION = 2;
  const ENCRYPTED_GZIP_VERSION = 3;
  const SEALED_RAW_VERSION = 4;
  const SEALED_GZIP_VERSION = 5;
  const METADATA_ENCODING = 'metadata';
  const HEADER_LENGTH_BYTES = 4;
  const MAX_METADATA_BYTES = 65536;
  const GCM_TAG_BYTES = 16;
  const SALT_BYTES = 16;
  const IV_BYTES = 12;
  // Reader safety ceiling, independent of either creator's original-file limit.
  const MAX_EXPANDED_BYTES = 128 * 1024 * 1024;
  const isEncryptedVersion = version => version === ENCRYPTED_RAW_VERSION || version === ENCRYPTED_GZIP_VERSION;
  const isUnencryptedVersion = version => version === SEALED_RAW_VERSION || version === SEALED_GZIP_VERSION;
  const isSupportedVersion = version => isEncryptedVersion(version) || isUnencryptedVersion(version);
  const isCompressedVersion = version => version === ENCRYPTED_GZIP_VERSION || version === SEALED_GZIP_VERSION;
  const versionFor = (access, compressed = false) => access === 'sealed'
    ? (compressed ? SEALED_GZIP_VERSION : SEALED_RAW_VERSION)
    : (compressed ? ENCRYPTED_GZIP_VERSION : ENCRYPTED_RAW_VERSION);

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
    if (!isSupportedVersion(metadata.v) || metadata.encoding !== METADATA_ENCODING) {
      throw new Error('Unsupported payload format.');
    }
    if (bytes.byteLength < HEADER_LENGTH_BYTES) throw new Error('Invalid file metadata.');
    const length = new DataView(bytes.buffer, bytes.byteOffset, HEADER_LENGTH_BYTES).getUint32(0);
    if (length > MAX_METADATA_BYTES || length > bytes.byteLength - HEADER_LENGTH_BYTES) throw new Error('Invalid file metadata.');
    const inner = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(HEADER_LENGTH_BYTES, HEADER_LENGTH_BYTES + length)));
    if (typeof inner.filename !== 'string' || typeof inner.contentType !== 'string') {
      throw new Error('Invalid file metadata.');
    }
    return { bytes: bytes.subarray(HEADER_LENGTH_BYTES + length), filename: inner.filename, contentType: inner.contentType,
      originalSize: inner.originalSize };
  };
  return { escapeHtml, fromBase64, fromBase64Chunks, unpackContent,
    isSupportedVersion, isEncryptedVersion, isUnencryptedVersion, isCompressedVersion, versionFor,
    METADATA_ENCODING, HEADER_LENGTH_BYTES, MAX_METADATA_BYTES, GCM_TAG_BYTES, SALT_BYTES, IV_BYTES, MAX_EXPANDED_BYTES };
}
