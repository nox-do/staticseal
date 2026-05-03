# self-encrypted

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
- three browser-friendly PBKDF2 strength presets instead of arbitrary iteration input
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
