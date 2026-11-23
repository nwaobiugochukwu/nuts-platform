// Service Worker for NUTS Platform WebPush Notifications
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: 'NUTS Notification', body: event.data.text() };
  }

  event.waitUntil(
    (async () => {
      const notificationId = data.data && data.data.notificationId;

      // The app is open and looking at the user: the in-app notification (live stream)
      // already shows it, so a system notification would be a duplicate. Only skip when
      // an in-app copy exists (notificationId) so nothing is ever lost.
      if (notificationId) {
        const windows = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });
        if (windows.some((w) => w.visibilityState === 'visible' && w.focused)) {
          return;
        }
      }

      await self.registration.showNotification(data.title || 'NUTS Notification', {
        body: data.body || '',
        icon: data.icon || '/favicon.svg',
        badge: data.badge || '/favicon.svg',
        data: { url: data.url || '/', ...data.data },
        // One notification per id: a repeat delivery replaces it silently instead of
        // buzzing again, and different notifications never overwrite each other.
        tag: data.tag || notificationId || `nuts-${Date.now()}`,
        renotify: false,
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // If an open tab matches the origin, focus it and navigate
        for (const client of clientList) {
          if (client.url && 'focus' in client) {
            client.focus();
            if ('navigate' in client) {
              return client.navigate(targetUrl);
            }
            return client;
          }
        }
        // Otherwise, open a new browser window
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      }),
  );
});
