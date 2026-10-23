// Real-browser checks use forms, DOM and Blob URLs, never private function names.
(async () => {
  const results = document.getElementById('smoke-results');
  const log = text => results.textContent += text + '\n';
  const check = (ok, label) => { if (!ok) throw new Error(label); };
  const waitFor = async predicate => {
    const deadline = performance.now() + 30000;
    while (!predicate()) {
      if (performance.now() > deadline) throw new Error('Timed out waiting for browser UI');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const withFrame = async (location, fn) => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'width:900px;height:600px';
    if (location.html === undefined) frame.src = location.url;
    else frame.srcdoc = location.html;
    const loaded = new Promise(resolve => frame.onload = resolve);
    document.body.append(frame);
    try { await loaded; return await fn(frame); } finally { frame.remove(); }
  };
  const captureBlobs = frame => {
    const blobs = [], original = frame.contentWindow.URL.createObjectURL;
    frame.contentWindow.URL.createObjectURL = blob => {
      blobs.push(blob);
      return original.call(frame.contentWindow.URL, blob);
    };
    return blobs;
  };
  const selectFile = (frame, bytes, name, type) => {
    const transfer = new frame.contentWindow.DataTransfer();
    transfer.items.add(new frame.contentWindow.File([bytes], name, { type }));
    const input = frame.contentDocument.getElementById('source-file');
    input.files = transfer.files;
    input.dispatchEvent(new frame.contentWindow.Event('change', { bubbles: true }));
  };
  const create = (bytes, name, type, password = '', page = false) =>
    withFrame({ url: 'creator.html' }, async frame => {
      const doc = frame.contentDocument, node = id => doc.getElementById(id);
      const blobs = captureBlobs(frame);
      // Observe the download Blob without initiating test-file downloads.
      frame.contentWindow.HTMLAnchorElement.prototype.click = function () {};
      frame.contentWindow.confirm = () => true;
      selectFile(frame, bytes, name, type);
      node('password').value = node('password-repeat').value = password;
      node('html-page').checked = page;
      node('encrypt-form').requestSubmit();
      await waitFor(() => (!node('encrypt-button').disabled && blobs.length) || node('status').dataset.kind === 'error');
      check(node('status').dataset.kind !== 'error', node('status').textContent);
      check(blobs.length === 1, 'creator did not download exactly one file');
      return blobs[0].text();
    });
  const open = async (frame, password, page = false, expectError = false) => {
    const blobs = captureBlobs(frame), doc = frame.contentDocument;
    const input = doc.getElementById('password');
    if (input) input.value = password;
    doc.getElementById('unlock-form').requestSubmit();
    await waitFor(() => frame.contentDocument.getElementById('status')?.dataset.kind === 'error'
      || (page ? frame.contentDocument.getElementById('state')?.textContent === 'Script ready' : blobs.length));
    const failed = frame.contentDocument.getElementById('status')?.dataset.kind === 'error';
    check(Boolean(failed) === expectError, failed ? frame.contentDocument.getElementById('status').textContent : 'unexpected successful opening');
    if (expectError) check(blobs.length === 0, 'failed opening exposed a Blob');
    return blobs[0];
  };
  const equalBytes = async (blob, bytes) => {
    check(typeof blob?.arrayBuffer === 'function', 'reader did not expose the original file');
    const decoded = new Uint8Array(await blob.arrayBuffer());
    check(decoded.length === bytes.length && decoded.every((value, i) => value === bytes[i]), 'file bytes differ');
  };
  const wrongPassword = html => withFrame({ html }, frame => open(frame, 'wrong-password', false, true));
  try {
    log('Browser: ' + navigator.userAgent);
    const { embeddingName, previewCases, pageCases } = await (await fetch('fixtures.json')).json();
    const embeddingBytes = new Uint8Array([0, 1, 128, 255]);
    for (const [generator, html] of [
      ['app', await create(embeddingBytes, embeddingName, 'text/plain', 'browser-test-only')],
      ['CLI', await (await fetch('embedding-cli.html')).text()]
    ]) {
      await withFrame({ html }, async frame => {
        const parsed = JSON.parse(frame.contentDocument.getElementById('encrypted-payload').textContent);
        check(parsed.filename === undefined && parsed.contentType === undefined, 'original metadata exposed before opening');
        await equalBytes(await open(frame, 'browser-test-only'), embeddingBytes);
        check(frame.contentDocument.body.textContent.includes(embeddingName), 'filename not displayed');
      });
      log('PASS: ' + generator + ' / HTML script-parser control sequences / form + exact download Blob');
    }
    for (const [name, type, text, kind] of previewCases) {
      const bytes = new TextEncoder().encode(text);
      const html = await create(bytes, name, type, '');
      await withFrame({ html }, async frame => {
        await equalBytes(await open(frame, ''), bytes);
        const doc = frame.contentDocument, pre = doc.getElementById('tp');
        if (['html', 'json', 'dense'].includes(kind)) {
          check(pre.textContent === text && !pre.querySelector('script,img,div'), 'source preview changed or executed');
          check(kind === 'dense' ? !pre.querySelector('span') : !!pre.querySelector('.s-' + (kind === 'html' ? 'tag' : 'key')), 'highlighting/fallback');
        } else if (kind === 'markdown') {
          check(doc.querySelector('article h1').textContent === 'C#' && doc.querySelector('article strong').textContent === 'Bold', 'Markdown formatting');
          check(!!doc.querySelector('article code .s-keyword'), 'Markdown fenced code');
        } else if (kind === 'truncated') {
          check(pre.textContent === text.slice(0, 65536) && pre.nextElementSibling.classList.contains('pe'), 'preview truncation');
        } else {
          const image = doc.querySelector('.im');
          await image.decode();
          check(image.naturalWidth === 40, 'SVG did not render');
        }
      });
      log('PASS: preview / ' + kind + ' / real DOM + exact download Blob');
    }
    for (const size of [10, 25]) for (const access of ['passphrase', 'sealed']) {
      const bytes = new Uint8Array(size * 1024 * 1024);
      for (let i = 0; i < bytes.length; i++) bytes[i] = i & 255;
      const password = access === 'sealed' ? '' : 'browser-test-only';
      const html = await create(bytes, 'Private-test.bin', 'application/octet-stream', password, false);
      check(!html.includes('Private-test.bin'), 'private filename leaked');
      await withFrame({ html }, async frame => {
        await equalBytes(await open(frame, password), bytes);
        check(frame.contentDocument.body.textContent.includes('Private-test.bin'), 'private filename not restored');
      });
      if (password) await wrongPassword(html);
      else check(!html.includes('crypto.subtle') && !html.includes('PBKDF2'), 'sealed reader contains crypto');
      log('PASS: ' + size + ' MiB / ' + access + ' / creator and reader forms + exact download Blob');
    }
    await withFrame({ url: 'creator.html' }, async frame => {
      const doc = frame.contentDocument, choice = doc.getElementById('html-page'), row = doc.getElementById('html-page-option');
      check(frame.contentWindow.getComputedStyle(row).display === 'none', 'page choice initially visible');
      selectFile(frame, '<h1>Page</h1>', 'choice.html', 'text/html');
      check(!choice.disabled && !choice.checked && frame.contentWindow.getComputedStyle(row).display !== 'none', 'HTML choice unavailable');
      choice.checked = true;
      selectFile(frame, 'text', 'choice.txt', 'text/plain');
      check(choice.disabled && !choice.checked && frame.contentWindow.getComputedStyle(row).display === 'none', 'non-HTML choice not reset');
    });
    log('PASS: creator / HTML-only page choice / default off / reset');
    for (const row of pageCases) {
      const password = row.access === 'sealed' ? '' : 'page-test';
      const bytes = new TextEncoder().encode(row.text);
      const appHtml = await create(bytes, 'demo-page.html', 'text/html', password, true);
      for (const [generator, html] of [['app', appHtml], ['CLI', await (await fetch(row.cliName)).text()]]) {
        if (password) await wrongPassword(html);
        await withFrame(generator === 'CLI' ? { url: row.cliName } : { html }, async frame => {
          await open(frame, password, true);
          const doc = frame.contentDocument;
          check(doc.title === 'Self-contained page' && !doc.getElementById('unlock-form') && !doc.getElementById('tp'), 'page did not replace opening screen');
          check(frame.contentWindow.getComputedStyle(doc.body).backgroundColor === 'rgb(250, 247, 240)', 'page CSS lost');
          check(doc.getElementById('bottom').textContent === 'Full page end', 'page truncated');
          check(doc.querySelector('meta[name="robots"]').content === 'noindex,nofollow,noarchive', 'robots hint lost');
          doc.getElementById('interact').click();
          check(doc.getElementById('state').textContent === 'Clicked' && doc.body.classList.contains('clicked'), 'page interaction broken');
          if (generator === 'CLI') {
            doc.querySelector('a[href="#bottom"]').click();
            check(frame.contentWindow.location.hash === '#bottom' && doc.getElementById('state').textContent === 'Clicked', 'fragment link reloaded page');
          }
        });
        log('PASS: page / ' + generator + ' / ' + row.access + ' / ' + (row.large ? 'gzip' : 'raw') + ' / CSS + scripts + interaction');
      }
    }
    log('DONE');
  } catch (error) { log('FAIL: ' + error.stack); }
})();
