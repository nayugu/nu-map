// UNIT · src/core/companyLogo.js › company logo resolution
//
// The bug this module exists for: Google's favicon service answers every
// domain, and when it has nothing it serves a generic 16×16 globe with HTTP
// 404 — which an <img> renders happily, so `onerror` never fires. A source
// that fails silently cannot be trusted to fail, so these tests are written
// from the position that every source is lying until its pixels say otherwise:
//
//   · the globe must never reach the page, from any source;
//   · a source that "worked" but returned 24px must lose to nothing at all;
//   · the sharpest answer must win, not the first or the last to arrive;
//   · a stalled company web server must not hold up a logo we already have;
//   · junk domains, junk cache and a localStorage that throws must all be
//     survivable — a co-op card is not worth taking the planner down for.
//
// The fake Image below is the whole adversary: it decides what each URL
// "loads" as, records every request, and can hang forever on demand.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { _resetLogoRegistry, registerCompanyLogos } from "../../src/core/companyLogoRegistry.js";

// ── Fake browser ──────────────────────────────────────────────────
// Responses are keyed by URL substring so tests do not have to reproduce
// query strings exactly. `null` means the load errors; `hang` never answers.
let responses = [];     // [matcher, { w, h, delay } | "error" | "hang"]
let requested = [];     // every URL an <img> was pointed at

function respond(url) {
  for (const [match, res] of responses) if (url.includes(match)) return res;
  return "error";
}

class FakeImage {
  constructor() { this.naturalWidth = 0; this.naturalHeight = 0; }
  set src(url) {
    requested.push(url);
    const res = respond(url);
    if (res === "hang") return;
    setTimeout(() => {
      if (res === "error" || !res) { this.onerror?.(); return; }
      this.naturalWidth  = res.w;
      this.naturalHeight = res.h ?? res.w;
      this.onload?.();
    }, res.delay ?? 1);
  }
}

function fakeStorage({ throwOnWrite = false, seed = null } = {}) {
  let raw = seed;
  return {
    getItem: () => raw,
    setItem: (_k, v) => { if (throwOnWrite) throw new Error("QuotaExceeded"); raw = v; },
    removeItem: () => { raw = null; },
    get raw() { return raw; },
  };
}

globalThis.Image = FakeImage;

beforeEach(() => {
  responses = [];
  requested = [];
  globalThis.localStorage = fakeStorage();
  // The registry module is shared across the fresh imports below (only the
  // query-stringed module is new), so its memo has to be cleared by hand.
  _resetLogoRegistry();
  globalThis.fetch = () => Promise.resolve({ ok: false, status: 404 });
});

// Each import gets its own in-memory cache, which is what lets a test watch a
// cold lookup. Domains are still unique per test so nothing leaks either way.
let seq = 0;
const freshModule = () => import(`../../src/core/companyLogo.js?t=${seq++}`);

const GOOGLE = "google.com/s2/favicons";
const GLOBE  = { w: 16 };            // what Google serves when it knows nothing

// ── Domain normalization ──────────────────────────────────────────

test("normalizeDomain strips scheme, path and stray dots", async () => {
  const { normalizeDomain } = await freshModule();
  assert.equal(normalizeDomain("HTTPS://Acme.com/careers?ref=1"), "acme.com");
  assert.equal(normalizeDomain("  acme.com.  "), "acme.com");
  assert.equal(normalizeDomain("http://sub.Acme.co.uk/x/y"), "sub.acme.co.uk");
  assert.equal(normalizeDomain(""), "");
  assert.equal(normalizeDomain(null), "");
  assert.equal(normalizeDomain(undefined), "");
});

test("candidates are empty for anything that is not a domain", async () => {
  const { logoCandidates } = await freshModule();
  for (const junk of ["", null, undefined, "acme", "  ", "...", "https://"]) {
    const { marks, tiles } = logoCandidates(junk);
    assert.deepEqual([marks, tiles], [[], []], `junk: ${JSON.stringify(junk)}`);
  }
});

test("apple-touch-icon is classified as a tile, never as a mark", async () => {
  const { logoCandidates } = await freshModule();
  const { marks, tiles } = logoCandidates("acme.com");
  assert.ok(!marks.some(u => u.includes("apple-touch-icon")), "tile art must not sit in the mark wave");
  assert.ok(tiles.some(u => u.includes("apple-touch-icon")));
  assert.ok(marks.some(u => u.includes(GOOGLE)) && marks.some(u => u.includes("favicon.ico")));
});

test("a domain with query-hostile characters is encoded, not interpolated raw", async () => {
  const { logoCandidates } = await freshModule();
  const urls = logoCandidates("a&b=c.com").marks.filter(u => u.includes(GOOGLE));
  assert.ok(urls.every(u => !u.includes("&b=c.com")), "raw & would forge a query param");
  assert.ok(urls.some(u => u.includes("a%26b%3Dc.com")));
});

