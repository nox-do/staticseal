# Staticseal Website Modus für Entwickler

Stand: 19. Oktober 2026. Konzept für den Branch `codex/website-mode`; die beschriebenen Website-Befehle sind noch nicht implementiert.

## Produktziel

> Staticseal macht Webseiten für Menschen zugänglich und erschwert automatisiertes Auslesen — ohne Benutzerkonto oder Passwortpflicht.

Dieses Ziel bestimmt Bedienung, Standardmodus und Abnahme. Entwickler sollen öffentliche Inhalte auf gewöhnlichem statischem Hosting anbieten können, ohne deren Klartext bereits mit einer einfachen HTML-Abfrage auszuliefern. Verschlüsselung ist dafür das Werkzeug. Passwortschutz bleibt eine zusätzliche Option für vertrauliche Inhalte.

Der Einstieg soll ein zusätzlicher CLI-Schritt sein: fertige Build-Ausgabe hinein, veröffentlichbare verpackte Ausgabe heraus. Die Verschlüsselung erfolgt nach dem Website-Build, die Entschlüsselung im Browser. Zunächst unterstützen wir eigenständige HTML-Onepager. Ganze Websites mit Assets und mehreren Seiten sind das spätere Ziel.

## Use Cases

### Öffentliche Inhalte mit einer Hürde für Crawler

Eine Entwicklerin veröffentlicht ein Portfolio, eine Präsentation oder einen Projektbericht. Menschen sollen die Inhalte über einen Link ohne Anmeldung oder Passwort sehen können. Einfache Crawler sollen beim Abruf jedoch nur die öffentliche Hülle und verschlüsselte Daten erhalten.

Sie baut die Seite wie gewohnt, verarbeitet die Ausgabe mit Staticseal und veröffentlicht ausschließlich die verpackte Ausgabe. Besucher öffnen den Link und betätigen einmal „Seite öffnen“. Erst danach entschlüsselt und zeigt der Browser die Inhalte. Der Standardbetrieb benötigt keinen eigenen Server-Endpunkt.

Der Button muss mit Maus, Touch, Tastatur und assistiven Technologien bedienbar sein. Bewegungsspiele, Pflichtregistrierung und wiederkehrende Prüfungen gehören nicht zum Standardablauf. Suchmaschinenauffindbarkeit und Linkvorschauen können durch die Hürde eingeschränkt sein; eine öffentliche Kurzbeschreibung kann bewusst außerhalb des verschlüsselten Inhalts bleiben.

### Optional vertrauliche Inhalte

Für Kundenpräsentationen oder Projektvorschauen kann die Entwicklerin zusätzlich eine Passphrase verlangen und diese separat teilen. Besucher geben sie vor dem Öffnen ein. Individuelle Konten, Rollen und sofortiger Zugangsentzug sind keine Eigenschaften des rein statischen Modells.

## Schutzwirkung und Grenzen

| Modus | Aussage |
| --- | --- |
| Öffnen per Klick ohne Passphrase als Standard | Liefert einfachen HTML-Abfragen keinen Klartext und verlangt im normalen Browserablauf eine Interaktion. Der Schlüssel ist verfügbar; angepasste Programme können direkt entschlüsseln, automatisierte Browser können klicken. |
| Automatisches Öffnen als mögliche spätere Option | Hürde für reine HTML-Abfragen, aber keine zusätzliche Interaktionshürde für Browser mit JavaScript. |
| Mit separat geteilter Passphrase | Inhalte bleiben ohne das Geheimnis verschlüsselt. Eine starke Passphrase ist wichtig, weil heruntergeladene Daten offline angegriffen werden können. |
| `noindex` als Ergänzung | Hinweis für kooperative Suchmaschinen, keine Zugriffssperre. |

„Menschen können es sehen, Maschinen nicht“ ist keine garantierbare technische Grenze. Ein Klick ist ein Auslöser, kein Nachweis menschlicher Nutzung. Wir messen, welche Abrufarten tatsächlich keinen Inhalt erhalten und welcher Aufwand für angepasste Bots sowie echte Besucher entsteht. Eine allgemeine Erfolgsquote gegen Crawler wird ohne entsprechende Messung nicht behauptet.

