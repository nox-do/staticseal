# Staticseal Website-Modus: Architekturplan

> Historischer Entwurf für einen mehrteiligen Website-Modus, keine Beschreibung
> der ausgelieferten Architektur. Maßgeblich für den bestehenden Einzeldatei- und
> HTML-Seitenmodus ist die [aktuelle Architektur](architecture.md). Die folgende
> Bezeichnung „heutiges v2-Dateiformat“ bezieht sich auf den Planungsstand vom
> 19. Oktober; aktuell unterstützt das Werkzeug v2–v5. Service Worker, externe
> Schlüsselfreigabe und Mehrdatei-Pakete sind weiterhin nicht implementiert.

Stand: 19. Oktober 2026 · Branch: `codex/website-mode` · Status: Planung, nicht implementiert.
Produktziel und Meilensteine: [Produktplan](staticseal-website-konzept.md).

## 1. Festgelegte Richtung

- Einheit: verschlüsselter Website-Dateibaum; Onepager ist der kleinste Fall.
- CLI verarbeitet fertige statische Builds; frameworkunabhängiger Bibliothekskern.
- Service Worker als Ressourcenserver: URL → verschlüsselte Datei → entschlüsselte Response.
- Originale HTML-/CSS-/JS-Dateien möglichst unverändert; keine universelle URL-Umschreibung.
- Gehashte Dateinamen und Chunk-Grenzen aus dem fertigen Build erhalten; kein Verständnis eines bestimmten Hashschemas erforderlich.
- Dynamische Interaktionen/Nachladen auf statischem Hosting unterstützen; keine automatische Backend-Konvertierung.
- HTTPS/localhost erforderlich; Website-Modus nicht per `file://`.
- Bestehende Datei-App und deren Download-Viewer bleiben ein eigener Ausgabeweg.
- Eigener Website-Formatvertrag; heutiges v2-Dateiformat nicht ungeprüft erweitern.
- Aktueller Auftrag: nur Planung. Prototyp erst nach Architekturentscheidung und Implementierungsauftrag.

## 2. Bausteine

| Baustein | Aufgabe |
| --- | --- |
| Scanner | Dateien, Pfade, MIME-Typen, Einstiege, bekannte Abhängigkeiten/Konflikte prüfen; optionale Manifeste auswerten |
| Paketierer | Index, Verschlüsselung, Build-ID, vollständige Ausgabe und Rückprüfung |
| Browser-Hülle | Öffnen/Login, Schlüsselbeschaffung, Worker-Handshake, Status/Fehler |
| Service Worker | Routing, Entschlüsselungsantworten, eigene Caches und Versionen |
| Schlüsselanbieter | Öffentlich, lokale Passphrase oder externe Freigabe; gleiche Entschlüsselungsbasis |
| CLI/Preview | `inspect`: prüfen; `build`: prüfen + paketieren; `preview`: erzeugte Ausgabe ausliefern. Kein Framework-Build |
| Spätere Framework-Adapter | Build-Verzeichnis, Basispfad, Routing, Einstiege und Chunk-Abhängigkeiten liefern; denselben Kern nutzen |

Vorhandene Basis: `src/format.mjs`, `src/wrapper.mjs`, `bin/self-encrypt.mjs`. Noch keine allgemeine Website-Lib. Entscheidung eigener Worker vs. Workbox offen; keine Svelte-/Vite-Pflicht im Kern.

## 3. Paketentwurf

```text
dist-sealed/
  index.html                     öffentliche Öffnungshülle
  about/index.html               Öffnungshülle für Direktbesuch
  staticseal-sw.js               am Deployment-Wurzelpfad
  staticseal-runtime/<build-id>/
    descriptor.json
    index.enc
    payload/001.enc
    payload/002.enc
    ...
```

| Bestandteil | Inhalt |
| --- | --- |
| Öffentliche Hüllen | Zielroute und Build-Zuordnung; kein geschützter Inhalt |
| Öffentlicher Deskriptor | Format-/Laufzeitversion, Build-ID, Schlüsselparameter/-referenz, Index-Verweis |
| Verschlüsselter Index | Kanonische Pfade → Payload-ID, MIME, Original-/Transportlänge, Kompressionsformat; Einstiege/Aliase, optional Abhängigkeiten |
| Payloads | Binäre, einzeln adressierbare verschlüsselte Ressourcen; kein Base64-HTML und kein Gesamtarchiv für jeden Abruf |

