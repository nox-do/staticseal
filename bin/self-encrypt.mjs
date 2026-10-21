#!/usr/bin/env node
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { createPreview } from '../src/preview.mjs';
import { createFormat } from '../src/format.mjs';
import { createCrypto } from '../src/crypto.mjs';
import { renderWrapper } from '../src/wrapper.mjs';
import { preparePackage } from '../src/creation.mjs';
import { inflateContent } from '../src/gzip.mjs';
import { isHtmlFile, createPageViewer } from '../src/viewer.mjs';
import { themeStyle } from '../src/cli-theme.mjs';

const format = createFormat(value => Buffer.from(value, 'base64'));
const { fromBase64Chunks, unpackContent } = format;
const { authenticatedDataFor } = createCrypto();

const VERSION = '1.3.0';
const DEFAULT_ITERATIONS = 210_000;
const DEFAULT_CHUNK_SIZE = 64 * 1024;
// CLI product policy; independent of browser creation and technical format limits.
const CLI_ORIGINAL_MAX_BYTES = 128 * 1024 * 1024;
const CLI_PAYLOAD_MAX_BYTES = 25 * 1024 * 1024;
const CLI_HTML_MAX_BYTES = 35 * 1024 * 1024;
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

    if (['bg', 'text', 'accent', 'panel', 'font', 'radius'].some(name => arg === '--theme-' + name)) {
      if (!next || next.startsWith('--')) throw new Error(`Missing value for ${arg}.`);
      (args.theme ??= {})[arg.slice(8)] = next;
      index += 1;
      continue;
    }

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
      case '--private-filename':
        args.privateFilename = true;
        break;
      case '--html-page':
        args.htmlPage = true;
        break;
      case '--minimal':
        args.minimal = true;
        break;
      case '--button-label':
        if (!next || next.startsWith('--') || !next.trim()) throw new Error('Missing value for --button-label.');
        args.buttonLabel = next;
        index += 1;
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
  node ./bin/self-encrypt.mjs --in input.pdf --out input_sealed.html [--title "Protected file"]

Limits (experimental): 128 MiB original, 25 MiB binary package, 35 MiB final HTML.

Options:
  --in <file>              Static source file
  --out <file>             Encrypted self-contained HTML wrapper
  --title <text>           Browser title and lock-screen context
  --iterations <number>    PBKDF2 iterations, default ${DEFAULT_ITERATIONS}
  --chunk-size <number>    Base64 payload chunk size, default ${DEFAULT_CHUNK_SIZE}
  --private-filename       Hide original name/type; use a neutral --out path
  --stdin-password         Read password from stdin instead of prompting
  --no-password            Seal for crawler resistance only; no confidentiality
  --html-page              Display self-contained HTML as a webpage, including scripts
  --minimal                Opening screen with logo/title/form only; errors still shown
  --button-label <text>    Optional opening button text
  --theme-bg <hex>         Optional lock-screen background color
  --theme-text <hex>       Optional lock-screen text color
  --theme-accent <hex>     Optional lock-screen button/focus color
  --theme-panel <hex>      Optional lock-screen card color
  --theme-font <stack>     Optional font-family stack; no font files embedded
  --theme-radius <length>  Optional card rounding: px, rem, em, or 0
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

const { inferContentType } = createPreview();

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

