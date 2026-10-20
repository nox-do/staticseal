// Standalone: embedded only in envelopes that actually use AES-GCM.
export function createCrypto() {
  const encoder = new TextEncoder();
const AUTHENTICATED_METADATA = [
  'v',
  'alg',
  'kdf',
  'iterations',
  'encoding',
  'filename',
  'contentType',
  'access',
  'unlockKey',
  'salt',
  'iv'
];
  const authenticatedDataFor = (payload) => encoder.encode(JSON.stringify(
    Object.fromEntries(AUTHENTICATED_METADATA.map((key) => [key, payload[key]]))
  ));
  async function deriveKey(passphrase, salt, iterationCount, usages) {
    const baseKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: iterationCount,
        hash: 'SHA-256'
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      usages
    );
  }

  async function decryptPayload(payload, passphrase, fromBase64, fromBase64Chunks, existingKey) {
    const key = existingKey || await deriveKey(passphrase, fromBase64(payload.salt), payload.iterations, ['decrypt']);
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(payload.iv), additionalData: authenticatedDataFor(payload) },
      key,
      fromBase64Chunks(payload.ciphertext, fromBase64(payload.tag))
    ));
  }
  return { authenticatedDataFor, deriveKey, decryptPayload };
}