Kryptografischer Entwurf, vor Implementierung spezifizieren:

- Ausgangsentwurf: zufälliger Inhaltsschlüssel (DEK) pro Build; Index und Ressourcen authentifiziert verschlüsseln. Releaseübergreifende Ressourcenwiederverwendung ist unter A8 gesondert zu entscheiden.
- Passphrasenmodus: einmalige KDF-Ableitung eines KEK; damit DEK freigeben.
- Pro Verschlüsselung eigener IV; AAD bindet Format, Build und Ressourcenidentität.
- Deskriptor-/Index-Bindung und Umgang mit mehreren Zugangswegen festlegen.
- Öffentlich: nötiger Schlüssel verfügbar. Extern: vollständigen Entschlüsselungsweg zurückhalten.
- Sichtbar bleiben mindestens HTML-Einstiegspfade, Payload-Anzahl/-Größen; keine vollständige Metadatengeheimhaltung.

Build-Regeln:

- Überschneidende Ein-/Ausgabe, Symlinks im ersten Umfang, Traversal, URL-Duplikate und reservierte Namen ablehnen.
- Source Maps, `.gz`/`.br`-Duplikate und Hilfsdateien explizit behandeln; keine öffentlichen Originale kopieren.
- Temporären Nachbarordner erzeugen, vollständig prüfen, erst dann Ziel bereitstellen.
- Ersetzungsstrategie für vorhandenes Ziel offen; kein teilweises Überschreiben bei Fehler.
- Deployment getrennt; Ausgabeprüfung ist keine Browser-Kompatibilitätsprüfung.

## 4. URLs und Hosting

- Basispfad Teil des Vertrags: `/` oder z. B. `/staticseal/`; Eingabebuild muss dazu passen.
- Pro bekanntem HTML-Einstieg physische Öffnungshülle: erster Besuch erreicht den Host ohne Worker.
- Host-Redirects/Directory-Index im echten Deployment prüfen.
- SPA-Routen benötigen expliziten Host-Fallback; `200.html` erzeugt allein keine Rewrite-Regel.
- Worker-Scope bestimmt kontrollierte Clients. Handler prüft zusätzlich Origin, Basispfad und Index.

| Anfrage | Verhalten |
| --- | --- |
| Bekannte geschützte Ressource | Nach Freigabe passende Response/MIME |
| HTML ohne Freigabe | Öffnungshülle; Zielpfad, Query und Fragment erhalten |
| Fehlendes Asset | Fehler/404, niemals HTML-Fallback als erfolgreiche Antwort |
| Unbekannte Navigation | Zunächst 404; SPA-Verhalten nur explizit |
| Laufzeit/Transportdateien | Öffentlicher Abruf; keine rekursive Entschlüsselung |
| Externe Ressource | Nicht automatisch verpacken/blockieren; Abhängigkeit ausweisen |

Vor Implementierung: GET/HEAD, Query-Zuordnung, Redirects, MIME und Fehlerantworten spezifizieren. Range-Medien zunächst ausnehmen. Statische Prüfung erkennt keine beliebigen berechneten URLs oder Backend-Abhängigkeiten.

### Bedarfsgerechtes Nachladen und Build-Optimierungen

```text
Build:   optimierte Datei → optional komprimieren → authentifiziert verschlüsseln → binäre Payload
Browser: Ressourcenanfrage → Index → Payload laden → entschlüsseln → dekomprimieren → Response
```

