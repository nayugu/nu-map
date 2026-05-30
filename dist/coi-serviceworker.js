// coi-serviceworker — injects Cross-Origin-Opener-Policy: same-origin and
// Cross-Origin-Embedder-Policy: require-corp on every response so that
// SharedArrayBuffer is available for multithreaded WebAssembly (ONNX Runtime).
//
// Based on https://github.com/gzuidhof/coi-serviceworker (MIT licence).
// Only active when the page is not already cross-origin isolated.

"use strict";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", function (event) {
  // Skip non-GET requests and chrome-extension / blob URLs.
  if (event.request.method !== "GET") return;
  if (!event.request.url.startsWith("http")) return;

  // Avoid "only-if-cached" + cross-origin mismatch (Chrome bug).
  if (event.request.cache === "only-if-cached" && event.request.mode !== "same-origin") return;

  event.respondWith(
    fetch(event.request)
      .then(function (response) {
        if (response.status === 0) return response;

        const newHeaders = new Headers(response.headers);
        newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");
        newHeaders.set("Cross-Origin-Embedder-Policy", "require-corp");
        newHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
      })
      .catch((err) => {
        console.warn("[coi-serviceworker] fetch failed:", err);
        return fetch(event.request);
      })
  );
});
