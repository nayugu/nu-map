// ═══════════════════════════════════════════════════════════════════
// RESTRICTION VIEW — turning Banner's per-section facts into one readable list
//
// A restriction is a property of a SECTION in a SEMESTER. The stored shape says
// so faithfully: one entry per term, and within each, one group per distinct set
// of codes with the number of sections carrying it. Rendered in that shape it is
// a data dump — eleven terms x several kinds x several groups.
//
// A student has one question: *can I take this, and when?* An advisor answers by
// RESTRICTION, not by term — "in Fall only IE majors, in Summer B only ME
// majors". So this inverts the nesting: group by kind and by VALUE, and list
// where each applied.
//
// That is clearer AND shorter, and the two are the same change. The common case
// — a course restricted identically every term — collapses from eleven lines to
// one, and a course whose restriction actually MOVES gets a second line, so
// difference becomes visually loud instead of buried in repetition.
//
// ── THE UNIT IS ONE VALUE, NOT ONE SECTION'S CODE-SET ──────────────
//
// This used to key on the whole set of codes a section listed, which is the
// shape the data arrives in. It is the wrong unit, and ACCT 1209 is the proof:
// eleven rows under one heading, each an eighteen-to-twenty-name list of
// business majors differing from its neighbours by one or two codes, because
// the registrar edited one section's list or a major code came into existence
// mid-window. 196 major names printed to say one thing.
//
// The reader is ONE value. A student is one major, one class standing, one
// campus, and their question is "how many sections may I register for?" — never
// "which majors are listed together". So the fold is per code: how many sections
// name this code, per season, out of how many. Codes whose coverage is
// identical then share a row, which is a display grouping that states only what
// is true of all of them.
//
// Measured over the 2,950 restricted courses: 25,184 rendered lines → 16,273, a
// 35.4% cut, and 23,318 printed values → 13,888. 393 courses shrink (8,956
// lines); 28 grow, by 42 lines in total, worst case three (measured before the
// `must:` tier rule below, which moves three more lines).
// It is not merely shorter — it is more informative, because
// per-code coverage is what the old grouping was destroying: ACCT 1209's twelve
// most-affected majors turn out to be excluded from EVERY section in every term
// read, which the eleven overlapping sets could not show.
//
// ── WHAT IS AND IS NOT LOST ────────────────────────────────────────
//
// 1. It does not keep only the newest term. MEIE 4701 is Industrial-only in
//    Fall and Mechanical-only in Summer B; showing one hides the other, and the
//    hidden one is exactly what an IE student needs.
// 2. `not:` decomposes LOSSLESSLY. A section's exclusion list is a conjunction
//    — it bars A and B and C independently — so per-code counts are exact.
// 3. `info:` likewise: each approval is a separate thing to obtain.
// 4. `must:` is a DISJUNCTION at the section level ("one of the following"), so
//    per-code decomposition keeps the number that matters to a reader (sections
//    that would admit them) and drops the co-occurrence — which codes were
//    listed together on one section. That is the one fact this loses, and it is
//    unactionable: a student is in exactly one of the codes, and knowing which
//    other majors shared the line with them changes nothing they can do.
//    The objection this replaces was ARCH 5115 — three program groups in one
//    term, where unioning them would "never tell a BS-ARCH student that exactly
//    ONE section is open to them". Per-code says `BS-ARCH · 1 of 5` outright,
//    so it answers that objection rather than dodging it.
//    What co-occurrence DOES still decide is the tier — see `restrictionSections`.
//
// ── COVERAGE IS PER SEASON, AND IS A FRACTION ──────────────────────
//
// 24.6% of kind-observations (207 of 842) apply to only SOME of a term's
// sections. That is a different fact from a gate: departments reserve sections
// for first-years so they can get fundamentals, and ACCT 1201 restricts majors
// on 1 of its 2 sections while the other stays open to anyone. So the share is
// carried through to the renderer, pooled per season across that season's
// years — see `seasonCoverage` for why the season is the unit and why it is a
// fraction rather than a percentage.
//
// No claim is made about terms we did not read. `everyTerm` means "identical in
// every term we HAVE data for" and nothing more.
// ═══════════════════════════════════════════════════════════════════

