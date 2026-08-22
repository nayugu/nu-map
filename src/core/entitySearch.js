// ═══════════════════════════════════════════════════════════════════
// ENTITY SEARCH  (pure — the search behind numap.app/data)
//
// Resolves a typed query to entities across every kind of thing the public
// data surface publishes: courses, professors, programs, subjects, NUpath
// codes. Scoring is core/rankRecords.js; this file is the three things around
// it — the wire format, the router, and the representation guarantee.
//
// Institution-blind by construction. Every Northeastern-specific decision
// (which kinds exist, what a page's URL looks like, which string is a code,
// what "orgo" means) is DATA in the index, written by the adapter that built
// it. A second school ships a different index and changes nothing here.
//
// ## Why a brute-force scan
//
// Measured over the real 13,022-record index: a full scan costs a median of
// 2.8 ms and a worst case of 5.0 ms per keystroke, against a 16 ms frame; the
// index is ~100 KB brotli and 20 ms to parse and prepare, once. A trie or an
// inverted index would be more code, more build surface and more ways to be
// wrong, bought with latency that is already free.
//
// What DID matter is the `heads` precondition in rankRecords: without it the
// same scan takes 14 ms, because the memoised initials search then runs on
// every record. See docs/data-search-design.md.
//
// ## The representation guarantee
//
// Courses outnumber every other kind 6:1, so a single ranked list lets them
// flood: "chemistry" returned five course titles and buried both the subject
// page and the Chemistry BS. The first fix was a per-kind display quota — five
// tuned constants pretending to be a principle. This is the replacement, and
// it is one rule: THE BEST HIT OF EVERY KIND THAT MATCHED AT ALL IS GUARANTEED
// A SLOT. The rest is pure score order. Nothing to tune, and it states a
// property ("the major you meant is visible") rather than a ration.
// ═══════════════════════════════════════════════════════════════════

import { normalizeQuery, scoreRecord } from "./rankRecords.js";

/** Wire format version. Bumped when a column's meaning changes. */
export const INDEX_VERSION = 1;

/** Score added to a record whose code the query states exactly. */
const ROUTE_BOOST = 100000;

/** List columns are joined with this; refused inside a value at encode time. */
const SEP = "|";

/**
 * A record, as the adapter hands it over.
 *
 * Three optional fields, not six. `codes`, `qualifiers` and `pool` were each
 * designed and then deleted, because the strings made them pointless:
 *   - program names on this surface already read "Chemistry, BS (Boston)", so
 *     the degree code and campus are in the NAME;
 *   - a course's pool was always its own code split on the space, so the code
 *     is tokenized into the pool automatically instead. That also fixes, by
 *     construction, the defect that made "aace 6" match nothing.
 *
 * @typedef {Object} EntityRecord
 * @property {string} kind    kind id; must exist in the kinds table
 * @property {string} name    display name, and what coverage is measured on
 * @property {string} path    page path, RELATIVE to the kind's prefix. May be
 *   omitted when it is the code with spaces as slashes ("CHEM 2311" →
 *   "CHEM/2311"), which is the case for every coded kind — the encoder detects
 *   that and stores nothing, because a column that restates another column is
 *   200 KB of the payload.
 * @property {string} [code]  this record's UNIQUE identifier ("CHEM 2311",
 *   "CHEM", "ND"). Routable: a query equal to it is an answer, not a candidate.
 *   Its words are always matchable, so "chem organic" and "2311" both land.
 * @property {string[]} [aliases]  nicknames that count as the whole name
 * @property {string[]} [acronyms] derived initials ("cs")
 */

/** The path a code implies, when a record does not state one of its own. */
const pathOfCode = (code) => code.replace(/ /g, "/");

/**
 * Strip diacritics for MATCHING only; the displayed name keeps them.
 *
 * Measured: 3 of 13,022 records carry an accented letter — two "Bouvé" courses
 * and one professor, "Zoë Lang" — and all three were unreachable, because the
 * tokenizer treats "é" as a separator, so "Bouvé" became the word "bouv" and
 * typing "bouve" matched no prefix. Three records is a small number and
 * "bouve" is exactly what a Northeastern student types; instructor names also
 * arrive from Banner monthly, so the set only grows.
 *
 * Folded here rather than in rankRecords' normalizeQuery, which program search
 * shares: this is the data surface's fix, and quietly re-ranking the planner is
 * not part of it.
 *
 * The character class below is the combining-diacritical-marks block,
 * U+0300–U+036F, written as the literal range NFD decomposition produces.
 * It looks empty in some editors; it is not. Do not "tidy" it away.
 */
