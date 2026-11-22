// Testet den verschlüsselten Abgleich zwischen zwei Geräten gegen einen nachgebauten Server.
import 'fake-indexeddb/auto';
import { createRequire } from 'module';
import assert from 'assert';
const require = createRequire(import.meta.url);
globalThis.PDFLib = require('pdf-lib');
globalThis.XLSX = require('xlsx');
globalThis.JSZip = require('jszip');

const base = '../../docs/js/';
const L = await import(base + 'logic.js');
const { erzeugeDateien } = await import(base + 'export.js');
const { createSync } = await import(base + 'sync.js');
const { schluesselAbleiten } = await import(base + 'crypto.js');
const A = await import(base + 'db.js?geraet=a');
const B = await import(base + 'db.js?geraet=b');
A._setDbName('test-a');
B._setDbName('test-b');

// --- nachgebauter Supabase-Server
function fakeServer() {
  const rows = new Map();
  const files = new Map();
  const zaehler = {};
  let t = Date.parse('2026-11-22T08:00:00Z');
  return {
    rows, files,
    remote: {
      async fetchSince(ab) {
        return [...rows.values()].filter((r) => !ab || r.updated_at > ab).sort((a, b) => a.updated_at.localeCompare(b.updated_at)).map((r) => ({ ...r }));
      },
      async upsert(list) {
        for (const r of list) { t += 1000; rows.set(r.store + '|' + r.id, { ...r, updated_at: new Date(t).toISOString() }); }
      },
      async uploadFile(id, bytes) { files.set(id, new Uint8Array(bytes)); },
      async downloadFile(id) { return files.get(id) || null; },
      async nummerReservieren(jahr, mindestens) { zaehler[jahr] = Math.max(zaehler[jahr] || 0, mindestens) + 1; return zaehler[jahr]; }
    }
  };
}

const server = fakeServer();
const { key } = await schluesselAbleiten('Hufschmied@Example.de', 'geheim-123');
const { key: key2, loginPasswort } = await schluesselAbleiten('hufschmied@example.de', 'geheim-123');
assert.equal(loginPasswort.length, 64);

const firma = { name: 'Hufbeschlag Muster', inhaber: 'Max Muster', strasse: 'Schmiedeweg 4', plz: '12345', ort: 'Musterstadt', land: 'DE', telefon: '', email: 'info@muster.example', steuernummer: '12/345/67890', ustid: '', iban: 'DE02120300000000202051', bic: 'BYLADEM1001', bank: 'Musterbank' };

// --- Gerät A arbeitet zuerst ohne Synchronisierung
await A.speichereEinstellungen({ ...(await A.einstellungen()), firma });
const kunde = { id: 'k1', name: 'Reitstall Lindenhof GmbH', strasse: 'Lindenhof 3', plz: '54321', ort: 'Lindenau', email: 'x@lindenhof.example', typ: 'gewerbe' };
await A.put('customers', kunde);
await A.put('horses', { id: 'p1', customerId: 'k1', name: 'Sultan', intervallWochen: 6 });
await A.put('horses', { id: 'p2', customerId: 'k1', name: 'Bella', intervallWochen: 6 });
await A.put('services', { id: 's1', name: 'Beschlag 4-fach', einheit: 'Stk', preisCent: 12000, steuersatz: 19 });
const pos = [{ name: 'Beschlag 4-fach', menge: 1, einheit: 'Stk', preisCent: 12000, steuersatz: 19, rabattProzent: 0 }];
const entwurf = (k) => ({ typ: 'rechnung', datum: '2026-11-22', leistungsdatum: '2026-11-22', faelligAm: '2026-12-06', kundeId: k.id, kunde: k, pferde: ['Sultan'], pferdIds: ['p1'], positionen: pos, rabatt: null, summen: L.berechne(pos, null), zahlart: 'ueberweisung', status: 'offen' });
const inv1 = await A.festschreiben(entwurf(kunde), erzeugeDateien);
assert.equal(inv1.nr, 'RE-2026-0001');
assert.equal((await A.outbox()).length, 0, 'ohne Sync keine Warteschlange');

