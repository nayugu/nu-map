// TOMBSTONE — this file exists only to remove itself.
//
// From 2026-05-29 this URL served a coi-serviceworker (adapted from
// gzuidhof/coi-serviceworker) that injected COOP+COEP on every response so
// SharedArrayBuffer would be available for multithreaded WASM. It is no longer
// needed: src/workers/translation.worker.js sets ort.env.wasm.numThreads = 1,
// which runs the threaded ORT binary single-threaded, with no
// SharedArrayBuffer and no sub-workers. Nothing has registered this worker for
// some time.
//
// But unregistering is not the same as not registering: every browser that
// loaded numap.app while the registration existed is STILL controlled by that
// worker, indefinitely, and its fetch handler re-served every response —
// including the HTML shell. A controlled navigation goes through the worker
// and reload() does not bypass it (only a hard reload does), which is one way
// a stale shell survives a "Back to NU Map".
//
// Deleting the file would not fix that. `/* /index.html 200` would answer this
// URL with the HTML shell at status 200, and a script-update check that gets a
// non-JavaScript MIME type fails while LEAVING the old registration in place.
// A byte-different worker that installs, claims nothing, and unregisters
// itself does fix it — so keep this file forever.
//
// Deliberately no fetch handler: from the moment this version installs,
// nothing is intercepted.

"use strict";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch { /* nothing cached, or no access — unregister anyway */ }
      await self.registration.unregister();
      // No clients.claim() and no client.navigate(): pages already open keep
      // their old controller until they next navigate, and yanking one out
      // from under a working session would be a surprise reload. The recovery
      // screens' hardReturn() unregisters and navigates for the one case that
      // actually needs it now.
    })()
  );
});