// ── The globe, and other silent failures ──────────────────────────

test("Google's 16px globe never reaches the page", async () => {
  const { resolveCompanyLogo } = await freshModule();
  responses = [[GOOGLE, GLOBE]];        // everything else errors
  assert.equal(await resolveCompanyLogo("globe-only.com"), null);
});

test("a logo that loads but is too small loses to nothing at all", async () => {
  const { resolveCompanyLogo, MIN_LOGO_PX } = await freshModule();
  responses = [["", { w: MIN_LOGO_PX - 1 }]];   // every source answers, all mush
  assert.equal(await resolveCompanyLogo("blurry.com"), null);
});

test("exactly MIN_LOGO_PX is accepted — the floor is inclusive", async () => {
  const { resolveCompanyLogo, MIN_LOGO_PX } = await freshModule();
  responses = [["apple-touch-icon", { w: MIN_LOGO_PX }]];
  assert.match(await resolveCompanyLogo("floor.com"), /apple-touch-icon/);
});

test("a non-square image is judged by its smaller side", async () => {
  const { resolveCompanyLogo } = await freshModule();
  // A 512×16 sliver is not a 512px logo; scoring on width alone would take it.
  responses = [["favicon.ico", { w: 512, h: 16 }], [GOOGLE, { w: 64 }]];
  assert.match(await resolveCompanyLogo("sliver.com"), new RegExp(GOOGLE.replace(/\./g, "\\.")));
});

// ── Best-of, not first-of ─────────────────────────────────────────

test("the sharpest source wins even when a smaller one answers first", async () => {
  const { resolveCompanyLogo } = await freshModule();
  responses = [
    [GOOGLE,         { w: 48,  delay: 1 }],
    ["favicon.ico",  { w: 288, delay: 40 }],
  ];
  assert.match(await resolveCompanyLogo("late-and-sharp.com"), /favicon\.ico/);
});

// ── Kind before size: the apple.com rule ──────────────────────────

test("a small transparent mark beats a big opaque tile", async () => {
  const { resolveCompanyLogo } = await freshModule();
  // apple.com, measured: 64px RGBA from Google, 152px RGB (no alpha, grey
  // background) from the site's own apple-touch-icon. Taking the bigger image
  // is what put a grey box on the co-op card.
  responses = [[GOOGLE, { w: 64 }], ["apple-touch-icon", { w: 152 }]];
  assert.match(await resolveCompanyLogo("apple-shaped.com"), new RegExp(GOOGLE.replace(/\./g, "\\.")));
});

test("a usable mark means the tile wave is never even requested", async () => {
  const { resolveCompanyLogo } = await freshModule();
  responses = [[GOOGLE, { w: 64 }], ["apple-touch-icon", { w: 512 }], ["unavatar", { w: 512 }]];
  await resolveCompanyLogo("marks-only.com");
  assert.ok(!requested.some(u => u.includes("apple-touch-icon")), requested.join("\n"));
  assert.ok(!requested.some(u => u.includes("unavatar")), requested.join("\n"));
});

test("a tile rescues a company whose marks are all too small", async () => {
  const { resolveCompanyLogo } = await freshModule();
  // sonypictures.com, measured: 16px from every mark source, 128px tile.
  responses = [[GOOGLE, { w: 16 }], ["favicon.ico", { w: 16 }], ["apple-touch-icon", { w: 128 }]];
  assert.match(await resolveCompanyLogo("sony-shaped.com"), /apple-touch-icon/);
});

test("the rescue wave also picks its best, not its first", async () => {
  const { resolveCompanyLogo } = await freshModule();
  responses = [["apple-touch-icon", { w: 48, delay: 1 }], ["unavatar", { w: 180, delay: 20 }]];
  assert.match(await resolveCompanyLogo("rescue-best.com"), /unavatar/);
});

test("a mark of exactly MIN_LOGO_PX still outranks a huge tile", async () => {
  const { resolveCompanyLogo, MIN_LOGO_PX } = await freshModule();
  responses = [["favicon.ico", { w: MIN_LOGO_PX }], ["apple-touch-icon", { w: 512 }]];
  assert.match(await resolveCompanyLogo("floor-mark.com"), /favicon\.ico/);
});

// ── Slow and hostile networks ─────────────────────────────────────

test("a company web server that never answers does not hold up the logo", async () => {
  const { resolveCompanyLogo } = await freshModule();
  responses = [[GOOGLE, { w: 128, delay: 1 }], ["acme-hangs.com/", "hang"]];
  const started = Date.now();
  const url = await resolveCompanyLogo("acme-hangs.com");
  const took = Date.now() - started;
  assert.match(url, new RegExp(GOOGLE.replace(/\./g, "\\.")));
  assert.ok(took < 3000, `waited ${took}ms on a dead host`);
});