// --- A schaltet Synchronisierung ein
A.setSyncAktiv(true);
const syncA = createSync({ db: A, remote: server.remote, key });
await syncA.lauf();
assert.ok(server.rows.size >= 7, 'Datensätze hochgeladen: ' + server.rows.size);
assert.equal(server.files.size, 2, 'PDF + XML hochgeladen');
for (const r of server.rows.values()) assert.ok(!String(r.data).includes('Lindenhof'), 'Server sieht nur verschlüsselte Daten');
assert.ok(!new TextDecoder('latin1').decode(server.files.get(inv1.id + ':pdf')).includes('%PDF'), 'PDF verschlüsselt');
console.log('A eingerichtet:', server.rows.size, 'Datensätze,', server.files.size, 'Dateien');

// --- Gerät B (z. B. der PC) ist leer, hat aber schon leere Einstellungen gespeichert
await B.speichereEinstellungen(await B.einstellungen());
B.setSyncAktiv(true);
const syncB = createSync({ db: B, remote: server.remote, key: key2 });
B.setDateiNachladen((id) => syncB.dateiHolen(id));
await syncB.lauf();
const sB = await B.einstellungen();
assert.equal(sB.firma.name, 'Hufbeschlag Muster', 'leeres Gerät überschreibt die Firmendaten nicht');
assert.equal((await B.all('invoices')).length, 1);
assert.equal((await B.all('horses')).length, 2);
const pdfB = await B.datei(inv1.id, 'pdf');
assert.ok(pdfB && new TextDecoder('latin1').decode(pdfB.slice(0, 5)) === '%PDF-', 'PDF auf B nachgeladen und entschlüsselt');
console.log('B hat alles übernommen');

// --- B: Zahlung erfassen und Pferd löschen; A sieht es
const invB = (await B.all('invoices'))[0];
await B.zahlungSetzen(invB, 'bank', '2026-11-25');
await B.del('horses', 'p2');
await syncB.lauf();
await syncA.lauf();
const invA = await A.get('invoices', inv1.id);
assert.equal(invA.status, 'bezahlt');
assert.equal(invA.bezahltAm, '2026-11-25');
assert.equal(await A.get('horses', 'p2'), undefined, 'Löschung übertragen');
console.log('Zahlung und Löschung von B nach A übertragen');

// --- Beide Geräte schreiben Rechnungen: Nummern kollidieren nicht
const r2 = await A.festschreiben(entwurf(kunde), erzeugeDateien, server.remote.nummerReservieren);
const r3 = await B.festschreiben(entwurf(kunde), erzeugeDateien, server.remote.nummerReservieren);
assert.notEqual(r2.nr, r3.nr);
console.log('Nummern:', r2.nr, r3.nr);
await syncA.lauf(); await syncB.lauf(); await syncA.lauf();
assert.equal((await A.all('invoices')).length, 3);
assert.equal((await B.all('invoices')).length, 3);
assert.equal((await A.einstellungen()).zaehler[2026], 3, 'Zähler auf A aktuell');
assert.equal((await B.einstellungen()).zaehler[2026], 3, 'Zähler auf B aktuell');

// --- Gleichzeitige Änderung: lokale, noch nicht hochgeladene Änderung wird nicht überschrieben
await A.put('customers', { ...kunde, telefon: '0171 111' });
await B.put('customers', { ...kunde, telefon: '0171 222' });
await syncB.lauf();
await syncA.lauf(); // A lädt zuerst hoch (gewinnt als letzte Änderung), dann holt es
await syncB.lauf();
assert.equal((await A.get('customers', 'k1')).telefon, (await B.get('customers', 'k1')).telefon, 'beide Geräte gleich');
console.log('Konfliktfall: beide Geräte haben', (await A.get('customers', 'k1')).telefon);

// --- Offline: ohne Server-Reservierung zählt das Gerät lokal weiter
const r4 = await A.festschreiben(entwurf(kunde), erzeugeDateien, async () => { throw new Error('offline'); });
assert.equal(r4.nr, 'RE-2026-0004');
assert.equal(r4.nummerOffline, true);
console.log('Sync-Tests ok');
