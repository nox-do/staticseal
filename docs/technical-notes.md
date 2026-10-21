# Staticseal technical notes

Implementation details, format constraints, and validation scope for the current single-file tool.

Current overview: [architecture](architecture.md). Final AP1–AP5 results and exact
build/size evidence: [validation](refactoring-validation.md). Dated AP/release
measurements below describe their recorded revision, not the current artifact size.

## Shared format rules and creator policies

`createFormat()` in `src/format.mjs` is the common source for supported versions,
raw/gzip and encrypted/sealed classification, and `versionFor(access, compressed)`.
The mapping remains v2/v3 for encrypted raw/gzip and v4/v5 for sealed raw/gzip;
all four use `METADATA_ENCODING` (`metadata`). Tests intentionally retain literal
version numbers as independent assertions of this stored-format contract.

The same factory owns the four-byte metadata-length prefix, 65,536-byte metadata
ceiling, 16-byte GCM tag, 16-byte salt, 12-byte IV and 128 MiB expanded-content
safety ceiling. These technical rules are separate from product policies:
`src/browser-limits.mjs` defines the browser's 5/10/25 MiB warning/confirmation/
original-file limits, while `CLI_*_MAX_BYTES` in `bin/self-encrypt.mjs` defines the
CLI's 128 MiB original, 25 MiB binary-package and 35 MiB final-HTML limits.
Compression defaults to the browser creation range; the CLI explicitly supplies
its own original-file limit. The reader ceiling is not inferred from either
creator, even where values currently coincide. Preview limits remain viewer policy.

All format rules live inside `createFormat`, so its serialized source needs no
imports or outer variables. The optional `inflateContent(content, maxExpandedBytes)`
helper receives the shared reader ceiling explicitly. Wrapper generation writes
that numeric value into the generated call, keeping the helper standalone without
embedding browser/CLI product policies or including gzip code in raw readers.
The build remains responsible for all generated production files.

Neither the payload layout nor the ordered authenticated-metadata list in
`src/crypto.mjs` changed. `test/fixtures/format-v2-v5.json` contains eight frozen
payloads created by the CLI at commit
`40658cca516e38bb69410134ae4bc48a601c19cc`, before this refactoring. Its inputs,
repeat counts and test passphrase are included. They were generated using an
archived checkout, `compat.html`, `--iterations 100000`, title `Format compatibility`,
public filenames and the default chunk width, varying `--stdin-password`/
`--no-password` and `--html-page`. Imported helpers and generated CLI-template readers must restore
their exact bytes and metadata. Separate literal AAD tests freeze field order,
undefined-field omission and the historical `unlockKey` position; detached-factory
tests exercise readable and minified helpers without module scope.

The AP2 run of `npm run --silent measure:size` with the recorded baseline's runtime
and fixtures gave 41,835 bytes for the app (+755), +359 bytes
per raw reader and +389 bytes per gzip reader. All eight payload JSON sizes remain
unchanged. The added shared helper code is included in the standalone readers;
the original `docs/size-baseline.json` remains the historical comparison point.

## Shared creator preparation

`preparePackage` in `src/creation.mjs` builds outer metadata for both creators,
including privacy and page-mode fields, then delegates content/header generation
and raw/gzip selection to `prepareContent` in `src/compression.mjs`. It finalizes
the selected version, creates the four-byte header-length prefix and computes the
binary-package size, including the GCM tag only for passphrase access. Metadata
field insertion order, inner JSON and authenticated-data order are preserved.
Salt and IV are supplied as Base64 by each environment; sealed metadata never
includes encryption parameters. There is no platform adapter or crypto callback.

The result holds the prefix, UTF-8 metadata header and content as separate buffers.
Raw content is the original input object, including when it is a view into a
larger buffer. Shared preparation never concatenates or copies the whole input.
The browser's `packContent` still makes its one contiguous package for Web Crypto
or sealed encoding. Node passes the prefix, header and content separately to
`cipher.update`; only ciphertext is concatenated on the encrypted path. Node's
sealed path retains its existing single `Buffer.concat` of the package parts.

