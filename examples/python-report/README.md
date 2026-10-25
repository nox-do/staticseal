# Python-Bericht bündeln

Jinja2 rendert das HTML, Matplotlib erzeugt eine PNG. Die Quelldateien bleiben
separat: `bericht.html`, `bericht.css`, `umsatz.png`.

Im Beispielordner:

```sh
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python generate.py
```

Aus dem Staticseal-Repository-Root mit installierten npm-Abhängigkeiten:

```sh
node bin/self-encrypt.mjs --in examples/python-report/bericht.html \
  --out examples/python-report/sealed.html --bundle
```

Die CLI bettet CSS und PNG ein und fragt nach einer Passphrase. Für automatisierte
Jobs gibt es `--stdin-password`. Das öffentliche Beispiel verwendet zusätzlich
`--no-password` und enthält ausschließlich fiktive Daten.

Zur Weitergabe reicht `sealed.html`. Zum Offline-Test diese Datei ohne Quellordner
und Netzwerk öffnen: Layout, Kennzahlen und Grafik müssen erhalten bleiben.
