# Staticseal

Turn a file into a self-contained, encrypted HTML file. Share it as an attachment
or host it on a static website. Recipients unlock it locally in their browser.

**[Open Staticseal](https://nox-do.github.io/staticseal/)** · [MIT license](LICENSE)

## Use in your browser

1. Choose a file.
2. Enter and repeat a passphrase.
3. Select **Seal & download file**.

Your file and passphrase stay in your browser. No upload, account, or backend is
required. You can also save `index.html` and use it offline.

Under **Advanced options**, you can generate a passphrase, encrypt the original
filename and file type, or adjust the PBKDF2 settings. Share the passphrase
separately from the generated file.

After unlocking, PNG, JPEG, GIF and WebP display inline. PDFs offer an optional
preview after confirmation. HTML, SVG and other formats are download-only.
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

- **Use a strong passphrase.** Files use AES-256-GCM and PBKDF2-SHA256 with
  authenticated metadata. Anyone with the output can attempt offline password
  guesses. There is no password reset or server-side access control.
- **Without a passphrase, contents are not private.** Leaving both browser fields
  blank, or using `--no-password`, embeds the unlock key. This only obstructs simple
  crawlers; anyone with the file can recover its contents.
- **Names are public by default.** Enable private filenames to encrypt the name
  and MIME type too. File size remains observable. Publish only the protected
  output if the original should stay private.
- **Browser sizes are provisional.** Warning from 5 MiB, confirmation above 10 MiB,
  maximum 25 MiB. These are product limits, not validated browser capacities.
  The CLI has no equivalent cap; recipient browsers still have memory limits.
- **Only open trusted content.** Encryption and previews do not scan for malware.

## Development

```sh
npm run build
npm run check
```

Edit `src/app.html` for the browser UI, `src/wrapper.mjs` for generated wrappers,
`src/format.mjs` for shared format helpers, and `src/seal.svg` for the logo.
The build generates `index.html` and `src/logo.mjs`; do not edit them directly.
The browser app and generated wrappers remain standalone HTML files.

`npm run check` checks generated files, CLI help, and the regression suite.
Tests exercise the app, CLI and generated wrapper code using Node Web Crypto
and DOM stubs, including 10/25 MiB files. They do not establish full browser or
mobile compatibility.

- [Technical notes and browser smoke tests](docs/technical-notes.md)
- [Working plan and validation history (German)](docs/staticseal-arbeitsplan.md)
- [Proposed website mode for developers (German)](docs/staticseal-website-konzept.md) — not implemented yet

## License

[MIT](LICENSE) © 2026 Daniel Deuter.
