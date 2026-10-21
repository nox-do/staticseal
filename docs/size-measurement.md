# Reproducible size measurement

From a checkout with the locked development dependencies installed (`npm ci`):

```sh
npm run --silent measure:size > /tmp/staticseal-size.json
```

The command runs the normal build, then invokes the actual CLI for all eight
combinations of passphrase/sealed, raw/gzip and file/page mode. It prints only JSON
to stdout and removes temporary input/reader files even on failure. It adds no
runtime dependencies, product options, instrumentation or size budgets. A failed
build, CLI invocation, missing payload or unexpected compression/version fails the
measurement rather than silently measuring a different case. The CLI itself
verifies the content and metadata roundtrip for every generated reader.

## Fixed inputs and options

The fixtures are defined literally in `scripts/measure-size.mjs`, encoded as UTF-8,
and identified by byte length and SHA-256 in the report. Both are self-contained
HTML so the same input can exercise both display modes:

- `small-raw`: a 172-byte page with one German paragraph and an emoji, below the
  existing 4 KiB compression threshold.
- `repeated-gzip`: a 139,368-byte page repeating that paragraph 2,048 times, large
  enough that automatic gzip pays for its unpacker in all four reader variants.

Compression uses the unchanged product selection. There is no forced-compression
or disable-compression hook. These are two different workloads; their sizes must
not be interpreted as the savings from compressing the same original input.

All readers use `sample.html`, public filename/type, the title
`Größenmessung – Staticseal`, the button label `Öffnen`, 210,000 PBKDF2 iterations,
65,536 Base64 characters per chunk, the full opening screen and no theme. The
literal test passphrase is `staticseal-size-fixture-only`, supplied through stdin.
Only access and `--html-page` vary within each fixture. The report records these
options. All current fixtures fit in one chunk; this is not a large-file benchmark.

## Byte definitions

- `app.utf8Bytes`: actual bytes of built `index.html`, including its final newline;
  its SHA-256 identifies the exact artifact.
- `htmlBytes`: actual bytes of the CLI-written reader, checked against the UTF-8
  byte length of its decoded text. Non-ASCII titles/labels ensure character counts
  would differ from these measurements.
- `payloadJsonBytes`: UTF-8 bytes of the exact JSON text inside the emitted
  `encrypted-payload` script block, including Base64, metadata and JSON formatting.
  It is measured before parsing, without reserializing or undoing HTML escaping.
- `wrapperBytes`: `htmlBytes - payloadJsonBytes`. This includes the payload script
  tags, HTML, styles, logo, opening screen and executable reader, including optional
  crypto/gzip and the selected viewer. This is not a separate JavaScript-only size.
- `binaryPackageBytes`: decoded Base64 content/ciphertext plus the GCM tag when
  present, including the four-byte prefix and inner metadata header. This is a
  second view of the payload, not an additional part of `htmlBytes`.

Thus `htmlBytes = payloadJsonBytes + wrapperBytes` exactly. No HTTP transfer
compression, source-module disk sizes, memory usage or timing is measured.

## Recorded baseline

[size-baseline.json](size-baseline.json) records the measurement on 2026-10-21
against product commit `74a367b05ec3aa5dcb86099cff44016111d5d737`, using Node
v22.22.2 and the zlib version recorded there on macOS arm64. The only tracked
change at capture was the measurement command in `package.json`; the measurement
script was new. Product sources and generated production files were unchanged.
The measurement tooling and this baseline are committed together in the following
commit, whose identifier can be found with `git log -- docs/size-baseline.json`.

Built app: **41,080 UTF-8 bytes**. Reader sizes in bytes:

| Fixture | Mode | Access | HTML | Payload JSON | Wrapper |
| --- | --- | --- | ---: | ---: | ---: |
| small-raw | file | passphrase | 17,286 | 575 | 16,711 |
| small-raw | file | sealed | 16,244 | 419 | 15,825 |
| small-raw | page | passphrase | 10,554 | 592 | 9,962 |
| small-raw | page | sealed | 9,512 | 436 | 9,076 |
| repeated-gzip | file | passphrase | 18,790 | 1,271 | 17,519 |
| repeated-gzip | file | sealed | 17,748 | 1,115 | 16,633 |
| repeated-gzip | page | passphrase | 12,058 | 1,288 | 10,770 |
| repeated-gzip | page | sealed | 11,016 | 1,132 | 9,884 |

Two consecutive runs produced identical complete JSON reports. Encryption still
uses fresh random salt and IV; ciphertext bytes differ but their Base64 lengths
and these sizes do not. No random source is replaced for measurement.

For comparisons, keep the lockfile, Node/zlib runtime, fixtures and options fixed.
Compare `app` and `readers`; `sourceCommit`, `trackedChanges` (tracked differences
from HEAD, including staged changes) and `runtime` provide provenance and can
legitimately differ. A report from a dirty checkout measures that checkout, not
necessarily the recorded HEAD. zlib/runtime changes may change gzip sizes; the
app hash can also change after build-tool updates.

The readers are generated by the CLI with the built shared reader templates.
Browser-created reader bytes can differ because the browser build serializes its
own minified functions. This command measures the complete browser creator app,
but does not automate browser generation or establish browser compatibility.
Private filenames, themes, minimal screens, multi-chunk payloads, incompressible
large files and other content types are outside this representative baseline.