test("every source failing resolves to null rather than rejecting", async () => {
  const { resolveCompanyLogo } = await freshModule();
  responses = [];   // all error
  assert.equal(await resolveCompanyLogo("nothing-anywhere.com"), null);
});

// ── Caching ───────────────────────────────────────────────────────

test("a repeated lookup costs no further requests", async () => {
  const { resolveCompanyLogo } = await freshModule();
  responses = [[GOOGLE, { w: 256 }]];
  const first = await resolveCompanyLogo("cache-me.com");
  const after = requested.length;
  const second = await resolveCompanyLogo("CACHE-ME.com/jobs");   // same domain, messier
  assert.equal(second, first);
  assert.equal(requested.length, after, "second lookup re-probed the network");
});

test("concurrent lookups of one domain share a single probe", async () => {
  const { resolveCompanyLogo } = await freshModule();
  responses = [[GOOGLE, { w: 256, delay: 5 }]];
  const [a, b, c] = await Promise.all([
    resolveCompanyLogo("stampede.com"),
    resolveCompanyLogo("stampede.com"),
    resolveCompanyLogo("stampede.com"),
  ]);
  assert.equal(a, b);
  assert.equal(b, c);
  assert.ok(requested.length <= 5, `${requested.length} requests for one domain`);
});

test("a stored result is reused by a later session", async () => {
  const mod1 = await freshModule();
  responses = [[GOOGLE, { w: 256 }]];
  const first = await mod1.resolveCompanyLogo("persisted.com");

  const mod2 = await freshModule();          // new session, same localStorage
  requested = [];
  assert.equal(await mod2.resolveCompanyLogo("persisted.com"), first);
  assert.equal(requested.length, 0, "cold session re-probed a cached domain");
});

test("a stored miss is remembered too — no re-probing a logoless company", async () => {
  const mod1 = await freshModule();
  responses = [];
  assert.equal(await mod1.resolveCompanyLogo("logoless.com"), null);

  const mod2 = await freshModule();
  requested = [];
  assert.equal(await mod2.resolveCompanyLogo("logoless.com"), null);
  assert.equal(requested.length, 0);
});

test("a stale entry is re-probed, and can change its answer", async () => {
  const old = Date.now() - 60 * 24 * 3600 * 1000;   // 60 days
  globalThis.localStorage = fakeStorage({
    seed: JSON.stringify({ "rebranded.com": { url: "https://old.example/logo.png", at: old } }),
  });
  const { resolveCompanyLogo } = await freshModule();
  responses = [[GOOGLE, { w: 256 }]];
  assert.match(await resolveCompanyLogo("rebranded.com"), new RegExp(GOOGLE.replace(/\./g, "\\.")));
});

test("corrupt cache entries are ignored, not thrown on", async () => {
  for (const seed of ["{{{", "null", "[]", '"a string"', '{"junk.com":7}', '{"junk.com":{}}']) {
    globalThis.localStorage = fakeStorage({ seed });
    const { resolveCompanyLogo } = await freshModule();
    responses = [[GOOGLE, { w: 256 }]];
    assert.match(await resolveCompanyLogo("junk.com"), new RegExp(GOOGLE.replace(/\./g, "\\.")),
      `corrupt cache: ${seed}`);
  }
});

test("a localStorage that refuses to write still resolves logos", async () => {
  globalThis.localStorage = fakeStorage({ throwOnWrite: true });
  const { resolveCompanyLogo } = await freshModule();
  responses = [[GOOGLE, { w: 256 }]];
  assert.match(await resolveCompanyLogo("private-mode.com"), new RegExp(GOOGLE.replace(/\./g, "\\.")));
});

test("no localStorage at all is survivable", async () => {
  delete globalThis.localStorage;
  const { resolveCompanyLogo } = await freshModule();
  responses = [[GOOGLE, { w: 256 }]];
  assert.match(await resolveCompanyLogo("no-storage.com"), new RegExp(GOOGLE.replace(/\./g, "\\.")));
  globalThis.localStorage = fakeStorage();
});

// ── Curated logos come first ──────────────────────────────────────

const servePinned = (...files) => {
  globalThis.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ files }) });
};

test("a pinned logo is used, and nothing is probed for it", async () => {
  const { resolveCompanyLogo } = await freshModule();
  servePinned("pinned-co.com.webp");
  responses = [[GOOGLE, { w: 256 }]];
  const url = await resolveCompanyLogo("pinned-co.com");
  assert.match(url, /\/logos\/pinned-co\.com\.webp$/);
  assert.deepEqual(requested, [], "a pinned logo must not cost a single request");
});

