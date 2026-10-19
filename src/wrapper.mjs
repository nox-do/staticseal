import { createFormat } from './format.mjs';
import { sealLogo } from './logo.mjs';

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
  color-scheme: light;
  --bg: #f5f7f5;
  --panel: #fff;
  --ink: #233d46;
  --muted: #5c7077;
  --line: #dce5e3;
  --accent: #27665d;
  --accent-strong: #1c5049;
  --error: #a13c2e;
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--bg);
  color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.5;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 22px;
  font-weight: 750;
  letter-spacing: -.8px;
}
.brand svg {
  width: 48px;
  height: 48px;
  flex: none;
}
.lock-shell, .download-only {
  width: min(100%, 520px);
  padding: clamp(24px, 5vw, 40px);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 20px;
  box-shadow: 0 8px 32px #233d4606, 0 1px 3px #233d4604;
}
.lock-shell > .brand {
  margin-bottom: 32px;
}
.kicker {
  margin: 0 0 12px;
  color: var(--accent);
  font-size: 11px;
  font-weight: 750;
  letter-spacing: .14em;
  text-transform: uppercase;
}
h1 {
  margin: 0 0 16px;
  font-size: clamp(26px, 5vw, 36px);
  line-height: 1.2;
  font-weight: 650;
  letter-spacing: -.8px;
  overflow-wrap: anywhere;
}
p {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.7;
}
form {
  display: grid;
  gap: 10px;
  margin-top: 28px;
}
label {
  font-size: 13px;
  font-weight: 650;
}
input, button {
  font: inherit;
}
input {
  width: 100%;
  min-width: 0;
  min-height: 46px;
  padding: 10px 12px;
  border: 1px solid #ccd9d5;
  border-radius: 8px;
  background: var(--panel);
  color: var(--ink);
}
button, .viewer-actions a {
  display: inline-grid;
  place-items: center;
  min-height: 46px;
  padding: 11px 18px;
  border: 0;
  border-radius: 9px;
  background: var(--accent);
  color: #fff;
  font-size: 14px;
  font-weight: 650;
  text-decoration: none;
  cursor: pointer;
}
button:hover, .viewer-actions a:hover {
  background: var(--accent-strong);
}
button:disabled {
  cursor: wait;
  opacity: .55;
}
input:focus-visible, button:focus-visible, a:focus-visible {
  outline: 3px solid #27665d40;
  outline-offset: 3px;
}
.status {
  margin-top: 12px;
  color: var(--muted);
  font-size: 13px;
  overflow-wrap: anywhere;
}
.status[data-kind="error"] {
  color: var(--error);
}
.status:empty {
  display: none;
}
.hint {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
  font-size: 12px;
}
.viewer-page {
  display: block;
  place-items: normal;
  padding: 0;
}
.viewer-shell {
  width: 100%;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.viewer-bar {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 16px 24px;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
}
.viewer-title {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 14px;
  font-weight: 650;
}
.viewer-title small {
  display: block;
  color: var(--muted);
  font-size: 12px;
  font-weight: 400;
}
.viewer-actions {
  flex: none;
}
#viewer-content {
  flex: 1;
  min-width: 0;
  display: grid;
  place-items: center;
  padding: 32px 24px;
}
.download-only p + p {
  margin-top: 16px;
}
#preview-pdf {
  margin-top: 24px;
}
.image-frame {
  display: block;
  max-width: 100%;
  max-height: calc(100vh - 150px);
  object-fit: contain;
  border-radius: 8px;
}
.viewer-frame {
  width: 100%;
  height: calc(100vh - 150px);
  min-height: 420px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
}
@media (max-width: 560px) {
  body {
    padding: 16px;
  }
  .viewer-bar {
    flex-wrap: wrap;
    gap: 12px;
    padding: 16px;
  }
  .viewer-bar .brand {
    width: 100%;
    font-size: 19px;
  }
  .viewer-bar .brand svg {
    width: 36px;
    height: 36px;
  }
  #viewer-content {
    padding: 24px 16px;
  }
  .image-frame {
    max-height: calc(100vh - 200px);
  }
  .viewer-frame {
    height: calc(100vh - 200px);
  }
}
</style>
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
    const contentType = unlockedContent.contentType || 'application/octet-stream';
    const filename = unlockedContent.filename || 'sealed-file';
    const isImage = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(contentType);
    const isPdf = contentType === 'application/pdf';
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
    if (isImage) {
      viewer.innerHTML = '<img class="image-frame" alt="' + safeName + '" src="' + url + '">';
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