async function encryptBytes(bytes, password, { iterations, chunkSize, sourceName, contentType, access, privateFilename = false, htmlPage = false }) {
  if (htmlPage) {
    if (!isHtmlFile(sourceName, contentType)) throw new Error('--html-page requires an HTML file.');
    createPageViewer().decodeHtml(bytes);
  }
  let salt, iv;
  if (access !== 'sealed') {
    salt = randomBytes(format.SALT_BYTES);
    iv = randomBytes(format.IV_BYTES);
  }
  const content = await preparePackage(bytes, { filename: sourceName, contentType }, {
    access, iterations, salt: salt?.toString('base64'), iv: iv?.toString('base64'),
    privateFilename, htmlPage, chunkSize, maxOriginalSize: CLI_ORIGINAL_MAX_BYTES
  });
  if (content.binarySize > CLI_PAYLOAD_MAX_BYTES) throw new Error('Binary package exceeds the 25 MiB CLI limit after compression.');
  const { metadata, lengthPrefix, header } = content;
  if (access === 'sealed') {
    const packed = Buffer.concat([lengthPrefix, header, content.bytes]);
    const payload = { ...metadata, content: toBase64Chunks(packed, chunkSize) };
    await verifyPayload(payload, '', bytes, undefined, { name: sourceName, type: contentType });
    return payload;
  }
  const key = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(authenticatedDataFor(metadata));
  // Feed the header separately rather than allocating a second full plaintext buffer.
  const ciphertext = Buffer.concat([cipher.update(lengthPrefix), cipher.update(header), cipher.update(content.bytes), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload = {
    ...metadata,
    tag: tag.toString('base64'),
    ciphertext: toBase64Chunks(ciphertext, chunkSize)
  };
  await verifyPayload(payload, password, bytes, key, { name: sourceName, type: contentType });
  return payload;
}

function decryptPayload(payload, password, existingKey) {
  const salt = Buffer.from(payload.salt, 'base64');
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const ciphertext = fromBase64Chunks(payload.ciphertext);
  const key = existingKey || pbkdf2Sync(password, salt, payload.iterations, 32, 'sha256');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(authenticatedDataFor(payload));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

async function verifyPayload(payload, password, expectedBytes, existingKey, expectedFile) {
  const decoded = format.isUnencryptedVersion(payload.v) ? fromBase64Chunks(payload.content) : decryptPayload(payload, password, existingKey);
  let content = unpackContent(decoded, payload);
  if (format.isCompressedVersion(payload.v)) content = await inflateContent(content, format.MAX_EXPANDED_BYTES);
  if (expectedFile && (content.filename !== expectedFile.name || content.contentType !== expectedFile.type)) {
    throw new Error('Metadata roundtrip failed.');
  }
  if (!expectedBytes.equals(content.bytes)) {
    throw new Error('Decrypt roundtrip failed.');
  }
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

  const css = themeStyle(args.theme);

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

  if ((await stat(inputPath)).size > CLI_ORIGINAL_MAX_BYTES) {
    throw new Error('Original file exceeds the 128 MiB CLI limit.');
  }

  const access = args.noPassword ? 'sealed' : 'passphrase';
  const password = args.noPassword ? '' : await readPassword(args);
  if (!password && !args.noPassword) {
    throw new Error('Password must not be empty.');
  }

  const bytes = await readFile(inputPath);
  if (bytes.byteLength > CLI_ORIGINAL_MAX_BYTES) throw new Error('Original file exceeds the 128 MiB CLI limit.');
  const payload = await encryptBytes(bytes, password, {
    iterations: args.iterations,
    chunkSize: args.chunkSize,
    sourceName,
    contentType: inferContentType(basename(inputPath)),
    access,
    privateFilename: args.privateFilename,
    htmlPage: args.htmlPage
  });

  const plainWrapper = renderWrapper({
    title,
    payload,
    minimal: args.minimal,
    buttonLabel: args.buttonLabel
  });
  const wrapper = css ? plainWrapper.replace('</head>', () => `<style>${css}</style></head>`) : plainWrapper;

  if (Buffer.byteLength(wrapper, 'utf8') > CLI_HTML_MAX_BYTES) {
    throw new Error('HTML package exceeds the 35 MiB CLI limit.');
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, wrapper, 'utf8');

  output.write(`${access === 'sealed' ? 'Sealed' : 'Encrypted'} ${inputPath} -> ${outputPath}\n`);
  output.write(`Access: ${access === 'sealed' ? 'no passphrase, crawler barrier only' : 'passphrase'}\n`);
  output.write(`Content type: ${args.privateFilename ? 'private' : payload.contentType}\n`);
  output.write(`Payload chunks: ${(payload.content || payload.ciphertext).length}\n`);
  output.write(`Original: ${bytes.byteLength} bytes → HTML package: ${Buffer.byteLength(wrapper)} bytes\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
