# Abschlussprüfung AP1–AP5

Stand: 21. Oktober 2026. Aktuelle Beschreibung: [Architektur](architecture.md).

## Bezugsstände und Ergebnis

- AP1-Ausgangswerte: Produktcommit `74a367b05ec3aa5dcb86099cff44016111d5d737`,
  unverändert aufbewahrt in [size-baseline.json](size-baseline.json).
- Finaler Produkt-/Buildstand: `a9f9b92bd458c71af33c57812a58807ee4de70ef` nach AP4.
  AP5 verändert weder Produktquellen, Build noch generierte Produktionsdateien;
  es ergänzt Dokumentation, Messnachweise und eine Reader-Regressionsprüfung.
- Finale Messung: [size-final.json](size-final.json), vor den AP5-Dokumentations-
  und Teständerungen bei sauberem Produktstand erfasst. Der AP5-Abschlusscommit
  ist über `git log -- docs/refactoring-validation.md` auffindbar.
- Buildnachweis: [build-verification.json](build-verification.json) mit SHA-256,
  Dateigrößen, Produktcommit, Runtime, Buildwerkzeugen und Lockfile-/Buildscript-Hash.

Der bestehende Build bleibt bestehen. Die Prüfung ergab keinen konkreten Fehler,
der einen Umbau verlangt. Payload-Versionen, AAD-Reihenfolge, Browser-/CLI-Grenzen
und Laufzeitabhängigkeiten bleiben unverändert. Es gibt keine neuen Größenbudgets.

## Reproduzierbarkeit

Geprüft mit Node v22.22.2, zlib `1.3.1-e00f703`, npm 10.9.7 unter macOS arm64.
Installierte Buildwerkzeuge: clean-css 5.3.3, html-minifier-terser 7.2.0 und
Terser 5.51.2. `npm ls --all` meldete einen gültigen Abhängigkeitsbaum.

Zwei aufeinanderfolgende normale Builds erzeugten für alle vier Produktionsdateien
identische Bytes/Hashes. Die Ergebnisse entsprechen auch den bereits eingecheckten
Dateien. Zwei aufeinanderfolgende Größenmessungen lieferten identische vollständige
JSON-Berichte. Eingaben, Optionen und Runtime stimmen mit AP1 überein.

Nach Installation der Lockfile-Abhängigkeiten mit `npm ci` lässt sich die Prüfung
mit derselben Toolchain wiederholen:

```sh
npm run build
shasum -a 256 index.html src/logo.mjs src/wrapper-template.mjs src/reader-factories.mjs > /tmp/staticseal-build-first.sha256
npm run build
shasum -a 256 index.html src/logo.mjs src/wrapper-template.mjs src/reader-factories.mjs > /tmp/staticseal-build-second.sha256
cmp /tmp/staticseal-build-first.sha256 /tmp/staticseal-build-second.sha256
npm run --silent measure:size > /tmp/staticseal-size-first.json
npm run --silent measure:size > /tmp/staticseal-size-second.json
cmp /tmp/staticseal-size-first.json /tmp/staticseal-size-second.json
npm run check
```

Änderungen an Commit, Arbeitsbaum oder Runtime zwischen Größenläufen erscheinen
absichtlich in der Provenienz. Andere Toolchain-Versionen können andere Bytes
liefern. Passwort-Reader selbst verwenden weiterhin zufällige Salts/IVs und sind
nicht bytegleich; reproduzierbar sind Build und gemessene Größen. Es wird keine
Zufallsquelle für die Messung ersetzt.

## Größenvergleich mit AP1

Alle Werte sind tatsächliche UTF-8-Bytes. Die [Messmethode](size-measurement.md)
und Testdaten bleiben gleich. Die gebaute App wächst von **41.080 auf 41.488 Bytes**:
**+408 Bytes, rund +0,99 %**.

| Testdaten | Modus | Zugriff | HTML AP1 | HTML final | Änderung | Payload JSON, unverändert | Wrapper AP1 → final |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| small-raw | Datei | Passwort | 17.286 | 17.369 | +83 | 575 | 16.711 → 16.794 |
| small-raw | Datei | Sealed | 16.244 | 16.357 | +113 | 419 | 15.825 → 15.938 |
| small-raw | Webseite | Passwort | 10.554 | 10.679 | +125 | 592 | 9.962 → 10.087 |
| small-raw | Webseite | Sealed | 9.512 | 9.667 | +155 | 436 | 9.076 → 9.231 |
| repeated-gzip | Datei | Passwort | 18.790 | 18.875 | +85 | 1.271 | 17.519 → 17.604 |
| repeated-gzip | Datei | Sealed | 17.748 | 17.863 | +115 | 1.115 | 16.633 → 16.748 |
| repeated-gzip | Webseite | Passwort | 12.058 | 12.185 | +127 | 1.288 | 10.770 → 10.897 |
| repeated-gzip | Webseite | Sealed | 11.016 | 11.173 | +157 | 1.132 | 9.884 → 10.041 |

In jeder Zeile gilt exakt `HTML = Payload JSON + Wrapper`. Auch binäre Paketgröße,
Chunkzahl, Originalgröße und Payload-Version stimmen mit AP1 überein. Die gesamte
Differenz liegt im Wrapper einschließlich Reader-Code, nicht in zusätzlichen
Metadaten oder veränderten Dateiinhalten.

Die Änderungen sind aus den Arbeitspaketen erklärbar:

