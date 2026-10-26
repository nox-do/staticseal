# Staticseal

Package files or a static website into one standalone HTML file. Recipients open
it in a browser, optionally with a passphrase. No account, upload or backend is
needed. The browser creator and prepared packages work offline.

**[Open Staticseal](https://nox-do.github.io/staticseal/)** ·
[Download for offline use](https://github.com/nox-do/staticseal/releases/latest/download/staticseal.html) ·
[Try the examples](https://nox-do.github.io/staticseal/examples/)

The browser creator is about **62 kB**. Use it for individual files, collections
and small websites. Use the CLI for automated file packaging and exported reports.

## In the browser

1. Choose files or a folder, or drop them into the page.
2. Check any resource warnings and optionally add a title and passphrase.
3. Select **Seal & download file** and share the resulting HTML. Share a passphrase
   separately from the package.

Recipients can preview images, PDFs, text and Markdown, or download the original
files. Collections also offer a ZIP download. No Staticseal installation is needed
to open a package; use a modern browser with JavaScript enabled.

For a website, select its folder with the HTML, CSS, images and other assets.
Staticseal recognizes a unique root `index.html`/`index.htm` or a single HTML file,
embeds supported resources and follows links to selected HTML subpages. Independent
attachments remain separately downloadable. If the entry page is ambiguous,
files are packaged individually instead.

Only selected resources can be embedded. Check warnings and open the result offline
before sharing. Dynamic dependencies, external scripts, frames and media are not
bundled by the browser creator. Ordinary page links and anchors work; new-tab and
modified-click navigation to embedded subpages are not supported. Server behavior
is not emulated.

Webpage preparation changes the HTML. Disable **Display as a webpage after opening**
to retain the original files and show HTML as source text. **Download prepared HTML**
lets you inspect the modified website before packaging it.

## CLI quick start

Use Node.js 24 LTS, or supported Node.js 20.x (20.19+) / 22.x (22.13+).
Download the complete release source in a new working directory:

```sh
curl -fL https://github.com/nox-do/staticseal/archive/refs/tags/v2.0.0.tar.gz -o staticseal-2.0.0.tar.gz
tar -xzf staticseal-2.0.0.tar.gz
cd staticseal-2.0.0
npm ci --omit=dev
node bin/self-encrypt.mjs --version
```

**No build is needed.** The small CLI entry script imports other repository files;
it cannot run alone. `npm ci --omit=dev` installs only runtime dependencies for
`--bundle`. Without `--bundle`, no npm dependencies are required.

Protect a document; the CLI prompts for a passphrase:

```sh
node bin/self-encrypt.mjs --in report.pdf --out sealed.html
```

Package an HTML report with its assets, without encryption:

```sh
node bin/self-encrypt.mjs --in report/index.html --out sealed.html --bundle --no-password
```

The CLI takes one file or URL, not a directory. `--bundle` includes supported
referenced resources and frames, but does **not** crawl links to HTML subpages or
create multi-file collections. Use the browser creator for those cases.

For automation, specify `--stdin-password` or `--no-password` to avoid interactive
prompts. Existing output files are overwritten on success. Import warnings can
occur even when the command succeeds.

See the [CLI reference](docs/cli.md) for all options, passphrase input, MHTML,
remote reports and themes. Agents can start with [llms.txt](llms.txt).

## Protection and limits

- **Without a passphrase, there is no confidentiality.** Content and filenames are
  recoverable; the opening button only deters simple crawlers.
- Passphrase protection uses AES-256-GCM with PBKDF2-SHA-256. Choose a strong
  passphrase: offline guessing is possible and there is no password reset.
- An optional opening title is public, even in an encrypted package.
- Open only trusted HTML: webpage display runs its JavaScript.
- The final HTML is limited to **25 MiB**. Sources and prepared content are limited
  to **128 MiB**, with at most **1,000 files/resources**. Large inputs may use
  substantially more memory; these are not device-capacity guarantees.

## Development

See [Development](docs/development.md) for setup, source files, builds and tests.

[MIT](LICENSE) © 2026 Daniel Deuter. See [third-party notices](THIRD_PARTY.md).
