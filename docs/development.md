# Development

## Source map

| Files                                                                         | Purpose                                                                   |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/app.html`, `limits.mjs`                                                  | Creator UI and browser limits                                             |
| `src/multi-file-ui.js`, `html-import.mjs`, `srcset-parser.mjs`, `website.mjs` | Staticseal selection, resource embedding and website navigation           |
| `src/creation.mjs`, `compression.mjs`                                         | Inner metadata, package parts and gzip selection                          |
| `src/format.mjs`, `crypto.mjs`, `gzip.mjs`                                    | Standalone format parser, AES-GCM decoder and bounded inflater            |
| `src/viewer.mjs`, `preview.mjs`, `collection.mjs`                             | File/page/collection previews, collection codec and store-only ZIP writer |
| `src/wrapper.mjs`, `reader.js`, `wrapper.html`, `wrapper.css`, `seal.svg`     | Opening screen and selected reader assembly                               |
| `bin/self-encrypt.mjs`, `bin/lib/`, `src/cli-theme.mjs`                       | CLI sources, report/MHTML import, limits and opening-screen themes        |

`npm run build` generates `index.html`, `src/logo.mjs`,
`src/wrapper-template.mjs` and `src/reader-factories.mjs`. Do not edit these outputs.
The release workflow publishes `index.html` as `staticseal.html`.

`scripts/build-examples.mjs` also builds the static guide's packages and source ZIPs
under `examples/fatseal/`; this existing URL is retained for published links. Edit its
`website/` sources and guide, not `demo-*.html` or ZIPs. `npm run check` verifies them;
gzip comparisons use decoded bytes so different Node/zlib versions remain valid.

`examples/jupyter/` includes an actual nbconvert export and its notebook/Python
sources. Follow its guide to rerun Python; `npm run build:examples` only rebuilds
the sealed report and source ZIP from the checked-in HTML. Checks verify the sealed
bytes against that HTML. Python and its report dependencies are not needed by the app
or the Node build. The example template omits unused MathJax/RequireJS/Mermaid;
it demonstrates static tables/charts, not those optional notebook features.

The browser app fetches no runtime dependencies. The build uses clean-css,
html-minifier-terser and Terser. CLI `--bundle` lazily loads Happy DOM, also used by
tests/examples, with script execution and automatic resource loading disabled.
The MIT srcset parser comes from
SingleFile Core commit `3fe510c2f28ecb552f125fe9849a8a0f0c2d3213`; no AGPL core code
is included. See `THIRD_PARTY.md`. The build embeds the compact full notice from
`third-party/srcset-parser.LICENSE.txt`; implementation comments stay out of the HTML.

## Package and reader

The browser creator and CLI return metadata plus separate length-prefix/header/content buffers.
The browser joins them for Web Crypto. The CLI encrypts the parts without making
another complete plaintext copy. Creation verifies bytes and metadata before output.

| Version | Access        | Content    |
| ------- | ------------- | ---------- |
| 2 / 3   | Passphrase    | Raw / gzip |
| 4 / 5   | No passphrase | Raw / gzip |

All use `encoding: "metadata"`. The decoded body starts with a four-byte big-endian
JSON-header length, followed by UTF-8 JSON (`filename`, `contentType`, and for gzip
`originalSize`), then file bytes or gzip data. The header limit is 65,536 bytes.
Gzip is tried from 4 KiB and selected only when the complete output HTML is smaller.
The inflater rejects output beyond the declared size or its 128 MiB safety ceiling.
Creator policy lives in `limits.mjs`: 128 MiB sources, 128 MiB prepared content
(including importer intermediates), and 25 MiB final UTF-8 HTML. The final check
runs before download/write, after the reader, Base64, title and CLI theme are added.
Source/prepared ceilings bound full-buffer work; they are not RAM guarantees.
HTML DOMs, decoded images and scripts can use substantially more memory. Native
gzip still runs after reading/preparation; streaming creation is separate work.

Passphrase mode uses PBKDF2-SHA256 (browser default: 210,000 rounds), AES-256-GCM,
a 16-byte salt, 12-byte IV and 16-byte tag. AAD order is fixed:
`v, alg, kdf, iterations, encoding, filename, contentType, access, unlockKey, salt, iv, display`.
Undefined fields are omitted. Legacy public filename/type and `unlockKey` positions
remain readable/authenticated; current creators never emit them.

`display` is absent for files, `page` for HTML and `collection` for collections.
The collection's inner v1 container uses a four-byte JSON-header length, entries
with filename/type/offset/size and optional page flag, then concatenated file bytes.
It validates paths, unique names, contiguous offsets, lengths and the 128 MiB prepared-content limit.
Only the creator includes packing code; collection readers include decoding and ZIP.

Each output embeds only its selected viewer, crypto only when encrypted, and the
inflater only for gzip. Creators pass a private file inventory to the wrapper and
compression-size calculation; this inventory is not added to public payload metadata.
`planReader(display, files)` resolves that inventory into viewer source, CSS and the
viewer code. `renderWrapper` assembles that plan with the payload-specific
crypto/gzip reader and opening text. Compression candidates reuse one plan; callers
can pass it explicitly, while existing callers get automatic planning. The plan is
creator-only and contains neither the input inventory nor a runtime module registry.
Image, PDF and text renderers, Markdown, highlighting and text styles are selected
from that inventory. Callers without an inventory retain the full file viewer.
Page mode omits viewer CSS. A single webpage with warnings retains the existing
collection format and validation but uses a header/frame/download renderer without
ZIP or collection navigation. Multiple independent entries retain both. Frame rendering is shared between single-page
and collection viewers, and omitted entirely from collections without webpages.
Serialized factories must work without module-scope state.
Do not enable scope hoisting, function inlining or property mangling without checking
that boundary. Template replacements use callbacks; payload JSON escapes `<`.

HTML alone replaces the opening document and runs with its origin/permissions.
Collection HTML deliberately uses unsandboxed iframes for direct DOM access
and internal link handling. CSS/layout stay separate; scripts can access the outer
viewer, so imported HTML is treated as executable content. Linked pages are traversed
once with a shared resource cache. Multiple pages become one standalone website with
a page table, shared data URLs and hash-based navigation. A fresh frame
per page prevents stale JavaScript globals; browser Back follows website routes.
Collection and website `srcdoc` frames intercept local fragment links and scroll
in place so these links cannot reopen the outer package inside the preview.
Embedded pages/assets leave the collection navigation; incomplete dependencies stay
separate with warnings. Independent attachments keep their individual downloads.
Only a single website without recognized warnings hides the viewer header.
Browser resource import never fetches URLs; prepared CSS/data URLs are cached, substitutions run sequentially,
and obsolete selection checks abort. Intermediate and final size checks are separate.
Warnings do not make incomplete HTML self-contained; inspect the prepared result.

CLI `--bundle` resolves local/HTTP resources into virtual selected files before using
the shared HTML importer. It additionally embeds classic scripts, media and frame
documents; MHTML uses archived MIME parts without network fallback. Local paths are
checked against a real resource root; remote reports cannot read local files.
The ordinary CLI path preserves input bytes and never loads the DOM parser.

## Tests

```sh
npm run check
```

Runs ESLint, Prettier's format check, generated-file checks, CLI help and Node tests.
GitHub runs the same command on pull requests and pushes to `main`.
Test files are grouped by feature;
shared fixtures live in `test/helpers/`. Historical v2–v5 packages are fixed fixtures.

The integration matrix covers actual browser-app and CLI output across both access
modes, raw/gzip and file/page display. Readers run unchanged in a VM with DOM stubs
and creator-only APIs removed. These checks verify bytes and isolation, not rendering.
Targeted tests cover malformed data, authenticated fields, encodings, previews,
selection state, package limits, original-buffer use and one KDF call per creation.
Happy DOM tests cover HTML-import regressions, graph caching and cancellation.
CLI report tests also cover local folders/frames, HTTP redirects, MIME decoding,
resource caching and local path boundaries; HTTP tests bind only to loopback.
Keep unique failure cases; do not repeat the full integration matrix in feature tests.

Use `npm run lint` for lint only and `npm run format` to format sources.
Generated files, HTML templates with exact build markers, compact wrapper CSS,
third-party code and fixed legacy fixtures are excluded from formatting.
ESLint still checks the app's inline JavaScript; injected scopes are declared in
`eslint.config.mjs`. These tools are development dependencies only. Tooling requires
Node.js `^20.19.0 || ^22.13.0 || >=24`; the standalone apps need no Node.js.
Compare `measure:size` reports before and after formatting/build changes; source
readability must not silently increase the shipped app or reader sizes.

For real-browser checks:

```sh
npm run test:browser
python3 -m http.server 8765 --bind 127.0.0.1 --directory /tmp/staticseal-browser-smoke
```

Open `http://localhost:8765/` and run the linked suites. `readers.html` checks
specialized images, Markdown/highlighting, a single framed page with anchors and
collections with and without a webpage. `smoke.html` checks HTML parsing, previews,
page CSS/scripts and interactions. `selection-smoke.html` checks folder paths,
resource rendering, navigation, ZIP, encryption and import warnings. Product scripts are unchanged by these harnesses.
Downloads are intercepted as Blobs. The selection/import page exposes its ZIP evidence in
`#test-zip` for external extraction/CRC checks.