UI, file access, page eligibility/error messages, random generation, cryptography,
Base64 conversion and roundtrip verification remain in their existing environments.
The CLI checks the shared binary size against its own product limit and keeps
its original/final-HTML checks; browser limits remain browser policy. The build
inlines `creation.mjs` only into the creator app. Neither shared reader factories
nor serialized recipient readers contain package-preparation functions.

Tests compare preparation through module imports against historical metadata for all
four versions, both display modes and both privacy settings. They assert raw
buffer identity and instrument real Node encryption to require three separate
updates and reject concatenating the original plaintext. The representative size
measurement gives a 42,085-byte app (+250 bytes from AP2); all eight CLI-generated
readers, their payload JSON sizes and wrapper sizes are unchanged from AP2.
These checks do not measure process peak memory or replace real-browser validation.

## Tests independent of private implementation names

Shared creation, compression, format parsing, authenticated metadata and preview
logic are tested through module imports. Test-only payload fixtures combine those
exports with Node Web Crypto; they are not presented as executions of the browser
creator. A few detached readable/minified factory checks retain coverage of the
standalone serialization contract through exported module functions.

Integration tests execute unchanged script elements from built app/reader HTML.
They submit forms and observe errors, download Blobs, written page text and viewer
output. No local functions or variables are exposed by inserting source text into
minified code. App form cases cover raw/gzip, both access modes, private/public
filenames, both display modes, KDF derivation counts and UI choices captured before
asynchronous reads. Warning/confirmation/rejection decisions are checked before
reading using declared file sizes in the DOM stub; those boundary tests are not
memory-capacity measurements. Real CLI and generated reader cases retain 10/25 MiB
roundtrips, tampered fields/tags, wrong passwords, malformed headers, padding,
gzip errors, encoding checks and original/binary/HTML limit rejection.

The production minifier has no test-specific reserved names. The optional reader
restore marker carries its content argument, so wrapper generation uses the
minified local identifier rather than relying on a fixed variable name. Reader
factories still preserve the scopes needed for serialization. The separate
real-browser harness also uses only forms and DOM/Blob APIs; it copies built
creator and CLI files unchanged and adds no private-function hooks.

AP4 validation (2026-10-21): `npm run check` passed all 41 Node tests. The separate
Chromium 155 smoke run passed all 21 cases and reached DONE, including creation
and opening through the forms, 10/25 MiB exact file Blobs, previews, page scripts,
CSS, interaction and CLI fragment links. It does not establish Firefox, Safari,
mobile, OS download-manager or peak-memory behavior. The size command reports
41,488 bytes for the built app (-597 from AP3) and reader savings of 204–304 bytes;
all eight payload JSON sizes remain unchanged. No baseline or size budget changed.

## Large files and provisional limits

The browser app warns from **5 MiB**, requires confirmation **above 10 MiB**, and
rejects files **above 25 MiB** before reading them. Exactly 10 MiB needs no
confirmation; exactly 25 MiB is allowed with confirmation. These are conservative
product limits, **not measured browser capacity or a validated support guarantee**.
The intended regular range is up to 10 MiB; 10–25 MiB is an optional range pending
desktop and mobile validation. The CLI accepts at most 128 MiB original, 25 MiB
binary package (prefix, metadata and GCM tag included), and 35 MiB final UTF-8 HTML;
a successful CLI roundtrip does not guarantee that a recipient's browser can open
the output. Prefer files within the same provisional range when distributing CLI
wrappers.

Password-protected Web Crypto decode paths allocate one destination buffer and decode
chunks sequentially, appending the GCM tag without copying the whole ciphertext
again. Their argument count no longer grows with the file size. New app and CLI
outputs default to 65,536 Base64 characters per chunk (49,152 source bytes), versus
92 characters (69 bytes) previously. This reduces chunk counts for 10/25 MiB from
151,968/379,919 to 214/534. Base64 plus JSON chunk formatting now adds approximately
33.35%, plus the fixed HTML template, instead of approximately 45%. This chunk size
bounds individual conversion work while substantially reducing object overhead;
it does not implement streaming or guarantee a responsive UI.

