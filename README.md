# self-encrypted

Web UI: https://nox-do.github.io/staticseal/

Small static-site helper for turning a normal static file into a self-contained encrypted HTML file.

Current version: `0.9.x`.

This is built for single static artifacts such as HTML onepagers, PDFs, and images. It is not a whole-website packager or asset crawler.

It can run as:

- a static browser app on GitHub Pages for HTML, PDF, images, and downloadable files
- a local Node.js CLI for the same static file wrapper format

The output contains:

- a generic password screen
- a visible security note for maintainers
- optional no-passphrase seal mode for crawler resistance only
- PBKDF2-SHA256 key derivation
- AES-GCM encrypted file payload
- authenticated metadata binding with AES-GCM additional data
- five browser-friendly PBKDF2 strength presets instead of arbitrary iteration input
- chunked ciphertext so the generated file remains somewhat readable and tooling-friendly
- a decrypt roundtrip check before writing the output
- sandboxed browser preview for unlocked HTML
- direct browser rendering for unlocked PDF and images
- a download/open fallback for other file types

## Web UI

Open `index.html` in a browser, or publish this repository with GitHub Pages.

The browser app:

1. reads the selected file locally with the File API
2. derives an encryption key from the passphrase with PBKDF2-SHA256, or creates an embedded random key when no passphrase is used
3. encrypts the file bytes with AES-GCM
4. downloads a new self-contained encrypted `.html` file

The source file and passphrase are not uploaded to GitHub Pages or any backend.

The web UI has no upload endpoint. It uses the browser File API to read the selected file locally, Web Crypto to seal it, and a Blob download to save the generated wrapper.

Passphrase mode is for confidentiality. No-passphrase mode is a publishing veil: it keeps the original content out of plain static HTML, search indexes, and link-preview parsers, but anyone with the generated wrapper can open it.

Unlocked behavior depends on the original file type:

- HTML renders in a sandboxed preview
- PDF opens in an embedded browser PDF view
- images render inline; SVG gets image preview plus download only
- other files get Open and Download actions

Active HTML and SVG are not opened directly from the wrapper because Blob URLs inherit the wrapper page's origin. Download those files if you need to inspect or run them outside the sandboxed preview.

The browser app is designed for small to medium static artifacts. It warns for larger files because browser memory use and the generated wrapper size both grow with the source file.

## CLI usage

```bash
node ./bin/self-encrypt.mjs \
  --in report.pdf \
  --out report_encrypted.html \
  --title "Protected report"
```

The password is requested interactively, hidden while typing, and is not passed as a CLI argument.

For automation you can use stdin:

```bash
printf '%s\n' "$PITCH_PASSWORD" | node ./bin/self-encrypt.mjs --in input.html --out locked.html --stdin-password
```

For crawler resistance without a passphrase:

```bash
node ./bin/self-encrypt.mjs --in report.pdf --out report_sealed.html --no-password
```

## Security boundary

This is a static curiosity barrier, not server-side access control.

Salt, IV, KDF parameters, and ciphertext are intentionally stored in the generated HTML because browser-side decryption needs them. Salt and IV are not secrets.

Anyone who downloads a passphrase-protected wrapper can attempt offline password guesses. Use a strong passphrase for real confidentiality, and use server-side access control when access must be enforceable.

No-passphrase wrappers embed their own unlock key. They are useful for keeping static content out of crawler-readable source, but they do not provide confidentiality.

## Suggested convention

In a pitch/content repo:

```gitignore
*-unencrypted.html
```

Keep the unencrypted source local and publish only the generated encrypted HTML.

## GitHub Pages setup

Use the repository root as the Pages source. GitHub will serve `index.html` as the web UI.

Generated encrypted HTML wrappers can also be hosted on GitHub Pages, Netlify, S3, or sent as standalone files.

## Roadmap

- Evaluate Argon2id or scrypt as an optional future KDF. PBKDF2-SHA256 is used today because it is browser-native and dependency-free.
- Add automated browser smoke tests for HTML, PDF, image, wrong password, and long-title cases.

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
- Check byte-exact downloads, PDF/image previews and sandboxed HTML previews.
- Confirm wrong passwords and metadata tampering never display plaintext.
- Check warning/confirmation boundaries and rejection above 25 MiB before file reads.
- Record browser/device versions, peak process memory, creation/unlock time,
  responsiveness, and repeated-open behavior. Lower the cap if devices fail.

The Node regression suite does not claim real-browser or mobile coverage.
Before the format unification, a separate local browser harness passed in the Codex embedded Chromium browser
(user agent Chrome 155, macOS): 10/25 MiB, both access modes, private filenames,
600k iterations, byte-exact app-wrapper roundtrips, restored viewer metadata and
wrong-password rejection. The unified format has been rechecked under Node;
that earlier browser run is not a fresh browser validation of this revision.
This does not validate Firefox, Safari, mobile devices,
PDF/image rendering, file-download behavior, or peak memory.

To generate the disposable browser harness outside the repository:

```bash
node test/build-browser-smoke.mjs /tmp/staticseal-browser-smoke
python3 -m http.server 8766 --bind 127.0.0.1 --directory /tmp/staticseal-browser-smoke
```

Open `http://127.0.0.1:8766/smoke.html` and check for six PASS lines and DONE.
The harness uses the actual app and generated wrapper scripts in browser iframes;
its test hooks are absent from production output.
Two cases parse complete app/CLI wrappers with a public filename containing
HTML script-parser control sequences and verify decryption and the restored name.


## Private filenames and passphrase generation

The web app keeps file selection and the optional passphrase visible. A collapsed
**Advanced** section contains the passphrase generator, private-filename option,
public title/output name and PBKDF2 settings. The submit button stays outside it.

**Encrypt filename and file type too** is off by default. It puts
both values inside the encrypted content and fixes the public title and downloaded
wrapper name to `Protected file` and `protected_file.html`. These fields are disabled
while the option is selected. The original name is restored after unlocking.
Without the option, filename and MIME type remain readable in the payload, and the
source name also appears in the title/comment. Authentication does not hide them.
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
omitted and the public title/comment use neutral text.

AES-GCM authenticates the whole inner content and the existing ordered outer
metadata fields, including version and encoding. The app, CLI and both generated
wrappers use only this layout. Previous `v1/bytes` and `v2/private-metadata` layouts
are not accepted by the new decoder. Version and structure checks remain in place;
removing compatibility does not mean guessing the format of unknown data.

This removes the legacy decoding branch and the split creation path. The small
metadata header is now present for public-name files too. In the app this requires
a contiguous header-plus-file plaintext buffer; the CLI feeds the header and file
separately into the cipher to avoid that additional full copy. Generator code stays
in the creation UI; preview sandbox restrictions remain unchanged.

The movement area shows a bounded SVG trail (up to 48 points), solely as input
feedback. It is not an entropy meter and adds no code to generated wrappers.
