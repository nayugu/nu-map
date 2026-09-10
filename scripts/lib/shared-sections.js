// ═══════════════════════════════════════════════════════════════════
// SHARED SECTIONS — the cross-count repairs a scrape cannot re-derive
//
// A requirement section marked `shared: true` is discounted by the allocator: its courses
// count toward the degree without being consumed by it. That is how an integrative
// requirement, a GPA re-list, or one of two alternative tracks stops being charged twice.
//
// ⚠ It is no longer simply SKIPPED by the demand model, as this said until Aug 2026. That
// was true and it was also the bug: for 83 of the 136 shared sections in the corpus nothing
// else names their courses, so skipping deleted the requirement instead of de-duplicating
// it — Mathematics and Physics BS never scheduled the MATH 4545 and PHYS 3601 its own
// integrative requirement demands. `src/engine/demand.js` now emits a shared section's
// conjunctive children when the program's Sample Plan of Study names them, which is what
// separates a real cross-count from the pick-one workaround this file's own footnote below
// describes. The two populations riding on one flag is exactly why that fix needed a
// discriminator; see that file's header for the measurement.
//
// ── Why a committed manifest and not a detector ─────────────────────
//
// `markSharedSections` derives the flag where it CAN: a section satisfiable alone but not
// after single-use allocation is one whose courses an earlier section ate, and that is
// recoverable from the data. It stays, and runs first.
//
// It does not cover everything, and the gap was invisible until a full scrape ran. Of the
// 120 programs carrying the flag in the committed corpus, `markSharedSections` re-derives
// **zero**: Accounting MSA's "Audit Track" and "Taxation Track" allocate perfectly well
// side by side — nothing in the data says a student picks one — so no allocation conflict
// exists to detect. Those flags came from a one-off `migrate-shared-sections.js` run and
// have survived only because no full scrape happened since.
//
// Which means every scrape silently dropped them, and the next scheduled one would have:
// measured, 21 of 1,078 shapes stopped generating, Accounting MSA among them with
// `mostly-unschedulable`. Nothing in `update-majors.yml` generates a plan, so no guard in
// that workflow could have noticed. CLAUDE.md names this exact failure — "data fixes must
// live in the scrape scripts, never in one-off migrations, because the next scheduled
// scrape overwrites anything else" — and this file is that fix.
//
// ── A hand adjudication, like the variant table ─────────────────────
//
// `program-variants.js` already establishes the pattern: where no rule can be derived, the
// call is made by hand, committed, reviewable in a diff, and a mismatch is a hard stop
// rather than a quiet default. This is the same thing for the same reason.
//
// ⚠ This preserves today's shipped behaviour; it does not claim the model is RIGHT. Two
// alternative tracks are really a choice the student makes, and marking one `shared` so it
// vanishes from demand is a workaround for the parser not expressing "pick one". A plan for
// a Taxation student still shows Audit courses. Fixing that means teaching the parser about
// alternative tracks, which is its own piece of work — see `docs/chart-open-defects.md`.
// What this file guarantees is that the workaround stops silently evaporating.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * `"<sourceUrl>#<slug>" → [section title, …]`.
 *
 * ── Why the URL and not the slug ────────────────────────────────────
 *
 * A slug is not unique. Four of them are filed under more than one college — there are two
 * different `psychology_bs_(boston)` programs, one from the Lowell Institute School and one
 * from the College of Science — and a slug-keyed manifest applied the Lowell adjudication to
 * the Science page, which has no "Clinical Track" at all. The rail caught it on the first
 * run and refused to write, which is the only reason this is a paragraph and not a defect.
 *
 * The page URL is the identifier the catalog itself uses, and it is clickable: an entry can
 * be re-checked against the source in one step, which is what re-adjudicating needs.
 *
 * `#<slug>` disambiguates the second axis — one page can be several PROGRAMS (see
 * `program-variants.js`), and a variant carries its parent's URL with a slug of its own.
 *
 * ⚠ This paragraph used to claim that "a URL that changes shape shows up as an unmatched
 * entry rather than a silent miss". That was FALSE, and it is why nobody looked: a key that
 * matches no page never reaches `applySharedSections` at all, so it produced no `missing`
 * titles, no rail, and no log line. Measured on the 2027 graduate roll — NEU retired four of
 * these programs, renamed four more and MERGED two MATs into one, and all ten entries went
 * quietly dead while the scrape reported success. They surfaced days later in a unit test,
 * and only because BOTH trees had by then rolled past `ADJUDICATED_EDITION`.
 *
 * `sharedSectionsOrphans` below closes it: an entry that matched nothing is now the same
 * hard stop as a title that matched nothing, which is what the design always intended.
 */
export const SHARED_SECTIONS = JSON.parse(
  readFileSync(resolve(HERE, 'shared-sections.json'), 'utf8'));