Password outputs use v2 (original bytes) or v3 (gzip); no-password outputs use
v4 (original bytes) or v5 (gzip). All use `encoding: "metadata"`.
The older `v1/bytes` and `v2/private-metadata` layouts remain unsupported. PBKDF2-SHA256 and
AES-256-GCM with authenticated metadata remain in use. Already distributed HTML
files keep their own embedded decoder and are not modified by this change.
Regenerate a file from its original content to obtain the current format.
The CLI's `--chunk-size` remains a formatting option, not a format migration tool.

Memory use still grows by multiple times the input size: plaintext, ciphertext,
Base64 strings, JSON/HTML, download Blob and roundtrip plaintext can coexist.
Web Crypto may make additional copies; PDF/image rendering also needs memory.
Peak memory has **not** been measured. The single-shot AES-GCM workflow must read
and decrypt the complete file before previewing it. Synchronous conversion,
copying and JSON operations may block the main thread. PBKDF2 is performed
once during creation; the serialized-payload roundtrip reuses that key. Independent
wrapper tests derive the key again from the stored parameters. Larger
chunks do not solve these limits. A 25 MiB cap limits exposure to these costs but
cannot prevent out-of-memory failures on constrained devices.

### Regression checks and remaining browser validation

Run `npm test` (also included in `npm run check`). Tests import shared modules,
execute selected built app/reader scripts through forms with **Node Web Crypto
and a minimal DOM stub**, and invoke the real CLI. They cover 10 and 25 MiB in both
passphrase and sealed modes, public/private filenames, byte-exact roundtrips, chunk
boundaries, wrong passwords, modified authenticated metadata and modified tags.
These tests do **not** exercise browser UI, download, preview or mobile memory.

Before treating the proposed range as supported, test Chrome, Firefox and Safari
on desktop, plus Safari/iOS and Chrome/Android on memory-constrained devices:

- Create and reopen 5, 10 and 25 MiB files in both access modes with both generators.
- Check byte-exact downloads, allowlisted image previews (including SVG as an image),
  escaped text/source previews, Markdown formatting and PDF consent/cancellation.
- Confirm wrong passwords and metadata tampering never display plaintext.
- Check warning/confirmation boundaries and rejection above 25 MiB before file reads.
- Record browser/device versions, peak process memory, creation/unlock time,
  responsiveness, and repeated-open behavior. Lower the cap if devices fail.

The Node regression suite does not claim real-browser or mobile coverage.
Browser runs and their scope are recorded in the [working plan](staticseal-arbeitsplan.md).
Earlier runs before format unification do not validate the current format.
The smoke harness is not a substitute for cross-browser, mobile, rendering,
download, or peak-memory validation.

To generate the disposable browser harness outside the repository:

```bash
node test/build-browser-smoke.mjs /tmp/staticseal-browser-smoke
python3 -m http.server 8766 --bind 127.0.0.1 --directory /tmp/staticseal-browser-smoke
```

Open `http://127.0.0.1:8766/smoke.html` and check for 21 PASS lines and DONE.
The harness uses unmodified app and generated wrapper HTML in browser iframes.
It creates files through the actual app form, opens readers through their forms,
and observes original file Blobs at the browser's object-URL API. It suppresses
creator download clicks so running the tests does not save test files.
Two cases parse complete app/CLI wrappers with a public filename containing
HTML script-parser control sequences and verify decryption and the restored name.
Six preview cases verify escaped HTML/JSON, Markdown and code colors, text
truncation and its end notice, dense-code fallback, and SVG rendering in a real DOM.
Four cases create and restore 10/25 MiB files. The remaining cases check the page
choice UI and all eight app/CLI × raw/gzip × passphrase/sealed page combinations,
including CSS, scripts, interaction, full content and CLI fragment navigation.


