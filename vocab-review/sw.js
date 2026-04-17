/**
 * vocab-review/sw.js — Service Worker
 *
 * 策略：
 *   - 静态资源：Cache First（离线可用）
 *   - 数据请求（/api/）：Network First（保鲜）
 *
 * 更新模型：
 *   不调用 self.skipWaiting()，改为向客户端发送 'SW_UPDATE_AVAILABLE' 消息，
 *   由用户主动点击"立即刷新"后再 skipWaiting。
 *   原因：skipWaiting + clients.claim 与 IDB schema 迁移存在竞态风险。
 */

'use strict';

const CACHE_NAME = 'ket-vocab-v1';

// 预缓存的核心资源（shell）
const PRECACHE_URLS = [
  '/vocab-review/index.html',
  '/vocab-review/css/main.css',
  '/vocab-review/js/app.js',
  '/vocab-review/js/db.js',
  '/vocab-review/js/scheduler.js',
  '/vocab-review/js/practice.js',
  '/vocab-review/js/stats.js',
  '/shared/design-tokens.css',
  '/shared/db.js',
  '/shared/router.js',
];

// ==================== Install ====================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // 逐个缓存，某个资源 404 不影响整体安装
      return Promise.allSettled(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(err => {
            console.warn(`[SW] 预缓存失败: ${url}`, err);
          })
        )
      );
    })
    // 故意不调用 self.skipWaiting()
    // 新 SW 进入 waiting 状态，等用户确认后再激活
  );
});

// ==================== Activate ====================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      // 清理旧版本缓存
      await Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );
      // 接管当前所有 client（但此时 IDB schema 已经由页面迁移完毕）
      await clients.claim();
    })
  );
});

// ==================== Fetch ====================
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 只处理 http(s) 请求，忽略 chrome-extension 等
  if (!url.protocol.startsWith('http')) return;

  // GET 请求才走缓存策略
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request).then((response) => {
        // 只缓存成功的同源响应
        if (
          response.ok &&
          url.origin === location.origin &&
          !url.pathname.startsWith('/api/')
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached); // 网络失败时回退到缓存

      // Cache First：有缓存直接返回，同时后台刷新
      return cached || networkFetch;
    })
  );
});

// ==================== 消息处理 ====================
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    // 用户点击"立即刷新"后发出此消息，SW 才真正激活
    self.skipWaiting();
  }
});

// ==================== 通知等待中的 client ====================
// 新 SW 进入 waiting 状态时，告知所有页面有更新可用
self.addEventListener('install', () => {
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    clients.forEach(client => {
      client.postMessage({ type: 'SW_UPDATE_AVAILABLE' });
    });
  });
});
