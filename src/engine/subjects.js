// ═══════════════════════════════════════════════════════════════════
// CHART · SUBJECTS — which subjects a program is actually about
//
// Placement needs to tell a major course from a breadth requirement, and neither
// the catalog nor the requirement tree says which is which. What it does say is
// what the program NAMES: a degree that names eleven CS courses and nine MATH
// courses is about CS and MATH, and the two ENGW courses it also names are a
// writing requirement rather than a third major.
// ═══════════════════════════════════════════════════════════════════

/**
 * The subject a cell is about.
 *
 * For a decided or chosen cell, the subject its options agree on — a cell offering
 * `CS 4300 or CS 4100` is a CS cell, one offering `DS 1300 or PHIL 1300` is neither.
 * For an open cell, the modal subject of its candidates, so a `MATH 3001–4999` pool
 * is about MATH whichever course fills it.
 *
 * Null when a cell admits anything, which is correct rather than a gap: a general
 * elective is about no subject, and inventing one for it would make it score as
 * major depth and get scheduled like it.
 */
export function cellSubject(plan, courseMap) {
  const cell = plan.cell ?? plan;
  if (cell.groups?.length) {
    const subs = new Set(cell.groups.flat().map(id => courseMap[id]?.subject).filter(Boolean));
    return subs.size === 1 ? [...subs][0] : null;
  }
  const cands = plan.candidates;
  if (!cands?.length) return null;
  const counts = new Map();
  for (const id of cands) {
    const s = courseMap[id]?.subject;
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  if (!counts.size) return null;
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  // A pool spread across many subjects is not "about" the largest of them.
  return top[1] / cands.length >= 0.5 ? top[0] : null;
}

/** A subject has to carry at least this many of a program's cells to be a major. */
export const MAJOR_SUBJECT_MIN_CELLS = 3;

/**
 * The subjects this program is about.
 *
 * Counted over cells whose subject is decided, because those are the ones the
 * program committed to. The threshold is what separates a major from a service
 * requirement: CS+Math names eleven CS cells and nine MATH cells and exactly two
 * ENGW, so CS and MATH are what the degree is about and writing is something it
 * also requires.
 *
 * The modal subject is always included, so a program small enough to name fewer
 * than three cells in anything still has a major.
 */
export function majorSubjectsOf(plans, courseMap) {
  const counts = new Map();
  for (const p of plans) {
    if (p.cell.kind === "open" && !p.cell.groups) {
      // An open pool counts only if it is clearly one subject's — `Mathematics
      // Electives` is MATH depth, `General Elective` is nobody's.
      const s = cellSubject(p, courseMap);
      if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
      continue;
    }
    const s = cellSubject(p, courseMap);
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const out = new Set();
  for (const [s, n] of counts) if (n >= MAJOR_SUBJECT_MIN_CELLS) out.add(s);
  if (!out.size && counts.size) {
    out.add([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]);
  }
  return out;
}
