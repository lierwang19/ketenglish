/**
 * listening-player/sw.js — Service Worker
 *
 * 注意：音频 Blob（用户上传）存在 IndexedDB，不经过 Cache Storage。
 * 只缓存应用 Shell（HTML/CSS/JS）。
 * 更新模型：同系统A，不调用 skipWaiting，等用户确认。
 */

'use strict';

const CACHE_NAME = 'ket-listen-v1';

const PRECACHE_URLS = [
  '/listening-player/index.html',
  '/listening-player/css/main.css',
  '/listening-player/js/app.js',
  '/listening-player/js/db.js',
  '/listening-player/js/audio.js',
  '/listening-player/js/segmenter.js',
  '/listening-player/js/player.js',
  '/shared/design-tokens.css',
  '/shared/db.js',
  '/shared/router.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(err => console.warn(`[SW] 预缓存失败: ${url}`, err))
        )
      )
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async keys => {
      await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
      await clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!url.protocol.startsWith('http') || event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      const net = fetch(event.request).then(res => {
        if (res.ok && url.origin === location.origin) {
          caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone()));
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('install', () => {
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients =>
    clients.forEach(c => c.postMessage({ type: 'SW_UPDATE_AVAILABLE' }))
  );
});