## Private filenames and passphrase generation

The web app keeps file selection and the optional passphrase visible. A collapsed
**Advanced** section contains the passphrase generator, private-filename option,
public title/output name and PBKDF2 settings. The submit button stays outside it.

**Hide original filename and file type** is off by default. It puts
both values inside the packaged content and fixes the public title and downloaded
wrapper name to `Protected file` and `protected_file.html`. These fields are disabled
while the option is selected. The original name is restored after unlocking.
Without the option, filename and MIME type remain readable in the payload, and the
source name also appears in the title. Authentication does not hide them.
File size remains observable in either mode. In sealed mode, anyone can recover
private metadata by decoding the packaged content. Only a passphrase makes it private.

CLI equivalent:

```bash
node bin/self-encrypt.mjs --in report.pdf --out protected_file.html --private-filename --stdin-password
```

Choose a neutral `--out` path yourself; private mode ignores `--title` and uses a
neutral wrapper title. Source/output paths printed by the local CLI are not hidden.

The optional web-only generator directly formats 16 fresh bytes from
`crypto.getRandomValues()` as a 22-character Base64url secret (128 bits).
One click generates and displays the result; copy or explicitly adopt it into
both fields. Cancel preserves existing passphrases. Secure browser randomness is
mandatory; no user-event collection or hashing is needed. Generator code is never
included in generated wrappers. There is no enforced passphrase-strength policy.