- Minifizierung, Tree Shaking und Code-/CSS-Splitting des Eingabebuilds erhalten.
- Alle enthaltenen unterstützten Dateien beim Build verpacken; Browser lädt/entschlüsselt standardmäßig nur angeforderte Ressourcen.
- Initial nur Hülle und notwendige Metadaten; geschützte Ressourcen erst nach Freigabe. Keine vollständige Vorabentschlüsselung.
- Anwendung bestimmt Ladezeitpunkt: dynamischer Import, Bild, CSS oder lokaler JSON-Fetch lösen normale Anfragen aus.
- Worker bedient passende Anfragen kontrollierter Clients über den Index; keine Vorhersage jedes Programmablaufs nötig.
- Berechnete URL funktioniert, sofern sie auf einen enthaltenen, unterstützten Pfad zeigt. Laufzeit-API-Daten werden nicht automatisch Teil des Pakets.
- Lazy Loading nicht durch pauschales Preload/Precache des gesamten Pakets aufheben. Optionaler Offline-Download ist ein eigener Modus.
- Preload/Prefetch nach Freigabe erhalten und prüfen; Abhängigkeitsdaten erlauben gezieltes optionales Vorladen, keine Pflicht zur Framework-Integration.
- Unabhängige Abrufe parallel halten; identische gleichzeitige Ressourcenabrufe innerhalb derselben Sitzung/Build-Version zusammenführen.
- Entschlüsselten Arbeitsspeicher begrenzen; Deduplizierung darf keine Freigabegrenze zwischen Clients umgehen.
- Textressourcen vor Verschlüsselung komprimieren, wenn sinnvoll; bereits komprimierte Medien nicht pauschal erneut komprimieren.
- Nachträgliche HTTP-Kompression von Ciphertext ersetzt diese Stufe nicht. Algorithmus, Browserunterstützung und maximale dekomprimierte Länge festlegen; Metadaten authentifizieren.
- Zunächst vollständige Entschlüsselung je Ressource möglich; kein Streaming-/Range-Versprechen. Header der Response müssen zu den tatsächlich ausgelieferten Bytes passen.

| Informationsquelle | Nutzung / Grenze |
| --- | --- |
| HTML/CSS | Direkte Ressourcen, bekannte Preload-Verweise und lokale Pfade |
| Optionales Build-Manifest | Einstiegschunks, statische/dynamische Imports, CSS-/Asset-Zuordnung; nicht zwingend vorhanden/vollständig |
| Framework-Plugin | Metadaten nach abgeschlossenem Build liefern, denselben Paketierer aufrufen; korrekten Export/Basispfad unterstützen |
| Tatsächliche Browseranfragen | Jetzt benötigte Ressourcen; nur ausgeführte Abläufe nachgewiesen |
| Beliebiges JavaScript | Bedingungen, berechnete URLs und spätere Nutzeraktionen nicht vollständig vorhersagbar |

`inspect` bleibt ohne Ausführung des Eingabecodes möglich. Bericht: **Fehler** (nachgewiesener Blocker), **Abhängigkeit** (externer Dienst), **Prüfbedarf** (ungeklärt). Ein späterer Browsercheck erhält explizite Routen/Interaktionen und dokumentiert nur diese als getestet. Keine automatische Vollständigkeitszusage.

## 5. Ausführung und Sitzung: Entscheidung offen

| Variante | Vorteil | Offener Nachweis |
| --- | --- | --- |
| Oberstes Dokument | Native Navigation/URLs | Schlüsselwiederaufnahme nach Dokument- und Workerwechsel |
| Dauerhafte Hülle + Same-Origin-Frame | Hülle hält Sitzungsschlüssel im Speicher | History/URLs, Fokus, Downloads, Kompatibilität; keine Isolation vor Inhalt |
| Isolierter Frame ohne Same-Origin-Recht | Stärkere Trennung | Module, Fetch, Storage und Worker-Zusammenspiel bei Opaque Origin |

Regeln:

- Worker registrieren → aktuellen Controller prüfen → Protokoll-/Build-Handshake bestätigen.
- `ready` allein genügt nicht; Timeout/Versionsfehler sichtbar abbrechen.
- Erst Öffnen/Passphrase/API-Freigabe, dann geschützte Inhalte laden.
- Worker kann beendet werden und mit leerem globalem Zustand neu starten.
- Schlüssel nicht ausschließlich im Worker halten; Wiederaufnahmequelle festlegen.
- Keine lokale Persistenz von Passphrase/ungeschütztem DEK in localStorage, sessionStorage, IndexedDB oder Cache Storage.
- Ohne autorisierte Schlüsselquelle erneut sperren; kein öffentlicher Fallback.
- Kein automatisches Entsperren aller Tabs; tatsächliche Message-Absender/Client-URLs prüfen.
- Nachrichten: Protokollversion, Request-ID, Build-ID, Antwort/Fehler, Timeout; asynchrone Änderungen bestätigen.
- Navigation berücksichtigt Client-Wechsel/`resultingClientId`.
- Same-Origin-Code teilt Vertrauensgrenze; Unterpfad ist keine eigene Origin.
- Non-extractable CryptoKey verhindert Export, nicht jede Verwendung durch zugriffsberechtigten Code.

