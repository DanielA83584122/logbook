self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Marks the site as an installable app. Journal requests stay on the local
// server and are not stored in the service worker cache.
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
