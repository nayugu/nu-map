/**
 * non-program-pages.js — a catalog page that is not a PROGRAM.
 *
 * ## What went wrong
 *
 * Program discovery widened in late August 2026 (CPS's two undergraduate path shapes were
 * being missed entirely — see CLAUDE.md → "An undergraduate program can live at THREE path
 * shapes"). The widening worked, and it also began admitting pages that are not programs at
 * all. Measured across both trees:
 *
 *   · 77 records carry ZERO requirement tables — 46 graduate, 31 undergraduate.
 *   · 2026, scraped before the widening, has NONE. This is a regression, not a
 *     longstanding condition, which is why it is worth removing rather than tolerating.
 *
 * What they are: registrar POLICY pages (`Thesis Policy`, `Transfer of Credit`, `Grading`,
 * `Student Time Status`, `Financial Aid`) and DEPARTMENT landing pages (`Biology`,
 * `School of Journalism`, `Mechanical and Industrial Engineering`). They reach the parser
 * because the scrapers match `*textcontainer` + "has tables", which is correct and must not
 * change: requirement tables live under 27 different container ids including NEU's own
 * typos, so a page cannot be identified by its container.
 *
 * They are not harmless. Every one is a selectable "program" in the picker, a page on the
 * `/data` surface and a row in the search index; and because they state no credit total they
 * were also the bulk of the "programs with no stated total" figure, which is a number people
 * reason from.
 *
 * ## The rule: TWO signals, both NEU's own, no hand list
 *
 * A page is a program when EITHER holds.
 *
 * **1. It states requirements in a TABLE.** `metadata.tablesPresent` already counts them, so
 * this needs no new parsing and no second fetch. Verified against the live catalog rather
 * than inferred from our own parse, because "our parser found nothing" and "the page
 * contains nothing" are different claims:
 *
 *     real program page  → `sc_courselist`     (requirement lists)
 *     department landing → `sc_sccoursedescs`  (course DESCRIPTIONS, not requirements)
 *     policy page        → neither, just prose
 *
 * **2. Its TITLE carries a credential**, in the form NEU itself prints: a degree designator
 * after a comma or a slash — `Biology, MS (Boston)`, `History, Minor`,
 * `Law, JD / Public Health, MPH (Boston)`. The vocabulary is `programNaming.DEGREES`, which
 * already exists and is already closed; this reuses it rather than starting a second list
 * that agrees until someone edits one of them.
 *
 * The second signal exists only to rescue the eight DUAL-DEGREE pages, where NEU describes
 * the combination in prose and publishes the requirements on the two constituent degrees'
 * own pages. There is genuinely no table to find, so the record ships with its notes and an
 * empty requirement set: less information, which is the acceptable degradation. Deleting the
 * program would be wrong information — a student really can be admitted to it.
 *
 * ## Why this is not a hand-adjudicated list
 *
 * It nearly was, and the first draft named those eight pages explicitly, the same shape as
 * `program-variants.js` and `referenced-menus.js`. That was wrong here, and the difference
 * is worth stating because it decides which of the two shapes any future case of this should
 * take: those two files adjudicate a JUDGEMENT the page does not answer — which pane is a
 * variant, which heading a cross-reference points at — and no amount of parsing settles it.
 * This one is a FACT the page states, in a convention NEU applies consistently, so a rule can
 * read it. A hand list here would have to be re-checked at every edition roll forever, and it
 * would go stale silently, which is precisely the failure mode `shared-sections.json` had.
 *
 * Both obvious single rules were measured and refused; only the pair works:
 *
 *   · `/dual-degrees/` in the URL — the catalog's own path marker — covers 6 of the 8 and
 *     misses the two Public Health MPH / Health Informatics MS pages, filed under an
 *     ordinary department.
 *   · `" / "` in the title covers those two and wrongly admits
 *     `Course Retake / Course Substitution Policy`, a policy page with a slash.
 *   · an unanchored search for credential WORDS admits four more policy pages whose titles
 *     merely contain "Certificate" (`Graduate Certificate Programs`,
 *     `Regulations and Requirements for the Certificate of Advanced Graduate Study`). The
 *     comma/slash anchor is what makes a match a reading of the convention rather than a
 *     keyword hit.
 *
 * Measured over all 2,375 records in both trees and both editions: of the 77 with no table,
 * the rule keeps exactly the 8 duals and drops 69, with no real program among them.
 *
 * ## Why an unadjudicated page is DROPPED and not a hard failure
 *
 * `program-variants` and `referenced-menus` stop the run on an unknown case. This one must
 * not, and again the population is the reason: NEU adds, renames and reorganises policy
 * pages routinely, so a hard stop would fire on most runs of an unattended monthly job. A
 * rail that fires constantly is a rail that gets switched off, and then it is not protecting
 * the cases that matter either.
 *
 * The dangerous direction is covered by `checkNonProgramRail` instead: dropping is cheap and
 * reversible ONE page at a time, and catastrophic in bulk — if NEU changed their requirement
 * markup, `tablesPresent` would fall to 0 catalog-wide and this filter would silently
 * discard every degree we ship while every other rail saw a well-formed run of nothing.
 */
