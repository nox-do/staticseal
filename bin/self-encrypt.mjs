#!/usr/bin/env node
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const VERSION = '0.9.0';
const DEFAULT_ITERATIONS = 210_000;
const DEFAULT_CHUNK_SIZE = 92;
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

function parseArgs(argv) {
  const args = {
    iterations: DEFAULT_ITERATIONS,
    chunkSize: DEFAULT_CHUNK_SIZE,
    stdinPassword: false,
    noPassword: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case '--in':
        args.in = next;
        index += 1;
        break;
      case '--out':
        args.out = next;
        index += 1;
        break;
      case '--title':
        args.title = next;
        index += 1;
        break;
      case '--iterations':
        args.iterations = Number(next);
        index += 1;
        break;
      case '--chunk-size':
        args.chunkSize = Number(next);
        index += 1;
        break;
      case '--stdin-password':
        args.stdinPassword = true;
        break;
      case '--no-password':
        args.noPassword = true;
        break;
      case '--version':
        args.version = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  output.write(`self-encrypt ${VERSION}

Usage:
  node ./bin/self-encrypt.mjs --in input.pdf --out input_encrypted.html [--title "Protected file"]

Options:
  --in <file>              Static source file
  --out <file>             Encrypted self-contained HTML wrapper
  --title <text>           Browser title and lock-screen context
  --iterations <number>    PBKDF2 iterations, default ${DEFAULT_ITERATIONS}
  --chunk-size <number>    Base64 payload chunk size, default ${DEFAULT_CHUNK_SIZE}
  --stdin-password         Read password from stdin instead of prompting
  --no-password            Seal for crawler resistance only; no confidentiality
  --version                Show version
  --help                   Show this help
`);
}

function requiredString(value, name) {
  if (!value || typeof value !== 'string') {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function rawChunkSizeFor(base64ChunkSize) {
  let rawSize = Math.floor((base64ChunkSize * 3) / 4);
  rawSize -= rawSize % 3;
  return Math.max(rawSize, 3);
}

function toBase64Chunks(bytes, size) {
  const chunks = [];
  const rawSize = rawChunkSizeFor(size);
  for (let index = 0; index < bytes.length; index += rawSize) {
    chunks.push(bytes.subarray(index, index + rawSize).toString('base64'));
  }
  return chunks;
}

function fromBase64Chunks(chunks) {
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk, 'base64')));
}

