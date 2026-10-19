# Staticseal Website Modus für Entwickler

Stand: 19. Oktober 2026. Konzept für den Branch `codex/website-mode`; die beschriebenen Website-Befehle sind noch nicht implementiert.

Staticseal soll Entwicklern ermöglichen, statische Webseiten mit einer Passphrase zu schützen und auf gewöhnlichem statischem Hosting bereitzustellen. Die Verschlüsselung erfolgt nach dem Website-Build, die Entschlüsselung im Browser des Besuchers. Dafür ist kein eigener Authentifizierungsserver nötig.

Der Einstieg soll ein zusätzlicher CLI-Schritt sein: fertige Build-Ausgabe hinein, veröffentlichbare geschützte Ausgabe heraus. Zunächst unterstützen wir eigenständige HTML-Onepager. Ganze Websites mit Assets und mehreren Seiten sind das spätere Ziel.

## Use Case

Eine Entwicklerin erstellt einen Projektbericht oder eine Präsentation als HTML-Seite. Sie möchte diese einer kleinen Gruppe über einen Link zugänglich machen, ohne Benutzerverwaltung oder ein Backend einzurichten. Die Seite soll auf GitHub Pages oder einem anderen statischen Host liegen können.

Sie baut die Seite wie gewohnt, verschlüsselt die Ausgabe mit Staticseal und veröffentlicht ausschließlich die geschützte Ausgabe. Die Passphrase teilt sie separat mit den Empfängern. Diese öffnen den Link, geben die Passphrase ein und verwenden die Seite direkt im Browser.

Weitere passende Anwendungen sind Kundenpräsentationen, kleine Dokumentationen und Projektvorschauen mit gemeinsamem Zugang. Individuelle Konten, Rollen, sofortiger Zugangsentzug und serverseitige Zugriffskontrolle gehören nicht zu diesem Modell.

## Schutzwirkung

| Modus | Aussage |
| --- | --- |
| Mit separat geteilter Passphrase | Inhalte bleiben ohne das Geheimnis verschlüsselt. Eine starke Passphrase ist wichtig, weil heruntergeladene Daten offline angegriffen werden können. |
| Ohne Passphrase | Hürde für einfache Crawler. Der nötige Schlüssel ist verfügbar; automatisierte Browser oder angepasste Crawler können den Inhalt öffnen. |
| `noindex` | Ergänzender Hinweis für kooperative Suchmaschinen, keine Zugriffssperre. |

Die Positionierung lautet „passwortgeschützte Seiten auf statischem Hosting“. Für öffentlich ohne Geheimnis lesbare Seiten versprechen wir keinen zuverlässigen Schutz vor Scraping. Nach dem Entsperren können Empfänger Inhalte kopieren und weitergeben.

Unverschlüsselte Originale dürfen nicht zusätzlich öffentlich erreichbar sein, etwa im Quellrepository, in alten Deployments oder als ungeschützte Assets. Ein Wechsel der Passphrase schützt frühere, bereits heruntergeladene Ausgaben nicht nachträglich. Der Host bleibt eine Vertrauensinstanz: Wer den ausgelieferten Entschlüsselungscode verändern kann, könnte die eingegebene Passphrase abgreifen.

## Gewünschter Entwicklerablauf

Die folgenden Namen und Befehle beschreiben die geplante Bedienung. Paketname und Veröffentlichung sind noch offen.

```sh
npm install --save-dev @staticseal/cli

npm run build
npx staticseal site ./dist --out ./dist-sealed
npx staticseal preview ./dist-sealed
```

Lokal fragt die CLI die Passphrase verdeckt ab. Der Vorschau-Befehl zeigt die tatsächlich erzeugte Ausgabe über einen lokalen Server. Entwickler können damit Entsperren, Darstellung und unterstützte Interaktionen vor dem Deployment prüfen.

Für wiederholte Builds genügt ein zusätzlicher Eintrag in `package.json`:

```json
{
  "scripts": {
    "build:sealed": "npm run build && staticseal site ./dist --out ./dist-sealed"
  }
}
```

Veröffentlicht wird ausschließlich `dist-sealed`. Der ursprüngliche Build-Ordner bleibt unverändert. Eine Konfigurationsdatei ist für den einfachen Fall nicht erforderlich.

In CI wird die Passphrase über Standard-Eingabe oder eine ausdrücklich benannte Umgebungsvariable aus dem Secret Store übergeben. Sie gehört weder in Kommandozeilenargumente noch in Konfigurationsdateien oder Logs. Fehlt sie, bricht der Build ab; es gibt keinen automatischen Wechsel in den passwortlosen Modus.

## Verhalten des Werkzeugs

