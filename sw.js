'use strict';
/* The Music v1.2 — service worker для desktop-PWA.
   Кэш: index.html, app.js, app.html (после build.sh), manifest.json и иконка.
   API — network-first, ассеты — cache-first, навигация — network-first с fallback. */
var CACHE = 'the-music-v1.2';
var ICON_URL = new URL('./icon.svg', self.location.href).href;
var ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' +
  '<rect width="512" height="512" rx="112" fill="#0d0d20"/>' +
  '<circle cx="256" cy="238" r="150" fill="url(#g)"/>' +
  '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
  '<stop offset="0" stop-color="#8b7bff"/><stop offset="1" stop-color="#4fb3ff"/>' +
  '</linearGradient></defs>' +
  '<path d="M214 356V150l142-28v178" fill="none" stroke="#ffffff" stroke-width="26" stroke-linecap="round"/>' +
  '<ellipse cx="188" cy="356" rx="40" ry="30" fill="#ffffff"/>' +
  '<ellipse cx="330" cy="300" rx="40" ry="30" fill="#ffffff"/>' +
  '</svg>';
var CORE_ASSETS = ['./', './index.html', './app.js', './app.html', './manifest.json'];

function putClone(request, response) {
  try {
    var copy = response.clone();
    caches.open(CACHE).then(function (cache) {
      cache.put(request, copy);
    });
  } catch (e) { /* ответ уже прочитан — просто пропускаем кэширование */ }
}

function networkFirst(request) {
  return fetch(request).then(function (response) {
    if (response && response.ok) putClone(request, response);
    return response;
  }).catch(function () {
    return caches.match(request).then(function (cached) {
      if (cached) return cached;
      if (request.mode === 'navigate') {
        return caches.match('./index.html').then(function (fallback) {
          return fallback || new Response('The Music — offline', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        });
      }
      return new Response('', { status: 504, statusText: 'Offline' });
    });
  });
}

function cacheFirst(request) {
  return caches.match(request).then(function (cached) {
    if (cached) return cached;
    return fetch(request).then(function (response) {
      if (response && response.ok) putClone(request, response);
      return response;
    });
  });
}

self.addEventListener('install', function (event) {
  event.waitUntil((function () {
    return caches.open(CACHE).then(function (cache) {
      return Promise.all(CORE_ASSETS.map(function (url) {
        /* app.html может отсутствовать до запуска build.sh — не рвём установку. */
        return cache.add(url).catch(function () { });
      })).then(function () {
        return cache.put(ICON_URL, new Response(ICON_SVG, {
          headers: { 'Content-Type': 'image/svg+xml;charset=utf-8' }
        }));
      });
    }).then(function () {
      return self.skipWaiting();
    });
  })());
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (key) {
      return key === CACHE ? null : caches.delete(key);
    }));
  }).then(function () {
    return self.clients.claim();
  }));
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (!request || request.method !== 'GET') return;

  var url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate' || url.pathname.indexOf('/api/') >= 0) {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

self.addEventListener('message', function (event) {
  if (event && event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
