# Staticseal

Package files or a static HTML page into one standalone HTML file. Recipients open
it in their browser, with an optional passphrase. No upload, account or backend.

**[Open Staticseal](https://nox-do.github.io/staticseal/)** ·
[Download for offline use](https://github.com/nox-do/staticseal/releases/latest/download/staticseal.html) ·
[MIT license](LICENSE)

## Browser

1. Choose a file.
2. Enter and repeat a passphrase, generate one, or leave both fields empty.
3. Select **Seal & download file**. Share the passphrase separately.

The output is named `sealed_YYMMDD_HHmm.html`, using local time. Original filenames
and types stay inside the package and reappear in previews and downloads.

Images display inline; PDFs offer a preview button; text and Markdown have limited
formatting. Text previews stop at 128 KiB; downloads contain the complete original.
Unknown formats are download-only. For HTML, enable **Display as a webpage after
opening** to restore its layout and scripts instead of showing escaped source.
Staticseal expects that HTML to be self-contained.

## FatSeal experiment

This branch also builds `fatseal.html`, a larger offline creator:

- Select multiple files or a folder with subfolders; remove or reorder entries.
- Open collections with previous/next navigation, individual downloads and a ZIP
  download of all entries. One passphrase covers the collection.
- Automatically recognize a unique `index.html`/`index.htm`, or a single otherwise
  named HTML file. Ambiguous entries remain separate files with a warning.
- Embed selected images, icons, CSS imports, backgrounds and fonts. Only selected
  resources are available; missing or unsupported references produce warnings.
- Download the prepared HTML separately. It is a modified working copy; other
  files retain their original bytes. Disable webpage display to keep all originals.

Relative paths follow the selected folder structure; the entry's top-level folder
also defines the root for `/...` paths. Flat selections can match unique basenames.
Resources with remaining unrewritten references stay available as separate entries.

JavaScript dependencies, linked HTML subpages, frames and media are not bundled.
CSS escapes, `image-set()` and SVG `<use>` need manual checking. An HTML entry with
attachments runs in a sandboxed iframe, which may restrict some functionality.
FatSeal is experimental and is not included in the release download above.

## CLI

Requires Node.js 20+. From this checkout:

```sh
node bin/self-encrypt.mjs --in report.pdf --out sealed.html
```

The CLI prompts for the passphrase. For automation, use `--stdin-password`.
To publish a self-contained page behind an opening button:

```sh
node bin/self-encrypt.mjs --in impressum.html --out sealed.html \
  --html-page --no-password --minimal --title "Impressum" \
  --button-label "Impressum öffnen"
```

Omit `--no-password` to require a passphrase. `--title` and `--button-label` are
public opening-screen text, independent of the original filename. The old
`--private-filename` flag remains a compatibility alias; privacy is always enabled.

Optional `--theme-bg`, `--theme-text`, `--theme-accent` and `--theme-panel` accept
hex colors; `--theme-font` accepts a local font-family stack; `--theme-radius`
accepts `px`, `rem`, `em` or `0`. Run `node bin/self-encrypt.mjs --help` for options.

## Limits

- A strong passphrase protects against offline guessing. There is no password reset.
- Without a passphrase, contents and original names are recoverable. The button
  only obstructs simple crawlers. `noindex` does not guarantee search exclusion.
- Only open trusted content. HTML page mode executes the page's JavaScript.
- Browser limit: 25 MiB; warning from 5 MiB, confirmation above 10 MiB. FatSeal also
  limits selections to 1,000 files and 25 MiB of prepared content including metadata.
- CLI limits: 128 MiB input, 25 MiB binary package, 35 MiB final HTML.
- These are product limits, not measured device capacities. Compressed output
  requires browser support for native gzip decompression.

## Development

```sh
npm ci
npm run build
npm run check
```

Edit `src/`, not the generated HTML. See [Development](docs/development.md) for
architecture, format, test coverage, browser checks, size measurements and releases.

[MIT](LICENSE) © 2026 Daniel Deuter. FatSeal includes an MIT-licensed srcset parser
from SingleFile Core; its attribution is preserved in the source and built HTML.
