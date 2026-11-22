// Datenhaltung im Gerät (IndexedDB). Mit eingeschalteter Synchronisierung werden Änderungen
// zusätzlich in einer Warteschlange (outbox) vermerkt und verschlüsselt hochgeladen.
import { uid, formatNummer, periodeVon, heuteISO } from './logic.js';

let DB_NAME = 'hufschmied-rechnungen';
const DB_VERSION = 3;
export const SYNC_STORES = ['settings', 'customers', 'horses', 'services', 'invoices', 'expenses', 'log'];
const BACKUP_STORES = [...SYNC_STORES, 'files'];

let dbPromise = null;
let syncAktiv = false;
const zuhoerer = new Set();
let dateiNachladen = null;

export function _setDbName(name) { DB_NAME = name; dbPromise = null; } // nur für Tests
export function setSyncAktiv(an) { syncAktiv = !!an; }
export function istSyncAktiv() { return syncAktiv; }
export function onAenderung(fn) { zuhoerer.add(fn); return () => zuhoerer.delete(fn); }
export function setDateiNachladen(fn) { dateiNachladen = fn; }
const gemeldet = () => zuhoerer.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const alt = ev.oldVersion;
      if (alt < 1) {
        db.createObjectStore('settings', { keyPath: 'key' });
        db.createObjectStore('customers', { keyPath: 'id' });
        db.createObjectStore('horses', { keyPath: 'id' }).createIndex('customerId', 'customerId');
        db.createObjectStore('services', { keyPath: 'id' });
        const i = db.createObjectStore('invoices', { keyPath: 'id' });
        i.createIndex('nr', 'nr', { unique: false });
        i.createIndex('datum', 'datum');
        db.createObjectStore('files', { keyPath: 'id' });
      }
      if (alt < 2) {
        // Protokoll mit eindeutigen IDs statt Zählern, damit mehrere Geräte zusammenpassen
        if (db.objectStoreNames.contains('log')) db.deleteObjectStore('log');
        db.createObjectStore('log', { keyPath: 'id' });
        db.createObjectStore('outbox', { keyPath: 'key' });
        db.createObjectStore('local', { keyPath: 'key' });
        if (alt >= 1) {
          const inv = req.transaction.objectStore('invoices');
          inv.deleteIndex('nr');
          inv.createIndex('nr', 'nr', { unique: false });
        }
      }
      if (alt < 3) {
        // Eingangsrechnungen (Belege von Lieferanten) mit beliebig vielen Anhängen
        db.createObjectStore('expenses', { keyPath: 'id' }).createIndex('datum', 'datum');
      }
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

const okey = (store, id) => store + '|' + id;
function vormerken(tx, store, id, op) {
  if (!syncAktiv) return;
  tx.objectStore('outbox').put({ key: okey(store, id), store, id, op, seq: Date.now() + Math.random() });
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
  const tx = db.transaction([store, 'outbox'], 'readwrite');
  tx.objectStore(store).put(value);
  vormerken(tx, store, value.id || value.key, 'put');
  await done(tx);
  gemeldet();
  return value;
}

export async function del(store, key) {
  const db = await open();
  const tx = db.transaction([store, 'outbox'], 'readwrite');
  tx.objectStore(store).delete(key);
  vormerken(tx, store, key, 'del');
  await done(tx);
  gemeldet();
}

export async function log(aktion, ref, details) {
  await put('log', { id: uid(), ts: new Date().toISOString(), aktion, ref: ref || null, details: details || null });
}

// --- Gerätebezogene Werte (werden nicht synchronisiert) ---------------------

export async function lokal(key) {
  const r = await get('local', key);
  return r ? r.value : undefined;
}
export async function setLokal(key, value) {
  const db = await open();
  const tx = db.transaction('local', 'readwrite');
  if (value === undefined) tx.objectStore('local').delete(key);
  else tx.objectStore('local').put({ key, value });
  await done(tx);
}

// --- Für die Synchronisierung -----------------------------------------------

export async function outbox() {
  return all('outbox');
}

