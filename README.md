# Hufschmied-Rechnungen

Rechnungsprogramm für einen mobilen Hufschmied, als Web-App für iPhone und PC. Version 1.1.

Die App läuft im Browser und speichert alles auf dem Gerät. Mit der Synchronisierung bekommen iPhone und PC dieselben Daten: Sie werden **auf dem Gerät verschlüsselt** und über Supabase (Server in Frankfurt) abgeglichen. Supabase sieht nur verschlüsselte Daten. Auf GitHub liegt nur der Programmcode.

## Was die App kann

- Kunden (privat und gewerblich) mit Pferden, Beschlag-Intervall und letztem Termin
- Leistungskatalog mit Nettopreisen, Einheiten (Stück, pauschal, km, Std.) und 19 % oder 7 % USt
- Neue Rechnung in wenigen Schritten: Kunde, Pferde, Leistungen, Rabatt pro Position oder auf die ganze Rechnung, Zahlart
- PDF mit allen Pflichtangaben nach § 14 UStG und GiroCode (QR-Code für die Überweisung)
- Geschäftskunden bekommen zusätzlich eine E-Rechnung (ZUGFeRD/Factur-X, Profil EN 16931). Die XML-Datei ist in die PDF eingebettet und wird auch einzeln mitgeschickt.
- Versand über das Teilen-Menü des iPhones (Mail mit PDF im Anhang und vorbereitetem Text)
- Offene, überfällige und bezahlte Rechnungen; „per Bank bezahlt am“ mit Datum
- Fortlaufende Rechnungsnummern (RE-2026-0001 …). Erstellte Rechnungen sind festgeschrieben (Prüfsumme SHA-256), Korrekturen laufen über eine Stornorechnung.
- Übersicht der Pferde, die in den nächsten 14 Tagen fällig sind
- Export für den Steuerberater: ZIP mit Excel-Liste und allen PDFs. Jede Zeile der Tabelle hat einen Link auf die passende PDF.
- Datensicherung als Datei und Wiederherstellung, z. B. auf einem neuen iPhone
- Funktioniert nach dem ersten Öffnen auch ohne Internet
- Abgleich zwischen iPhone und PC mit Ende-zu-Ende-Verschlüsselung (AES-256). Ohne Netz wird lokal gespeichert und später abgeglichen. Rechnungsnummern vergibt der Server, damit zwei Geräte nie dieselbe Nummer nehmen.

## Veröffentlichen mit GitHub Pages

1. Im Repository auf **Settings → Pages** gehen.
2. Bei **Source** „Deploy from a branch“ wählen, Branch **main**, Ordner **/docs**, dann **Save**.
3. Nach ein bis zwei Minuten läuft die App unter `https://<benutzername>.github.io/hufschmied-rechnungen/`.

## Auf dem iPhone installieren

1. Die Adresse in **Safari** öffnen (nicht in Chrome).
2. Auf **Teilen** tippen und dann **Zum Home-Bildschirm**.
3. Die App ab jetzt immer über das Symbol auf dem Home-Bildschirm starten. Nur so bleiben die Daten dauerhaft gespeichert.
4. Beim ersten Start **Mehr → Firmendaten** ausfüllen und unter **Mehr → Leistungen und Preise** die Leistungen anlegen.

Voraussetzung: iOS 16.4 oder neuer.

## Auf dem PC installieren

Die Adresse in **Chrome** oder **Edge** öffnen. In der Adresszeile auf das Symbol „App installieren“ klicken. Dann startet die App wie ein normales Programm aus dem Startmenü.

## Synchronisierung mit Supabase einrichten (einmalig, ca. 10 Minuten)

