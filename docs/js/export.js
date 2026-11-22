// Erzeugt PDF/XML einer Rechnung und den ZIP-Export für den Steuerberater.
import { erzeugePdf, sha256Hex } from './pdf.js';
import { erzeugeXml } from './einvoice.js';
import { dateiname, statusVon } from './logic.js';

// Echtes Excel-Datum (Mittag, damit keine Zeitzone den Tag verschiebt)
const xDatum = (iso) => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d, 12); };

export async function erzeugeDateien(inv, s) {
  const xml = inv.kunde.typ === 'gewerbe' ? erzeugeXml(inv, s) : null;
  const pdf = await erzeugePdf(inv, s, xml);
  return { pdf, xml: xml ? new TextEncoder().encode(xml) : null, pdfHash: await sha256Hex(pdf) };
}

// rechnungen: Liste der Rechnungen im Zeitraum, ladeDatei(inv, 'pdf'|'xml') -> Uint8Array
export async function exportZip(rechnungen, zeitraum, s, ladeDatei) {
  const XLSX = globalThis.XLSX;
  const JSZip = globalThis.JSZip;
  const zip = new JSZip();
  const ordner = zip.folder('Rechnungen');
  const sortiert = [...rechnungen].sort((a, b) => a.nr.localeCompare(b.nr));

  const kopf = ['Rechnungsnr.', 'Art', 'Rechnungsdatum', 'Leistungsdatum', 'Kunde', 'Kundenart',
    'Netto 19 %', 'USt 19 %', 'Netto 7 %', 'USt 7 %', 'Netto gesamt', 'USt gesamt', 'Brutto',
    'Zahlart', 'Status', 'Bezahlt am', 'Bezug', 'PDF'];
  const zeilen = [kopf];
  for (const inv of sortiert) {
    const pdf = await ladeDatei(inv, 'pdf');
    const name = dateiname(inv.nr);
    if (pdf) ordner.file(name + '.pdf', pdf);
    if (inv.hatXml) {
      const xml = await ladeDatei(inv, 'xml');
      if (xml) ordner.file(name + '.xml', xml);
    }
    const t19 = inv.summen.steuern.find((t) => t.satz === 19) || { netto: 0, steuer: 0 };
    const t7 = inv.summen.steuern.find((t) => t.satz === 7) || { netto: 0, steuer: 0 };
    const st = statusVon(inv);
    zeilen.push([
      inv.nr,
      inv.typ === 'storno' ? 'Stornorechnung' : 'Rechnung',
      xDatum(inv.datum),
      xDatum(inv.leistungsdatum),
      inv.kunde.name,
      inv.kunde.typ === 'gewerbe' ? 'Gewerbe' : 'Privat',
      t19.netto / 100, t19.steuer / 100, t7.netto / 100, t7.steuer / 100,
      inv.summen.netto / 100, inv.summen.steuer / 100, inv.summen.brutto / 100,
      inv.zahlart === 'bar' ? 'bar' : 'Überweisung',
      st.text.startsWith('Bank') ? 'bezahlt' : st.text,
      xDatum(inv.bezahltAm),
      inv.bezugNr || inv.storniertDurch || '',
      'öffnen'
    ]);
  }
  const n = sortiert.length;
  const summe = (c) => sortiert.reduce((a, inv, i) => a + (zeilen[i + 1][c] || 0), 0);
  zeilen.push([]);
  zeilen.push(['Summe', '', '', '', `${n} Belege`, '', summe(6), summe(7), summe(8), summe(9), summe(10), summe(11), summe(12)]);

  const ws = XLSX.utils.aoa_to_sheet(zeilen, { cellDates: false });
  const geld = '#,##0.00 "€"';
  for (let r = 1; r < zeilen.length; r++) {
    for (let c = 6; c <= 12; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = geld;
    }
    for (const c of [2, 3, 15]) {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (ws[ref] && ws[ref].t === 'n') ws[ref].z = 'dd.mm.yyyy';
    }
  }
  sortiert.forEach((inv, i) => {
    const ref = XLSX.utils.encode_cell({ r: i + 1, c: 17 });
    ws[ref].l = { Target: `Rechnungen/${dateiname(inv.nr)}.pdf`, Tooltip: `${inv.nr} öffnen` };
  });
  ws['!cols'] = [14, 14, 13, 13, 28, 10, 11, 10, 11, 10, 12, 11, 12, 12, 11, 11, 14, 9].map((w) => ({ wch: w }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(n, 1), c: 17 } }) };

  const wb = XLSX.utils.book_new();
  wb.Props = { Title: `Rechnungen ${zeitraum.label}`, Author: s.firma.name };
  XLSX.utils.book_append_sheet(wb, ws, 'Rechnungen');
  const xlsx = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  zip.file(`Rechnungsliste ${zeitraum.datei}.xlsx`, xlsx);
  zip.file('LIESMICH.txt',
    `Rechnungen ${zeitraum.label} – ${s.firma.name}\r\n\r\n` +
    `Bitte die ZIP-Datei zuerst vollständig entpacken. Danach öffnen die Links in der Spalte "PDF"\r\n` +
    `der Excel-Tabelle die jeweilige Rechnung aus dem Ordner "Rechnungen".\r\n` +
    `Bei Geschäftskunden liegt zusätzlich die E-Rechnung (XML, EN 16931) mit gleichem Namen bei.\r\n`);

  const blob = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { bytes: blob, name: `Rechnungen ${zeitraum.datei}.zip`, anzahl: n };
}