const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Encode records into the shipped payload: columnar, because it measured
 * smaller than an array of objects on both axes (534 vs 712 KB raw, 116 vs
 * 132 KB gzip) — repeated key names are the whole difference.
 *
 * @param {EntityRecord[]} records
 * @param {Array<{id: string, label: string, prefix: string}>} kinds
 */
export function encodeIndex(records, kinds, meta = {}) {
  const kindIds = kinds.map((k) => k.id);
  for (const r of records) {
    if (!kindIds.includes(r.kind)) throw new Error(`record of unknown kind "${r.kind}": ${r.name}`);
    if (!r.name) throw new Error(`record without a name in kind "${r.kind}"`);
    if (!r.path && !r.code) throw new Error(`record with neither path nor code: ${r.kind} "${r.name}"`);
    // A separator inside a value would silently merge two entries on decode,
    // so it is refused where it can still be fixed.
    for (const f of ["aliases", "acronyms"]) {
      for (const v of r[f] ?? []) if (String(v).includes(SEP))
        throw new Error(`"${SEP}" in ${f} of ${r.kind} "${r.name}": ${v}`);
    }
  }
  const col = (f) => records.map((r) => r[f] ?? "");
  const list = (f) => records.map((r) => (r[f] ?? []).join(SEP));
  return {
    v: INDEX_VERSION,
    ...meta,
    kinds,
    k: records.map((r) => kindIds.indexOf(r.kind)),
    n: col("name"),
    // Stored only when it is not what the code already implies.
    p: records.map((r) => (r.code && r.path === pathOfCode(r.code) ? "" : (r.path ?? ""))),
    c: col("code"),
    al: list("aliases"),
    ac: list("acronyms"),
  };
}

const COLUMNS = ["k", "n", "p", "c", "al", "ac"];

/**
 * Decode a payload back into records, refusing anything malformed.
 *
 * The strictness earns its keep on Cloudflare Pages, where `/* /index.html 200`
 * answers a MISSING file with the HTML shell at status 200 — so a deleted or
 * mis-hashed index arrives as a successful response full of markup. `r.ok`
 * proves nothing; a payload that survives this function does.
 */
export function decodeIndex(payload) {
  if (!payload || typeof payload !== "object") throw new Error("index is not an object");
  if (payload.v !== INDEX_VERSION) throw new Error(`index version ${payload.v} != ${INDEX_VERSION}`);
  if (!Array.isArray(payload.kinds) || !payload.kinds.length) throw new Error("index has no kinds");
  for (const c of COLUMNS) if (!Array.isArray(payload[c])) throw new Error(`index column "${c}" missing`);
  const n = payload.n.length;
  for (const c of COLUMNS) if (payload[c].length !== n)
    throw new Error(`index column "${c}" has ${payload[c].length} of ${n} rows`);

  const split = (s) => (s ? s.split(SEP) : []);
  const records = [];
  for (let i = 0; i < n; i++) {
    const kind = payload.kinds[payload.k[i]];
    if (!kind) throw new Error(`row ${i} has unknown kind index ${payload.k[i]}`);
    const code = payload.c[i];
    records.push({
      kind: kind.id, name: payload.n[i], code,
      path: payload.p[i] || pathOfCode(code),
      aliases: split(payload.al[i]), acronyms: split(payload.ac[i]),
    });
  }
  return { kinds: payload.kinds, records };
}

/**
 * Turn decoded records into the form the scan wants, once. Lowercasing and
 * tokenizing all 13,022 records costs ~11 ms, so it happens at load rather
 * than per keystroke.
 */