// Entfernt erledigte Einträge, aber nur, wenn sie seit dem Hochladen nicht erneut geändert wurden
export async function outboxErledigt(eintraege) {
  const db = await open();
  const tx = db.transaction('outbox', 'readwrite');
  const os = tx.objectStore('outbox');
  for (const e of eintraege) {
    const r = os.get(e.key);
    r.onsuccess = () => { if (r.result && r.result.seq === e.seq) os.delete(e.key); };
  }
  await done(tx);
}

// Übernimmt einen Datensatz vom Server, ohne ihn erneut zum Hochladen vorzumerken
export async function vomServer(store, id, wert) {
  const db = await open();
  const tx = db.transaction([store], 'readwrite');
  const os = tx.objectStore(store);
  if (wert === null) os.delete(id);
  else if (store === 'settings') {
    // Rechnungszähler nie zurückdrehen: je Jahr den höheren Stand behalten
    const r = os.get(id);
    r.onsuccess = () => {
      const alt = r.result;
      const zaehler = { ...(wert.zaehler || {}) };
      if (alt && alt.zaehler) for (const [j, n] of Object.entries(alt.zaehler)) zaehler[j] = Math.max(n, zaehler[j] || 0);
      os.put({ ...wert, zaehler });
    };
  } else os.put(wert);
  await done(tx);
}

export async function dateiVomServer(fileId, bytes) {
  const db = await open();
  const tx = db.transaction('files', 'readwrite');
  tx.objectStore('files').put({ id: fileId, bytes });
  await done(tx);
}

// Alles Lokale zum Hochladen vormerken (außer den Schlüsseln, die der Server schon hat)
export async function allesVormerken(ausser = new Set()) {
  const db = await open();
  const stores = [...SYNC_STORES, 'files'];
  const daten = {};
  for (const st of stores) daten[st] = await reqP(db.transaction(st).objectStore(st).getAllKeys());
  const tx = db.transaction('outbox', 'readwrite');
  const os = tx.objectStore('outbox');
  for (const st of stores) for (const id of daten[st]) {
    if (!ausser.has(okey(st, id))) os.put({ key: okey(st, id), store: st, id, op: 'put', seq: Date.now() + Math.random() });
  }
  await done(tx);
}

