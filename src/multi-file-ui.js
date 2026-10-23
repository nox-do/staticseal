// Injected only into the experimental FatSeal build, inside the creator scope.
const folderInput = $('source-folder');
const selectionList = $('selection-list');
const selectionReport = $('selection-report');
let selectedItems = [],
  preparedSelection,
  selectionRevision = 0,
  detectedEntry,
  selectionAbort,
  sealing = false;

async function selectFiles(files, append = true) {
  const items = files.map(file => (file.file ? file : { file, path: file.webkitRelativePath || file.name }));
  sourceFile.value = folderInput.value = '';
  selectedItems = append ? selectedItems.concat(items) : items;
  const { entry } = inspectHtmlSelection(selectedItems);
  htmlPageOption.hidden = !entry;
  htmlPage.disabled = !entry;
  htmlPage.checked = !!entry;
  return refreshSelection();
}
async function refreshSelection() {
  selectionAbort?.abort();
  selectionAbort = new AbortController();
  const { signal } = selectionAbort;
  const revision = ++selectionRevision;
  const snapshot = selectedItems.slice();
  const analysis = inspectHtmlSelection(snapshot);
  if (detectedEntry !== analysis.entry) htmlPage.checked = !!analysis.entry;
  detectedEntry = analysis.entry;
  htmlPageOption.hidden = !detectedEntry;
  htmlPage.disabled = !detectedEntry;
  const pageMode = htmlPage.checked && !!analysis.entry;
  const total = snapshot.reduce((sum, item) => sum + item.file.size, 0);
  preparedSelection = null;
  button.disabled = true;
  $('download-prepared').hidden = true;
  selectionList.replaceChildren();
  snapshot.forEach((item, index) => {
    const row = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = item.path + ' · ' + formatBytes(item.file.size) + ' ';
    row.append(name);
    for (const [label, delta] of [
      ['Move up', -1],
      ['Move down', 1],
      ['Remove', 0]
    ]) {
      if (pageMode && delta) continue;
      const control = document.createElement('button');
      control.type = 'button';
      control.textContent = delta < 0 ? '↑' : delta > 0 ? '↓' : '×';
      control.setAttribute('aria-label', label + ' ' + item.path);
      control.disabled = delta !== 0 && (index + delta < 0 || index + delta >= snapshot.length);
      control.onclick = () => {
        if (delta === 0) selectedItems.splice(index, 1);
        else
          [selectedItems[index], selectedItems[index + delta]] = [selectedItems[index + delta], selectedItems[index]];
        refreshSelection();
      };
      row.append(control);
    }
    selectionList.append(row);
  });
  fileMeta.textContent = snapshot.length
    ? snapshot.length + ' file(s) · ' + formatBytes(total) + ' total'
    : 'No files selected';
  if (!snapshot.length) {
    selectionReport.textContent = '';
    button.disabled = sealing;
    return;
  }
  if (snapshot.length > 1000 || total > SOURCE_MAX_BYTES) {
    selectionReport.textContent = 'Maximum 1,000 files and 128 MiB of source data. Remove files to continue.';
    return;
  }
  selectionReport.textContent = 'Checking selected files locally …';
  try {
    let confirmed = false;
    const confirmWork = size => {
      if (size <= BROWSER_FILE_CONFIRM_BYTES || confirmed) return;
      if (
        !window.confirm(
          'Source or prepared data exceeds 10 MiB. Preparation and opening may use substantial memory, especially on mobile. Working limit: 128 MiB; final HTML: 25 MiB. Device capacities are not validated. Continue?'
        )
      )
        throw new Error('Preparation cancelled.');
      confirmed = true;
    };
    confirmWork(total);
    let html,
      entries = [];
    if (pageMode) html = await embedSelectedHtml(snapshot, analysis.entry, { signal, onSize: confirmWork });
    for (const item of snapshot) {
      signal.throwIfAborted();
      if (pageMode && html.used.has(item) && !html.retained.has(item) && item !== analysis.entry) continue;
      entries.push({
        filename: item.path,
        contentType: inferContentType(item.file),
        bytes: pageMode && item === analysis.entry ? html.bytes : new Uint8Array(await item.file.arrayBuffer()),
        ...(pageMode && item === analysis.entry ? { page: true } : {})
      });
    }
    signal.throwIfAborted();
    if (pageMode) entries.sort((a, b) => Number(!!b.page) - Number(!!a.page));
    let bytes,
      file,
      isPage = false;
    if (entries.length === 1 && !html?.warnings.length) {
      bytes = entries[0].bytes;
      file = { name: entries[0].filename.split('/').pop(), type: entries[0].contentType };
      isPage = !!entries[0].page;
    } else {
      bytes = packCollection(entries);
      file = { name: 'files.seal', type: 'application/vnd.staticseal.collection', collection: true };
    }
    file.readerFiles = entries.map(({ filename, contentType, page }) => ({ filename, contentType, page }));
    if (bytes.byteLength > PREPARED_MAX_BYTES) throw new Error('Prepared content exceeds the 128 MiB working limit.');
    confirmWork(bytes.byteLength);
    if (revision !== selectionRevision) return;
    preparedSelection = { bytes, file, isPage, total: Math.max(total, bytes.byteLength), html, entry: analysis.entry };
    selectionReport.textContent =
      (analysis.ambiguous
        ? 'HTML structure not recognized. Files will be packaged individually; HTML appears as source text or a download. Select only the intended website folder with one root index.html, or select a single HTML file and its assets.\n'
        : html
          ? analysis.entry.path +
            ' recognized · ' +
            (html.used.size - html.pageCount + 1) +
            ' resource(s) embedded · ' +
            (html.pageCount > 1 ? html.pageCount - 1 + ' linked page(s) · ' : '') +
            (entries.length - 1) +
            ' additional file(s).\n'
          : 'Files will be shown separately in the created document.\n') +
      (html?.warnings.join('\n') || '') +
      (html ? '\nDynamic JavaScript dependencies cannot be checked completely.' : '');
    $('download-prepared').hidden = !html;
    button.disabled = sealing;
    setStatus(
      preparedSelection.total >= BROWSER_FILE_WARN_BYTES
        ? 'Source or prepared data from 5 MiB can use substantial memory. Working limit: 128 MiB; final HTML: 25 MiB.'
        : ''
    );
  } catch (error) {
    if (revision === selectionRevision) selectionReport.textContent = error.message;
  }
}
folderInput.addEventListener('change', () => selectFiles(Array.from(folderInput.files)));
const dropZone = sourceFile.closest('.file-picker');
dropZone.addEventListener('dragover', event => {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});
dropZone.addEventListener('drop', async event => {
  event.preventDefault();
  // Capture entries and fallback files while the drag data store is readable.
  const roots = Array.from(event.dataTransfer.items || [])
    .filter(item => item.kind === 'file')
    .map(item => (item.getAsEntry || item.webkitGetAsEntry)?.call(item) || item.getAsFile());
  if (!roots.length) roots.push(...event.dataTransfer.files);
  const files = [];
  let total = 0;
  async function visit(entry, prefix = '') {
    if (!entry) return;
    const path = prefix + entry.name;
    if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      while ((batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject))).length)
        for (const child of batch) await visit(child, path + '/');
    } else {
      const file = entry.isFile ? await new Promise((resolve, reject) => entry.file(resolve, reject)) : entry;
      total += file.size;
      if (files.length >= 1000 || total > SOURCE_MAX_BYTES)
        throw new Error('Maximum 1,000 files and 128 MiB of source data.');
      files.push({ file, path });
    }
  }
  try {
    for (const root of roots) await visit(root);
    if (files.length) await selectFiles(files);
    else setStatus('No files found in this drop. Try Choose a folder.', 'error');
  } catch (error) {
    setStatus('Could not read dropped files: ' + error.message, 'error');
  }
});
htmlPage.addEventListener('change', refreshSelection);
$('download-prepared').addEventListener('click', () => {
  if (preparedSelection?.html)
    downloadHtml(
      preparedSelection.entry.path.split('/').pop(),
      new TextDecoder().decode(preparedSelection.html.bytes),
      PREPARED_MAX_BYTES
    );
});
async function sealSelection() {
  if (sealing) return;
  const prepared = preparedSelection;
  if (!prepared) {
    setStatus('Choose files and wait for the local check to finish.', 'error');
    return;
  }
  const passphrase = password.value;
  if (passphrase !== passwordRepeat.value) {
    setStatus('Passphrases do not match.', 'error');
    passwordRepeat.focus();
    return;
  }
  if (passphrase && !crypto.subtle) {
    setStatus('This browser does not expose Web Crypto on this page.', 'error');
    return;
  }
  const output = outputFilenameFor();
  sealing = true;
  button.disabled = true;
  setStatus(passphrase ? 'Encrypting locally …' : 'Sealing locally …');
  try {
    const payload = await encryptBytes(
      prepared.bytes,
      passphrase,
      DEFAULT_ITERATIONS,
      prepared.file,
      passphrase ? 'passphrase' : 'sealed',
      prepared.isPage
    );
    const html = renderWrapper({ payload, files: prepared.file.readerFiles });
    downloadHtml(output, html);
    setStatus(
      'Prepared content: ' +
        formatBytes(prepared.bytes.length) +
        ' → HTML package: ' +
        formatBytes(new Blob([html]).size) +
        '.'
    );
  } catch (error) {
    setStatus(error.message || 'Packaging failed.', 'error');
  } finally {
    sealing = false;
    button.disabled = !preparedSelection;
  }
}
