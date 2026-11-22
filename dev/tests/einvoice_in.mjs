import { createRequire } from 'module';
import fs from 'fs';
import assert from 'assert';
const require = createRequire(import.meta.url);
globalThis.PDFLib = require('pdf-lib');
const { DOMParser } = require('@xmldom/xmldom');
const { eRechnungLesen, xmlAusPdf } = await import('../../docs/js/einvoice-in.js');

// 1. Eigene ZUGFeRD-PDF (aus run.mjs erzeugt): XML herausholen und lesen
const pdf = fs.readFileSync('out/RE-2026-0001.pdf');
const x = await xmlAusPdf(new Uint8Array(pdf));
assert.ok(x, 'XML in PDF gefunden');
assert.equal(x.name, 'factur-x.xml');
const r = eRechnungLesen(x.text, DOMParser);
assert.equal(r.format, 'CII'); assert.equal(r.nummer, 'RE-2026-0001'); assert.equal(r.datum, '2026-11-22');
assert.equal(r.lieferant, 'Hufbeschlag Muster'); assert.equal(r.brutto, 15989); assert.equal(r.netto + r.steuer, r.brutto);
assert.equal(r.steuern.length, 2);
console.log('ZUGFeRD-PDF:', r.lieferant, r.nummer, r.brutto, r.steuern.map((t) => t.satz + '%').join('/'));

// 2. PDF ohne eingebettete Datei
assert.equal(await xmlAusPdf(new Uint8Array(fs.readFileSync('out/RE-2026-0002.pdf'))), null);
// 3. Kein PDF / kein XML
assert.equal(await xmlAusPdf(new Uint8Array([1, 2, 3])), null);
assert.equal(eRechnungLesen('<html><body>x</body></html>', DOMParser), null);

// 4. XRechnung UBL
const ubl = `<?xml version="1.0" encoding="UTF-8"?>
<ubl:Invoice xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ID>2026-4711</cbc:ID>
  <cbc:IssueDate>2026-11-03</cbc:IssueDate>
  <cbc:DueDate>2026-11-17</cbc:DueDate>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyTaxScheme><cbc:CompanyID>DE111222333</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>Hufeisen-Großhandel Nord GmbH</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">57.00</cbc:TaxAmount>
    <cac:TaxSubtotal><cbc:TaxableAmount currencyID="EUR">300.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="EUR">57.00</cbc:TaxAmount>
      <cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>19</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="EUR">300.00</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="EUR">300.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="EUR">357.00</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="EUR">357.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
</ubl:Invoice>`;
fs.writeFileSync('out/xrechnung-ubl-beispiel.xml', ubl);
const u = eRechnungLesen(ubl, DOMParser);
assert.deepEqual([u.format, u.nummer, u.datum, u.lieferant, u.netto, u.steuer, u.brutto, u.faellig, u.lieferantUstId],
  ['UBL', '2026-4711', '2026-11-03', 'Hufeisen-Großhandel Nord GmbH', 30000, 5700, 35700, '2026-11-17', 'DE111222333']);
console.log('XRechnung UBL:', u.lieferant, u.brutto);
console.log('E-Rechnung-Tests ok');
