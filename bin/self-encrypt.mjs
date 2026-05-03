#!/usr/bin/env node
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const DEFAULT_ITERATIONS = 210_000;
const DEFAULT_CHUNK_SIZE = 92;

function parseArgs(argv) {
  const args = {
    iterations: DEFAULT_ITERATIONS,
    chunkSize: DEFAULT_CHUNK_SIZE,
    stdinPassword: false
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
  output.write(`self-encrypt

Usage:
  node ./bin/self-encrypt.mjs --in input.html --out locked.html [--title "Protected page"]

Options:
  --in <file>              Plain HTML source
  --out <file>             Encrypted self-contained HTML output
  --title <text>           Browser title and lock-screen context
  --iterations <number>    PBKDF2 iterations, default ${DEFAULT_ITERATIONS}
  --chunk-size <number>    Base64 payload chunk size, default ${DEFAULT_CHUNK_SIZE}
  --stdin-password         Read password from stdin instead of prompting
  --help                   Show this help
`);
}

function requiredString(value, name) {
  if (!value || typeof value !== 'string') {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
}

function chunkString(value, size) {
  const chunks = [];
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }
  return chunks;
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function readPassword({ stdinPassword }) {
  if (stdinPassword) {
    const chunks = [];
    for await (const chunk of input) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8').trimEnd();
  }

  const rl = createInterface({ input, output });
  try {
    return await rl.question('Password: ');
  } finally {
    rl.close();
  }
}

function encryptHtml(html, password, { iterations, chunkSize }) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(html, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload = {
    v: 1,
    alg: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: chunkString(ciphertext.toString('base64'), chunkSize)
  };

  return payload;
}

function verifyPayload(payload, password, expectedHtml) {
  const salt = Buffer.from(payload.salt, 'base64');
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext.join(''), 'base64');
  const key = pbkdf2Sync(password, salt, payload.iterations, 32, 'sha256');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decoded = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');

  if (decoded !== expectedHtml) {
    throw new Error('Decrypt roundtrip failed.');
  }
}

function renderWrapper({ title, payload, sourceName }) {
  const safeTitle = escapeHtml(title);
  const safeSource = escapeHtml(sourceName);
  const generatedAt = new Date().toISOString();

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>${safeTitle}</title>
<style>
:root {
  --bg: #faf7f0;
  --paper: #fffdf8;
  --ink: #211c17;
  --muted: #686057;
  --line: #c7332b;
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
  background:
    radial-gradient(circle at 16% 8%, rgba(199, 51, 43, 0.13), transparent 28rem),
    linear-gradient(180deg, #fbf4e9 0%, var(--bg) 56%, #f3eadf 100%);
  color: var(--ink);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.lock-shell {
  width: min(100%, 34rem);
  position: relative;
  padding: clamp(1.4rem, 5vw, 2.4rem);
  border: 1px solid var(--border);
  border-radius: 1.35rem;
  background: rgba(255, 253, 248, 0.88);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.lock-thread {
  position: absolute;
  top: -1.5rem;
  left: 0;
  width: 8rem;
  height: calc(100% + 3rem);
  pointer-events: none;
  z-index: 0;
}
.lock-thread path {
  fill: none;
  stroke: var(--line);
  stroke-width: 2;
  stroke-linecap: round;
  filter: drop-shadow(0 12px 22px rgba(199, 51, 43, 0.2));
}
.lock-content { position: relative; z-index: 1; }
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
  font-size: clamp(2rem, 8vw, 4rem);
  line-height: 1;
  letter-spacing: -0.04em;
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
  border-radius: 999px;
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
@media (max-width: 520px) {
  form { grid-template-columns: 1fr; }
  button { width: 100%; }
}
</style>
</head>
<body>
  <main class="lock-shell">
    <svg class="lock-thread" aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 100 100">
      <path d="M24 -4 C7 18 34 31 20 52 C9 70 22 83 16 104" />
    </svg>
    <div class="lock-content">
      <p class="kicker">Geschützter Pitch</p>
      <h1>Ein roter Faden, aber nicht für Suchmaschinen.</h1>
      <p>Diese Datei enthält einen verschlüsselten Onepager. Das Passwort öffnet den Inhalt lokal im Browser.</p>
      <form id="unlock-form" autocomplete="off">
        <label for="password">Passwort</label>
        <input id="password" name="password" type="password" placeholder="Passwort" autofocus>
        <button id="unlock-button" type="submit">Öffnen</button>
      </form>
      <div class="status" id="status" role="status" aria-live="polite"></div>
      <p class="hint">Hinweis: Das ist ein statischer Schutz für Verteilung und Neugier-Barriere, kein Ersatz für echtes Access-Control.</p>
    </div>
  </main>

<!--
  Security note:
  This static wrapper intentionally exposes salt, IV, KDF parameters, and ciphertext.
  Salt and IV are not secrets; browser-side decryption needs them.
  This protects against casual browsing, indexing, and accidental exposure,
  but it is not server-side access control and cannot prevent offline brute force
  if the HTML file is downloaded.

  Generated from: ${safeSource}
  Generated at: ${generatedAt}
-->
<script id="encrypted-payload" type="application/json">
${JSON.stringify(payload, null, 2)}
</script>
<script>
(() => {
  const form = document.getElementById('unlock-form');
  const input = document.getElementById('password');
  const button = document.getElementById('unlock-button');
  const status = document.getElementById('status');
  const payload = JSON.parse(document.getElementById('encrypted-payload').textContent);

  const fromBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
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
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(payload.iv) },
      key,
      joinBytes(fromBase64(payload.ciphertext.join('')), fromBase64(payload.tag))
    );
    return new TextDecoder().decode(plaintext);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = input.value;
    if (!password) {
      status.textContent = 'Bitte Passwort eingeben.';
      input.focus();
      return;
    }

    button.disabled = true;
    status.textContent = 'Entschlüssle lokal im Browser ...';
    try {
      const decryptedHtml = await unlock(password);
      document.open();
      document.write(decryptedHtml);
      document.close();
    } catch (error) {
      console.warn('Unlock failed', error);
      status.textContent = 'Passwort passt nicht oder Datei ist beschädigt.';
      button.disabled = false;
      input.select();
      input.focus();
    }
  });
})();
</script>
</body>
</html>
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const inputPath = resolve(requiredString(args.in, '--in'));
  const outputPath = resolve(requiredString(args.out, '--out'));
  const title = args.title || `${basename(outputPath)} - geschützte Datei`;

  if (!Number.isInteger(args.iterations) || args.iterations < 100_000) {
    throw new Error('--iterations must be an integer >= 100000.');
  }
  if (!Number.isInteger(args.chunkSize) || args.chunkSize < 40) {
    throw new Error('--chunk-size must be an integer >= 40.');
  }

  const password = await readPassword(args);
  if (!password) {
    throw new Error('Password must not be empty.');
  }

  const html = await readFile(inputPath, 'utf8');
  const payload = encryptHtml(html, password, args);
  verifyPayload(payload, password, html);

  const wrapper = renderWrapper({
    title,
    payload,
    sourceName: basename(inputPath)
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, wrapper, 'utf8');

  output.write(`Encrypted ${inputPath} -> ${outputPath}\n`);
  output.write(`Payload chunks: ${payload.ciphertext.length}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
