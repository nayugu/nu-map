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
 *
 * ── And then a program gets RENAMED ─────────────────────────────────
 *
 * The lookup below is keyed on `college/slug`, which is the identity a program
 * has in this repository — and a rename is precisely the case where that
 * identity does not survive the roll it is trying to cross. NEU retired every
 * undergraduate Data Science program in the 2027 edition and republished it as
 * Artificial Intelligence: same college, same curriculum, new folder, new URL
 * (`…/data-science-journalism-bs/` → `…/artificial-intelligence-journalism-bs-bos/`),
 * so there is nothing left to key on. Measured on the committed tree: 332 of 651
 * records inherited a witness and the ones that did not were exactly the 26
 * renamed programs, the minors (which never published a plan) and the
 * department pages that are not programs at all.
 *
 * That is not a small silent loss, because of what the witness GATES. A
 * `shared: true` section with an empty witness is not merely unconfirmed — it is
 * SKIPPED (`demand.js`, `shared-section-skipped`), so its requirement leaves the
 * generated plan entirely. Adding a cross-count adjudication for a renamed
 * program without repairing the witness first would therefore delete the very
 * requirement the adjudication exists to de-duplicate. The two changes are one
 * change.
 *
 * `RENAMED` is that repair, and it is a HAND table for the same reason
 * `program-variants.js` and `referenced-menus.js` are: "is this the same degree
 * under a new name" is a judgement, and no parse settles it. The alternative
 * considered and refused was matching a predecessor by course-set similarity,
 * which is a tuned threshold whose failure mode is attaching a stranger's plan
 * to a degree — silently, and in the direction that confirms a cross-count that
 * was never witnessed.
 *
 * `renameOrphans` keeps the table honest. An entry that matches nothing is the
 * failure this whole file's neighbours have already paid for twice: an
 * adjudication keyed on a moved page produces no miss, no log line and no
 * record, because the evidence is an ABSENCE (see `sharedSectionsOrphans`).
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/** How far back to look. One edition is the normal case; two covers a program
 *  that skipped a year, which the archive shows really happens (2025-2026 is
 *  missing from NEU's own archive). Beyond that the curriculum has usually
 *  moved enough that a witness is no longer evidence about the same degree. */
const MAX_LOOKBACK = 2;

/**
 * `edition → { "college/slug this edition": "college/slug before it" }`.
 *
 * Keyed on the edition the rename APPEARED IN, which makes each block
 * self-limiting: once 2027 is committed, a 2028 scrape finds the AI folder
 * under its own name and never consults this table again. Nobody has to prune
 * it, and leaving a block behind costs nothing.
 *
 * ── 2027: Data Science → Artificial Intelligence ───────────────────
 *
 * NEU replaced the whole undergraduate Data Science family. `DS` survives as a
 * SUBJECT (DS 3000 is now "Mathematical Foundations of Artificial
 * Intelligence"), which is what makes these the same degrees renamed rather
 * than new ones: the curricula line up section for section, and the
 * combined-major pages keep their partner discipline.
 *
 * Every pair below is `2027 folder` ← `2026 folder` differing ONLY by that
 * substitution, which is why `renameOrphans` can hold both ends to the tree.
 * Deliberately NOT extended to the roll's other folder moves — a campus suffix
 * appearing (`…_ba` → `…_ba_(boston)`) or a nursing track moving from Boston to
 * Primarily Online are different questions with different answers, and neither
 * has been looked at.
 *
 * ── There is no GRADUATE table, and that is measured, not an omission ──
 *
 * The graduate tree renamed too — `data_science_msalign_*` became
 * `artificial_intelligence_msalign_*`, and two of them changed COLLEGE as well
 * (`computer-information-science` → `university-interdisciplinary-programs`),
 * so a graduate table would need the harder key. It would also have nothing to
 * carry: all three 2026 MSAligns and all four 2027 ones publish
 * `planOfStudyCourses: []` and carry no `shared` section, on either side of the
 * roll. Building the mechanism would move zero courses.
 *
 * That matches what `demand.js` already records — graduate is near-immune,
 * only 2 of its 58 programs with shared sections ever had a witness. If a
 * graduate program ever needs one, `renameOrphans` and `inheritWitness` are
 * already tree-agnostic; the table is the only thing missing, and it should be
 * keyed by tree when it is added rather than reusing this one.
 */