Die zu verpackenden Inhalte dürfen nicht parallel als Klartext öffentlich erreichbar sein, etwa im Quellrepository, in alten Deployments oder als ungeschützte Assets. Bewusst öffentliche Metadaten bleiben davon ausgenommen. Nach dem Öffnen lassen sich Inhalte kopieren und weitergeben. Bei Passphrasenschutz schützt ein Passwortwechsel frühere heruntergeladene Ausgaben nicht nachträglich. Wer den ausgelieferten Entschlüsselungscode verändern kann, könnte eingegebene Passphrasen abgreifen; der Host bleibt eine Vertrauensinstanz.

## Gewünschter Entwicklerablauf

Die folgenden Namen und Befehle beschreiben die geplante Bedienung. Paketname und Veröffentlichung sind noch offen.

```sh
npm install --save-dev @staticseal/cli

npm run build
npx staticseal site ./dist --out ./dist-sealed
npx staticseal preview ./dist-sealed
```

Der Standardbefehl erstellt die passwortlose Ausgabe mit einem Öffnen-Button. Nur bei ausdrücklich gewähltem Passphrasenschutz fragt die CLI das Geheimnis verdeckt ab; die genaue Option ist noch festzulegen. Der Vorschau-Befehl zeigt die tatsächlich erzeugte Ausgabe über einen lokalen Server. Entwickler können damit Öffnen, Darstellung und unterstützte Interaktionen vor dem Deployment prüfen.

Für wiederholte Builds genügt ein zusätzlicher Eintrag in `package.json`:

```json
{
  "scripts": {
    "build:sealed": "npm run build && staticseal site ./dist --out ./dist-sealed"
  }
}
```

Veröffentlicht wird ausschließlich `dist-sealed`. Der ursprüngliche Build-Ordner bleibt unverändert. Eine Konfigurationsdatei ist für den einfachen Fall nicht erforderlich.

Bei gewähltem Passphrasenschutz wird in CI die Passphrase über Standard-Eingabe oder eine ausdrücklich benannte Umgebungsvariable aus dem Secret Store übergeben. Sie gehört weder in Kommandozeilenargumente noch in Konfigurationsdateien oder Logs. Fehlt sie in diesem Modus, bricht der Build ab; es gibt keinen automatischen Wechsel in den passwortlosen Modus.

## Verhalten des Werkzeugs

- Eingabe und Ausgabe klar trennen und gefährliche Überschneidungen ablehnen.
- Dateien und unterstützte Abhängigkeiten vor dem Verpacken prüfen. Fehler nennen den betroffenen Pfad und eine konkrete Korrekturmöglichkeit.
- Nicht unterstützte Konstruktionen ablehnen, statt eine scheinbar erfolgreiche, später defekte Website zu erzeugen.
- Nur vollständig erzeugte und geprüfte Ausgaben als erfolgreich melden. Ein Fehler darf nicht zu einem Deployment einer unvollständigen Ausgabe führen.
- Externe Ressourcen sichtbar ausweisen. Sie sind weder automatisch mitverschlüsselt noch automatisch offline verfügbar.
- Am Ende den Ausgabeordner, verarbeitete Inhalte und verbleibende externe Abhängigkeiten nennen, ohne Geheimnisse auszugeben.

## Erster Meilenstein

Der erste durchgängige Ablauf umfasst einen eigenständigen HTML-Onepager mit eingebetteten Ressourcen, passwortloses Öffnen per barrierefreiem Button, optionalen Passphrasenschutz, die lokale Vorschau und ein dokumentiertes Deployment auf GitHub Pages. Die Seite wird nach dem Entsperren angezeigt und kann innerhalb des ausdrücklich unterstützten Funktionsumfangs benutzt werden.

Die bestehende Browser-App bleibt das Werkzeug für einzelne Dateien. Ihre Entscheidung, HTML nur zum Download anzubieten, wird durch den Website-Modus nicht stillschweigend geändert. Die Ausführung von HTML und JavaScript benötigt einen eigenen, bewusst gestalteten Website-Wrapper.

Zur Abnahme gehören:

