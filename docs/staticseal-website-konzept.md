# Staticseal Website-Modus: Produktplan

Stand: 19. Oktober 2026 · Branch: `codex/website-mode` · Status: Architekturplanung.

## Ziel

- Fertigen statischen Website-Build per CLI verschlüsselt verpacken.
- Dateibaum, mehrere HTML-Seiten, Links und lokale Assets unterstützen.
- Ausgabe auf statischem Hosting bereitstellen; im Browser entschlüsseln.
- Standard: ohne Konto/Passphrase öffnen; einfache HTML-Abrufe erhalten keinen Klartext.
- Optional: lokale Passphrase oder serverseitig autorisierte Schlüsselfreigabe.
- Entwicklerbibliothek unabhängig von Website-Framework und Auth-Anbieter halten.
- Build-Optimierungen erhalten; verschlüsselte Ressourcen bedarfsgerecht nachladen.
- Statisches Hosting erlaubt dynamische Browser-Interaktionen; Backend-Funktionen werden nicht ersetzt.

## Aktueller Arbeitsauftrag

1. Architektur festlegen; offene Entscheidungen in [Architekturplan](staticseal-website-architektur.md) auflösen.
2. Bewährte Muster aus BB Pilot referenzieren; keinen fremden App-Code ungeprüft übernehmen.
3. Noch keinen Website-Modus implementieren.

Die vorhandene Datei-App bleibt eigenständig. HTML-Dateien dort weiterhin nur zum Download anbieten. Website-Ausführung erhält eine eigene Laufzeit und ein eigenes Paketformat.

## Geplanter Entwicklerablauf

Befehls-/Paketnamen sind Entwürfe, noch nicht verfügbar:

```sh
npm run build
npx staticseal inspect ./dist
npx staticseal build ./dist --out ./dist-sealed
npx staticseal preview ./dist-sealed
```

- `inspect`: unverändernde Prüfung und Bericht; blockierende Fehler liefern CI-Fehlercode.
- `build`: prüft ebenfalls und paketiert die fertige Ausgabe; führt keinen Framework-Build aus. Ersetzt den bisherigen Befehlsentwurf `site`.
- `preview`: tatsächlich erzeugte Ausgabe lokal ausliefern; Browserprüfung ist ein separater Nachweis.
- Zusätzlicher Schritt nach dem bestehenden Build; keine Framework-Migration.
- Eingabe unverändert lassen; ausschließlich `dist-sealed` deployen.
- Einfacher Standardfall ohne Konfigurationsdatei.
- Passphrase lokal verdeckt abfragen; in CI über stdin oder explizite Secret-Variable.
- Keine Geheimnisse in Argumenten, Konfigurationsdateien oder Logs.
- Fehlendes Geheimnis/fehlende Freigabe: Abbruch, kein Wechsel zum öffentlichen Modus.
- Fehler nennen Pfad und Korrekturmöglichkeit; externe Abhängigkeiten ausweisen.
- Erfolg erst nach vollständiger Paketprüfung; vorhandene Ausgabe bei Fehler nicht teilweise überschreiben.

## Build-Kompatibilität und Leistung

- Fertige Dateinamen/Hashes, Modulverweise und Chunk-Grenzen erhalten.
- Minifizierung/Tree Shaking nicht erneut ausführen; vorhandenes Lazy Loading respektieren.
- Ressourcen einzeln komprimieren, verschlüsseln und binär speichern; nach Freigabe bei Bedarf laden.
- Optional: Build-Manifeste/Plugins liefern Einstiege und Abhängigkeiten; Kern bleibt ohne Framework-Pflicht.
- `inspect` unterscheidet Fehler, externe Abhängigkeit und Prüfbedarf; Browsernachweise separat mit Umfang dokumentieren.
- Separate APIs bleiben möglich, aber online erforderlich; keine automatische Backend-/Offline-Konvertierung.
- Performance gegen unverpackten Build messen: Erstbesuch, Wiederbesuch, Unterseite und Releasewechsel.
- Offen: Wiederverwendung unveränderter verschlüsselter Dateien über Releases bei neuer Build-Schlüsselvergabe.