Validated locally in Chrome. Native OS pickers, download-manager behavior,
Firefox/Safari/mobile and measured peak memory remain unverified. An import fixture
with external URLs produced no requests in Chrome's network log; this is not a
cross-browser guarantee or a claim that opened HTML cannot access the network.

Targeted Chrome check (2026-10-23, local HTTP fixtures): prepared multi-page HTML
supports ordinary cross-page clicks and browser Back. Cmd-click and `target="_blank"`
currently navigate inside the viewer; a native middle-click opens the shell's start
page instead of the linked subpage. These remain unsupported, not fixed by the
normal-click tests. CLI-bundled frame fragment links scroll within their frame
without reopening the enclosing report. These targeted checks do not establish
new-tab behavior for encrypted packages, collections, or other browsers.

## Footprint and releases

```sh
npm run --silent measure:size > /tmp/staticseal-size.json
```

Rebuilds and reports actual UTF-8 bytes/hashes for the app and eight CLI readers.
Fixtures cover raw/gzip, passphrase/no passphrase and file/page. `htmlBytes` is the
complete file; `wrapperBytes = htmlBytes - payloadJsonBytes`. Binary package size is
the decoded payload including metadata/tag, not additional HTML bytes. These are
file sizes, not HTTP gzip transfer sizes. `viewerProfiles` additionally reports
deterministic raw, no-passphrase envelope overhead for the selected viewer types,
excluding payload JSON. The report records inputs, options,
revision and runtime; compare like-for-like runs with the same lockfile and Node/zlib.
Old work plans and one-off validation reports are available in Git history.

A published GitHub Release triggers `.github/workflows/release.yml`: install locked
dependencies, build, check, then attach `staticseal.html`. The README's latest-release
URL follows stable releases. Verify the workflow before announcing a release.
