// ═══════════════════════════════════════════════════════════════════
// COMPANY LOGO  — the single source of truth for "what does this company
// look like". Every surface goes through here: the planner rows, the stats
// panel, the company search dropdown and the PDF export, so a company cannot
// wear one logo in the search list and a different one in the plan.
//
// Google's favicon service answers *every* domain: when it knows nothing it
// serves its generic 16×16 globe with HTTP 404, and an <img> renders a 404
// body perfectly happily, so `onerror` never fires and the globe sticks. A
// source that fails silently cannot be trusted to fail, so we probe several
// in parallel and judge each by the pixels it actually returned. The globe
// loses on size, and so does a 16px favicon blown up to 40px: blank beats
// blurry, and blank beats a stand-in glyph pretending to be a logo.
//
// Sources are ranked by *kind* first and size second, which matters more than
// it sounds. Two kinds exist:
//
//   MARKS — the favicon proper: the logo, tightly cropped, usually on
//     transparency. Google's service and the site's own /favicon.ico.
//   TILES — /apple-touch-icon.png: home-screen art, which by Apple's own
//     guidance carries no alpha, so it is a padded glyph on an opaque
//     square. Measured 2026-08-11: of 9 employer sites publishing one, 8
//     had no alpha channel. Rendered next to text it reads as a grey box
//     with a logo in it, which is why apple.com — 64px transparent mark
//     from Google, 152px opaque tile from the site — must NOT simply take
//     the bigger image. Tiles are a rescue, never an upgrade.
//
// So: take the sharpest mark; only if no mark is usable at all, take the
// sharpest tile. Measured over 20 employer domains, 17 are served by a mark
// of 48px or better (hubspot.com's own /favicon.ico is 288px where Google
// has 128px, so both mark sources earn their place), sonypictures.com is
// 16px from every mark source and is rescued by its 128px tile, and
// imageworks.com and statestreet.com publish nothing usable anywhere and
// render blank. That is the correct answer for them, not a globe.
//
// Two sources were measured and rejected. logo.clearbit.com is dead — the
// CDN refuses connections (its *autocomplete* endpoint, which CompanySearch
// uses for names, still works). icon.horse looks ideal — CORS, big PNGs —
// until you look at the pixels: for imageworks.com it returns a 256×256
// grey "I", a generated monogram, and for a domain that does not exist at
// all it returns a matching "N". Every one of its answers is HTTP 200, so
// the only way to know is to look. A placeholder that outscores real logos
// is worse than having no source.
//
// Corrected here rather than left in the history: an earlier version also
// queried `domain=www.{d}`, on the strength of one measurement where that
// rescued imageworks.com with a 128px logo. Repeating it an hour later gave
// the globe for both spellings — Google's answer had simply been cached
// differently — and across the corpus the www spelling never once beat the
// bare one. It was a fluke read as a finding, and it is gone.
// ═══════════════════════════════════════════════════════════════════

import { curatedLogoFor, normalizeCompanyName } from "./companyLogoRegistry.js";

/** Below this, a logo is mush at the 26–40px we render it. Render nothing instead. */
export const MIN_LOGO_PX = 32;

/** A dead host can hang a request open; give up and let the others answer. */
const PROBE_TIMEOUT_MS = 6000;

/**
 * How long a usable logo waits for a possibly-sharper one. Company web
 * servers are the slow sources here, and a logo that arrives six seconds late
 * because one of them never answered is worse than a logo that is merely
 * good. Once *something* clears MIN_LOGO_PX, the rest get this long.
 */
const GRACE_MS = 1200;

const CACHE_KEY   = "company-logo-cache-v1";
const HIT_TTL_MS  = 30 * 24 * 3600 * 1000;  // a logo that resolved is stable
const MISS_TTL_MS =  7 * 24 * 3600 * 1000;  // a miss might be a site adding one

/** Strip scheme, path and trailing dots so `https://acme.com/careers` → `acme.com`. */
export function normalizeDomain(domain) {
  if (!domain) return "";
  return String(domain).trim().toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^\.+|\.+$/g, "");
}

/**
 * Every URL worth asking, in the two waves described above: `marks` is the
 * logo proper and is always tried; `tiles` is home-screen art and only gets
 * asked when no mark was usable.
 */
export function logoCandidates(domain) {
  const d = normalizeDomain(domain);
  if (!d || !d.includes(".")) return { marks: [], tiles: [] };
  const enc = encodeURIComponent(d);
  return {
    marks: [
      // sz=256 rather than 128: Google returns the largest icon it holds up
      // to the size asked for, so this is a free upgrade (ge.com: 128 → 192).
      `https://www.google.com/s2/favicons?domain=${enc}&sz=256`,
      `https://${d}/favicon.ico`,
    ],
    tiles: [
      `https://${d}/apple-touch-icon.png`,
      // An aggregator, and the one source here that fails honestly: an
      // unknown domain is a 404 with an empty body, so the <img> errors out
      // cleanly. It is in the second wave for a second reason — it is a small
      // free service that rate-limits, and a rescue is rare by construction.
      `https://unavatar.io/${enc}?fallback=false`,
    ],
  };
}

