# Staticseal Befunde und Arbeitsplan

Stand: 19. Oktober 2026. Grundlage ist der aktuelle Arbeitsstand im Repository einschließlich des bereits implementierten Großdateien-Fixes. F1, F3/F3a und F4 sind auf dem Branch `codex/privacy-and-passphrase-options` implementiert. Die folgenden Abschnitte dokumentieren Anforderungen und verbleibende Validierung.

Staticseal soll einzelne Dokumente lokal in eine eigenständige, offline nutzbare HTML-Datei verpacken. Für kleine bis mittlere Dateien bleibt diese Architektur sinnvoll. Vorrang haben eine ehrliche Beschreibung der Schutzwirkung, weniger Schlüsselableitungen und Speicherduplikate sowie Browser-Validierung. Ein Streaming-Dateiformat oder interaktive HTML-Ausführung wären eigenständige Erweiterungen.

## Geprüfte neue Befunde

### F1 Sichtbare Dateinamen und Metadaten

**Bestätigt, beide Generatoren.** `filename` und `contentType` stehen im unverschlüsselten Payload-JSON. Sie sind über AES-GCM Additional Authenticated Data gegen unbemerkte Manipulation geschützt, aber nicht geheim. Der Originalname erscheint zusätzlich im HTML-Kommentar `Generated from`. Der Titel steht in `<title>` und `<h1>`: Die App übernimmt standardmäßig den Namen ohne Erweiterung; die CLI nutzt den Namen mit dem Zusatz `- protected file`. Auch der voreingestellte Ausgabename der App enthält den ursprünglichen Basisnamen.

Damit bleibt beispielsweise „Quartalszahlen_intern“ vor dem Entschlüsseln erkennbar. Einen neutralen Titel zu wählen oder nur den Kommentar zu entfernen reicht nicht. Die README erklärt bislang weder diese Offenlegung noch den Unterschied zwischen authentifizierten und verschlüsselten Metadaten ausdrücklich. Die sichtbare Dateigröße bleibt ebenfalls ein Informationskanal.

Codebelege: `encryptBytes`, `authenticatedDataFor`, `renderWrapper` in [index.html](../index.html) und [bin/self-encrypt.mjs](../bin/self-encrypt.mjs); außerdem `outputFilenameFor` und der Dateiauswahl-Handler der App sowie `main` der CLI.

**Implementiert:** Die Web-App bietet die Option „Dateinamen mitverschlüsseln“. Bei Aktivierung wird der Originalname innerhalb eines versionierten, authentifiziert verschlüsselten Inhalts gespeichert und erst nach dem Entschlüsseln für Anzeige und Download verwendet. Der MIME-Typ kann im selben inneren Metadatenobjekt liegen; die öffentliche Formatbeschreibung enthält nur die zum Entschlüsseln benötigten Angaben. Auf ausdrückliche Produktentscheidung gibt es keine Rückwärtskompatibilität zum vorherigen Projektstand. Beide Namensoptionen verwenden denselben neuen Inhaltsparser.

Die Option muss alle Offenlegungsstellen berücksichtigen: neutraler öffentlicher Titel, neutraler Ausgabename, kein Originalname im Payload-JSON oder Herkunftskommentar. Bereits aus dem Dateinamen vorbelegte Felder werden beim Aktivieren neutralisiert. Eigene Titel sind ausdrücklich öffentlich; vor dem Erzeugen dürfen sie den zu verbergenden Namen nicht versehentlich weitertragen. Ohne aktivierte Option wird die Sichtbarkeit des Namens verständlich erklärt. Die Option ist zunächst ausgeschaltet. Die CLI bietet `--private-filename`; der Aufrufer wählt dort selbst einen neutralen Ausgabepfad.

Im Sealed-Modus bedeutet diese Option lediglich, dass der Name nicht unmittelbar im Klartext steht. Da der Unlock-Key mitgeliefert wird, kann jeder den Namen und Inhalt auslesen. Die UI darf dafür keine Vertraulichkeit versprechen.

