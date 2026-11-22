// Anhänge für Eingangsrechnungen vorbereiten: Fotos verkleinern, E-Rechnungen erkennen.
import { uid } from './logic.js';
import { eRechnungLesen, xmlAusPdf } from './einvoice-in.js';

export const KATEGORIEN = ['Material & Eisen', 'Werkzeug', 'Fahrzeug & Kraftstoff', 'Büro & Telefon', 'Versicherung & Beiträge', 'Fortbildung', 'Sonstiges'];
export const ZAHLARTEN = { ueberweisung: 'Überweisung', lastschrift: 'Lastschrift', karte: 'Karte', bar: 'bar' };
const MAX_KANTE = 2200;
const QUALITAET = 0.8;

function artVon(file) {
  const n = (file.name || '').toLowerCase();
  if (file.type === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (/xml/.test(file.type) || n.endsWith('.xml')) return 'xml';
  if ((file.type || '').startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/.test(n)) return 'foto';
  return 'datei';
}

async function verkleinern(file) {
  const bild = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const f = Math.min(1, MAX_KANTE / Math.max(bild.width, bild.height));
  const w = Math.round(bild.width * f), h = Math.round(bild.height * f);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bild, 0, 0, w, h);
  bild.close && bild.close();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', QUALITAET));
  if (!blob) throw new Error('Bild konnte nicht umgewandelt werden');
  return new Uint8Array(await blob.arrayBuffer());
}

// Liefert { anhang, bytes, eRechnung } – eRechnung sind die aus XML gelesenen Angaben (falls vorhanden)
export async function dateiVorbereiten(file) {
  const art = artVon(file);
  const id = 'a' + uid();
  let bytes, typ = file.type || 'application/octet-stream', name = file.name || 'Beleg';
  let eRechnung = null;
  if (art === 'foto') {
    try {
      bytes = await verkleinern(file);
      typ = 'image/jpeg';
      name = name.replace(/\.[^.]+$/, '') + '.jpg';
    } catch (e) {
      console.warn('Foto bleibt im Original', e);
      bytes = new Uint8Array(await file.arrayBuffer());
    }
  } else {
    bytes = new Uint8Array(await file.arrayBuffer()); // PDF und XML unverändert aufbewahren
    if (art === 'xml') {
      typ = 'application/xml';
      eRechnung = eRechnungLesen(new TextDecoder('utf-8').decode(bytes));
    }
    if (art === 'pdf') {
      typ = 'application/pdf';
      try {
        const x = await xmlAusPdf(bytes);
        if (x) eRechnung = eRechnungLesen(x.text);
      } catch (e) { console.warn('PDF ohne lesbare E-Rechnung', e); }
    }
  }
  return { anhang: { id, name, typ, groesse: bytes.length, art: eRechnung ? (art === 'pdf' ? 'zugferd' : 'xrechnung') : art }, bytes, eRechnung };
}

export function anhangText(a) {
  return { foto: 'Foto', pdf: 'PDF', xml: 'XML', zugferd: 'ZUGFeRD-PDF', xrechnung: 'E-Rechnung (XML)', datei: 'Datei' }[a.art] || 'Datei';
}

export function groesseText(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
}

// Steuer aus Bruttobetrag und Satz herausrechnen
export function ausBrutto(bruttoCent, satz) {
  const netto = Math.round(bruttoCent / (1 + satz / 100));
  return { netto, steuer: bruttoCent - netto };
}
