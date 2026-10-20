#!/usr/bin/env node
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { createPreview } from '../src/preview.mjs';
import { createFormat } from '../src/format.mjs';
import { renderWrapper } from '../src/wrapper.mjs';

const { fromBase64Chunks, unpackContent, authenticatedDataFor } = createFormat(value => Buffer.from(value, 'base64'));

const VERSION = '1.0.2';
const DEFAULT_ITERATIONS = 210_000;
const DEFAULT_CHUNK_SIZE = 64 * 1024;
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
      case '--private-filename':
        args.privateFilename = true;
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
  --private-filename       Encrypt original name/type; use a neutral --out path
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

function encryptBytes(bytes, password, { iterations, chunkSize, sourceName, contentType, access, privateFilename = false }) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const unlockKey = access === 'sealed' ? password : undefined;
  const metadata = {
    v: 2,
    alg: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations,
    encoding: 'metadata',
    ...(!privateFilename ? { filename: sourceName, contentType } : {}),
    access,
    ...(unlockKey ? { unlockKey } : {}),
    salt: salt.toString('base64'),
    iv: iv.toString('base64')
  };
  const key = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(authenticatedDataFor(metadata));
  const header = Buffer.from(JSON.stringify({ filename: sourceName, contentType }));
  if (header.length > 65536) throw new Error('Filename metadata is too large.');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  // Feed the header separately rather than allocating a second full plaintext buffer.
  const ciphertext = Buffer.concat([cipher.update(length), cipher.update(header), cipher.update(bytes), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload = {
    ...metadata,
    tag: tag.toString('base64'),
    ciphertext: toBase64Chunks(ciphertext, chunkSize)
  };
  verifyPayload(payload, password, bytes, key, { name: sourceName, type: contentType });
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

function verifyPayload(payload, password, expectedBytes, existingKey, expectedFile) {
  const content = unpackContent(decryptPayload(payload, password, existingKey), payload);
  if (expectedFile && (content.filename !== expectedFile.name || content.contentType !== expectedFile.type)) {
    throw new Error('Metadata roundtrip failed.');
  }
  if (!content.bytes.equals(expectedBytes)) {
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
    contentType: inferContentType(basename(inputPath)),
    access,
    privateFilename: args.privateFilename
  });

  const wrapper = renderWrapper({
    title,
    payload
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, wrapper, 'utf8');

  output.write(`${access === 'sealed' ? 'Sealed' : 'Encrypted'} ${inputPath} -> ${outputPath}\n`);
  output.write(`Access: ${access === 'sealed' ? 'no passphrase, crawler barrier only' : 'passphrase'}\n`);
  output.write(`Content type: ${args.privateFilename ? 'private' : payload.contentType}\n`);
  output.write(`Payload chunks: ${payload.ciphertext.length}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