/**
 * Declared, not alphabetical, so a course reads the same way every time and the
 * kinds a student can act on come first. An unrecognised kind sorts last but is
 * still SHOWN — silently dropping a restriction is the one unacceptable outcome.
 */
export const KIND_ORDER = Object.freeze([
  "must:Classes", "must:Majors", "must:Programs", "must:Concentrations",
  "must:Degrees", "must:Colleges", "must:Departments", "must:Campuses",
  "must:Attributes", "info:Special Approvals",
]);

const kindRank = (key) => {
  const i = KIND_ORDER.indexOf(key);
  return i === -1 ? KIND_ORDER.length : i;
};

const SEASON_SORT = ["fall", "spring", "sumA", "sumB"];

/**
 * Pool a group's per-term observations into one figure per SEASON.
 *
 * ── Why the season is the unit ──────────────────────────────────────
 *
 * A student registers for one semester, and seasons genuinely differ — MEIE
 * 4701 is Industrial-only in Fall and Mechanical-only in Summer B. So a share
 * pooled over ALL terms would average two different policies into one
 * meaningless number.
 *
 * Pooling across the YEARS of a season is what makes the share readable: one
 * term is a denominator of 2 or 21 depending on the course, and reading a rate
 * off a single observation is how "1 of 2" becomes "50% of sections" in
 * someone's head. Three Falls is a denominator worth quoting.
 *
 * Reported as a FRACTION, never a percentage. At these sample sizes a percent
 * sign is false precision: "1 of 2 sections" is exactly what we know, and
 * "50%" invites the reader to treat it as a rate.
 *
 * @param {Array<{term: string, season: string|null, sections: number, of: number|null}>} where
 * @returns {Array<{season: string|null, terms: number, sections: number, of: number|null,
 *                  everySection: boolean, latestTerm: string}>}
 */
