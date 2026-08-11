// ═══════════════════════════════════════════════════════════════════
// CURATED COMPANY LOGOS  — the override layer in front of the resolver
//
// Automatic resolution is a best effort over sources that are allowed to be
// wrong: Google may only know a company's 16px favicon, and a site may
// publish nothing at all — Sony Pictures Imageworks has no usable favicon
// anywhere, so its co-op card comes up blank. So a human can pin one, and a
// pinned logo wins outright: it is not scored, not compared, not held to any
// size floor.
//
// Pinning one is dropping a file in `public/logos/`, named after what it
// matches:
//
//   public/logos/imageworks.com.svg              matched by domain
//   public/logos/sony-pictures-imageworks.png    matched by company name
//   public/logos/index.json                      generated list of the above
//
// The filename IS the record — there is no separate registry to keep in step
// with the folder, and no second place to forget. `npm run logos` regenerates
// index.json (which exists only because a browser cannot list a directory)
// and processes any raster in place: crop, square, resize, compress.
//
// A dot in the name means a domain, no dot means a company name in
// kebab-case. Names are folded the way a person would: case, accents,
// punctuation, `&` vs `and` and legal suffixes are all noise, so
// `sony-pictures-imageworks.png` matches a work term typed as "Sony Pictures
// Imageworks, Inc.". A company with two domains gets two files — they are a
// couple of kB, and it keeps the rule "the filename is the match" true.
//
// The same shape is what a "submit a logo" feature on the site would produce
// later: an accepted upload is a named file plus an index entry, so that
// feature would not change the resolver at all.
// ═══════════════════════════════════════════════════════════════════

// The app is built with a relative base (`base: "./"`), so public assets are
// addressed through BASE_URL, never from the site root. Optional-chained
// because `import.meta.env` does not exist outside Vite — Node tests and the
// MCP server import this module too.
const BASE = import.meta.env?.BASE_URL ?? "/";

/** Where the logo files live. */
export const LOGO_DIR = `${BASE}logos/`;

const INDEX_URL = `${LOGO_DIR}index.json`;

/** Legal-form suffixes that are noise for identity: "Toast, Inc." is Toast. */
const LEGAL_SUFFIXES = new Set([
  "inc", "incorporated", "llc", "llp", "lp", "ltd", "limited", "co", "corp",
  "corporation", "plc", "gmbh", "ag", "sa", "sas", "bv", "nv", "ab", "as",
  "oy", "pty", "srl", "spa", "kk", "kg", "group", "holdings",
]);

/**
 * Fold a company name to its identity. "Sony Pictures Imageworks, Inc." and
 * "sony-pictures-imageworks" are the same company.
 */
export function normalizeCompanyName(name) {
  if (!name) return "";
  const words = String(name)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // é → e
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

/** Domains are matched host-only, with `www.` folded away. */
export function normalizeLogoDomain(domain) {
  if (!domain) return "";
  return String(domain).trim().toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^\.+|\.+$/g, "")
    .replace(/^www\./, "");
}

/** A hostname: labels of letters, digits and hyphens, ending in a real TLD. */
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

/** A company-name file: lowercase kebab-case, as the folder convention says. */
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The match key a filename carries: a domain if it is one, otherwise a folded
 * company name. Returns null for a file that names nobody — which is a
 * failure, not a default. `Screenshot 2026-08-11 at 11.23.51 AM.png` contains
 * dots and would otherwise be read as a domain; a logo folder full of camera
 * dumps that quietly "work" is worse than one that tells you to rename them.
 * Shared with scripts/build-logos.js, so the folder and the app agree.
 */
export function logoKeyForFile(filename) {
  const name = String(filename ?? "");
  const dot  = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name).trim().toLowerCase();
  if (!base || base.startsWith(".")) return null;
  const domain = normalizeLogoDomain(base);
  if (DOMAIN_RE.test(domain)) return { kind: "domain", key: domain };
  if (!NAME_RE.test(base))    return null;
  const folded = normalizeCompanyName(base);
  return folded ? { kind: "name", key: folded } : null;
}

// ── Loading ───────────────────────────────────────────────────────
// Fetched once per session and memoised, including the failure: no index
// (offline, 404, a Node test with no server) simply means no curated logos,
// and automatic resolution carries on untouched.

let indexPromise = null;
const runtimeEntries = new Map();   // key → url, for logos added at runtime

async function loadIndex() {
  if (!indexPromise) {
    indexPromise = (async () => {
      const byDomain = new Map(), byName = new Map();
      try {
        // Not `force-cache`: a browser that loaded the app before a logo was
        // added would keep serving the 404 (or an index naming a file since
        // renamed) for as long as the tab lived, and the newly pinned logo
        // would simply never appear.
        const res = await fetch(INDEX_URL, { cache: "no-cache" });
        if (res.ok) {
          const data  = await res.json();
          const files = Array.isArray(data) ? data : data?.files;
          for (const file of Array.isArray(files) ? files : []) {
            const hit = logoKeyForFile(file);
            if (!hit) continue;
            (hit.kind === "domain" ? byDomain : byName).set(hit.key, `${LOGO_DIR}${file}`);
          }
        }
      } catch { /* no curated logos, which is a normal state */ }
      return { byDomain, byName };
    })();
  }
  return indexPromise;
}

/** Everything currently pinned, as `key → url`. Mostly for tests and tooling. */
export async function loadLogoIndex() {
  return loadIndex();
}

/**
 * Pin logos at runtime, ahead of the folder. The seam a future in-app
 * "submit a logo" feature plugs into: an accepted upload becomes an entry
 * here without a rebuild.
 */
export function registerCompanyLogos(entries) {
  for (const e of entries ?? []) {
    const url = e?.url;
    if (!url) continue;
    for (const d of e.domains ?? []) runtimeEntries.set(`domain:${normalizeLogoDomain(d)}`, url);
    for (const n of [e.name, ...(e.aliases ?? [])].filter(Boolean))
      runtimeEntries.set(`name:${normalizeCompanyName(n)}`, url);
  }
}

/** The curated URL for a company, or null if nobody has pinned one. */
export async function curatedLogoFor(domain, name) {
  const d = normalizeLogoDomain(domain);
  const n = normalizeCompanyName(name);
  if (d && runtimeEntries.has(`domain:${d}`)) return runtimeEntries.get(`domain:${d}`);
  if (n && runtimeEntries.has(`name:${n}`))   return runtimeEntries.get(`name:${n}`);

  const { byDomain, byName } = await loadIndex();
  // Domain first: it is the identity the plan actually stores, and two
  // companies may share a name far more easily than a domain.
  if (d && byDomain.has(d)) return byDomain.get(d);
  if (n && byName.has(n))   return byName.get(n);
  return null;
}

/** Test seam: drop memoised state so a suite can load a different folder. */
export function _resetLogoRegistry() {
  indexPromise = null;
  runtimeEntries.clear();
}