## Zugangsarten und Schutzwirkung

| Modus | Schlüsselquelle | Schutz vor Freigabe |
| --- | --- | --- |
| Öffentlich, Standard | Schlüssel im Paket; Button „Seite öffnen“ | Hürde für einfache HTML-Crawler; angepasste Programme können entschlüsseln |
| Lokale Passphrase | Schlüsselableitung im Browser | Ohne Geheimnis verschlüsselt; Offline-Passwortraten möglich |
| Externe Freigabe, später | API hält notwendigen Schlüssel zurück | Server prüft Zugang vor Schlüsselausgabe |

- Klick ist kein Menschennachweis; keine allgemeine Anti-Scraping-Garantie.
- Nach Freigabe kann ein berechtigter Besucher Inhalte und Schlüssel speichern.
- Widerruf verhindert zukünftige Freigaben, löscht keine früheren Kopien.
- Service Worker ist kein Schlüsseltresor und keine Isolation vor Website-Code.
- Entschlüsselungs-Host und gegebenenfalls Freigabedienst bleiben Vertrauensinstanzen.
- Originale nicht parallel öffentlich bereitstellen; Pfade/Größen können sichtbar bleiben.
- `noindex` ist nur ein ergänzender Hinweis; Suchbarkeit/Linkvorschauen können eingeschränkt sein.

## Externe Freigabe: vorgesehener Anschluss

- Primär: OAuth 2.0/OIDC; Browser-Anmeldung mit Authorization Code + PKCE.
- Weitere Anschlüsse: HTTP Basic Auth über HTTPS, vorhandene Cookie-Session.
- Freigabe: gewöhnlicher HTTPS-Request mit direkter Antwort, etwa `POST /unlock`.
- Kein Webhook/Long Polling im Standardablauf.
- Auth-Protokoll regelt Berechtigung; Staticseal-Vertrag regelt Build und Schlüsselantwort.
- Login-Anbieter allein ist noch kein Schlüsseldienst.
- Auth-Token/Passwort-Hash nicht als Inhaltsschlüssel verwenden.
- Schnittstelle jetzt planen; konkrete Provider später implementieren.

## Geplante Meilensteine

| Phase | Ergebnis |
| --- | --- |
| Jetzt: Planung | Ausführung, Sitzung, URLs, Paketformat und Updates explizit entscheiden |
| Danach: Architekturprototyp | Zwei HTML-Seiten, separate Assets, dynamischer Import nach Interaktion; bedarfsgerechtes Laden und Worker-Lebenszyklus prüfen |
| Erster Produktumfang | Nachgewiesene Funktionen, öffentliches Öffnen, lokale Passphrase, Preview, GitHub-Pages-Beispiel unter Unterpfad |
| Erweiterung | Externe Schlüsselfreigabe, komplexere Builds/Router/Medien, Framework-Adapter |

## Abnahme des ersten Produktumfangs

- Kopierbarer Ablauf: Build → Paket → Preview → Deployment.
- Echte Browserprüfung des erzeugten Codes; Node-Rückprüfung allein reicht nicht.
- Direktbesuch auf Unterseite, Navigation und zugesagte Interaktionen funktionieren.
- HTML-Abruf/Output-Scan: kein geschützter Klartext und keine versehentlichen Originale.
- Öffnen mit Maus, Touch, Tastatur und assistiven Technologien prüfen.
- Richtige Passphrase funktioniert; falsche Passphrase und manipulierte Daten werden abgelehnt.
- Automatisierter Browser demonstriert Umgehbarkeit der passwortlosen Klickhürde.
- Ladezeit/Speicher messen; keine Übernahme der Datei-App-Größenlimits ohne Nachweis.
- Nicht unterstützte Eingaben verständlich ablehnen; Grenzen statischer Analyse dokumentieren.

## Verteilung

- Browser-App: weiterhin GitHub Pages.
- CLI/Lib: spätere npm-Veröffentlichung; Paketname/Dateiumfang offen.
- Lizenz: MIT. GitHub-Release/eigene GitHub Action keine Voraussetzung.