import { isDegreeToken } from '../../src/adapters/northeastern/programNaming.js';

/**
 * A credential in the position NEU prints one: immediately after a comma or a slash.
 *
 * The anchor is the whole point. Unanchored, "Certificate" matches four registrar policy
 * pages that merely discuss certificates; anchored, a match is a reading of the title
 * convention rather than a keyword hit.
 */
const AFTER_SEPARATOR = /[,/]\s*([A-Za-z]+)/g;

/**
 * Does this title name a credential?
 *
 * `minor` is checked beside `isDegreeToken` because `DEGREES` spells it as a key but a
 * minor's title is the one place the token appears without a degree abbreviation.
 */
export function titleNamesCredential(name) {
  for (const m of String(name ?? '').matchAll(AFTER_SEPARATOR)) {
    const word = m[1].toLowerCase();
    if (word === 'minor' || isDegreeToken(word)) return true;
  }
  return false;
}

/**
 * Should this parsed record be written at all?
 *
 * @param {object} data  a freshly built record, carrying `metadata.tablesPresent`
 * @returns {boolean}
 */
export function isProgramPage(data) {
  // `tablesPresent` ABSENT is not the same fact as zero, and must not be read as one — a
  // record that never counted its tables (an older shape, or a caller that does not set the
  // field) is kept, because this filter has no evidence about it. Absent, empty and zero.
  const tables = data?.metadata?.tablesPresent;
  if (tables == null) return true;
  return tables > 0 || titleNamesCredential(data?.name);
}

/** Fraction of a run that may be dropped as non-programs before it looks like breakage. */
const MAX_DROP_RATIO = 0.20;

/**
 * Refuse a run that drops an implausible share of its pages.
 *
 * 20%: the observed rate is 69 of 1,304 (5.3%), and policy pages do not multiply quickly, so
 * this sits well clear of the truth while still being far below "something is badly wrong".
 * Deliberately a RATIO and not a count — a count has to be re-tuned every time the catalog
 * grows, and a rail people re-tune is a rail people eventually raise past the defect.
 *
 * @returns {{ok: boolean, reason: string|null}}
 */
export function checkNonProgramRail(dropped, discovered) {
  if (!discovered || dropped <= discovered * MAX_DROP_RATIO) return { ok: true, reason: null };
  return {
    ok: false,
    reason: `${dropped} of ${discovered} pages (${(dropped / discovered * 100).toFixed(1)}%) `
      + `state no requirement table and name no credential, over the `
      + `${MAX_DROP_RATIO * 100}% limit. Either NEU changed the requirement markup — in which `
      + `case this filter would discard the whole catalog — or discovery has widened again. `
      + `Check a known program page for an \`sc_courselist\` table before touching this limit.`,
  };
}
