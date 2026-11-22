# Hufschmied-Rechnungen

Rechnungsprogramm für einen mobilen Hufschmied, als Web-App fürs iPhone. Version 1.0.

Die App läuft komplett im Browser. Kunden, Pferde und Rechnungen werden **nur auf dem iPhone** gespeichert. Auf GitHub liegt nur der Programmcode.

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

## Wichtig: Datensicherung

Die Daten liegen nur auf dem iPhone. Unter **Mehr → Datensicherung** regelmäßig eine Sicherung erstellen und in iCloud Drive oder per Mail ablegen. Die App erinnert daran, wenn die letzte Sicherung älter als 30 Tage ist. Rechnungen müssen 8 Jahre aufbewahrt werden.

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
npm test               # Rechenlogik, PDF, E-Rechnung, Export
python3 tests/e2e.py   # kompletter Ablauf im Browser (Playwright)
```

Verwendete Bibliotheken liegen in `docs/vendor/` (Preact, htm, pdf-lib, JSZip, SheetJS, qrcode-generator) mit ihren Lizenzen.
