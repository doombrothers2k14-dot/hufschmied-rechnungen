// Rechnungs-PDF (A4) mit allen Pflichtangaben nach § 14 Abs. 4 UStG.
// Für Geschäftskunden wird die E-Rechnung (factur-x.xml, EN 16931) eingebettet.
import qrcode from '../vendor/qrcode.mjs';
import { euro, deDatum, zahl, EINHEITEN } from './logic.js';

qrcode.stringToBytes = (s) => Array.from(new TextEncoder().encode(s));

const MM = 72 / 25.4;
const L = 25 * MM;
const R = 595.28 - 20 * MM;
const GRAU = [0.35, 0.37, 0.41];

export async function sha256Hex(bytes) {
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function giroCode(f, cent, nr) {
  if (!f.iban || cent <= 0) return null;
  const name = f.name.slice(0, 70);
  return ['BCD', '002', '1', 'SCT', (f.bic || '').replace(/\s/g, ''), name, f.iban.replace(/\s/g, ''),
    'EUR' + (cent / 100).toFixed(2), '', '', ('Rechnung ' + nr).slice(0, 140), ''].join('\n');
}

export async function erzeugePdf(inv, s, xml) {
  const { PDFDocument, StandardFonts, rgb, AFRelationship, PDFName, PDFString } = globalThis.PDFLib;
  const f = s.firma;
  const k = inv.kunde;
  const sum = inv.summen;

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const titel = inv.typ === 'storno' ? `Stornorechnung ${inv.nr}` : `Rechnung ${inv.nr}`;
  doc.setTitle(titel);
  doc.setAuthor(f.name);
  doc.setSubject(`${titel} an ${k.name}`);
  doc.setCreator('Hufschmied-Rechnungen');
  doc.setProducer('Hufschmied-Rechnungen');
  doc.setLanguage('de-DE');

  // Zeichen, die die Standardschrift nicht kann, ersetzen
  const ersatz = { '−': '-', ' ': ' ', ' ': ' ', '→': '->' };
  const okCache = new Map();
  const safe = (t) => [...String(t ?? '')].map((ch) => {
    if (ersatz[ch]) return ersatz[ch];
    if (!okCache.has(ch)) { try { font.encodeText(ch); okCache.set(ch, true); } catch { okCache.set(ch, false); } }
    return okCache.get(ch) ? ch : '?';
  }).join('');

  const pages = [];
  let page, y;
  const text = (t, x, yy, o = {}) => {
    const fnt = o.bold ? bold : font;
    const size = o.size || 10;
    const str = safe(t);
    let xx = x;
    if (o.align === 'right') xx = x - fnt.widthOfTextAtSize(str, size);
    page.drawText(str, { x: xx, y: yy, size, font: fnt, color: o.color ? rgb(...o.color) : rgb(0.09, 0.1, 0.11) });
  };
  const linie = (yy, x1 = L, x2 = R, w = 0.6) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: w, color: rgb(0.75, 0.77, 0.8) });
  const umbrechen = (t, width, size = 10, fnt = font) => {
    const worte = safe(t).split(/\s+/);
    const zeilen = [];
    let z = '';
    for (const w of worte) {
      const test = z ? z + ' ' + w : w;
      if (fnt.widthOfTextAtSize(test, size) > width && z) { zeilen.push(z); z = w; } else z = test;
    }
    if (z) zeilen.push(z);
    return zeilen.length ? zeilen : [''];
  };

  const fuss = () => {
    const yy = 22 * MM;
    linie(yy + 12);
    const c1 = [f.name, f.strasse, `${f.plz} ${f.ort}`];
    const c2 = [f.telefon ? 'Tel. ' + f.telefon : '', f.email, f.steuernummer ? 'Steuernr. ' + f.steuernummer : '', f.ustid ? 'USt-IdNr. ' + f.ustid : ''].filter(Boolean);
    const c3 = [f.bank, f.iban ? 'IBAN ' + f.iban : '', f.bic ? 'BIC ' + f.bic : ''].filter(Boolean);
    [[c1, L], [c2, L + 165], [c3, L + 330]].forEach(([col, x]) => col.forEach((t, i) => text(t, x, yy - i * 9.5, { size: 7.5, color: GRAU })));
  };

  const neueSeite = () => {
    page = doc.addPage([595.28, 841.89]);
    pages.push(page);
    fuss();
    y = 800;
  };

  // --- Seite 1: Kopf ---
  neueSeite();
  let ky = 805;
  text(f.name, R, ky, { bold: true, size: 14, align: 'right' }); ky -= 15;
  [f.inhaber && f.inhaber !== f.name ? f.inhaber : '', f.strasse, `${f.plz} ${f.ort}`, f.telefon ? 'Tel. ' + f.telefon : '', f.email]
    .filter(Boolean).forEach((t) => { text(t, R, ky, { size: 9, align: 'right', color: GRAU }); ky -= 11.5; });

  // Absenderzeile + Anschrift (Fensterbereich nach DIN 5008)
  const fensterOben = 841.89 - 45 * MM;
  text(`${f.name} · ${f.strasse} · ${f.plz} ${f.ort}`, L, fensterOben - 10, { size: 7, color: GRAU });
  let ay = fensterOben - 30;
  [k.name, k.zusatz, k.strasse, `${k.plz} ${k.ort}`].filter(Boolean).forEach((t) => { text(t, L, ay, { size: 10.5 }); ay -= 14; });

  // Infoblock rechts
  const ix = 125 * MM, iw = R;
  let iy = fensterOben - 30;
  const info = [
    [inv.typ === 'storno' ? 'Storno-Nr.' : 'Rechnungsnr.', inv.nr],
    ['Rechnungsdatum', deDatum(inv.datum)],
    ['Leistungsdatum', deDatum(inv.leistungsdatum)]
  ];
  if (inv.bezugNr) info.push(['zu Rechnung', inv.bezugNr]);
  if (k.ustid) info.push(['Ihre USt-IdNr.', k.ustid]);
  if (k.leitwegId) info.push(['Leitweg-ID', k.leitwegId]);
  info.forEach(([a, b]) => { text(a, ix, iy, { size: 9, color: GRAU }); text(b, iw, iy, { size: 9, align: 'right' }); iy -= 13; });

  y = 841.89 - 105 * MM;
  text(titel, L, y, { bold: true, size: 14 }); y -= 18;
  if (inv.pferde && inv.pferde.length) { text('Pferde: ' + inv.pferde.join(', '), L, y, { size: 10 }); y -= 14; }
  if (inv.typ === 'storno') { text(`Diese Stornorechnung hebt die Rechnung ${inv.bezugNr} vom ${deDatum(inv.bezugDatum)} vollständig auf.`, L, y, { size: 10 }); y -= 14; }
  y -= 10;

  // --- Positionen ---
  const hatRabatt = sum.zeilen.some((z) => z.zeilenRabatt);
  const col = { pos: L, txt: L + 24, menge: L + 268, preis: L + 343, rabatt: L + 390, betrag: R };
  const kopf = () => {
    text('Pos.', col.pos, y, { size: 8.5, bold: true, color: GRAU });
    text('Bezeichnung', col.txt, y, { size: 8.5, bold: true, color: GRAU });
    text('Menge', col.menge, y, { size: 8.5, bold: true, color: GRAU, align: 'right' });
    text('Einzelpreis', col.preis, y, { size: 8.5, bold: true, color: GRAU, align: 'right' });
    if (hatRabatt) text('Rabatt', col.rabatt, y, { size: 8.5, bold: true, color: GRAU, align: 'right' });
    text('Betrag netto', col.betrag, y, { size: 8.5, bold: true, color: GRAU, align: 'right' });
    y -= 6; linie(y); y -= 13;
  };
  kopf();
  const textBreite = (hatRabatt ? col.menge - 50 : col.menge - 40) - col.txt;
  sum.zeilen.forEach((z, i) => {
    const zeilen = umbrechen(z.name, textBreite);
    if (y - zeilen.length * 13 < 60 * MM) { neueSeite(); kopf(); }
    text(String(i + 1), col.pos, y);
    zeilen.forEach((t, j) => text(t, col.txt, y - j * 13));
    text(`${zahl(z.menge)} ${(EINHEITEN[z.einheit] || EINHEITEN.Stk).label}`, col.menge, y, { align: 'right' });
    text(euro(z.preisCent), col.preis, y, { align: 'right' });
    if (hatRabatt && z.rabattProzent) text(`${zahl(z.rabattProzent)} %`, col.rabatt, y, { align: 'right' });
    text(euro(z.zeileNetto), col.betrag, y, { align: 'right' });
    y -= zeilen.length * 13 + 5;
  });
  linie(y + 8);
  y -= 8;

  // --- Summen ---
  if (y < 75 * MM) neueSeite();
  const sx = L + 250;
  const summe = (a, b, o = {}) => { text(a, sx, y, o); text(b, R, y, { ...o, align: 'right' }); y -= o.bold ? 18 : 14; };
  if (sum.gesamtRabatt) {
    summe('Summe Positionen', euro(sum.summePositionen));
    summe(inv.rabatt.art === 'prozent' ? `Rabatt ${zahl(inv.rabatt.wert)} %` : 'Rabatt', euro(-sum.gesamtRabatt));
  }
  summe('Nettobetrag', euro(sum.netto));
  sum.steuern.forEach((t) => summe(`zzgl. ${t.satz} % USt auf ${euro(t.netto)}`, euro(t.steuer)));
  y -= 2;
  page.drawLine({ start: { x: sx, y: y + 12 }, end: { x: R, y: y + 12 }, thickness: 0.8, color: rgb(0.09, 0.1, 0.11) });
  summe(inv.typ === 'storno' ? 'Gutschriftbetrag' : 'Gesamtbetrag', euro(sum.brutto), { bold: true, size: 11.5 });
  y -= 10;

  // --- Zahlung ---
  if (y < 70 * MM) neueSeite();
  if (inv.typ === 'storno') {
    text('Ein bereits gezahlter Betrag wird Ihnen erstattet.', L, y); y -= 14;
  } else if (inv.zahlart === 'bar') {
    text(`Betrag in bar erhalten am ${deDatum(inv.bezahltAm || inv.datum)}. Vielen Dank!`, L, y); y -= 14;
  } else {
    const zeilen = umbrechen(`Bitte überweisen Sie den Gesamtbetrag bis zum ${deDatum(inv.faelligAm)} ohne Abzug unter Angabe der Rechnungsnummer ${inv.nr} auf das unten genannte Konto.`, 300);
    const qrText = giroCode(f, sum.brutto, inv.nr);
    const startY = y;
    zeilen.forEach((t) => { text(t, L, y); y -= 13; });
    y -= 4;
    text('Vielen Dank für Ihren Auftrag!', L, y); y -= 14;
    if (qrText) {
      const qr = qrcode(0, 'M');
      qr.addData(qrText);
      qr.make();
      const n = qr.getModuleCount();
      const groesse = 26 * MM;
      const m = groesse / n;
      const qx = R - groesse, qy = startY - groesse + 10;
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) page.drawRectangle({ x: qx + c * m, y: qy + (n - 1 - r) * m, width: m + 0.05, height: m + 0.05, color: rgb(0, 0, 0) });
      }
      text('Mit Banking-App scannen', R - groesse / 2 - font.widthOfTextAtSize('Mit Banking-App scannen', 7) / 2, qy - 10, { size: 7, color: GRAU });
      y = Math.min(y, qy - 20);
    }
  }
  if (xml) { y -= 6; text('Diese Rechnung enthält eine E-Rechnung nach EN 16931 (ZUGFeRD) als eingebettete Datei.', L, y, { size: 8, color: GRAU }); }

  // Seitenzahlen
  if (pages.length > 1) pages.forEach((p, i) => {
    const t = `Seite ${i + 1} von ${pages.length}`;
    p.drawText(t, { x: R - font.widthOfTextAtSize(t, 7.5), y: 28 * MM, size: 7.5, font, color: rgb(...GRAU) });
  });

  if (xml) {
    const xmlBytes = new TextEncoder().encode(xml);
    await doc.attach(xmlBytes, 'factur-x.xml', {
      mimeType: 'text/xml',
      description: 'E-Rechnung (Factur-X/ZUGFeRD, EN 16931)',
      creationDate: new Date(),
      modificationDate: new Date(),
      afRelationship: AFRelationship ? AFRelationship.Alternative : undefined
    });
    const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${titel}</rdf:li></rdf:Alt></dc:title></rdf:Description>
<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"><fx:DocumentType>INVOICE</fx:DocumentType><fx:DocumentFileName>factur-x.xml</fx:DocumentFileName><fx:Version>1.0</fx:Version><fx:ConformanceLevel>EN 16931</fx:ConformanceLevel></rdf:Description>
</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
    const stream = doc.context.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' });
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
  }

  return doc.save({ useObjectStreams: false });
}
