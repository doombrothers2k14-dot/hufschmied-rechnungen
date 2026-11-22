// Reine Rechenlogik – ohne Browser-Abhängigkeiten, damit sie auch in Node getestet werden kann.

export const STEUERSAETZE = [19, 7];

export const EINHEITEN = {
  Stk: { label: 'Stück', code: 'C62' },
  pauschal: { label: 'pauschal', code: 'LS' },
  km: { label: 'km', code: 'KMT' },
  Std: { label: 'Std.', code: 'HUR' }
};

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// --- Geld (immer in Cent rechnen) -----------------------------------------

export function euro(cent) {
  const neg = cent < 0;
  const abs = Math.abs(Math.round(cent));
  const e = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const c = String(abs % 100).padStart(2, '0');
  return (neg ? '−' : '') + e + ',' + c + ' €';
}

// "12,50" / "12.5" / "12" -> 1250 ; leere/ungültige Eingabe -> null
export function parseEuro(text) {
  if (text === null || text === undefined) return null;
  let t = String(text).trim().replace(/€/g, '').replace(/\s/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function centToInput(cent) {
  return (cent / 100).toFixed(2).replace('.', ',');
}

export function parseZahl(text) {
  if (text === null || text === undefined) return null;
  const t = String(text).trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function zahl(n) {
  return String(Math.round(n * 1000) / 1000).replace('.', ',');
}

// --- Datum ------------------------------------------------------------------

export function heuteISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const t = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${t}`;
}

export function deDatum(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

export function plusTage(iso, tage) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + tage));
  return dt.toISOString().slice(0, 10);
}

export function tageZwischen(isoA, isoB) {
  const a = Date.parse(isoA + 'T00:00:00Z');
  const b = Date.parse(isoB + 'T00:00:00Z');
  return Math.round((b - a) / 864e5);
}

// --- Rechnungssummen --------------------------------------------------------
// Position: { name, menge, einheit, preisCent (netto), steuersatz, rabattProzent }
// Rabatt auf die ganze Rechnung: { art: 'prozent' | 'betrag', wert } (wert: Prozent bzw. Cent)

const rnd = (x) => Math.sign(x) * Math.round(Math.abs(x)); // kaufmännisch, symmetrisch für Storno

export function berechne(positionen, rabatt) {
  const zeilen = positionen.map((p) => {
    const brutto = rnd(p.menge * p.preisCent); // Menge × Einzelpreis (netto)
    const rp = Number(p.rabattProzent) || 0;
    const nachlass = rnd(brutto * rp / 100);
    return { ...p, zeileOhneRabatt: brutto, zeilenRabatt: nachlass, zeileNetto: brutto - nachlass };
  });
  const summePositionen = zeilen.reduce((s, z) => s + z.zeileNetto, 0);

  let gesamtRabatt = 0;
  if (rabatt && rabatt.wert) {
    if (rabatt.art === 'prozent') gesamtRabatt = rnd(summePositionen * rabatt.wert / 100);
    else gesamtRabatt = rnd(rabatt.wert);
  }
  if (summePositionen >= 0) gesamtRabatt = Math.max(0, Math.min(gesamtRabatt, summePositionen));
  else gesamtRabatt = Math.min(0, Math.max(gesamtRabatt, summePositionen));

  // Positionen nach Steuersatz gruppieren und den Gesamtrabatt anteilig verteilen
  const saetze = [...new Set(zeilen.map((z) => z.steuersatz))].sort((a, b) => b - a);
  let rest = gesamtRabatt;
  const steuern = saetze.map((satz, i) => {
    const basis = zeilen.filter((z) => z.steuersatz === satz).reduce((s, z) => s + z.zeileNetto, 0);
    let anteil;
    if (i === saetze.length - 1) anteil = rest;
    else anteil = summePositionen ? rnd(gesamtRabatt * basis / summePositionen) : 0;
    rest -= anteil;
    const netto = basis - anteil;
    const steuer = rnd(netto * satz / 100);
    return { satz, basisPositionen: basis, rabatt: anteil, netto, steuer };
  });

  const netto = steuern.reduce((s, t) => s + t.netto, 0);
  const steuer = steuern.reduce((s, t) => s + t.steuer, 0);
  return { zeilen, summePositionen, gesamtRabatt, steuern, netto, steuer, brutto: netto + steuer };
}

// --- Nummernkreis -----------------------------------------------------------

// Ein Nummernkreis pro Monat: RE-2026-01-0001, RE-2026-01-0002 … im Februar RE-2026-02-0001.
// Zulässig nach § 14 UStG, weil der Monat Teil der Nummer ist und jede Nummer eindeutig bleibt.
export function periodeVon(datumIso) {
  return datumIso.slice(0, 7); // "2026-01"
}
export function formatNummer(prefix, periode, lfd) {
  return `${prefix}-${periode}-${String(lfd).padStart(4, '0')}`;
}

// --- Pferde: wann ist der nächste Termin fällig? -----------------------------

export function faelligkeit(pferd, heute = heuteISO()) {
  if (!pferd.letzterTermin || !pferd.intervallWochen) return null;
  const naechster = plusTage(pferd.letzterTermin, Math.round(pferd.intervallWochen * 7));
  return { naechster, inTagen: tageZwischen(heute, naechster) };
}

export function faelligText(inTagen) {
  if (inTagen < 0) return `seit ${-inTagen} ${-inTagen === 1 ? 'Tag' : 'Tagen'} fällig`;
  if (inTagen === 0) return 'heute fällig';
  if (inTagen === 1) return 'morgen';
  return `in ${inTagen} Tagen`;
}

// --- Status einer Rechnung --------------------------------------------------

export function statusVon(inv, heute = heuteISO()) {
  if (inv.status === 'storniert') return { key: 'storniert', text: 'storniert' };
  if (inv.typ === 'storno') return { key: 'storno', text: 'Storno' };
  if (inv.status === 'bezahlt') {
    if (inv.bezahltArt === 'bar') return { key: 'bezahlt', text: 'bar bezahlt' };
    return { key: 'bezahlt', text: 'Bank ' + deDatum(inv.bezahltAm) };
  }
  if (inv.faelligAm && inv.faelligAm < heute) return { key: 'ueberfaellig', text: 'überfällig' };
  return { key: 'offen', text: 'offen' };
}

export function zeitraumGrenzen(art, jahr, nr) {
  // art: 'monat' (nr 1–12), 'quartal' (nr 1–4), 'jahr', 'bereich' (nr = { von, bis })
  const pad = (n) => String(n).padStart(2, '0');
  if (art === 'jahr') return { von: `${jahr}-01-01`, bis: `${jahr}-12-31`, label: `${jahr}`, datei: `${jahr}` };
  if (art === 'quartal') {
    const m1 = (nr - 1) * 3 + 1;
    const m3 = m1 + 2;
    const ende = new Date(Date.UTC(jahr, m3, 0)).getUTCDate();
    return { von: `${jahr}-${pad(m1)}-01`, bis: `${jahr}-${pad(m3)}-${ende}`, label: `${nr}. Quartal ${jahr}`, datei: `${jahr}-Q${nr}` };
  }
  const namen = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  if (art === 'bereich') {
    // nr = { von: { jahr, monat }, bis: { jahr, monat } }
    let a = nr.von, b = nr.bis;
    if (a.jahr * 12 + a.monat > b.jahr * 12 + b.monat) [a, b] = [b, a];
    const endeB = new Date(Date.UTC(b.jahr, b.monat, 0)).getUTCDate();
    const kurz = (x) => `${namen[x.monat - 1]} ${x.jahr}`;
    const gleich = a.jahr === b.jahr && a.monat === b.monat;
    return {
      von: `${a.jahr}-${pad(a.monat)}-01`, bis: `${b.jahr}-${pad(b.monat)}-${endeB}`,
      label: gleich ? kurz(a) : a.jahr === b.jahr ? `${namen[a.monat - 1]} bis ${kurz(b)}` : `${kurz(a)} bis ${kurz(b)}`,
      datei: gleich ? `${a.jahr}-${pad(a.monat)}` : `${a.jahr}-${pad(a.monat)} bis ${b.jahr}-${pad(b.monat)}`
    };
  }
  const ende = new Date(Date.UTC(jahr, nr, 0)).getUTCDate();
  return { von: `${jahr}-${pad(nr)}-01`, bis: `${jahr}-${pad(nr)}-${ende}`, label: `${namen[nr - 1]} ${jahr}`, datei: `${jahr}-${pad(nr)}` };
}

export function dateiname(nr) {
  return nr.replace(/[^A-Za-z0-9_-]/g, '_');
}
