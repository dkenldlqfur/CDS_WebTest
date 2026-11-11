// GitHub Pages bootstrap: apply the same isolation headers as Godot's
// official PWA worker. Keep one copy of each pack and revalidate its ETag.
'use strict';
const packCacheName = 'cds95-main-pack-v1';
const packName = /^(?:index|gameplay|interface|game-data|graphics-[0-9]{3})\.pck$/;

async function fetchPack(request) {
  let cache, cached;
  try {
    cache = await caches.open(packCacheName);
    if (request.cache !== 'reload') cached = await cache.match(request);
  } catch {
    // Private browsing and storage limits must not prevent startup.
  }
  const etag = cached?.headers.get('ETag');
  let response;
  if (etag) {
    const headers = new Headers(request.headers);
    headers.set('If-None-Match', etag);
    response = await fetch(request, {cache: 'no-store', headers});
    if (response.status === 304) return {response: cached, cacheHit: true};
  } else {
    response = await fetch(request, {cache: request.cache === 'reload' ? 'reload' : 'no-cache'});
  }
  const write = cache && response.status === 200 && response.headers.has('ETag')
    ? cache.put(request, response.clone()).catch(() => {})
    : undefined;
  return {response, write};
}

function isolated(response, cacheHit = false) {
  if (response.status === 0) return response;
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  if (cacheHit) headers.set('X-CDS95-Pack-Cache', 'hit');
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const legacy = new URL('graphics.pck', self.registration.scope).href;
  try {
    if (await caches.has(packCacheName)) await (await caches.open(packCacheName)).delete(legacy);
  } catch {}
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;
  const scope = new URL(self.registration.scope);
  if (request.method === 'GET' && !request.headers.has('Range') && !url.search &&
      url.pathname.startsWith(scope.pathname) && packName.test(url.pathname.slice(scope.pathname.length))) {
    const pack = fetchPack(request);
    event.waitUntil(pack.then(({write}) => write).catch(() => {}));
    event.respondWith(pack.then(({response, cacheHit}) => isolated(response, cacheHit)));
    return;
  }
  event.respondWith(fetch(request, {cache: 'no-cache'}).then(isolated));
});
