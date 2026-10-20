(() => {
  const $ = id => document.getElementById(id);
  const form = $('unlock-form');
  const input = $('password');
  const button = $('unlock-button');
  const status = $('status');
  const payload = JSON.parse($('encrypted-payload').textContent);
  const { escapeHtml, fromBase64, fromBase64Chunks, unpackContent, authenticatedDataFor } = (STATICSEAL_FORMAT)();
  const { inferContentType, previewKind, renderMarkdown, codeLanguage, highlightCode } = (STATICSEAL_PREVIEW)();
  const brand = $('wrapper-brand').outerHTML;

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

    document.body.className = 'vp';
    document.body.innerHTML = '<main class="vs">' +
      '<header class="vb">' +
      brand +
      '<div class="vt">' + safeName + '<small>' + safeType + '</small></div>' +
      '<div class="va">' +
      '<a href="' + url + '" download="' + safeName + '">Download</a>' +
      '</div></header><section id="vc"></section></main>';

    const viewer = $('vc');
    if (kind === 'image') {
      viewer.innerHTML = '<img class="im" alt="' + safeName + '" src="' + url + '">';
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
        viewer.innerHTML = '<div class="dl"><h1>Text preview unavailable</h1><p>Unsupported text encoding. Download the original file to open it.</p></div>';
        return;
      }
      viewer.innerHTML = '<section class="tf' + (kind === 'markdown' ? ' md' : '') + '">' +
        (truncated ? '<p class="pn">Preview limited to the first 128 KiB. Download contains the complete file.</p>' : '') +
        (kind === 'markdown' ? '<article>' + renderMarkdown(text) + '</article>' : '<pre id="tp"></pre>') +
        (truncated ? '<aside class="pn pe" role="note"><strong>Preview ends here — the file continues.</strong><br>Only the first 128 KiB are shown. Use Download above to read the complete original file.</aside>' : '') + '</section>';
      if (kind === 'text') {
        const pre = $('tp');
        const language = codeLanguage(filename, contentType);
        if (language) pre.innerHTML = highlightCode(text, language);
        else pre.textContent = text;
      }
      return;
    }
    viewer.innerHTML = '<div class="dl">' +
      '<p class="kicker">Ready to download</p><h1>' + safeName + '</h1>' +
      '<p>Your file has been unlocked. Download the original and open it only if you trust its source.</p>' +
      (isPdf
        ? '<p>PDF preview uses your browser’s PDF viewer. PDFs may contain links or interactive content. Preview only files you trust.</p><button id="pdf" type="button">Preview PDF…</button>'
        : '<p>This file type is not previewed automatically.</p>') +
      '</div>';
    if (isPdf) {
      $('pdf').addEventListener('click', () => {
        if (!window.confirm('Open this PDF in the browser viewer? PDFs may contain links or interactive content. Staticseal does not verify that this file is safe. Continue only if you trust its source.')) return;
        viewer.innerHTML = '<iframe class="vf" title="' + safeName + '" src="' + url + '"></iframe>';
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
