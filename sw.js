// sw.js — VaultAI Service Worker
// キャッシュバージョンを変えると古いキャッシュが自動削除されます
const CACHE_VERSION = 'v1.0.2';
const CACHE_NAME = `vaultai-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '',
  'index.html',
  'style.css',
  'app.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
];

// インストール: 必要なファイルをキャッシュに追加
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  // 新しいSWをすぐにアクティブにする（待機をスキップ）
  self.skipWaiting();
});

// アクティベート: 古いバージョンのキャッシュをすべて削除
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name.startsWith('vaultai-') && name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] 古いキャッシュを削除:', name);
            return caches.delete(name);
          })
      )
    ).then(() => self.clients.claim()) // 開いているタブを即座に制御下に置く
  );
});

// フェッチ: キャッシュ優先、失敗時はネットワーク
self.addEventListener('fetch', (event) => {
  // POSTリクエストやブラウザ拡張リクエストはスキップ
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // 有効なレスポンスのみキャッシュに追加
        if (response && response.status === 200 && response.type === 'basic') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return response;
      });
    })
  );
});

// メッセージ受信: クライアントからキャッシュ更新の要求を受け取る
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
