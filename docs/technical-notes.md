# Staticseal technical notes

Implementation details, format constraints, and validation scope for the current single-file tool.

## Large files and provisional limits

The browser app warns from **5 MiB**, requires confirmation **above 10 MiB**, and
rejects files **above 25 MiB** before reading them. Exactly 10 MiB needs no
confirmation; exactly 25 MiB is allowed with confirmation. These are conservative
product limits, **not measured browser capacity or a validated support guarantee**.
The intended regular range is up to 10 MiB; 10–25 MiB is an optional range pending
desktop and mobile validation. The CLI remains unrestricted for local workflows;
a successful CLI roundtrip does not guarantee that a recipient's browser can open
the output. Prefer files within the same provisional range when distributing CLI
wrappers.

All three Web Crypto decode paths allocate one destination buffer and decode
chunks sequentially, appending the GCM tag without copying the whole ciphertext
again. Their argument count no longer grows with the file size. New app and CLI
outputs default to 65,536 Base64 characters per chunk (49,152 source bytes), versus
92 characters (69 bytes) previously. This reduces chunk counts for 10/25 MiB from
151,968/379,919 to 214/534. Base64 plus JSON chunk formatting now adds approximately
33.35%, plus the fixed HTML template, instead of approximately 45%. This chunk size
bounds individual conversion work while substantially reducing object overhead;
it does not implement streaming or guarantee a responsive UI.

New outputs use one format: v2 with `encoding: "metadata"`. Compatibility with
previous project payload formats is intentionally dropped. PBKDF2-SHA256 and
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

Run `npm test` (also included in `npm run check`). The dependency-free tests run
actual app code and scripts extracted from generated HTML with **Node Web Crypto
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

Open `http://127.0.0.1:8766/smoke.html` and check for twelve PASS lines and DONE.
The harness uses the actual app and generated wrapper scripts in browser iframes;
its test hooks are absent from production output.
Two cases parse complete app/CLI wrappers with a public filename containing
HTML script-parser control sequences and verify decryption and the restored name.
Six preview cases verify escaped HTML/JSON, Markdown and code colors, text
truncation and its end notice, dense-code fallback, and SVG rendering in a real DOM.


## Private filenames and passphrase generation

The web app keeps file selection and the optional passphrase visible. A collapsed
**Advanced** section contains the passphrase generator, private-filename option,
public title/output name and PBKDF2 settings. The submit button stays outside it.

**Encrypt filename and file type too** is off by default. It puts
both values inside the encrypted content and fixes the public title and downloaded
wrapper name to `Protected file` and `protected_file.html`. These fields are disabled
while the option is selected. The original name is restored after unlocking.
Without the option, filename and MIME type remain readable in the payload, and the
source name also appears in the title. Authentication does not hide them.
File size remains observable in either mode. In sealed mode, anyone can recover
private metadata because the unlock key is included.

CLI equivalent:

```bash
node bin/self-encrypt.mjs --in report.pdf --out protected_file.html --private-filename --stdin-password
```

Choose a neutral `--out` path yourself; private mode ignores `--title` and uses a
neutral wrapper title. Source/output paths printed by the local CLI are not hidden.

The optional web-only generator mixes 24 mouse, touch or keyboard events with
32 fresh bytes from `crypto.getRandomValues()` using SHA-256. It formats 16 digest
bytes as a 22-character Base64url secret. Event count measures interaction, not
entropy; secure browser randomness is mandatory. Copy or explicitly adopt the
result into both fields. Cancel preserves existing passphrases. Generator code and
interaction data are never included in generated wrappers. There is no enforced
passphrase-strength policy.

PBKDF2 options are 160k, 210k (unchanged default), 420k, 600k and 1.2M. The CLI still
defaults to 210k and accepts higher values via `--iterations`. Higher values increase
both unlock cost and the cost of offline guesses. The 600k option is based on the
[OWASP PBKDF2-HMAC-SHA256 guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#pbkdf2);
1.2M is an additional product option. Mobile latency remains to be measured.

### Unified content format

All outputs use v2 with `encoding: "metadata"`. Encrypted plaintext always consists
of a four-byte unsigned big-endian JSON-header length, UTF-8 JSON containing
`filename` and `contentType`, and the unchanged file bytes. The header is limited
to 65,536 bytes. When private filenames are off, name and type are additionally
published in the authenticated outer metadata. When on, those outer fields are
omitted and the public title uses neutral text.

AES-GCM authenticates the whole inner content and the existing ordered outer
metadata fields, including version and encoding. The app, CLI and both generated
wrappers use only this layout. Previous `v1/bytes` and `v2/private-metadata` layouts
are not accepted by the new decoder. Version and structure checks remain in place;
removing compatibility does not mean guessing the format of unknown data.

This removes the legacy decoding branch and the split creation path. The small
metadata header is now present for public-name files too. In the app this requires
a contiguous header-plus-file plaintext buffer; the CLI feeds the header and file
separately into the cipher to avoid that additional full copy. Generator code stays
in the creation UI; preview follows the image/text/Markdown/PDF policy described above.

The movement area shows a bounded SVG trail (up to 48 points), solely as input
feedback. It is not an entropy meter and adds no code to generated wrappers.


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
HTML and payload values. A small list of helper names remains stable for disposable
test instrumentation; production output contains no test hooks.

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

Measured against the preview baseline `106fcae`, `index.html` shrank from 58,994
to 39,650 bytes (19,344 bytes / 32.79%). Using identical representative payload
values in both renderers, the fixed small wrapper shrank from 24,896 to 16,796
bytes. Rendered 10/25 MiB payload examples saved 9,165/10,765 bytes respectively;
these totals include the reduced JSON formatting and vary with filename/metadata.
The measurement uses synthetic ciphertext of the same length to isolate packaging
overhead; byte-exact encryption/decryption is checked separately by the regression
suite and browser smoke harness.
