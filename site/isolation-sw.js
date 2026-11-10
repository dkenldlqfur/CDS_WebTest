// Serve the verified game package from Git-sized files in this test repository.
// Other files are served directly by GitHub Pages.
'use strict';
const packRelease = {"source": "https://raw.githubusercontent.com/dkenldlqfur/CDS_WebTest/0c25827aa3dd33aadd2170cace1e4cab8eca93ab/release-parts/", "size": 341795448, "etag": "\"93f8e5ee9e5b96966464da7d740b9f38e2fb8da1f60630a58434ad282dddacbb\"", "parts": [["index.pck.000", 67108864], ["index.pck.001", 67108864], ["index.pck.002", 67108864], ["index.pck.003", 67108864], ["index.pck.004", 67108864], ["index.pck.005", 6251128]]};
const packCacheName = 'cds95-main-pack-v1';

function streamPack() {
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

async function fetchMainPack(url) {
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
  const response = new Response(streamPack(), {headers: {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(packRelease.size),
    'ETag': packRelease.etag
  }});
  const write = cache?.put(url, response.clone()).catch(() => {});
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
  const packUrl = new URL('index.pck', self.registration.scope);
  if (request.method === 'GET' && url.pathname === packUrl.pathname) {
    const pack = fetchMainPack(packUrl.href);
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
