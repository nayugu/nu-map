/**
 * program-record.js — turn one catalog page into the program record(s) it holds.
 *
 * Shared by scrape-majors.js and scrape-grad-majors.js. Those two scripts had
 * a byte-identical `scrapeProgram`, which is a standing invitation to fix a
 * data bug in one path and not the other — the exact failure CLAUDE.md warns
 * about under "Data fixes must live in the scrape scripts (both undergrad and
 * grad paths)". The rule is easier to keep when there is only one path.
 *
 * The interesting part is that a page is not necessarily ONE program. See
 * scripts/lib/program-variants.js for what a variant is, why the decision is a
 * hand-adjudicated table rather than a classifier, and what merging them cost.
 */
import { parse as parseHTML } from 'node-html-parser';
import { markSharedSections } from './major-integrity.js';
import { applySharedSections } from './shared-sections.js';
import { extractPlanGrid }    from './plan-grid.js';
import {
  parseRequirements, parseTotalCredits, parseMajorCreditSubtotal, totalsProfileFor,
  extractPlanOfStudyCourses, listRequirementPanes, normalizeConcentrationHref,
} from './catalog-program-parser.js';
import { obligationsOf, GENERAL_ELECTIVE } from '../../src/core/requirementBinding.js';
import { catalogCourseMap } from './catalog-course-map.js';
import { planPanes, assertPaneCoverage, variantSlug } from './program-variants.js';
import { fmtProgramLabel, fmtLocation, isDegreeToken }
  from '../../src/adapters/northeastern/programNaming.js';

/**
 * Concentration pages are fetched, so following them is capped. The cap now
 * bounds DISTINCT targets: the parser de-duplicates pendingExternal by
 * normalized href, and before it did, a page that repeated its concentration
 * menu spent the budget twice over (International Business offered 30 links to
 * 15 pages). A markup change still cannot turn this into a crawler.
 */
export const MAX_EXTERNAL_CONCENTRATIONS = 40;

/** "Computer Science, BSCS (Boston)" → "computer_science_bscs_(boston)" */
export function slugify(str) {
  return str.toLowerCase()
    .replace(/[,]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_()\-]/g, '')
    .replace(/_+/g, '_')
    .trim();
}

/**
 * Parse one program, following any concentration pages it links to.
 *
 * Parsing is synchronous and fetching is not, so this parses once to discover
 * the links, fetches them, then parses again with them resolved.
 */
async function parseResolvingExternals(root, { profile, fetchPage, panes, url }) {
  // `url` is carried only so a rail that stops the run can name the page it
  // stopped on — an unadjudicated cross-reference (see referenced-menus.js)
  // is read by a person, and "this page" is not an address.
  const first = parseRequirements(root, profile, { panes, url });
  const pending = (first.pendingExternal ?? []).slice(0, MAX_EXTERNAL_CONCENTRATIONS);
  if (!pending.length) return first;

  const resolved = new Map();
  for (const link of pending) {
    const url = normalizeConcentrationHref(link.href);
    if (!url) continue;
    try { resolved.set(url, parseHTML(await fetchPage(url))); }
    catch { /* a missing concentration page must not fail the program */ }
  }
  return parseRequirements(root, profile, {
    panes, url, resolveExternal: u => resolved.get(u) ?? null,
  });
}

/**
 * Every program published on one catalog page.
 *
 * Usually exactly one. A page that also publishes an ALTERNATE CURRICULUM in a
 * second requirement pane — advanced entry, part-time, exchange — yields one
 * record per curriculum. The primary keeps the folder it has always had, so no
 * saved plan, share link or MCP programId changes meaning; variants are new
 * siblings, which makes the whole change additive.
 *
 * @param {object} root                  parsed page
 * @param {string} url                   source URL, for metadata and errors
 * @param {object} deps
 * @param {object} deps.profile          UNDERGRAD_PROFILE | GRAD_PROFILE
 * @param {(url: string) => Promise<string>} deps.fetchPage
 * @param {number} deps.year             catalog edition year
 * @returns {Promise<object[]>}          primary first; `[]` when the page holds none
 * @throws  {UnadjudicatedPaneError}     on a pane shape nobody has decided about
 */
