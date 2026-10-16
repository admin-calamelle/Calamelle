const CACHE = 'calamelle-shell-v1';
const SHELL = ['/', '/app', '/manifest.webmanifest', '/assets/calamelle-logo.png', '/assets/calamelle-mark.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL).catch(() => {}))));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then(r => r || caches.match('/'))));
});
