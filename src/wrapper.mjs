import {
  createFormat,
  createPreview,
  inflateContent,
  createCrypto,
  createFileViewer,
  createPageViewer,
  createCollection,
  createCollectionViewer
} from './reader-factories.mjs';
import { sealLogo } from './logo.mjs';
import { wrapperTemplate, readerTemplate } from './wrapper-template.mjs';

export function renderWrapper({ title = 'Protected file', payload, minimal = false, buttonLabel }) {
  const format = createFormat();
  const { escapeHtml } = format;
  const hasPassphrase = payload.access !== 'sealed';
  const isPage = payload.display === 'page';
  const isCollection = payload.display === 'collection';
  const subject = isCollection ? 'file collection' : isPage ? 'webpage' : 'file';
  const values = {
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
          : isCollection
            ? '(e=>(' +
              createCollectionViewer.toString() +
              ')(e,' +
              createFileViewer.toString() +
              ',' +
              createPreview.toString() +
              ',' +
              createCollection.toString() +
              '))'
            : '(e=>(' + createFileViewer.toString() + ')(e,' + createPreview.toString() + '))'
      )
  };
  // Callback replacement preserves literal $ sequences in filenames and payloads.
  return wrapperTemplate.replace(
    /STATICSEAL_(TITLE|LOGO|KICKER|COPY|PASSWORD_FIELD|BUTTON|PAYLOAD|READER)\b/g,
    (_, key) => values[key]
  );
}
