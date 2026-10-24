import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomFillSync } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { themeStyle } from '../src/cli-theme.mjs';
import { wrapper } from './helpers/html-harness.mjs';
import { makePayload } from './helpers/payload.mjs';

test('Node encryption consumes original input views without a plaintext concat', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'staticseal-parts-'));
  try {
    const inputPath = join(dir, 'raw.bin');
    await writeFile(inputPath, randomFillSync(Buffer.alloc(8192)));
    await writeFile(
      join(dir, 'parts.cjs'),
      `const assert = require('node:assert/strict');
      const fs = require('node:fs/promises');
      const crypto = require('node:crypto');
      let inputBytes;
      const readFile = fs.readFile;
      fs.readFile = async (...args) => {
        const bytes = await readFile(...args);
        if (args[0] === ${JSON.stringify(inputPath)}) inputBytes = bytes;
        return bytes;
      };
      const overlapsInput = bytes => inputBytes && bytes.buffer === inputBytes.buffer
        && bytes.byteOffset < inputBytes.byteOffset + inputBytes.byteLength
        && bytes.byteOffset + bytes.byteLength > inputBytes.byteOffset;
      const concat = Buffer.concat;
      Buffer.concat = (parts, ...args) => {
        assert.ok(!parts.some(overlapsInput), 'must not concatenate the original plaintext');
        return concat(parts, ...args);
      };
      const createCipheriv = crypto.createCipheriv;
      crypto.createCipheriv = (...args) => {
        const cipher = createCipheriv(...args);
        const update = cipher.update.bind(cipher);
        let consumed = 0;
        cipher.update = bytes => {
          if (overlapsInput(bytes)) {
            assert.equal(bytes.byteOffset, inputBytes.byteOffset + consumed, 'consume original views in order');
            consumed += bytes.byteLength;
            assert.ok(consumed <= inputBytes.byteLength);
          }
          return update(bytes);
        };
        process.on('exit', () => assert.equal(consumed, inputBytes.byteLength,
          'cipher must consume the whole original buffer without a copied plaintext package'));
        return cipher;
      };
      require('node:module').syncBuiltinESMExports();`
    );
    const result = spawnSync(
      process.execPath,
      [
        '--require',
        join(dir, 'parts.cjs'),
        'bin/self-encrypt.mjs',
        '--in',
        inputPath,
        '--out',
        join(dir, 'reader.html'),
        '--iterations',
        '100000',
        '--stdin-password'
      ],
      { cwd: new URL('..', import.meta.url), input: 'test\n', encoding: 'utf8' }
    );
    assert.equal(result.status, 0, result.stderr);
    const reader = wrapper(await readFile(join(dir, 'reader.html'), 'utf8'));
    assert.equal(reader.payload.v, 2);
    assert.deepEqual(Buffer.from(await reader.open('test')), await readFile(inputPath));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('minimal opening screens and custom button labels preserve access modes and errors', async () => {
  const { renderWrapper } = await import('../src/wrapper.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'staticseal-minimal-'));
  const bytes = Buffer.from('<!doctype html><title>Impressum</title><h1>Impressum</h1>');
  const label = 'Impressum öffnen $& </button><script>bad()</script>';
  const safeLabel = label.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  try {
    await writeFile(join(dir, 'page.html'), bytes);
    for (const access of ['sealed', 'passphrase'])
      for (const minimal of [false, true]) {
        const payload = await makePayload(
          bytes,
          'minimal-test',
          100000,
          { name: 'page.html', type: 'text/html' },
          access,
          false,
          true
        );
        const result = spawnSync(
          process.execPath,
          [
            'bin/self-encrypt.mjs',
            '--in',
            join(dir, 'page.html'),
            '--out',
            join(dir, 'output.html'),
            '--html-page',
            '--title',
            'Impressum',
            '--button-label',
            label,
            '--iterations',
            '100000',
            access === 'sealed' ? '--no-password' : '--stdin-password',
            ...(minimal ? ['--minimal'] : [])
          ],
          { cwd: new URL('..', import.meta.url), input: 'minimal-test\n', encoding: 'utf8' }
        );
        assert.equal(result.status, 0, result.stderr);
        for (const html of [
          renderWrapper({ title: 'Impressum', payload, minimal, buttonLabel: label }),
          await readFile(join(dir, 'output.html'), 'utf8')
        ]) {
          assert.ok(html.includes('<h1>Impressum</h1>'));
          assert.ok(html.includes('id="wrapper-brand"'));
          assert.equal(html.includes('id="password"'), access === 'passphrase');
          assert.equal(html.includes('<label for="password">'), access === 'passphrase');
          assert.ok(html.includes('type="submit">' + safeLabel + '</button>'));
          assert.ok(!html.includes('<script>bad()'));
          assert.ok(!html.includes('Anyone with this file can open it.'));
          assert.ok(!html.includes('Passphrase protection depends on'));
          assert.ok(!html.includes('in your browser.'));
          const reader = wrapper(html);
          assert.equal(reader.nodes.get('status').textContent, '');
          if (access === 'passphrase') {
            reader.nodes.get('password').value = '';
            await reader.nodes.get('unlock-form').handlers.submit({ preventDefault() {} });
            assert.equal(reader.nodes.get('status').textContent, 'Enter the passphrase.');
          }
          assert.deepEqual(Buffer.from(await reader.open('minimal-test')), bytes);
        }
      }
    const defaults = renderWrapper({ title: 'Default', payload: { access: 'sealed', v: 4, content: [] } });
    assert.ok(defaults.includes('type="submit">Open sealed file</button>'));
    const invalid = spawnSync(process.execPath, ['bin/self-encrypt.mjs', '--button-label'], { encoding: 'utf8' });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /Missing value for --button-label/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('optional CLI themes affect only opening-screen CSS and preserve payload roundtrips', async () => {
  const { renderWrapper } = await import('../src/wrapper.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'staticseal-theme-'));
  const bytes = Buffer.from('<!doctype html><title>Theme</title><p>Original page</p>');
  const themedArgs = [
    '--theme-bg',
    '#181818',
    '--theme-text',
    '#eee',
    '--theme-accent',
    '#e98663',
    '--theme-panel',
    '#252525',
    '--theme-font',
    '"Georgia", serif',
    '--theme-radius',
    '0'
  ];
  try {
    await writeFile(join(dir, 'page.html'), bytes);
    const run = args =>
      spawnSync(
        process.execPath,
        [
          'bin/self-encrypt.mjs',
          '--in',
          join(dir, 'page.html'),
          '--out',
          join(dir, 'output.html'),
          '--iterations',
          '100000',
          ...args
        ],
        { cwd: new URL('..', import.meta.url), input: 'theme-test\n', encoding: 'utf8' }
      );
    for (const page of [false, true])
      for (const encrypted of [false, true]) {
        const mode = [...(page ? ['--html-page'] : []), encrypted ? '--stdin-password' : '--no-password'];
        for (const themed of [false, true]) {
          const result = run([...mode, ...(themed ? themedArgs : [])]);
          assert.equal(result.status, 0, result.stderr);
          const html = await readFile(join(dir, 'output.html'), 'utf8');
          const reader = wrapper(html);
          assert.deepEqual(Buffer.from(await reader.open('theme-test')), bytes);
          const plain = renderWrapper({
            payload: reader.payload,
            files: [{ filename: 'page.html', contentType: 'text/html' }]
          });
          if (!themed) assert.equal(html, plain);
          else {
            const css = themeStyle({
              bg: '#181818',
              text: '#eee',
              accent: '#e98663',
              panel: '#252525',
              font: '"Georgia", serif',
              radius: '0'
            });
            assert.equal(html, plain.replace('</head>', `<style>${css}</style></head>`));
            assert.match(css, /body:not\(\.vp\)/);
            assert.match(css, /--muted:#eee/);
            assert.match(css, /outline-color:var\(--accent\)/);
          }
        }
      }
    for (const args of [
      ['--theme-bg'],
      ['--theme-bg', '--html-page'],
      ['--theme-bg', 'red'],
      ['--theme-accent', '#fff;display:none'],
      ['--theme-font', '</style><script>alert(1)</script>'],
      ['--theme-font', 'serif; color:red'],
      ['--theme-radius', '-1px'],
      ['--theme-radius', 'url(x)']
    ]) {
      const result = run(['--no-password', ...args]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /theme-/);
    }
    assert.equal(themeStyle(), '');
    for (const radius of ['0', '4px', '.5rem', '1.2em']) assert.match(themeStyle({ radius }), /border-radius:/);
    for (const bg of ['#abc', '#abcd', '#aabbcc', '#aabbccdd']) assert.match(themeStyle({ bg }), /--bg:/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('CLI hides original metadata by default and keeps explicit opening titles independent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'staticseal-default-private-'));
  const name = 'secret-original.pdf';
  const bytes = Buffer.from('%PDF-test original bytes');
  try {
    await writeFile(join(dir, name), bytes);
    await writeFile(
      join(dir, 'count.cjs'),
      `const crypto = require('node:crypto');
      const original = crypto.pbkdf2Sync;
      let calls = 0;
      crypto.pbkdf2Sync = (...args) => { calls++; return original(...args); };
      require('node:module').syncBuiltinESMExports();
      process.on('exit', () => { if (calls !== 1) process.exitCode = 99; });`
    );
    for (const [encrypted, customTitle, legacyAlias, iterations] of [
      [false, false, false],
      [true, false, false],
      [true, true, true, 100000],
      [false, true, true]
    ]) {
      const result = spawnSync(
        process.execPath,
        [
          ...(encrypted ? ['--require', join(dir, 'count.cjs')] : []),
          'bin/self-encrypt.mjs',
          '--in',
          join(dir, name),
          '--out',
          join(dir, 'sealed.html'),
          ...(iterations ? ['--iterations', String(iterations)] : []),
          encrypted ? '--stdin-password' : '--no-password',
          ...(customTitle ? ['--title', 'Impressum'] : []),
          ...(legacyAlias ? ['--private-filename'] : [])
        ],
        { cwd: new URL('..', import.meta.url), input: 'private-test\n', encoding: 'utf8' }
      );
      assert.equal(result.status, 0, result.stderr);
      const html = await readFile(join(dir, 'sealed.html'), 'utf8');
      const reader = wrapper(html);
      if (encrypted) assert.equal(reader.payload.iterations, iterations || 210000);
      assert.equal(reader.payload.filename, undefined);
      assert.equal(reader.payload.contentType, undefined);
      assert.ok(!html.includes(name));
      assert.ok(html.includes('<title>' + (customTitle ? 'Impressum' : 'Staticseal') + '</title>'));
      assert.deepEqual(Buffer.from(await reader.open('private-test')), bytes);
      assert.equal(reader.document.title, name);
      assert.ok(reader.document.body.innerHTML.includes('download="' + name + '"'));
    }
    for (const iterations of ['99999', '1.5', 'invalid']) {
      const invalid = spawnSync(
        process.execPath,
        [
          'bin/self-encrypt.mjs',
          '--in',
          join(dir, name),
          '--out',
          join(dir, 'sealed.html'),
          '--no-password',
          '--iterations',
          iterations
        ],
        { encoding: 'utf8' }
      );
      assert.equal(invalid.status, 1);
      assert.match(invalid.stderr, /iterations must be an integer >= 100000/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('CLI accepts 128 MiB HTML and rejects source and final HTML budget overflow without overwriting output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'staticseal-cli-limits-'));
  const inputPath = join(dir, 'page.html');
  const outputPath = join(dir, 'sealed.html');
  const run = (...args) =>
    spawnSync(process.execPath, ['bin/self-encrypt.mjs', '--in', inputPath, '--out', outputPath, ...args], {
      cwd: new URL('..', import.meta.url),
      input: 'test\n',
      encoding: 'utf8'
    });
  try {
    const bytes = Buffer.alloc(128 * 1024 * 1024, 32);
    bytes.write('<!doctype html><title>Large page</title><script>globalThis.ready=true</script>');
    await writeFile(inputPath, bytes);
    for (const access of ['--no-password', '--stdin-password']) {
      const result = run(access, '--html-page', '--private-filename');
      assert.equal(result.status, 0, result.stderr);
      const reader = wrapper(await readFile(outputPath, 'utf8'));
      assert.equal(reader.payload.display, 'page');
      assert.equal(reader.payload.v, access === '--no-password' ? 5 : 3);
      assert.deepEqual(Buffer.from(await reader.open('test')), bytes);
    }
    // Bundling has its own prepared-content budget, independent of transport.
    await truncate(inputPath, 30 * 1024 * 1024);
    for (const access of ['--no-password', '--stdin-password']) {
      const result = run(access, '--bundle');
      assert.equal(result.status, 0, result.stderr);
      const html = await readFile(outputPath, 'utf8');
      assert.ok(Buffer.byteLength(html) < 128 * 1024);
      assert.ok((await wrapper(html).open('test')).length > 25 * 1024 * 1024);
    }
    await writeFile(outputPath, 'keep existing output');
    await truncate(inputPath, 128 * 1024 * 1024 + 1);
    let result = run('--no-password');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /128 MiB CLI limit/);
    assert.equal(await readFile(outputPath, 'utf8'), 'keep existing output');
    // 20 MiB of raw input fits the working budget but exceeds transport after Base64.
    await writeFile(inputPath, randomFillSync(Buffer.alloc(20 * 1024 * 1024)));
    for (const access of ['--no-password', '--stdin-password']) {
      result = run(access);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /HTML package exceeds the 25 MiB/);
      assert.equal(await readFile(outputPath, 'utf8'), 'keep existing output');
    }
    // Small Base64 chunks increase JSON overhead beyond the transport budget.
    await truncate(inputPath, 18 * 1024 * 1024);
    result = run('--no-password', '--chunk-size', '40');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /HTML package exceeds the 25 MiB/);
    assert.equal(await readFile(outputPath, 'utf8'), 'keep existing output');
    // Count UTF-8 title bytes and the final theme, including the exact boundary.
    await truncate(inputPath, (25 * 1024 * 1024 * 3) / 4 - 64 * 1024);
    for (const access of ['--no-password', '--stdin-password']) {
      const options = [access, '--theme-bg', '#abcdef'];
      result = run(...options, '--title', 'x', '--button-label', 'x');
      assert.equal(result.status, 0, result.stderr);
      const remaining = 25 * 1024 * 1024 - (await readFile(outputPath)).length;
      assert.ok(remaining > 0);
      // The title occurs twice; the button label accounts for an odd byte.
      const titleBytes = Math.floor(remaining / 2) + 1;
      const title = 'ä'.repeat(Math.floor(titleBytes / 2)) + 'x'.repeat(titleBytes % 2);
      const label = 'x'.repeat(1 + (remaining % 2));
      result = run(...options, '--title', title, '--button-label', label);
      assert.equal(result.status, 0, result.stderr);
      assert.equal((await readFile(outputPath)).length, 25 * 1024 * 1024);
      await writeFile(outputPath, 'keep existing output');
      result = run(...options, '--title', title, '--button-label', label + 'x');
      assert.equal(result.status, 1);
      assert.match(result.stderr, /25 MiB transport limit/);
      assert.equal(await readFile(outputPath, 'utf8'), 'keep existing output');
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
