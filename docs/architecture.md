# Current Staticseal architecture

Status: 2026-10-21, after AP1–AP5. This describes the implemented single-file tool.
The [final validation](refactoring-validation.md) records the tested revision,
build hashes and sizes. Historical plans and release measurements are not the
current implementation specification.

## Creator and recipient boundaries

Staticseal packages one file into one standalone HTML document. File mode opens a
preview/download viewer. Page mode replaces the opening document with the original
self-contained HTML using `document.open/write/close`; its scripts execute with
the wrapper's origin and permissions. External resources are not collected.
Multi-file sites, Service Workers, routing, external key providers and framework
adapters remain proposals in the separately labelled website planning documents.

| Source | Responsibility | Included in a generated recipient HTML? |
| --- | --- | --- |
| `src/app.html`, `src/browser-limits.mjs` | Browser creator UI, file selection, captured options, Web Crypto encryption, local download and browser product limits | No |
| `bin/self-encrypt.mjs`, `src/cli-theme.mjs` | CLI arguments, file IO, Node crypto, CLI product limits and optional opening-screen theme | No; only the resulting theme CSS |
| `src/creation.mjs` | Outer metadata, privacy/display decisions, selected version, separate package parts and binary size | No |
| `src/compression.mjs` | Inner JSON header, native gzip trial and comparison of complete raw/gzip HTML sizes | No |
| `src/format.mjs` | Standalone `createFormat`: version rules, technical constants, escaping, Base64 decoding and inner content parser | Yes, serialized factory |
| `src/crypto.mjs` | Standalone `createCrypto`: ordered AAD, PBKDF2 and AES-GCM decryption | Only with a passphrase |
| `src/gzip.mjs` | Standalone `inflateContent`, validating declared expanded size and exact output length | Only for gzip |
| `src/preview.mjs`, `src/viewer.mjs` | Standalone file preview/download or original HTML page renderer | Only the selected renderer; preview helpers only in file mode |
| `src/wrapper.mjs` | Creator-side HTML assembly, escaping and selection of recipient code | No; its output is the recipient HTML |
| `src/reader.js`, `src/wrapper.html`, `src/wrapper.css`, `src/seal.svg` | Recipient opening form, script template, layout and logo | Yes, through the build and wrapper renderer |

The generated `reader-factories.mjs` is a creator-side registry of compact helper
sources, not the complete recipient script. It also exports the shared HTML-file
predicate from `viewer.mjs`. Wrapper assembly serializes only the factories needed
by the selected recipient. Shared technical rules in `createFormat` do not perform
creation, file access, encryption or compression.

## Shared preparation, environment-specific encryption

Both creators normalize the filename and MIME type, validate requested page input,
and generate salt/IV in their own environment. They pass plain options and Base64
salt/IV to `preparePackage`. Sealed creation never requests randomness or keys.

`preparePackage` forms outer metadata and delegates header encoding and gzip
selection to `prepareContent`. The selected version replaces the initial raw
version without changing property insertion order. Preparation returns the
metadata, four-byte header-length prefix, UTF-8 header, content and binary size.
Raw content retains the original buffer/view; preparation does not join or copy
the whole file. The browser's existing `packContent` makes one contiguous package
for Web Crypto or sealed Base64 encoding. Node passes prefix, header and content
separately to `cipher.update`; it concatenates ciphertext only on the encrypted
path. Node's sealed path keeps its existing single package concatenation.

The CLI applies its binary limit to the shared size and checks final UTF-8 HTML
before writing. Both environments retain their own crypto, Base64 conversion,
roundtrip verification and output handling. There is no platform adapter framework.

## Stored contract and limits

| Version | Access | Stored content | Outer data fields |
| --- | --- | --- | --- |
| 2 | Passphrase | Raw | `ciphertext` chunks and `tag` |
| 3 | Passphrase | Gzip | `ciphertext` chunks and `tag` |
| 4 | Sealed, no password | Raw | `content` chunks |
| 5 | Sealed, no password | Gzip | `content` chunks |

All four use `encoding: "metadata"`. Content is a four-byte unsigned big-endian
header length, UTF-8 JSON containing `filename` and `contentType`, then original
bytes or one gzip stream. Gzip headers also contain `originalSize`. Metadata is at
most 65,536 bytes. Passphrase mode uses a 16-byte salt, 12-byte IV and 16-byte GCM
tag with PBKDF2-SHA256/AES-256-GCM. No-password metadata contains no encryption/KDF
fields. It provides no confidentiality or GCM integrity.