function inferContentType(filePath) {
  const types = {
    '.html': 'text/html',
    '.htm': 'text/html',
    '.xhtml': 'application/xhtml+xml',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain'
  };
  return types[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function authenticatedDataFor(payload) {
  return Buffer.from(JSON.stringify(
    Object.fromEntries(AUTHENTICATED_METADATA.map((key) => [key, payload[key]]))
  ), 'utf8');
}

function stripFinalLineEnding(value) {
  if (value.endsWith('\r\n')) {
    return value.slice(0, -2);
  }
  if (value.endsWith('\n') || value.endsWith('\r')) {
    return value.slice(0, -1);
  }
  return value;
}

function readHiddenLine(prompt) {
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    const rl = createInterface({ input, output });
    return rl.question(prompt).finally(() => rl.close());
  }

  return new Promise((resolve, reject) => {
    let value = '';
    const wasRaw = input.isRaw;
    const cleanup = () => {
      input.off('data', onData);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
      output.write('\n');
    };
    const onData = (chunk) => {
      const text = chunk.toString('utf8');
      for (const char of text) {
        if (char === '\u0003') {
          cleanup();
          reject(new Error('Interrupted.'));
          return;
        }
        if (char === '\r' || char === '\n' || char === '\u0004') {
          cleanup();
          resolve(value);
          return;
        }
        if (char === '\u007f') {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };

    output.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

async function readPassword({ stdinPassword }) {
  if (stdinPassword) {
    const chunks = [];
    for await (const chunk of input) {
      chunks.push(Buffer.from(chunk));
    }
    return stripFinalLineEnding(Buffer.concat(chunks).toString('utf8'));
  }

  const password = await readHiddenLine('Password: ');
  const repeat = await readHiddenLine('Repeat password: ');
  if (password !== repeat) {
    throw new Error('Passwords do not match.');
  }
  return password;
}

function encryptBytes(bytes, password, { iterations, chunkSize, sourceName, contentType, access }) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const unlockKey = access === 'sealed' ? password : undefined;
  const metadata = {
    v: 1,
    alg: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations,
    encoding: 'bytes',
    filename: sourceName,
    contentType,
    access,
    ...(unlockKey ? { unlockKey } : {}),
    salt: salt.toString('base64'),
    iv: iv.toString('base64')
  };
  const key = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(authenticatedDataFor(metadata));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ...metadata,
    tag: tag.toString('base64'),
    ciphertext: toBase64Chunks(ciphertext, chunkSize)
  };
}

function decryptPayload(payload, password) {
  const salt = Buffer.from(payload.salt, 'base64');
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const ciphertext = fromBase64Chunks(payload.ciphertext);
  const key = pbkdf2Sync(password, salt, payload.iterations, 32, 'sha256');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(authenticatedDataFor(payload));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function verifyPayload(payload, password, expectedBytes) {
  const decoded = decryptPayload(payload, password);
  if (!decoded.equals(expectedBytes)) {
    throw new Error('Decrypt roundtrip failed.');
  }
}

function renderWrapper({ title, payload, sourceName }) {
  const safeTitle = escapeHtml(title);
  const safeSource = escapeHtml(sourceName);
  const generatedAt = new Date().toISOString();
  const payloadJson = JSON.stringify(payload, null, 2).replaceAll('</', '<\\/');
  const scriptClose = '</' + 'script>';
  const hasPassphrase = payload.access !== 'sealed';
  const lockCopy = hasPassphrase
    ? 'This file contains encrypted content. The passphrase unlocks it locally in your browser.'
    : 'This file is sealed for static publishing. Open it locally in your browser.';
  const hintCopy = hasPassphrase
    ? 'Static encryption is not a replacement for server-side access control.'
    : 'No passphrase is required. This hides cleartext from crawlers, but it is not confidentiality or access control.';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>${safeTitle}</title>
<style>
:root {
  --bg: #faf7f0;
  --ink: #211c17;
  --muted: #686057;
  --line: #b82f26;
  --border: rgba(33, 28, 23, 0.14);
  --shadow: 0 22px 70px rgba(56, 42, 24, 0.14);
  --serif: Georgia, "Times New Roman", serif;
}
* { box-sizing: border-box; }
html, body { min-height: 100%; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: clamp(1.25rem, 5vw, 4rem);
  background: #faf7f0;
  color: var(--ink);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.lock-shell {
  width: min(100%, 34rem);
  padding: clamp(1.4rem, 5vw, 2.4rem);
  border: 1px solid var(--border);
  border-radius: 8px;
  background: rgba(255, 253, 248, 0.92);
  box-shadow: var(--shadow);
}
.kicker {
  margin: 0 0 0.85rem;
  color: var(--line);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
h1 {
  margin: 0 0 0.85rem;
  font-family: var(--serif);
  font-weight: 400;
  font-size: clamp(2rem, 8vw, 4.2rem);
  line-height: 1;
  overflow-wrap: anywhere;
  word-break: break-word;
  hyphens: auto;
}
p {
  margin: 0;
  color: var(--muted);
  font-size: 1rem;
  line-height: 1.55;
}
form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.7rem;
  margin-top: 1.6rem;
}
label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
input, button {
  min-height: 3rem;
  border-radius: 8px;
  font: inherit;
}
input {
  width: 100%;
  border: 1px solid var(--border);
  padding: 0 1rem;
  background: #fffdf8;
  color: var(--ink);
}
button {
  border: 0;
  padding: 0 1.15rem;
  background: var(--line);
  color: white;
  font-weight: 800;
  cursor: pointer;
}
button:disabled { cursor: wait; opacity: 0.72; }
.status {
  min-height: 1.4rem;
  margin-top: 0.9rem;
  color: #8f211b;
  font-size: 0.9rem;
  font-weight: 700;
}
.hint {
  margin-top: 1rem;
  font-size: 0.86rem;
}
.viewer-page {
  display: block;
  padding: 0;
  background: #1f1f1c;
}
.viewer-shell {
  min-height: 100vh;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}
.viewer-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem;
  background: #fffdf8;
  border-bottom: 1px solid var(--border);
}
.viewer-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink);
  font-weight: 800;
}
.viewer-title small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 700;
}
.viewer-actions {
  display: flex;
  gap: 0.5rem;
}
.viewer-actions a {
  min-height: 2.55rem;
  display: inline-grid;
  place-items: center;
  border-radius: 8px;
  padding: 0 0.85rem;
  background: var(--line);
  color: white;
  font-size: 0.92rem;
  font-weight: 800;
  text-decoration: none;
}
.viewer-frame,
.image-frame {
  width: 100%;
  min-height: calc(100vh - 4.1rem);
}
.viewer-frame {
  height: 100%;
  border: 0;
  background: white;
}
.image-frame {
  height: calc(100vh - 4.1rem);
  object-fit: contain;
  background: #1f1f1c;
}
.download-only {
  width: min(100%, 34rem);
  align-self: center;
  justify-self: center;
  margin: 2rem;
  padding: 1.25rem;
  border-radius: 8px;
  background: #fffdf8;
}
@media (max-width: 520px) {
  form { grid-template-columns: 1fr; }
  button { width: 100%; }
  .viewer-bar { align-items: stretch; flex-direction: column; }
  .viewer-actions a { width: 100%; }
}
</style>
</head>
<body>
  <main class="lock-shell">
    <p class="kicker">Protected file</p>
    <h1>${safeTitle}</h1>
    <p>${lockCopy}</p>
    <form id="unlock-form" autocomplete="off">
      <label for="password">Passphrase</label>
      <input id="password" name="password" type="password" placeholder="Passphrase" autofocus>
      <button id="unlock-button" type="submit">Open</button>
    </form>
    <div class="status" id="status" role="status" aria-live="polite"></div>
    <p class="hint">${hintCopy}</p>
  </main>

<!--
  Security note:
  This static wrapper intentionally exposes salt, IV, KDF parameters, and ciphertext.
  Salt and IV are not secrets; browser-side decryption needs them.
  Anyone who downloads this file can attempt offline password guesses.

  Generated from: ${safeSource}
  Generated at: ${generatedAt}
-->
<script id="encrypted-payload" type="application/json">
${payloadJson}
${scriptClose}
<script>
(() => {
  const form = document.getElementById('unlock-form');
  const input = document.getElementById('password');
  const button = document.getElementById('unlock-button');
  const status = document.getElementById('status');
  const payload = JSON.parse(document.getElementById('encrypted-payload').textContent);
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

  const fromBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  const escapeHtml = (value) => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
  const joinBytes = (...parts) => {
    const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.byteLength;
    }
    return out;
  };

  const fromBase64Chunks = (chunks) => joinBytes(...chunks.map(fromBase64));

  const authenticatedDataFor = (payload) => encoder.encode(JSON.stringify(
    Object.fromEntries(AUTHENTICATED_METADATA.map((key) => [key, payload[key]]))
  ));

  async function deriveKey(password) {
    const baseKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: fromBase64(payload.salt),
        iterations: payload.iterations,
        hash: 'SHA-256'
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
  }

  async function unlock(password) {
    const key = await deriveKey(password);
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(payload.iv), additionalData: authenticatedDataFor(payload) },
      key,
      joinBytes(fromBase64Chunks(payload.ciphertext), fromBase64(payload.tag))
    ));
  }

  function renderBlobViewer(bytes) {
    const contentType = payload.contentType || 'application/octet-stream';
    const filename = payload.filename || 'sealed-file';
    const isHtml = contentType === 'text/html' || contentType === 'application/xhtml+xml';
    const isSvg = contentType === 'image/svg+xml';
    const canOpen = !isHtml && !isSvg;
    const blob = new Blob([bytes], { type: contentType });
    const url = URL.createObjectURL(blob);
    const safeName = escapeHtml(filename);
    const safeType = escapeHtml(contentType);
    const previewLabel = isHtml ? 'Sandboxed preview' : isSvg ? 'Image preview' : safeType;
    const openAction = canOpen ? '<a href="' + url + '" target="_blank" rel="noopener">Open</a>' : '';

    document.body.className = 'viewer-page';
    document.body.innerHTML = '<main class="viewer-shell">' +
      '<header class="viewer-bar">' +
      '<div class="viewer-title">' + safeName + '<small>' + previewLabel + '</small></div>' +
      '<div class="viewer-actions">' +
      openAction +
      '<a href="' + url + '" download="' + safeName + '">Download</a>' +
      '</div>' +
      '</header>' +
      '<section id="viewer-content"></section>' +
      '</main>';

    const viewer = document.getElementById('viewer-content');
    if (isHtml) {
      viewer.innerHTML = '<iframe class="viewer-frame" sandbox="" title="' + safeName + '" src="' + url + '"></iframe>';
      return;
    }
    if (contentType === 'application/pdf') {
      viewer.innerHTML = '<iframe class="viewer-frame" title="' + safeName + '" src="' + url + '"></iframe>';
      return;
    }
    if (contentType.startsWith('image/')) {
      viewer.innerHTML = '<img class="image-frame" alt="' + safeName + '" src="' + url + '">';
      return;
    }
    viewer.innerHTML = '<div class="download-only">' +
      '<p class="kicker">Download</p>' +
      '<h1>' + safeName + '</h1>' +
      '<p>This browser may not preview ' + safeType + ' here. Use Open or Download.</p>' +
      '</div>';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const sealedMode = payload.access === 'sealed';
    const passphrase = sealedMode ? payload.unlockKey : input.value;
    if (!sealedMode && !passphrase) {
      status.textContent = 'Enter the passphrase.';
      input.focus();
      return;
    }

    button.disabled = true;
    status.textContent = 'Decrypting locally in this browser ...';
    try {
      renderBlobViewer(await unlock(passphrase));
    } catch (error) {
      console.warn('Unlock failed', error);
      status.textContent = 'Wrong passphrase or damaged file.';
      button.disabled = false;
      input.select();
      input.focus();
    }
  });

  if (payload.access === 'sealed') {
    input.remove();
    form.querySelector('label')?.remove();
    button.textContent = 'Open sealed file';
    status.textContent = 'No passphrase required.';
  }
})();
${scriptClose}
</body>
</html>
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.version) {
    output.write(`${VERSION}\n`);
    return;
  }
  if (args.help) {
    printHelp();
    return;
  }

  const inputPath = resolve(requiredString(args.in, '--in'));
  const outputPath = resolve(requiredString(args.out, '--out'));
  const sourceName = basename(inputPath);
  const title = args.title || `${sourceName} - protected file`;

  if (!Number.isInteger(args.iterations) || args.iterations < 100_000) {
    throw new Error('--iterations must be an integer >= 100000.');
  }
  if (!Number.isInteger(args.chunkSize) || args.chunkSize < 40) {
    throw new Error('--chunk-size must be an integer >= 40.');
  }
  if (args.noPassword && args.stdinPassword) {
    throw new Error('--no-password cannot be combined with --stdin-password.');
  }

  const access = args.noPassword ? 'sealed' : 'passphrase';
  const password = args.noPassword ? randomBytes(32).toString('base64') : await readPassword(args);
  if (!password && !args.noPassword) {
    throw new Error('Password must not be empty.');
  }

  const bytes = await readFile(inputPath);
  const payload = encryptBytes(bytes, password, {
    iterations: args.iterations,
    chunkSize: args.chunkSize,
    sourceName,
    contentType: inferContentType(inputPath),
    access
  });
  verifyPayload(payload, password, bytes);

  const wrapper = renderWrapper({
    title,
    payload,
    sourceName
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, wrapper, 'utf8');

  output.write(`${access === 'sealed' ? 'Sealed' : 'Encrypted'} ${inputPath} -> ${outputPath}\n`);
  output.write(`Access: ${access === 'sealed' ? 'no passphrase, crawler barrier only' : 'passphrase'}\n`);
  output.write(`Content type: ${payload.contentType}\n`);
  output.write(`Payload chunks: ${payload.ciphertext.length}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
