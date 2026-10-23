import { PREPARED_MAX_BYTES } from './limits.mjs';

export function packCollection(files) {
  const encoder = new TextEncoder();
  const limit = PREPARED_MAX_BYTES;
  if (!files.length || files.length > 1000) throw new Error('Select between 1 and 1,000 files.');
  let offset = 0;
  const names = new Set();
  const entries = files.map(file => {
    let name = file.filename;
    for (let n = 2; names.has(name); n++) name = file.filename.replace(/(\.[^/.]+)?$/, ' (' + n + ')$1');
    names.add(name);
    const entry = {
      filename: name,
      contentType: file.contentType || 'application/octet-stream',
      offset,
      size: file.bytes.byteLength,
      ...(file.page ? { page: true } : {})
    };
    offset += entry.size;
    return entry;
  });
  const header = encoder.encode(JSON.stringify({ v: 1, entries }));
  if (header.length > 1024 * 1024 || offset + header.length + 4 > limit)
    throw new Error('Collection exceeds the 128 MiB working limit.');
  const bytes = new Uint8Array(4 + header.length + offset);
  new DataView(bytes.buffer).setUint32(0, header.length);
  bytes.set(header, 4);
  files.forEach((file, index) => bytes.set(file.bytes, 4 + header.length + entries[index].offset));
  createCollection().unpack(bytes);
  return bytes;
}

// Self-contained collection codec and uncompressed ZIP writer. Included only in
// experimental creators and collection readers; ordinary file readers omit it.
export function createCollectionReader() {
  const encoder = new TextEncoder();
  // Standalone reader: keep aligned with PREPARED_MAX_BYTES and the gzip ceiling.
  const limit = 128 * 1024 * 1024;
  /* eslint-disable no-control-regex -- Reject control bytes in collection paths and ZIP names. */
  const validName = name =>
    typeof name === 'string' &&
    name.length > 0 &&
    encoder.encode(name).length <= 65535 &&
    !/[\\\x00-\x1f:]/.test(name) &&
    !name.startsWith('/') &&
    name.split('/').every(part => part && part !== '.' && part !== '..');
  /* eslint-enable no-control-regex */
  function unpack(bytes) {
    if (bytes.length < 4 || bytes.length > limit) throw new Error('Invalid collection size.');
    const length = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0);
    if (length > 1024 * 1024 || length > bytes.length - 4) throw new Error('Invalid collection metadata.');
    const header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(4, 4 + length)));
    if (header.v !== 1 || !Array.isArray(header.entries) || !header.entries.length || header.entries.length > 1000)
      throw new Error('Invalid collection.');
    let offset = 0;
    const names = new Set();
    const files = header.entries.map(entry => {
      if (
        !validName(entry.filename) ||
        names.has(entry.filename) ||
        typeof entry.contentType !== 'string' ||
        (entry.page !== undefined && entry.page !== true) ||
        entry.offset !== offset ||
        !Number.isSafeInteger(entry.size) ||
        entry.size < 0 ||
        entry.size > bytes.length - 4 - length - offset
      )
        throw new Error('Invalid collection entry.');
      names.add(entry.filename);
      const file = { ...entry, bytes: bytes.subarray(4 + length + offset, 4 + length + offset + entry.size) };
      offset += entry.size;
      return file;
    });
    if (offset !== bytes.length - 4 - length) throw new Error('Invalid collection length.');
    return files;
  }
  return { unpack };
}

export function createZip() {
  const encoder = new TextEncoder();
  // Store-only ZIP: gzip already handles package compression. No archive library
  // or decompressor is required to download a collection as standard ZIP.
  function zip(files) {
    const parts = [],
      central = [];
    let offset = 0,
      centralSize = 0;
    const crc32 = bytes => {
      let crc = -1;
      for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
      }
      return (crc ^ -1) >>> 0;
    };
    for (const file of files) {
      const name = encoder.encode(file.filename),
        size = file.bytes.length,
        crc = crc32(file.bytes);
      const local = new Uint8Array(30 + name.length),
        localView = new DataView(local.buffer);
      const directory = new Uint8Array(46 + name.length),
        view = new DataView(directory.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x800, true);
      localView.setUint16(12, 33, true); // 1980-01-01
      localView.setUint32(14, crc, true);
      localView.setUint32(18, size, true);
      localView.setUint32(22, size, true);
      localView.setUint16(26, name.length, true);
      local.set(name, 30);
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, 0x800, true);
      view.setUint16(14, 33, true);
      view.setUint32(16, crc, true);
      view.setUint32(20, size, true);
      view.setUint32(24, size, true);
      view.setUint16(28, name.length, true);
      view.setUint32(42, offset, true);
      directory.set(name, 46);
      parts.push(local, file.bytes);
      central.push(directory);
      offset += local.length + size;
      centralSize += directory.length;
    }
    const end = new Uint8Array(22),
      view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, files.length, true);
    view.setUint16(10, files.length, true);
    view.setUint32(12, centralSize, true);
    view.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }
  return zip;
}

