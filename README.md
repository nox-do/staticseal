# self-encrypted

Small static-site helper for turning a normal static file into a self-contained encrypted HTML file.

Current version: `0.9.x`.

It can run as:

- a static browser app on GitHub Pages for HTML, PDF, images, and downloadable files
- a local Node.js CLI for the same static file wrapper format

The output contains:

- a generic password screen
- a visible security note for maintainers
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
2. derives an encryption key from the passphrase with PBKDF2-SHA256
3. encrypts the file bytes with AES-GCM
4. downloads a new self-contained encrypted `.html` file

The source file and passphrase are not uploaded to GitHub Pages or any backend.

Unlocked behavior depends on the original file type:

- HTML renders in a sandboxed preview, with a separate action to open it as active HTML
- PDF opens in an embedded browser PDF view
- images render inline
- other files get Open and Download actions

The browser app is designed for small to medium static artifacts. It warns for larger files because browser memory use and the generated wrapper size both grow with the source file.

## CLI usage

```bash
node ./bin/self-encrypt.mjs \
  --in report.pdf \
  --out report_encrypted.html \
  --title "Protected report"
```

The password is requested interactively and is not passed as a CLI argument.

For automation you can use stdin:

```bash
printf '%s\n' "$PITCH_PASSWORD" | node ./bin/self-encrypt.mjs --in input.html --out locked.html --stdin-password
```

## Security boundary

This is a static curiosity barrier, not server-side access control.

Salt, IV, KDF parameters, and ciphertext are intentionally stored in the generated HTML because browser-side decryption needs them. Salt and IV are not secrets.

Anyone who downloads the generated HTML can attempt offline password guesses. Use a strong passphrase for real confidentiality, and use server-side access control when access must be enforceable.

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
