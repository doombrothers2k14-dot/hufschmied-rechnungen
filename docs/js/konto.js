// Konto, Anmeldung und automatischer Abgleich.
import * as db from './db.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { schluesselAbleiten } from './crypto.js';
import { supabaseClient, supabaseRemote } from './remote.js';
import { createSync } from './sync.js';

let client = null;
let remote = null;
let sync = null;
let timer = null;
let entprellt = null;
const zuhoerer = new Set();
let datenGeaendertCb = () => {};
let lauscherAktiv = false;
let zustand = { konfiguriert: false, angemeldet: false, email: null, status: 'aus', letzterLauf: null, wartend: 0, fehler: null };

function setze(teil) {
  zustand = { ...zustand, ...teil };
  zuhoerer.forEach((fn) => fn(zustand));
}
export function onZustand(fn) { zuhoerer.add(fn); fn(zustand); return () => zuhoerer.delete(fn); }
export function zustandJetzt() { return zustand; }

export async function verbindung() {
  const url = (await db.lokal('sync.url')) || SUPABASE_URL;
  const anon = (await db.lokal('sync.anon')) || SUPABASE_ANON_KEY;
  return { url, anon, ausConfig: !!(SUPABASE_URL && SUPABASE_ANON_KEY) };
}

export async function verbindungSpeichern(url, anon) {
  await db.setLokal('sync.url', url.trim().replace(/\/+$/, ''));
  await db.setLokal('sync.anon', anon.trim());
  client = null;
  setze({ konfiguriert: !!(url && anon) });
}

async function clientHolen() {
  if (client) return client;
  const { url, anon } = await verbindung();
  if (!url || !anon || !globalThis.supabase) return null;
  client = supabaseClient(url, anon);
  return client;
}

export async function start(onDatenGeaendert) {
  if (onDatenGeaendert) datenGeaendertCb = onDatenGeaendert;
  const { url, anon } = await verbindung();
  setze({ konfiguriert: !!(url && anon) });
  if (!url || !anon) return;
  const key = await db.lokal('sync.key');
  const email = await db.lokal('sync.email');
  if (!key || !email) return;
  const c = await clientHolen();
  const { data } = await c.auth.getSession();
  if (!data.session) { setze({ status: 'abgemeldet', email }); return; }
  aktivieren(data.session.user.id, key, email, onDatenGeaendert);
}


function aktivieren(userId, key, email, onDatenGeaendert) {
  if (onDatenGeaendert) datenGeaendertCb = onDatenGeaendert;
  remote = supabaseRemote(client, userId);
  sync = createSync({ db, remote, key });
  db.setSyncAktiv(true);
  db.setDateiNachladen((id) => sync.dateiHolen(id));
  setze({ angemeldet: true, email, status: 'bereit', fehler: null });

  if (!lauscherAktiv) {
    lauscherAktiv = true;
    db.onAenderung(() => {
      clearTimeout(entprellt);
      entprellt = setTimeout(() => abgleichen(), 2000);
    });
    window.addEventListener('online', () => abgleichen());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') abgleichen(); });
  }
  clearInterval(timer);
  timer = setInterval(() => { if (document.visibilityState === 'visible') abgleichen(); }, 60000);
  abgleichen();
}

export async function abgleichen() {
  if (!sync) return;
  if (!navigator.onLine) {
    setze({ status: 'offline', wartend: (await db.outbox()).length });
    return;
  }
  setze({ status: 'laeuft' });
  try {
    const r = await sync.lauf();
    setze({ status: 'ok', letzterLauf: r.zeit, wartend: r.wartend, fehler: null });
    datenGeaendertCb();
  } catch (e) {
    console.error('Abgleich fehlgeschlagen', e);
    setze({ status: 'fehler', fehler: e.message || String(e), wartend: (await db.outbox()).length });
  }
}

export async function anmelden(email, passwort, neuesKonto) {
  const c = await clientHolen();
  if (!c) throw new Error('Die Verbindung zu Supabase ist noch nicht eingerichtet.');
  email = email.trim().toLowerCase();
  const { loginPasswort, key } = await schluesselAbleiten(email, passwort);
  let session;
  if (neuesKonto) {
    const { data, error } = await c.auth.signUp({ email, password: loginPasswort });
    if (error) throw new Error(uebersetze(error.message));
    session = data.session;
    if (!session) throw new Error('Konto angelegt. Supabase verlangt noch eine Bestätigung per E-Mail. Entweder den Link in der Mail anklicken und dann hier „Anmelden“ tippen, oder in Supabase unter Authentication → Sign In / Providers „Confirm email“ ausschalten.');
  } else {
    const { data, error } = await c.auth.signInWithPassword({ email, password: loginPasswort });
    if (error) throw new Error(uebersetze(error.message));
    session = data.session;
  }
  await db.setLokal('sync.key', key);
  await db.setLokal('sync.email', email);
  aktivieren(session.user.id, key, email);
}

export async function abmelden() {
  try { if (client) await client.auth.signOut(); } catch { /* egal */ }
  clearInterval(timer);
  sync = null; remote = null;
  db.setSyncAktiv(false);
  db.setDateiNachladen(null);
  await db.setLokal('sync.key', undefined);
  await db.setLokal('sync.eingerichtet', undefined);
  await db.setLokal('sync.letzterAbruf', undefined);
  await db.outboxLeeren();
  setze({ angemeldet: false, status: 'aus', fehler: null, wartend: 0 });
}

// Für das Festschreiben: Nummer beim Server reservieren, wenn online und angemeldet
export function nummerReservierer() {
  if (!remote || !navigator.onLine) return undefined;
  return (jahr, mindestens) => remote.nummerReservieren(jahr, mindestens);
}

function uebersetze(msg) {
  if (/invalid login credentials/i.test(msg)) return 'E-Mail oder Passwort stimmt nicht.';
  if (/already registered|already exists/i.test(msg)) return 'Für diese E-Mail gibt es schon ein Konto. Bitte „Anmelden“ verwenden.';
  if (/signups? not allowed|disabled/i.test(msg)) return 'Neue Konten sind in Supabase gesperrt. Bitte mit dem bestehenden Konto anmelden.';
  if (/email not confirmed/i.test(msg)) return 'Die E-Mail-Adresse ist noch nicht bestätigt. Bitte den Link in der Bestätigungsmail anklicken.';
  if (/failed to fetch|network/i.test(msg)) return 'Keine Verbindung zum Server.';
  return msg;
}
