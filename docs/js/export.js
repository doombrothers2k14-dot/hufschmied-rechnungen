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

const ENDUNG = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/webp': 'webp', 'application/pdf': 'pdf', 'application/xml': 'xml', 'text/xml': 'xml' };
const kurzname = (t) => String(t || 'Beleg').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss')
  .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'Beleg';
const ZAHLART = { ueberweisung: 'Überweisung', lastschrift: 'Lastschrift', karte: 'Karte', bar: 'bar' };

// rechnungen: Ausgangsrechnungen im Zeitraum, belege: Eingangsrechnungen im Zeitraum,
// ladeDatei(objekt, schluessel) -> Uint8Array  (Rechnung: 'pdf'|'xml', Beleg: Anhang-ID)
export async function exportZip(rechnungen, zeitraum, s, ladeDatei, belege = []) {
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

  // --- Eingangsrechnungen ---
  const eOrdner = zip.folder('Eingangsrechnungen');
  const bSortiert = [...belege].sort((a, b) => (a.datum + (a.createdAt || '')).localeCompare(b.datum + (b.createdAt || '')));
  const maxAnh = Math.max(1, ...bSortiert.map((b) => b.anhaenge.length));
  const eKopf = ['Lfd.', 'Rechnungsdatum', 'Lieferant', 'Rechnungsnr.', 'Kategorie', 'Netto', 'Vorsteuer', 'Brutto', 'Steuersatz', 'Bezahlt per', 'Quelle', 'Notiz'];
  for (let i = 1; i <= maxAnh; i++) eKopf.push(maxAnh === 1 ? 'Datei' : `Datei ${i}`);
  const eZeilen = [eKopf];
  const links = [];
  let nrB = 0;
  for (const b of bSortiert) {
    nrB++;
    const basis = `E${String(nrB).padStart(3, '0')}_${b.datum}_${kurzname(b.lieferant)}`;
    const zeile = [nrB, xDatum(b.datum), b.lieferant, b.nummer || '', b.kategorie || '',
      (b.netto || 0) / 100, (b.steuer || 0) / 100, (b.brutto || 0) / 100,
      (b.steuern || []).map((t) => t.satz + ' %').join(' / '), ZAHLART[b.zahlart] || '',
      b.quelle === 'e-rechnung' ? 'E-Rechnung' : b.anhaenge.length ? 'Foto/Datei' : 'ohne Beleg', b.notiz || ''];
    b.anhaenge.forEach((a, i) => {
      const name = `${basis}${b.anhaenge.length > 1 ? '_' + (i + 1) : ''}.${ENDUNG[a.typ] || (a.name.split('.').pop() || 'bin').toLowerCase()}`;
      links.push({ r: eZeilen.length, c: eKopf.length - maxAnh + i, ziel: `Eingangsrechnungen/${name}`, text: a.art === 'xrechnung' || a.art === 'xml' ? 'XML öffnen' : 'öffnen' });
      zeile.push('');
      eOrdner.file(name, ladeDatei(b, a.id).then((bytes) => bytes || new Uint8Array()));
    });
    eZeilen.push(zeile);
  }
  for (const l of links) eZeilen[l.r][l.c] = l.text;
  const eSumme = (c) => bSortiert.reduce((a, b, i) => a + (eZeilen[i + 1][c] || 0), 0);
  eZeilen.push([]);
  eZeilen.push(['Summe', '', `${bSortiert.length} Belege`, '', '', eSumme(5), eSumme(6), eSumme(7)]);
  const ews = XLSX.utils.aoa_to_sheet(eZeilen, { cellDates: false });
  for (let r = 1; r < eZeilen.length; r++) {
    for (let c = 5; c <= 7; c++) { const ref = XLSX.utils.encode_cell({ r, c }); if (ews[ref] && typeof ews[ref].v === 'number') ews[ref].z = geld; }
    const ref = XLSX.utils.encode_cell({ r, c: 1 }); if (ews[ref] && ews[ref].t === 'n') ews[ref].z = 'dd.mm.yyyy';
  }
  for (const l of links) ews[XLSX.utils.encode_cell({ r: l.r, c: l.c })].l = { Target: l.ziel, Tooltip: 'Beleg öffnen' };
  ews['!cols'] = [5, 13, 28, 16, 20, 11, 11, 11, 10, 12, 11, 24, ...Array(maxAnh).fill(10)].map((w) => ({ wch: w }));
  ews['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(bSortiert.length, 1), c: eKopf.length - 1 } }) };

  // --- Übersicht: Umsatzsteuer und Vorsteuer, Ausgaben nach Kategorie ---
  const aus = sortiert.reduce((a, inv) => ({ netto: a.netto + inv.summen.netto, steuer: a.steuer + inv.summen.steuer, brutto: a.brutto + inv.summen.brutto }), { netto: 0, steuer: 0, brutto: 0 });
  const ein = bSortiert.reduce((a, b) => ({ netto: a.netto + (b.netto || 0), steuer: a.steuer + (b.steuer || 0), brutto: a.brutto + (b.brutto || 0) }), { netto: 0, steuer: 0, brutto: 0 });
  const kat = {};
  for (const b of bSortiert) { const k = b.kategorie || 'ohne Kategorie'; kat[k] = kat[k] || { n: 0, netto: 0, steuer: 0, brutto: 0 }; kat[k].n++; kat[k].netto += b.netto || 0; kat[k].steuer += b.steuer || 0; kat[k].brutto += b.brutto || 0; }
  const ue = [
    [`Übersicht ${zeitraum.label}`], [s.firma.name], [],
    ['', 'Anzahl', 'Netto', 'Umsatzsteuer / Vorsteuer', 'Brutto'],
    ['Ausgangsrechnungen (Einnahmen)', n, aus.netto / 100, aus.steuer / 100, aus.brutto / 100],
    ['Eingangsrechnungen (Ausgaben)', bSortiert.length, ein.netto / 100, ein.steuer / 100, ein.brutto / 100],
    ['Umsatzsteuer abzüglich Vorsteuer', '', '', (aus.steuer - ein.steuer) / 100, ''],
    [], ['Ausgaben nach Kategorie', 'Anzahl', 'Netto', 'Vorsteuer', 'Brutto'],
    ...Object.entries(kat).sort((a, b) => b[1].brutto - a[1].brutto).map(([k, v]) => [k, v.n, v.netto / 100, v.steuer / 100, v.brutto / 100]),
    [], ['Hinweis: Vorläufige Zusammenstellung aus der App. Maßgeblich sind die einzelnen Belege.']
  ];
  const uws = XLSX.utils.aoa_to_sheet(ue);
  for (let r = 0; r < ue.length; r++) for (let c = 2; c <= 4; c++) { const ref = XLSX.utils.encode_cell({ r, c }); if (uws[ref] && typeof uws[ref].v === 'number') uws[ref].z = geld; }
  uws['!cols'] = [{ wch: 34 }, { wch: 9 }, { wch: 13 }, { wch: 24 }, { wch: 13 }];

  const wb = XLSX.utils.book_new();
  wb.Props = { Title: `Rechnungen und Belege ${zeitraum.label}`, Author: s.firma.name };
  XLSX.utils.book_append_sheet(wb, uws, 'Übersicht');
  XLSX.utils.book_append_sheet(wb, ws, 'Rechnungen');
  XLSX.utils.book_append_sheet(wb, ews, 'Eingangsrechnungen');
  const xlsx = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  zip.file(`Rechnungsliste ${zeitraum.datei}.xlsx`, xlsx);
  zip.file('LIESMICH.txt',
    `Rechnungen ${zeitraum.label} – ${s.firma.name}\r\n\r\n` +
    `Bitte die ZIP-Datei zuerst vollständig entpacken. Danach öffnen die Links in der Excel-Tabelle\r\n` +
    `die jeweilige Datei.\r\n\r\n` +
    `Blatt "Übersicht": Summen, Umsatzsteuer und Vorsteuer, Ausgaben nach Kategorie.\r\n` +
    `Blatt "Rechnungen": eigene Rechnungen (Ordner "Rechnungen"). Bei Geschäftskunden liegt\r\n` +
    `zusätzlich die E-Rechnung (XML, EN 16931) mit gleichem Namen bei.\r\n` +
    `Blatt "Eingangsrechnungen": Belege von Lieferanten (Ordner "Eingangsrechnungen").\r\n` +
    `Fotos sind verkleinerte Bildkopien. PDFs und E-Rechnungen (XML/ZUGFeRD) liegen unverändert im Original vor.\r\n`);

  const blob = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { bytes: blob, name: `Rechnungen und Belege ${zeitraum.datei}.zip`, anzahl: n, belege: bSortiert.length };
}
