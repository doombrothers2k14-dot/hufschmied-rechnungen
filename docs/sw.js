// Offline-Cache für die App-Dateien. Bei jeder neuen Version VERSION erhöhen.
const VERSION = 'v1.1.0';
const DATEIEN = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './config.js', './js/main.js', './js/db.js', './js/logic.js', './js/pdf.js', './js/einvoice.js', './js/export.js',
  './js/crypto.js', './js/sync.js', './js/remote.js', './js/konto.js', './vendor/supabase.js',
  './vendor/preact.mjs', './vendor/hooks.mjs', './vendor/htm.mjs', './vendor/qrcode.mjs',
  './vendor/pdf-lib.min.js', './vendor/jszip.min.js', './vendor/xlsx.full.min.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(DATEIEN)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