export async function outboxLeeren() {
  const db = await open();
  const tx = db.transaction('outbox', 'readwrite');
  tx.objectStore('outbox').clear();
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
// nummerReservieren(periode als Zahl, z. B. 202601, mindestens) fragt bei eingeschalteter Synchronisierung den Server,
// damit zwei Geräte nie dieselbe Nummer vergeben. Ohne Netz wird lokal weitergezählt.

export async function festschreiben(entwurf, erzeugeDateien, nummerReservieren) {
  const db = await open();
  const s = await einstellungen();
  const periode = periodeVon(entwurf.datum);            // "2026-01"
  const periodeZahl = Number(periode.replace('-', ''));  // 202601 – Schlüssel für den Server-Zähler
  const lokalLfd = (s.zaehler[periode] || 0) + 1;
  let lfd = lokalLfd;
  let offline = false;
  if (nummerReservieren) {
    try {
      const n = await nummerReservieren(periodeZahl, lokalLfd - 1);
      if (Number.isInteger(n) && n > 0) lfd = Math.max(n, lokalLfd);
    } catch (e) {
      offline = true;
      console.warn('Nummer konnte nicht beim Server reserviert werden, zähle lokal weiter', e);
    }
  }
  const nr = formatNummer(s.prefix || 'RE', periode, lfd);
  const inv = { ...entwurf, id: uid(), nr, createdAt: new Date().toISOString(), nummerOffline: offline || undefined };

  // PDF (und ggf. XML) vor der Transaktion erzeugen – IndexedDB-Transaktionen dürfen nicht auf async warten
  const dateien = await erzeugeDateien(inv, s);
  inv.pdfHash = dateien.pdfHash;
  inv.hatXml = !!dateien.xml;

  const logEintrag = { id: uid(), ts: new Date().toISOString(), aktion: 'rechnung_erstellt', ref: nr, details: { brutto: inv.summen.brutto, sha256: inv.pdfHash } };
  const tx = db.transaction(['settings', 'invoices', 'files', 'log', 'outbox'], 'readwrite');
  tx.objectStore('settings').put({ ...s, zaehler: { ...s.zaehler, [periode]: lfd } });
  tx.objectStore('invoices').add(inv);
  tx.objectStore('files').put({ id: inv.id + ':pdf', bytes: dateien.pdf });
  if (dateien.xml) tx.objectStore('files').put({ id: inv.id + ':xml', bytes: dateien.xml });
  tx.objectStore('log').add(logEintrag);
  vormerken(tx, 'settings', 'settings', 'put');
  vormerken(tx, 'files', inv.id + ':pdf', 'put');
  if (dateien.xml) vormerken(tx, 'files', inv.id + ':xml', 'put');
  vormerken(tx, 'invoices', inv.id, 'put');
  vormerken(tx, 'log', logEintrag.id, 'put');
  await done(tx);
  gemeldet();
  return inv;
}

// Lädt eine Datei (PDF/XML). Fehlt sie auf diesem Gerät, wird sie – falls möglich – vom Server geholt.
export async function datei(invId, art) {
  const id = invId + ':' + art;
  const f = await get('files', id);
  if (f) return f.bytes;
  if (dateiNachladen) {
    try {
      const bytes = await dateiNachladen(id);
      if (bytes) { await dateiVomServer(id, bytes); return bytes; }
    } catch (e) { console.warn('Datei konnte nicht geladen werden', id, e); }
  }
  return null;
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

// --- Eingangsrechnungen -----------------------------------------------------
// Ein Beleg: { id, datum, lieferant, nummer, kategorie, netto, steuer, brutto, steuern[], zahlart, notiz,
//              anhaenge: [{ id, name, typ, groesse, art: 'foto'|'pdf'|'xml'|'datei' }], quelle, createdAt }
// Die Dateien liegen im Store 'files' unter `${beleg.id}:${anhang.id}` und werden unverändert synchronisiert.

export async function belegSpeichern(beleg, neueDateien = []) {
  const db = await open();
  const neu = !(await get('expenses', beleg.id));
  const tx = db.transaction(['expenses', 'files', 'log', 'outbox'], 'readwrite');
  for (const d of neueDateien) {
    tx.objectStore('files').put({ id: beleg.id + ':' + d.id, bytes: d.bytes });
    vormerken(tx, 'files', beleg.id + ':' + d.id, 'put');
  }
  tx.objectStore('expenses').put(beleg);
  vormerken(tx, 'expenses', beleg.id, 'put');
  const logEintrag = { id: uid(), ts: new Date().toISOString(), aktion: neu ? 'beleg_erfasst' : 'beleg_geaendert', ref: beleg.id, details: { lieferant: beleg.lieferant, brutto: beleg.brutto, anhaenge: beleg.anhaenge.length } };
  tx.objectStore('log').add(logEintrag);
  vormerken(tx, 'log', logEintrag.id, 'put');
  await done(tx);
  gemeldet();
  return beleg;
}

export async function belegLoeschen(beleg) {
  // Nicht endgültig löschen (Aufbewahrungspflicht): als gelöscht markieren, Daten und Dateien bleiben erhalten.
  return belegSpeichern({ ...beleg, geloescht: true, geloeschtAm: new Date().toISOString() });
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
  const daten = { app: 'hufschmied-rechnungen', version: 2, erstellt: new Date().toISOString(), stores: {} };
  for (const st of BACKUP_STORES) {
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
  const tx = db.transaction(BACKUP_STORES, 'readwrite');
  for (const st of BACKUP_STORES) {
    const os = tx.objectStore(st);
    os.clear();
    for (const row of daten.stores[st] || []) {
      if (st === 'files') os.put({ id: row.id, bytes: fromB64(row.b64) });
      else if (st === 'log') os.put(row.id && typeof row.id === 'string' ? row : { ...row, id: uid() });
      else os.put(row);
    }
  }
  await done(tx);
  if (syncAktiv) await allesVormerken();
  gemeldet();
}
