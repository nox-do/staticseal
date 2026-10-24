import {
  createFormat,
  collectionViewerSource,
  createFileTypes,
  createCodePreview,
  createMarkdownPreview,
  inflateContent,
  createCrypto,
  createFileViewer,
  renderImagePreview,
  renderTextPreview,
  renderPdfPreview,
  createPageViewer
} from './reader-factories.mjs';
import { sealLogo } from './logo.mjs';
import { wrapperTemplate, readerTemplate, openingStyles, viewerStyles, previewStyles } from './wrapper-template.mjs';

// Creator-only link plan: prepare the selected viewer and styles once, independent
// of compression/encryption. The input file inventory is never serialized.
// String concatenation embeds each selected function as source, without eval.
export function planReader(display, files) {
  const isPage = display === 'page';
  const isCollection = display === 'collection';
  const framedPage = isCollection && files?.length === 1 && files[0].page;
  const types = createFileTypes();
  const kinds = files?.filter(file => !file.page).map(file => types.previewKind(file.filename, file.contentType));
  const markdown = !files || kinds.includes('markdown');
  const code =
    markdown ||
    !files ||
    files.some(file => !file.page && createCodePreview().codeLanguage(file.filename, file.contentType));
  const preview =
    '(()=>{const code=' +
    (code ? '(' + createCodePreview + ')()' : '{}') +
    ';return {...(' +
    createFileTypes +
    ')(),...code' +
    (markdown ? ',...(' + createMarkdownPreview + ')(code)' : '') +
    '}})';
  const renderers = [];
  if (!files || kinds.includes('image')) renderers.push('image:' + renderImagePreview);
  if (!files || kinds.includes('pdf')) renderers.push('pdf:' + renderPdfPreview);
  if (!files || kinds.some(kind => kind === 'text' || kind === 'markdown')) renderers.push('text:' + renderTextPreview);
  const fileViewer =
    '((e,p)=>{const r={' + renderers.join(',') + '};r.markdown=r.text;return (' + createFileViewer + ')(e,p,r)})';
  return {
    styles:
      openingStyles +
      (isPage
        ? ''
        : viewerStyles +
          (!files || kinds.some(kind => kind === 'text' || kind === 'markdown') ? previewStyles[0] : '') +
          (markdown && !framedPage ? previewStyles[1] : '') +
          (!files || kinds.some(kind => ['text', 'markdown', 'pdf'].includes(kind)) ? previewStyles[2] : '') +
          (code && !framedPage ? previewStyles[3] : '')),
    viewer: isPage
      ? '(()=>(' + createPageViewer + ')().renderHtmlPage)'
      : isCollection
        ? collectionViewerSource(framedPage, !files || files.some(file => file.page), fileViewer, preview)
        : '(e=>(' + fileViewer + ')(e,' + preview + '))'
  };
}

export function renderWrapper({ title, payload, buttonLabel, files, plan = planReader(payload.display, files) }) {
  const format = createFormat();
  const { escapeHtml } = format;
  const hasPassphrase = payload.access !== 'sealed';
  const heading = escapeHtml(title || payload.filename || '');
  const values = {
    STYLES: plan.styles,
    TITLE: heading || 'Staticseal',
    HEADING: heading ? '<h1>' + heading + '</h1>' : '',
    LOGO: sealLogo,
    PASSWORD_FIELD: hasPassphrase
      ? '<label for="password">Passphrase</label><input id="password" name="password" type="password" placeholder="Passphrase" autofocus>'
      : '',
    BUTTON: escapeHtml(buttonLabel ?? 'Open sealed ' + (payload.display === 'collection' ? 'collection' : 'file')),
    // Keep HTML script-parser control sequences out of the JSON data block.
    PAYLOAD: JSON.stringify(payload).replaceAll('<', '\\u003c'),
    READER: readerTemplate
      .replace('STATICSEAL_DECODER', () =>
        format.isUnencryptedVersion(payload.v) ? '((p,k,b,c)=>c(p.content))' : '(' + createCrypto + ')().decryptPayload'
      )
      .replace(/STATICSEAL_RESTORE\(([$\w]+)\);/, (_, content) =>
        format.isCompressedVersion(payload.v)
          ? content + '=await (' + inflateContent + ')(' + content + ',' + format.MAX_EXPANDED_BYTES + ');'
          : ''
      )
      .replace('STATICSEAL_FORMAT', () => '(' + createFormat + ')')
      .replace('STATICSEAL_VIEWER', () => plan.viewer)
  };
  // Callback replacement preserves literal $ sequences in filenames and payloads.
  return wrapperTemplate.replace(
    /STATICSEAL_(STYLES|TITLE|HEADING|LOGO|PASSWORD_FIELD|BUTTON|PAYLOAD|READER)\b/g,
    (_, key) => values[key]
  );
}
