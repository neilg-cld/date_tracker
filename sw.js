// Relationship Tracker service worker.
//
// Two jobs, deliberately narrow:
//   1. Receive images shared from Android and hand them to the app.
//   2. Make the app installable, and openable offline.
//
// It does NOT cache index.html aggressively. A stale build is worse than a slow
// one, so the network is always tried first and the cache is only a fallback.

const CACHE = 'rt-shell-v1';
const SHARE_CACHE = 'rt-shared';

self.addEventListener('install', (event) => {
  // Take over as soon as possible so an update is never a version behind.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll([
      './',
      './index.html',
      './manifest.webmanifest',
      './icon-192.png',
      './icon-512.png',
    ]).catch(() => undefined))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SHARE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // --- Android has shared something with us ---
  if (event.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith((async () => {
      try {
        const form = await event.request.formData();
        const files = form.getAll('images').filter((f) => f && f.size);
        const cache = await caches.open(SHARE_CACHE);
        // Stash each file as a cached Response; the page collects them on load.
        await cache.delete('./__shared__');
        if (files.length) {
          const meta = files.map((f, i) => ({ index: i, name: f.name || ('shared-' + i), type: f.type }));
          await cache.put('./__shared__', new Response(JSON.stringify(meta), {
            headers: { 'Content-Type': 'application/json' },
          }));
          await Promise.all(files.map((f, i) => cache.put('./__shared__/' + i, new Response(f, {
            headers: { 'Content-Type': f.type || 'image/jpeg' },
          }))));
        }
        return Response.redirect('./?shared=' + files.length, 303);
      } catch (e) {
        return Response.redirect('./?shared=0', 303);
      }
    })());
    return;
  }

  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;      // never touch API traffic

  // Network first: the newest build always wins. Cache is the offline fallback.
  event.respondWith((async () => {
    try {
      const fresh = await fetch(event.request);
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE);
        cache.put(event.request, fresh.clone());
      }
      return fresh;
    } catch (e) {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (event.request.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      throw e;
    }
  })());
});
