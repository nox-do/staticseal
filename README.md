# self-encrypted

Small static-site helper for turning a normal static file into a self-contained encrypted HTML file.

It can run as:

- a static browser app on GitHub Pages for HTML, PDF, images, and downloadable files
- a local Node.js CLI for HTML files

The output contains:

- a generic password screen
- a visible security note for maintainers
- PBKDF2-SHA256 key derivation
- AES-GCM encrypted file payload
- chunked ciphertext so the generated file remains somewhat readable and tooling-friendly
- a decrypt roundtrip check before writing the output
- direct browser rendering for unlocked HTML, PDF, and images
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

- HTML replaces the wrapper page and renders directly
- PDF opens in an embedded browser PDF view
- images render inline
- other files get Open and Download actions

## CLI usage

```bash
node ./bin/self-encrypt.mjs \
  --in ../newio/praxis-upload-journey-unencrypted.html \
  --out ../newio/praxis-upload-journey.html \
  --title "Praxis Upload Modul - geschützter Pitch"
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
