// Liest eingehende E-Rechnungen: XRechnung/ZUGFeRD im Format CII oder UBL.
// Bei ZUGFeRD-/Factur-X-PDFs wird die eingebettete XML-Datei herausgeholt. Alles passiert im Gerät.

// --- XML einlesen -----------------------------------------------------------

function kinder(el, name) {
  return [...el.childNodes].filter((c) => c.nodeType === 1 && c.localName === name);
}
// Pfad aus lokalen Namen, ohne Rücksicht auf Namensräume: pfad(root, 'A', 'B', 'C')
function pfad(el, ...namen) {
  let cur = [el];
  for (const n of namen) cur = cur.flatMap((c) => kinder(c, n));
  return cur;
}
const text = (els) => (els[0] ? els[0].textContent.trim() : '');
const zahl = (s) => {
  const n = Number(String(s || '').trim());
  return Number.isFinite(n) ? n : null;
};
const cent = (s) => {
  const n = zahl(s);
  return n === null ? null : Math.round(n * 100);
};
function isoAus102(s) {
  const t = String(s || '').trim();
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  return '';
}

function ausCii(root) {
  const doc = pfad(root, 'ExchangedDocument')[0];
  const tx = pfad(root, 'SupplyChainTradeTransaction')[0];
  if (!doc || !tx) return null;
  const agr = pfad(tx, 'ApplicableHeaderTradeAgreement')[0];
  const set = pfad(tx, 'ApplicableHeaderTradeSettlement')[0];
  const sum = set ? pfad(set, 'SpecifiedTradeSettlementHeaderMonetarySummation')[0] : null;
  const typ = text(pfad(doc, 'TypeCode'));
  const steuern = set ? pfad(set, 'ApplicableTradeTax').map((t) => ({
    satz: zahl(text(pfad(t, 'RateApplicablePercent'))) ?? 0,
    netto: cent(text(pfad(t, 'BasisAmount'))) ?? 0,
    steuer: cent(text(pfad(t, 'CalculatedAmount'))) ?? 0
  })) : [];
  const steuerGesamt = sum ? cent(text(pfad(sum, 'TaxTotalAmount'))) : null;
  return {
    format: 'CII',
    gutschrift: typ === '381',
    nummer: text(pfad(doc, 'ID')),
    datum: isoAus102(text(pfad(doc, 'IssueDateTime', 'DateTimeString'))),
    lieferant: agr ? text(pfad(agr, 'SellerTradeParty', 'Name')) : '',
    lieferantUstId: agr ? text(pfad(agr, 'SellerTradeParty', 'SpecifiedTaxRegistration', 'ID')) : '',
    netto: sum ? cent(text(pfad(sum, 'TaxBasisTotalAmount'))) : null,
    steuer: steuerGesamt ?? steuern.reduce((a, t) => a + t.steuer, 0),
    brutto: sum ? cent(text(pfad(sum, 'GrandTotalAmount'))) : null,
    zuZahlen: sum ? cent(text(pfad(sum, 'DuePayableAmount'))) : null,
    faellig: set ? isoAus102(text(pfad(set, 'SpecifiedTradePaymentTerms', 'DueDateDateTime', 'DateTimeString'))) : '',
    steuern
  };
}

function ausUbl(root) {
  const gutschrift = root.localName === 'CreditNote';
  const party = pfad(root, 'AccountingSupplierParty', 'Party')[0];
  const lieferant = party ? (text(pfad(party, 'PartyLegalEntity', 'RegistrationName')) || text(pfad(party, 'PartyName', 'Name'))) : '';
  const total = pfad(root, 'LegalMonetaryTotal')[0];
  const taxTotal = pfad(root, 'TaxTotal').find((t) => pfad(t, 'TaxSubtotal').length) || pfad(root, 'TaxTotal')[0];
  const steuern = taxTotal ? pfad(taxTotal, 'TaxSubtotal').map((t) => ({
    satz: zahl(text(pfad(t, 'TaxCategory', 'Percent'))) ?? 0,
    netto: cent(text(pfad(t, 'TaxableAmount'))) ?? 0,
    steuer: cent(text(pfad(t, 'TaxAmount'))) ?? 0
  })) : [];
  return {
    format: 'UBL',
    gutschrift,
    nummer: text(pfad(root, 'ID')),
    datum: isoAus102(text(pfad(root, 'IssueDate'))),
    lieferant,
    lieferantUstId: party ? text(pfad(party, 'PartyTaxScheme', 'CompanyID')) : '',
    netto: total ? cent(text(pfad(total, 'TaxExclusiveAmount'))) : null,
    steuer: taxTotal ? cent(text(pfad(taxTotal, 'TaxAmount'))) : steuern.reduce((a, t) => a + t.steuer, 0),
    brutto: total ? cent(text(pfad(total, 'TaxInclusiveAmount'))) : null,
    zuZahlen: total ? cent(text(pfad(total, 'PayableAmount'))) : null,
    faellig: isoAus102(text(pfad(root, 'DueDate'))) || isoAus102(text(pfad(root, 'PaymentMeans', 'PaymentDueDate'))),
    steuern
  };
}