Vor Prototyp konkret entscheiden: interner Seitenwechsel, Reload, neuer Tab, Browser-/Worker-Neustart, Sperren und Back/Forward-Cache. Ziel: intern einmal entsperren; Verhalten nach vollständigem Neustart noch offen. Bereits dargestellte/kopierte Inhalte sind nicht rückrufbar.

## 6. Externe Schlüsselfreigabe

Status: Erweiterungspunkt jetzt vorsehen; konkrete Implementierung nach erstem Produktumfang.

### Auth-Anschlüsse

| Anschluss | Geplanter Einsatz |
| --- | --- |
| OAuth 2.0/OIDC, primär | Bestehender Anbieter; Browser-Client mit Authorization Code + PKCE; API-Zugang per Access-Token |
| HTTP Basic Auth über HTTPS | Benutzername/Passwort für Freigabe-Endpunkt; nicht in Build einbetten |
| Cookie-Session | Bestehende Serveranmeldung; CSRF-/Cookie-/CORS-Regeln definieren |
| Eigener Adapter | Sonderfälle; gleicher Schlüsselvertrag |

- OAuth autorisiert; OIDC ergänzt Identität/Anmeldung. ID-Token nicht pauschal als API-Access-Token behandeln.
- Etablierte Auth-Bibliothek nutzen; kein eigenes OAuth-Protokoll implementieren.
- Token oder Passwort-Verifikationshash ist kein DEK.
- Lokale Passphrase bleibt lokale KDF; nicht standardmäßig an Provider senden.
- Hash, der allein entschlüsselt, ist selbst schützenswertes Schlüsselmaterial.

### Freigabeablauf

```text
Build:   Dateien verschlüsseln → DEK sicher provisionieren → Schlüsselreferenz ins Paket
Browser: anmelden → POST /unlock → Server prüft Zugang + Build → Schlüsselantwort
Lokal:   Schlüssel importieren → Index prüfen → Worker liefert entschlüsselte Ressourcen
```

- `/unlock` ist ein Vertragsentwurf, kein bestehender Endpoint.
- Gewöhnlicher HTTPS-Request/Response; kein Webhook/Long Polling erforderlich.
- Webhook optional für externe Ereignisse, z. B. bezahlte Mitgliedschaft; kein Schlüsseltransport zum Browser.
- Verzögerte manuelle Freigabe/Polling außerhalb des Standardumfangs.
- Anmeldung nicht pro Bildabruf wiederholen.
- Login-/Challenge-Anbieter allein ist kein Schlüsseldienst; Entwickler verbindet beide Aufgaben serverseitig.

| Vertragsteil | Pflicht |
| --- | --- |
| Konfiguration | Provider/Endpoint, Website-/Build-ID, Schlüsselreferenz, Protokollversion; keine Server-Secrets |
| Anfrage | Berechtigungsnachweis passend zum Auth-Verfahren, Build-/Schlüsselreferenz; Timeout/Abbruch |
| Serverprüfung | Nachweis authentisch/gültig und für diese Website/diesen Build berechtigt; kein Vertrauen in Client-Erfolg oder CORS |
| Antwort | Zugeordnetes Schlüsselmaterial über HTTPS, ggf. verpackt; exakt spezifiziertes Schema |
| Fehler | Anmeldung nötig, abgelehnt, offline, Timeout, Build-/Versionskonflikt; kein Moduswechsel |
| Provisionierung | Getrennte CI-/Server-Berechtigung; Wiederholung/Fehler behandeln; kein Erfolg bei unvollständiger Einrichtung |
| Aufräumen | Abrufe abbrechen, Sitzungsschlüssel freigeben; Provider-Logout separat vereinbaren |

