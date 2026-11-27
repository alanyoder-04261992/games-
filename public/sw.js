// Offline support. Network first (so updates show up right away), falling back to the
// cached copy when offline. Bump VERSION to clear old caches.
//
// Offline mode: the whole site is downloaded in the background (precache.json, written at
// deploy by tools/stamp-build.mjs, lists every file with a fingerprint). The first time,
// that is everything; after a new deploy only the files that changed. So every game opens
// with no internet, including ones never opened before on this device.
const VERSION = 'gc-v7';
const HASHES = 'gc-precache-hashes'; // what this cache holds, kept in the cache itself

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(precache().catch(() => {}));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => precache().catch(() => {})),
  );
});
// the page asks after each load (and after a new deploy): fetch whatever changed
self.addEventListener('message', (e) => {
  if (e.data === 'precache') e.waitUntil(precache().catch(() => {}));
});

let running = null;
function precache() {
  running ??= (async () => {
    const res = await fetch('precache.json', { cache: 'no-store' });
    if (!res.ok) return; // a host without the build step: pages are cached as they are visited
    const { files } = await res.json();
    const cache = await caches.open(VERSION);
    const had = (await (await cache.match(HASHES))?.json().catch(() => null)) || {};
    const have = {};
    for (const [f, hash] of Object.entries(had)) if (files[f] === hash) have[f] = hash;
    const todo = Object.entries(files).filter(([f, hash]) => have[f] !== hash);
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const [f, hash] = todo[i++];
        try {
          const r = await fetch(new URL(f, self.registration.scope), { cache: 'no-cache' });
          if (!r.ok) continue;
          await cache.put(new URL(f, self.registration.scope), r);
          have[f] = hash;
        } catch {
          /* offline partway: the rest comes next time */
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    await cache.put(HASHES, new Response(JSON.stringify(have), { headers: { 'content-type': 'application/json' } }));
  })().finally(() => (running = null));
  return running;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !fonts) return;
  if (sameOrigin && url.pathname.includes('/api/')) return; // play stats and the owner's insights are never cached
  if (sameOrigin && /\/(build|precache)\.json$/.test(url.pathname)) return; // always the live one
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = (await caches.match(req)) || (sameOrigin ? await caches.match(req, { ignoreSearch: true }) : null); // play.html?embed=1 is play.html
        if (hit) return hit;
        if (req.mode === 'navigate') return (await caches.match(new URL('index.html', self.registration.scope))) || Response.error();
        return Response.error();
      }),
  );
});
