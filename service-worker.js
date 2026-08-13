const CACHE_NAME = 'minepulse-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => {
          return new Response('Offline – please check your connection.', {
            status: 503,
            statusText: 'Service Unavailable',
          });
        });
      })
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'MinePulse', body: 'You have a new update.' };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    data.body = event.data.text() || data.body;
  }
  const options = {
    body: data.body,
    icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"%3E%3Crect width="32" height="32" rx="8" fill="%23FBBF24"/%3E%3Cpath d="M10 16 L13 19 L22 10" stroke="%23070B0E" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/%3E%3C/svg%3E',
    badge: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"%3E%3Crect width="32" height="32" rx="8" fill="%23FBBF24"/%3E%3Cpath d="M10 16 L13 19 L22 10" stroke="%23070B0E" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/%3E%3C/svg%3E',
    vibrate: [200, 100, 200],
    data: { url: '/' },
    actions: [
      { action: 'open', title: 'Open Dashboard' },
    ],
  };
  event.waitUntil(
    self.registration.showNotification(data.title || 'MinePulse', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let client of windowClients) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
