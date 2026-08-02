/**
 * nupath.js — the single NUpath vocabulary shared by every data script.
 *
 * scrape-catalog.js and fetch-nupath.js each kept a private copy of this map.
 * They drifted, and both copies carried the same dead entry. Import from here
 * so a fix lands in every path at once.
 *
 * Authority: the Registrar's Tableau NUpath dashboard, whose column names come
 * from the nomenclature key
 * (core.northeastern.edu/wp-content/uploads/2016/03/Nomenclature-Key-Nupath.pdf).
 * NUpath is 11 competencies but 13 *user codes* — competency 9, "Writing
 * Across Audiences and Genres", carries three separate codes:
 *
 *     WF  First Year Writing in the English Department
 *     WD  Advanced Writing in the Disciplines in the English Department
 *     WI  Writing Intensive in the Discipline
 *
 * All 13 are awarded today, but no source spells out all 13:
 *
 *   - The Tableau export has 12 indicator columns — every code except WF. It
 *     records WF by *listing the course with no indicator set*: the only rows
 *     with all-N indicators are the five first-year writing courses. See
 *     inferFirstYearWriting().
 *   - The catalog HTML prints only 11 as Attribute(s) lines; neither WF nor WD
 *     appears there at all. That is why Tableau is authoritative and the
 *     catalog scrape is only a fallback.
 *
 * WF was missing from our data because nothing read that all-N signal, and
 * nothing complained that a known code had gone unclaimed. reportUnmapped()
 * exists so that class of silent hole is loud next time.
 */

/** Every NUpath code, in the Registrar's competency order. */
export const NUPATH_CODES = [
  "ND", "EI", "IC", "FQ", "SI", "AD", "DD", "ER", "WF", "WD", "WI", "EX", "CE",
];

/**
 * The 12 codes the Tableau dashboard publishes as indicator columns — i.e.
 * every code except WF. Used to tell "the export is intact" from "a column
 * vanished", which matters because the WF inference below is only safe in the
 * first case.
 */
export const TABLEAU_COLUMN_CODES = NUPATH_CODES.filter(c => c !== "WF");

/**
 * Normalize a source label before fragment matching: lowercase, strip a
 * trailing "Ind."/"Ind" suffix, and flatten every run of non-alphanumerics to
 * a single space. This is what makes "First-Year Writing", "First Yr Writing"
 * and "1st  Yr. Writing" all reduce to comparable text, so the map below can
 * stay small instead of enumerating every punctuation variant.
 */
