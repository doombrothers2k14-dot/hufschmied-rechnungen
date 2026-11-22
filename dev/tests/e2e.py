import subprocess, time, sys, os
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'docs')
OUT = os.path.join(os.path.dirname(__file__), '..', 'out', 'shots')
os.makedirs(OUT, exist_ok=True)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
errors = []
n = [0]
TOP = '#app > div:not([style*="none"])'
class Top:
    def __init__(self, page): self.p = page
    def t(self): return self.p.locator(TOP)
    def click(self, sel): self.t().locator(sel).first.click()
    def wait_for_selector(self, sel, timeout=30000): self.t().locator(sel).first.wait_for(timeout=timeout)
    def get_by_label(self, l, exact=False): return self.t().get_by_label(l, exact=exact)
    def set_input_files(self, sel, f): self.t().locator(sel).set_input_files(f)
    def locator(self, sel): return self.t().locator(sel)
    def screenshot(self, **k): self.p.screenshot(**k)
    def expect_download(self): return self.p.expect_download()
def shot(page, name):
    n[0] += 1
    page.screenshot(path=f'{OUT}/{n[0]:02d}-{name}.png', full_page=True)

try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1, is_mobile=True, has_touch=True, accept_downloads=True, locale='de-DE')
        page = ctx.new_page()
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.add_init_script("window.confirm = () => true;")
        page.goto('http://127.0.0.1:8765/')
        page.wait_for_selector('text=Übersicht')
        raw = page
        page = Top(raw)
        shot(page, 'start')

        # Firmendaten
        page.click('text=Firmendaten eintragen')
        def fill(label, val):
            page.get_by_label(label, exact=True).fill(val)
        fill('Firmenname', 'Hufbeschlag Muster')
        fill('Inhaber', 'Max Muster')
        fill('Straße und Hausnummer', 'Schmiedeweg 4')
        fill('PLZ', '12345'); fill('Ort', 'Musterstadt')
        fill('E-Mail', 'info@hufbeschlag-muster.example')
        fill('Steuernummer', '12/345/67890')
        fill('IBAN', 'DE02 1203 0000 0000 2020 51')
        fill('BIC', 'BYLADEM1001'); fill('Bank', 'Musterbank')
        shot(page, 'firma')
        page.click('.bar >> text=Speichern')
        page.wait_for_selector('text=Übersicht')

        # Leistungen
        page.click('.tab >> text=Mehr')
        page.click('text=Leistungen und Preise')
        for name, preis, einheit in [('Beschlag 4-fach', '120', 'Stk'), ('Barhuf-Bearbeitung', '45', 'Stk'), ('Anfahrt', '0,55', 'km')]:
            page.click('text=Leistung anlegen')
            fill('Bezeichnung', name)
            fill('Preis netto (€)', preis)
            page.get_by_label('Einheit').select_option(einheit)
            page.click('.bar >> text=Speichern')
            page.wait_for_selector(f'.row >> text={name}')
        shot(page, 'leistungen')
        page.click('[aria-label="Zurück"]')

        # Kunde (Gewerbe) + Pferde
        page.click('.tab >> text=Kunden')
        page.click('text=Neuer Kunde')
        page.click('text=Geschäftskunde')
        fill('Name / Firma', 'Reitstall Lindenhof GmbH')
        fill('Straße und Hausnummer', 'Lindenhof 3'); fill('PLZ', '54321'); fill('Ort', 'Lindenau')
        fill('E-Mail', 'buchhaltung@lindenhof.example')
        page.click('.bar >> text=Speichern')
        page.click('.row >> text=Reitstall Lindenhof GmbH')
        for pf in ['Sultan', 'Bella']:
            page.click('text=Pferd hinzufügen')
            fill('Name', pf)
            fill('Letzter Termin', '2026-10-10')
            page.click('.bar >> text=Speichern')
            page.wait_for_selector(f'.row >> text={pf}')
        shot(page, 'kunde')

        # Neue Rechnung aus dem Kunden
        page.click('text=Neue Rechnung')
        page.click('.chip >> text=Bella')
        page.click('[aria-label="Beschlag 4-fach mehr"]')
        page.click('[aria-label="Beschlag 4-fach mehr"]')
        page.get_by_label('Anfahrt Menge').fill('24')
        page.locator('.svc.on input[placeholder="0"]').first.fill('10')
        page.click('.chip >> text=in %')
        fill('Rabatt in Prozent', '5')
        shot(page, 'positionen')
        page.click('text=Weiter zur Vorschau')
        shot(page, 'vorschau')
        page.click('text=Rechnung erstellen')
        page.wait_for_selector('text=Rechnung erstellt', timeout=20000)
        page.wait_for_selector('text=RE-2026-11-0001')
        shot(page, 'fertig')
        with page.expect_download() as dl:
            page.click('text=Per Mail senden')
        d = dl.value
        d.save_as('out/e2e-' + d.suggested_filename)
        print('Download:', d.suggested_filename)

        # Zweite Rechnung bar an Privatkunden über "Nächste Rechnung"
        page.click('text=Nächste Rechnung')
        page.click('text=Neuen Kunden anlegen')
        fill('Name / Firma', 'Anna Berger')
        fill('Straße und Hausnummer', 'Erlenweg 1'); fill('PLZ', '54322'); fill('Ort', 'Erlenbach')
        page.click('.bar >> text=Speichern')
        page.click('.row >> text=Anna Berger')
        page.click('[aria-label="Barhuf-Bearbeitung mehr"]')
        page.click('text=Weiter zur Vorschau')
        page.click('text=Bar erhalten')
        page.click('text=Rechnung erstellen')
        page.wait_for_selector('text=Rechnung erstellt', timeout=20000)
        page.click('text=Zur Übersicht')
        shot(page, 'uebersicht')

        # Rechnung 1 als per Bank bezahlt markieren
        page.click('.row >> text=Reitstall Lindenhof GmbH')
        shot(page, 'detail')
        page.get_by_label('Per Bank bezahlt am').fill('2026-11-20')
        page.click('text=Als bezahlt speichern')
        page.wait_for_selector('text=Per Bank bezahlt am 20.11.2026')
        shot(page, 'bezahlt')
        page.click('[aria-label="Zurück"]')

        # Export
        page.click('.tab >> text=Mehr')
        page.click('text=Export für den Steuerberater')
        page.click('.chip >> text=Mehrere Monate')
        page.wait_for_selector('text=Von Monat')
        page.get_by_label('Von Monat').select_option('9')
        page.get_by_label('Bis Monat').select_option('11')
        page.wait_for_selector('text=September bis November 2026')
        page.wait_for_selector('text=2 Belege')
        shot(page, 'export-bereich')
        page.click('text=Export erstellen')
        page.wait_for_selector('text=Export fertig')
        shot(page, 'export')
        with page.expect_download() as dl:
            page.click('text=Teilen / per Mail senden')
        d = dl.value
        d.save_as('out/e2e-' + d.suggested_filename)
        print('Download:', d.suggested_filename)
        page.click('[aria-label="Zurück"]')

        # Storno
        page.click('.tab >> text=Rechnungen')
        page.click('.row >> text=Anna Berger')
        page.click('text=Rechnung stornieren')
        page.wait_for_selector('text=Storniert die Rechnung', timeout=20000)
        shot(page, 'storno')

        # Sicherung erstellen und wieder einspielen
        page.click('[aria-label="Zurück"]')
        page.click('.tab >> text=Mehr')
        page.click('text=Datensicherung')
        page.click('text=Sicherung erstellen')
        with page.expect_download() as dl:
            page.click('text=Sicherung speichern / teilen')
        d = dl.value
        path = 'out/e2e-' + d.suggested_filename
        d.save_as(path)
        page.set_input_files('input[type=file]', path)
        page.wait_for_selector('text=Sicherung eingespielt')
        page.click('[aria-label="Zurück"]')
        page.click('.tab >> text=Rechnungen')
        cnt = page.locator('.list .row').count()
        print('Rechnungen nach Wiederherstellung:', cnt)
        shot(page, 'rechnungen')
        b.close()
finally:
    srv.terminate()
print('Fehler in der Konsole:', errors or 'keine')