- AP2: Gemeinsame Versionsregeln und technische Konstanten werden als eigenständige
  Factory eingebettet. Das vergrößert die App um 755 Bytes sowie Reader um 359 Bytes
  ohne gzip bzw. 389 Bytes mit gzip, einschließlich explizitem Entpacklimit.
- AP3: Gemeinsame Metadaten-/Paketvorbereitung vergrößert nur die Ersteller-App um
  250 Bytes. Die CLI-Reader bleiben gleich; Erstellungslogik wird nicht eingebettet.
- AP4: Wegfall der privaten Namensreservierungen spart 597 App-Bytes und abhängig
  von Viewer, Kryptografie und gzip 204–304 Reader-Bytes. Deshalb unterscheiden sich
  die verbleibenden Zuwächse je Variante.
- AP5: Keine weitere Änderung an Build- oder Produktbytes.

Die zwei Testdatensätze sind verschiedene Arbeitslasten. Der Vergleich behauptet
keine Kompressionsersparnis für denselben Originalinhalt, keine HTTP-Transfergröße
und keine repräsentative Kapazitätsmessung für beliebige Dateitypen.

## Reader-Einbettung und Erstellungsgrenze

Der Build erzeugt weiterhin nur `index.html`, `logo.mjs`, `wrapper-template.mjs`
und `reader-factories.mjs`. Die Factory-Registry enthält Format-, Vorschau-,
Krypto-, Entpack- und Viewer-Helfer sowie das HTML-Dateiprädikat, keine Paket-
oder Kompressionsvorbereitung. Wrapper-Erzeugung serialisiert nur den passenden
Decoder/Viewer und bei Bedarf den Entpacker. Der optionale Restore-Marker verwendet
den tatsächlichen minifizierten Variablennamen; Testnamen müssen nicht erhalten
bleiben. Der Build schützt die für eigenständige Factories nötigen Funktionsgrenzen.

Die neue Regression prüft acht über die gebaute App und acht über die echte CLI
erzeugte Reader: Passwort/Sealed × raw/gzip × Datei/Webseite. Bei deren Ausführung
fehlen `CompressionStream`, `Response`, `fetch` und Erstellungszufall. Verschlüsselte
Reader dürfen Schlüssel importieren/ableiten und entschlüsseln, aber nicht
verschlüsseln, Schlüssel generieren oder verpacken. Sealed-Reader erhalten überhaupt
kein Web Crypto. Es bleiben keine Buildmarker oder externen Script-/Stylesheet-
Verweise zurück; Inhalte werden exakt wiederhergestellt. Diese Prüfung läuft in
isolierten Node-VMs mit DOM-Stubs und ist ausdrücklich kein echter Browsertest.

Die bisherigen Prüfungen behalten Manipulationen, falsche Passphrasen, Header-
und gzip-Grenzfälle, Privatsphäre, UI-Zustände und Größenlimits bei. Die separate
Node-Verschlüsselungsprüfung verlangt unverändert drei Übergaben von Präfix,
Header und Originalpuffer und verbietet dessen Zusammenkopieren zum Klartextpaket.

## Gesamtergebnis und echte Browserprüfung

- `npm run check`: **42 Tests bestanden, 0 fehlgeschlagen**, einschließlich
  Build-Aktualitätsprüfung, CLI-Hilfe und vollständiger Regression.
- `git diff --check`: erfolgreich.
- Echter In-App-Browser, Chromium **155.0.0.0**, macOS: **21 PASS und DONE** mit
  unveränderter gebauter App und echten CLI-Dateien. Geprüft wurden beide Formulare,
  Script-Parser-Grenzfälle, sechs Vorschauen, bytegenaue 10/25-MiB-Datei-Blobs,
  falsche Passphrasen, HTML-Auswahl sowie alle acht App-/CLI-Seitenvarianten mit
  CSS, Script-Ausführung, Interaktion, vollständigem Inhalt und CLI-Fragmentlinks.

Als allgemeine steuerbare Browser-Testumgebung war in dieser Sitzung nur der
In-App-Browser verfügbar; es wurden keine weiteren Browserläufe behauptet.

Der echte Browser-Smoke-Test ist wiederholbar:

```sh
node test/build-browser-smoke.mjs /tmp/staticseal-browser-smoke
python3 -m http.server 8766 --bind 127.0.0.1 --directory /tmp/staticseal-browser-smoke
```

`http://127.0.0.1:8766/smoke.html` im Browser öffnen und 21 PASS plus DONE prüfen.
Der Harness beobachtet tatsächliche Datei-Blobs an der Object-URL-Schnittstelle;
er unterdrückt automatische Testdatei-Downloads. Er verwendet keine privaten
Funktionsnamen und verändert die ausgelieferten HTML-Dateien nicht.

**Nicht geprüft:** Firefox, Safari, Edge als eigenes Produkt, iOS, Android,
andere Node-Versionen, `file://` in diesem Abschlusslauf, OS-Downloadmanager,
PDF-Rendering, strenge Hosting-CSP/Trusted Types, Spitzen-RAM und mobile Kapazität.
Der Smoke-Test verlangt kein zweites iframe-`load`-Ereignis nach `document.write`;
das Verhalten eigener Seiten-Load-Handler wird hier nicht zugesichert. Browser-
Produktgrenzen bleiben vorläufig; CLI-Erfolg belegt keine Empfängerkapazität.