test("a pinned logo is not held to the size floor", async () => {
  // The floor exists to reject a blurry favicon nobody chose. Somebody chose
  // this one.
  const { resolveCompanyLogo } = await freshModule();
  servePinned("tiny-co.com.png");
  assert.match(await resolveCompanyLogo("tiny-co.com"), /tiny-co\.com\.png$/);
});

test("a company with no domain still gets its pinned logo, by name", async () => {
  const { resolveCompanyLogo } = await freshModule();
  servePinned("sony-pictures-imageworks.webp");
  assert.match(await resolveCompanyLogo(null, "Sony Pictures Imageworks, Inc."),
    /sony-pictures-imageworks\.webp$/);
});

test("pinning one company does not pin its neighbours", async () => {
  const { resolveCompanyLogo } = await freshModule();
  servePinned("pinned-neighbour.com.webp");
  responses = [[GOOGLE, { w: 256 }]];
  const url = await resolveCompanyLogo("other-company.com");
  assert.match(url, new RegExp(GOOGLE.replace(/\./g, "\\.")), "an unpinned company must still resolve normally");
});

test("a stale localStorage entry cannot outrank a newly pinned logo", async () => {
  // The order that matters: curated is checked before the cache, or pinning a
  // logo would do nothing for anyone who had already loaded the company once.
  globalThis.localStorage = fakeStorage({
    seed: JSON.stringify({ "cached-co.com": { url: "https://old.example/favicon.ico", at: Date.now() } }),
  });
  const { resolveCompanyLogo } = await freshModule();
  servePinned("cached-co.com.svg");
  assert.match(await resolveCompanyLogo("cached-co.com"), /cached-co\.com\.svg$/);
});

test("a relative curated path is absolute by the time it is used", async () => {
  // The PDF export writes its HTML into a separate window, where a
  // root-relative path has no base to resolve against.
  const { resolveCompanyLogo } = await freshModule();
  globalThis.location = { href: "https://numap.app/planner" };
  servePinned("abs-co.com.webp");
  try {
    assert.equal(await resolveCompanyLogo("abs-co.com"), "https://numap.app/logos/abs-co.com.webp");
  } finally { delete globalThis.location; }
});

// ── The pixel-readable variant (stats panel glow) ─────────────────

test("pixelReadableUrl wraps the resolved logo, not a second guess at one", async () => {
  const { pixelReadableUrl } = await freshModule();
  const logo = "https://www.google.com/s2/favicons?domain=acme.com&sz=256";
  const url  = pixelReadableUrl(logo, 32);
  assert.ok(url.startsWith("https://wsrv.nl/?url="));
  assert.ok(url.includes(encodeURIComponent("www.google.com/s2/favicons?domain=acme.com&sz=256")),
    "the logo URL must be encoded whole, or its query merges into the proxy's");
  assert.ok(url.includes("w=32") && url.includes("h=32"));
});

test("a same-origin curated logo skips the proxy entirely", async () => {
  const { pixelReadableUrl } = await freshModule();
  globalThis.location = { href: "https://numap.app/planner", origin: "https://numap.app" };
  try {
    assert.equal(pixelReadableUrl("https://numap.app/logos/apple.com.webp", 32),
      "https://numap.app/logos/apple.com.webp");
    assert.match(pixelReadableUrl("https://www.google.com/s2/favicons?domain=x.com", 32), /wsrv\.nl/);
  } finally { delete globalThis.location; }
});

test("pixelReadableUrl is null-safe — a company with no logo has no pixels", async () => {
  const { pixelReadableUrl } = await freshModule();
  assert.equal(pixelReadableUrl(null), null);
  assert.equal(pixelReadableUrl(undefined), null);
  assert.equal(pixelReadableUrl(""), null);
});

// ── Unification ───────────────────────────────────────────────────

test("one module, and only one, knows where logos come from", async () => {
  // The bug this guards: the search dropdown and the co-op card each built
  // their own favicon URL, so the logo you picked was not the logo you got.
  // Any new surface must go through resolveCompanyLogo / <CompanyLogo>.
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const SOURCES = /s2\/favicons|unavatar\.io|icon\.horse|logo\.clearbit|apple-touch-icon|wsrv\.nl/;
  const offenders = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(js|jsx)$/.test(name) || name === "companyLogo.js") continue;
      if (SOURCES.test(readFileSync(p, "utf8"))) offenders.push(p);
    }
  })(new URL("../../src", import.meta.url).pathname);
  assert.deepEqual(offenders, [], `logo sources leaked outside companyLogo.js:\n${offenders.join("\n")}`);
});

// ── No browser at all (SSR, the MCP server, tests) ────────────────

test("without an Image implementation the module degrades to no logo", async () => {
  const saved = globalThis.Image;
  delete globalThis.Image;
  try {
    const { resolveCompanyLogo } = await freshModule();
    assert.equal(await resolveCompanyLogo("headless.com"), null);
  } finally {
    globalThis.Image = saved;
  }
});
