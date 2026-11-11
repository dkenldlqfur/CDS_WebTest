// GitHub Pages bootstrap: apply the same isolation headers as Godot's
// official PWA worker. Keep one copy of each pack and revalidate its ETag.
'use strict';
const deferredVideoRoot = "https://raw.githubusercontent.com/dkenldlqfur/CDS_WebTest/4d59560ba2610286292913faa025938d6d45843b/site/";
const packCacheName = 'cds95-main-pack-v1';
const packNames = ['index.pck', 'gameplay.pck', 'interface.pck', 'game-data.pck', 'graphics.pck'];

const streamedPacks = {"graphics.pck":{"source":"https://raw.githubusercontent.com/dkenldlqfur/CDS_WebTest/4d59560ba2610286292913faa025938d6d45843b/release-parts/","size":338185908,"etag":"\"06c5f13cd27783a0a4e52cc13ed9be7570bddefcdab80b290da91a8b6b93c7b4\"","parts":[["graphics.pck.000",67108864],["graphics.pck.001",67108864],["graphics.pck.002",67108864],["graphics.pck.003",67108864],["graphics.pck.004",67108864],["graphics.pck.005",2641588]]}};

function streamPack(packRelease) {
  const abort = new AbortController();
  let partIndex = 0;
  let reader;
  let remaining = 0;
  return new ReadableStream({
    async pull(controller) {
      while (true) {
        if (!reader) {
          if (partIndex === packRelease.parts.length) {
            controller.close();
            return;
          }
          const [name, size] = packRelease.parts[partIndex++];
          const response = await fetch(new URL(name, packRelease.source), {signal: abort.signal});
          if (!response.ok || !response.body) throw new Error('Unable to download game package part ' + name);
          reader = response.body.getReader();
          remaining = size;
        }
        const {value, done} = await reader.read();
        if (done) {
          reader.releaseLock();
          reader = undefined;
          if (remaining !== 0) throw new Error('Incomplete game package part');
          continue;
        }
        remaining -= value.byteLength;
        if (remaining < 0) {
          await reader.cancel();
          throw new Error('Unexpected game package part size');
        }
        controller.enqueue(value);
        return;
      }
    },
    cancel(reason) {
      abort.abort(reason);
    }
  });
}

async function fetchStreamedPack(url, packRelease) {
  let cache;
  try {
    cache = await caches.open(packCacheName);
    const cached = await cache.match(url);
    if (cached?.headers.get('ETag') === packRelease.etag &&
        Number(cached.headers.get('Content-Length')) === packRelease.size) {
      return {response: cached, cacheHit: true};
    }
  } catch {
    // Private browsing and storage limits must not prevent startup.
  }
  const response = new Response(streamPack(packRelease), {headers: {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(packRelease.size),
    'ETag': packRelease.etag
  }});
  const write = cache?.put(url, response.clone()).catch(() => {});
  return {response, write};
}

async function fetchPack(request) {
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
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;
  const packName = packNames.find(name => url.href === new URL(name, self.registration.scope).href);
  if (request.method === 'GET' && !request.headers.has('Range') && packName) {
    const release = streamedPacks[packName];
    const pack = release ? fetchStreamedPack(url.href, release) : fetchPack(request);
    event.waitUntil(pack.then(({write}) => write).catch(() => {}));
    event.respondWith(pack.then(({response, cacheHit}) => isolated(response, cacheHit)));
    return;
  }
  const videos = new URL('assets/videos/', self.registration.scope);
  if (request.method === 'GET' && url.pathname.startsWith(videos.pathname) && /^[A-Za-z0-9_.-]+\.ogv$/.test(url.pathname.slice(videos.pathname.length))) {
    const relative = 'assets/videos/' + url.pathname.slice(videos.pathname.length);
    event.respondWith(fetch(new URL(relative, deferredVideoRoot)).then(isolated));
    return;
  }
  event.respondWith(fetch(request, {cache: 'no-cache'}).then(isolated));
});
