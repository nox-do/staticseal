// Standalone factories: each envelope contains only its selected renderer.
export function isHtmlFile(name, type = '') {
  return /\.html?$/i.test(name) || type.toLowerCase().split(';')[0].trim() === 'text/html';
}

export function createPageViewer() {
  const decodeHtml = bytes => {
    const encoding =
      bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(bytes);
    } catch {
      throw new DOMException('Page mode requires UTF-8 or BOM-marked UTF-16 HTML.', 'NotSupportedError');
    }
  };
  const renderHtmlPage = (bytes, content) => {
    const html = decodeHtml(bytes);
    document.open();
    document.write(html);
    document.close();
    if (!document.title?.trim()) document.title = content?.filename || 'Opened webpage';
    // Retain the wrapper's indexing request after replacing its document.
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex,nofollow,noarchive';
    document.head.append(robots);
  };
  return { decodeHtml, renderHtmlPage };
}

export function createFileViewer(escapeHtml, previewFactory, renderers) {
  const $ = id => document.getElementById(id);
  const helpers = previewFactory();
  const { inferContentType, previewKind } = helpers;
  const brand = $('wrapper-brand').outerHTML;
  let currentUrl;
  return function renderFile(bytes, unlockedContent) {
    const filename = unlockedContent.filename || 'sealed-file';
    document.title = filename;
    const contentType = inferContentType(filename, unlockedContent.contentType);
    const kind = previewKind(filename, contentType);
    const blob = new Blob([bytes], { type: contentType });
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    const url = (currentUrl = URL.createObjectURL(blob));
    const safeName = escapeHtml(filename);
    const safeType = escapeHtml(contentType);

    document.body.className = 'vp';
    document.body.innerHTML =
      '<main class="vs">' +
      '<header class="vb">' +
      brand +
      '<div class="vt">' +
      safeName +
      '<small>' +
      safeType +
      '</small></div>' +
      '<div class="va">' +
      '<a href="' +
      url +
      '" download="' +
      safeName +
      '">Download</a>' +
      '</div></header><section id="vc"></section></main>';

    const viewer = $('vc');
    const render = renderers[kind];
    if (render) render(viewer, { bytes, url, safeName, filename, contentType, kind }, helpers);
    else
      viewer.innerHTML =
        '<div class="dl"><p class="kicker">Ready to download</p><h1>' +
        safeName +
        '</h1><p>Your file is ready to download.</p><p>This file type is not previewed automatically.</p></div>';
  };
}

export function renderImagePreview(viewer, { safeName, url }) {
  viewer.innerHTML = '<img class="im" alt="' + safeName + '" src="' + url + '">';
}

export function renderTextPreview(
  viewer,
  { bytes, kind, filename, contentType },
  { renderMarkdown, codeLanguage, highlightCode }
) {
  const $ = id => document.getElementById(id);
  const limit = 128 * 1024;
  const truncated = bytes.length > limit;
  const encoding =
    bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
  let text;
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(0, limit), { stream: truncated });
  } catch {
    viewer.innerHTML =
      '<div class="dl"><h1>Text preview unavailable</h1><p>Unsupported text encoding. Download the original file to open it.</p></div>';
    return;
  }
  viewer.innerHTML =
    '<section class="tf' +
    (kind === 'markdown' ? ' md' : '') +
    '">' +
    (truncated ? '<p class="pn">Preview limited to the first 128 KiB. Download contains the complete file.</p>' : '') +
    (kind === 'markdown' ? '<article>' + renderMarkdown(text) + '</article>' : '<pre id="tp"></pre>') +
    (truncated
      ? '<aside class="pn pe" role="note"><strong>Preview ends here — the file continues.</strong><br>Only the first 128 KiB are shown. Use Download above to read the complete original file.</aside>'
      : '') +
    '</section>';
  if (kind === 'text') {
    const pre = $('tp');
    const language = codeLanguage?.(filename, contentType);
    if (language) pre.innerHTML = highlightCode(text, language);
    else pre.textContent = text;
  }
}

export function renderPdfPreview(viewer, { safeName, url }) {
  viewer.innerHTML =
    '<div class="dl"><p class="kicker">Ready to download</p><h1>' +
    safeName +
    '</h1><p>Your file is ready to download.</p><p class="pn">PDFs may contain links or interactive content. Open only files you trust.</p><button id="pdf" type="button">Preview PDF</button></div>';
  document.getElementById('pdf').addEventListener('click', () => {
    viewer.innerHTML = '<iframe class="vf" title="' + safeName + '" src="' + url + '"></iframe>';
  });
}