**Abnahme:** Mit eindeutigem Testnamen alle Klartextstellen im HTML und den Ausgabenamen prüfen. Bei aktivierter Option darf der Originalname vor dem Entschlüsseln nirgends erscheinen; danach stimmen Downloadname, MIME-Typ und Dateiinhalt. Wechsel der Option sowie bereits ausgefüllte Titel testen. Frühere Payload-Formate werden abgelehnt; Manipulation innerer und äußerer authentifizierter Metadaten wird abgelehnt. Für die Wrapper nur den erforderlichen kompakten Parser ergänzen, keine Generator- oder UI-Bibliotheken einbetten.

### F2 HTML Vorschau führt kein JavaScript aus

**Bestätigt mit Präzisierung.** Beide `renderBlobViewer`-Implementierungen setzen für HTML `sandbox=""`. JavaScript läuft in dieser Vorschau nicht; scriptbasierte interaktive Onepager funktionieren dort nicht. Das Original wird unverändert verschlüsselt und kann nach dem Download außerhalb der Vorschau ausgeführt werden.

„Ohne Navigation“ wäre zu weitgehend: Insbesondere Top-Level-Navigation, Popups und Formularübermittlung sind eingeschränkt; Navigation innerhalb des iframe ist nicht pauschal ausgeschaltet. Statische HTML/CSS-Funktionen können weiterhin funktionieren. Siehe [MDN zur iframe-Sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox).

Die README erwähnt bereits eine sandboxed preview und den Download aktiver Inhalte. In der Produktbeschreibung „HTML onepagers“ und direkt im Auswahl-/Vorschaukontext fehlt aber die klare Aussage „JavaScript wird in der Vorschau nicht ausgeführt“. Außerdem werden externe Assets nicht mitverpackt: Eine eigenständige Wrapper-Datei macht ein HTML-Dokument mit externen Abhängigkeiten nicht automatisch offline vollständig.

**Entschieden:** Die bestehende Vorschau und Sandbox bleiben vorerst unverändert. Erweiterungen für interaktive HTML-Dateien werden auf später verschoben. Der aktuelle Funktionsumfang kann in Produkttexten und README präzisiert werden; ein neuer Ausführungsmodus gehört nicht zum nächsten Umsetzungsschritt.

**Regression:** Statische Vorschau und bytegleicher Download bleiben erhalten. Keine zusätzlichen Sandbox-Berechtigungen erteilen. Echte Browser-Tests bleiben Bestandteil von F6.

### F3 KDF Einstellungen und Passphrase Qualität