/**
 * Raise total demand to the major's stated size, if the parse fell short.
 *
 * "Complete 36 semester hours in the major" is a SUBTOTAL: normally it restates
 * requirements already parsed, and adding it would demand the major twice — up
 * to 60 SH of phantom credit on one page. But where the parse is thin it is the
 * only statement of the major's size, and the gap goes straight into free
 * electives: Philosophy BA parses 16 SH of demand against a stated 36, and told
 * the student 112 of its 128 credits were theirs to spend.
 *
 * ── Why a floor on the DEGREE, not on "the major" ──────────────────
 *
 * The obvious reading is `majorDemand = max(parsed major, subtotal)`, and it
 * cannot be implemented, because deciding which sections are "in the major" is a
 * classifier and the only one available — the section title — misfiles exactly
 * the cases that matter. Spanish BA's "Spanish Language Requirements" is 16 SH
 * and IS its major; Philosophy BA's "BA Language Requirements" is 12 SH and is
 * not. Keying on /language/ gets one right and the other wrong.
 *
 * So the claim used here needs no attribution: the major is a SUBSET of the
 * degree, therefore TOTAL demand must be at least the major subtotal. Where it
 * is not, we have certainly under-parsed, by at least the difference — true
 * whatever the sections turn out to be. Measured over 21 pages stating a
 * subtotal: 3 move, 18 are untouched, and Spanish BA is one of the untouched,
 * which is the case the classifier would have got wrong.
 *
 * It UNDER-corrects on purpose. Philosophy BA has 12 SH of language on top of
 * its 36 SH major, so true demand is 48 and this claims only 36 — because 36 is
 * what the page guarantees and 48 is what we would be guessing. Under-claiming
 * hands a student extra free electives; over-claiming refuses a valid plan.
 *
 * Emitted as a codeless SECTION rather than a new obligation target: that shape
 * ships 580 times already and every consumer — the residual, CHART's cells, the
 * panel, the PDF, the MCP tree — handles it today. A fourth sentinel would need
 * all five audited first.
 *
 * @param data      the record, mutated in place
 * @param courseMap sizing requires real credits; an EMPTY map means the catalog
 *                  is missing, and the comparison would then be against the
 *                  modal-unit estimate — so it declines rather than guessing.
 * @returns the section it appended, or null
 */
export function applyMajorCreditFloor(data, courseMap) {
  const subtotal = data?.majorCreditSubtotal;
  if (!subtotal || !courseMap || !Object.keys(courseMap).length) return null;

  const demand = obligationsOf(data, { courseMap })
    .filter(o => o.target !== GENERAL_ELECTIVE)
    .reduce((n, o) => n + o.shortfallSH, 0);
  const gap = subtotal - demand;
  if (gap <= 0) return null;

  const section = {
    type: 'SECTION',
    // The registrar's own name for the block, so no panel has to invent one.
    title: 'Major Credit Requirement',
    creditsRequired: gap,
    // Nothing is enumerated, so nothing may draw a checked box — the same
    // contract the other 580 codeless sections carry.
    minRequirementCount: 1,
    requirements: [],
    notes: [`The catalog states ${subtotal} semester hours in the major. `
      + `${demand} are enumerated above; this stands for the remaining ${gap}.`],
  };
  data.requirementSections.push(section);
  return section;
}

export async function buildProgramsForPage(root, url, deps) {
  const pageName = root.querySelector('#page-title h1, h1.page-title, h1')
    ?.text?.trim()
    ?.replace(/\s+/g, ' ')
    ?? '';

  const panes = listRequirementPanes(root);
  const { primary, variants } = planPanes(panes, url);

  const out = [];
  const covered = [];
  for (const group of [{ modality: null, label: null, panes: primary }, ...variants]) {
    if (!group.panes.length) continue;
    const rec = await buildOne(root, url, pageName, group, deps);
    if (rec) { out.push(rec); covered.push(rec.metadata.panes); }
  }

  // Every requirement pane read exactly once. The old invariant counted
  // consumption, which can only prove nothing was DROPPED — International
  // Business reported a spotless 8/8 while shipping every concentration twice.
  // Partitioning is what catches double-counting.
  if (out.length) assertPaneCoverage(panes, covered, url);
  return out;
}

