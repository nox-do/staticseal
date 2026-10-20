import { createFormat } from './format.mjs';
import { sealLogo } from './logo.mjs';
import { createPreview } from './preview.mjs';
import { wrapperStyles } from './wrapper-styles.mjs';

export function renderWrapper({ title, payload, sourceName }) {
  const { escapeHtml } = createFormat();
  const safeTitle = escapeHtml(payload.filename === undefined ? 'Protected file' : title);
  const safeSource = escapeHtml(payload.filename === undefined ? 'Private file' : sourceName);
  const generatedAt = new Date().toISOString();
  // Keep HTML script-parser control sequences out of the JSON data block.
  const payloadJson = JSON.stringify(payload, null, 2).replaceAll('<', '\\u003c');
  const scriptClose = '</' + 'script>';
  const hasPassphrase = payload.access !== 'sealed';
  const lockCopy = hasPassphrase
    ? 'Enter the passphrase to open this file in your browser.'
    : 'Open this file in your browser. No passphrase needed.';
  const hintCopy = hasPassphrase
    ? 'Passphrase protection depends on a strong passphrase. Anyone with the file can attempt offline password guesses.'
    : 'Anyone with this file can open it.';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>${safeTitle}</title>
<style>${wrapperStyles}</style>
</head>
<body>
  <main class="lock-shell">
    <div class="brand" id="wrapper-brand">${sealLogo}<span>staticseal</span></div>
    <p class="kicker">${hasPassphrase ? 'Protected file' : 'Sealed file'}</p>
    <h1>${safeTitle}</h1>
    <p>${lockCopy}</p>
    <form id="unlock-form" autocomplete="off">
      <label for="password">Passphrase</label>
      <input id="password" name="password" type="password" placeholder="Passphrase" autofocus>
      <button id="unlock-button" type="submit">Unlock file</button>
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
  const { escapeHtml, fromBase64, fromBase64Chunks, unpackContent, authenticatedDataFor } = (${createFormat.toString()})();
  const { inferContentType, previewKind, renderMarkdown, codeLanguage, highlightCode } = (${createPreview.toString()})();
  const brand = document.getElementById('wrapper-brand').outerHTML;

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

  let unlockedContent;

  async function unlock(password) {
    const key = await deriveKey(password);
    const decrypted = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(payload.iv), additionalData: authenticatedDataFor(payload) },
      key,
      fromBase64Chunks(payload.ciphertext, fromBase64(payload.tag))
    ));
    unlockedContent = unpackContent(decrypted, payload);
    return unlockedContent.bytes;
  }

  function renderBlobViewer(bytes) {
    const filename = unlockedContent.filename || 'sealed-file';
    const contentType = inferContentType(filename, unlockedContent.contentType);
    const kind = previewKind(filename, contentType);
    const isPdf = kind === 'pdf';
    const blob = new Blob([bytes], { type: contentType });
    const url = URL.createObjectURL(blob);
    const safeName = escapeHtml(filename);
    const safeType = escapeHtml(contentType);

    document.body.className = 'viewer-page';
    document.body.innerHTML = '<main class="viewer-shell">' +
      '<header class="viewer-bar">' +
      brand +
      '<div class="viewer-title">' + safeName + '<small>' + safeType + '</small></div>' +
      '<div class="viewer-actions">' +
      '<a href="' + url + '" download="' + safeName + '">Download</a>' +
      '</div></header><section id="viewer-content"></section></main>';

    const viewer = document.getElementById('viewer-content');
    if (kind === 'image') {
      viewer.innerHTML = '<img class="image-frame" alt="' + safeName + '" src="' + url + '">';
      return;
    }
    if (kind === 'text' || kind === 'markdown') {
      const limit = 128 * 1024;
      const truncated = bytes.length > limit;
      const encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le'
        : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
      let text;
      try {
        text = new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(0, limit), { stream: truncated });
      } catch {
        viewer.innerHTML = '<div class="download-only"><h1>Text preview unavailable</h1><p>Unsupported text encoding. Download the original file to open it.</p></div>';
        return;
      }
      viewer.innerHTML = '<section class="text-frame' + (kind === 'markdown' ? ' markdown-frame' : '') + '">' +
        (truncated ? '<p class="preview-note">Preview limited to the first 128 KiB. Download contains the complete file.</p>' : '') +
        (kind === 'markdown' ? '<article>' + renderMarkdown(text) + '</article>' : '<pre id="text-preview"></pre>') +
        (truncated ? '<aside class="preview-note preview-end" role="note"><strong>Preview ends here — the file continues.</strong><br>Only the first 128 KiB are shown. Use Download above to read the complete original file.</aside>' : '') + '</section>';
      if (kind === 'text') {
        const pre = document.getElementById('text-preview');
        const language = codeLanguage(filename, contentType);
        if (language) pre.innerHTML = highlightCode(text, language);
        else pre.textContent = text;
      }
      return;
    }
    viewer.innerHTML = '<div class="download-only">' +
      '<p class="kicker">Ready to download</p><h1>' + safeName + '</h1>' +
      '<p>Your file has been unlocked. Download the original and open it only if you trust its source.</p>' +
      (isPdf
        ? '<p>PDF preview uses your browser’s PDF viewer. PDFs may contain links or interactive content. Preview only files you trust.</p><button id="preview-pdf" type="button">Preview PDF…</button>'
        : '<p>This file type is not previewed automatically.</p>') +
      '</div>';
    if (isPdf) {
      document.getElementById('preview-pdf').addEventListener('click', () => {
        if (!window.confirm('Open this PDF in the browser viewer? PDFs may contain links or interactive content. Staticseal does not verify that this file is safe. Continue only if you trust its source.')) return;
        viewer.innerHTML = '<iframe class="viewer-frame" title="' + safeName + '" src="' + url + '"></iframe>';
      });
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const sealedMode = payload.access === 'sealed';
    const passphrase = sealedMode ? payload.unlockKey : input.value;
    if (!sealedMode && !passphrase) {
      status.dataset.kind = 'error';
      status.textContent = 'Enter the passphrase.';
      input.focus();
      return;
    }

    button.disabled = true;
    status.dataset.kind = '';
    status.textContent = 'Decrypting locally in this browser ...';
    try {
      renderBlobViewer(await unlock(passphrase));
    } catch (error) {
      console.warn('Unlock failed', error);
      status.dataset.kind = 'error';
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
