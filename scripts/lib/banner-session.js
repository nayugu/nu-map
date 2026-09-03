// ═══════════════════════════════════════════════════════════════════
// BANNER SSB SESSION — the cookie handshake, shared by every Banner client
//
// Banner's Self-Service registration API is stateful in a way that is easy to
// get wrong: a search request only answers for the term the SESSION was last
// activated for, and activation is a POST whose only effect is on the cookie
// jar. So the order is always:
//
//     getTermList()            seed JSESSIONID etc. from a harmless GET
//     activateTerm(code)       POST term/search — binds the session to a term
//     resetForm()              POST resetDataForm — clear any prior criteria
//     fetchPage / per-CRN GETs
//
// Skip the activation and Banner answers for whatever term it last saw, which
// is the failure mode that looks like real data.
//
// ── WHY THIS IS A MODULE, not a factory ────────────────────────────
//
// The jar is module-level mutable state, deliberately. There is exactly one
// Banner session per process — the endpoints are rate-limited hard enough that
// two concurrent sessions are never wanted — and making it a factory would
// force every call site in scrape-availability.js to thread a handle through
// for no behavioural gain. `resetSession()` exists for tests.
//
// ── OUTSTANDING: scrape-availability.js still has its own copy ─────
//
// This module was extracted for restrictions-probe.js, which needed the same
// handshake. `scrape-availability.js` lines ~112-195 still carry a
// byte-equivalent copy and MUST be migrated to import from here — the two
// paths drifting is exactly how `scrapeProgram` ended up duplicated across the
// two program scrapers, which is how a data fix lands in one path and not the
// other (see CLAUDE.md → Major/minor requirements).
//
// It was not done in the same change deliberately: that file is the live
// scraper, it pushes to main unattended, and the change that widens the
// restrictions parser has to touch it anyway. One careful edit, verified
// against a real scrape, beats two.
//
// One difference already exists and is the reason `ensureSession` is here:
// the scraper happens to call `getTermList()` early in `main()`, so it seeds
// the jar by luck rather than by contract. The probe did not, and Banner
// answered `success:true, totalCount:0` for a term with 6,699 sections.
//
// ── WHY `fetchRetry` IS SEPARATE from the plain calls ──────────────
//
// Only the per-CRN loops use it. Banner rate-limits sustained volume (observed:
// connection refusals after ~7k rapid instructor lookups), and those loops are
// the only ones that reach that volume. The handshake calls happen a handful of
// times per term, so a refusal there is a real failure and should surface
// immediately rather than be retried into a 2-minute stall.
// ═══════════════════════════════════════════════════════════════════

export const BASE = "https://nubanner.neu.edu/StudentRegistrationSsb/ssb";

/**
 * Banner's page size for `searchResults`.
 *
 * Exported because callers page by it themselves: the offset they advance has
 * to be the size the server actually used, and a second copy of this number
 * would desynchronise pagination the moment either changed.
 */
export const PAGE_SIZE = 500;

// ── Cookie jar ───────────────────────────────────────────────────

let jar = {};

/**
 * Parse one or more Set-Cookie headers into a name→value map.
 * Attributes after the first `;` (Path, HttpOnly, …) are dropped — we only
 * ever echo the pair back.
 *
 * @param {string|string[]|null} raw
 * @returns {Record<string,string>}
 */
export function parseCookies(raw) {
  if (!raw) return {};
  const headers = Array.isArray(raw) ? raw : [raw];
  const out = {};
  for (const h of headers) {
    const [pair] = h.split(";");
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const val  = pair.slice(eq + 1).trim();
    if (name) out[name] = val;
  }
  return out;
}

/** The current jar as a `Cookie:` header value. */
export function cookieHeader() {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

/** Fold a response's Set-Cookie headers into the jar. */
export function updateJar(res) {
  const raw = res.headers.get("set-cookie");
  if (raw) Object.assign(jar, parseCookies(raw));
}

/** Drop the session. For tests, and for a client that wants a clean handshake. */
export function resetSession() { jar = {}; }

// ── Requests ─────────────────────────────────────────────────────

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * fetch with backoff retries for transient network refusals. Banner rate-limits
 * sustained request volume — waiting out the window recovers it. Use this for
 * the per-CRN loops only; see the header note.
 *
 * @param {string} url
 * @param {RequestInit} [opts]
 * @param {number} [tries]
 */
export async function fetchRetry(url, opts, tries = 4) {
  for (let i = 0; ; i++) {
    try { return await fetch(url, opts); }
    catch (err) {
      if (i >= tries - 1) throw err;
      const wait = [5_000, 30_000, 90_000][i] ?? 90_000;
      console.warn(`    network refusal — backing off ${wait / 1000}s (attempt ${i + 2}/${tries})`);
      await sleep(wait);
    }
  }
}

/**
 * The real term list, and the call that seeds the cookie jar.
 * @returns {Promise<Array<{code: string, description: string}>>}
 */
export async function getTermList(max = 30) {
  const url = `${BASE}/classSearch/getTerms?searchTerm=&offset=1&max=${max}`;
  const res = await fetch(url);
  updateJar(res);
  if (!res.ok) throw new Error(`getTerms HTTP ${res.status}`);
  return await res.json();
}

/** Bind the session to a term. Every subsequent search answers for this term. */
export async function activateTerm(termCode) {
  const res = await fetch(`${BASE}/term/search?mode=search`, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cookie": cookieHeader() },
    body:    `term=${termCode}&studyPath=&studyPathText=&startDatepicker=&endDatepicker=`,
  });
  updateJar(res);
  if (!res.ok) throw new Error(`term/search HTTP ${res.status} for ${termCode}`);
}

/** Clear any search criteria left over from a previous query. */
export async function resetForm() {
  const res = await fetch(`${BASE}/classSearch/resetDataForm`, {
    method:  "POST",
    headers: { "Cookie": cookieHeader() },
  });
  updateJar(res);
}

/** One page of a term's section feed. */
export async function fetchPage(termCode, offset, pageSize = PAGE_SIZE) {
  const url = `${BASE}/searchResults/searchResults` +
    `?txt_term=${termCode}&pageOffset=${offset}&pageMaxSize=${pageSize}` +
    `&sortColumn=subjectDescription&sortDirection=asc`;
  const res = await fetch(url, { headers: { "Cookie": cookieHeader() } });
  updateJar(res);
  if (!res.ok) throw new Error(`searchResults HTTP ${res.status}`);
  return await res.json();
}

/**
 * Seed the jar, once per process.
 *
 * `activateTerm` is a POST whose only effect is on cookies, so it needs a
 * session to attach to. Without one Banner accepts the POST, returns 200, and
 * then answers the subsequent search with `success:true, totalCount:0` — which
 * is indistinguishable from "this term has no sections" unless the caller
 * checks. Every Banner client must therefore make one harmless GET first.
 */
export async function ensureSession() {
  if (Object.keys(jar).length) return;
  await getTermList(1);
}

/**
 * The full handshake for one term: seed if needed, activate, clear the form.
 * Callers still pace themselves — Banner wants a gap between these.
 */
export async function openTerm(termCode, delayMs = 500) {
  await ensureSession();
  await activateTerm(termCode);
  await sleep(delayMs);
  await resetForm();
  await sleep(delayMs);
}
