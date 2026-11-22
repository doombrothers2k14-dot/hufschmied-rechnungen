// Ende-zu-Ende-Verschlüsselung: Der Server bekommt nur verschlüsselte Daten zu sehen.
// Aus E-Mail + Passwort werden zwei unabhängige Werte abgeleitet:
//   1. ein Login-Passwort für Supabase (der Server sieht nie das echte Passwort)
//   2. ein AES-256-Schlüssel, der das Gerät nie verlässt
const ITERATIONEN = 600000;
const enc = new TextEncoder();
const dec = new TextDecoder();

const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');

export function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s) {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export async function schluesselAbleiten(email, passwort) {
  const basis = await crypto.subtle.importKey('raw', enc.encode(passwort), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('hufschmied-rechnungen:v1:' + email.trim().toLowerCase()), iterations: ITERATIONEN },
    basis, 512));
  const loginPasswort = hex(bits.slice(0, 32));
  const key = await crypto.subtle.importKey('raw', bits.slice(32, 64), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  bits.fill(0);
  return { loginPasswort, key };
}

export async function verschluesselnJson(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
  return { data: b64(ct), iv: b64(iv) };
}

export async function entschluesselnJson(key, data, iv) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(data));
  return JSON.parse(dec.decode(pt));
}

export async function verschluesselnBytes(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0); out.set(ct, 12);
  return out;
}

export async function entschluesselnBytes(key, blob) {
  const u8 = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(0, 12) }, key, u8.subarray(12));
  return new Uint8Array(pt);
}
