(() => {
  const $ = id => document.getElementById(id);
  const form = $('unlock-form');
  const input = $('password');
  const button = $('unlock-button');
  const status = $('status');
  const payload = JSON.parse($('encrypted-payload').textContent);
  const { escapeHtml, fromBase64, fromBase64Chunks, unpackContent } = (STATICSEAL_FORMAT)();
  const renderContent = STATICSEAL_VIEWER(escapeHtml);
  const decodeContent = STATICSEAL_DECODER;

  let unlockedContent;

  async function unlock(password) {
    unlockedContent = unpackContent(await decodeContent(payload, password, fromBase64, fromBase64Chunks), payload);
    STATICSEAL_RESTORE(unlockedContent);
    return unlockedContent.bytes;
  }

  function renderBlobViewer(bytes) {
    renderContent(bytes, unlockedContent);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const sealedMode = payload.access === 'sealed';
    const passphrase = sealedMode ? '' : input.value;
    if (!sealedMode && !passphrase) {
      status.dataset.kind = 'error';
      status.textContent = 'Enter the passphrase.';
      input.focus();
      return;
    }

    button.disabled = true;
    status.dataset.kind = '';
    status.textContent = sealedMode ? 'Opening locally in this browser ...' : 'Decrypting locally in this browser ...';
    try {
      renderBlobViewer(await unlock(passphrase));
    } catch (error) {
      console.warn('Unlock failed', error);
      status.dataset.kind = 'error';
      status.textContent = error.name === 'NotSupportedError' ? error.message
        : sealedMode ? 'Damaged file or unsupported format.' : 'Wrong passphrase or damaged file.';
      button.disabled = false;
      if (input?.isConnected) {
        input.select();
        input.focus();
      } else if (button?.isConnected) {
        button.focus();
      }
    }
  });

})();
