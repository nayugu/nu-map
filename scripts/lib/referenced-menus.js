// ═══════════════════════════════════════════════════════════════════
// REFERENCED MENUS — a heading that is a course LIST, not a requirement
//
// Most headings in a requirements pane introduce something the student owes.
// A few introduce a MENU that another section points at, and the tell is in
// the pointing section rather than in the menu itself:
//
//   <h2>Computer Science Electives</h2>
//     Complete two courses that are not already required in the following ranges:
//       CS 2500 to CS 7999, except …
//       CY 3000 or higher, except CY 4930
//       One course from Khoury meaningful minors list (SEE BELOW).
//   <h2>Khoury Meaningful Minors</h2>
//     [Bouvé Health Sciences] [Arts, Media and Design] [Engineering] …
//
// The parser owns every heading that owns a table, so the eight college
// `areaheader` groups under that second heading each became a requirement
// section of their own, at `minRequirementCount: 1`. That reads as "take one
// course from each of eight colleges" — a degree requirement NEU does not
// have, and the opposite of the page, which says the student may take ONE
// such course IN PLACE OF one Khoury elective.
//
// Measured on the shipped corpus, with the app's own `demandOf`:
//
//   Computer Science, Minor   52 SH derived (29 SH of it phantom)  page says 20
//   Data Science, Minor       45 SH derived (27 SH of it phantom)
//
// That number is not cosmetic. `minorOverlap.js` derives the 50% double-count
// ceiling from Σ `demandOf` precisely because 169 of 181 minor pages state no
// total, so an inflated denominator quietly raises the cap: the CS minor's
// ceiling was 26 SH against a 20 SH minor. It is also why the CS minor is the
// one program CLAUDE.md names as unfixable-looking under the old parse.
//
// ── Why a hand adjudication and not a detector ──────────────────────
//
// Same answer as `program-variants.js` and `shared-sections.js`, and for once
// the measurement is unambiguous. Across the 1,386 cached LIVE program pages,
// exactly TWO carry a cross-reference row, and they are these two. Fitting a
// rule to n=2 is not engineering, and both obvious rules fail on the pair:
//
//   match the menu by its TITLE      the CS page says "Khoury meaningful
//     minors list" and the DS page says "Meaningful minor list", against a
//     heading of "Khoury Meaningful Minors". A title match already misses
//     one of the two cases it was derived from.
//   take the NEXT heading            true on both pages, and a guess. Getting
//     it wrong DELETES a requirement section, which is the direction a
//     student cannot recover from — they are never shown the thing they owe.
//
// So detection is automatic and the DECISION is by hand. A cross-reference
// row that no entry below claims is a HARD SCRAPE FAILURE, exactly as an
// unadjudicated pane is: the run stops and a person looks at the page. That
// hard stop is the design. Do not add a fallback — a fallback here silently
// either invents eight requirements or deletes a real one.
//
// ── The edition ─────────────────────────────────────────────────────
//
// Like `shared-sections.js`, these patterns were read off a specific catalog,
// so an edition roll costs a re-adjudication. `ADJUDICATED_EDITION` records
// which one, and the rail's message names it — a 2027 page that reworded
// "(see below)" should stop the run rather than silently ship the old shape.

/** The catalog edition these patterns were read off. */
export const ADJUDICATED_EDITION = '2025-2026';

/**
 * A row of prose that points at another part of the same page.
 *
 * Deliberately broad: this is the DETECTOR, and its job is to make sure no
 * cross-reference reaches the emit loop unexamined. Precision comes from the
 * adjudication below, so a false positive here costs a scrape failure and a
 * two-line entry, while a false negative ships phantom requirements.
 */
export const CROSS_REFERENCE = /\bsee\s+below\b/i;

/**
 * The adjudicated menus.
 *
 * `reference` matches the ROW in the host section that points at the menu, and
 * is what binds the two together — the host is whichever section ends up
 * carrying that row as a note, so the link survives everything that reorders
 * or rebuilds sections between here and the JSON.
 *
 * `heading` matches the heading that owns the menu's tables.
 *
 * `atMostOne` is the only fold implemented, because it is the only one the
 * corpus states: both pages allow exactly one course from the list. The DS
 * page says so in as many words — "only one course from the meaningful minor
 * list may contribute toward the minor requirements" — and the CS page says
 * "One course from Khoury meaningful minors list". A menu adjudicated with
 * anything else must not be guessed at; `foldOf` refuses.
 */