// Liefert die erkannten Angaben oder null, wenn es keine E-Rechnung ist.
export function eRechnungLesen(xmlText, DOMParserImpl = globalThis.DOMParser) {
  if (!DOMParserImpl) return null;
  let doc;
  try {
    doc = new DOMParserImpl().parseFromString(xmlText, 'application/xml');
  } catch {
    return null;
  }
  const root = doc && doc.documentElement;
  if (!root || root.localName === 'parsererror' || doc.getElementsByTagName('parsererror').length) return null;
  let r = null;
  if (root.localName === 'CrossIndustryInvoice') r = ausCii(root);
  else if (root.localName === 'Invoice' || root.localName === 'CreditNote') r = ausUbl(root);
  if (!r) return null;
  if (r.netto === null && r.brutto !== null && r.steuer !== null) r.netto = r.brutto - r.steuer;
  if (r.brutto === null && r.netto !== null && r.steuer !== null) r.brutto = r.netto + r.steuer;
  return r;
}

// --- Eingebettete XML aus ZUGFeRD-/Factur-X-PDF holen ------------------------

const XML_NAMEN = /^(factur-x|zugferd-invoice|zugferd|xrechnung|order-x)\.xml$|\.xml$/i;

export async function xmlAusPdf(bytes, PDFLibImpl = globalThis.PDFLib) {
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, PDFString, PDFHexString, PDFRef, decodePDFRawStream } = PDFLibImpl;
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  } catch {
    return null;
  }
  const ctx = doc.context;
  const auf = (o) => (o instanceof PDFRef ? ctx.lookup(o) : o);
  const str = (o) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : '');
  const gefunden = [];

  const spezAuswerten = (spec) => {
    spec = auf(spec);
    if (!(spec instanceof PDFDict)) return;
    const name = str(auf(spec.get(PDFName.of('UF')))) || str(auf(spec.get(PDFName.of('F'))));
    const ef = auf(spec.get(PDFName.of('EF')));
    if (!(ef instanceof PDFDict)) return;
    const st = auf(ef.get(PDFName.of('F'))) || auf(ef.get(PDFName.of('UF')));
    if (!(st instanceof PDFRawStream)) return;
    let daten;
    try { daten = decodePDFRawStream(st).decode(); } catch { return; }
    gefunden.push({ name, daten });
  };
  const namensbaum = (knoten, tiefe = 0) => {
    knoten = auf(knoten);
    if (!(knoten instanceof PDFDict) || tiefe > 10) return;
    const names = auf(knoten.get(PDFName.of('Names')));
    if (names instanceof PDFArray) for (let i = 1; i < names.size(); i += 2) spezAuswerten(names.get(i));
    const kids = auf(knoten.get(PDFName.of('Kids')));
    if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i++) namensbaum(kids.get(i), tiefe + 1);
  };

  const namesDict = auf(doc.catalog.get(PDFName.of('Names')));
  if (namesDict instanceof PDFDict) namensbaum(namesDict.get(PDFName.of('EmbeddedFiles')));
  const af = auf(doc.catalog.get(PDFName.of('AF')));
  if (!gefunden.length && af instanceof PDFArray) for (let i = 0; i < af.size(); i++) spezAuswerten(af.get(i));

  const xml = gefunden.filter((g) => XML_NAMEN.test(g.name || ''))
    .sort((a, b) => Number(/factur-x|zugferd/i.test(b.name)) - Number(/factur-x|zugferd/i.test(a.name)))[0];
  if (!xml) return null;
  return { name: xml.name, text: new TextDecoder('utf-8').decode(xml.daten) };
}