AAD field order remains exactly `v`, `alg`, `kdf`, `iterations`, `encoding`,
`filename`, `contentType`, `access`, `unlockKey`, `salt`, `iv`, `display`.
Undefined fields are omitted by JSON serialization; `unlockKey` keeps its historical
position but is not emitted by current creators. The refactoring does not change
formats, encryption parameters, AAD order or supported versions.

Privacy mode omits public filename/type and uses the existing neutral opening title.
Inner metadata still restores the original name/type; without a password it remains
recoverable. Page mode adds authenticated `display: "page"`; file mode omits it.

| Policy | Current boundary | Owner |
| --- | --- | --- |
| Browser creation | Warn from 5 MiB; confirm above 10 MiB; reject above 25 MiB original | `browser-limits.mjs` and UI |
| CLI creation | 128 MiB original, 25 MiB binary package including metadata/tag, 35 MiB UTF-8 HTML | `CLI_*_MAX_BYTES` in CLI |
| Gzip recipient safety | At most 128 MiB declared expanded content | `createFormat().MAX_EXPANDED_BYTES`, passed explicitly to inflater |
| Metadata/header structure | Four-byte length prefix and at most 65,536 metadata bytes | `createFormat` |
| Preview | First 128 KiB of text, separate formatting limits | File viewer/preview helpers |

Compression starts at 4 KiB and wins only if the complete recipient HTML is smaller.
The shared helper defaults to the browser original-file range; the CLI explicitly
supplies its larger range. Equal numeric values do not merge product policy with
the reader's technical ceiling. None of these are measured browser capacity claims.

## Existing build and standalone embedding

`npm run build` remains `scripts/build.mjs`, using the locked clean-css,
html-minifier-terser and Terser development dependencies. There are no new runtime
dependencies. It writes exactly these generated production files:

| Output | Inputs/purpose |
| --- | --- |
| `index.html` | Creator UI, shared creation/reader helpers, compact wrapper templates and logo, inlined as one HTML file |
| `src/logo.mjs` | Compact `seal.svg` for wrapper generation |
| `src/wrapper-template.mjs` | Compact wrapper HTML/CSS and the reader script with build markers |
| `src/reader-factories.mjs` | Compact standalone factories from format, preview, gzip, crypto and viewer sources |

The CLI consumes compact generated templates/factories without importing minifiers.
The browser build instead inlines the readable helpers and minifies the whole app.
Its serialized local names may differ from CLI factories; neither generated reader
depends on those names being preserved for tests.

Inlining, variable collapsing, scope hoisting and property mangling remain disabled
so serialized factories retain their own closures. Each recipient receives a format
factory, a decoder, a viewer and (for gzip only) an inflater with the numeric reader
ceiling. The optional restore marker carries the actual minified content argument.
Raw readers omit both inflater and restore call; sealed readers omit crypto.
HTML template substitutions use callbacks, and payload JSON escapes `<` to protect
the script-data boundary. Final readers contain no unresolved markers, imports,
external script/style dependencies or references to creator-local variables.

Edit the source files, then build; never hand-edit generated production files.
`npm run check` verifies that committed generated files match the current build.
Reproducibility is verified with the same locked dependency/runtime versions; the
recorded hashes do not promise identical output after toolchain updates.

## Validation boundaries

Shared rules are imported directly in tests. Selected generated app/CLI readers
also run unchanged scripts through forms in isolated Node VM contexts with DOM
stubs. The reader-boundary audit removes creation APIs, randomness, encryption,
network access and native compression while retaining required read capabilities;
all 16 generator/access/compression/display variants restore the expected content.
These stubs do not parse/render complete HTML or execute original page scripts.

The separate real-browser smoke harness copies unmodified production HTML and
uses forms, DOM and Blob APIs. It verifies actual HTML parsing, previews and page
execution in the tested browser. Exact file Blobs are observed before an OS save;
download-manager behavior, other browsers, mobile capacity and peak RAM remain
separate validation. See the [AP5 results](refactoring-validation.md).

Large raw fixtures cover 10/25 MiB minus metadata headroom in both access modes,
using the built browser creator and the real CLI. They focus on chunk counts and
exact reader roundtrips. Small fixtures cover privacy and authentication permutations,
including corrupted ciphertext and tags; exact 25 MiB gzip and 128 MiB CLI boundary
checks remain. The Node cipher audit checks that original-buffer views are consumed
in order without concatenating them into another plaintext package, rather than
requiring a particular number of cipher calls. This is a targeted regression check,
not a measurement of all allocations or peak memory.
