// ═══════════════════════════════════════════════════════════════════
// CLASS-STANDING RESTRICTIONS — parsing Banner, and folding sections into a gate
//
// Banner's getRestrictions page states the gate the catalog only ever puts in
// prose: "Must be enrolled in one of the following Classes: Junior (JR),
// Senior(SR)". `RESTRICTION_ONLY` in courseNorm.js discards that sentence, which
// is why six engine modules carry comments apologising for not having it and the
// stand-in is the course-level digit.
//
// Two consumers, hence this file: scrape-availability.js parses Banner into a
// per-section tally, and derive-offering-summary.js folds that tally into one
// gate per course. Keeping the fold OUT of the scrape is deliberate — see below.
//
// ── MEASURED (Fall 2025, 7,430 sections; random sample of 400) ──────
//
// 21–23% of sections carry a Classes restriction, over a closed five-value
// vocabulary in 9 observed combinations:
//
//     31  GR                 15  GR|JR|SR           14  JR|SH|SR
//      9  JR|SR               6  FR                  5  SR
//      2  FR|SH               1  GR|SR               1  FR|JR|SH|SR
//
// Of 47 capstone and advanced-writing courses: 31 gated on EVERY section, 1 on
// some (PJM 4850, 1 of 2), 15 on none. ENGW 3302/3307/3315 are 24/24, 16/16 and
// 15/15 sections JR|SR — the exact courses search.js hand-tunes around.
//
// ── THE TWO FOLD RULES, and why they are rules ─────────────────────
//
//   1. A course is gated only when EVERY section is gated. PJM 4850 is the
//      counterexample that makes this necessary rather than tidy: one of its two
//      sections is senior-only and the other is not, so a student can take it in
//      any term. Gating on "some section is restricted" would be a false gate.
//   2. Across gated sections, take the MOST LENIENT standing. BIOL 4701 carries
//      both JR|SR and SR across its 7 sections; junior is reachable, so junior is
//      the floor. Same principle as `shallowestLevel` in prereqDepth.js — a floor
//      must not forbid a placement some legal choice makes fine.
//
// Both are presentation decisions over raw facts, which is why the scrape stores
// the tally and this module folds it. Folding at capture time would have thrown
// away the two facts above and required a 29-minute re-scrape per term to revisit.
//
// ── CONSERVATISM, stated once ──────────────────────────────────────
//
// Banner prints "Not all restrictions are applicable." on every one of these
// pages. It is the registrar hedging about its own data, and it is the reason
// this module degrades toward NO gate rather than toward a gate: an unparseable
// page, an unknown code, a disagreement between terms all yield null. A missing
// gate costs a plan that sequences one course early; a false gate can refuse the
// plan outright.
// ═══════════════════════════════════════════════════════════════════

/** Only the "Classes" restriction, positive or negative. */
const CLASSES_HEADING = /following Classes:$/;

/**
 * The standing ladder, most junior first. Position IS the ordering — `indexOf`
 * on this array is what makes "most lenient" computable.
 *
 * GR is deliberately NOT on it. Graduate standing is not a rung above senior; it
 * is a different ladder, reached by admission rather than by accumulating terms
 * (prereqDepth.js measures the p10 of a graduate placement at 0.00 for every
 * level 5xxx–8xxx). A GR-only section is a graduate course, which the level digit
 * already says, and mapping it onto an undergraduate floor is how a master's
 * student gets barred from their own first term.
 */
export const STANDING_LADDER = ["FR", "SH", "JR", "SR"];

/** Every code Banner is known to print in a Classes restriction. */
export const KNOWN_STANDINGS = new Set([...STANDING_LADDER, "GR"]);

/**
 * Fraction of an undergraduate plan completed before each standing is reached.
 *
 * A standing is earned with credits, not terms, so the honest mapping for a
 * 4-year/8-term plan is thirds-of-the-way markers: sophomore at 1/4, junior at
 * 1/2, senior at 3/4. Deliberately NOT fitted to observed placements — those are
 * what `levelFloor` already is, and the whole point of this data is to replace a
 * fit with the registrar's stated rule.
 *
 * Expressed as a position 0..1 to match `cellLevelFloor`'s contract, so a plan of
 * any length converts the same way.
 */
export const STANDING_FLOOR = Object.freeze({ FR: 0.00, SH: 0.25, JR: 0.50, SR: 0.75 });

/**
 * Parse a getRestrictions page into { heading: [values] }.
 *
 * Headings are `<span class="status-bold">…:</span>` and each owns the
 * `detail-popup-indentation` spans that follow it, up to the next heading. The
 * trailing colon separates a heading from the page's own notice ("Not all
 * restrictions are applicable."), which carries the same class and no colon.
 *
 * @param {string} html
 * @returns {Record<string, string[]>}
 */
export function parseRestrictions(html) {
  const out = {};
  const norm = String(html ?? "").replace(/\s+/g, " ");
  const re = /<span class="status-bold">([^<]*)<\/span>((?:(?!<span class="status-bold">)[\s\S])*)/g;
  let m;
  while ((m = re.exec(norm))) {
    const head = m[1].trim();
    if (!head.endsWith(":")) continue;
    const values = [...m[2].matchAll(/<span class="detail-popup-indentation">([^<]*)<\/span>/g)]
      .map(x => x[1].trim())
      .filter(Boolean);
    // A heading with no values is Banner rendering an empty block, not a gate.
    if (values.length) out[head] = values;
  }
  return out;
}

