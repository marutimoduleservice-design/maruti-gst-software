const CACHE_NAME = "maruti-service-shell-v4";
// "/" yahan isliye hai: SW pehli baar online visit par register hota hai, tab
// tak navigation intercept nahi hui — install ke waqt index precache ho jata hai.
// Online rehne par navigations network-first hote hain, isliye stale index ka
// issue nahi.
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon-180.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);

  if (requestUrl.origin !== self.location.origin || event.request.method !== "GET") {
    return;
  }

  // Page navigations: network first (taaki har deploy ka naya index mile),
  // response cache me update hoti rahe, aur offline ho to cached shell chale.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(requestUrl.pathname, copy));
          return response;
        })
        .catch(() =>
          caches.match(requestUrl.pathname).then((cached) => cached || caches.match("/"))
        )
    );
    return;
  }

  // Static assets (hashed JS/CSS/icons): cache first — jaldi khulta hai
  // aur offline me bhi chalta hai; miss ho to network se aaye aur cache me chala jaye.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(event.request).then(
            (fallback) => fallback || new Response("", { status: 503, statusText: "Offline" })
          )
        );
    })
  );
});
