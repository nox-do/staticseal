# Development

## Source map

| Files                                                                     | Purpose                                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/app.html`, `browser-limits.mjs`                                      | Small creator UI and browser limits                                       |
| `src/multi-file-ui.js`, `html-import.mjs`, `srcset-parser.mjs`            | FatSeal selection and local resource embedding                            |
| `src/creation.mjs`, `compression.mjs`                                     | Inner metadata, package parts and gzip selection                          |
| `src/format.mjs`, `crypto.mjs`, `gzip.mjs`                                | Standalone format parser, AES-GCM decoder and bounded inflater            |
| `src/viewer.mjs`, `preview.mjs`, `collection.mjs`                         | File/page/collection previews, collection codec and store-only ZIP writer |
| `src/wrapper.mjs`, `reader.js`, `wrapper.html`, `wrapper.css`, `seal.svg` | Opening screen and selected reader assembly                               |
| `bin/self-encrypt.mjs`, `src/cli-theme.mjs`                               | CLI creation, limits and opening-screen themes                            |

`npm run build` generates `index.html`, `fatseal.html`, `src/logo.mjs`,
`src/wrapper-template.mjs` and `src/reader-factories.mjs`. Do not edit these outputs.
The release workflow still publishes only `index.html` as `staticseal.html`.

No runtime dependencies are fetched. The build uses clean-css, html-minifier-terser
and Terser; Happy DOM is only a test dependency. The MIT srcset parser comes from
SingleFile Core commit `3fe510c2f28ecb552f125fe9849a8a0f0c2d3213`; no AGPL core code
is included. Preserve its license in both source and FatSeal output.

## Package and reader

Both creators return metadata plus separate length-prefix/header/content buffers.
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

Passphrase mode uses PBKDF2-SHA256 (browser default: 210,000 rounds), AES-256-GCM,
a 16-byte salt, 12-byte IV and 16-byte tag. AAD order is fixed:
`v, alg, kdf, iterations, encoding, filename, contentType, access, unlockKey, salt, iv, display`.
Undefined fields are omitted. Legacy public filename/type and `unlockKey` positions
remain readable/authenticated; current creators never emit them.

`display` is absent for files, `page` for HTML and `collection` for collections.
The collection's inner v1 container uses a four-byte JSON-header length, entries
with filename/type/offset/size and optional page flag, then concatenated file bytes.
It validates paths, unique names, contiguous offsets, lengths and the 25 MiB limit.
Only the creator includes packing code; collection readers include decoding and ZIP.

Each output embeds only its selected viewer, crypto only when encrypted, and the
inflater only for gzip. Serialized factories must work without module-scope state.
Do not enable scope hoisting, function inlining or property mangling without checking
that boundary. Template replacements use callbacks; payload JSON escapes `<`.

HTML alone replaces the opening document and runs with its origin/permissions.
Collection HTML uses an iframe sandbox without `allow-same-origin`. Resource import
never fetches URLs; prepared CSS/data URLs are cached, substitutions run sequentially,
and obsolete selection checks abort. Intermediate and final size checks are separate.
Warnings do not make incomplete HTML self-contained; inspect the prepared result.

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

Open `http://localhost:8765/` and run both linked suites. Staticseal checks HTML
parsing, previews, page CSS/scripts and interactions. FatSeal checks folder paths,
resource rendering, navigation, ZIP, encryption and import warnings; it also runs
from its generated `file://` page. Product scripts are unchanged by these harnesses.
Downloads are intercepted as Blobs. The FatSeal page exposes its ZIP evidence in
`#test-zip` for external extraction/CRC checks.

Validated locally in Chrome. Native OS pickers, download-manager behavior,
Firefox/Safari/mobile and measured peak memory remain unverified. An import fixture
with external URLs produced no requests in Chrome's network log; this is not a
cross-browser guarantee or a claim that opened HTML cannot access the network.

## Footprint and releases

```sh
npm run --silent measure:size > /tmp/staticseal-size.json
```

Rebuilds and reports actual UTF-8 bytes/hashes for both apps and eight CLI readers.
Fixtures cover raw/gzip, passphrase/no passphrase and file/page. `htmlBytes` is the
complete file; `wrapperBytes = htmlBytes - payloadJsonBytes`. Binary package size is
the decoded payload including metadata/tag, not additional HTML bytes. These are
file sizes, not HTTP gzip transfer sizes. The report records inputs, options,
revision and runtime; compare like-for-like runs with the same lockfile and Node/zlib.
Old work plans and one-off validation reports are available in Git history.

A published GitHub Release triggers `.github/workflows/release.yml`: install locked
dependencies, build, check, then attach `staticseal.html`. The README's latest-release
URL follows stable releases. Verify the workflow before announcing a release.
