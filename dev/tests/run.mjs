import { createRequire } from 'module';
import fs from 'fs';
import assert from 'assert';
const require = createRequire(import.meta.url);
globalThis.PDFLib = require('pdf-lib');
globalThis.XLSX = require('xlsx');
globalThis.JSZip = require('jszip');

const L = await import('../../docs/js/logic.js');
const { erzeugeDateien, exportZip } = await import('../../docs/js/export.js');

// --- Rechenlogik
assert.equal(L.euro(123456), '1.234,56 €');
assert.equal(L.euro(-1500), '−15,00 €');
assert.equal(L.parseEuro('1.234,56'), 123456);
assert.equal(L.parseEuro('12.5'), 1250);
assert.equal(L.parseEuro('abc'), null);

const pos = [
  { name: 'Beschlag 4-fach', menge: 1, einheit: 'Stk', preisCent: 12000, steuersatz: 19, rabattProzent: 0 },
  { name: 'Anfahrt', menge: 12.5, einheit: 'km', preisCent: 55, steuersatz: 19, rabattProzent: 0 },
  { name: 'Hufpflegeöl', menge: 2, einheit: 'Stk', preisCent: 899, steuersatz: 7, rabattProzent: 10 }
];
const b = L.berechne(pos, { art: 'prozent', wert: 5 });
// 12000 + round(687.5)=688 + (1798-180=1618) = 14306 ; Rabatt 5% = 715
assert.equal(b.summePositionen, 14306);
assert.equal(b.gesamtRabatt, 715);
assert.equal(b.steuern.reduce((s, t) => s + t.rabatt, 0), 715);
assert.equal(b.netto, 14306 - 715);
assert.equal(b.brutto, b.netto + b.steuer);
const b2 = L.berechne(pos, { art: 'betrag', wert: 99999999 });
assert.equal(b2.netto, 0);
const storno = L.berechne(pos.map((p) => ({ ...p, menge: -p.menge })), { art: 'prozent', wert: 5 });
assert.equal(storno.brutto, -b.brutto);
assert.equal(L.zeitraumGrenzen('quartal', 2026, 4).bis, '2026-12-31');
assert.equal(L.zeitraumGrenzen('monat', 2026, 2).bis, '2026-02-28');
const zb = L.zeitraumGrenzen('bereich', 0, { von: { jahr: 2026, monat: 11 }, bis: { jahr: 2027, monat: 2 } });
assert.equal(zb.von, '2026-11-01'); assert.equal(zb.bis, '2027-02-28'); assert.equal(zb.label, 'November 2026 bis Februar 2027');
assert.equal(L.zeitraumGrenzen('bereich', 0, { von: { jahr: 2026, monat: 3 }, bis: { jahr: 2026, monat: 1 } }).label, 'Januar bis März 2026');
assert.equal(L.formatNummer('RE', L.periodeVon('2026-01-15'), 7), 'RE-2026-01-0007');
assert.equal(L.faelligkeit({ letzterTermin: '2026-11-01', intervallWochen: 6 }, '2026-12-10').inTagen, 3);
console.log('Logik ok');

// --- Dateien
const s = {
  firma: { name: 'Hufbeschlag Muster', inhaber: 'Max Muster', strasse: 'Schmiedeweg 4', plz: '12345', ort: 'Musterstadt', land: 'DE',
    telefon: '0171 1234567', email: 'info@hufbeschlag-muster.example', steuernummer: '12/345/67890', ustid: 'DE123456789',
    iban: 'DE02 1203 0000 0000 2020 51', bic: 'BYLADEM1001', bank: 'Musterbank' },
  zahlungszielTage: 14, prefix: 'RE', zaehler: {}
};
const basis = {
  typ: 'rechnung', datum: '2026-11-22', leistungsdatum: '2026-11-22', faelligAm: '2026-12-06',
  pferde: ['Sultan', 'Bella'], positionen: pos, rabatt: { art: 'prozent', wert: 5 }, summen: b,
  zahlart: 'ueberweisung', status: 'offen'
};
const inv1 = { ...basis, id: 'a1', nr: 'RE-2026-0001',
  kunde: { name: 'Reitstall Lindenhof GmbH', strasse: 'Lindenhof 3', plz: '54321', ort: 'Lindenau', land: 'DE', email: 'buchhaltung@lindenhof.example', typ: 'gewerbe', ustid: 'DE987654321' } };
const inv2 = { ...basis, id: 'a2', nr: 'RE-2026-0002', zahlart: 'bar', status: 'bezahlt', bezahltArt: 'bar', bezahltAm: '2026-11-22',
  positionen: [pos[0]], summen: L.berechne([pos[0]], null), rabatt: null, pferde: ['Luna'],
  kunde: { name: 'Anna Berger', strasse: 'Erlenweg 1', plz: '54322', ort: 'Erlenbach', email: 'anna@example.de', typ: 'privat' } };
const langePos = Array.from({ length: 40 }, (_, i) => ({ name: `Position ${i + 1} mit einer etwas längeren Beschreibung, die umbrechen muss, damit man das sieht`, menge: 1, einheit: 'Stk', preisCent: 1000, steuersatz: 19, rabattProzent: 0 }));
const inv3 = { ...basis, id: 'a3', nr: 'RE-2026-0003', positionen: langePos, summen: L.berechne(langePos, null), rabatt: null, kunde: inv2.kunde };

fs.mkdirSync('out', { recursive: true });
const files = {};
for (const inv of [inv1, inv2, inv3]) {
  const d = await erzeugeDateien(inv, s);
  inv.pdfHash = d.pdfHash; inv.hatXml = !!d.xml;
  files[inv.id] = d;
  fs.writeFileSync(`out/${inv.nr}.pdf`, d.pdf);
  if (d.xml) fs.writeFileSync(`out/${inv.nr}.xml`, d.xml);
}
assert.ok(files.a1.xml && !files.a2.xml);
const parsed = await PDFLib.PDFDocument.load(files.a3.pdf);
console.log('PDF RE-0003 Seiten:', parsed.getPageCount());
const z = await exportZip([inv2, inv1, inv3], L.zeitraumGrenzen('monat', 2026, 11), s, async (inv, art) => files[inv.id][art]);
fs.writeFileSync('out/' + z.name, z.bytes);
const zip = await JSZip.loadAsync(z.bytes);
console.log('ZIP:', Object.keys(zip.files).join(', '));
const wb = XLSX.read(await zip.file('Rechnungsliste 2026-11.xlsx').async('uint8array'));
const ws = wb.Sheets.Rechnungen;
assert.equal(ws.R2.l.Target, 'Rechnungen/RE-2026-0001.pdf');
console.log('Excel Zeile 2:', XLSX.utils.sheet_to_json(ws, { header: 1 })[1].join(' | '));
console.log('alles ok');
