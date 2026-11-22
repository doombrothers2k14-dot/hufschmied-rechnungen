// Abgleich zwischen Gerät und Server. Alles wird vor dem Hochladen verschlüsselt.
// remote: { fetchSince(isoOderNull) -> rows[], upsert(rows), uploadFile(id, bytes), downloadFile(id) }
// rows: { store, id, deleted, data, iv, updated_at }
import { verschluesselnJson, entschluesselnJson, verschluesselnBytes, entschluesselnBytes } from './crypto.js';

const UEBERLAPPUNG_MS = 5 * 60 * 1000; // gleicht Uhr- und Commit-Reihenfolge des Servers aus

export function createSync({ db, remote, key }) {
  let laeuft = null;

  async function holen({ alles = false } = {}) {
    const seit = alles ? null : await db.lokal('sync.letzterAbruf');
    const ab = seit ? new Date(Date.parse(seit) - UEBERLAPPUNG_MS).toISOString() : null;
    const rows = await remote.fetchSince(ab);
    const wartend = new Set((await db.outbox()).map((e) => e.key));
    const gesehen = new Set();
    let neuester = seit;
    let geaendert = 0;
    for (const row of rows) {
      const k = row.store + '|' + row.id;
      gesehen.add(k);
      if (!neuester || row.updated_at > neuester) neuester = row.updated_at;
      if (wartend.has(k)) continue; // lokale, noch nicht hochgeladene Änderung gewinnt
      if (!db.SYNC_STORES.includes(row.store)) continue;
      if (row.deleted) await db.vomServer(row.store, row.id, null);
      else await db.vomServer(row.store, row.id, await entschluesselnJson(key, row.data, row.iv));
      geaendert++;
    }
    if (neuester) await db.setLokal('sync.letzterAbruf', neuester);
    return { gesehen, geaendert };
  }

  async function senden() {
    const eintraege = await db.outbox();
    if (!eintraege.length) return 0;
    const dateien = eintraege.filter((e) => e.store === 'files');
    const saetze = eintraege.filter((e) => e.store !== 'files');

    for (const e of dateien) {
      const f = await db.get('files', e.id);
      if (f) await remote.uploadFile(e.id, await verschluesselnBytes(key, f.bytes));
    }
    await db.outboxErledigt(dateien);

    for (let i = 0; i < saetze.length; i += 200) {
      const teil = saetze.slice(i, i + 200);
      const rows = [];
      for (const e of teil) {
        const wert = e.op === 'del' ? null : await db.get(e.store, e.id);
        if (!wert) rows.push({ store: e.store, id: String(e.id), deleted: true, data: null, iv: null });
        else {
          const { data, iv } = await verschluesselnJson(key, wert);
          rows.push({ store: e.store, id: String(e.id), deleted: false, data, iv });
        }
      }
      await remote.upsert(rows);
      await db.outboxErledigt(teil);
    }
    return eintraege.length;
  }

  // Erstes Einschalten auf einem Gerät: erst alles vom Server holen, dann nur das hochladen,
  // was der Server noch nicht kennt (damit ein leeres Gerät keine Daten überschreibt).
  async function einrichten() {
    const { gesehen } = await holen({ alles: true });
    await db.allesVormerken(gesehen);
    await senden();
    await db.setLokal('sync.eingerichtet', true);
  }

  async function lauf() {
    if (laeuft) return laeuft;
    laeuft = (async () => {
      try {
        if (!(await db.lokal('sync.eingerichtet'))) await einrichten();
        else {
          await senden();
          await holen();
        }
        const wartend = (await db.outbox()).length;
        const jetzt = new Date().toISOString();
        await db.setLokal('sync.letzterLauf', jetzt);
        return { ok: true, wartend, zeit: jetzt };
      } finally {
        laeuft = null;
      }
    })();
    return laeuft;
  }

  async function dateiHolen(id) {
    const blob = await remote.downloadFile(id);
    return blob ? entschluesselnBytes(key, blob) : null;
  }

  return { lauf, dateiHolen, holen, senden };
}
