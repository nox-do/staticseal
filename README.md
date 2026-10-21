# Staticseal

Package a file or a complete static HTML page into one standalone HTML file.
Recipients open it in their browser through a button or a passphrase screen.
Send it as an attachment or host it on your website; no backend is required.

**[Open Staticseal](https://nox-do.github.io/staticseal/)** · [MIT license](LICENSE)

- **Share a file:** open a preview or download the original after unlocking.
- **Publish a static page:** replace the opening screen with the original HTML,
  including its layout and JavaScript. Optionally protect access with a passphrase,
  or use a simple opening button to obstruct basic text crawlers.

## Publish a static HTML page

For example, you can package a self-contained `impressum.html` so visitors first
see your heading and an **Impressum öffnen** button. Clicking it displays the full
original page. With `--no-password`, visitors do not need a passphrase:

```sh
node bin/self-encrypt.mjs --in impressum.html --out impressum_sealed.html \
  --html-page --no-password --minimal --title "Impressum" \
  --button-label "Impressum öffnen"
```

Host the generated file and link to it, for example
`<a href="impressum_sealed.html">Impressum</a>`. Keep CSS, scripts and images
embedded in the source HTML for a fully standalone result. Staticseal does not
collect dependencies from a website or bundle multiple pages.

`--minimal` keeps the Staticseal logo, heading and opening button, plus the
passphrase field if used. `--button-label` changes the button text independently.
Optional theme parameters can match the opening screen to your site's colors
and typography; examples are below. To require a passphrase, omit `--no-password`.

The button is a barrier for simple crawlers, not confidential access control.
The original text is encoded rather than directly present in the HTML source;
crawlers that execute JavaScript or decode the package can still read it.
Generated pages request `noindex,nofollow,noarchive`. These mechanisms do not
guarantee exclusion from search engines or establish GDPR or other legal compliance.

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

For HTML files, **Display as a webpage after opening** appears below the file
picker. It is off by default and resets when you select another file. Turn it on
to replace the lock screen with the original self-contained page, including its
CSS and JavaScript. Passphrase protection and automatic gzip still work in this
mode. With the switch off, HTML remains an escaped source preview.

Files from 4 KiB up to 25 MiB are automatically tried with gzip before packaging.
Compression is used only when the complete HTML package, including its unpacker,
is smaller. This works for any file type and restores the original bytes exactly.
Uncompressed packages contain no gzip unpacker. The result shows original and
HTML package sizes. The CLI tries compression up to its experimental 128 MiB original-file limit.
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
Staticseal packages individual files, including self-contained HTML pages. It does
not collect dependencies or bundle multi-file websites.

## Use the CLI

Requires Node.js 20 or later. From a checkout of this repository:

```sh
node bin/self-encrypt.mjs --in report.pdf --out report_sealed.html
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

To open a self-contained HTML page as a webpage instead of showing source code:

```sh
node bin/self-encrypt.mjs --in page.html --out page_sealed.html --html-page
```

For a compact opening screen, add `--minimal`: the logo, heading and opening
button remain, along with the passphrase field when protected. Introductory copy
and the initial no-passphrase message are omitted. Progress and errors still
appear when opening. The bottom explanatory note is omitted in all new packages.
Use `--button-label` independently to set the button text.

Optional CLI theme parameters customize only the opening screen. They work with
or without a passphrase and in both file and webpage modes:

```sh
node bin/self-encrypt.mjs --in page.html --out page_sealed.html --html-page \
  --theme-bg "#181818" --theme-text "#eeeeee" --theme-accent "#e98663" \
  --theme-panel "#252525" --theme-font "Georgia, serif" --theme-radius "8px"
```

All parameters are independent and optional; omitted settings keep their defaults.
Colors accept hex notation (`#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`).
`--theme-font` accepts a simple font-family stack with Latin names (quotes allowed),
using fonts available on the recipient's device; it does not embed or load fonts.
`--theme-radius` sets the card rounding in `px`, `rem`, `em`, or `0`.
The original webpage, file preview, payload bytes and encryption are unaffected.
Theme settings are visible before unlocking. Without theme parameters the output
has no additional theme CSS. The browser creator's interface is unchanged.

Add `--no-password` to omit passphrase protection. Page mode supports UTF-8 and
BOM-marked UTF-16 HTML. It runs the page's scripts with the wrapper's origin and
browser permissions. External resources are not bundled; embed everything needed
for offline use. The `noindex,nofollow,noarchive` hint is retained after opening.

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
- **CLI sizes are experimental.** Maximum 128 MiB original, 25 MiB binary package
  (including metadata, length prefix and authentication tag), and 35 MiB final HTML.
  Oversized results are rejected before writing. Creation still uses full buffers;
  recipient browser memory and large HTML page execution are not validated.
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
unpacker, `src/viewer.mjs` for the separate file/page renderers,
`src/creation.mjs` for shared creator metadata and package preparation,
`src/browser-limits.mjs` for browser-only creator limits,
`src/cli-theme.mjs` for CLI-only theme validation, and `src/seal.svg`
for the logo.
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

`npm run --silent measure:size` rebuilds the app and reports its UTF-8 size plus
eight real CLI-generated readers as JSON. Fixed fixtures cover passphrase/no
passphrase, raw/gzip and file/page modes. See the [measurement method and recorded
baseline](docs/size-measurement.md) for options, byte definitions and limitations.

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