const MENUS = [
  {
    id: 'khoury-meaningful-minors',
    // "One course from Khoury meaningful minors list (see below)."  [CS minor]
    // "Meaningful minor list (see below)"                           [DS minor]
    reference: /meaningful\s+minors?\s+list\s*\(see below\)/i,
    heading: /^khoury\s+meaningful\s+minors$/i,
    atMostOne: true,
  },
];

/** The entry claiming this cross-reference row, or null if none does. */
export function menuForReference(text) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return MENUS.find(m => m.reference.test(s)) ?? null;
}

/** The entry whose menu this heading owns, or null. */
export function menuForHeading(title) {
  const s = String(title ?? '').replace(/\s+/g, ' ').trim();
  return MENUS.find(m => m.heading.test(s)) ?? null;
}

/**
 * The node shape a menu folds into its host pool as.
 *
 * One `atMostOne` OR over one labelled OR per area, which says exactly what
 * the page says and nothing more: an OR commits a single alternative, so the
 * whole menu contributes at most one course however many of its courses the
 * student took. Nesting is what keeps the area names — an inner OR's `label`
 * renders as a branch label — and nested ORs are an existing shape (the CS
 * minor's own Social Science area already holds an OR of PHIL 4515/4516).
 *
 * The `atMostOne` flag is read by the enclosing pool
 * (`gradRequirements.allocateNode`) and must NOT be generalised to every OR
 * child of a pool: 310 of 1,410 pools would change, and four sections become
 * impossible to complete because there the OR is the pool's own course list.
 * See that call site for the measurement.
 *
 * @param {{title: string, courses: object[]}[]} areas
 * @returns {object|null} an OR node, or null if the menu parsed to nothing
 */
export function foldOf(entry, areas) {
  if (!entry?.atMostOne) {
    throw new Error(`referenced-menus: ${entry?.id ?? '?'} has no implemented fold ` +
      `— only \`atMostOne\` is adjudicated, and a fold must not be guessed`);
  }
  const branches = (areas ?? [])
    .filter(a => a?.courses?.length)
    .map(a => {
      // An `areaheader` group already arrives as ONE unlabelled OR over the
      // area's courses, so wrapping it again would nest an OR inside an OR
      // that adds no choice — it only makes the tree a level deeper for every
      // consumer that walks it. Absorb it and keep the area's name as the
      // label instead. Anything else (an area that is a single course, or one
      // that parsed to several nodes) is wrapped as it stands.
      const [only] = a.courses;
      if (a.courses.length === 1 && only.type === 'OR' && !only.label) {
        return { ...only, ...(a.title ? { label: a.title } : {}) };
      }
      if (a.courses.length === 1 && !a.title) return only;
      return { type: 'OR', ...(a.title ? { label: a.title } : {}), courses: a.courses };
    });
  if (!branches.length) return null;
  // `atMostOne` is what the enclosing pool reads to cap the menu's credit at a
  // single course. It has to be on the node rather than a rule about ORs: a
  // plain OR child of a credit pool is AMBIGUOUS in this corpus — sometimes a
  // set of alternatives, sometimes the pool's own course list (History BA's
  // 5 SH "Historical Research and Writing" is one OR holding exactly 5 SH) —
  // so only the node that positively carries the constraint may impose it.
  return { type: 'OR', atMostOne: true, courses: branches };
}

/**
 * The rail. Every cross-reference row on the page must be adjudicated.
 *
 * @param {string[]} rows  every prose row the page's requirement tables carry
 * @throws {Error} naming the unclaimed rows, so the person reading the log
 *   knows which sentence to go and look at
 */
export function assertReferencesAdjudicated(rows, { url = '' } = {}) {
  const unclaimed = [...new Set((rows ?? [])
    .map(r => String(r ?? '').replace(/\s+/g, ' ').trim())
    .filter(r => CROSS_REFERENCE.test(r) && !menuForReference(r)))];
  if (!unclaimed.length) return;
  throw new Error(
    `referenced-menus: unadjudicated cross-reference on ${url || 'this page'} ` +
    `(adjudicated edition ${ADJUDICATED_EDITION}):\n` +
    unclaimed.map(r => `  · ${r}`).join('\n') +
    `\nA row pointing elsewhere on the page means some heading below is a MENU, ` +
    `not a requirement. Decide which, and add it to MENUS in ` +
    `scripts/lib/referenced-menus.js. Do not add a fallback.`,
  );
}

/** Exposed for the unit test, so the manifest itself can be asserted over. */
export const _MENUS = MENUS;