Sicherheitsgrenzen:

- Notwendiges Geheimnis bleibt bis Freigabe auf dem Server; kein alternativer öffentlicher Schlüssel im Paket.
- Lokaler Passphrasenzugang wäre ein zusätzlicher Zugangsweg, der die externe Sperre umgehen kann; nur ausdrücklich konfigurieren.
- API-Secrets, Tokens und Schlüssel nicht in URLs/Logs; keine pauschale Persistenz von Freigabeantworten.
- Anbieter übernimmt Schlüsselhaltung, Berechtigungsprüfung, Missbrauchsbegrenzung und Verfügbarkeit.
- OAuth-Vertrag spezifiziert u. a. Aussteller, Zielgruppe, Gültigkeit und Replay-Schutz nach gewähltem Flow.
- Verschlüsselte Daten dürfen im Browsercache liegen; Service Worker ist kein Tresor.
- Gegenüber öffentlichem Schlüssel: echte Zugangskontrolle vor Freigabe. Gegenüber starker lokaler Passphrase: zusätzlich individuelle Berechtigungen und Kontrolle zukünftiger Freigaben.
- Berechtigte Clients können automatisieren/kopieren. Widerruf/Ablauf löscht keinen bereits erhaltenen DEK/Klartext.
- Ohne verbleibenden Schlüsselzustand keine neue externe Freigabe offline.

## 7. Caches und Updates

- Dauerhaft nur öffentliche Laufzeitdateien und verschlüsselte Paketteile speichern.
- Kein generisches CacheFirst für entschlüsseltes HTML/Bilder; Antwortheader und Website-Cachecode prüfen.
- Cache-Namen: Website-/Basispfadidentität + Build-ID; ausschließlich eigene Caches bereinigen.
- Laufzeitversion und Inhalts-Build trennen; Inhaltsupdate auch ohne Workeränderung erkennen.
- Neue DEKs/IVs erzeugen auch für unveränderten Klartext neue Ciphertexte: einfache Variante verliert Cache-Wiederverwendung über Releases.
- A8 entscheidet einfache Neuverschlüsselung vs. wiederverwendbare Ressourcen mit eigenem Schlüssel-/Versionsmodell. Keine deterministischen IVs oder IV-Wiederverwendung improvisieren; Gleichheits-/Metadatenlecks und Widerrufsgrenzen bewerten.
- Pro Client konsistenter Build; keine Mischung alter HTML-Dateien mit neuen Assets.
- Fehlende alte Payloads nach Deployment als Versionsfehler behandeln.
- Keine bedingungslose Worker-Aktivierung/Cachelöschung mitten in aktiven Sitzungen.
- Updateverfahren umfasst parallele Tabs, alte Builds, ACK und gegebenenfalls erneute Freigabe.
- Empfehlung: Hüllen/Worker revalidieren; versionierte Transportdateien dürfen lange gecacht werden.
- Offline-Bereitschaft nur nach Vollständigkeitsnachweis; Quota/Eviction/fehlende Dateien sichtbar behandeln.
- Keine Garantie über Browser-internen Speicher oder bereits gespeicherten Klartext.

## 8. Geplanter Unterstützungsumfang

Erster Prototyp: zwei HTML-Seiten, verschachtelte Links, lokales Rasterbild, CSS mit relativer `url(...)`, JS-Modul mit lokalem Import, dynamischer Import nach Interaktion, nachgeladenes Bild und lokaler JSON-Fetch. Nachgeladene Payloads dürfen nicht schon beim Einstieg heruntergeladen werden, sofern kein expliziter Preload vorliegt.

Zunächst ausgenommen: Rendering pro Anfrage auf dem Server, Ausführung von Backend-Funktionen, beliebige SPA-Routen, vorhandene Worker/PWA-Registrierung, Range-Medien und beliebige Web-Worker-Konstruktionen. Beim Build vollständig vorgerenderte Inhalte sind normale statische Dateien.

