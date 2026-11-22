"""iPhone und PC gleichen über einen nachgebauten Supabase-Server ab."""
import subprocess, time, sys, os, json, urllib.request
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(__file__)
ROOT = os.path.join(HERE, '..', '..', 'docs')
OUT = os.path.join(HERE, '..', 'out', 'sync')
os.makedirs(OUT, exist_ok=True)
app = subprocess.Popen([sys.executable, '-m', 'http.server', '8766', '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
fake = subprocess.Popen([sys.executable, os.path.join(HERE, 'fake_supabase.py'), '54329'])
time.sleep(1.2)
TOP = '#app > div:not([style*="none"])'
errors = []

class Geraet:
    def __init__(self, browser, name, w, h):
        self.name = name
        self.ctx = browser.new_context(viewport={'width': w, 'height': h}, accept_downloads=True, locale='de-DE')
        self.p = self.ctx.new_page()
        self.p.on('console', lambda m: errors.append(f'{name}: {m.text}') if m.type == 'error' else None)
        self.p.on('pageerror', lambda e: errors.append(f'{name}: {e}'))
        self.p.add_init_script('window.confirm = () => true;')
        # Echte Supabase-Adresse aus config.js durch den nachgebauten Server ersetzen
        self.p.route('**/config.js', lambda r: r.fulfill(content_type='text/javascript', body="export const SUPABASE_URL = 'http://127.0.0.1:54329';\nexport const SUPABASE_ANON_KEY = 'test-anon-key-0123456789abcdef';\n"))
        self.p.goto('http://127.0.0.1:8766/')
        self.p.wait_for_selector('text=Übersicht')
        self.n = 0
    def t(self): return self.p.locator(TOP)
    def click(self, sel): self.t().locator(sel).first.click()
    def fill(self, label, val): self.t().get_by_label(label, exact=True).fill(val)
    def wait(self, sel, timeout=20000): self.t().locator(sel).first.wait_for(timeout=timeout)
    def shot(self, name):
        self.n += 1
        self.p.screenshot(path=f'{OUT}/{self.name}-{self.n:02d}-{name}.png', full_page=True)
    def anmelden(self, neu):
        self.click('.tab >> text=Mehr')
        self.click('text=Synchronisierung')
        if neu: self.click('.chip >> text=Neues Konto')
        self.fill('E-Mail', 'max@hufbeschlag-muster.example')
        self.fill('Passwort', 'Hufeisen-2026!')
        if neu: self.fill('Passwort wiederholen', 'Hufeisen-2026!')
        self.click('button.btn >> text=' + ('Konto anlegen' if neu else 'Anmelden'))
        self.wait('text=Jetzt abgleichen', 30000)
        self.p.wait_for_function("() => [...document.querySelectorAll('.kv')].some(e => /Abgeglichen/.test(e.textContent))", timeout=30000)

try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        handy = Geraet(b, 'iphone', 390, 844)

        # iPhone: Firmendaten, Leistung, Kunde
        h = handy
        h.click('text=Firmendaten eintragen')
        for l, v in [('Firmenname', 'Hufbeschlag Muster'), ('Straße und Hausnummer', 'Schmiedeweg 4'), ('PLZ', '12345'), ('Ort', 'Musterstadt'), ('Steuernummer', '12/345/67890'), ('IBAN', 'DE02 1203 0000 0000 2020 51')]:
            h.fill(l, v)
        h.click('.bar >> text=Speichern')
        h.click('.tab >> text=Mehr'); h.click('text=Leistungen und Preise'); h.click('text=Leistung anlegen')
        h.fill('Bezeichnung', 'Beschlag 4-fach'); h.fill('Preis netto (€)', '120')
        h.click('.bar >> text=Speichern'); h.wait('.row >> text=Beschlag 4-fach'); h.click('[aria-label="Zurück"]')
        h.click('.tab >> text=Kunden'); h.click('text=Neuer Kunde'); h.click('text=Geschäftskunde')
        h.fill('Name / Firma', 'Reitstall Lindenhof GmbH'); h.fill('Straße und Hausnummer', 'Lindenhof 3'); h.fill('PLZ', '54321'); h.fill('Ort', 'Lindenau')
        h.click('.bar >> text=Speichern')

        # iPhone: neues Konto anlegen (vorhandene Daten werden hochgeladen)
        h.anmelden(neu=True)
        h.shot('sync-an')
        h.click('[aria-label="Zurück"]')

        # iPhone: Rechnung schreiben
        h.click('.tab >> text=Übersicht'); h.click('text=Neue Rechnung')
        h.click('.row >> text=Reitstall Lindenhof GmbH')
        h.click('[aria-label="Beschlag 4-fach mehr"]')
        h.click('text=Weiter zur Vorschau'); h.click('text=Rechnung erstellen')
        h.wait('text=Rechnung erstellt', 30000)
        h.click('text=Zur Übersicht')
        h.p.wait_for_function("() => /Abgeglichen/.test(document.querySelector('.sync-pill')?.textContent || '') && !document.body.innerText.includes('Gleicht ab')", timeout=30000)
        time.sleep(3)  # entprellter Abgleich nach der Änderung
        h.shot('uebersicht')

        dump = json.load(urllib.request.urlopen('http://127.0.0.1:54329/debug/dump'))
        klartext = [r for r in dump['records'] if r.get('data') and ('Lindenhof' in r['data'] or 'Muster' in r['data'])]
        print('Server:', len(dump['records']), 'Datensätze,', len(dump['files']), 'Dateien, Klartext gefunden:', len(klartext), ', unverschlüsselte PDFs:', len(dump['plain']))
        assert not klartext and not dump['plain']

        # PC: anmelden, Daten kommen an
        pc = Geraet(b, 'pc', 1280, 900)
        pc.anmelden(neu=False)
        pc.click('[aria-label="Zurück"]')
        pc.click('.tab >> text=Rechnungen')
        pc.wait('.row >> text=Reitstall Lindenhof GmbH')
        pc.shot('rechnungen')
        pc.click('.row >> text=Reitstall Lindenhof GmbH')
        pc.wait('text=PDF ansehen', 20000)  # PDF vom Server geholt und entschlüsselt
        print('PC: Rechnung und PDF angekommen')

        # PC: Zahlung erfassen -> iPhone sieht sie
        pc.t().get_by_label('Per Bank bezahlt am').fill('2026-11-21')
        pc.click('text=Als bezahlt speichern')
        pc.wait('text=Per Bank bezahlt am 21.11.2026')
        pc.shot('bezahlt')
        time.sleep(3.5)
        h.click('.sync-pill')
        h.click('text=Jetzt abgleichen')
        time.sleep(2)
        h.click('[aria-label="Zurück"]')
        h.wait('.badge >> text=Bank 21.11.2026', 15000)
        h.shot('bezahlt-auf-handy')
        print('iPhone: Zahlung vom PC angekommen')

        # PC: zweite Rechnung -> Nummer RE-...-0002 (Server-Zähler)
        pc.click('[aria-label="Zurück"]')
        pc.click('.tab >> text=Übersicht')
        pc.click('text=Neue Rechnung')
        pc.click('.row >> text=Reitstall Lindenhof GmbH')
        pc.click('[aria-label="Beschlag 4-fach mehr"]')
        pc.click('text=Weiter zur Vorschau'); pc.click('text=Rechnung erstellen')
        pc.wait('text=Rechnung erstellt', 30000)
        txt = pc.t().inner_text()
        assert '-0002' in txt, txt[:200]
        pc.shot('zweite-rechnung')
        print('PC: zweite Rechnung bekommt die nächste Nummer')
        b.close()
finally:
    app.terminate(); fake.terminate()
print('Fehler in der Konsole:', errors or 'keine')
