// Anbindung an Supabase (Datenbank + Dateispeicher). Es werden nur verschlüsselte Daten übertragen.

export function supabaseClient(url, anonKey) {
  return globalThis.supabase.createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'hufschmied-auth', detectSessionInUrl: false }
  });
}

function fehler(error, was) {
  if (!error) return;
  const e = new Error(`${was}: ${error.message || error}`);
  e.cause = error;
  throw e;
}

export function supabaseRemote(client, userId) {
  return {
    async fetchSince(ab) {
      const rows = [];
      const SEITE = 1000;
      for (let von = 0; ; von += SEITE) {
        let q = client.from('records').select('store,id,deleted,data,iv,updated_at').order('updated_at', { ascending: true }).range(von, von + SEITE - 1);
        if (ab) q = q.gt('updated_at', ab);
        const { data, error } = await q;
        fehler(error, 'Abruf');
        rows.push(...data);
        if (data.length < SEITE) break;
      }
      return rows;
    },
    async upsert(rows) {
      const { error } = await client.from('records').upsert(rows.map((r) => ({ ...r, user_id: userId })), { onConflict: 'user_id,store,id' });
      fehler(error, 'Hochladen');
    },
    async uploadFile(id, bytes) {
      const pfad = `${userId}/${id.replace(':', '_')}`;
      const { error } = await client.storage.from('files').upload(pfad, new Blob([bytes], { type: 'application/octet-stream' }), { upsert: true, contentType: 'application/octet-stream' });
      fehler(error, 'Datei hochladen');
    },
    async downloadFile(id) {
      const pfad = `${userId}/${id.replace(':', '_')}`;
      const { data, error } = await client.storage.from('files').download(pfad);
      if (error && /not.?found|404/i.test(error.message || '')) return null;
      fehler(error, 'Datei laden');
      return new Uint8Array(await data.arrayBuffer());
    },
    async nummerReservieren(jahr, mindestens) {
      const { data, error } = await client.rpc('next_invoice_number', { p_year: jahr, p_floor: mindestens });
      fehler(error, 'Rechnungsnummer');
      return Number(data);
    }
  };
}