/**
 * The standing codes in a list of restriction values, sorted and `|`-joined.
 *
 * Banner writes the code parenthesised but spaces it inconsistently — "Junior (JR)"
 * sits beside "Senior(SR)" in the SAME list — so the code, never the label, is the
 * key. Sorting makes {JR,SR} and {SR,JR} one bucket instead of two.
 *
 * Unknown two-letter codes are dropped rather than kept: a code we cannot place on
 * the ladder cannot become a floor, and carrying it would let a future Banner value
 * silently widen a gate. Returns "" when nothing is recognised.
 *
 * @param {string[]} values
 * @returns {string}
 */
export function standingKey(values) {
  const codes = new Set();
  for (const v of values ?? []) {
    const m = /\(\s*([A-Za-z]{2})\s*\)/.exec(String(v));
    if (m && KNOWN_STANDINGS.has(m[1].toUpperCase())) codes.add(m[1].toUpperCase());
  }
  return codes.size ? [...codes].sort().join("|") : "";
}

/**
 * Split a parsed restrictions page into its positive and negative Classes keys.
 *
 * @param {Record<string, string[]>} parsed  from parseRestrictions
 * @returns {{must: string, not: string}}  "" when absent
 */
export function classesOf(parsed) {
  let must = "", not = "";
  for (const [head, values] of Object.entries(parsed ?? {})) {
    if (!CLASSES_HEADING.test(head)) continue;
    const key = standingKey(values);
    if (!key) continue;
    if (/^Cannot/i.test(head)) not = key; else must = key;
  }
  return { must, not };
}

/**
 * The most lenient standing in a `|`-joined key, or null.
 *
 * "Most lenient" is the earliest rung the key admits, because a student holding it
 * satisfies the restriction. GR is skipped for the reason on STANDING_LADDER: a
 * GR|JR|SR section is open to juniors, so its floor is junior; a GR-ONLY section
 * has no undergraduate floor at all and returns null.
 *
 * @param {string} key
 * @returns {string|null} a STANDING_LADDER member
 */
export function lenientStanding(key) {
  let best = null;
  for (const code of String(key ?? "").split("|")) {
    const i = STANDING_LADDER.indexOf(code);
    if (i === -1) continue;
    if (best === null || i < STANDING_LADDER.indexOf(best)) best = code;
  }
  return best;
}

/**
 * Fold one term's section tally into that term's gate, or null.
 *
 * ── What a gate MEANS ──────────────────────────────────────────────
 *
 * The earliest standing at which the student could take the course AT ALL — not a
 * standing every section admits. `{SR: 3, "JR|SR": 4}` floors at junior because
 * four of the seven sections are open to juniors, even though three are not. That
 * is the right reading for a floor, whose only job is to avoid forbidding a legal
 * placement; a stricter reading would push the course a year later than the
 * registrar does, on sections the student was never obliged to want.
 *
 * @param {{sections?: number, std?: Record<string, number>}} detail  a term-details entry
 * @returns {string|null} a STANDING_LADDER member, or null for "no gate"
 */
export function termGate(detail) {
  const std = detail?.std;
  const sections = detail?.sections;
  if (!std || !Number.isFinite(sections) || sections <= 0) return null;

  // Rule 1 — every section gated. Sections whose key contributed nothing to the
  // ladder (GR-only) still COUNT as gated: a graduate-only section is not an
  // undergraduate escape hatch, so it must not make the course look ungated.
  const gated = Object.values(std).reduce((s, n) => s + (n || 0), 0);
  if (gated < sections) return null;
  // More marks than sections means the tally and the section count disagree —
  // a shared-section merge, a mid-run Banner edit. Unresolvable, so no gate.
  if (gated > sections) return null;

  // Rule 2 — most lenient across the gated sections.
  let best = null;
  for (const key of Object.keys(std)) {
    const s = lenientStanding(key);
    if (!s) continue;
    if (best === null || STANDING_LADDER.indexOf(s) < STANDING_LADDER.indexOf(best)) best = s;
  }
  return best;
}

/**
 * Fold a course's whole term history into one gate, or null.
 *
 * Terms DISAGREEING is the interesting case, and the answer is again the most
 * lenient: a course that was senior-only in 2024 and junior-and-up in 2025 is
 * junior-and-up now, and reading the stricter rule forward would push a course
 * later on the strength of a gate the registrar has since relaxed. Terms with no
 * restriction data at all are skipped, not read as "no gate" — that is the
 * difference between silence and evidence.
 *
 * Ignoring `stdNot` here is deliberate: the negative form is 0.3% of sections
 * (1 of 300 sampled), it excludes rather than floors ("cannot be a freshman" is
 * already implied by every gate we do read), and one measured example is not
 * enough to model. It is captured in the scrape so revisiting needs no re-scrape.
 *
 * @param {Record<string, object>} byTerm  term-details entry for one course
 * @returns {{standing: string, terms: number, agree: boolean}|null}
 */
export function courseGate(byTerm) {
  const seen = [];
  for (const detail of Object.values(byTerm ?? {})) {
    // Only terms that were actually looked up can vote.
    if (!detail?.std && !detail?.stdNot) continue;
    seen.push(termGate(detail));
  }
  if (!seen.length) return null;
  const gates = seen.filter(Boolean);
  if (!gates.length) return null;
  let best = gates[0];
  for (const g of gates) {
    if (STANDING_LADDER.indexOf(g) < STANDING_LADDER.indexOf(best)) best = g;
  }
  // A term that saw the course ungated is a disagreement too, and the most
  // lenient reading of "no gate" is no gate.
  const agree = gates.length === seen.length && gates.every(g => g === best);
  if (gates.length < seen.length) return null;
  return { standing: best, terms: seen.length, agree };
}