- Eingabe und Ausgabe klar trennen und gefährliche Überschneidungen ablehnen.
- Dateien und unterstützte Abhängigkeiten vor dem Verpacken prüfen. Fehler nennen den betroffenen Pfad und eine konkrete Korrekturmöglichkeit.
- Nicht unterstützte Konstruktionen ablehnen, statt eine scheinbar erfolgreiche, später defekte Website zu erzeugen.
- Nur vollständig erzeugte und geprüfte Ausgaben als erfolgreich melden. Ein Fehler darf nicht zu einem Deployment einer unvollständigen Ausgabe führen.
- Externe Ressourcen sichtbar ausweisen. Sie sind weder automatisch mitverschlüsselt noch automatisch offline verfügbar.
- Am Ende den Ausgabeordner, verarbeitete Inhalte und verbleibende externe Abhängigkeiten nennen, ohne Geheimnisse auszugeben.

## Erster Meilenstein

Der erste durchgängige Ablauf umfasst einen eigenständigen HTML-Onepager mit eingebetteten Ressourcen, eine Passphrase, die lokale Vorschau und ein dokumentiertes Deployment auf GitHub Pages. Die Seite wird nach dem Entsperren angezeigt und kann innerhalb des ausdrücklich unterstützten Funktionsumfangs benutzt werden.

Die bestehende Browser-App bleibt das Werkzeug für einzelne Dateien. Ihre Entscheidung, HTML nur zum Download anzubieten, wird durch den Website-Modus nicht stillschweigend geändert. Die Ausführung von HTML und JavaScript benötigt einen eigenen, bewusst gestalteten Website-Wrapper.

Zur Abnahme gehören:

1. Ein kopierbares Beispiel vom Build bis zur veröffentlichten Seite.
2. Erfolgreiches Entsperren mit korrekter Passphrase; Ablehnung falscher Passphrasen und manipulierter geschützter Daten.
3. Prüfung der erzeugten Ausgabe auf versehentlich enthaltene Originaldateien und Klartextinhalte.
4. Tests des tatsächlich generierten Website-Codes in Browsern, einschließlich der zugesagten Interaktionen und eines Deployments unter einem Unterpfad wie `/staticseal/`.
5. Verständlicher Abbruch bei einem nicht unterstützten Eingabeprojekt.

Eine Node-Rückprüfung allein belegt weder Website-Funktion noch Browserkompatibilität. Die Größenregeln der bisherigen Datei-App werden nicht ungeprüft auf Websites übertragen.

## Erweiterungen nach dem ersten Meilenstein

Anschließend können lokale Bilder, CSS, Skripte und mehrere HTML-Seiten hinzukommen. Für mehrere Seiten ist das gewünschte Besuchererlebnis: einmal entsperren und innerhalb der Website navigieren. Die sichere Verwaltung des entsperrten Zustands und das Verhalten bei Neuladen sind noch festzulegen.

Framework-Plugins für beispielsweise Vite oder Astro können später Build-Pfade und Einstellungen automatisch übernehmen. Sie sollen dieselbe CLI beziehungsweise denselben Kern verwenden. Zunächst genügt ein dokumentierter CI-Workflow; eine eigene GitHub Action ist keine Startvoraussetzung.

## Technische Entscheidungen vor der Umsetzung

Die bestehende Verschlüsselung und Formatvalidierung bilden die Grundlage. Ein Website-Paket benötigt jedoch eine eigene Entscheidung zu Dateistruktur, Ressourcenauflösung und Ausführung. Das heutige Ein-Datei-Format wird nicht automatisch als ausreichendes Website-Format vorausgesetzt.

Vor dem Implementieren des Website-Wrappers klären wir:

- Wo entschlüsseltes HTML ausgeführt wird und welche Isolation, Skript- und Netzwerkregeln gelten.
- Welche eingebetteten Ressourcen und Interaktionen der erste Meilenstein tatsächlich unterstützt.
- Wie relative URLs, Unterpfade und später mehrere Seiten aufgelöst werden.
- Wie nicht unterstützte Module, dynamische Ladevorgänge, Service Worker und Backend-Abhängigkeiten erkannt oder eingegrenzt werden.
- Wie lange ein entsperrter Zustand bestehen bleibt und wie erneutes Sperren funktioniert.
- Welche Metadaten öffentlich sichtbar bleiben, etwa Titel, Pfade und Dateigrößen.

Ein kleiner Prototyp mit repräsentativen Seiten soll diese Fragen beantworten, bevor wir allgemeine Kompatibilität mit Framework-Builds zusagen.

## Verteilung

Die Browser-App wird weiterhin über GitHub Pages bereitgestellt. Für die CLI ist später eine npm-Veröffentlichung vorgesehen; Das Projekt steht unter der MIT-Lizenz; Paketname und veröffentlichte Dateien müssen dafür noch festgelegt werden. Ein GitHub-Release ist unabhängig davon und für dieses Konzept nicht erforderlich.

Die gemeinsame technische Basis bleibt im Projekt. CLI und spätere Plugins ergänzen die Browser-App, ohne deren einfache Bedienung um Website-Konfiguration zu erweitern.
