const CACHE = 'atkyn-v3';
const STATIC = [
  '/',
  '/index.html',
  '/search.html',
  '/Atkyn.png',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.allSettled(STATIC.map(url => cache.add(url)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const isStatic = e.request.destination === 'image' ||
                   url.pathname.endsWith('.png')  ||
                   url.pathname.endsWith('.html') ||
                   url.pathname.endsWith('.json') ||
                   url.pathname === '/';

  if (isStatic) {
    e.respondWith(
      caches.match(e.request).then(cachedRes => {
        if (cachedRes) return cachedRes;
        return fetch(e.request).then(networkRes => {
          if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
            const resToCache = networkRes.clone();
            caches.open(CACHE).then(cache => cache.put(e.request, resToCache));
          }
          return networkRes;
        }).catch(() => {
          return caches.match('/') || new Response('Offline', { status: 503 });
        });
      })
    );
  } else {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
  }
});
