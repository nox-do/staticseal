# CLI reference

Package one file or HTML/MHTML report per invocation. For collections and websites
with linked HTML subpages, use the [browser creator](https://nox-do.github.io/staticseal/).

Run commands from the extracted repository root. Exit code `0` indicates success;
`1` indicates an error. Status goes to stdout; errors and import warnings go to
stderr. Warnings can occur on a successful run.

## Installation

Requires Node.js 24 LTS, or a supported Node.js 20.x (20.19+) or 22.x (22.13+)
release; see [package.json](../package.json) for the exact engines range. With Node.js
and npm installed, download the release source archive in a new working directory:

```sh
curl -fL https://github.com/nox-do/staticseal/archive/refs/tags/v2.0.0.tar.gz -o staticseal-2.0.0.tar.gz
tar -xzf staticseal-2.0.0.tar.gz
cd staticseal-2.0.0
npm ci --omit=dev
node bin/self-encrypt.mjs --version
node bin/self-encrypt.mjs --help
```

**No build is needed.** The release includes the generated reader modules.
`npm ci --omit=dev` installs only runtime dependencies, needed for `--bundle`,
without the development tools. Download the whole source archive: the small
`bin/self-encrypt.mjs` entry script imports other project files and cannot run alone.

Without `--bundle`, the CLI needs no npm dependencies. For browser collections and
websites with linked subpages, use the browser creator; the CLI does not accept a
directory as input or crawl linked pages.

Calling the CLI without arguments or with `-h` shows the same parameter help.

## Common workflows

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

## Parameter reference

Only `--in` and `--out` are required when creating a package. Values containing
spaces, font stacks and hex colors should be quoted in the shell.

### Input, output and display

| Parameter               | Meaning                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--in <file\|URL>`      | Input file path, `file://` URL or HTTP(S) URL. A remote input is downloaded by the CLI. Directories and multi-file collections are not supported.                               |
| `--out <file>`          | Destination HTML file. Missing parent directories are created. An existing destination is overwritten on a successful run.                                                      |
| `--title <text>`        | Public browser title and opening-screen heading. Optional; original filenames remain inside the package.                                                                        |
| `--button-label <text>` | Custom opening-button text. Must be nonempty. The default is `Open sealed file`.                                                                                                |
| `--html-page`           | Display HTML as a webpage, including its scripts, rather than as source text. Requires HTML encoded as UTF-8 or BOM-marked UTF-16. Does not embed external resources by itself. |
| `--bundle`              | Prepare an HTML or MHTML report by embedding supported resources. Implies `--html-page` and may change the source HTML.                                                         |
| `--resource-root <dir>` | Allowed local resource directory for `--bundle`. Defaults to the input file's directory. Set a containing directory when referenced resources are in sibling folders.           |

### Passphrase and payload

| Parameter               | Meaning                                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--stdin-password`      | Read the passphrase from standard input instead of prompting. Cannot be combined with `--no-password`.                                                                                   |
| `--no-password`         | Create an unencrypted package with an opening button. Contents and filenames are recoverable; the button only obstructs simple crawlers.                                                 |
| `--iterations <number>` | PBKDF2 iteration count for passphrase protection. Default: `210000`; minimum: `100000`. Higher values increase key-derivation time for both creation and opening.                        |
| `--chunk-size <number>` | Target maximum Base64 characters per payload chunk. Default: `65536`; minimum: `40`. This controls payload encoding, not streaming or the package size limit. Usually leave the default. |

### Opening-screen appearance

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

### Help and compatibility

| Parameter            | Meaning                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `-h`, `--help`       | Show usage and parameter explanations. Also shown when called without arguments.                                                                 |
| `--version`          | Print the CLI version and exit.                                                                                                                  |
| `--private-filename` | Compatibility alias; original filenames and types are now always kept inside the package. Does not provide confidentiality without a passphrase. |
| `--minimal`          | Compatibility option; opening screens are always minimal. No additional effect.                                                                  |

## What bundling supports

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

## Limits

The final HTML is limited to 25 MiB, including the reader and encoded payload.
Sources and prepared content are limited to 128 MiB, with at most 1,000 source
resources. These limits do not bound peak memory. Text previews are limited to
128 KiB; downloads retain the full file. See [protection and limits](../README.md#protection-and-limits).