- Frontends mit separater REST-/GraphQL-API können paketierbar bleiben; API bleibt externer Online-Dienst. Nicht pauschal als inkompatibel ablehnen.
- Vorhandene Worker nicht stillschweigend ersetzen; gegebenenfalls Build ohne PWA-Worker verlangen.
- Externe Fonts/Skripte/Assets/APIs ausweisen; normale externe Links bleiben Links.
- CSP, SRI, Web-App-Manifest und eigene Cachelogik explizit prüfen.
- Scanner erkennt bekannte Probleme, garantiert keine vollständige Analyse beliebigen JavaScripts.

## 9. BB-Pilot-Referenzen

Quelle: Schwesterprojekt `../bb_pilot`, Commit `82516390bd83ea4914aebeb722ba129a62379e7c`; bei Sichtung sauber. Nur Quelltext gelesen, keine neue Build-/Browservalidierung. Referenzen sind keine Laufzeitabhängigkeit und keine Anweisung zum Git-Cherry-pick.

| Datei / Anker | Nützliches Muster | Anpassung für Staticseal |
| --- | --- | --- |
| [vite.config.js](../../bb_pilot/vite.config.js), `SvelteKitPWA`, Z. 149 | Workbox + `sw-extra.js`, Update-Prompt | Worker-Werkzeug offen; frameworkunabhängig bleiben |
| dieselbe Datei, `additionalManifestEntries`, Z. 204 | Revisionen gegen veraltetes HTML/Chunk-Mischung | Explizite Build-Konsistenz statt nur Zeitstempel |
| dieselbe Datei, `navigateFallbackDenylist`, Z. 219; `previewNoCachePlugin`, Z. 58 | Asset-404 statt HTML-Fallback; Preview-Header | Identische Anfrageklassifikation in Runtime/Preview |
| [src/routes/+layout.svelte](../../bb_pilot/src/routes/+layout.svelte), `registerServiceWorker`/`handleUpdate`, Z. 37/84 | Installationszustand, Controllerwechsel, Cache-ACK | Zustandsautomat, Rennen/Timeouts/Mehrtab-Verhalten prüfen |
| [static/sw-extra.js](../../bb_pilot/static/sw-extra.js), Message-Handler, Z. 100 | MessageChannel-ACK nach `event.waitUntil` | Schema/Absender/Fehler ergänzen |
| dieselbe Datei, `activate`, Z. 4 | Gezielte Cache-Bereinigung | Eigene Namensräume; alte aktive Builds erhalten |
| [src/lib/stores/pwaStore.ts](../../bb_pilot/src/lib/stores/pwaStore.ts), `PWAState`/`initialize` | Installation/Offline-Status getrennt | Zusätzlich Controller, Freigabe und Paketvollständigkeit unterscheiden |
| [src/lib/utils/pwaReady.ts](../../bb_pilot/src/lib/utils/pwaReady.ts), `waitForSWReady`, Z. 71 | Timeout für `ready` | Zusätzlich Controller/Build-Handshake; kein Weiterlaufen ohne Freigabe |
| [src/lib/services/CryptoService.ts](../../bb_pilot/src/lib/services/CryptoService.ts), Z. 31/`lock`; [shutdown.ts](../../bb_pilot/src/lib/utils/shutdown.ts), `lockSessionImpl`/`gracefulShutdown` | DEK/KEK, Schlüssel im Speicher, Sperren | Keine PIN-/Finanz-/DB-Schicht übernehmen; Worker-Sitzung neu lösen |
| [src/lib/utils/reloadUtils.ts](../../bb_pilot/src/lib/utils/reloadUtils.ts), `performAppReload` | Reload mit Erhalt der Zieladresse | Cache-Busting ersetzt keine Build-Konsistenz |
| [svelte.config.js](../../bb_pilot/svelte.config.js), [firebase.json](../../bb_pilot/firebase.json) | Statischer Adapter, Fallback, Header | Firebase-Rewrites/rootfeste Pfade nicht auf GitHub Pages übertragen |

Nicht übernehmen: Share Target, periodische Finanzaufgaben, Installationsoberfläche. BB-Pilot-Kommentare/Tests ersetzen keinen Staticseal-Lebenszyklusnachweis.

## 10. Entscheidungsliste vor Implementierung

