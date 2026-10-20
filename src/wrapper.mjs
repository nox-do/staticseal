import { createFormat, createPreview, inflateContent, createCrypto, createFileViewer, createPageViewer } from './reader-factories.mjs';
import { sealLogo } from './logo.mjs';
import { wrapperTemplate, readerTemplate } from './wrapper-template.mjs';

export function renderWrapper({ title, payload, minimal = false, buttonLabel }) {
  const { escapeHtml } = createFormat();
  const hasPassphrase = payload.access !== 'sealed';
  const isPage = payload.display === 'page';
  const subject = isPage ? 'webpage' : 'file';
  const values = {
    TITLE: escapeHtml(payload.filename === undefined ? 'Protected file' : title),
    LOGO: sealLogo,
    KICKER: (hasPassphrase ? 'Protected ' : 'Sealed ') + subject,
    COPY: minimal ? '' : '<p>' + (hasPassphrase
      ? 'Enter the passphrase to open this ' + subject + ' in your browser.'
      : 'Open this ' + subject + ' in your browser. No passphrase needed.') + '</p>',
    BUTTON: escapeHtml(buttonLabel ?? (hasPassphrase ? 'Unlock file' : 'Open sealed file')),
    // Keep HTML script-parser control sequences out of the JSON data block.
    PAYLOAD: JSON.stringify(payload).replaceAll('<', '\\u003c'),
    READER: readerTemplate
      .replace('STATICSEAL_INITIAL_STATUS', () => JSON.stringify(minimal ? '' : 'No passphrase required.'))
      .replace('STATICSEAL_DECODER', () => payload.v >= 4
        ? '((p,k,b,c)=>c(p.content))'
        : '(' + createCrypto.toString() + ')().decryptPayload')
      .replace('STATICSEAL_RESTORE;', () => payload.v === 3 || payload.v === 5
        ? 'unlockedContent=await (' + inflateContent.toString() + ')(unlockedContent);' : '')
      .replace('STATICSEAL_FORMAT', () => '(' + createFormat.toString() + ')')
      .replace('STATICSEAL_VIEWER', () => isPage
        ? '(()=>(' + createPageViewer.toString() + ')().renderHtmlPage)'
        : '(e=>(' + createFileViewer.toString() + ')(e,' + createPreview.toString() + '))')
  };
  // Callback replacement preserves literal $ sequences in filenames and payloads.
  return wrapperTemplate.replace(/STATICSEAL_(TITLE|LOGO|KICKER|COPY|BUTTON|PAYLOAD|READER)\b/g,
    (_, key) => values[key]);
}
