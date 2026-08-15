/**
 * program-variants.js — one catalog page can be more than one program.
 *
 * ── The defect this exists to remove ────────────────────────────────────────
 *
 * The scrapers used to assume `page = program`: every `*textcontainer` pane
 * with tables got flattened into a single requirements.json. That assumption is
 * false. Northeastern publishes program VARIANTS two different ways:
 *
 *   · as separate URLs   — campus. `…_phd_(boston)` and `…_phd_(portland)` are
 *                          already two records, because NEU did the splitting.
 *   · as separate PANES  — entry path, part-time, exchange, experiential. NEU
 *                          did not split these, so we merged them.
 *
 * Merging a variant is not cosmetic. Measured over the 2026 catalog, 1017 pages:
 *
 *   46   pages carry more than one requirement pane
 *   37   of those shipped phantom requirement sections — 139 of them, renamed
 *        "Core Requirements (2)" and counted as extra work the student does not owe
 *   42   state a DIFFERENT credit total in each pane (Electrical Engineering PhD
 *        is 48 SH by standard entry and 16 SH by advanced entry) and every one
 *        of them shipped the standard number for both
 *    3   duplicated their whole concentration menu (International Business, BSIB
 *        listed 15 concentrations twice; Public Policy PhD's twin pairs differed
 *        by 24 SH vs 16 SH with nothing on screen to tell them apart)
 *   ~36  variant programs were unreachable — a student on the advanced-entry
 *        track could not select their own curriculum at all
 *
 * ── Why this is a table and not a classifier ────────────────────────────────
 *
 * Two automatic classifiers were built and measured, and both failed:
 *
 *   Heading overlap. Panes that restate the same curriculum should share
 *   heading text. Cybersecurity PhD scores 0.2 — reads as unrelated — yet its
 *   pane is `advancedentryphdprogramrequirements`, plainly an alternate entry
 *   path. It misfiles 8 real variants.
 *
 *   Credit arithmetic. A continuation partitions the degree, so its panes
 *   should sum to the stated total; alternatives should overshoot. It disagrees
 *   with overlap on 16 of 45 and gets the clearest case backwards, calling
 *   PharmD's undergraduate + graduate phases "alternatives".
 *
 * So we do not guess. There are only EIGHT distinct secondary pane ids in the
 * whole catalog; they are adjudicated here by hand, and anything not in this
 * table is a hard scrape failure rather than a silent default. That is the part
 * that makes the fix permanent: a shape we have never seen cannot quietly
 * become a duplicate — it stops the run and asks a human.
 *
 * See docs/program-variants.md for how to adjudicate a new pane.
 */

/**
 * How to treat a requirement pane that is not the page's first.
 *
 *   merge  — a CONTINUATION. More requirements of the same degree: the
 *            prerequisite pane that feeds a core pane, PharmD's undergraduate
 *            phase followed by its graduate phase. Folded into the primary
 *            program, which is what the scrapers have always done.
 *   split  — a VARIANT. A whole alternative path through the same degree.
 *            Becomes its own program record with its own credit total, its own
 *            requirement sections and its own concentration menu.
 *
 * `modality` is the slug token welded onto the degree code, and `label` is how
 * it prints. Both follow the convention the catalog already uses for alternate
 * paths — "MSCS—Align", "BSN—Transfer" — so a variant reads as
 * "Public Policy, PhD—Advanced Entry" and needs no new UI. The tokens are
 * registered in src/adapters/northeastern/programNaming.js; a modality that is
 * not registered there will not parse back into a label, which
 * test/unit/program-variants.test.js asserts.
 */
export const PANE_DECISIONS = {
  // ── Alternate entry paths ────────────────────────────────────────────────
  // Doctoral programs admit both from a bachelor's and from a master's. The
  // second route carries far fewer required hours because the master's already
  // covered them. 32 pages, the single largest group.
  advancedentryphdprogramrequirementstextcontainer:
    { kind: 'split', modality: 'advancedentry', label: 'Advanced Entry' },
  advancedentryprogramrequirementstextcontainer:
    { kind: 'split', modality: 'advancedentry', label: 'Advanced Entry' },
  advancedentrytextcontainer:
    { kind: 'split', modality: 'advancedentry', label: 'Advanced Entry' },

  // ── One-off alternate paths ──────────────────────────────────────────────
  // Law, JD publishes a part-time route alongside the full-time one.
  parttimeoptiontextcontainer:
    { kind: 'split', modality: 'parttime', label: 'Part-Time' },
  // International Business, BSIB maps a curriculum for inbound exchange
  // students. It restates the entire concentration menu, which is where the
  // 15 duplicated concentrations came from.
  exchangestudentstextcontainer:
    { kind: 'split', modality: 'exchange', label: 'Exchange' },
  // Law, LLM's experiential track — same four concentrations, different core.
  lawllmexperientialprogramrequirementstextcontainer:
    { kind: 'split', modality: 'experiential', label: 'Experiential' },

  // ── Continuations ────────────────────────────────────────────────────────
  // The bare `textcontainer` opens 9 pages with a prerequisite table, and the
  // real curriculum follows in `programrequirements`. One program, two panes:
  // the nursing CAGS pages read "Prerequisite Courses" then "Core Requirements".
  programrequirementstextcontainer:
    { kind: 'merge', why: 'core requirements following an intro/prerequisite pane' },
  // PharmD 0-6 is a single six-year degree taught in two sequential phases.
  // (Not to be confused with the separate graduate-entry PharmD, which is its
  // own page in the graduate tree — see programRegistry.node.js.)
  graduatephasetextcontainer:
    { kind: 'merge', why: 'second phase of the six-year PharmD' },
};

