// Network first, so a reload always gets the newest build. The cache only answers when offline
// (say, opening the page in an underground car park).

const CACHE = 'csr-demo-v2';

const SHELL = [
  './', './index.html', './styles.css', './app.js', './version.js', './manifest.webmanifest',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
  './vendor/leaflet/leaflet.js', './vendor/leaflet/leaflet.css',
  './src/buckets.js', './src/compliance.js', './src/demo.js', './src/geo.js', './src/matcher.js',
  './src/osm.js', './src/phrases.js', './src/records.js', './src/replay.js', './src/router.js',
  './src/runEngine.js', './src/tunables.js',
  './ui/audio.js', './ui/dom.js', './ui/drive.js', './ui/gps.js', './ui/history.js', './ui/limits.js',
  './ui/route.js', './ui/routes.js', './ui/session.js', './ui/store.js', './ui/summary.js', './ui/tuning.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Only this site's own files. Map tiles and the Overpass API go straight to the network.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request, { cache: 'no-cache' })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html'))),
  );
});
