const CACHE = "pcf-battle-public-v1";
const CORE = ["/", "/about", "/PFB_Logo_Pink.svg", "/pch-action-white-v2.avif"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname === "/login" || url.pathname.startsWith("/admin") || url.pathname.startsWith("/my-team") || url.pathname.startsWith("/referee")) return;
  const publicPage = url.pathname === "/" || url.pathname === "/about" || url.pathname === "/gallery" || url.pathname.startsWith("/tournament/");
  const asset = url.pathname.startsWith("/_next/") || /\.(?:avif|svg|png|jpg|jpeg|css|js|woff2?)$/i.test(url.pathname);
  if (!publicPage && !asset) return;
  event.respondWith(fetch(request).then((response) => {
    if (response.ok) caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
    return response;
  }).catch(() => caches.match(request).then((cached) => cached || caches.match("/"))));
});
