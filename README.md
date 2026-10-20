# Staticseal

Package any file into a self-contained HTML file. Send it as an attachment or host it
on your website. Add a passphrase if needed.

**[Open Staticseal](https://nox-do.github.io/staticseal/)** · [MIT license](LICENSE)

## Use in your browser

1. Choose a file.
2. Optionally add and repeat a passphrase.
3. Select **Seal & download file**.

Your file and passphrase stay in your browser. No upload, account, or backend is
required. [Download the latest release](https://github.com/nox-do/staticseal/releases/latest/download/staticseal.html)
and open `staticseal.html` in your browser to use it offline.

Under **Advanced options**, you can generate a passphrase, hide the original
filename and file type, or adjust the PBKDF2 settings. Share the passphrase
separately from the generated file.

Files from 4 KiB up to 25 MiB are automatically tried with gzip before packaging.
Compression is used only when the complete HTML package, including its unpacker,
is smaller. This works for any file type and restores the original bytes exactly.
Uncompressed packages contain no gzip unpacker. The result shows original and
HTML package sizes. The CLI uses the same policy; larger CLI files stay uncompressed.
Compression needs native Compression Streams support during creation and
Decompression Streams support when opening a compressed package; no library is bundled.

After unlocking, PNG, JPEG, GIF, WebP and SVG display inline. SVG uses an image
element. Text and source code (including HTML) display as escaped text, and
JavaScript, JSON and HTML get basic syntax colors, including labeled Markdown
code blocks. Markdown offers basic formatting: headings, paragraphs, emphasis, lists, quotes,
fenced code blocks and links. Markdown HTML remains text; images are not loaded.
Text previews show at most 128 KiB and support UTF-8 and BOM-marked UTF-16.
Downloads always contain the complete original file. PDFs offer an optional
preview after confirmation. Other formats are download-only.
Staticseal packages individual files; it does not currently run or package whole websites.

## Use the CLI

Requires Node.js 20 or later. From a checkout of this repository:

```sh
node bin/self-encrypt.mjs --in report.pdf --out report_encrypted.html
```

The CLI prompts for a passphrase without displaying it. To hide the original
filename and file type, add `--private-filename` and choose a neutral output name:

```sh
node bin/self-encrypt.mjs --in report.pdf --out protected_file.html --private-filename
```

For automation, supply the passphrase through standard input:

```sh
printf '%s\n' "$STATICSEAL_PASSPHRASE" | node bin/self-encrypt.mjs \
  --in report.pdf --out protected_file.html --stdin-password
```

Run `node bin/self-encrypt.mjs --help` for all options.

## Know the limits

- **Passphrase protection depends on a strong passphrase.** Anyone with the file
  can attempt offline password guesses. There is no password reset or server-side
  access control.
- **Without a passphrase, contents are not private.** Leaving both browser fields
  blank, or using `--no-password`, stores Base64-encoded content, optionally gzip
  compressed. These packages contain no encryption or decryption code. This only
  obstructs simple crawlers; anyone with the file can recover its contents.
  They have no AES-GCM integrity check; creation still verifies the original bytes.
- **Names are public by default.** Enable private filenames to put the name
  and MIME type inside the encoded content. With a passphrase they are encrypted;
  without one, they remain recoverable. File size remains observable. Publish only the protected
  output if the original should stay private.
- **Browser sizes are provisional.** Warning from 5 MiB, confirmation above 10 MiB,
  maximum 25 MiB. These are product limits, not validated browser capacities.
  The CLI has no equivalent cap; recipient browsers still have memory limits.
- **Only open trusted content.** Encryption and previews do not scan for malware.

## Development

```sh
npm ci
npm run build
npm run check
```

Edit `src/app.html` for the browser UI, `src/wrapper.mjs` for wrapper generation,
`src/wrapper.html` and `src/wrapper.css` for its layout, `src/reader.js` for the
unlock/viewer script, `src/format.mjs`, `src/crypto.mjs` and `src/preview.mjs` for shared helpers,
`src/compression.mjs` for compression selection, `src/gzip.mjs` for the optional
unpacker, and `src/seal.svg` for the logo.
The build generates `index.html`, `src/logo.mjs`, `src/wrapper-template.mjs`
and `src/reader-factories.mjs`; do not edit them directly.
CSS, HTML and JavaScript are minified only during the build. Terser preserves
function scopes so the serialized preview and format helpers remain standalone.
Generated wrappers use compact JSON; original file bytes are restored exactly.
Build dependencies are not needed to run the CLI or the generated files.
The browser app and generated wrappers remain standalone HTML files.

`npm run check` checks generated files, CLI help, and the regression suite.
Tests exercise the app, CLI and generated wrapper code using Node Web Crypto
and DOM stubs, including 10/25 MiB files. They do not establish full browser or
mobile compatibility.

### Release download

Publish a GitHub Release for a tag containing `.github/workflows/release.yml`.
The workflow checks out that tag, builds the browser app, runs `npm run check`,
and attaches the result as `staticseal.html`. The website's fixed download URL
automatically follows GitHub's latest stable release; prereleases do not replace it.
Every stable release must include this asset. Check that the workflow completes
successfully before announcing the download. Re-running it replaces the asset.

- [Technical notes and browser smoke tests](docs/technical-notes.md)
- [Working plan and validation history (German)](docs/staticseal-arbeitsplan.md)
- [Proposed website mode for developers (German)](docs/staticseal-website-konzept.md) — not implemented yet

## License

[MIT](LICENSE) © 2026 Daniel Deuter.