async function buildOne(root, url, pageName, group, deps) {
  const { profile, year } = deps;
  const paneEls = group.panes.map(p => p.el);
  const isVariant = group.modality != null;

  // A variant's folder and its label are ONE derivation, through the same
  // parser the picker uses (majorLoader calls parseProgram on the folder, not
  // on this JSON). So `public_policy_phdadvancedentry_(boston)` and
  // "Public Policy, PhD—Advanced Entry (Boston)" cannot disagree.
  const baseSlug = slugify(pageName);
  const slug = isVariant ? variantSlug(baseSlug, group.modality, isDegreeToken) : baseSlug;
  const campus = fmtLocation(slug);
  const name = isVariant
    ? fmtProgramLabel(slug) + (campus ? ` (${campus})` : '')
    : pageName;

  // Scoped to this program's panes. A page carrying two curricula states two
  // totals, and 42 of the 46 multi-pane pages state a DIFFERENT one in each —
  // Electrical Engineering PhD is 48 SH standard entry and 16 SH advanced
  // entry, and both used to ship as 48.
  //
  // Only the PRIMARY may fall back to page-wide evidence. That fallback reads
  // the sample-plan grid, which describes the primary curriculum, so a variant
  // reaching it gets the other program's number — Interdisciplinary Design and
  // Media, PhD—Advanced Entry did exactly that and reported 48 SH for a 28 SH
  // degree. Three programs in the catalog depend on the fallback, all of them
  // single-pane, so restricting it to the primary costs nothing.
  // A MINOR reads its total through a minor-sized window — 15–25 SH, not the
  // degree's 120–134 — or the figure its own page states is discarded as a
  // stray number. See MINOR_CREDIT_WINDOW.
  const { value: totalCreditsRequired, source: totalCreditsSource } =
    parseTotalCredits(root, totalsProfileFor(profile, name),
                      { panes: paneEls, allowPageFallback: !isVariant });

  const { requirementSections, concentrations, generalElectiveSH, gpaConstraints,
          footnotes,
          tablesPresent, tablesConsumed, tablesOnPage, tablesExcluded,
          unconsumedHeadings, titleCollisions, panesParsed } =
    await parseResolvingExternals(root, { profile, fetchPage: deps.fetchPage, panes: paneEls, url });

  // A program can be entirely concentrations: Philosophy BA's whole major is
  // five mutually-exclusive options and has no base requirement section.
  // Dropping it for having no sections lost the program altogether.
  if (!requirementSections.length && !concentrations) return null;

  const data = {
    name,
    metadata: {
      verified: false,
      lastEdited: new Date().toLocaleDateString('en-US'),
      branch: 'main',
      // Parse coverage — how many requirement tables this program's panes
      // offered vs how many became requirements. Any gap means content was
      // dropped on the floor; scripts/verify-majors.js gates on it.
      tablesPresent,
      tablesConsumed,
      tablesOnPage,
      tablesExcluded,
      // The catalog page this was read from. Stored so the UI can send an
      // advisor straight to the source — the whole point of saying "we copied
      // the catalog" is that they can go check the catalog.
      sourceUrl: url,
      // Which panes this record came from, and which alternate path it is.
      // Both are how a reader, and the next scrape, can tell a split program
      // from a page that simply has one pane.
      panes: panesParsed,
      ...(isVariant ? { variant: { modality: group.modality, label: group.label } } : {}),
      // Titles that collided before being renamed unique. Surfaced rather than
      // swallowed: major-verify's high-severity duplicate-concentration check
      // reads these, because by the time a title reaches this JSON the rename
      // has already made the collision invisible.
      ...(titleCollisions?.sections?.length || titleCollisions?.concentrations?.length
        ? { titleCollisions } : {}),
      ...(unconsumedHeadings?.length ? { unconsumedHeadings } : {}),
      // Courses the department's own sample plan names. A one-directional
      // witness: anything here that matches no requirement means we dropped
      // something. Never the reverse — the plan picks one branch per choice.
      //
      // A variant gets none of it. The plan pane describes the primary
      // curriculum, so handing it to the advanced-entry record would make the
      // verifier report every standard-only course as dropped. A witness
      // pointed at the wrong program is worse than no witness.
      planOfStudyCourses: isVariant ? [] : extractPlanOfStudyCourses(root),
    },
    // The same pane read as STRUCTURE — years, terms, entries — so the plan can
    // be offered to a student rather than only counted against. Split into
    // plan.json at write time and never stored here. Null for the many
    // programs that publish no plan, which is normal, and never offered for a
    // variant, for the reason above.
    planGrid: isVariant ? null : extractPlanGrid(root),
    totalCreditsRequired,
    // Which phrasing produced the number — 'stated-total' and friends come
    // from what the page says is required; 'plan-grid' means we fell back to
    // the sample plan and the value may exceed the true minimum.
    ...(totalCreditsSource ? { totalCreditsSource } : {}),
    yearVersion: year,
    requirementSections,
    // GPA rules are constraints over grades, not satisfiable requirements —
    // they render as info in the graduation panel and are evaluated only
    // against grades the user chose to enter (src/core/gradeSystem.js).
    ...(gpaConstraints?.length ? { gpaRequirements: gpaConstraints } : {}),
    // Every footnote parseFootnotes found is kept — some state a WAIVER or a
    // table-wide rule with no course codes at all, so no code-based filter can
    // catch them and only keeping everything does.
    ...(footnotes?.length ? { footnotes } : {}),
    ...(concentrations ? { concentrations } : {}),
    ...(generalElectiveSH > 0 ? { generalElectiveSH } : {}),
  };

  // ── The major's stated size, as a FLOOR on demand ─────────────────
  //
  // "Complete 36 semester hours in the major" is a SUBTOTAL: normally it restates
  // requirements already parsed, and adding it would demand the major twice. But
  // where the parse is thin it is the only statement of the major's size, and
  // the gap goes straight into free electives — Philosophy BA parses 16 SH of
  // demand against a stated 36 and told the student 112 of its 128 credits were
  // theirs to spend.
  //
  // ── Why a floor on the DEGREE, not on "the major" ─────────────────
  //
  // The obvious reading is `majorDemand = max(parsed major, subtotal)`, and it
  // cannot be implemented: deciding which sections are "in the major" is a
  // classifier, and the one available — the section title — misfiles the cases
  // that matter. Spanish BA's "Spanish Language Requirements" is 16 SH and IS
  // its major; Philosophy BA's "BA Language Requirements" is 12 SH and is not.
  // Keying on /language/ gets one right and the other wrong.
  //
  // So the claim used here needs no attribution at all: the major is a SUBSET of
  // the degree, therefore TOTAL demand must be at least the major subtotal. If
  // it is not, we have certainly under-parsed, by at least the difference. That
  // is true whatever the sections turn out to be.
  //
  // It under-corrects on purpose. Philosophy BA has 12 SH of language ON TOP of
  // its 36 SH major, so true demand is 48 and this claims only 36 — because 36
  // is what the page guarantees and 48 is what we would be guessing. Under-
  // claiming leaves a student extra free electives; over-claiming refuses a
  // valid plan.
  //
  // Emitted as a codeless SECTION rather than a new obligation target: that
  // shape already ships 580 times and every consumer — the residual, CHART's
  // cell derivation, the panel, the PDF, the MCP tree — handles it today. A
  // fourth sentinel would need all five audited.
  const majorCreditSubtotal = parseMajorCreditSubtotal(root);
  if (majorCreditSubtotal) data.majorCreditSubtotal = majorCreditSubtotal;
  applyMajorCreditFloor(data, catalogCourseMap());

  // Mark cross-count sections (integrative / GPA re-lists / shared credit) that
  // would otherwise be impossible to satisfy under single-use allocation.
  markSharedSections(data);
  // ── Then the ones no rule can derive ──────────────────────────────
  //
  // `markSharedSections` finds a section whose courses an earlier one ate. It cannot find
  // two alternative TRACKS, because nothing in the data says a student picks one — they
  // allocate side by side perfectly well. Those calls are adjudicated by hand and committed;
  // see `shared-sections.js` for why, and for the measured cost of leaving them out.
  //
  // Second so the derived marking still wins where it applies: the manifest is for what the
  // rule misses, not a replacement for it.
  const shared = applySharedSections(data, { url, slug });
  // Carried non-enumerably, like `_slug`, so it reaches the scrape's rails without ever
  // reaching the JSON. An unmatched title means the catalog moved under the adjudication.
  Object.defineProperty(data, '_sharedMissing', {
    value: shared.missing, enumerable: false });

  // The folder this record must be written to. Carried on the record rather
  // than recomputed by the caller, so the name and the path stay one decision.
  // Non-enumerable so it never reaches the JSON.
  Object.defineProperty(data, '_slug', { value: slug, enumerable: false });
  return data;
}