export function createCollectionViewer(escapeHtml, fileViewerFactory, previewFactory, collectionFactory) {
  const codec = collectionFactory();
  const renderFile = fileViewerFactory(escapeHtml, previewFactory);
  let zipUrl;
  return bytes => {
    const files = codec.unpack(bytes);
    let index = 0;
    const show = () => {
      const file = files[index];
      renderFile(file.bytes, file);
      if (file.page) {
        const frame = document.createElement('iframe');
        frame.className = 'vf';
        frame.title = file.filename;
        frame.onload = () => {
          const doc = frame.contentDocument;
          if (!doc) return;
          doc.addEventListener('click', event => {
            const link = event.target.closest?.('a[href^="#"]');
            if (!link || event.defaultPrevented || event.button !== 0) return;
            event.preventDefault();
            try {
              const name = decodeURIComponent(link.getAttribute('href').slice(1));
              const target = doc.getElementById(name) || doc.getElementsByName(name)[0];
              if (target) target.scrollIntoView();
              else if (!name || name.toLowerCase() === 'top') frame.contentWindow.scrollTo(0, 0);
            } catch {
              /* Ignore malformed fragments. */
            }
          });
        };
        frame.srcdoc = new TextDecoder().decode(file.bytes);
        document.getElementById('vc').replaceChildren(frame);
      }
      const nav = document.createElement('nav');
      nav.className = 'vn';
      nav.setAttribute('aria-label', 'Files');
      nav.innerHTML =
        '<style>.vb{flex-wrap:wrap}.vn{display:flex;align-items:center;gap:6px;flex:1;min-width:180px}.vn button,.vn select{min-height:36px;padding:6px 10px;border-radius:6px;font:inherit;font-size:12px}.vn button:disabled{cursor:default}.vn span{white-space:nowrap;font-size:12px}.vn select{flex:1;width:0;border:1px solid var(--line);background:var(--panel);color:var(--ink)}.vn select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.va{display:flex;gap:6px;margin-left:auto}@media(max-width:700px){.vn{flex-basis:100%;order:1}}</style>' +
        '<button id="prev-file" type="button" aria-label="Previous file">‹</button>' +
        '<span aria-live="polite">' +
        (index + 1) +
        ' / ' +
        files.length +
        '</span>' +
        '<button id="next-file" type="button" aria-label="Next file">›</button>' +
        '<select id="choose-file" aria-label="Choose file"></select>';
      document.querySelector('.vt').replaceWith(nav);
      document
        .querySelector('.va')
        .insertAdjacentHTML('beforeend', '<a id="download-all" download="files.zip">Download all (ZIP)</a>');
      const $ = id => document.getElementById(id);
      const select = $('choose-file');
      files.forEach((entry, n) => {
        const option = document.createElement('option');
        option.value = n;
        option.textContent = entry.filename;
        option.selected = n === index;
        select.append(option);
      });
      $('prev-file').disabled = index === 0;
      $('next-file').disabled = index === files.length - 1;
      $('prev-file').onclick = () => {
        index--;
        show();
      };
      $('next-file').onclick = () => {
        index++;
        show();
      };
      select.onchange = () => {
        index = Number(select.value);
        show();
      };
      $('download-all').href = zipUrl || '#';
      $('download-all').onclick = () => {
        $('download-all').href = zipUrl || (zipUrl = URL.createObjectURL(codec.zip(files)));
      };
    };
    show();
  };
}

export function createCollection() {
  return { ...createCollectionReader(), zip: createZip() };
}

// A warning keeps the webpage header, but does not require collection navigation.
export function createFramedPageViewer(escapeHtml, collectionFactory) {
  const brand = document.getElementById('wrapper-brand').outerHTML;
  return bytes => {
    const files = collectionFactory().unpack(bytes);
    if (files.length !== 1 || !files[0].page) throw new Error('Expected one webpage.');
    const file = files[0];
    document.title = file.filename;
    document.body.className = 'vp';
    document.body.innerHTML =
      '<main class="vs"><header class="vb">' +
      brand +
      '<div class="vt">' +
      escapeHtml(file.filename) +
      '</div><div class="va"><a id="page-download" download="' +
      escapeHtml(file.filename) +
      '">Download</a></div></header><section id="vc"></section></main>';
    document.getElementById('page-download').href = URL.createObjectURL(new Blob([file.bytes], { type: 'text/html' }));
    const frame = document.createElement('iframe');
    frame.className = 'vf';
    frame.title = file.filename;
    frame.onload = () => {
      const doc = frame.contentDocument;
      if (!doc) return;
      doc.addEventListener('click', event => {
        const link = event.target.closest?.('a[href^="#"]');
        if (!link || event.defaultPrevented || event.button !== 0) return;
        event.preventDefault();
        try {
          const name = decodeURIComponent(link.getAttribute('href').slice(1));
          const target = doc.getElementById(name) || doc.getElementsByName(name)[0];
          if (target) target.scrollIntoView();
          else if (!name || name.toLowerCase() === 'top') frame.contentWindow.scrollTo(0, 0);
        } catch {
          /* Ignore malformed fragments. */
        }
      });
    };
    frame.srcdoc = new TextDecoder().decode(file.bytes);
    document.getElementById('vc').append(frame);
  };
}