1. Ein kopierbares Beispiel vom Build bis zur veröffentlichten Seite.
2. Einfache HTML-Abfragen liefern keinen geschützten Klartext. Im normalen Browserablauf erfolgt die Entschlüsselung erst nach dem Öffnen; ein automatisierter Browser testet ausdrücklich auch die Umgehbarkeit per Klick.
3. Bedienbarkeit mit Maus, Touch und Tastatur sowie Prüfung mit assistiven Technologien. Ladezeit und zusätzlicher Aufwand für Besucher werden erfasst.
4. Beim optionalen Passphrasenschutz: erfolgreiches Entsperren mit korrekter Passphrase und Ablehnung falscher Passphrasen. Manipulierte geschützte Daten werden erkannt; ohne Geheimnis ist dies kein Schutz vor absichtlichem Neuverschlüsseln durch Dritte.
5. Prüfung der erzeugten Ausgabe auf versehentlich enthaltene Originaldateien und Klartextinhalte.
6. Tests des tatsächlich generierten Website-Codes in Browsern, einschließlich der zugesagten Interaktionen und eines Deployments unter einem Unterpfad wie `/staticseal/`.
7. Verständlicher Abbruch bei einem nicht unterstützten Eingabeprojekt.

Eine Node-Rückprüfung allein belegt weder Website-Funktion noch Browserkompatibilität. Die Größenregeln der bisherigen Datei-App werden nicht ungeprüft auf Websites übertragen.

## Erweiterungen nach dem ersten Meilenstein

Anschließend können lokale Bilder, CSS, Skripte und mehrere HTML-Seiten hinzukommen. Für mehrere Seiten ist das gewünschte Besuchererlebnis: einmal entsperren und innerhalb der Website navigieren. Die sichere Verwaltung des entsperrten Zustands und das Verhalten bei Neuladen sind noch festzulegen.

Eine optionale servergestützte Schlüsselfreigabe kann später bestehende Anmeldungen oder serverseitig geprüfte Bot-Challenges anbinden. Dafür muss der Server einen notwendigen Schlüssel zurückhalten. Ein Ja/Nein-Endpunkt bei bereits verfügbarem Schlüssel ist keine belastbare Zugriffskontrolle; ein frei abrufbarer Schlüssel bietet kaum eine zusätzliche Hürde. Eine solche Erweiterung bringt Betriebskosten und Verfügbarkeitsabhängigkeiten mit sich und gehört nicht zum ersten Meilenstein. Bereits freigegebene Schlüssel oder Inhalte können nicht zurückgerufen werden.

Framework-Plugins für beispielsweise Vite oder Astro können später Build-Pfade und Einstellungen automatisch übernehmen. Sie sollen dieselbe CLI beziehungsweise denselben Kern verwenden. Zunächst genügt ein dokumentierter CI-Workflow; eine eigene GitHub Action ist keine Startvoraussetzung.

## Technische Entscheidungen vor der Umsetzung

Die bestehende Verschlüsselung und Formatvalidierung bilden die Grundlage. Ein Website-Paket benötigt jedoch eine eigene Entscheidung zu Dateistruktur, Ressourcenauflösung und Ausführung. Das heutige Ein-Datei-Format wird nicht automatisch als ausreichendes Website-Format vorausgesetzt.

Vor dem Implementieren des Website-Wrappers klären wir:

- Wo entschlüsseltes HTML ausgeführt wird und welche Isolation, Skript- und Netzwerkregeln gelten.
- Welche eingebetteten Ressourcen und Interaktionen der erste Meilenstein tatsächlich unterstützt.
- Wie relative URLs, Unterpfade und später mehrere Seiten aufgelöst werden.
- Wie nicht unterstützte Module, dynamische Ladevorgänge, Service Worker und Backend-Abhängigkeiten erkannt oder eingegrenzt werden.
- Wie lange ein entsperrter Zustand bestehen bleibt und wie erneutes Sperren im optionalen Passphrasenmodus funktioniert.
- Welche Metadaten öffentlich sichtbar bleiben, etwa Titel, Pfade und Dateigrößen.

Ein kleiner Prototyp mit repräsentativen Seiten soll diese Fragen beantworten, bevor wir allgemeine Kompatibilität mit Framework-Builds zusagen.

## Verteilung

Die Browser-App wird weiterhin über GitHub Pages bereitgestellt. Für die CLI ist später eine npm-Veröffentlichung vorgesehen. Das Projekt steht unter der MIT-Lizenz; Paketname und veröffentlichte Dateien müssen dafür noch festgelegt werden. Ein GitHub-Release ist unabhängig davon und für dieses Konzept nicht erforderlich.

Die gemeinsame technische Basis bleibt im Projekt. CLI und spätere Plugins ergänzen die Browser-App, ohne deren einfache Bedienung um Website-Konfiguration zu erweitern.