**Bestätigt.** App-Presets: 160.000, 210.000 als „Recommended“, 420.000. CLI-Standard: 210.000, zulässiges Minimum: 100.000. Die aktuelle [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#pbkdf2) nennt für PBKDF2-HMAC-SHA256 600.000 Iterationen. Alle App-Presets liegen darunter. Die Quelle behandelt Passwortspeicherung; sie ist eine relevante Orientierung für Offline-Raten, aber keine eigenständige Sicherheitszertifizierung für diesen Datei-Wrapper.

Die App verlangt nur übereinstimmende Eingaben; leere Eingaben wählen Sealed. Die CLI lehnt eine leere Passphrase im Passwortmodus ab und vergleicht interaktive Wiederholungen. Eine Mindestlänge oder Stärkeprüfung gibt es in keinem der beiden Erstellungswege. Auch eine einzelne Zeichen-Passphrase wird akzeptiert. Ein starker KDF kompensiert keine leicht erratbare Passphrase.

**Präzisierung:** PBKDF2 wird derzeit auch im Sealed-Modus ausgeführt, mit einem zufälligen eingebetteten `unlockKey`. Die Schutzwirkung gegen Passwort-Raten ist dort nicht relevant: Jeder Besitzer des Wrappers hat den Schlüssel. PBKDF2 zu überspringen wäre eine Änderung des Ableitungspfads und muss als eindeutige Formatänderung beschrieben werden.

**Implementiert:** Die höheren PBKDF2-HMAC-SHA256-Stufen werden zusätzlich angeboten und ersetzen die bestehenden Optionen nicht.

| Iterationen | Zielstand |
| --- | --- |
| 160.000 | Bestehende Option beibehalten |
| 210.000 | Bestehende Option beibehalten |
| 420.000 | Bestehende Option beibehalten |
| 600.000 | Zusätzliche höhere Stufe |
| 1.200.000 | Zusätzliche höchste Stufe; insbesondere Mobil-Laufzeit prüfen |

**Beibehaltener Default:** Weil die neuen Werte zusätzlich angeboten werden sollen, bleiben Vorauswahl und CLI-Standard zunächst bei 210.000. Eine Änderung des Defaults wurde damit nicht erneut festgelegt. Die bisherige Bezeichnung „Recommended“ wurde durch „Default“ ersetzt. Hilfetexte erklären die Kosten und kennzeichnen 600.000 als OWASP-Orientierungswert. Die 1.200.000-Stufe ist eine Produktoption, keine separate OWASP-Vorgabe.

Dropdown-Werte, Beschriftungen, `KDF_PRESETS`, Validierung und Hilfetexte wurden gemeinsam erweitert. Die CLI erlaubt höhere Werte bereits über `--iterations`; Standard und Untergrenze bleiben vorerst unverändert. README und CLI-Hilfe erklären die zusätzlichen Auswahlmöglichkeiten konsistent.

**Begründung:** PBKDF2 erschwert auch bei offline verfügbaren Dateien das Passwort-Raten, weil jeder Kandidat eine Schlüsselableitung erfordert. 600.000 statt 210.000 Iterationen erhöhen deren Rechenaufwand ungefähr um den Faktor 2,86. Das begrenzt keine Versuche und ersetzt kein starkes Geheimnis. Im Sealed-Modus schaffen höhere Werte keine zusätzliche Vertraulichkeit; dessen bisheriger Ableitungspfad bleibt bestehen.

**Formatentscheidung:** Die Wrapper lesen die Iterationszahl weiterhin aus dem Payload. Alle fünf KDF-Stufen werden im einheitlichen Format `v: 2`, `encoding: "metadata"` unterstützt. Für frühere Inhaltsformate wird keine Kompatibilität vorgehalten; ihre Decoderzweige sind entfernt.

**Passphrase-Qualität ist Nutzerentscheidung:** Keine neue Mindestlänge, erzwungene Stärkeprüfung oder Sonderzeichenregel. Die bisherigen Prüfungen auf übereinstimmende Eingaben und die Abgrenzung zum Sealed-Modus bleiben bestehen. Stattdessen erhält die Web-App einen optionalen Generator für ein starkes Geheimnis.

### F3a Kompakter Passphrase Generator

**Produktentscheidung:** Ein Button „Starke Passphrase erzeugen“ bietet eine lokale Generierung mit Nutzerinteraktion an. Generator, Interaktionsfläche und etwaige Hilfsdaten bleiben ausschließlich in der Erstellungs-App. Die erzeugten HTML-Wrapper enthalten davon nichts; sie benötigen weiterhin nur das normale Passwortfeld und den vorhandenen KDF-Pfad.

**Implementierte Bedienung:** Eine kleine Fläche nimmt 24 Maus- oder Touchereignisse auf; als zugängliche Alternative sind Tastendrücke möglich. Danach kann der Nutzer das Ergebnis anzeigen, kopieren und in beide Passphrase-Felder übernehmen. Erst die ausdrückliche Übernahme ersetzt vorhandene Eingaben. Keine Aufzeichnung außerhalb dieses Generierungsdialogs und keine Übertragung oder Speicherung der Bewegungsdaten.

**Zufallsquelle:** Frische kryptografische Zufallsbytes aus `crypto.getRandomValues()` sind immer die Grundlage; Nutzerereignisse werden zusätzlich mit einer Standard-Hashfunktion eingemischt. Mausbewegungen, Zeitstempel und Eventanzahl sind kein verlässlich quantifizierbarer Entropienachweis. Die UI zeigt deshalb Interaktionsfortschritt, keine angeblich gesammelten Sicherheitsbits. Keine Verwendung von `Math.random()` und kein Fallback auf ausschließlich Nutzereingaben bei fehlender Web Crypto. Siehe [Web Crypto zur sicheren Zufallserzeugung](https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/).

**Kompakter Entwurf:** Als erste Variante ein kopierbares zufälliges Geheimnis mit mindestens 128 Bit Zufallsbasis statt einer großen eingebetteten Wortliste anbieten. Beispielsweise lassen sich 16 zufällige Bytes verlustfrei als 22 Base64url-Zeichen darstellen. Bei Einmischung der Nutzereingaben vor der Ausgabe einen entsprechend dimensionierten Hash-Auszug verwenden. Implementiert sind 22 Base64url-Zeichen aus 16 Bytes des SHA-256-Digests und 24 Eingabeereignisse; die Bewegung darf nicht als alleinige Sicherheitsquelle erscheinen. Wortbasierte, leichter diktierbare Passphrasen wären eine spätere Alternative, falls dafür Bedarf besteht.

**Abnahme für F3 und F3a:** Alle fünf Iterationswerte in Payloads und unabhängigen Wrapper-Roundtrips prüfen; Ablehnung früherer Formate, falsche Passwörter und Metadatenmanipulation abdecken. Beide Zugriffsmodi bleiben funktionsfähig. Laufzeiten der höheren Stufen auf Desktop und Mobilgeräten messen. Generator mit Maus, Touch und Tastatur prüfen; sichere Zufallsquelle, Fehlerfall bei deren Ausfall, explizite Übernahme, Kopieren und Abbruch abdecken. Tests prüfen die Konstruktion und nicht vermeintliche Entropie anhand weniger Beispielausgaben. Generierte Geheimnisse und Nutzerereignisse dürfen weder in Logs noch im Passwort-Payload landen. Die Wrappergröße darf durch den Generator nicht steigen.

## Bereits behobene Großdateienprobleme

| Befund | Aktueller Stand |
| --- | --- |
| Argument-Spread über alle Ciphertext-Blöcke verursacht RangeError | In App-Rückprüfung und beiden generierten Decodern durch sequenzielles Dekodieren in einen vorab dimensionierten Puffer ersetzt |
| 69-Byte-Blöcke verursachen viele Objekte | Neue Standardblöcke mit 65.536 Base64-Zeichen, entsprechend 49.152 Rohbytes |
| Zusätzliche Vollkopie zum Anhängen des GCM-Tags | Tag wird direkt an das Ende des Zielpuffers geschrieben |
| Kopien beim Aufteilen der App-Daten | `subarray` statt `slice` an den betroffenen Stellen |
| Keine automatischen Regressionstests | Node-Tests vorhanden; `npm run check` führt zusätzlich die Suite aus |

Bei 10 MiB sinkt die Blockzahl von 151.968 auf 214, bei 25 MiB von 379.919 auf 534. Base64 und JSON-Blockformatierung verursachen nun ungefähr 33,35 % statt etwa 45 % Zusatzgröße, zuzüglich des festen HTML-Templates. Die Blöcke dienen weiterhin der Speicherung, nicht dem Streaming der Verschlüsselung.

Die erweiterten Node-22/Web-Crypto-Tests prüfen 10 und 25 MiB in beiden Zugriffsmodi, beide Generatoren, bytegenaue Rückprüfung, sichtbare und private Dateinamen, falsche Passwörter sowie manipulierte Metadaten und Tags. Ein zusätzlicher Test prüft jedes authentifizierte Metadatenfeld. Die DOM-Stubs sind keine Browser-Tests. Die Suite umfasst außerdem die Ablehnung früherer Formate und private Ausgabenamen bei Änderungen während des Einlesens.

Bereits verteilte HTML-Dateien behalten ihren eigenen eingebetteten Decoder. Der neue Decoder unterstützt nur das vereinheitlichte Format; für aktuelle Ausgaben muss aus dem Originalinhalt neu erzeugt werden.

## Weitere offene Arbeiten

### F4 Doppelte Schlüsselableitung reduzieren

App und CLI leiten beim Erstellen jetzt genau einmal ab und verwenden das Ergebnis für Verschlüsselung und Rückprüfung. Das gilt für beide Zugriffsmodi und wird durch instrumentierte Tests nachgewiesen. In der App bleibt der `CryptoKey` nicht exportierbar und erhält die erforderlichen Verwendungen `encrypt` und `decrypt`. Der Schlüssel wird nicht im Passwort-Payload gespeichert.

Die Rückprüfung muss weiterhin den erzeugten Base64-Payload dekodieren, seine authentifizierten Metadaten verwenden, entschlüsseln und bytegenau vergleichen. Sie darf nicht nur den schon vorhandenen Roh-Ciphertext prüfen. Unabhängige Wrapper-Tests müssen die Schlüsselableitung aus Passwort und gespeicherten Parametern weiterhin selbst durchführen.

**Abnahme:** Genau eine PBKDF2-Ableitung pro Erstellung in App und CLI nachweisen; Roundtrip und unabhängige Wrapper-Entschlüsselung bestehen weiterhin. Bei unveränderter Iterationszahl entfällt eine PBKDF2-Ausführung, nicht die Hälfte der gesamten Verarbeitungszeit. Die Auswahl einer höheren KDF-Stufe kann den Zeitgewinn teilweise oder ganz aufbrauchen; getrennt messen.

### F5 Speicher und Bedienbarkeit messen und verbessern

Originalbytes, Ciphertext, Base64, JSON/HTML, Download-Blob und Roundtrip-Klartext können gleichzeitig existieren. Web Crypto und die Vorschau benötigen weitere Ressourcen. Der Spitzenverbrauch ist unbekannt. Die gesamte Datei wird vor der Vorschau eingelesen und entschlüsselt. Synchrone Konvertierungen, Kopieren und JSON können den Hauptthread blockieren.

**Nächster Schritt:** Phasenzeiten und maximalen Prozessspeicher an repräsentativen Geräten messen. Anschließend weitere Kopien und Lebensdauer großer Objekte reduzieren. Web Worker für aufwendige Verarbeitung evaluieren; beim Datentransfer zusätzliche Kopien vermeiden. Ein Worker verbessert potenziell die Bedienbarkeit, beseitigt aber den Gesamtbedarf nicht.

**Abnahme:** Vergleich vor/nach Änderung mit identischen Dateien, Browsern und Geräten; vollständiger Zyklus von Auswahl bis Download sowie Öffnen bis Vorschau. Keine bloßen JavaScript-Heap-Werte als gesamter Speicherbedarf ausgeben.

### F6 Größenlimits durch Browser und Mobiltests validieren

Aktuell implementierte Browser-Produktgrenzen: Warnung ab 5 MiB, regulärer Ablauf bis einschließlich 10 MiB, darüber Bestätigung bis einschließlich 25 MiB, Ablehnung oberhalb 25 MiB vor dem Einlesen. Die CLI hat keine entsprechende harte Obergrenze. Erfolgreiche CLI-Erzeugung garantiert keine erfolgreiche Browser-Vorschau.

Diese Grenzen begrenzen das Risiko eines hohen Ressourcenverbrauchs; sie sind keine nachgewiesenen Browserkapazitäten oder Supportgarantien. Tests fehlen für Desktop Chrome, Firefox, Safari sowie Safari/iOS und Chrome/Android auf eingeschränkten Geräten. PDF, Bilder und HTML benötigen eigene Vorschaufälle. Einzelne Geräte können schon unterhalb 25 MiB scheitern.

**Abnahme:** Beide Modi und Generatoren bei 5/10/25 MiB; Warn-/Bestätigungsgrenzen einschließlich eines Bytes darüber; falsche Passwörter, Manipulation, Downloads und wiederholtes Öffnen. Geräte-/Browserversion, Laufzeit, Speicher und Bedienbarkeit protokollieren. Erst danach den unterstützten Größenbereich zusagen oder die Grenzen senken.

## Umsetzung und verbleibende Validierung

Die Erstellungsoberfläche zeigt direkt Dateiauswahl, optionale Passphrase mit Wiederholung und den Erstellen-Button. Generator, private Dateinamen, Titel/Ausgabename und KDF-Auswahl liegen im standardmäßig geschlossenen Bereich „Advanced“. Der native Expander wurde im eingebetteten Browser per Klick und Enter geprüft.

- **F1 umgesetzt:** Option zum Mitverschlüsseln von Name und MIME-Typ, zunächst ausgeschaltet; neutraler öffentlicher Titel und Ausgabename in der App. CLI-Pendant `--private-filename`. Einheitlicher v2-Inhaltsparser ohne frühere Decoderpfade.
- **F3 umgesetzt:** 600.000 und 1.200.000 zusätzlich, bisheriger Default und CLI-Untergrenze beibehalten. Keine verpflichtende Stärkeprüfung.
- **F3a umgesetzt:** Lokaler Generator mit sicherem Browser-Zufall und 24 zusätzlichen Nutzerereignissen, ausdrücklicher Übernahme, Kopieren und Abbruch. Kein Generatorcode im Wrapper.
- **F4 umgesetzt:** Eine Ableitung pro Erstellung, bytegenaue Rückprüfung einschließlich privater Metadaten, unabhängige Wrapper-Tests.
- **F2 zurückgestellt:** Vorschau und Sandbox unverändert.
- **F5/F6 weiterhin offen:** Prozessspeicher messen; Firefox, Safari, mobile Geräte sowie PDF-/Bildvorschau und vollständige Downloadabläufe validieren. Produktgrenzen bleiben vorläufig.

Vor der Formatvereinheitlichung bestand ein zusätzlicher Browser-Smoke-Test im Codex-Browser (Chromium, User-Agent Chrome 155 auf macOS) für 10/25 MiB, beide Modi, private Dateinamen und 600k Runden. Er prüft bytegenaue Entschlüsselung im erzeugten App-Wrapper, wiederhergestellte Viewer-Metadaten und falsche Passwörter. Die UI-Prüfung bestätigte den Generator per Tastatur, ausdrückliche Übernahme, private Namen und die KDF-Auswahl. Touch, mobiles Verhalten und Spitzenverbrauch sind damit nicht nachgewiesen. Der reproduzierbare lokale Harness liegt in `test/build-browser-smoke.mjs`.

Die 15 Regressionstests nach der Formatvereinheitlichung bestehen unter Node/Web Crypto, einschließlich 10/25 MiB in allen vier Kombinationen aus Zugriffsmodus und Namenssichtbarkeit; der vorherige Browserlauf ist kein neuer Browsernachweis für diese Revision. Durch Entfernen des alten Decoderzweigs sinkt der Codeumfang leicht. Alle Dateien enthalten nun den kleinen inneren Metadatenkopf; im Browser wird dafür auch bei öffentlichen Namen ein zusammenhängender Klartextpuffer erzeugt. Die CLI verarbeitet Kopf und Datei separat ohne diese zusätzliche Vollkopie. Generatorlogik und Nutzerereignisse bleiben in der Erstellungs-App. Ein anderer Sealed-Ableitungspfad, interaktive Vorschau und Streaming sind separate spätere Entscheidungen.

Die Bewegungsfläche zeigt eine begrenzte SVG-Spur (maximal 48 Punkte) als Eingabefeedback, ohne Bibliothek oder Animationstimer. Die Spur ist keine Entropiemessung; sie bleibt ausschließlich in der Erstellungs-App. Die Sicherheitsbasis sind 32 Bytes aus `crypto.getRandomValues`; ausgegeben werden 128 Bit als 22 Base64url-Zeichen. Die 24 Ereignisse begründen keine zusätzliche quantifizierte Entropiezusage.

Die SVG-Spur wurde im eingebetteten Desktop-Browser mit realer Mausbewegung geprüft; Tastatureingabe bis zur Freigabe und Löschen der Spur bei Abbruch funktionieren. Drei gezielte Node/Web-Crypto-Regressionstests bestehen. Touch auf einem echten Mobilgerät bleibt offen.

### Review-Korrektur: sichere JSON-Einbettung

Öffentliche Dateinamen wie `<!--<script>.txt` konnten den HTML-Parserzustand im
Payload-Script verändern und dadurch einen ansonsten korrekt verschlüsselten
Wrapper unbenutzbar machen. Beide Generatoren maskieren jetzt jedes `<` im
Payload-JSON als `\u003c`; der ursprüngliche Metadatenwert bleibt beim JSON-Parsen
erhalten. Ein Node-Regressionstest deckt Steuersequenzen und Sonderzeichen ab.
Der Browser-Harness prüft zusätzlich vollständige App- und CLI-Wrapper mit dem
problematischen öffentlichen Namen, einschließlich Entschlüsselung und Anzeige.

Der aktualisierte Harness bestand nach dieser Korrektur im eingebetteten Chromium
(User-Agent Chrome 155, macOS): beide neuen Einbettungsfälle sowie die vier Fälle
10/25 MiB × Passphrase/Sealed mit privaten Namen und 600k Runden. Dieser Lauf prüft
das aktuelle vereinheitlichte Format. Die übrigen Browser-, Mobil-, Vorschau- und
Speichermessungen aus F5/F6 bleiben offen.
