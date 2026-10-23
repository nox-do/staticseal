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

Try the [guided example](examples/fatseal/index.html): working packages, source ZIPs
and a practical explanation of file/folder selection, unused files and warnings.

The [Jupyter example](examples/jupyter/index.html) includes notebook/Python sources,
an HTML export, a sealed offline report and the commands to reproduce the workflow.

- Select multiple files or a folder with subfolders; remove entries or reorder independent files. Recognized websites use their detected start page.
- Both pickers share a drop zone that also accepts files and folders, preserving nested paths.
- Open collections with previous/next navigation, individual downloads and a ZIP
  download of all entries. One passphrase covers the collection.
- Automatically recognize a unique root `index.html`/`index.htm`, or a single otherwise
  named HTML file. Ambiguous entries remain separate files with a warning.
- Embed selected images, icons, CSS imports, backgrounds and fonts. Only selected
  resources are available; missing or unsupported references produce warnings.
- Follow links to selected HTML subpages, including nested directory indexes.
  Internal links and anchors support normal clicks in the prepared website.
  Modified clicks, new tabs and link targets are not supported. Embedded pages and assets
  do not appear again in the collection's file navigation; independent attachments do.
- Download the prepared HTML separately. It is a modified working copy; other
  files retain their original bytes. Disable webpage display to keep all originals.

In FatSeal, the viewer header disappears only for one prepared website without recognized
warnings or independent attachments. Warnings retain the header even for one entry.

Relative paths follow the selected folder structure; the entry's top-level folder
also defines the root for `/...` paths. Flat selections can match unique basenames.
Resources with remaining unrewritten references stay available as separate entries.

JavaScript dependencies, frames and media are not bundled. Script-driven navigation
and server behavior are not emulated.
CSS escapes, `image-set()` and SVG `<use>` need manual checking. An HTML entry with
attachments runs in an iframe without a sandbox. Its scripts can access the outer
viewer; the iframe keeps page styles separate from navigation and downloads.
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

For exported reports, `--bundle` embeds static resources and implies `--html-page`:

```sh
node bin/self-encrypt.mjs --in report.html --out sealed.html --bundle
node bin/self-encrypt.mjs --in 'https://intranet/reports/export.html' --out sealed.html --bundle
node bin/self-encrypt.mjs --in report.mht --out sealed.html --bundle
```

Paths and `file://` URLs work locally. HTML bundling loads referenced images,
stylesheets/imports, fonts, classic scripts, media and HTML frames; MHTML exports
are decoded using their archived resources. Local resources must remain inside the
report directory, including symlink targets; use `--resource-root /path/to/export`
when the report references sibling directories. Remote reports cannot read local files.
Network requests follow redirects, time out after 30 seconds and share a 128 MiB
source budget; prepared HTML has a separate 128 MiB working limit and 1,000 resources are allowed.

This targets file-based exports from Excel, PowerShell, Quarto, Jupyter, SAS and
Plotly, plus direct HTML/MHTML export URLs from report servers. It does not automate
login, execute scripts during capture, bundle module graphs or crawl linked pages.
Legacy Excel framesets are converted with a layout warning; sheet links, conditional
Office markup and server-backed dashboards need manual checking. Missing resources
produce warnings on stderr and keep their original URLs; inspect the result offline.
The CLI keeps webpage display even with import warnings; the warning-dependent
header rule applies only to FatSeal.
Without `--bundle`, source bytes remain unchanged. These additions are CLI-only;
neither browser app includes the importer or its Node HTML parser.

Optional `--theme-bg`, `--theme-text`, `--theme-accent` and `--theme-panel` accept
hex colors; `--theme-font` accepts a local font-family stack; `--theme-radius`
accepts `px`, `rem`, `em` or `0`. Run `node bin/self-encrypt.mjs --help` for options.

## Limits

- A strong passphrase protects against offline guessing. There is no password reset.
- Without a passphrase, contents and original names are recoverable. The button
  only obstructs simple crawlers. `noindex` does not guarantee search exclusion.
- Only open trusted content. HTML page mode executes the page's JavaScript.
- Transport limit for both browser apps and the CLI: **25 MiB of final HTML**,
  including Base64, metadata, encryption and the embedded reader. Compressible
  sources can be much larger (for example, a 100 MiB report).
- Separate working limits: 128 MiB of source data and 128 MiB of prepared content
  before gzip, including collection metadata. Imports also bound intermediate
  expansion; FatSeal and the CLI allow at most 1,000 source files/resources.
- Browser memory warning from 5 MiB of source or prepared data; confirmation above
  10 MiB before reading large selections or expanding HTML resources. These
  thresholds describe work, not transport size. Files are fully buffered today.
- Readers limit gzip expansion to 128 MiB and validate the declared size. Collection
  readers also enforce 128 MiB. These bounds do not cap total RAM or HTML execution.
- These are product limits, not measured device capacities. Compressed output
  requires browser support for native gzip decompression. Download all (ZIP) uses
  uncompressed ZIP entries as a file envelope, independently of transport gzip.

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