PBKDF2 options are 160k, 210k (unchanged default), 420k, 600k and 1.2M. The CLI still
defaults to 210k and accepts higher values via `--iterations`. Higher values increase
both unlock cost and the cost of offline guesses. The 600k option is based on the
[OWASP PBKDF2-HMAC-SHA256 guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#pbkdf2);
1.2M is an additional product option. Mobile latency remains to be measured.

### Unified content format

Uncompressed password outputs use v2 with `encoding: "metadata"`. Encrypted plaintext consists
of a four-byte unsigned big-endian JSON-header length, UTF-8 JSON containing
`filename` and `contentType`, and the unchanged file bytes. The header is limited
to 65,536 bytes. When private filenames are off, name and type are additionally
published in the authenticated outer metadata. When on, those outer fields are
omitted and the public title uses neutral text.

For password envelopes, AES-GCM authenticates the whole inner content and the existing ordered outer
metadata fields, including version and encoding. The app, CLI and both generated
wrappers use this header layout. Previous `v1/bytes` and `v2/private-metadata` layouts
are not accepted by the new decoder. Version and structure checks remain in place;
removing compatibility does not mean guessing the format of unknown data.

This removes the legacy decoding branch and the split creation path. The small
metadata header is now present for public-name files too. In the app this requires
a contiguous header-plus-file plaintext buffer; the CLI feeds the header and file
separately into the cipher to avoid that additional full copy. Generator code stays
in the creation UI; preview follows the image/text/Markdown/PDF policy described above.

### Selective gzip packaging

App and CLI try native gzip from 4,096 bytes through 25 MiB and 128 MiB respectively,
regardless of MIME type or extension. Smaller inputs and creators without
both native CompressionStream and DecompressionStream support stay uncompressed
(v2 with a password, v4 without one).
No compression library is shipped. Original browser file-size limits still apply.

`prepareContent` compares complete raw and gzip envelope lengths before packaging
(v2/v3 with a password, v4/v5 without one).
It renders each fixed wrapper and accounts for the content header length,
Base64 expansion, JSON chunk quotes/commas, and the optional unpacker. Title and
GCM tag have identical lengths in both candidates, so their placeholder values
cancel in the comparison; plaintext envelopes have no GCM tag. Ties keep the raw
variant; even a smaller gzip stream is rejected if it does not pay for its unpacker.
PBKDF2 and AES-GCM run only for password-protected winners.

For v3/v5, the JSON header additionally contains `originalSize`; subsequent
bytes are a single gzip stream. These versions unambiguously specify gzip. There is
no runtime format sniffing: the generator inserts `inflateContent` into v3/v5 readers
and omits it and its call entirely from v2/v4 readers. Original v2 envelopes remain
supported by the common creator verification code. Previously distributed HTML
keeps its own decoder.

For encrypted files, AES-GCM authentication completes before decompression. The unpacker validates the
declared original size (at most 128 MiB), writes directly into a buffer of that size,
and rejects truncated/invalid gzip and size mismatches before preview or download.
Creation verifies exact original bytes and filename/type using the selected path.
Both creator interfaces report input size and the actual UTF-8 HTML package size.
Recipients need DecompressionStream for compressed envelopes; unsupported browsers
show a specific error. Full cross-browser/mobile and peak-memory validation remains
separate from the Node regression suite.

### Optional encryption

New password envelopes keep AES-GCM/PBKDF2 and the `ciphertext`/`tag` fields (v2/v3).
New no-password envelopes instead store Base64 chunks in `content` (v4/v5), with no
`alg`, `kdf`, `iterations`, `salt`, `iv`, `tag`, `unlockKey` or `ciphertext` fields.
The inner metadata header is the same layout; original bytes, name and MIME type
are verified before download in both modes. v4/v5 have no GCM integrity check.

`createFormat` contains the shared content parser, Base64 helpers, version rules
and technical format constants; it does not create packages or perform encryption.
`createCrypto` holds authenticated metadata, PBKDF2 and AES-GCM decoding. The
generator serializes the latter exclusively into password envelopes. Each emitted
reader receives one decoder, with no runtime test for encrypted vs. plain content.
No-password creation and reading work without Web Crypto; they do not generate a
random key or call encryption/decryption APIs. The CLI follows the same policy.
Already distributed HTML remains independent and retains its original decoder.

Wrapper generation includes the passphrase label and input only in passphrase
mode. Sealed wrappers contain only the opening button in the form. On failure,
the reader selects and focuses a connected passphrase input, or focuses the
connected opening button when no input is available. Successful opening adds no
focus handling.


## Compact offline previews

`src/preview.mjs` shares file-type detection between the app, CLI and generated
wrappers. Plain text previews use `textContent`. JavaScript, JSON and HTML get
basic syntax colors through escaped text wrapped in fixed CSS spans, including
Markdown fences labeled js/javascript, json or html. This is a small lexical
highlighter, not a full language parser; regex literals and template substitutions
in JavaScript and embedded languages in HTML are not parsed separately. HTML,
XML and source code never execute. Markdown uses a dependency-free basic-subset renderer, not a complete
CommonMark implementation. It supports ATX headings, paragraphs, simple lists,
blockquotes, fenced code, inline code, emphasis, strikethrough, rules and links.
Nested lists, tables, reference links and embedded HTML are not interpreted.
Source HTML is escaped, images remain literal Markdown, and only explicit HTTP,
HTTPS, mailto and fragment links become clickable. No remote assets are loaded.
SVG is embedded through an image element, never as an inline SVG or document.

Text decoding accepts UTF-8 and UTF-16 with a byte-order mark. Unsupported encodings
fall back to a download message. Previews decode at most the first 128 KiB, with
visible truncation notices above and below the preview, while the original download stays byte-exact. This
bounds rendering work but does not change the complete-file decryption cost.
Dense code falls back to escaped text above 4,096 colored spans. Markdown with
more than 4,096 lines or more than roughly 4,096 generated elements is shown as
escaped source with an explanatory note. These limits bound DOM expansion as
well as input size; they do not change the downloaded original.
New previews apply only to newly generated wrappers.

## Compact standalone builds

Readable sources are retained. The build compacts CSS with clean-css at level 0,
HTML with html-minifier-terser (preserving inter-element whitespace), and JavaScript
with Terser. Only selected expression/statement optimizations are enabled;
function inlining, variable collapsing, scope hoisting and property mangling are
disabled. This preserves the standalone function boundaries needed by `.toString()`.
The app and CLI both emit minified readers. Their local variable names can differ;
the regression suite executes both actual readers and compares their surrounding
HTML and payload values. Local names can be freely mangled; no test-specific names
are reserved and production output contains no test hooks.

The wrapper's HTML, CSS and script have separate editable sources. Generated
`wrapper-template.mjs` and `reader-factories.mjs` keep the CLI free of runtime
minifier dependencies. Internal viewer classes and IDs are short; the `s-` classes
are generated by the syntax highlighter. The SVG keeps its geometry and precision;
only whitespace between its elements is removed.

Payload JSON is emitted without indentation, with the same values and existing
HTML script-parser escaping. It is not file-content compression. The technical
generation comment, timestamp and redundant source-name parameter are removed.
Template substitution uses callbacks and a single pass so literal replacement
sequences or marker-like text in filenames are preserved.

### Historical preview comparison (before AP1)

These measurements used an earlier implementation and synthetic payloads. They
are retained as history; use the [AP1/final comparison](refactoring-validation.md)
for current sizes with identical real CLI fixtures.

Measured against the preview baseline `106fcae`, `index.html` shrank from 58,994
to 39,650 bytes (19,344 bytes / 32.79%). Using identical representative payload
values in both renderers, the fixed small wrapper shrank from 24,896 to 16,796
bytes. Rendered 10/25 MiB payload examples saved 9,165/10,765 bytes respectively;
these totals include the reduced JSON formatting and vary with filename/metadata.
The measurement uses synthetic ciphertext of the same length to isolate packaging
overhead; byte-exact encryption/decryption is checked separately by the regression
suite and browser smoke harness.

### Selective gzip validation (2026-10-20)

- Full regression: 26 passing tests; gzip/error/UI cases rerun after final changes.
- Coverage includes the 4 KiB boundary, incompressible inputs, gzip savings smaller
  than unpacker cost, different CLI chunk widths, missing native APIs, invalid
  streams/sizes, raw fallback above the default compression limit, and compressed 25 MiB roundtrips
  for both access modes and both filename modes.
- Chromium 155: all 12 existing browser smoke cases passed, including compressed
  10/25 MiB envelopes, actual DOM previews, filename restoration and wrong passwords.
- Actual browser file selection and download: 18,000 original bytes became a
  17,992-byte gzip envelope; independently decrypted and restored byte-for-byte.
- Built creator: 41,772 bytes, up 2,122 bytes from v1.0.3. The existing long-notes
  fixture produces a 36,142-byte envelope rather than 503,520 bytes with the same
  file/title/access settings. Uncompressed envelopes contain no gzip unpacker.
- This does not establish Firefox, Safari, mobile, or peak-memory compatibility.

### Optional encryption validation (2026-10-20)

- `npm run check`: all 27 tests passed. No-password tests forbid Web Crypto in the
  creator and reader, and forbid random-key, PBKDF2 and cipher calls in the CLI.
- v4/v5 roundtrips cover empty, small, incompressible and compressible binary data,
  public/private names, HTML parser control sequences, and gzip savings that do
  not pay for the unpacker. Existing encrypted authentication and KDF tests remain.
- Chromium 155: all 12 smoke cases passed. Both 10/25 MiB sealed cases confirm no
  crypto code and exact decoding; password cases still reject wrong passwords.
- Compared with the preceding gzip implementation, representative sealed envelopes
  save 722 bytes, with or without gzip. The shared crypto helpers add 221 bytes to
  the corresponding password envelopes. The creator grows 271 bytes to 42,043 bytes.
  Measurements use identical titles, names, contents and iteration-count lengths;
  the preceding sealed mode used its normal 44-character embedded random key.
- No-password packages have no GCM integrity check. Creation still verifies exact
  bytes; compressed readers also enforce gzip validity and the declared output size.

### Single-file HTML page output (local development, 2026-10-20)

The creator offers an opt-in **Display as a webpage after opening** switch only
for `.html`/`.htm` or `text/html` inputs. It starts off and resets on every file
change, including cancellation/non-HTML selection. Its value is captured before
asynchronous reads. The CLI exposes the same choice as `--html-page`.

The optional outer `display: "page"` field selects the renderer during generation.
It is included in AES-GCM authenticated metadata, after `iv`; when absent it is
omitted from the AAD JSON, preserving existing file-mode payload verification.
No decoder guesses the rendering mode at runtime. `src/viewer.mjs` provides two
standalone factories: page envelopes receive only `createPageViewer`, whereas file
envelopes receive `createFileViewer` with the existing preview helpers. Page
outputs omit syntax highlighting, Markdown, image/PDF preview and download UI.
Password and gzip selection remain independent, and gzip comparisons use the
selected renderer's actual fixed size.

Page mode validates UTF-8 or BOM-marked UTF-16 before packaging. After decoding,
it replaces the wrapper document in place using `document.open/write/close`, as
the original single-page tool did. Full HTML is rendered without the file preview's
128 KiB limit. The wrapper's robots/noindex hint is appended to the new head.
Original CSS, inline scripts, title and document interactions are retained. Scripts
run with the wrapper's origin/permissions; the page is not sanitized or sandboxed.
This mode targets explicitly chosen, self-contained HTML. It does not collect
external dependencies, implement resource routing, or package multi-page sites.

`document.write` has browser-specific limitations and is discouraged for general
web development ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Document/write)).
Strict host CSP/Trusted Types rules or embedded-frame contexts can affect it.
The intended flow is opening the standalone output and using its own unlock form.
The smoke harness waits for the replaced iframe DOM instead of treating
`document.open` as a new parent-frame navigation/load event.