/**
 * The catalog EDITION these titles were read from.
 *
 * ── Why a manifest of titles needs a year on it ─────────────────────
 *
 * The manifest is adjudicated against the LIVE catalog; the corpus in this
 * repository is whatever edition was last scraped. Between rolls they are the
 * same document and the two can be compared exactly — which is what
 * test/unit/shared-sections.test.js does, and it is a genuinely useful check
 * against a hand-added entry naming a section that does not exist.
 *
 * At a roll they are two different documents, and comparing them is comparing
 * a 2027 adjudication against a 2026 corpus. NEU rolled to 2027 on 2026-09-01
 * and renamed four of these sections in the process ("Integrative Course" →
 * "Integrative Requirement Courses", and "outside" → "Outside" in a minor's
 * heading), so the manifest and the corpus now legitimately disagree and no
 * offline test can tell that apart from a typo.
 *
 * Bumping this is what says "these titles describe an edition the corpus has
 * not caught up with yet". The test relaxes to a structural check while that
 * is true and tightens back to exact equality by itself once the scrape lands
 * the new edition — nobody has to remember to re-tighten it.
 *
 * The real guard is unaffected either way: `applySharedSections` reports a
 * title it cannot find, and the scrape rail refuses to write the run. That
 * check runs against the live catalog, which is the only authority here.
 *
 * ── Per TREE, because the two trees roll independently ──────────────
 *
 * This was one number, and one number cannot describe a corpus that is scraped by two
 * workflows on different days. The undergraduate side was re-adjudicated for 2027 and the
 * constant was bumped to 2027 — which silently asserted that the GRADUATE half had been
 * re-adjudicated too. It had not, and there was no way to say so: the graduate tree was
 * still 2026, `rolling` was true for both, and the exact check stayed relaxed. The claim
 * went unexamined until the graduate scrape landed and ten entries turned out to be dead.
 *
 * Split, the state "undergrad re-adjudicated, graduate not yet" is expressible, and the
 * test can hold each tree to its own claim instead of to the more generous of the two.
 */
export const ADJUDICATED_EDITIONS = { undergraduate: 2027, graduate: 2027 };

/**
 * Kept as the newest edition any half has been adjudicated against.
 *
 * Only for callers that legitimately want one number — the `>= committedEdition()` sanity
 * check. Anything comparing against a SPECIFIC tree must read `ADJUDICATED_EDITIONS`, or it
 * is back to holding both trees to whichever claim is loosest.
 */
export const ADJUDICATED_EDITION = Math.max(...Object.values(ADJUDICATED_EDITIONS));

/**
 * Apply the manifest to one freshly-built record.
 *
 * @param {object} data   the record, mutated in place
 * @param {{url: string, slug: string}} id  the page it came from and the program it is
 * @returns {{applied: number, missing: string[]}} `missing` names manifest titles that
 *   matched no section on the page — the signal that the catalog moved under the
 *   adjudication and a human has to look again.
 */
/**
 * Manifest keys this process has actually matched against a page.
 *
 * Module-level because the scrape is one process making one pass, and the question the rail
 * asks — "did every entry for the tree I just scraped find its page?" — cannot be answered
 * from any single record. It is the ABSENCE of a match, and absence has no record to hang on.
 */
const _consumed = new Set();

/** Test seam: forget what this process has matched. Not used by the scrapers. */
export function _resetSharedSectionsSeen() { _consumed.clear(); }

/**
 * Which tree a manifest entry belongs to, decided by the URL the catalog itself uses.
 *
 * Asymmetric on purpose, and not a matter of taste: every GRADUATE program page lives under
 * `/graduate/`, including the CPS master's programs at
 * `/graduate/professional-studies/masters-degree-programs/`. Undergraduate does NOT have one
 * root — it lives at three (`/undergraduate/`, and CPS's
 * `/professional-studies/bachelors-postbaccalaureate/` and
 * `/professional-studies/undergraduate-minors/`; see CLAUDE.md → "An undergraduate program
 * can live at THREE path shapes", each of which was invisible until someone counted what was
 * missing). A fourth would silently orphan its own entries under a whitelist, so undergrad is
 * the COMPLEMENT rather than a list: a new undergraduate path is then covered by default and
 * the failure direction is a false alarm, not a silent miss.
 */
const GRAD_ROOT = 'https://catalog.northeastern.edu/graduate/';
const treeOf = (key) => (key.startsWith(GRAD_ROOT) ? 'graduate' : 'undergraduate');

/**
 * Manifest entries for `tree` that no page in this run claimed.
 *
 * This is the check that was missing. `applySharedSections` reports a TITLE it cannot find,
 * and the rail refuses the run; but an entry whose URL matches no page never reaches it, so
 * the whole class "NEU moved, renamed or retired the page" was silent. Ten of them shipped
 * that way on the 2027 graduate roll.
 *
 * The caller must only ask this of a FULL run. A `--url` single-page scrape legitimately
 * matches almost nothing, and a rail that fires on every such invocation is one people learn
 * to pass `--no-verify` past.
 *
 * @param {'graduate'|'undergraduate'} tree
 * @returns {string[]} keys, sorted, so the message names what a human has to act on
 */
export function sharedSectionsOrphans(tree) {
  return Object.keys(SHARED_SECTIONS)
    .filter(k => treeOf(k) === tree && !_consumed.has(k))
    .sort();
}

export function applySharedSections(data, { url, slug }) {
  const key = `${url}#${slug}`;
  const want = SHARED_SECTIONS[key];
  if (!Array.isArray(want) || !want.length) return { applied: 0, missing: [] };
  // Recorded on MATCH, not on success: an entry whose titles are all missing has still
  // found its page, and that is the case the existing rail already reports. Conflating the
  // two would report one defect as the other.
  _consumed.add(key);

  const sections = Array.isArray(data?.requirementSections) ? data.requirementSections : [];
  const byTitle = new Map(sections.map(s => [s?.title, s]));
  let applied = 0;
  const missing = [];
  for (const title of want) {
    const section = byTitle.get(title);
    // Not found is reported, never invented: adding a section here would be manufacturing a
    // requirement, which is the one thing worse than losing a repair.
    if (!section) { missing.push(title); continue; }
    if (!section.shared) { section.shared = true; applied += 1; }
  }
  return { applied, missing };
}