export function normalizeLabel(label) {
  return String(label || "")
    .toLowerCase()
    .replace(/\bind\.?\s*$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Normalized label fragments → NUpath code.
 *
 * Covers both the catalog's attribute wording ("NUpath Natural/Designed
 * World") and the Tableau dashboard's column wording ("Natural/Designed World
 * Ind."), which differ enough that we used to keep two maps. Since both sides
 * run through normalizeLabel() first, slash- and hyphen-forms collapse
 * together and one map serves both. Legacy "and" forms are kept for
 * resilience.
 *
 * Fragments are matched as plain substrings of the normalized text, so they
 * must be literal and must themselves be written in normalized form
 * (lowercase, single spaces, no punctuation).
 */
export const NUPATH_MAP = {
  // ND — Natural/Designed World
  "natural designed world":     "ND",
  "natural and designed world": "ND",
  // FQ — Formal/Quant Reasoning
  "formal quant":               "FQ",
  "formal and quantitative":    "FQ",
  // SI — Societies/Institutions
  "societies institutions":     "SI",
  "societies and institutions": "SI",
  // IC — Interpreting Culture
  "interpreting culture":       "IC",
  "intellectual life":          "IC",   // legacy
  // EI — Creative Express/Innov
  "creative express":           "EI",
  "creative expression":        "EI",
  // ER — Ethical Reasoning
  "ethical reasoning":          "ER",
  "ethics and social justice":  "ER",
  // DD — Difference/Diversity
  "difference diversity":       "DD",
  "differences and diversity":  "DD",
  // AD — Analyzing/Using Data  (NOT "advanced writing")
  "analyzing using data":       "AD",
  "analyzing and using data":   "AD",
  // WF — 1st Yr Writing.  No current source emits these, but keep them so a
  // WF column or attribute line is picked up the moment one appears.
  "1st yr writing":             "WF",
  "first yr writing":           "WF",
  "first year writing":         "WF",
  // WD — Adv Writ Dscpl.  "adv writ" covers both "Adv Writ Dscpl" (the
  // catalog's wording) and "Advanced Writing" (the Tableau column).
  "adv writ":                   "WD",
  "advanced writing":           "WD",
  // WI — Writing Intensive
  "writing intensive":          "WI",
  // CE — Capstone Experience
  "capstone experience":        "CE",
  "capstone":                   "CE",
  // EX — Integration/Experiential
  "integration experience":     "EX",
  "experiential learning":      "EX",
};

/**
 * Pull the payload of a course block's "Attribute(s):" line.
 *
 * Callers pass the text of every candidate element in the block (both scrapers
 * use node-html-parser, but this stays DOM-agnostic so the logic is shared
 * rather than duplicated).
 *
 * Both scrapers used to look for an element whose *class* contained "nupath"
 * or "attribute". No such class exists: the catalog renders the line as
 * `<p class="courseblockextra noindent"><strong>Attribute(s): </strong>…</p>`,
 * so the selector matched nothing and the catalog contributed no NUpath at
 * all. Match on the label text instead — it is what the page actually commits
 * to.
 *
 * @param {Iterable<string>} elementTexts
 * @returns {string} text after the label, or "" when the block has no line
 */
export function findAttributeText(elementTexts) {
  for (const raw of elementTexts ?? []) {
    const t = String(raw ?? "").replace(/\u00a0/g, " ").trim();
    const m = t.match(/^attribute\(s\)\s*:\s*(.*)$/is);
    if (m) return m[1].trim();
  }
  return "";
}

/**
 * Extract NUpath codes from a block of catalog attribute text.
 * Returns codes sorted, so diffs stay stable run to run.
 */
export function parseNUPath(text) {
  const lower = normalizeLabel(text);
  const found = [];
  for (const [fragment, code] of Object.entries(NUPATH_MAP)) {
    if (lower.includes(fragment) && !found.includes(code)) found.push(code);
  }
  return found.sort();
}

/**
 * Map one Tableau indicator column name to a NUpath code, or null when the
 * column is not a NUpath indicator we recognise.
 *
 * Returning null is not automatically a bug — the export carries non-indicator
 * columns too — but an unrecognised column ending in "Ind." is, which is what
 * reportUnmapped() checks.
 */
export function indicatorColToCode(colName) {
  const lower = normalizeLabel(colName);
  for (const [frag, code] of Object.entries(NUPATH_MAP)) {
    if (lower.includes(frag)) return code;
  }
  return null;
}

// ── Source capability ─────────────────────────────────────────────────────────
//
// Which codes each source is even able to say a course has. This is the
// difference between "the source says this course lost WD" and "the source
// cannot express WD at all" — and conflating the two silently destroys data.
//
// The catalog scrape is the fallback whenever Tableau is unreachable. Applied
// naively it would blank WF and WD on every course, because it has no way to
// mention them. reconcileNuPath() below is what stops that.
// `authoritative` decides whether the source is trusted to *remove* a code.
// Only the Registrar's dashboard is. The catalog runs solely as a fallback
// when Tableau is unreachable, and a fallback must not be able to degrade the
// data: it may fill gaps, never delete what the authority asserted.
export const SOURCE_POLICY = {
  tableau: {
    // 12 indicator columns + WF inferred from the all-N rows.
    codes: NUPATH_CODES,
    authoritative: true,
  },
  catalog: {
    // Catalog Attribute(s) lines carry 11 codes; WF and WD never appear.
    codes: NUPATH_CODES.filter(c => c !== "WF" && c !== "WD"),
    authoritative: false,
  },
};

/** Policy for a source label like "Tableau CSV (direct)". */
export function policyFor(sourceLabel) {
  return /^tableau/i.test(String(sourceLabel || ""))
    ? SOURCE_POLICY.tableau
    : SOURCE_POLICY.catalog;
}

/**
 * Combine a course's existing codes with a fresh reading from one source.
 *
 * Two rules, both about not mistaking silence for evidence:
 *
 *   - A code the source cannot express is always carried over from `previous`.
 *     The catalog never prints WF or WD, so its not mentioning them says
 *     nothing about whether the course has them.
 *   - A non-authoritative source is additive: it contributes codes it found
 *     but cannot drop ones it didn't. Otherwise a month when Tableau happens
 *     to be unreachable would quietly strip real designations.
 *
 * @param {string[]} previous  codes currently on the course
 * @param {string[]} fresh     codes this source reported
 * @param {{codes: string[], authoritative: boolean}} policy
 */
export function reconcileNuPath(previous = [], fresh = [], policy = SOURCE_POLICY.tableau) {
  const { codes, authoritative } = policy;
  const canSay = new Set(codes);
  const taken  = fresh.filter(c => canSay.has(c));
  const kept   = authoritative
    ? previous.filter(c => !canSay.has(c))  // only what this source can't see
    : previous;                             // fallback: never removes
  return [...new Set([...kept, ...taken])].sort();
}

/** True for a Tableau "Course ID" that is a real course, not a total row. */
const isCourseKey = key => /^[A-Z]{2,6} \d{4}[A-Z]?$/.test(key);

/**
 * Ceiling on how many courses may be inferred as WF.
 *
 * The real set is five. This is not a guess at the true size — it is a
 * blast-radius limit: if the export ever changes shape so that many rows read
 * as all-N, the inference must refuse rather than blanket-grant WF to hundreds
 * of courses.
 */
export const WF_MAX_INFERRED = 25;

/**
 * Derive WF from the Tableau export.
 *
 * The dashboard has no first-year-writing column. What it does instead is list
 * those courses with every indicator set to N — a course appears on the NUpath
 * dashboard *because* it carries a NUpath, so an all-N row is a course whose
 * only attribute is the one with no column. As of the 27-JUL-26 refresh the
 * all-N rows are exactly ENGW 1102, ENGW 1111, ENGW 1114, ENG 1105 and
 * ENG 1107 — the five first-year writing courses.
 *
 * The inference is only sound while the export is intact, so it refuses to run
 * in the two cases where all-N means something else entirely:
 *
 *   - a known indicator column is missing, so its courses read as all-N; or
 *   - more than WF_MAX_INFERRED rows are all-N, which no correct export
 *     produces and which would otherwise mass-assign WF.
 *
 * @param {Map<string,string[]>} rows      course key → codes parsed so far
 * @param {string[]}             seenCodes codes actually detected as columns
 * @returns {{granted: string[], skipped: boolean, reason: string|null}}
 */
export function inferFirstYearWriting(rows, seenCodes) {
  const detected     = new Set(seenCodes);
  const missingCols  = TABLEAU_COLUMN_CODES.filter(c => !detected.has(c));
  const candidates   = [...rows]
    .filter(([key, codes]) => isCourseKey(key) && !codes?.length)
    .map(([key]) => key)
    .sort();

  if (missingCols.length) {
    return {
      granted: [], skipped: true,
      reason: `indicator column(s) missing for ${missingCols.join(", ")} — all-N rows are unreliable`,
    };
  }
  if (candidates.length > WF_MAX_INFERRED) {
    return {
      granted: [], skipped: true,
      reason: `${candidates.length} all-N rows exceeds the ${WF_MAX_INFERRED}-row limit — export shape looks wrong`,
    };
  }
  return { granted: candidates, skipped: false, reason: null };
}

/**
 * Fidelity guard for the Tableau parse — run after inferFirstYearWriting().
 *
 * Reports the silent-failure modes that let WF go missing:
 *
 *   1. An indicator column we don't recognise — the export grew or renamed a
 *      column, and every course carrying that code loses it.
 *   2. A known code that no course claims — a column quietly disappeared.
 *   3. A course row still holding zero codes after inference — unexplained,
 *      since every listed course is on the dashboard for some reason.
 *
 * @param {string[]} headers        every column name in the CSV
 * @param {string[]} mappedHeaders  the subset recognised as indicators
 * @param {Map<string,string[]>} rows  course key → final codes
 * @returns {{unmappedIndicators: string[], zeroCodeRows: string[], absentCodes: string[]}}
 */
export function reportUnmapped(headers, mappedHeaders, rows) {
  const mapped = new Set(mappedHeaders);
  const unmappedIndicators = headers.filter(
    h => /\bind\.?$/i.test(h.trim()) && !mapped.has(h)
  );

  const zeroCodeRows = [];
  const seen = new Set();
  for (const [key, codes] of rows) {
    if (!isCourseKey(key)) continue; // "All" etc. are grand-total rows
    if (!codes?.length) zeroCodeRows.push(key);
    for (const c of codes ?? []) seen.add(c);
  }

  const absentCodes = NUPATH_CODES.filter(c => !seen.has(c));
  return { unmappedIndicators, zeroCodeRows: zeroCodeRows.sort(), absentCodes };
}
