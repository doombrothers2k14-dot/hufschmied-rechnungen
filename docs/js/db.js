// Datenhaltung im Gerät (IndexedDB). Nichts verlässt das iPhone, außer man teilt es bewusst.
import { uid, formatNummer, heuteISO } from './logic.js';

const DB_NAME = 'hufschmied-rechnungen';
const DB_VERSION = 1;
const STORES = ['settings', 'customers', 'horses', 'services', 'invoices', 'files', 'log'];

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('settings', { keyPath: 'key' });
      db.createObjectStore('customers', { keyPath: 'id' });
      const h = db.createObjectStore('horses', { keyPath: 'id' });
      h.createIndex('customerId', 'customerId');
      db.createObjectStore('services', { keyPath: 'id' });
      const i = db.createObjectStore('invoices', { keyPath: 'id' });
      i.createIndex('nr', 'nr', { unique: true });
      i.createIndex('datum', 'datum');
      db.createObjectStore('files', { keyPath: 'id' });
      db.createObjectStore('log', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaktion abgebrochen'));
  });
}

function reqP(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function all(store) {
  const db = await open();
  return reqP(db.transaction(store).objectStore(store).getAll());
}

export async function get(store, key) {
  const db = await open();
  return reqP(db.transaction(store).objectStore(store).get(key));
}

export async function put(store, value) {
  const db = await open();
  const tx = db.transaction([store, 'log'], 'readwrite');
  tx.objectStore(store).put(value);
  await done(tx);
  return value;
}

export async function del(store, key) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await done(tx);
}

export async function log(aktion, ref, details) {
  const db = await open();
  const tx = db.transaction('log', 'readwrite');
  tx.objectStore('log').add({ ts: new Date().toISOString(), aktion, ref: ref || null, details: details || null });
  await done(tx);
}

// --- Einstellungen ----------------------------------------------------------

export const STANDARD_EINSTELLUNGEN = {
  key: 'settings',
  firma: {
    name: '', inhaber: '', strasse: '', plz: '', ort: '', land: 'DE',
    telefon: '', email: '', steuernummer: '', ustid: '',
    iban: '', bic: '', bank: ''
  },
  zahlungszielTage: 14,
  prefix: 'RE',
  zaehler: {},
  letzteSicherung: null,
  mailText: 'Guten Tag,\n\nanbei erhalten Sie Ihre Rechnung {nr} über {betrag}.\n\nViele Grüße\n{firma}'
};

export async function einstellungen() {
  const s = await get('settings', 'settings');
  if (!s) return structuredClone(STANDARD_EINSTELLUNGEN);
  return { ...structuredClone(STANDARD_EINSTELLUNGEN), ...s, firma: { ...STANDARD_EINSTELLUNGEN.firma, ...s.firma } };
}

export async function speichereEinstellungen(s) {
  await put('settings', { ...s, key: 'settings' });
}

export function firmaVollstaendig(s) {
  const f = s.firma;
  return !!(f.name && f.strasse && f.plz && f.ort && (f.steuernummer || f.ustid) && f.iban);
}

// --- Rechnung festschreiben -------------------------------------------------
// Vergibt die nächste Nummer, speichert Rechnung + PDF + Prüfsumme in EINER Transaktion.
// Danach ist die Rechnung unveränderbar; nur Zahlungsstatus und Storno-Vermerk ändern sich.

export async function festschreiben(entwurf, erzeugeDateien) {
  const db = await open();
  const s = await einstellungen();
  const jahr = Number(entwurf.datum.slice(0, 4));
  const lfd = (s.zaehler[jahr] || 0) + 1;
  const nr = formatNummer(s.prefix || 'RE', jahr, lfd);
  const inv = { ...entwurf, id: uid(), nr, createdAt: new Date().toISOString() };

  // PDF (und ggf. XML) vor der Transaktion erzeugen – IndexedDB-Transaktionen dürfen nicht auf async warten
  const dateien = await erzeugeDateien(inv, s);
  inv.pdfHash = dateien.pdfHash;
  inv.hatXml = !!dateien.xml;

  const tx = db.transaction(['settings', 'invoices', 'files', 'log'], 'readwrite');
  const settingsStore = tx.objectStore('settings');
  const neu = { ...s, zaehler: { ...s.zaehler, [jahr]: lfd } };
  settingsStore.put(neu);
  tx.objectStore('invoices').add(inv);
  tx.objectStore('files').put({ id: inv.id + ':pdf', bytes: dateien.pdf });
  if (dateien.xml) tx.objectStore('files').put({ id: inv.id + ':xml', bytes: dateien.xml });
  tx.objectStore('log').add({ ts: new Date().toISOString(), aktion: 'rechnung_erstellt', ref: nr, details: { brutto: inv.summen.brutto, sha256: inv.pdfHash } });
  await done(tx);
  return inv;
}

export async function datei(invId, art) {
  const f = await get('files', invId + ':' + art);
  return f ? f.bytes : null;
}

export async function zahlungSetzen(inv, art, datum) {
  const neu = { ...inv, status: 'bezahlt', bezahltArt: art, bezahltAm: datum };
  await put('invoices', neu);
  await log('zahlung_erfasst', inv.nr, { art, datum });
  return neu;
}

export async function zahlungZuruecksetzen(inv) {
  const neu = { ...inv, status: 'offen', bezahltArt: null, bezahltAm: null };
  await put('invoices', neu);
  await log('zahlung_zurueckgesetzt', inv.nr, null);
  return neu;
}

export async function alsGesendetMarkieren(inv) {
  if (inv.gesendetAm) return inv;
  const neu = { ...inv, gesendetAm: new Date().toISOString() };
  await put('invoices', neu);
  await log('rechnung_geteilt', inv.nr, null);
  return neu;
}

export async function stornoVermerken(original, storno) {
  const neu = { ...original, status: 'storniert', storniertDurch: storno.nr };
  await put('invoices', neu);
  await log('rechnung_storniert', original.nr, { storno: storno.nr });
  return neu;
}

// Nach einer Rechnung den letzten Termin der Pferde nachtragen
export async function termineNachtragen(pferdIds, datum) {
  for (const id of pferdIds) {
    const p = await get('horses', id);
    if (p && (!p.letzterTermin || p.letzterTermin < datum)) await put('horses', { ...p, letzterTermin: datum });
  }
}

// --- Datensicherung ---------------------------------------------------------

function toB64(bytes) {
  let s = '';
  const u = new Uint8Array(bytes);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(b64) {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

export async function sicherungErstellen() {
  const daten = { app: 'hufschmied-rechnungen', version: 1, erstellt: new Date().toISOString(), stores: {} };
  for (const st of STORES) {
    let rows = await all(st);
    if (st === 'files') rows = rows.map((r) => ({ id: r.id, b64: toB64(r.bytes) }));
    daten.stores[st] = rows;
  }
  const s = await einstellungen();
  await speichereEinstellungen({ ...s, letzteSicherung: heuteISO() });
  return JSON.stringify(daten);
}

export async function sicherungEinspielen(text) {
  const daten = JSON.parse(text);
  if (daten.app !== 'hufschmied-rechnungen' || !daten.stores) throw new Error('Das ist keine Datensicherung dieser App.');
  const db = await open();
  const tx = db.transaction(STORES, 'readwrite');
  for (const st of STORES) {
    const os = tx.objectStore(st);
    os.clear();
    for (const row of daten.stores[st] || []) {
      if (st === 'files') os.put({ id: row.id, bytes: fromB64(row.b64) });
      else os.put(row);
    }
  }
  await done(tx);
}
