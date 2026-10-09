// Версия кэша. ВАЖНО: при каждом обновлении сайта менять эту строку (v2, v3, ...) —
// иначе телефоны и браузеры, которые уже установили приложение, будут показывать
// старую, сохранённую версию сайта и не увидят новых изменений.
const CACHE_NAME = 'alpservice-oDDs-v11';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './logo.png',
  './favicon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) { return key !== CACHE_NAME; })
            .map(function (key) { return caches.delete(key); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;

  var url = new URL(event.request.url);
  // Запросы к серверу (вход, отчеты, остаток и т.д.) никогда не кэшируем —
  // иначе приложение может показывать устаревший вход/данные или выкидывать
  // на экран входа, хотя человек на самом деле всё ещё в кабинете.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
    return;
  }

  // Для самого сайта (страница, стили, app.js...) — сначала пробуем загрузить
  // свежую версию с сервера, и только если это не получилось (нет интернета) —
  // показываем то, что сохранено на телефоне/в браузере. Так любое обновление
  // сайта появляется у человека сразу, а не только после переустановки.
  event.respondWith(
    fetch(event.request).then(function (response) {
      if (response && response.status === 200 && response.type === 'basic') {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
      }
      return response;
    }).catch(function () {
      return caches.match(event.request).then(function (cached) {
        return cached || caches.match('./index.html');
      });
    })
  );
});
