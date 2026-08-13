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
 * Pathways open to a student.
 *
 * @param {import("../../ports/IAcceleratedPathway.js").Pathway[]} pathways
 * @param {Object} q
 * @param {string} [q.ugProgramId]     the plan's major (or second major)
 * @param {string[]} [q.ugProgramIds]  several, when a plan has two majors
 * @param {string} [q.studentType]     "undergrad" | "graduate"
 * @param {string} [q.msConcentration] narrows concentration-scoped eligibility
 * @returns {import("../../ports/IAcceleratedPathway.js").Pathway[]}
 */
export function selectPathways(pathways = [], q = {}) {
  if (q.studentType === "graduate") return [];

  const ids = new Set(
    [q.ugProgramId, ...(q.ugProgramIds ?? [])].filter(Boolean)
  );
  if (!ids.size) return [];

  return pathways.filter(p =>
    (p?.eligibility ?? []).some(e => {
      if (!ids.has(e.ugProgram)) return false;
      // A concentration-scoped entry only opens when that concentration is the
      // one in play. When the caller has not chosen yet we DO offer it, because
      // hiding a pathway the student could reach by choosing a concentration is
      // worse than showing one they must then narrow.
      if (e.requiresMsConcentration && q.msConcentration &&
          e.requiresMsConcentration !== q.msConcentration) return false;
      return true;
    })
  );
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
