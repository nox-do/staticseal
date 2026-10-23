// Test fixtures assembled through public module exports, not hidden app functions.
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { preparePackage } from '../../src/creation.mjs';
import { createFormat } from '../../src/format.mjs';
import { createCrypto } from '../../src/crypto.mjs';
import { inflateContent } from '../../src/gzip.mjs';

const format = createFormat(value => Buffer.from(value, 'base64'));
const cryptography = createCrypto();

export function toBase64Chunks(bytes, width) {
  const rawWidth = Math.max(3, Math.floor(width / 4) * 3);
  const chunks = [];
  for (let offset = 0; offset < bytes.byteLength; offset += rawWidth) {
    chunks.push(Buffer.from(bytes.subarray(offset, offset + rawWidth)).toString('base64'));
  }
  return chunks;
}

export async function makePayload(bytes, password, iterations, file, access, privateFilename = false, htmlPage = false, collection = false) {
  const salt = access === 'sealed' ? undefined : webcrypto.getRandomValues(new Uint8Array(16));
  const iv = access === 'sealed' ? undefined : webcrypto.getRandomValues(new Uint8Array(12));
  const content = await preparePackage(bytes, { filename: file.name, contentType: file.type }, {
    access, iterations, htmlPage, collection, chunkSize: 65536,
    salt: salt && Buffer.from(salt).toString('base64'), iv: iv && Buffer.from(iv).toString('base64')
  });
  // Legacy public-metadata fixtures only. Product creators always keep these
  // fields inside the package; readers must still authenticate older envelopes.
  if (!privateFilename) Object.assign(content.metadata, { filename: file.name, contentType: file.type });
  const packed = Buffer.concat([content.lengthPrefix, content.header, content.bytes]);
  if (access === 'sealed') return { ...content.metadata, content: toBase64Chunks(packed, 65536) };
  const key = await cryptography.deriveKey(password, salt, iterations, ['encrypt', 'decrypt']);
  const encrypted = new Uint8Array(await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: cryptography.authenticatedDataFor(content.metadata) }, key, packed
  ));
  return { ...content.metadata, tag: Buffer.from(encrypted.subarray(-16)).toString('base64'),
    ciphertext: toBase64Chunks(encrypted.subarray(0, -16), 65536) };
}

export async function decodePayload(payload, password) {
  const bytes = format.isUnencryptedVersion(payload.v) ? format.fromBase64Chunks(payload.content)
    : await cryptography.decryptPayload(payload, password, format.fromBase64, format.fromBase64Chunks);
  const content = format.unpackContent(bytes, payload);
  return format.isCompressedVersion(payload.v) ? inflateContent(content, format.MAX_EXPANDED_BYTES) : content;
}

export async function verifyPayload(payload, password, expected) {
  assert.deepEqual(Buffer.from((await decodePayload(payload, password)).bytes), Buffer.from(expected));
}
