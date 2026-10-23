// Creator only: do not serialize these functions into recipient readers.
import { createFormat } from './format.mjs';
import { prepareContent } from './compression.mjs';

export async function preparePackage(
  bytes,
  file,
  { access, iterations, salt, iv, htmlPage = false, collection = false, chunkSize, readerFiles }
) {
  const format = createFormat();
  const display = collection ? { display: 'collection' } : htmlPage ? { display: 'page' } : {};
  // Preserve outer JSON field order as well as the independent AAD field order.
  const metadata =
    access === 'sealed'
      ? { v: format.versionFor(access), encoding: format.METADATA_ENCODING, access, ...display }
      : {
          v: format.versionFor(access),
          alg: 'AES-GCM',
          kdf: 'PBKDF2-SHA256',
          iterations,
          encoding: format.METADATA_ENCODING,
          ...display,
          access,
          salt,
          iv
        };
  const content = await prepareContent(bytes, file, metadata, chunkSize, readerFiles);
  metadata.v = content.v;
  const lengthPrefix = new Uint8Array(format.HEADER_LENGTH_BYTES);
  new DataView(lengthPrefix.buffer).setUint32(0, content.header.byteLength);
  // Keep these buffers separate so Node can feed each part directly to its cipher.
  return { metadata, bytes: content.bytes, header: content.header, lengthPrefix };
}