export function seasonCoverage(where) {
  const bySeason = new Map();
  for (const w of where ?? []) {
    const s = w.season ?? null;
    if (!bySeason.has(s)) {
      bySeason.set(s, { season: s, terms: 0, sections: 0, of: 0, ofKnown: true,
                       latestTerm: "", termCodes: [] });
    }
    const slot = bySeason.get(s);
    slot.terms += 1;
    slot.sections += w.sections;
    if (Number.isFinite(w.of)) slot.of += w.of; else slot.ofKnown = false;
    if (String(w.term) > slot.latestTerm) slot.latestTerm = String(w.term);
    // Every term this season pooled, so the display can NAME the years rather
    // than count them. `terms` stays a count — it is what callers test to
    // decide whether a season is a pattern or a single observation — and the
    // codes are additional, because changing the type of a field this many
    // consumers read is a breaking change for no gain.
    slot.termCodes.push(String(w.term));
  }
  return [...bySeason.values()]
    .map(({ ofKnown, ...s }) => ({
      ...s,
      of: ofKnown ? s.of : null,
      // Newest first, matching the order the terms themselves are listed in.
      termCodes: [...new Set(s.termCodes)].sort().reverse(),
      // "Every section" is the gate case and needs no fraction. Anything less
      // is the reserved case and must show one.
      everySection: ofKnown && s.of > 0 && s.sections >= s.of,
    }))
    .sort((a, b) => {
      const ai = SEASON_SORT.indexOf(a.season), bi = SEASON_SORT.indexOf(b.season);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
}

/**
 * A group's identity is its COVERAGE, not its codes: which seasons, how many
 * sections of how many, and in which terms. Two codes share a row only when all
 * three agree, so the row's single fraction is true of every code on it.
 *
 * The term codes are part of the key on purpose. They are shown (as the tooltip
 * naming a season's years), so a row whose codes were observed in different
 * years would print one set of years for all of them.
 */
const coverageId = (seasons) => seasons
  .map(s => `${s.season} ${s.sections}/${s.of} ${s.termCodes.join(",")}`)
  .join("");

/**
 * Invert `terms → kinds → sections' code-sets` into `kinds → values → where`.
 *
 * `kinds[].seasons` is the KIND's own coverage — how many sections carry this
 * restriction at all, as against how many the term has. That is a different
 * number from any one value's and it is what decides a `must:` kind's tier;
 * see `restrictionSections`.
 *
 * @param {Array<{term: string, season: string|null, sections: number|null,
 *                kinds: Record<string, Array<[string[], number]>>}>} terms
 *   The per-course array from restrictions.json.
 * @returns {{
 *   termCount: number,
 *   kinds: Array<{
 *     key: string, kind: string, polarity: string,
 *     variesBySection: boolean,
 *     seasons: Array<object>,
 *     groups: Array<{
 *       codes: string[],
 *       everyTerm: boolean,
 *       where: Array<{term: string, season: string|null, sections: number, of: number|null}>,
 *     }>,
 *   }>,
 * }}
 */
export function groupRestrictions(terms) {
  const list = Array.isArray(terms) ? terms.filter(t => t && t.kinds) : [];
  if (!list.length) return { termCount: 0, kinds: [] };

  // key → { codeWhere: code → where[], kindWhere: where[], terms: Set, varies }
  const byKind = new Map();

  for (const t of list) {
    for (const [key, groups] of Object.entries(t.kinds ?? {})) {
      if (!Array.isArray(groups) || !groups.length) continue;

      // Validate FIRST. `variesBySection` and the kind's very existence are
      // both decided on surviving groups: a kind whose only group is malformed
      // must not appear at all (an empty restriction implies one exists and is
      // unnamed, which is worse than absent), and a discarded group must not
      // make an otherwise-uniform kind look like it varies.
      const valid = [];
      for (const g of groups) {
        const codes = Array.isArray(g?.[0]) ? g[0].filter(Boolean) : [];
        const n = Number(g?.[1]);
        if (!codes.length || !Number.isFinite(n) || n <= 0) continue;
        valid.push([codes, n]);
      }
      if (!valid.length) continue;

      if (!byKind.has(key)) {
        byKind.set(key, { codeWhere: new Map(), kindWhere: [],
                          terms: new Set(), varies: false, overflow: false });
      }
      const slot = byKind.get(key);
      // A kind whose sections disagree in ANY single term is flagged, because
      // the caller must then show counts rather than a bare list.
      if (valid.length > 1) slot.varies = true;
      slot.terms.add(t.term);

      const of = Number.isFinite(t.sections) ? t.sections : null;
      // A count above the term's section total would draw a bar past full, so
      // it is clamped — same reason `seasonCoverage` reports a fraction and not
      // a rate.
      const cap = (n) => (of === null ? n : Math.min(n, of));

      // The kind's own coverage is a SUM over its groups, which is exact only
      // because the groups partition the sections carrying the kind (one
      // code-set per section per kind). Measured on the live file: 0 of 11,775
      // observations exceed the term's section count, and 9,107 hit it exactly.
      // If one ever did, the partition is broken and the sum is no longer a
      // measurement — so the kind's coverage is withheld rather than clamped,
      // and `isGateRow` degrades to the per-value test. Clamping instead would
      // manufacture a gate, i.e. tell a student they cannot take the course.
      const carried = valid.reduce((s, [, n]) => s + n, 0);
      if (of !== null && carried > of) slot.overflow = true;

      // ── Per VALUE: how many of this term's sections name it ──────
      // Summed across the groups containing it, because the groups partition
      // the sections carrying this kind (a section has one code-set per kind).
      const tally = new Map();
      for (const [codes, n] of valid) {
        for (const c of codes) tally.set(c, (tally.get(c) ?? 0) + n);
      }
      for (const [c, n] of tally) {
        if (!slot.codeWhere.has(c)) slot.codeWhere.set(c, []);
        slot.codeWhere.get(c).push({
          term: t.term, season: t.season ?? null, sections: cap(n), of,
        });
      }

      // ── Per KIND: how many sections carry this restriction at all ──
      slot.kindWhere.push({
        term: t.term, season: t.season ?? null, sections: cap(carried), of,
      });
    }
  }

  const kinds = [...byKind.entries()].map(([key, slot]) => {
    const seen = slot.terms.size;

    // Codes sharing a coverage signature share a row.
    const bySig = new Map();
    for (const [code, where] of slot.codeWhere) {
      const seasons = seasonCoverage(where);
      const id = coverageId(seasons);
      if (!bySig.has(id)) bySig.set(id, { codes: [], where, seasons });
      bySig.get(id).codes.push(code);
    }

    const groups = [...bySig.values()]
      .map(g => ({
        // Alphabetical, so a merged row does not depend on which code the
        // registrar happened to list first in whichever term came first.
        codes: [...g.codes].sort(),
        // Present in every term this KIND was seen in — not every term of the
        // course, because a term where the kind is absent is a different fact
        // from one where it differs.
        everyTerm: seen > 1 && new Set(g.where.map(w => w.term)).size === seen,
        // Newest first, matching how the terms themselves are ordered. One
        // representative code's observations, which is everything anything
        // reads off it: the signature makes the row's codes share their terms
        // and their per-season totals, so `everyTerm` and the seasons are the
        // same for all of them. It does NOT make the per-TERM split identical
        // (2+1 and 1+2 pool alike), so do not start rendering `where` per term
        // without giving the signature that detail too.
        where: [...g.where].sort((a, b) => String(b.term).localeCompare(String(a.term))),
        // Coverage aggregated PER SEASON, pooled across the years of that
        // season. See the header: a student registers for one semester, seasons
        // genuinely differ, and one term is too small a denominator to read a
        // share off — three Falls is not.
        seasons: g.seasons,
        // Total sections this row touches, across every term — for `must:` the
        // ones its values may register for, for `not:` the ones they are shut
        // out of. Either way it is the widest row, which is the one most
        // students are affected by, so it leads. Sorting by the number of TERMS
        // instead put ARCH 5115's one-section group ahead of its two-section one.
        _weight: g.where.reduce((s, w) => s + w.sections, 0),
      }))
      .sort((a, b) => b._weight - a._weight
                   || b.where.length - a.where.length
                   || b.codes.length - a.codes.length
                   || a.codes[0].localeCompare(b.codes[0]))
      .map(({ _weight, ...g }) => g);
    return {
      key,
      polarity: key.slice(0, key.indexOf(":")),
      kind:     key.slice(key.indexOf(":") + 1),
      variesBySection: slot.varies,
      seasons: slot.overflow ? [] : seasonCoverage(slot.kindWhere),
      groups,
    };
  }).sort((a, b) => kindRank(a.key) - kindRank(b.key) || a.key.localeCompare(b.key));

  return { termCount: new Set(list.map(t => t.term)).size, kinds };
}

/**
 * Is this group a GATE — carried by every section, in every season we read?
 *
 * `seasons` is empty only for a group we could not date, and an undated group
 * cannot claim to cover everything, so the empty case is deliberately false.
 */
export const isGate = (g) =>
  (g?.seasons?.length ?? 0) > 0 && g.seasons.every(s => s.everySection);

/**
 * Which tier one row belongs to, and the answer depends on the POLARITY.
 *
 * ── `not:` and `info:` are decided per VALUE ───────────────────────
 *
 * An exclusion list is a conjunction, so "excluded from every section, every
 * season" is a fact about that one value and about nothing else. A code barred
 * everywhere is a gate; a code barred on four of five Fall sections is a
 * reservation, and putting them on the same side would hide the difference that
 * matters most.
 *
 * ── `must:` is decided per KIND ────────────────────────────────────
 *
 * "Must be enrolled in one of the following" is a disjunction over the whole
 * set, so the gate is the SET's property: if every section carries the
 * restriction, then anyone outside the union cannot register at all, and that
 * is true no matter which of the listed values a reader happens to be.
 *
 * Deciding it per value instead was built first and split a disjunction across
 * two headings, which reads as a contradiction: ARTG 5000's `must:Majors` put
 * Art Education under "Only open to" (it appears on all 9 Fall sections and in
 * no Spring at all) and the other eighteen majors under "Some sections are only
 * open to". A student read "only open to Art Education" and that is false —
 * they are one of nineteen. The row's own fraction still says how many sections
 * would take THEM, which is the number they act on.
 *
 * A hand-built kind with no `seasons` falls back to the per-value test, so a
 * caller that does not compute kind coverage still gets a sane tier.
 */
const isGateRow = (kind, group) =>
  (kind?.polarity === "must" && (kind?.seasons?.length ?? 0) > 0)
    ? isGate(kind)
    : isGate(group);

/**
 * The order the six sections are read in. A gate before a reservation, because
 * a gate can close the course and a reservation only shrinks the menu; and
 * within each, "who may" before "who may not" before "what else is needed".
 */
const SECTION_ORDER = Object.freeze([
  ["gate", "must"], ["gate", "not"], ["gate", "info"],
  ["some", "must"], ["some", "not"], ["some", "info"],
]);

/**
 * The panel's whole model: the kinds folded into at most six labelled sections.
 *
 * ── Why SIX sections and not one list ──────────────────────────────
 *
 * A restriction has two independent properties and the reader has to know both
 * before a single value means anything:
 *
 *   COVERAGE — every section, or only some? A gate can close the course; a
 *     reservation only shrinks the menu, and the student needs one section
 *     that fits rather than all of them.
 *   POLARITY — may enrol, may not enrol, or must also obtain?
 *
 * Printed as one flat list, both properties have to be carried per row, which
 * is what the registrar's sentence was doing — "Must be enrolled in one of the
 * following Classes:" repeated once per kind, three lines per rule, with the
 * one word that differs buried at the end. Sorting the rows by the pair
 * instead states each property ONCE, as a heading, and leaves a row with
 * nothing to carry but its value.
 *
 * The measurement is what makes this a compression rather than a rearrangement.
 * Over the 2,950 courses with restrictions:
 *   · 2,210 (75%) need exactly ONE of the six headings; 584 need two, and 4 is
 *     the most any course reaches five of;
 *   · 2,775 of 3,882 headings (71%) hold exactly one KIND, so the kind noun is
 *     redundant there and is dropped — hence `showKind`, the one thing here
 *     that is conditional;
 *   · 1,734 courses (59%) come out at three lines or fewer, against a floor of
 *     five for the shape this replaces;
 *   · 2,533 (86%) carry at least one gate, which is why the gate tier is never
 *     the thing a long block defers.
 *
 * Nothing is hidden: every kind and value still appears exactly once, and
 * `restriction-view.test.js` asserts that as a partition. Values are MERGED
 * into a row only when their coverage is identical — see `coverageId`.
 *
 * @param {Array} kinds  `groupRestrictions(...).kinds`
 * @returns {Array<{tier: string, polarity: string, showKind: boolean, rows: Array<{
 *            key: string, kind: string, codes: string[], seasons: Array }>}>}
 */
export function restrictionSections(kinds) {
  const out = [];

  for (const [tier, polarity] of SECTION_ORDER) {
    const want = tier === "gate";
    const picked = (kinds ?? []).filter(Boolean).filter(k => k.polarity === polarity);
    const rows = [];
    for (const k of picked) {
      for (const g of k.groups ?? []) {
        // A malformed group is skipped, never rendered as a heading with an
        // empty row under it: an unnamed restriction implies one exists and we
        // will not say what it is, which is worse than not mentioning it.
        if (!g || !Array.isArray(g.codes) || !g.codes.length) continue;
        if (isGateRow(k, g) !== want) continue;
        rows.push({
          key: k.key, kind: k.kind, codes: g.codes, seasons: g.seasons ?? [],
        });
      }
    }
    if (!rows.length) continue;
    out.push({ tier, polarity, rows });
  }

  // ── The kind noun is a DISAMBIGUATOR, and the decision is BLOCK-WIDE ──
  //
  // With one kind in the whole block every row is on the same axis and the
  // noun says nothing the heading has not; with two it is the only thing
  // telling a reader that "Mechanical Engineering" is a department on one row
  // and a major on the next, or that "Toronto, Canada" is a campus rather than
  // a programme. So it is shown exactly when it discriminates — 72% of
  // headings hold one kind, but the question is not per heading.
  //
  // Deciding it per SECTION was built first and was wrong for a reason the
  // panel's own history already recorded: two layouts in one block put the
  // label-less section's values at a shallower indent than the labelled one's,
  // so "Advisor's Signature" and "Honors Student" began at different depths
  // under the same box. One grid for the block, or no grid at all.
  const showKind = new Set(out.flatMap(s => s.rows.map(r => r.key))).size > 1;
  for (const s of out) s.showKind = showKind;
  return out;
}

/**
 * Codes → the strings to actually show, deduplicated and disambiguated.
 *
 * ── Why this is not just a label lookup ────────────────────────────
 *
 * Banner's labels are not unique across codes. Measured on real groups:
 *
 *   ARCH 3170  BS-ARCH, BS-ARCS, MARCH-ARCH3  →  "Architecture ·
 *              Architectural Studies · Architecture"
 *   ARTG 5120  MS-EXPD, MFA-EXPD, MS-IDDV, MFA-IDDV  →  "Experience Design ·
 *              Experience Design · Info Dsgn & Data Visualization · Info
 *              Design and Visualization"
 *
 * Printed raw that reads as a bug — the same programme listed twice — when it
 * is really two different programmes the registrar happens to name alike. So:
 *
 *   · a label repeated for DIFFERENT codes gets its code appended, which is
 *     the only thing that distinguishes them;
 *   · a label repeated for the SAME code (possible once a group spans terms)
 *     collapses to one entry;
 *   · a code with no label at all shows the code, with the guillemets that
 *     mark a codeless value stripped.
 *
 * @param {string[]} codes
 * @param {Record<string,string>} labels  the course's shared label map
 * @param {string} key                    the kind key, e.g. "must:Majors"
 * @returns {string[]}
 */
export function displayValues(codes, labels, key) {
  // `?? {}` rather than a default parameter: a default only fires for
  // `undefined`, and a caller passing an explicit `null` label map — which a
  // course with no labels legitimately does — would then throw on lookup.
  const map = labels ?? {};
  const k   = key ?? "";
  const list = (codes ?? []).filter(Boolean);
  const labelOf = (c) => map[`${k}|${c}`] ?? String(c).replace(/^«|»$/g, "");

  // How many DISTINCT codes share each label.
  const owners = new Map();
  for (const c of list) {
    const l = labelOf(c);
    if (!owners.has(l)) owners.set(l, new Set());
    owners.get(l).add(c);
  }

  const out = [];
  const seen = new Set();
  for (const c of list) {
    if (seen.has(c)) continue;      // same code twice — one entry
    seen.add(c);
    const l = labelOf(c);
    out.push(owners.get(l).size > 1 && l !== c ? `${l} (${c})` : l);
  }
  return out;
}

