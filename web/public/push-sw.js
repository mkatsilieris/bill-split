// Push notifications. Loaded into the generated service worker through workbox.importScripts
// (vite.config.ts). The server sends JSON: { title, body, url, tag }.

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Bill Split', {
      body: data.body || '',
      icon: '/icon-192.png',
      tag: data.tag,
      lang: 'el',
      data: { url: data.url || '/' },
    }),
  );
});

// Tapping the notification opens the page it is about, reusing an open window of the app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => w.url.startsWith(self.location.origin));
      if (open) {
        await open.focus();
        if (open.url !== url && 'navigate' in open) await open.navigate(url).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