Validation: all 30 Node regression tests passed, plus 21 Chromium 155 smoke cases.
The new cases cover app/CLI, password/no-password, gzip/raw, private/public names,
mode-metadata tampering, encoding validation, complete HTML beyond 128 KiB,
original CSS, inline-script execution, button interaction and fragment links.
A separate real-page button test also confirmed the original window load handler.
Firefox, Safari and mobile behavior still need separate validation.

The minified creator is 43,564 bytes (1,527 bytes above the preceding filename-fix
build). The synthetic 180,723-byte self-contained demo produces an 11,888-byte
no-password page envelope versus 18,564 bytes in file-preview mode with identical
content/title; both use gzip. Password page output with a private name is 12,804
bytes. No runtime dependency was added.

### Release 1.2.0 opening-screen options (2026-10-20)

Historical release validation: the size and test count below apply to that release
revision. The later passphrase-generator and compression-limit changes and AP1–AP5
are reflected in the current architecture and final measurement instead.

The CLI adds `--minimal` and `--button-label`, independently of page/file mode,
passphrase protection and gzip. Minimal output omits introductory copy and the
initial no-passphrase status while preserving progress, errors, the logo, heading
and any required passphrase field. The button label is escaped as text; the reader
does not overwrite it. The bottom explanatory note and its CSS are removed from
all newly generated wrappers.

Six optional `--theme-*` parameters customize the opening screen. Validation and
CSS generation live in the CLI-only `src/cli-theme.mjs`; no theme parser is embedded
in the browser app or generated readers. Colors accept hex, fonts accept simple
font-family stacks, and card rounding accepts nonnegative px/rem/em lengths or 0.
Styles apply to `body:not(.vp)` and the lock card, so file previews keep their
default theme. Page rendering replaces the entire document and its styles.
Without theme parameters there is no additional CSS. These options affect neither
payload metadata nor the original content bytes.

The final browser app is 43,367 bytes. All 32 Node regression tests passed before
release, including optional themes, minimal output, escaped labels, invalid CLI
values and payload roundtrips. The customized theme and minimal opening screen
were also visually checked in Chromium. The README now documents a static
Impressum page with an opening button, including crawler limitations.

Review follow-ups remain separate: page envelopes still carry about 2 KiB of
unused file-preview CSS, and password readers without `crypto.subtle` still report
a generic password/damaged-file error rather than a secure-context explanation.
