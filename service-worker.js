// ============================================================
// MINEPULSE – SERVICE WORKER (FULL CHIMERA INTEGRATION)
// Handles caching, offline support, push notifications,
// and background sync for Chimera revenue reports.
// ============================================================

const CACHE_NAME = 'minepulse-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/service-worker.js',
  '/chimera-worker.js',   // <-- Chimera engine cached for offline
];

// ---------- INSTALL ----------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching assets');
        return cache.addAll(ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// ---------- ACTIVATE ----------
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

// ---------- FETCH (Cache-first with network fallback) ----------
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          // Cache successful responses for future offline use
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => {
          // Offline fallback – return a minimal response
          return new Response('Offline – please check your connection.', {
            status: 503,
            statusText: 'Service Unavailable',
          });
        });
      })
  );
});

// ---------- PUSH NOTIFICATIONS ----------
self.addEventListener('push', (event) => {
  let data = { title: 'MinePulse', body: 'You have a new update.' };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    // If not JSON, treat as plain text
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

// ---------- NOTIFICATION CLICK ----------
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Check if there is already a window/tab open with the target URL
      for (let client of windowClients) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // If not, open a new window
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// ---------- BACKGROUND SYNC (for Chimera revenue reports) ----------
// This ensures any failed revenue reports are retried when the device comes online.
self.addEventListener('sync', (event) => {
  if (event.tag === 'chimera-revenue-sync') {
    event.waitUntil(
      // We don't have a direct API to replay failed requests from the client,
      // but we can send a message to the client to retry.
      // For simplicity, we just log and let the client retry on next ping.
      console.log('[SW] Background sync triggered for Chimera revenue.')
    );
  }
});

// ---------- MESSAGE HANDLING (from main thread) ----------
// We forward messages to the Chimera worker if needed.
// This is a bridge between the main app and the Chimera worker.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'FORWARD_TO_CHIMERA') {
    // Find the Chimera worker and forward the message
    self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then((clients) => {
      for (let client of clients) {
        client.postMessage({
          type: 'CHIMERA_MESSAGE',
          payload: event.data.payload
        });
      }
    });
  }
});
