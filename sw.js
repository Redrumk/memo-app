// 오프라인에서도 열리도록 앱 파일을 캐시한다. 온라인이면 항상 최신 파일을 먼저 받는다.
const CACHE = 'memo-v13';
const SHELL = [
  './', './index.html', './config.js', './manifest.webmanifest',
  './src/styles.css', './src/main.js', './src/store.js', './src/editor.js', './src/sync.js', './src/ui.js', './src/rich.js', './src/vendor/supabase.js',
  './icons/icon.svg', './icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // 최신 파일을 먼저 받되, 신호가 약해 3초 넘게 걸리면 저장해 둔 파일로 바로 연다
  e.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    const net = fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    });
    if (!cached) return net.catch(() => caches.match('./index.html'));
    const timeout = new Promise((r) => setTimeout(() => r(cached), 3000));
    return Promise.race([net.catch(() => cached), timeout]);
  })());
});