| ID | Offen | Erforderliches Ergebnis |
| --- | --- | --- |
| A1 | Ausführung/Isolation | Dokument oder Hülle/Frame; Origin, CSP, Browserfunktionen |
| A2 | Schlüsselzustand | Tabelle für Navigation, Reload, neuen Tab, Worker-/Browserneustart und Sperren |
| A3 | URL-/Host-Vertrag | Basispfad, Einstiege/Aliase, Query, Direktbesuch, Fehler, Preview-Verhalten |
| A4 | Paket/Kryptografie | Exaktes Schema, DEK/KEK, IV/AAD, Deskriptorbindung, Format-/Build-Versionen |
| A5 | Updates | Inhalts-/Workerwechsel, parallele Tabs, alte Pakete, Deployment-Reihenfolge |
| A6 | Lib-/Provider-Grenzen | Ein-/Ausgaben, Fehler und Provisionierung; OAuth/OIDC als primärer externer Anschluss |
| A7 | Unterstützungsprofil | Nachweisbare Features, Scannerdiagnosen, ausgeschlossene Konstruktionen |
| A8 | Leistung/Release-Caching | Kompressionsformat, Arbeitsspeichergrenzen, Deduplizierung, optionales Preload; neue DEKs pro Build vs. sichere Ressourcenwiederverwendung |

Erst A1–A8 konkretisieren, danach Prototyp beauftragen. Keine allgemeine Framework-Kompatibilität vorher behaupten.

## 11. Spätere Prüfliste

| Bereich | Fälle |
| --- | --- |
| Navigation | Erstbesuch Unterseite, Links, Reload, Zurück/Vorwärts, Query/Fragment, Unterpfad |
| Ressourcen | Bild/CSS/Modul/JSON, fehlendes Asset, MIME, unbekannte Route |
| Nachladen | Dynamischer Import/Bild erst bei Bedarf, bestehende Preloads, Parallelität, Deduplizierung und berechneter enthaltener Pfad |
| Build/Diagnose | Gehashte Namen erhalten, mit/ohne Manifest, falscher Basispfad, Fehlercode bei Blocker, externe API als Abhängigkeit |
| Leistung | Vergleich mit unverpacktem Build: Erst-/Wiederbesuch, Unterseite, Releasewechsel; Bytes, Requests, Latenz, Speicher und Entschlüsselungs-/Dekompressionskosten |
| Freigabe | Button, richtige/falsche Passphrase, Manipulation, kein Klartext im statischen Output |
| Lebenszyklus | Worker-Neustart, zweiter Tab, Sperren, neuer Build, Update ohne Workeränderung |
| Persistenz | Cache Storage/IndexedDB auf Klartext prüfen; Offline-Unvollständigkeit/Quota |
| Bedienung | Maus/Touch/Tastatur/assistive Technologien; Ladezeit und Speicher |
| Browser/Host | Chromium, Firefox, Safari/iOS; localhost und reales GitHub-Pages-Deployment |
| Crawler-Grenze | HTML-Abruf ohne Klartext; automatisierter Klick umgeht öffentlichen Modus |
| Externe API, später | Falsche Build-ID, ungültiger/abgelaufener Nachweis, Ablehnung, Ausfall, Abbruch, Provisionierungsfehler; kein alternativer öffentlicher DEK |

## 12. Technische Quellen

- [Service Worker: Grundlagen](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)
- [Worker-Neustart/globaler Zustand](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope)
- [Controller](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/controller), [Registrierung/Scope](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register)
- [iframe/Sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox), [Schlüsselableitung](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey)
- [OWASP: Schlüsselmanagement](https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet)
- [OAuth Security BCP/PKCE](https://www.rfc-editor.org/rfc/rfc9700), [OpenID Connect](https://openid.net/specs/openid-connect-core-1_0.html), [HTTP Basic](https://www.rfc-editor.org/rfc/rfc7617)
- [Vite: Build-Optimierungen](https://vite.dev/guide/features.html), [Manifest](https://vite.dev/guide/backend-integration.html), [Plugin-API](https://vite.dev/guide/api-plugin.html), [Basispfad](https://vite.dev/guide/build)
- [Browser-Dekompression](https://developer.mozilla.org/en-US/docs/Web/API/Compression_Streams_API)
