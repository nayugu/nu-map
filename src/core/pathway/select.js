// ═══════════════════════════════════════════════════════════════════
// PATHWAY SELECTION — which pathways are open to this student?
//
// Pure and separate from the adapter on purpose. The adapter's only job is to
// LOAD pathway files (which needs Vite's import.meta.glob in the browser and
// plain fs in Node); the decision about who is eligible is logic, belongs in
// core, and is testable without either.
//
// ── Eligibility is (program × concentration) ──────────────────────
//
// A program id alone is not enough. ECE admits BS Physics students to its MS in
// Electrical and Computer Engineering **for the Microsystems, Materials and
// Devices concentration only**; the same BS is not eligible for the other six.
// So an eligibility entry may carry `requiresMsConcentration`, and a pathway
// that is open to a student for one concentration is closed for another.
//
// ── Undergraduate only ────────────────────────────────────────────
//
// Sharing happens while the student is in undergraduate status — that is the
// entire mechanism. A graduate plan gets nothing, and this is enforced here
// rather than in the UI so that MCP and any future caller inherit it.
// ═══════════════════════════════════════════════════════════════════

/**
 * The college segment of a program id.
 *
 * Ids are "<year>/<college>/<folder>" for undergraduate programs and
 * "grad/<year>/<college>/<folder>" for graduate ones, so the college is free —
 * no lookup, no extra data passed around.
 */
export function collegeOf(programId) {
  const parts = String(programId ?? "").split("/");
  const i = parts.findIndex(s => /^\d{4}$/.test(s));
  return i >= 0 ? (parts[i + 1] ?? null) : null;
}

/**
 * Does one eligibility entry admit this program?
 *
 * Eligibility is stated by colleges in three shapes, and modelling only the
 * first was badly wrong. Khoury MSCS says "students pursuing a Khoury College
 * undergraduate degree program, in BOTH CORE AND COMBINED MAJORS, are eligible…
 * regardless of their home college affiliation". Listing one program id caught
 * 1 of the 42 programs whose name contains "Computer Science", and 1 of the 66
 * in the college.
 *
 *   { ugProgram: "<id>" }        exactly this program
 *   { college: "engineering" }   any undergraduate program of that college
 *   { nameIncludes: "Computer Science" }
 *                                any program whose LABEL contains that phrase —
 *                                which is how "and all combined majors" works,
 *                                since NEU names a combined major after both of
 *                                its halves ("Computer Science and Biology, BS")
 *
 * `nameIncludes` deliberately matches across colleges: a combined major can be
 * housed anywhere, and Khoury says so explicitly.
 *
 * @param {{id: string, label?: string}} program
 * @param {object} entry
 */
export function matchesEligibility(program, entry) {
  if (!program?.id || !entry) return false;
  if (entry.ugProgram) return entry.ugProgram === program.id;
  if (entry.college && collegeOf(program.id) !== entry.college) return false;
  if (entry.nameIncludes) {
    const label = String(program.label ?? "").toLowerCase();
    const wanted = [entry.nameIncludes].flat().map(s => String(s).toLowerCase());
    if (!wanted.some(w => label.includes(w))) return false;
  }
  // An entry with neither a college nor a name is a wildcard ("all majors",
  // which CPS and Bouvé both publish). Honoured rather than treated as a
  // mistake, but the verifier requires it to be written deliberately.
  return Boolean(entry.college || entry.nameIncludes || entry.anyMajor);
}

/**
 * Is this pathway open to any of the student's declared programs?
 *
 * Separate from `selectPathways` on purpose: the UI shows EVERY pathway and uses
 * this only to decide whether to warn. Eligibility is a fact about the published
 * page, not a permission we grant — a student may know something we do not
 * (an advisor's approval, a page we have not re-read), and blocking them on our
 * transcription would be the planner overruling the university.
 *
 * @param {object} pathway
 * @param {{id: string, label?: string}[]} programs
 * @param {string} [msConcentration]
 */
export function isEligibleFor(pathway, programs = [], msConcentration = null) {
  const list = programs.filter(Boolean);
  if (!list.length) return false;
  return (pathway?.eligibility ?? []).some(e => {
    // A concentration-scoped entry only opens when that concentration is in
    // play. Undecided still offers it: hiding a pathway the student could reach
    // by choosing a concentration is worse than showing one they must narrow.
    if (e.requiresMsConcentration && msConcentration &&
        e.requiresMsConcentration !== msConcentration) return false;
    return list.some(p => matchesEligibility(p, e));
  });
}

/**
 * Pathways to OFFER a student.
 *
 * Every pathway, for an undergraduate plan. Not a filter by eligibility — see
 * `isEligibleFor`. The only gate is degree level, because sharing happens while
 * in undergraduate status and that is the entire mechanism.
 *
 * This used to filter by eligibility, which was wrong twice over: our
 * eligibility data was far too narrow (see matchesEligibility), so real students
 * were shown nothing; and gating a selection on our own transcription of a
 * marketing page contradicts the project's rule of flagging rather than
 * blocking. The student decides; we warn.
 *
 * @param {import("../../ports/IAcceleratedPathway.js").Pathway[]} pathways
 * @param {Object} q
 * @param {string} [q.studentType] "undergrad" | "graduate"
 * @returns {import("../../ports/IAcceleratedPathway.js").Pathway[]}
 */
export function selectPathways(pathways = [], q = {}) {
  if (q.studentType === "graduate") return [];
  return [...pathways];
}

/**
 * Which of a pathway's master's programs matches a campus preference.
 *
 * Khoury's CS pathways list four campuses and we hold a separate requirement
 * file for each, so "the MS program" is a choice rather than a constant. Falls
 * back to the first listed — the pathway author orders them, and for every
 * Khoury pathway that is Boston.
 *
 * @param {import("../../ports/IAcceleratedPathway.js").Pathway} pathway
 * @param {string} [campus]  e.g. "Oakland"; matched case-insensitively against
 *                           the id, which encodes campus as "…_(oakland)"
 * @returns {string|null}
 */
export function msProgramFor(pathway, campus) {
  const list = pathway?.msPrograms ?? [];
  if (!list.length) return null;
  if (!campus) return list[0];
  const want = String(campus).toLowerCase().replace(/\s+/g, "_");
  return list.find(id => id.toLowerCase().includes(`(${want})`)) ?? list[0];
}

/**
 * Does this pathway still look current enough to present without a caveat?
 *
 * Pathway data is curated from marketing pages and PDFs — one source we found
 * had already gone dead and another was reachable only on a staging host — so
 * "when was this last checked" is part of the answer, not metadata. The UI shows
 * the date either way; this only decides whether to mark it stale.
 *
 * @param {import("../../ports/IAcceleratedPathway.js").Pathway} pathway
 * @param {Date|number} [now]
 * @param {number} [maxAgeDays] default 400 — a little over a year, so a pathway
 *        verified each summer does not flip to stale in the middle of the year
 *        it describes.
 */
export function isStale(pathway, now = Date.now(), maxAgeDays = 400) {
  const at = pathway?.source?.retrievedAt;
  if (!at) return true;                       // undated is stale by definition
  const then = Date.parse(at);
  if (!Number.isFinite(then)) return true;
  const days = (Number(now) - then) / 86_400_000;
  return days > maxAgeDays;
}
