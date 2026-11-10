// GitHub Pages bootstrap: apply the same isolation headers as Godot's
// official PWA worker. Keep one copy of the main pack and revalidate its ETag.
'use strict';
const packCacheName = 'cds95-main-pack-v1';

async function fetchMainPack(request) {
  let cache, cached;
  try {
    cache = await caches.open(packCacheName);
    cached = await cache.match(request);
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
    response = await fetch(request, {cache: 'no-cache'});
  }
  const write = cache && response.status === 200 && response.headers.has('ETag')
    ? cache.put(request, response.clone()).catch(() => {})
    : undefined;
  return {response, write};
}

function isolated(response) {
  if (response.status === 0) return response;
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;
  if (request.method === 'GET' && !request.headers.has('Range') &&
      url.href === new URL('index.pck', self.registration.scope).href) {
    const pack = fetchMainPack(request);
    event.waitUntil(pack.then(async ({write, cacheHit}) => {
      if (cacheHit && event.clientId) {
        const client = await self.clients.get(event.clientId);
        client?.postMessage({type: 'cds95-pack-cache-hit'});
      }
      await write;
    }).catch(() => {}));
    event.respondWith(pack.then(({response}) => isolated(response)));
    return;
  }
  event.respondWith(fetch(request, {cache: 'no-cache'}).then(isolated));
});
