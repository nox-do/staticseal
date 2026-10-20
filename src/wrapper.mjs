import { createFormat, createPreview, inflateContent, createCrypto } from './reader-factories.mjs';
import { sealLogo } from './logo.mjs';
import { wrapperTemplate, readerTemplate } from './wrapper-template.mjs';

export function renderWrapper({ title, payload }) {
  const { escapeHtml } = createFormat();
  const hasPassphrase = payload.access !== 'sealed';
  const values = {
    TITLE: escapeHtml(payload.filename === undefined ? 'Protected file' : title),
    LOGO: sealLogo,
    KICKER: hasPassphrase ? 'Protected file' : 'Sealed file',
    COPY: hasPassphrase
      ? 'Enter the passphrase to open this file in your browser.'
      : 'Open this file in your browser. No passphrase needed.',
    HINT: hasPassphrase
      ? 'Passphrase protection depends on a strong passphrase. Anyone with the file can attempt offline password guesses.'
      : 'Anyone with this file can open it.',
    // Keep HTML script-parser control sequences out of the JSON data block.
    PAYLOAD: JSON.stringify(payload).replaceAll('<', '\\u003c'),
    READER: readerTemplate
      .replace('STATICSEAL_DECODER', () => payload.v >= 4
        ? '((p,k,b,c)=>c(p.content))'
        : '(' + createCrypto.toString() + ')().decryptPayload')
      .replace('STATICSEAL_RESTORE;', () => payload.v === 3 || payload.v === 5
        ? 'unlockedContent=await (' + inflateContent.toString() + ')(unlockedContent);' : '')
      .replace('STATICSEAL_FORMAT', () => '(' + createFormat.toString() + ')')
      .replace('STATICSEAL_PREVIEW', () => '(' + createPreview.toString() + ')')
  };
  // Callback replacement preserves literal $ sequences in filenames and payloads.
  return wrapperTemplate.replace(/STATICSEAL_(TITLE|LOGO|KICKER|COPY|HINT|PAYLOAD|READER)\b/g,
    (_, key) => values[key]);
}
