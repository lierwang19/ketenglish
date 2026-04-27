/**
 * vocab-review/sw.js — Service Worker
 *
 * 策略：
 *   - 静态资源：Cache First（离线可用）
 *   - 数据请求（/api/）：Network First（保鲜）
 *
 * 更新模型（自动激活）：
 *   install → self.skipWaiting() 立即跳过 waiting
 *   activate → clients.claim() 立即接管所有页面
 *   理由：本应用所有用户数据存在页面 IndexedDB，SW 只负责静态资源缓存，
 *   切换 SW 版本不影响数据。下一次 reload 自动用上新版本，用户无感。
 *   银行级"等用户点确认"对家长/孩子学习场景是过度设计。
 */

'use strict';

const CACHE_NAME = 'ket-vocab-v11';

// 预缓存的核心资源（shell）
const PRECACHE_URLS = [
  '/vocab-review/index.html',
  '/vocab-review/css/main.css',
  '/vocab-review/js/app.js',
  '/vocab-review/js/db.js',
  '/vocab-review/js/scheduler.js',
  '/vocab-review/js/practice.js',
  '/vocab-review/js/settings.js',
  '/vocab-review/js/stats.js',
  '/vocab-review/js/textbook-importer.js',
  '/vocab-review/data/textbooks/index.json',
  '/vocab-review/data/textbooks/ket-core-day.json',
  '/vocab-review/vendor/tesseract/dist/tesseract.min.js',
  '/vocab-review/vendor/tesseract/dist/worker.min.js',
  '/vocab-review/vendor/tesseract/core/tesseract-core.wasm.js',
  '/vocab-review/vendor/tesseract/core/tesseract-core.wasm',
  '/vocab-review/vendor/tesseract/core/tesseract-core-simd.wasm.js',
  '/vocab-review/vendor/tesseract/core/tesseract-core-simd.wasm',
  '/vocab-review/vendor/tesseract/core/tesseract-core-relaxedsimd.wasm.js',
  '/vocab-review/vendor/tesseract/core/tesseract-core-relaxedsimd.wasm',
  '/vocab-review/vendor/tesseract/core/tesseract-core-lstm.wasm.js',
  '/vocab-review/vendor/tesseract/core/tesseract-core-lstm.wasm',
  '/vocab-review/vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js',
  '/vocab-review/vendor/tesseract/core/tesseract-core-simd-lstm.wasm',
  '/vocab-review/vendor/tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js',
  '/vocab-review/vendor/tesseract/core/tesseract-core-relaxedsimd-lstm.wasm',
  '/vocab-review/vendor/tesseract/lang-data/4.0.0_best_int/eng.traineddata.gz',
  '/vocab-review/vendor/tesseract/lang-data/4.0.0_best_int/chi_sim.traineddata.gz',
  '/shared/design-tokens.css',
  '/shared/db.js',
  '/shared/feedback.js',
  '/shared/router.js',
  '/shared/theme.js',
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
      ).then(() => self.skipWaiting()); // 新 SW 装好立即跳过 waiting
    })
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
