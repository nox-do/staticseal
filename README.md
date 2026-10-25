# Staticseal

Package files or a static website into one standalone HTML file. Recipients open
it in their browser, with an optional passphrase. The browser creator works locally,
without an upload, account or backend. Prepared packages can be opened offline.

**[Open Staticseal](https://nox-do.github.io/staticseal/)** ·
[Download for offline use](https://github.com/nox-do/staticseal/releases/latest/download/staticseal.html) ·
[Try the examples](https://nox-do.github.io/staticseal/examples/) ·
[MIT license](LICENSE)

Use the browser to share a group of documents, an interactive HTML page or a
small website with linked subpages. Use the CLI to package a file or add packaging
to a reporting job.

## Browser: create and share a package

1. Choose files or a folder, or drop them into the selection area.
2. Review the selection and any resource warnings. Recognized HTML automatically
   enables **Display as a webpage after opening**.
3. Optionally enter a public opening title and a passphrase. The browser can
   generate a passphrase; leaving both passphrase fields empty creates an
   unencrypted package.
4. Select **Seal & download file** and share the resulting HTML file. For protected
   packages, share the passphrase separately.

The output is named `sealed_YYMMDD_HHmm.html`, using local time. The opening screen
shows the Staticseal logo and the optional title. Original filenames and types
appear only after opening; without a passphrase they remain recoverable from the
package. An opening title is always public.

To use this checkout directly, open the generated root `index.html` in a browser.
The published site and release may differ from this branch.

### What recipients can open

| Content                 | Behavior after opening                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Images and PDFs         | Display inline, with an individual download.                                                                                                     |
| Text, code and Markdown | Text preview, selected syntax highlighting or basic Markdown formatting. Previews stop at 128 KiB; downloads contain the complete file.          |
| Other file types        | Download the original file to open it in another application.                                                                                    |
| Multiple files          | Previous/next navigation, a file selector, individual downloads and **Download all (ZIP)**. One passphrase covers the collection.                |
| Prepared HTML website   | Display the page with its layout and JavaScript, including navigation to embedded subpages. Independent attachments remain in the file selector. |

Files keep their selection order. Folder selection and drag-and-drop preserve
relative paths. Entries can be removed before packaging.

### HTML pages and websites

Select the HTML together with its local resources. Staticseal recognizes a unique
root `index.html`/`index.htm`, or a single otherwise named HTML file. Ambiguous
entries remain separate files with a warning.

The browser prepares a working copy of the website:

- Embed selected images, icons, CSS imports, backgrounds and fonts.
- Follow links to selected HTML subpages, including nested directory indexes.
- Adapt internal links and anchors for navigation inside the package.
- Keep independent attachments separate; embedded pages and assets do not appear
  again in the file selector.

Relative paths follow the selected folder structure. The entry's top-level folder
also defines the root for `/...` paths; flat selections can match unique basenames.
Only selected resources are available. Missing or unsupported references produce
warnings; resources with remaining unrewritten references stay as separate entries.

**Download prepared HTML** saves the modified website before packaging. Disable
webpage display to preserve all original files and preview HTML as source text.
Other attachments retain their original bytes in either mode.

A single prepared website opens without the viewer header when there are no
recognized warnings or independent attachments. Otherwise, the header remains.
HTML with a header runs in an unsandboxed iframe: page styles stay separate, but
scripts can access the outer viewer.

Ordinary internal link clicks and anchors are supported. Modified clicks, new tabs
and link targets are not supported inside the prepared website. JavaScript
dependencies, frames and media are not bundled by the browser creator.
Script-driven navigation and server behavior are not emulated. CSS escapes,
`image-set()` and SVG `<use>` need manual checking.

## Examples

[Explore the examples](examples/index.html).

## CLI

Your agent can take it from here. Humans are still supported.

Below: the execution contract, working commands and the complete parameter
reference. All commands run from the repository root.

### At a glance

| Concern    | Contract                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command    | `node bin/self-encrypt.mjs --in <file-or-URL> --out <output.html> [options]`                                                                                  |
| Input      | One file, `file://` URL or HTTP(S) URL per invocation. Use the browser creator for multi-file collections and websites with linked subpages.                  |
| Output     | One standalone HTML file. Existing output is overwritten on success.                                                                                          |
| Access     | Encrypted by default, with an interactive passphrase prompt and confirmation. `--no-password` explicitly creates an unencrypted package.                      |
| Display    | File preview/download by default. `--html-page` runs self-contained HTML as a page. `--bundle` embeds report resources and implies `--html-page`.             |
| Automation | Supply the passphrase through standard input with `--stdin-password`, or explicitly choose `--no-password`. Do not rely on interactive prompts in a job.      |
| Result     | Exit code `0` on success, `1` on error. Success details go to stdout; errors and import warnings go to stderr. Import warnings can occur on a successful run. |

### Setup and help

Requires Node.js 20.19+, 22.13+, or 24 and later, as specified in
[package.json](package.json). From the repository root, install dependencies once:

```sh
npm ci
node bin/self-encrypt.mjs --help
```

Calling the CLI without arguments or with `-h` shows the same parameter help.

### Common workflows

**Protect a document.** The CLI asks for the passphrase twice:

```sh
node bin/self-encrypt.mjs --in report.pdf --out sealed.html
```

**Display existing self-contained HTML.** This preserves the input bytes and runs
the page, including its JavaScript, after opening:

```sh
node bin/self-encrypt.mjs --in report.html --out sealed.html --html-page
```

**Package an exported HTML report with separate resources:**

```sh
node bin/self-encrypt.mjs --in report.html --out sealed.html --bundle
```

`--bundle` embeds supported resources and enables webpage display. It also accepts
MHTML exports and direct HTTP(S) report URLs:

```sh
node bin/self-encrypt.mjs --in report.mht --out sealed.html --bundle
node bin/self-encrypt.mjs --in 'https://intranet/reports/export.html' \
  --out sealed.html --bundle
```

**Use a passphrase supplied by an automation job:**

```sh
node bin/self-encrypt.mjs --in report.html --out sealed.html \
  --bundle --stdin-password < /path/to/passphrase.txt
```

`--stdin-password` reads the passphrase from standard input and removes one final
line ending. It does not prompt or request confirmation. Empty passphrases are
rejected; use `--no-password` explicitly for an unencrypted package.

**Publish a page behind an opening button, without encryption:**

```sh
node bin/self-encrypt.mjs --in impressum.html --out sealed.html \
  --html-page --no-password --title "Impressum" \
  --button-label "Impressum öffnen"
```

### Parameter reference

Only `--in` and `--out` are required when creating a package. Values containing
spaces, font stacks and hex colors should be quoted in the shell.

#### Input, output and display

| Parameter               | Meaning                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--in <file\|URL>`      | Input file path, `file://` URL or HTTP(S) URL. A remote input is downloaded by the CLI. Directories and multi-file collections are not supported.                               |
| `--out <file>`          | Destination HTML file. Missing parent directories are created. An existing destination is overwritten on a successful run.                                                      |
| `--title <text>`        | Public browser title and opening-screen heading. Optional; original filenames remain inside the package.                                                                        |
| `--button-label <text>` | Custom opening-button text. Must be nonempty. The default is `Open sealed file`.                                                                                                |
| `--html-page`           | Display HTML as a webpage, including its scripts, rather than as source text. Requires HTML encoded as UTF-8 or BOM-marked UTF-16. Does not embed external resources by itself. |
| `--bundle`              | Prepare an HTML or MHTML report by embedding supported resources. Implies `--html-page` and may change the source HTML.                                                         |
| `--resource-root <dir>` | Allowed local resource directory for `--bundle`. Defaults to the input file's directory. Set a containing directory when referenced resources are in sibling folders.           |

#### Passphrase and payload

| Parameter               | Meaning                                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--stdin-password`      | Read the passphrase from standard input instead of prompting. Cannot be combined with `--no-password`.                                                                                   |
| `--no-password`         | Create an unencrypted package with an opening button. Contents and filenames are recoverable; the button only obstructs simple crawlers.                                                 |
| `--iterations <number>` | PBKDF2 iteration count for passphrase protection. Default: `210000`; minimum: `100000`. Higher values increase key-derivation time for both creation and opening.                        |
| `--chunk-size <number>` | Target maximum Base64 characters per payload chunk. Default: `65536`; minimum: `40`. This controls payload encoding, not streaming or the package size limit. Usually leave the default. |

#### Opening-screen appearance

These options style the opening screen; they do not restyle the opened document
or website. Omitted values use the default Staticseal appearance.

| Parameter                 | Meaning                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `--theme-bg <hex>`        | Background color.                                                                          |
| `--theme-text <hex>`      | Text and muted-text color.                                                                 |
| `--theme-accent <hex>`    | Button and focus color.                                                                    |
| `--theme-panel <hex>`     | Opening-card and input background color.                                                   |
| `--theme-font <stack>`    | Local font-family stack, for example `"Georgia, serif"`. Does not embed or download fonts. |
| `--theme-radius <length>` | Opening-card corner radius. A nonnegative value in `px`, `rem` or `em`, or `0`.            |

Colors accept `#RGB`, `#RGBA`, `#RRGGBB` or `#RRGGBBAA`, for example
`--theme-bg "#f5f7f5"`.

#### Help and compatibility

| Parameter            | Meaning                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `-h`, `--help`       | Show usage and parameter explanations. Also shown when called without arguments.                                                                 |
| `--version`          | Print the CLI version and exit.                                                                                                                  |
| `--private-filename` | Compatibility alias; original filenames and types are now always kept inside the package. Does not provide confidentiality without a passphrase. |
| `--minimal`          | Compatibility option; opening screens are always minimal. No additional effect.                                                                  |

### What CLI bundling supports

The report importer embeds referenced images, stylesheets and CSS imports, fonts,
classic scripts, media and HTML frames. MHTML exports use their archived resources.
This targets file-based exports from tools such as Excel, PowerShell, Quarto,
Jupyter, SAS and Plotly, plus direct HTML/MHTML export URLs.

Local resources must stay inside the allowed resource directory, including symlink
targets. Remote reports cannot read local files. HTTP requests follow redirects,
time out after 30 seconds and share the source budget described below.

The CLI does not automate login, execute scripts during capture, bundle JavaScript
module graphs or crawl linked pages. Legacy Excel framesets are converted with a
layout warning; sheet links, conditional Office markup and server-backed dashboards
need manual checking. Missing resources produce warnings on stderr and retain
their original URLs. Inspect the result offline before sharing.

CLI bundling keeps webpage display even when import warnings occur. The browser
creator's warning-dependent viewer header rule does not apply to the CLI.
Without `--bundle`, input bytes remain unchanged. The Node report importer is
separate from the browser creator and is not included in its standalone HTML.

## Protection and limits

### Access and trust

Passphrase-protected packages use AES-256-GCM with PBKDF2-SHA-256 key derivation.
A strong passphrase helps protect against offline guessing; there is no password
reset. Anyone with the package can attempt to guess its passphrase offline.

Without a passphrase, content and original filenames are recoverable. The opening
button only obstructs simple crawlers; `noindex` does not guarantee search exclusion.
Only open trusted content: HTML page mode executes the included JavaScript.

### Size and browser support

| Limit                        | Applies to                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **25 MiB final HTML**        | Browser and CLI output, including Base64, metadata, encryption and the embedded reader. Compressible sources can be much larger than the output, for example a 100 MiB report. |
| **128 MiB source data**      | Selected files in the browser, or input and loaded resources in the CLI.                                                                                                       |
| **128 MiB prepared content** | Content before gzip, including collection metadata. Imports also bound intermediate expansion.                                                                                 |
| **1,000 files/resources**    | Browser source files and CLI source resources.                                                                                                                                 |
| **128 KiB text preview**     | Text and Markdown display only; the complete file remains downloadable.                                                                                                        |

The browser warns from 5 MiB of source or prepared data and requests confirmation
above 10 MiB before reading large selections or expanding HTML resources. Files are
fully buffered. These thresholds and budgets are product limits, not measured
device capacities or caps on total RAM or HTML execution.

Readers validate gzip expansion and collection sizes against the 128 MiB bound.
Compressed packages require browser support for native gzip decompression.
**Download all (ZIP)** creates an uncompressed ZIP of the collection entries;
this is independent of gzip compression inside the HTML package.

## Development

```sh
npm ci
npm run build
npm run check
```

Edit `src/` for the app and readers, not the generated root `index.html` or
`src/reader-factories.mjs`. Edit example sources rather than generated
`sealed*.html` and ZIPs. See [Development](docs/development.md) for the architecture,
example build, format, tests, browser checks, size measurements and releases.

[MIT](LICENSE) © 2026 Daniel Deuter. Staticseal includes an MIT-licensed srcset parser
from SingleFile Core. See [Third-party notices](THIRD_PARTY.md) for provenance and licenses.
