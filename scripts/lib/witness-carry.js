/**
 * witness-carry.js — keep a shared section's witness across an edition roll.
 *
 * ── The problem this exists for ──────────────────────────────────────
 *
 * `src/engine/demand.js` decides whether a `shared: true` section is a genuine
 * cross-count (emit its courses — nothing else names them) or an alternative
 * track (emit nothing — scheduling it would force a thesis on every master's
 * student). Shape cannot tell those apart; the department's own Sample Plan of
 * Study can, because an alternative track is a branch the plan did not take.
 *
 * On 2026-09-01 NEU published the 2026-2027 edition with the sample plans
 * REMOVED — no `planofstudy` pane, no `sc_plangrid`, not even the phrase, on any
 * of 768 cached pages or the live ones. `witnessedSharedNodes` returns [] the
 * moment the witness is empty, so every shared section silently reverted to the
 * pre-witness behaviour: measured over the 2027 undergraduate scrape, 22 sections
 * across 19 programs lost 43 requirement nodes — 159 SH — into anonymous General
 * Electives. Mathematics and Physics BS's `Integrative Courses` (MATH 4545,
 * PHYS 3601), the example demand.js itself cites, was among them.
 *
 * ── Why inheriting is sound, and where it stops ──────────────────────
 *
 * The witness only ever answers one question: "did the department schedule this
 * course on a real path through the degree?" That is a fact about the program,
 * and it does not stop being true because the registrar stopped reprinting it.
 *
 * Three things bound the risk, and they are what make this safe rather than
 * merely convenient:
 *
 *  1. The witness never ADDS a requirement. `witnessedSharedNodes` emits a node
 *     only if the CURRENT edition still states it as a conjunctive child of a
 *     full-conjunction section, and only if nothing else in the CURRENT parse
 *     names it. A stale witness can therefore confirm, never invent.
 *  2. It is only consulted where the page publishes nothing of its own. A
 *     program that still ships a plan is untouched.
 *  3. The population it recovers was MEASURED to be the right one: of the 83
 *     shared sections nothing else named, the witness emitted 29 and every one
 *     was a genuine cross-count, skipping 54 that were all alternative tracks.
 *     An alternative track's courses are absent from the plan by construction,
 *     so inheriting cannot resurrect one.
 *
 * ⚠ `planOfStudyCourses` stays HONEST — empty when the page publishes no plan.
 * Backfilling it would be a lie about this edition, and `verify-majors` reads it
 * to decide `no-sample-plan`, which must go on reporting the truth that NEU
 * stopped publishing. The inherited copy lives in its own field, stamped with
 * the edition it came from, so a reader can always tell measured from carried.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/** How far back to look. One edition is the normal case; two covers a program
 *  that skipped a year, which the archive shows really happens (2025-2026 is
 *  missing from NEU's own archive). Beyond that the curriculum has usually
 *  moved enough that a witness is no longer evidence about the same degree. */
const MAX_LOOKBACK = 2;

/**
 * Give `record` an inherited witness when this edition published none.
 *
 * @param {object} record  a program record, mutated in place
 * @param {object} opts
 * @param {string} opts.outRoot  the tree root, e.g. data/…/programs/undergraduate
 * @param {string} opts.college  college directory the record is written under
 * @param {string} opts.slug     program folder
 * @param {number} opts.year     the edition being written
 * @returns {number|null} the edition inherited from, or null
 */
export function inheritWitness(record, { outRoot, college, slug, year }) {
  const meta = record?.metadata;
  if (!meta) return null;
  // The page published its own — nothing to carry, and nothing to explain.
  if (meta.planOfStudyCourses?.length) return null;
  if (!existsSync(outRoot)) return null;

  const priors = readdirSync(outRoot)
    .filter(n => /^\d{4}$/.test(n) && Number(n) < year)
    .map(Number)
    .sort((a, b) => b - a)
    .filter(y => y >= year - MAX_LOOKBACK);

  for (const prior of priors) {
    const f = join(outRoot, String(prior), college, slug, 'requirements.json');
    if (!existsSync(f)) continue;
    let prev;
    try { prev = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
    const courses = prev?.metadata?.planOfStudyCourses;
    if (!Array.isArray(courses) || !courses.length) continue;
    meta.witnessCourses = [...courses];
    meta.witnessEdition = prior;
    return prior;
  }
  return null;
}