export function prepareIndex(decoded) {
  const { kinds, records } = decoded;
  const lower = (xs) => xs.map((s) => fold(s.toLowerCase()));
  const scored = records.map((r) => {
    const code = fold((r.code ?? "").toLowerCase());
    const name = fold(r.name.toLowerCase());
    const nameWords = name.split(/[^a-z0-9]+/).filter(Boolean);
    // A code's own words, so a half-typed code still matches: "chem 2" has to
    // keep CHEM 2311 alive. Derived here rather than shipped as a pool column,
    // which removes 105 KB and one way for the two to disagree.
    const poolWords = code ? code.split(" ") : [];
    const acronyms = lower(r.acronyms ?? []);
    return {
      name, nameWords, poolWords, acronyms,
      exact: lower(r.aliases ?? []),
      codes: code ? [code] : [],
      // The accelerator rankRecords documents: first characters of every
      // matchable word. Without it the scan is 14 ms per keystroke instead
      // of ~2, because the initials search runs on all 13,022 records.
      heads: new Set([...nameWords, ...poolWords, ...acronyms].map((w) => w[0])),
    };
  });
  return {
    kinds, records, scored,
    byId: new Map(kinds.map((k) => [k.id, k])),
    // What the router matches against, named rather than implied. Reading it
    // back out of `scored[i].codes[0]` worked only because that array happens
    // to hold exactly the unique code today; anything added to it later would
    // have moved routing silently.
    route: scored.map((s) => s.codes[0] ?? ""),
    codes: new Set(scored.map((s) => s.codes[0]).filter(Boolean)),
  };
}

/**
 * "chem2311" is the same request as "chem 2311". Letters and digits already
 * delimit each other, so splitting them needs no vocabulary — which is what
 * keeps this generic rather than a rule about four-digit course numbers.
 *
 * Applied to the QUERY, once, rather than scoring both forms: two scoring
 * passes were written first and bought nothing except a way for a routed
 * record to score -Infinity + boost and vanish from its own exact query.
 */
function canonicalQuery(q) {
  const m = /^([a-z]{2,5})\s*(\d{2,6})$/.exec(q);
  return m ? `${m[1]} ${m[2]}` : q;
}

/**
 * Search the prepared index.
 *
 * @returns {Array<{index: number, kind: string, score: number, routed: boolean}>}
 *   best first, at most `limit`, with the representation guarantee applied.
 */
export function searchEntities(prepared, query, { limit = 10 } = {}) {
  const { q: raw } = normalizeQuery(fold(String(query ?? "")));
  if (!raw) return [];
  const { q, qTokens } = normalizeQuery(canonicalQuery(raw));
  // A query with no letters or digits is not a search. Without this, "!!!"
  // tokenizes to nothing, `orderedPrefixes([], …)` is vacuously true, and every
  // record in the corpus comes back as an ORDERED match.
  if (!qTokens.length) return [];

  // The router: an exact code is an answer, not a candidate.
  const routes = prepared.codes.has(q);

  const hits = [];
  for (let i = 0; i < prepared.scored.length; i++) {
    let score = scoreRecord(prepared.scored[i], q, qTokens);
    const routed = routes && prepared.route[i] === q;
    if (routed) score += ROUTE_BOOST;
    if (score > -Infinity) hits.push({ index: i, kind: prepared.records[i].kind, score, routed });
  }

  hits.sort((a, b) => b.score - a.score
    || prepared.scored[a.index].name.length - prepared.scored[b.index].name.length
    || prepared.records[a.index].name.localeCompare(prepared.records[b.index].name));

  return applyRepresentation(hits, limit);
}

/**
 * The best hit of every kind that matched gets a slot; everything else fills
 * the remainder in score order.
 */
export function applyRepresentation(hits, limit = 10) {
  if (hits.length <= limit) return hits;
  const seen = new Set();
  const promoted = [];
  for (const h of hits) {
    if (seen.has(h.kind)) continue;
    seen.add(h.kind);
    promoted.push(h);
  }
  const out = promoted.slice(0, limit);
  const taken = new Set(out);
  for (const h of hits) {
    if (out.length >= limit) break;
    if (!taken.has(h)) out.push(h);
  }
  return out;
}

/** The page URL for a record: the kind's prefix plus the record's own path. */
export function urlOf(prepared, index) {
  const r = prepared.records[index];
  return `${prepared.byId.get(r.kind).prefix}${r.path}`;
}