1. Auf [supabase.com](https://supabase.com) ein kostenloses Konto anlegen und **New project** wählen. Bei **Region** „Central EU (Frankfurt)“ auswählen. Das Datenbank-Passwort sicher aufbewahren, die App braucht es nicht.
2. Im Projekt links **SQL Editor** öffnen, den Inhalt von [`supabase/setup.sql`](supabase/setup.sql) einfügen und **Run** klicken. Das legt die Tabellen, die Zugriffsregeln und den Dateispeicher an.
3. Unter **Authentication → Sign In / Providers → Email** die Option **Confirm email** ausschalten. Alternativ nach dem Anlegen des Kontos den Link in der Bestätigungsmail anklicken.
4. Unter **Project Settings → API Keys** bzw. **Data API** die **Project URL** und den **Publishable key** (früher „anon public“) kopieren. Entweder in `docs/config.js` eintragen, dann muss man sie in der App nicht eingeben. Oder in der App unter **Mehr → Synchronisierung** eingeben.
5. Auf dem iPhone: **Mehr → Synchronisierung → Neues Konto**, E-Mail und ein starkes Passwort wählen. Die vorhandenen Daten werden hochgeladen.
6. Auf dem PC: **Mehr → Synchronisierung → Anmelden** mit derselben E-Mail und demselben Passwort.
7. Danach in Supabase unter **Authentication → Sign In / Providers** die Option **Allow new users to sign up** ausschalten. Dann kann niemand sonst ein Konto in diesem Projekt anlegen.

**Das Passwort nicht vergessen.** Aus ihm wird der Schlüssel für die Verschlüsselung erzeugt. Es lässt sich nicht zurücksetzen, ohne dass die Daten auf dem Server unlesbar werden. Die Daten auf den Geräten und in den Datensicherungen bleiben aber erhalten.

**Kosten:** Der kostenlose Plan reicht (500 MB Datenbank, 1 GB Dateien, eine Rechnungs-PDF hat 5–15 KB). Kostenlose Projekte werden nach einer Woche ohne Nutzung pausiert und lassen sich im Supabase-Dashboard per Klick wieder starten. Der kostenlose Plan macht keine Backups. Deshalb weiterhin die Datensicherung in der App nutzen.

**Datenschutz (DSGVO):** Mit Supabase den Auftragsverarbeitungsvertrag (DPA) abschließen ([supabase.com/legal/dpa](https://supabase.com/legal/dpa)). Supabase als Dienstleister in das Verzeichnis der Verarbeitungstätigkeiten und in die Datenschutzinformation für Kunden aufnehmen. Weil die Daten im Gerät verschlüsselt werden, kann Supabase sie nicht lesen.

## Wichtig: Datensicherung

Ohne Synchronisierung liegen die Daten nur auf dem Gerät. Mit Synchronisierung liegen sie zusätzlich verschlüsselt bei Supabase, der kostenlose Plan macht dort aber keine Backups. Unter **Mehr → Datensicherung** regelmäßig eine Sicherung erstellen und in iCloud Drive oder per Mail ablegen. Die App erinnert daran, wenn die letzte Sicherung älter als 30 Tage ist. Rechnungen müssen 8 Jahre aufbewahrt werden.

## Vor dem Echtbetrieb mit dem Steuerberater klären

- **Barzahlungen:** Die App kann eine Rechnung als „bar erhalten“ markieren. Laut BMF hat ein Fakturaprogramm, das Barzahlungen erfasst, eine Kassenfunktion und bräuchte eine TSE. Ob das hier zutrifft und wie Bareinnahmen aufgezeichnet werden sollen, bitte mit dem Steuerberater klären.
- **E-Rechnung:** Die XML-Datei folgt EN 16931 (CII), ist aber noch nicht mit einem offiziellen Validator geprüft. Vor der ersten echten Rechnung an einen Geschäftskunden eine Test-XML prüfen lassen, z. B. mit dem Mustang-Validator oder dem Prüftool des Steuerberaters. Die PDF ist kein zertifiziertes PDF/A-3. Maßgeblich ist die mitgeschickte XML-Datei.
- **Steuersatz:** Voreingestellt sind 19 %. Ob einzelne Leistungen anders zu versteuern sind, entscheidet der Steuerberater.
- **Export-Format:** Falls der Steuerberater DATEV braucht, kann das später ergänzt werden.

## Neue Version veröffentlichen

Nach Änderungen in `docs/` die Versionsnummer in `docs/sw.js` (`VERSION`) erhöhen, sonst lädt das iPhone weiter die alte Version aus dem Offline-Speicher.

## Entwicklung

```
cd dev
npm install
npm test                    # Rechenlogik, PDF, E-Rechnung, Export
node tests/sync.mjs         # Abgleich zwischen zwei Geräten (nachgebauter Server)
python3 tests/e2e.py        # kompletter Ablauf im Browser (Playwright)
python3 tests/e2e_sync.py   # iPhone + PC im Browser gegen nachgebauten Supabase-Server
```

Verwendete Bibliotheken liegen in `docs/vendor/` (Preact, htm, pdf-lib, JSZip, SheetJS, qrcode-generator, supabase-js) mit ihren Lizenzen.