export const RENAMED = {
  2027: Object.fromEntries([
    'artificial_intelligence_bs_(boston)',
    'artificial_intelligence_and_behavioral_neuroscience_bs_(boston)',
    'artificial_intelligence_and_biochemistry_bs_(boston)',
    'artificial_intelligence_and_biology_bs_(boston)',
    'artificial_intelligence_and_business_administration_bs_(boston)',
    'artificial_intelligence_and_chemistry_bs_(boston)',
    'artificial_intelligence_and_communication_studies_bs_(boston)',
    'artificial_intelligence_and_criminal_justice_bs_(boston)',
    'artificial_intelligence_and_design_bs_(boston)',
    'artificial_intelligence_and_ecology_and_evolutionary_biology_bs_(boston)',
    'artificial_intelligence_and_economics_bs_(boston)',
    'artificial_intelligence_and_environmental_and_sustainability_sciences_bs_(boston)',
    'artificial_intelligence_and_health_science_bs_(boston)',
    'artificial_intelligence_and_international_affairs_bs_(boston)',
    'artificial_intelligence_and_journalism_bs_(boston)',
    'artificial_intelligence_and_linguistics_bs_(boston)',
    'artificial_intelligence_and_mathematics_bs_(boston)',
    'artificial_intelligence_and_philosophy_bs_(boston)',
    'artificial_intelligence_and_physics_bs_(boston)',
    'artificial_intelligence_and_psychology_bs_(boston)',
    'artificial_intelligence_and_public_health_bs_(boston)',
    'artificial_intelligence_and_sociology_bs_(boston)',
    'artificial_intelligence_and_speech-language_pathology_and_audiology_bs_(boston)',
    'artificial_intelligence_minor',
  ].map(s => [`computer-information-science/${s}`,
              `computer-information-science/${s.replace('artificial_intelligence', 'data_science')}`])
    .concat([
      // The two combined majors the College of Engineering owns. Same
      // substitution, different college, so they cannot ride the map above.
      ['engineering/chemical_engineering_and_artificial_intelligence_bsche_(boston)',
       'engineering/chemical_engineering_and_data_science_bsche_(boston)'],
      ['engineering/environmental_engineering_and_artificial_intelligence_bsenve_(boston)',
       'engineering/environmental_engineering_and_data_science_bsenve_(boston)'],
    ])),
};

/** Where a program's predecessor lived, when the folder itself moved. */
function predecessorOf(year, college, slug) {
  return RENAMED[year]?.[`${college}/${slug}`] ?? null;
}

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

  // Its own folder first, always. A rename entry is a fallback for the case
  // where that folder does not exist in the earlier edition — never an override,
  // so a stale entry cannot displace a witness the ordinary lookup would find.
  const wasAt = predecessorOf(year, college, slug);
  const candidates = wasAt ? [`${college}/${slug}`, wasAt] : [`${college}/${slug}`];

  for (const prior of priors) {
    for (const where of candidates) {
      const f = join(outRoot, String(prior), where, 'requirements.json');
      if (!existsSync(f)) continue;
      let prev;
      try { prev = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
      const courses = prev?.metadata?.planOfStudyCourses;
      if (!Array.isArray(courses) || !courses.length) continue;
      meta.witnessCourses = [...courses];
      meta.witnessEdition = prior;
      // Only when the folder moved, so the ordinary case stays unannotated and a
      // reader who sees this field knows a judgement was applied.
      if (where !== `${college}/${slug}`) meta.witnessFrom = where;
      return prior;
    }
  }
  return null;
}

/**
 * `RENAMED` entries that describe nothing, either end.
 *
 * Both halves matter and they fail differently. A dead KEY means this edition
 * has no such program — the entry was mistyped, or NEU renamed it again — and
 * the witness it was written for is silently not being carried. A dead VALUE
 * means the predecessor is not on disk, so the entry can never do anything at
 * all. Neither shows up as a miss anywhere else, because in both cases the
 * evidence is an absence.
 *
 * @param {object} opts
 * @param {string} opts.outRoot     the tree root
 * @param {number} opts.year        the edition being written
 * @param {Iterable<string>} opts.present  `college/slug` for every program this run parsed
 * @returns {{deadKeys: string[], deadValues: string[]}}
 */
export function renameOrphans({ outRoot, year, present }) {
  const table = RENAMED[year] ?? {};
  const here = new Set(present);
  const deadKeys = [], deadValues = [];

  for (const [now, before] of Object.entries(table)) {
    if (!here.has(now)) deadKeys.push(now);
    const found = !existsSync(outRoot) ? false : readdirSync(outRoot)
      .filter(n => /^\d{4}$/.test(n) && Number(n) < year && Number(n) >= year - MAX_LOOKBACK)
      .some(p => existsSync(join(outRoot, p, before, 'requirements.json')));
    if (!found) deadValues.push(`${now} ← ${before}`);
  }
  return { deadKeys, deadValues };
}

export const RENAME_ORPHAN_RUNBOOK = `
    A rename entry names a program that is not there. Both directions are silent
    without this check, so decide which one this is:

      · the KEY is dead   → this edition has no such folder. Either the slug is
                            mistyped, or NEU renamed the program AGAIN, in which
                            case re-key the entry to the new folder. Deleting it
                            is only right if the program was retired outright.
      · the VALUE is dead → the predecessor is not on disk for any edition within
                            the lookback. If the earlier edition was pruned, drop
                            the entry; the witness is gone either way and the
                            entry is now claiming otherwise.

    See RENAMED in scripts/lib/witness-carry.js.
`;