/** Pane ids that may legitimately open a page. Informational: the first pane
 *  is always primary regardless, but an unfamiliar one is worth logging. */
export const KNOWN_PRIMARY_PANES = new Set([
  'textcontainer',
  'programrequirementstextcontainer',
  'bachelorsdegreeentrancetextcontainer',
  'curriculumtextcontainer',
  'cirriculumtextcontainer',          // NEU's own typo, live on the CHME PhD page
  'progratextcontainer',              // …and another, on Civil & Environmental
  'undergraduatephasetextcontainer',
  'lawllmprogramrequirementstextcontainer',
]);

/** Thrown when a page shows a pane shape nobody has adjudicated. */
export class UnadjudicatedPaneError extends Error {
  constructor(paneIds, url) {
    super(`unadjudicated requirement pane(s) [${paneIds.join(', ')}] on ${url}\n` +
          `    A catalog page grew a pane this scraper has never seen. Merging it ` +
          `blindly is how duplicate\n    concentrations and phantom requirements ` +
          `got shipped before. Adjudicate it in\n    scripts/lib/program-variants.js ` +
          `(see docs/program-variants.md), then re-run.`);
    this.name = 'UnadjudicatedPaneError';
    this.paneIds = paneIds;
    this.url = url;
  }
}

/**
 * Split a page's panes into the program records they should produce.
 *
 * The FIRST pane is always primary and always keeps the program's existing
 * folder, so no saved plan, share link or MCP programId changes meaning — the
 * whole change is additive. On the 11 pages whose first pane is
 * `bachelorsdegreeentrance`, "primary" is the standard-entry route, which is
 * the right default for a plan that predates the split.
 *
 * @param {{id: string, el: object}[]} panes  included panes, in document order
 * @param {string} url                        for the error message
 * @returns {{primary: object[], variants: {modality, label, panes}[]}}
 *          `primary.panes` is the first pane plus every merge-decided pane.
 * @throws  {UnadjudicatedPaneError} on any non-first pane with no decision
 */
export function planPanes(panes, url = '') {
  if (!panes.length) return { primary: [], variants: [] };

  const primary = [panes[0]];
  const byModality = new Map();
  const unknown = [];

  for (const pane of panes.slice(1)) {
    const decision = PANE_DECISIONS[pane.id];
    if (!decision) { unknown.push(pane.id); continue; }
    if (decision.kind === 'merge') { primary.push(pane); continue; }
    // Two panes could in principle carry the same modality; keep them together
    // in one variant rather than inventing a second folder for the same path.
    if (!byModality.has(decision.modality)) {
      byModality.set(decision.modality, { modality: decision.modality, label: decision.label, panes: [] });
    }
    byModality.get(decision.modality).panes.push(pane);
  }

  if (unknown.length) throw new UnadjudicatedPaneError(unknown, url);

  return { primary, variants: [...byModality.values()] };
}

/**
 * Prove the per-program parses PARTITION the page: every requirement pane
 * covered exactly once, none twice, none missed.
 *
 * This is the invariant the old one could not express. `tablesConsumed ===
 * tablesOnPage` only ever proved nothing was DROPPED — International Business
 * reported a spotless 8/8 while shipping every concentration twice, because
 * counting consumption cannot see double-counting. Partitioning can.
 *
 * @param {{id: string}[]} panes    every included pane on the page
 * @param {string[][]} coveredBy    panesParsed from each program record
 * @throws {Error} naming the panes that were missed or counted twice
 */
export function assertPaneCoverage(panes, coveredBy, url = '') {
  const counts = new Map(panes.map(p => [p.id, 0]));
  for (const ids of coveredBy) {
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const missed = [...counts].filter(([, n]) => n === 0).map(([id]) => id);
  const twice  = [...counts].filter(([, n]) => n > 1).map(([id, n]) => `${id} ×${n}`);
  if (missed.length || twice.length) {
    throw new Error(
      `pane coverage broken on ${url}` +
      (missed.length ? `\n    never parsed: ${missed.join(', ')}` : '') +
      (twice.length  ? `\n    parsed more than once: ${twice.join(', ')}` : ''));
  }
}

/**
 * The folder slug for a variant of `baseSlug`.
 *
 * The modality is WELDED to the degree token rather than appended to the whole
 * slug, because the picker's label comes from parsing the folder — not from the
 * program JSON (see majorLoader.js, which calls parseProgram(folder)). Welding
 * produces `public_policy_phdadvancedentry_(boston)`, which parses back to
 * "Public Policy, PhD—Advanced Entry (Boston)"; appending would leave the
 * campus tag stranded mid-slug and the degree unrecognised.
 *
 * When the token before the campus is not a degree code we fall back to a
 * plain suffix. The folder is then still unique and stable — only the printed
 * label degrades, which is the right way round.
 *
 * @param {string} baseSlug   e.g. "public_policy_phd_(boston)"
 * @param {string} modality   e.g. "advancedentry"
 * @param {(token: string) => boolean} isDegreeToken
 * @returns {string}          e.g. "public_policy_phdadvancedentry_(boston)"
 */
export function variantSlug(baseSlug, modality, isDegreeToken = () => true) {
  const m = String(baseSlug).match(/^(.*?)(_?\([^)]*\)?)$/);
  const stem = m ? m[1] : String(baseSlug);
  const campus = m ? m[2] : '';

  const parts = stem.split('_').filter(Boolean);
  const last = parts[parts.length - 1];
  if (last && isDegreeToken(last)) {
    parts[parts.length - 1] = last + modality;
    return parts.join('_') + campus;
  }
  return `${stem}_${modality}${campus}`;
}