/**
 * The same image, but readable pixel-by-pixel: wsrv.nl re-serves any URL with
 * `Access-Control-Allow-Origin: *`, which the favicon services do not, and a
 * canvas drawn from a cross-origin image without that header is tainted.
 * Only for sampling (the stats panel's glow colour) — never for display, so
 * a rendered logo never depends on a proxy being up.
 */
export function pixelReadableUrl(url, size = 32) {
  if (!url) return null;
  // A curated logo is our own file: same-origin, so a canvas can already read
  // it. Sending it through the proxy would be a pointless round trip, and on
  // localhost the proxy cannot reach it at all.
  try {
    if (globalThis.location && new URL(url, location.href).origin === location.origin) return url;
  } catch { /* not parseable against this page — let the proxy try */ }
  return `https://wsrv.nl/?url=${encodeURIComponent(url.replace(/^https?:\/\//, ""))}&w=${size}&h=${size}&output=png`;
}

/** Load `url` and report its smaller side in pixels, or 0 if it is not usable. */
function probe(url) {
  return new Promise(resolve => {
    if (typeof Image === "undefined") { resolve(0); return; }
    const img = new Image();
    let settled = false;
    const finish = px => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = img.onerror = null;
      resolve(px);
    };
    const timer = setTimeout(() => finish(0), PROBE_TIMEOUT_MS);
    // An SVG with no intrinsic size reports 0 — treat that as unusable rather
    // than guessing a size we cannot verify.
    img.onload  = () => finish(Math.min(img.naturalWidth, img.naturalHeight) || 0);
    img.onerror = () => finish(0);
    img.referrerPolicy = "no-referrer";   // do not leak the planner URL to employers
    img.src = url;
  });
}

/**
 * Probe a wave in parallel and keep the biggest usable answer, or null.
 * Settles when every probe has answered, or GRACE_MS after the first usable
 * one — whichever comes first — so a stalled host cannot hold up a logo we
 * already have. Ties go to the earlier candidate, hence `>` not `>=`.
 */
function bestOf(urls) {
  return new Promise(resolve => {
    if (!urls.length) { resolve(null); return; }
    let best = null, pending = urls.length, grace = null, settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(grace);
      resolve(best);
    };
    for (const url of urls) {
      probe(url).then(px => {
        if (px >= MIN_LOGO_PX && (!best || px > best.px)) best = { url, px };
        if (best && grace === null) grace = setTimeout(finish, GRACE_MS);
        if (--pending === 0) finish();
      });
    }
  });
}

// ── Cache ─────────────────────────────────────────────────────────
// Two layers: a module map so one render never probes twice, and
// localStorage so tomorrow's session does not re-probe five URLs per company.

const inFlight = new Map();   // domain → Promise<string|null>

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; }
  catch { return {}; }
}

function cachedUrl(domain) {
  const entry = readCache()[domain];
  if (!entry) return undefined;
  const ttl = entry.url ? HIT_TTL_MS : MISS_TTL_MS;
  if (Date.now() - (entry.at ?? 0) > ttl) return undefined;
  return entry.url ?? null;
}

function writeCache(domain, url) {
  try {
    const all = readCache();
    all[domain] = { url, at: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch { /* private mode, or full — the module map still holds for this session */ }
}

/** A curated `/logos/…` path must survive being embedded in the PDF window. */
function absolute(url) {
  if (!url || /^[a-z]+:/i.test(url)) return url;
  try { return new URL(url, globalThis.location?.href).href; }
  catch { return url; }
}

/**
 * The logo for a company: the curated one if someone has pinned it, otherwise
 * the sharpest mark the open web offers.
 *
 * @param {string} domain  employer domain, as stored on the work term
 * @param {string} [name]  employer name — lets a curated logo match a work
 *                         term that was typed in without a domain
 * @returns {Promise<string|null>} an image URL, or null when nothing clears
 *   MIN_LOGO_PX — callers render empty space, never a placeholder glyph.
 */
export function resolveCompanyLogo(domain, name) {
  const d   = normalizeDomain(domain);
  const key = d || (name ? `name:${normalizeCompanyName(name)}` : "");
  if (!key) return Promise.resolve(null);
  if (inFlight.has(key)) return inFlight.get(key);

  const run = (async () => {
    // A pinned logo is a decision already made by a person. It is not scored
    // against the automatic sources and it does not have to clear any size
    // floor — that is the entire point of pinning one.
    const pinned = await curatedLogoFor(d, name);
    if (pinned) return absolute(pinned);

    if (!d.includes(".")) return null;          // name-only company, nothing pinned
    const cached = cachedUrl(d);
    if (cached !== undefined) return cached;

    // Kind before size: a usable mark ends the search, however big a tile
    // might have been. This is the apple.com rule — 64px transparent logo
    // beats a 152px logo-on-a-grey-square.
    const { marks, tiles } = logoCandidates(d);
    const best = (await bestOf(marks)) ?? (await bestOf(tiles));
    writeCache(d, best?.url ?? null);
    return best?.url ?? null;
  })();

  inFlight.set(key, run);
  return run;
}

/** Test seam: forget this session's resolutions (not the stored ones). */
export function _clearLogoMemo() {
  inFlight.clear();
}
