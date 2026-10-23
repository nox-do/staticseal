import {
  createFormat,
  createFileTypes,
  createCodePreview,
  createMarkdownPreview,
  createFramedPageViewer,
  createCollectionReader,
  createZip,
  inflateContent,
  createCrypto,
  createFileViewer,
  renderImagePreview,
  renderTextPreview,
  renderPdfPreview,
  createPageViewer,
  createCollectionViewer
} from './reader-factories.mjs';
import { sealLogo } from './logo.mjs';
import { wrapperTemplate, readerTemplate, openingStyles, viewerStyles, previewStyles } from './wrapper-template.mjs';

export function renderWrapper({ title = 'Protected file', payload, minimal = false, buttonLabel, files }) {
  const format = createFormat();
  const { escapeHtml } = format;
  const hasPassphrase = payload.access !== 'sealed';
  const isPage = payload.display === 'page';
  const isCollection = payload.display === 'collection';
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
    (code ? '(' + createCodePreview.toString() + ')()' : '{}') +
    ';return {...(' +
    createFileTypes.toString() +
    ')(),...code' +
    (markdown ? ',...(' + createMarkdownPreview.toString() + ')(code.highlightCode)' : '') +
    '}})';
  const renderers = [];
  if (!files || kinds.includes('image')) renderers.push('image:' + renderImagePreview.toString());
  if (!files || kinds.includes('pdf')) renderers.push('pdf:' + renderPdfPreview.toString());
  if (!files || kinds.some(kind => kind === 'text' || kind === 'markdown'))
    renderers.push('text:' + renderTextPreview.toString());
  const fileViewer =
    '((e,p)=>{const r={' +
    renderers.join(',') +
    '};r.markdown=r.text;return (' +
    createFileViewer.toString() +
    ')(e,p,r)})';
  const collection =
    isCollection && !framedPage
      ? '(()=>({...(' + createCollectionReader.toString() + ')(),zip:(' + createZip.toString() + ')()}))'
      : '';
  const subject = isCollection ? 'file collection' : isPage ? 'webpage' : 'file';
  const values = {
    STYLES:
      openingStyles +
      (isPage
        ? ''
        : viewerStyles +
          (!files || kinds.some(kind => kind === 'text' || kind === 'markdown') ? previewStyles[0] : '') +
          (markdown && !framedPage ? previewStyles[1] : '') +
          (!files || kinds.some(kind => ['text', 'markdown', 'pdf'].includes(kind)) ? previewStyles[2] : '') +
          (code && !framedPage ? previewStyles[3] : '')),
    TITLE: escapeHtml(title),
    LOGO: sealLogo,
    KICKER: (hasPassphrase ? 'Protected ' : 'Sealed ') + subject,
    COPY: minimal
      ? ''
      : '<p>' +
        (hasPassphrase
          ? 'Enter the passphrase to open this ' + subject + ' in your browser.'
          : 'Open this ' + subject + ' in your browser.') +
        '</p>',
    PASSWORD_FIELD: hasPassphrase
      ? '<label for="password">Passphrase</label><input id="password" name="password" type="password" placeholder="Passphrase" autofocus>'
      : '',
    BUTTON: escapeHtml(buttonLabel ?? (hasPassphrase ? 'Unlock file' : 'Open sealed file')),
    // Keep HTML script-parser control sequences out of the JSON data block.
    PAYLOAD: JSON.stringify(payload).replaceAll('<', '\\u003c'),
    READER: readerTemplate
      .replace('STATICSEAL_DECODER', () =>
        format.isUnencryptedVersion(payload.v)
          ? '((p,k,b,c)=>c(p.content))'
          : '(' + createCrypto.toString() + ')().decryptPayload'
      )
      .replace(/STATICSEAL_RESTORE\(([$\w]+)\);/, (_, content) =>
        format.isCompressedVersion(payload.v)
          ? content + '=await (' + inflateContent.toString() + ')(' + content + ',' + format.MAX_EXPANDED_BYTES + ');'
          : ''
      )
      .replace('STATICSEAL_FORMAT', () => '(' + createFormat.toString() + ')')
      .replace('STATICSEAL_VIEWER', () =>
        isPage
          ? '(()=>(' + createPageViewer.toString() + ')().renderHtmlPage)'
          : framedPage
            ? '(e=>(' + createFramedPageViewer.toString() + ')(e,' + createCollectionReader.toString() + '))'
            : isCollection
              ? '(e=>(' +
                createCollectionViewer.toString() +
                ')(e,' +
                fileViewer +
                ',' +
                preview +
                ',' +
                collection +
                '))'
              : '(e=>(' + fileViewer + ')(e,' + preview + '))'
      )
  };
  // Callback replacement preserves literal $ sequences in filenames and payloads.
  return wrapperTemplate.replace(
    /STATICSEAL_(STYLES|TITLE|LOGO|KICKER|COPY|PASSWORD_FIELD|BUTTON|PAYLOAD|READER)\b/g,
    (_, key) => values[key]
  );
}
