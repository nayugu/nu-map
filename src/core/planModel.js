// ═══════════════════════════════════════════════════════════════════
// PLAN MODEL  (pure helpers over planner state — no React, no I/O)
// ═══════════════════════════════════════════════════════════════════
import { buildPlacedKeySet, allocateMajorWithElectives } from "./gradRequirements.js";
import { generalElectiveSHOf } from "./requirementBinding.js";
import {
  minorShare, majorClaimOf, outsideCreditKeys, MINOR_SHARE_FRACTION,
} from "./minorOverlap.js";
import { resolveTermByDuration, termSpans, computeGrantedAttrs, workTermGrants } from "./specialTermUtils.js";
import { dropVoidTakes, dropUnearnedTakes } from "./gradeSystem.js";
import { resolveCompanyLogo } from "./companyLogo.js";


/**
 * Apply course substitutions to a placements map.
 *
 * A substitution `{ from, to }` means "placing `from` also satisfies `to`": we
 * add a virtual entry placing `to` in the same semester as `from`, so prereq
 * trees and requirement checks see `to` as present. Credits are always taken
 * from the real `placements` only — the virtual entry exists purely for
 * satisfaction and is never counted toward total SH. Returns `placements`
 * unchanged (same reference) when there are no substitutions.
 *
 * Pure: does not mutate `placements`.
 */
export function applySubstitutions(placements, substitutions = []) {
  if (!substitutions.length) return placements;
  const ep = { ...placements };
  for (const { from, to } of substitutions) {
    if (placements[from]) ep[to] = placements[from];
  }
  return ep;
}

/**
 * HTML-escape one text value for the printed report.
 *
 * ── Why this exists ────────────────────────────────────────────────
 *
 * `exportReport` below builds a document by string concatenation and opens it
 * as a `blob:` URL. A blob document INHERITS THE ORIGIN of the page that
 * created it, so script inside it is same-origin with the app: it can read
 * every plan slot in localStorage, grades included — the one thing
 * `docs/grades-design.md` promises never leaves the browser.
 *
 * Several of the strings that document interpolates arrive from a SHARE LINK,
 * which is to say from whoever wrote it. `planSchema.js` carries co-op
 * `company`, `subline` and `duration` (SHARE_INNER_KEYS.specialTerm) and the
 * whole `reservations` map, whose `label` and `requirement.title` become a
 * card's `code` and `title` in `occupantCards`. A recipient who loads a shared
 * plan and prints it was executing the sender's markup.
 *
 * React escapes these everywhere else in the app, which is exactly why the one
 * surface that does its own string-building is the one that was wrong.
 *
 * ── Escape at the sink, not at the door ────────────────────────────
 *
 * Validating on import is worth doing too, but it cannot be the fix: it has to
 * be right at every door (hash link, share code, imported JSON, library
 * bundle, restored slot) and there is no shape check that makes an arbitrary
 * user-typed employer name safe to splice into markup. Escaping at the point
 * of interpolation is one rule in one place and holds for inputs nobody has
 * thought of yet.
 *
 * Quotes are escaped too — `color` is interpolated inside a `style="…"`
 * attribute, where `<` alone would not be enough to break out.
 */
const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Test seam: the escaper is the whole security property, so it is testable. */
export const _escapeHtml = esc;

/** Convert a CSS hex colour to "r,g,b" string (for use in rgba()). */
export function hexRgb(hex) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r ? `${parseInt(r[1], 16)},${parseInt(r[2], 16)},${parseInt(r[3], 16)}` : "180,180,180";
}

// ── Timeline scope ───────────────────────────────────────────────
// Calculations must only count placements whose semester is INSIDE the
// plan's timeline (the cohort SEMESTERS range, incl. "incoming"). Entries
// parked outside it — e.g. left at their original semId after the user
// shortens the cohort — are deliberately KEPT in state so they return when
// the cohort widens, but they must never influence credits, requirement
// audits, stats, violations, or NUPath coverage. SEM_INDEX is built over
// exactly the SEMESTERS array, so membership is the canonical test (it
// also subsumes the old `"__overflow:*"` string checks).

/** True when semId is inside the plan's timeline. */
export const inTimeline = (semId, semIndex) => semIndex[semId] !== undefined;

/** Placements narrowed to the timeline — the calculation-facing view. */
export function filterInTimeline(placements, semIndex) {
  return Object.fromEntries(
    Object.entries(placements ?? {}).filter(([, sid]) => semIndex[sid] !== undefined)
  );
}

/** Total semester hours placed in a given semester. */
export function getSemSH(semId, placements, courseMap) {
  return Object.entries(placements)
    .filter(([, s]) => s === semId)
    .reduce((acc, [id]) => acc + (courseMap[id]?.sh ?? 0), 0);
}

/**
 * Semester hours that count toward the term's *course load*.
 *
 * A term occupied by a work term is not an ordinary study term. What happens
 * to coursework in it depends on whether that KIND of block permits any:
 *
 *   no `concurrentCap` on the type  → courses stay parked and uncounted. They
 *                                     remain in the plan and come back when
 *                                     the block is removed. This is what every
 *                                     block did before the field existed.
 *   a `concurrentCap`               → courses COUNT. NU permits one class
 *                                     alongside a full-time co-op, and 88 of
 *                                     88 legitimate mixed terms in the
 *                                     published plans are ≤4 SH.
 *
 * Counting is all-or-nothing on purpose. Counting only the first 4 SH and
 * silently dropping the rest would invent a number the student cannot see; the
 * cap is ADVISORY, so everything counts and the UI warns above it. See
 * docs/coop-design.md.
 *
 * `capOf` maps a semester id to that term's `concurrentCap` (or null). Omitted,
 * every occupied term reads as 0 — the old behaviour — so a caller that has not
 * been taught about caps cannot start counting by accident.
 */
export function getSemStudySH(semId, placements, courseMap, startMap = {}, contMap = {}, capOf = null) {
  const occupied = startMap[semId] || contMap[semId];
  if (!occupied) return getSemSH(semId, placements, courseMap);
  if (!capOf?.(semId)) return 0;
  return getSemSH(semId, placements, courseMap);
}

/**
 * Build the `capOf` getSemStudySH wants, from plan state and the type list.
 *
 * @param {Object}   specialTermPl
 * @param {Object[]} types
 * @param {Object}   startMap  semId → instance id
 * @param {Object}   contMap   semId → instance id
 * @returns {(semId: string) => {courses: number, sh: number}|null}
 */
export function concurrentCapOf(specialTermPl = {}, types = [], startMap = {}, contMap = {}) {
  const typeById = Object.fromEntries((types ?? []).map(t => [t.id, t]));
  return (semId) => {
    const inst = startMap[semId] ?? contMap[semId];
    const data = inst ? specialTermPl[inst] : null;
    return data ? (typeById[data.typeId]?.concurrentCap ?? null) : null;
  };
}

/**
 * Return the course IDs in a semester in display order.
 * Respects semOrders overrides; de-duplicates; appends any unordered extras.
 */
export function getOrderedCourses(semId, placements, semOrders, courseMap) {
  const inSem = Object.keys(placements).filter(
    id => placements[id] === semId && courseMap[id]
  );
  const order = semOrders[semId];
  if (!order) return inSem;
  const seen    = new Set();
  const ordered = order.filter(id => {
    if (seen.has(id)) return false;
    seen.add(id);
    return inSem.includes(id);
  });
  const extra = inSem.filter(id => !seen.has(id));
  return [...ordered, ...extra];
}

/** All edges touching a given course id (1-degree neighbourhood). */
export function getConnections(id, edges) {
  return edges.filter(e => e.from === id || e.to === id);
}

/**
 * Prereq-tree traversal: all edges within a bounded number of hops of `id`,
 * expanded independently upstream and downstream so the two directions can be
 * capped separately.
 *
 *   • upstream   — prerequisites (and coreqs) leading *into* a course: follow
 *                  edges backward (node === e.to, step to e.from). `upDepth` caps it.
 *   • downstream — courses that *depend on* it: follow edges forward
 *                  (node === e.from, step to e.to). `downDepth` caps it.
 *
 * Depths are hop counts; pass `Infinity` for "the whole chain". With both = 1
 * this reproduces getConnections. Edges are returned by reference (same objects
 * as `edges`), de-duplicated, so callers can test membership by identity.
 *
 * Pass an edge list already restricted to the courses you want to walk through
 * (e.g. placed courses only) — traversal will not hop past a node that has no
 * edge in the list.
 */
export function getConnectionsToDepth(id, edges, upDepth = Infinity, downDepth = Infinity) {
  const succs = new Map(); // node → edges where node === e.from (downstream)
  const preds = new Map(); // node → edges where node === e.to   (upstream)
  for (const e of edges) {
    if (!succs.has(e.from)) succs.set(e.from, []);
    if (!preds.has(e.to))   preds.set(e.to, []);
    succs.get(e.from).push(e);
    preds.get(e.to).push(e);
  }

  const out = new Set();
  const walk = (adj, step, depth) => {
    if (depth <= 0) return;
    const visited = new Set([id]);
    let frontier = [id];
    for (let d = 0; d < depth && frontier.length; d++) {
      const next = [];
      for (const node of frontier) {
        for (const e of adj.get(node) ?? []) {
          out.add(e);
          const other = step(e);
          if (!visited.has(other)) { visited.add(other); next.push(other); }
        }
      }
      frontier = next;
    }
  };
  walk(preds, e => e.from, upDepth);   // prerequisites, upstream
  walk(succs, e => e.to,   downDepth); // dependents, downstream
  return [...out];
}

// ── PDF export ───────────────────────────────────────────────────

// ── Requirement tree → HTML ───────────────────────────────────────

const STATUS_RANK = { done: 2, planned: 1, missing: 0 };

function nodeMinStatus(r, doneKeys) {
  if (r.type === "COURSE") {
    return r.sat ? (doneKeys.has(r.key) ? "done" : "planned") : "missing";
  }
  if (r.type === "RANGE") {
    return r.sat ? "done" : "missing";
  }
  if (!r.sat) return "missing";
  const satChildren = (r.children ?? []).filter(c => c.sat);
  if (!satChildren.length) return "done";
  return satChildren.map(c => nodeMinStatus(c, doneKeys))
    .reduce((min, s) => STATUS_RANK[s] < STATUS_RANK[min] ? s : min, "done");
}

/**
 * A requirement node, preceded by the sentence that introduced it. Wrapper for
 * the same reason as the panel's: the inner function has early returns for
 * COURSE and RANGE, and a note can sit on any node type.
 */
function reqNodeHtml(r, doneKeys, depth = 0, dimmed = false) {
  const quoted = catalogNotesHtml(r?.notes);
  const body = reqNodeHtmlInner(r, doneKeys, depth, dimmed);
  if (!quoted) return body;
  const pl = depth * 10;
  return `<div style="padding-left:${pl}px">${quoted}</div>${body}`;
}

function reqNodeHtmlInner(r, doneKeys, depth = 0, dimmed = false) {
  const pl = depth * 12;
  if (r.type === "COURSE") {
    const isDimmed = dimmed && !r.sat;
    const status = r.sat ? (doneKeys.has(r.key) ? "done" : "planned") : isDimmed ? "dimmed" : "missing";
    const icon   = status === "done" ? "✓" : status === "planned" ? "○" : status === "dimmed" ? "╱" : "";
    return `<div class="rc rc-${status}" style="padding-left:${pl}px${isDimmed ? ";opacity:0.4" : ""}">
      <span class="rc-icon rc-icon-${status}">${icon}</span>
      <span class="rc-lbl">${esc(r.label)}</span>
    </div>`;
  }
  if (r.type === "RANGE") {
    const isDimmed = dimmed && !r.sat;
    const status = r.sat ? "done" : isDimmed ? "dimmed" : "missing";
    const lbl    = r.sat
      ? r.matched.slice(0, 3).join(", ") + (r.matched.length > 3 ? ` +${r.matched.length - 3}` : "") + ` (${r.subject} range)`
      : r.label;
    return `<div class="rc rc-${status}" style="padding-left:${pl}px${isDimmed ? ";opacity:0.4" : ""}">
      <span class="rc-icon rc-icon-${status}">${r.sat ? "✓" : isDimmed ? "╱" : ""}</span>
      <span class="rc-lbl">${esc(lbl)}</span>
    </div>`;
  }
  const isSat   = r.sat;
  const heading =
    // A branch the catalog NAMED keeps its name, so the export reads the way the
    // page does: "Option 2 (0/2)" rather than "All of (0/2)".
    r.branchLabel ? `${r.branchLabel} (${r.satCount ?? 0}/${r.total ?? 0})` :
    r.type === "AND" ? `All of (${r.satCount ?? 0}/${r.total ?? 0})` :
    r.type === "OR"  ? `One of (${r.satCount ?? 0}/${r.total ?? 0})` :
    r.type === "XOM" ? `${r.satSh ?? 0}/${r.reqSh ?? 0} SH from elective pool` :
    r.title ?? r.label ?? "";
  // XOM and OR: dim unsatisfied children once parent is satisfied (same as app)
  const dimChildren = (r.type === "XOM" || r.type === "OR") && isSat;
  // Category headings inside one pool, mirroring the panel's XomGroupHeader. The
  // export used to render the flat child list here while the panel grouped them,
  // so an advisor's PDF and the student's screen disagreed about the same pool.
  const childrenHtml = (r.groups ?? []).length
    ? r.groups.map(g =>
        `<div class="rg-cat" style="padding-left:${pl + 10}px">${esc(g.title)}</div>`
        + (g.children ?? []).map(c =>
            reqNodeHtml(c, doneKeys, depth + 1, dimChildren && !c.sat)).join("")
      ).join("")
    : (r.children ?? []).map(c =>
        reqNodeHtml(c, doneKeys, depth + 1, dimChildren && !c.sat)
      ).join("");
  const groupDimmed = dimmed && !isSat;
  const groupStatus = isSat ? nodeMinStatus(r, doneKeys) : "unsat";
  const groupIcon   = groupStatus === "done" ? "✓" : groupStatus === "planned" ? "○" : groupDimmed ? "╱" : "";
  return `<div class="rg" style="padding-left:${pl}px${groupDimmed ? ";opacity:0.4" : ""}">
    <div class="rg-head rg-${groupStatus}">
      <span class="rg-icon">${groupIcon}</span>
      <span class="rg-lbl">${esc(heading)}</span>
    </div>
    ${childrenHtml}
  </div>`;
}

/**
 * The catalog's own sentences, quoted. Shared by the section and the node so the
 * export cannot drift from the panel — the two used to hold separate copies and
 * only the section one existed, which is why an instruction belonging to the
 * third menu printed above the first.
 */
function catalogNotesHtml(notes) {
  if (!(notes ?? []).length) return "";
  return `<div class="sec-cat"><div class="sec-cat-h">From the catalog</div>`
    + notes.map(n => `<div class="sec-cat-n">${esc(n)}</div>`).join("")
    + `</div>`;
}

function sectionHtml(sec, doneKeys) {
  // Mirror SectionBlock's pool-structure logic exactly
  const isPoolStructure   = sec.minRequired !== undefined && sec.minRequired < sec.total;
  const displaySatCount   = isPoolStructure ? Math.min(sec.satCount, sec.minRequired) : sec.satCount;
  const displayTotal      = isPoolStructure ? sec.minRequired : sec.total;
  const isGeneralElectives = sec.title === 'General Electives' && sec.placedSH !== undefined;
  const hasSplit           = isGeneralElectives && sec.completedSH !== undefined;
  // A section the catalog states in prose only — credit demanded, no course to
  // tick. Same treatment as the panel: the registrar's number, and no bar,
  // because an empty bar claims no progress where none is measurable.
  const isStatedOnly       = (sec.children ?? []).length === 0 && sec.statedSH > 0;

  // Progress text
  // Numbers, but escaped anyway: `sh` reaches these totals from scraped
  // `credits`, and "it is a number" is an assumption about someone else's
  // data rather than a fact about this function's input.
  const progHtml = hasSplit
    ? `<span style="color:#16a34a">${esc(sec.completedSH)}</span>${sec.plannedSH > 0 ? `<span style="color:#2563eb">+${esc(sec.plannedSH)}</span>` : ""}/${esc(sec.requiredSH)} SH`
    : isGeneralElectives
      ? `${esc(sec.placedSH)}/${esc(sec.requiredSH)} SH`
      : isStatedOnly
        ? `${esc(sec.statedSH)} SH`
        : `${esc(displaySatCount)}/${esc(displayTotal)}`;

  // Progress bar
  const printColor = `-webkit-print-color-adjust:exact;print-color-adjust:exact`;
  const barHtml = hasSplit ? (() => {
    const maxSH      = Math.max((sec.completedSH ?? 0) + (sec.plannedSH ?? 0), sec.requiredSH, 1);
    const totalPct   = Math.min(100, ((sec.completedSH ?? 0) + (sec.plannedSH ?? 0)) / maxSH * 100).toFixed(1);
    const compPct    = Math.min(100, (sec.completedSH ?? 0) / maxSH * 100).toFixed(1);
    return `<div class="sec-bar" style="position:relative;overflow:hidden">
      ${(sec.plannedSH ?? 0) > 0 ? `<div style="position:absolute;top:0;left:0;width:${totalPct}%;height:100%;background:#3b82f6;opacity:0.45;${printColor}"></div>` : ""}
      ${(sec.completedSH ?? 0) > 0 ? `<div style="position:absolute;top:0;left:0;width:${compPct}%;height:100%;background:#22c55e;${printColor}"></div>` : ""}
    </div>`;
  })() : (() => {
    const pct = isGeneralElectives
      ? (sec.requiredSH > 0 ? Math.min(100, Math.round((sec.placedSH ?? 0) / sec.requiredSH * 100)) : 100)
      : (displayTotal > 0 ? Math.round(displaySatCount / displayTotal * 100) : 0);
    return `<div class="sec-bar"><div class="sec-bar-fill${sec.sat ? " sec-bar-sat" : ""}" style="width:${pct}%"></div></div>`;
  })();

  const warnHtml = (sec.warnings ?? []).map(w =>
    `<div class="sec-warn">⚠ ${esc(w)}</div>`).join("");
  // Catalog prose the parse could not express. English literal like the rest of
  // the export (PDF export is English-only by design), and here that is not even
  // a compromise: the sentence itself is the catalog's English.
  const catalogHtml = catalogNotesHtml(sec.notes);
  const noteHtml = isPoolStructure && sec.minRequired > 0
    ? `<div class="sec-note">Requires ${esc(sec.minRequired)} of ${esc(sec.total)}</div>` : "";
  const secStatus = sec.sat ? (() => {
    const satReqs = (sec.children ?? []).filter(r => r.sat);
    if (!satReqs.length) return "done";
    return satReqs.map(r => nodeMinStatus(r, doneKeys))
      .reduce((min, s) => STATUS_RANK[s] < STATUS_RANK[min] ? s : min, "done");
  })() : "missing";
  // "–" for a prose-only section: the print equivalent of the panel's dashed
  // box. An advisor reading this export has to be able to tell "we checked and
  // it is outstanding" from "we could not check this at all".
  const secIcon = isStatedOnly ? "–"
    : secStatus === "done" ? "✓" : secStatus === "planned" ? "○" : "";
  return `<div class="sec${secStatus === "done" ? " sec-sat" : secStatus === "planned" ? " sec-planned" : ""}">
    <div class="sec-head">
      <span class="sec-icon">${secIcon}</span>
      <span class="sec-title">${esc(sec.title)}</span>
      <span class="sec-prog">${progHtml}</span>
    </div>
    ${isStatedOnly ? "" : barHtml}
    ${warnHtml}
    ${catalogHtml}
    <div class="sec-body">
      ${sec.children.map(r => reqNodeHtml(r, doneKeys, 0, isPoolStructure && !r.sat && sec.satCount >= sec.minRequired)).join("")}
      ${noteHtml}
    </div>
  </div>`;
}

/** Test seam: the export is what an ADVISOR reads, so its section states —
    verified, planned, outstanding, and not-evaluable — are testable without
    standing up a whole report. */
export const _sectionHtml = sectionHtml;

/**
 * The printed sentence for Northeastern's 50% cap on double counting a minor.
 *
 * Module level, not nested in `exportReport`, for the same reason as
 * `_sectionHtml`: this is a claim an advisor reads off paper, and it must be
 * checkable without opening a print window. English only, like the rest of the
 * export.
 *
 * Printed whether or not the cap is exceeded — the budget is as much use to the
 * advisor as the breach, and a line that appears only in trouble reads as an
 * accusation rather than a figure.
 *
 * @param {ReturnType<import("./minorOverlap.js").minorShare>} share
 * @returns {string} the sentence, or "" when there is nothing measurable
 */
export function _minorShareNote(share, unitName = "SH") {
  if (!share || !(share.requiredSH > 0)) return "";
  const n = (sh) => (Number.isInteger(sh) ? String(sh) : sh.toFixed(1));
  const pct = Math.round(MINOR_SHARE_FRACTION * 100);
  return share.over
    ? `Double counting: ${n(share.dependentSH)} of the ${n(share.requiredSH)} ${unitName} this `
      + `minor requires also count toward the major — ${n(share.overSH)} ${unitName} over `
      + `Northeastern's ${pct}% limit.`
    : `Double counting: ${n(share.dependentSH)} of ${n(share.capSH)} ${unitName} shared with the `
      + `major (Northeastern allows up to ${pct}% of the ${n(share.requiredSH)} ${unitName} this `
      + `minor requires).`;
}

/**
 * The grade-scoped course sets a degree audit runs on.
 *
 * Extracted because this derivation had two implementations that disagreed.
 * GradPanel built these through the grade views; the printed report built its
 * own from raw placements and had no grade view at all — so a course graded
 * F/W/U/X was voided on screen and printed as COMPLETED, on the single
 * artifact a student hands to an advisor.
 *
 * Returns:
 *   projected     — PROJECTION view: still counts toward the degree (I stays)
 *   earned        — EARNED view: registrar's hours earned (I has earned nothing)
 *   placedSet     — satisfies requirements; includes substitution targets
 *   realPlacedSet — same minus virtual targets, so General Electives don't
 *                   list a substituted course twice at doubled SH
 *   doneKeys      — completed course keys, from the EARNED view
 *
 * ORDER MATTERS: voids drop BEFORE substitutions re-apply, so a failed
 * substituting course cannot smuggle its virtual target back in under the
 * target's own ungraded id — which dropVoidTakes alone could never remove.
 *
 * `isCompleted` is a parameter, not a constant, because callers genuinely
 * disagree about it and that disagreement is not this function's to settle:
 * GradPanel's getSemStatus also treats the graduation semester as completed
 * once the plan is marked graduated, and the printed report never has. The
 * default is the report's rule. Callers pass their own to adopt this without
 * silently changing what "done" means on their surface.
 */
export function derivePlanSets({
  placements, grades = {}, substitutions = [], placedOut = new Set(),
  courseMap, dynSemIdx, curIdx, isCompleted,
  specialTermPl = {}, specialTermTypes = [],
}) {
  const done = isCompleted ?? (semId => (dynSemIdx[semId] ?? 99) < curIdx);
  const projected = dropVoidTakes(placements, grades);
  const earned    = dropUnearnedTakes(placements, grades);

  const placedSet     = buildPlacedKeySet(
    filterInTimeline(applySubstitutions(projected, substitutions), dynSemIdx), placedOut, courseMap);
  const realPlacedSet = buildPlacedKeySet(
    filterInTimeline(projected, dynSemIdx), placedOut, courseMap);

  // A work term registers a real course (COOP 3945). It satisfies
  // requirements but was never dragged onto the grid, so it joins placedSet
  // ALONE — realPlacedSet feeds General Electives and must stay what the
  // student actually placed. Same split the virtual substitution targets use.
  //
  // …and a co-op that has already happened makes its course COMPLETED, not
  // merely planned. Both halves come from one call, shared with GradPanel and
  // the MCP adapter, so the three cannot drift — see workTermGrants.
  const grants = workTermGrants(specialTermPl, specialTermTypes, dynSemIdx, done);
  for (const k of grants.planned) placedSet.add(k);

  // A course in a completed semester is DONE only if its grade yielded credit
  // (or none was entered).
  const doneKeys = buildPlacedKeySet(
    Object.fromEntries(
      Object.entries(applySubstitutions(earned, substitutions)).filter(([, semId]) => done(semId))
    ),
    placedOut, courseMap
  );
  for (const k of grants.completed) doneKeys.add(k);

  return { projected, earned, placedSet, realPlacedSet, doneKeys };
}

/**
 * Async: opens a print-ready HTML page and triggers Save-as-PDF.
 * gradInfo: { majorPath, concLabel, minor1Path, minor2Path,
 *             grades, totalSHRequired }
 */
/**
 * The printed plan.
 *
 * `placements` and `courseMap` are the DEGREE inputs — the requirement audit,
 * credit totals and NUPath grid are computed from them, so they must contain
 * courses only. `view` is the LAYOUT input: what to draw in each semester,
 * which includes reservations.
 *
 * They are separate parameters rather than one because passing the combined
 * view for both is an easy mistake with an invisible consequence — a reserved
 * card is not a course, and letting one reach buildPlacedKeySet or the general
 * elective calculation would credit a printed plan for a course nobody has
 * chosen. `view` defaults to the degree maps, so a caller that does not know
 * about reservations still prints a correct, if reservation-free, report.
 *
 * The three grade-derived sets — placedSet, doneKeys and the attribute grid —
 * are derived HERE, from raw `placements` + `grades`, and never passed in.
 * They used to be the caller's job, and the caller (Header) built them from
 * raw placements while GradPanel built the same sets through dropVoidTakes:
 * an F/W/U course was voided on screen and printed as completed, on the one
 * artifact a student hands to an advisor. One owner is the fix — a second
 * derivation is the bug.
 */
export async function exportReport(placements, courseMap, currentSemId, dynSems, dynSemIdx, gradInfo = {}, specialTermPl = {}, adapter = {}, view = null) {
  const layoutPlacements = view?.occupants ?? placements;
  const layoutCards      = view?.cards     ?? courseMap;
  const { attributeSystem, specialTerms, creditSystem, institution = {}, majorRequirements } = adapter;
  const gridCodes    = attributeSystem?.getGridCodes()   ?? [];
  const attrName     = attributeSystem?.getSystemName()  ?? "";
  const termTypes    = specialTerms?.getTypes()          ?? [];
  const unitName     = creditSystem?.getUnitName()       ?? "SH";
  const appName      = institution.appName ?? `${institution.shortName ?? institution.name ?? "Map"} Map`;

  const curIdx = dynSemIdx[currentSemId] ?? 0;
  const date   = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const {
    majorPath = "", major2Path = "", concLabel = "", minor1Path = "", minor2Path = "",
    totalSHRequired = 0, grades = {},
    placedOut = new Set(), substitutions = [], isGrad = false,
  } = gradInfo;

  // ── Load major + minors (async) ───────────────────────────────
  // Graduate plans resolve their programs through loadGradMajor (different data
  // tree) and have no minors / NUPath.
  //
  // Loaded BEFORE derivePlanSets, which used to run first: a work term now
  // resolves which course it registers against the options its own program
  // names, so the programs have to be in hand before the sets are derived.
  const loadMajorFn = isGrad
    ? (p) => majorRequirements?.loadGradMajor(p)
    : (p) => majorRequirements?.loadMajor(p);
  const [major, major2, minor1, minor2] = await Promise.all([
    majorPath  ? loadMajorFn(majorPath).catch(() => null)  : null,
    major2Path ? loadMajorFn(major2Path).catch(() => null) : null,
    (!isGrad && minor1Path) ? majorRequirements?.loadMinor(minor1Path).catch(() => null) : null,
    (!isGrad && minor2Path) ? majorRequirements?.loadMinor(minor2Path).catch(() => null) : null,
  ]);

  const { projected, earned, placedSet, realPlacedSet, doneKeys } = derivePlanSets({
    placements, grades, substitutions, placedOut, courseMap, dynSemIdx, curIdx,
    specialTermPl, specialTermTypes: termTypes,
  });

  // Use major's totalCreditsRequired if caller didn't supply one
  const effectiveTotalSHRequired = totalSHRequired || (major?.totalCreditsRequired ?? 0);

  // ── Compute totals ────────────────────────────────────────────
  // ── Special term maps ─────────────────────────────────────────
  const semNextMap = {};
  for (let i = 0; i < dynSems.length - 1; i++) {
    semNextMap[dynSems[i].id] = dynSems[i + 1].id;
  }
  const termStartMap = {};
  const termContMap  = {};
  Object.entries(specialTermPl).forEach(([tid, data]) => {
    const { semId, duration, typeId } = data || {};
    if (!semId) return;
    termStartMap[semId] = tid;
    const type      = termTypes.find(t => t.id === typeId);
    if (!type) return;
    const template  = resolveTermByDuration(type.durations, duration);
    const sem       = dynSems.find(s => s.id === semId);
    const semWeight = sem?.weight ?? 1;
    if (template && termSpans(template.weight, semWeight)) {
      const nxt = semNextMap[semId];
      if (nxt) termContMap[nxt] = tid;
    }
  });
  let doneSH = 0, plannedSH = 0;
  const semRows = [];
  dynSems.forEach(sem => {
    // Layout: reservations occupy a term and must be printed. A plan missing
    // half of year 4 on paper is not the student's plan.
    const ids = Object.keys(layoutPlacements).filter(id => layoutPlacements[id] === sem.id && layoutCards[id]);
    const hasStart = !!termStartMap[sem.id];
    const hasCont  = !!termContMap[sem.id];
    if (ids.length === 0 && !hasStart && !hasCont) return;
    const isDone = (dynSemIdx[sem.id] ?? 99) < curIdx;
    const isCur  = sem.id === currentSemId;
    ids.forEach(id => {
      const sh = courseMap[id]?.sh ?? 0;
      // Layout prints every card; only the matching grade view pays for it.
      // A reservation is absent from both maps (and from courseMap), so it
      // still contributes nothing — the pre-existing guarantee, now explicit.
      if (isDone) { if (earned[id]    !== undefined) doneSH    += sh; }
      else        { if (projected[id] !== undefined) plannedSH += sh; }
    });
    semRows.push({ sem, ids, isDone, isCur, hasStart, hasCont });
  });

  // ── Requirements sections HTML ────────────────────────────────
  // Attribute (NUPath) coverage, from the PROJECTION view: a failed course
  // earns no attributes either, until a retake restores the base course.
  const npCovered = attributeSystem?.getCoverage(
    filterInTimeline(projected, dynSemIdx), courseMap,
    computeGrantedAttrs(specialTermPl, termTypes, dynSemIdx)
  ) ?? new Set();

  /**
   * What the MAJORS claim, over any hypothetical placed set.
   *
   * Feeds the minors' double-counting line below, and nothing else. It excludes
   * General Electives by construction (`allocatedSet` is the requirement claim)
   * — a minor course landing in the degree's free electives is not shared
   * credit, it is the room a minor is meant to occupy.
   *
   * A function rather than a set accumulated while the majors render, for two
   * reasons: the cap needs counterfactuals (see core/minorOverlap.js), and the
   * accumulating version made the answer depend on `reqHtml` evaluating its
   * array literal left to right, which is true and is a silly thing to rest on.
   *
   * ⚠ The printed report does not apply the concentration to either major, and
   * never has, so a course claimed only by a concentration is missing here.
   * That makes the printed figure a LOWER bound on the screen's, which is the
   * permissive direction; it is a gap in the export, not in the rule.
   */
  const majorClaim = majorClaimOf(
    [major, major2].map(data => ({ data, concentration: null })), courseMap);
  const majorClaimedKeys = isGrad ? new Set() : majorClaim(placedSet).claimed;

  function renderProgram(prog, doneKeysSet, headerLabel, name, showGeneralElectives = true,
                         isMinor = false) {
    if (!prog) return "";
    // The same residual the panel shows. The export used to take the catalog's
    // stated figure instead, so a printed plan could disagree with the screen it
    // was printed from — and for the 976 programs that state nothing it printed
    // a denominator of 0.
    const { sections: majorSections, generalElectives } = allocateMajorWithElectives(
      prog, placedSet, courseMap,
      { completedSet: doneKeysSet, realPlacedSet,
        geAllowance: generalElectiveSHOf(prog, courseMap) });
    let sections = [...majorSections, generalElectives];
    if (!showGeneralElectives) {
      sections = sections.filter(s => s.title !== "General Electives");
    }
    const sectionsHtml = sections.map(s => sectionHtml(s, doneKeysSet)).join("");
    return `<div class="section-title">${esc(headerLabel)}<span class="prog-name">${esc(name)}</span></div>
      ${isMinor ? shareNoteHtml(prog) : ""}
      ${sectionsHtml}`;
  }

  /** Northeastern's 50% cap on double counting a minor, as printed. */
  function shareNoteHtml(prog) {
    const line = _minorShareNote(
      // `substitutions` + `realPlacedSet` together are what let the cap see a
      // course claimed under two names — without them a substituted plan prints
      // a budget of zero. Both are already derived above; passing them is the
      // whole wiring.
      minorShare({ minor: prog, placedSet, majorKeys: majorClaimedKeys, courseMap, majorClaim,
                   substitutions, realPlacedSet,
                   outsideKeys: outsideCreditKeys({ placements, grades, placedOut, courseMap }) }),
      unitName);
    return line ? `<div class="sec-note">${esc(line)}</div>` : "";
  }

  const reqHtml = [
    renderProgram(major,  doneKeys, major2 ? "Major 1 Requirements: " : "Major Requirements: ", major?.name ?? "",  true),
    major2 ? renderProgram(major2, doneKeys, "Major 2 Requirements: ", major2?.name ?? "", true) : "",
    // The minors render AFTER both majors, which is also the order the double-
    // counting line needs: `majorClaimed` is filled by the calls above.
    renderProgram(minor1, doneKeys, "Minor 1 Requirements: ", minor1?.name ?? "", false, true),
    renderProgram(minor2, doneKeys, "Minor 2 Requirements: ", minor2?.name ?? "", false, true),
  ].join("");

  // ── NUPath grid HTML ──────────────────────────────────────────
  const npHtml = gridCodes.map(key => {
    const sat = npCovered.has(key);
    return `<div class="np-cell${sat ? " sat" : ""}">
      <span class="np-check">${sat ? "✓" : "·"}</span>
      <span class="np-key">${esc(key)}</span>
      <span class="np-lbl">${esc(attributeSystem?.getLabel(key) ?? key)}</span>
    </div>`;
  }).join("\n");

  // ── Co-op logos ───────────────────────────────────────────────
  // Resolved up front: the semester HTML below is built synchronously, and a
  // printed page gets no second chance at a broken image. A domain with no
  // logo good enough falls back to the same grey bar as a domainless term.
  const coopLogos = new Map();
  await Promise.all(
    [...new Set(Object.values(specialTermPl).map(d => d?.companyDomain).filter(Boolean))]
      .map(async domain => {
        const url = await resolveCompanyLogo(domain).catch(() => null);
        if (url) coopLogos.set(domain, url);
      })
  );
  // `src` is an ATTRIBUTE, so the escaper's quote handling is what matters here
  // rather than its angle brackets. Today nothing hostile can reach this map —
  // a URL only lands in it after an <img> at that URL loaded and measured, and
  // `companyDomain` (which a share link does carry) cannot form a resolvable
  // host once it contains a quote. That is a sound argument and it is an
  // argument, made about `resolveCompanyLogo`'s internals, one refactor away
  // from silently ceasing to hold. Escaping states it locally instead.
  const coopIcon = domain => coopLogos.has(domain)
    ? `<img class="coop-logo" src="${esc(coopLogos.get(domain))}" />`
    : `<div class="coop-bar"></div>`;

  // ── Semester blocks HTML ──────────────────────────────────────
  const semHtml = semRows.map(({ sem, ids, isDone, isCur, hasStart, hasCont }) => {
    const semSH = ids.reduce((s, id) => s + (courseMap[id]?.sh ?? 0), 0);
    const tag   = isDone ? " done" : isCur ? " current" : "";

    // Special term continuation row
    if (hasCont && !hasStart) {
      const contId   = termContMap[sem.id];
      const contData = specialTermPl[contId];
      const contType = contData ? termTypes.find(t => t.id === contData.typeId) : null;
      const contDur  = contType ? resolveTermByDuration(contType.durations, contData.duration) : null;
      if (contDur) {
        const contCompany = contData.company || "";
        const contRole    = contData.subline  || "";
        return `<div class="sem-block${tag}">
          <div class="sem-head">
            <span class="sem-label">${esc(sem.label)}</span>
            <span class="sem-sh">${isDone ? "completed" : isCur ? "in progress" : ""}</span>
          </div>
          <div class="coop-row" style="border-color:#e0e0e0">
            <div class="coop-icon">${coopIcon(contData.companyDomain)}</div>
            <div style="flex:1">
              <div class="coop-title">${esc(contType.label)} CONTINUES${contCompany ? `<span style="text-transform:none"> \u00b7 ${esc(contCompany)}</span>` : ""}</div>
              ${contRole ? `<div class="coop-role">${esc(contRole)}</div>` : ""}
              <div class="coop-sub">${esc(contData.duration)}-month block</div>
            </div>
          </div>
        </div>`;
      }
    }

    // Special term start row
    if (hasStart) {
      const startId   = termStartMap[sem.id];
      const startData = specialTermPl[startId];
      const startType = startData ? termTypes.find(t => t.id === startData.typeId) : null;
      const startDur  = startType ? resolveTermByDuration(startType.durations, startData.duration) : null;
      if (startDur) {
        const nextSem    = dynSems.find(s => s.id === semNextMap[sem.id]);
        const spansNext  = termSpans(startDur.weight, sem.weight ?? 1) && !!nextSem;
        const company    = startData.company || "";
        const role       = startData.subline || "";
        const blockLabel = `${startData.duration}-month block`;
        return `<div class="sem-block${tag}">
          <div class="sem-head">
            <span class="sem-label">${esc(sem.label)}</span>
            <span class="sem-sh">${isDone ? "completed" : isCur ? "in progress" : ""}</span>
          </div>
          <div class="coop-row" style="border-color:#e0e0e0">
            <div class="coop-icon">${coopIcon(startData.companyDomain)}</div>
            <div style="flex:1">
              <div class="coop-title">${esc(startType.label)}${company ? `<span style="text-transform:none"> \u00b7 ${esc(company)}</span>` : ""}</div>
              ${role ? `<div class="coop-role">${esc(role)}</div>` : ""}
              <div class="coop-sub">${spansNext ? `Spans into ${esc(nextSem.label)} \u00b7 ${esc(blockLabel)}` : esc(blockLabel)}</div>
            </div>
          </div>
        </div>`;
      }
    }

    // Normal course semester
    const rows = ids.map(id => {
      const c = layoutCards[id];
      if (!c) return "";
      // `c` is a card from the LAYOUT map, so it may be a reservation \u2014 whose
      // `code` is the plan's own label and `title` the requirement's, both of
      // which ride a share link verbatim (planSchema `rv`).
      const pill     = `<span class="pill" style="background:${esc(c.color)}">${esc(c.subject ?? c.id)}</span>`;
      const nuBadges = (c.attributes ?? []).map(np => `<span class="np-badge">${esc(np)}</span>`).join("");
      return `<div class="course-row">
        ${pill}
        <span class="ccode">${esc(c.code ?? c.id)}</span>
        <span class="ctitle">${esc(c.title ?? "")}</span>
        ${nuBadges ? `<span class="np-badges">${nuBadges}</span>` : ""}
        <span class="csh">${c.shMax ? `${esc(c.sh)}\u2013${esc(c.shMax)}` : esc(c.sh)} ${esc(unitName)}</span>
      </div>`;
    }).join("\n");
    return `<div class="sem-block${tag}">
      <div class="sem-head">
        <span class="sem-label">${esc(sem.label)}</span>
        <span class="sem-sh">${esc(semSH)} SH${isDone ? " · completed" : isCur ? " · in progress" : ""}</span>
      </div>
      ${rows}
    </div>`;
  }).join("\n");

  // Build appendix of course descriptions (timeline only — parked entries
  // aren't part of the plan being exported)
  const appendixIds = Object.keys(filterInTimeline(placements, dynSemIdx));
  const appendixHtml = [];
  if (appendixIds.length > 0) {
    appendixHtml.push('<div class="page-break"></div>');
    appendixHtml.push('<div class="appendix-section">');
    appendixHtml.push('<h2>Course Descriptions</h2>');
    for (const id of appendixIds) {
      const c = courseMap[id];
      if (!c) continue;
      const desc = c.desc?.trim() || c.description?.trim() || 'No description available.';
        appendixHtml.push(`
        <div class="appendix-course">
          <div style="display: grid; grid-template-columns: 45px 85px 1fr auto; align-items: baseline; gap: 10px; margin-bottom: 4px;">
            <span class="pill" style="background:${esc(c.color)}; display: inline-block; width: 100%; text-align: center;">${esc(c.subject)}</span>
            <span class="ccode">${esc(c.code)}</span>
            <span class="ctitle">${esc(c.title)}</span>
            <span class="csh">${esc(c.sh)} ${esc(unitName)}</span>
          </div>
          <div class="appendix-course-description">${esc(desc).replace(/\n/g, '<br>')}</div>
        </div>
      `);
    }
    appendixHtml.push('</div>');
  }

  // ── Meta lines ───────────────────────────────────────────────
  const majorLabel  = major?.name  ?? "";
  const major2Label = major2?.name ?? "";
  const minor1Label = minor1?.name ?? "";
  const minor2Label = minor2?.name ?? "";
  const metaLines = [
    majorLabel  && `<div class="meta-row"><span class="meta-lbl">${major2Label ? "Major 1" : "Major"}</span><span class="meta-val">${esc(majorLabel)}</span></div>`,
    major2Label && `<div class="meta-row"><span class="meta-lbl">Major 2</span><span class="meta-val">${esc(major2Label)}</span></div>`,
    concLabel   && `<div class="meta-row"><span class="meta-lbl">Concentration</span><span class="meta-val">${esc(concLabel)}</span></div>`,
    minor1Label && `<div class="meta-row"><span class="meta-lbl">Minor 1</span><span class="meta-val">${esc(minor1Label)}</span></div>`,
    minor2Label && `<div class="meta-row"><span class="meta-lbl">Minor 2</span><span class="meta-val">${esc(minor2Label)}</span></div>`,
  ].filter(Boolean).join("\n");

  // ── Credit summary ────────────────────────────────────────────
  const reqPct = effectiveTotalSHRequired > 0 ? Math.min(100, (doneSH / effectiveTotalSHRequired) * 100).toFixed(0) : null;
  const creditHtml = `<div class="credit-row">
    <div class="credit-num">${esc(doneSH)}<span class="credit-unit"> ${esc(unitName)} completed</span></div>
    <div class="credit-sep">+</div>
    <div class="credit-num">${esc(plannedSH)}<span class="credit-unit"> ${esc(unitName)} planned</span></div>
    ${effectiveTotalSHRequired > 0 ? `<div class="credit-sep">/</div><div class="credit-num">${esc(effectiveTotalSHRequired)}<span class="credit-unit"> ${esc(unitName)} required</span></div>` : ""}
    ${reqPct !== null ? `<div class="credit-pct">${esc(reqPct)}%</div>` : ""}
  </div>`;

  // ── Full HTML ─────────────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<title>Course Schedule · ${esc(appName)}</title>
<style>
  @page { margin: 18mm 15mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
         font-size: 11px; color: #111; background: #fff; margin: 0; padding: 0; }
  h1   { font-size: 20px; margin: 0 0 2px; font-weight: 800; letter-spacing: -0.01em; }
  .date { font-size: 10px; color: #888; margin-bottom: 14px; }
  .section-title { font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
                   text-transform: uppercase; color: #666; margin: 16px 0 7px;
                   border-bottom: 1px solid #e5e5e5; padding-bottom: 4px;
                   display: flex; align-items: baseline; gap: 6px; }
  .prog-name { text-transform: none; letter-spacing: 0; font-weight: 600; color: #111; font-size: 11px; }

  /* Meta */
  .meta-row { display: flex; gap: 10px; font-size: 10px; margin-bottom: 3px; }
  .meta-lbl { color: #888; width: 100px; flex-shrink: 0; }
  .meta-val { color: #111; font-weight: 600; }

  /* Credits */
  .credit-row { display: flex; align-items: baseline; gap: 8px; margin: 8px 0 12px; flex-wrap: wrap; }
  .credit-num  { font-size: 15px; font-weight: 800; }
  .credit-unit { font-size: 10px; font-weight: 400; color: #666; }
  .credit-sep  { font-size: 13px; color: #bbb; }
  .credit-pct  { font-size: 11px; font-weight: 700; color: #16a34a;
                 background: #dcfce7; border: 1px solid #86efac;
                 border-radius: 99px; padding: 1px 8px; margin-left: 4px; }

  /* NUPath grid */
  .np-grid  { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; margin-bottom: 6px; }
  .np-cell  { display: flex; align-items: center; gap: 5px; padding: 3px 6px;
              border: 1px solid #e0e0e0; border-radius: 4px; font-size: 9.5px; color: #999; }
  .np-cell.sat { border-color: #86efac; color: #4a8f63; }
  .np-check { font-size: 10px; width: 12px; flex-shrink: 0; color: #bbb; }
  .np-cell.sat .np-check { color: #4a8f63; }
  .np-key   { font-weight: 800; width: 22px; flex-shrink: 0; }
  .np-lbl   { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* Requirements */
  .sec         { margin-bottom: 5px; border: 1px solid #e8e8e8; border-radius: 5px; overflow: hidden; page-break-inside: avoid; }
  .sec-sat     { border-color: #bbf7d0; }
  .sec-planned { border-color: #bfdbfe; }
  .sec-head    { display: flex; align-items: center; gap: 6px; padding: 4px 8px;
                 background: #f8f8f8; }
  .sec-sat .sec-head     { background: #f0faf4; }
  .sec-planned .sec-head { background: #eff6ff; }
  .sec-icon    { width: 13px; height: 13px; border-radius: 3px; display: inline-flex;
                 align-items: center; justify-content: center; font-size: 8px; font-weight: 900;
                 flex-shrink: 0; border: 1px solid #d0d0d0; color: #bbb; background: #fff; }
  .sec-sat .sec-icon     { background: #dcfce7; border-color: #86efac; color: #16a34a; }
  .sec-planned .sec-icon { background: #dbeafe; border-color: #93c5fd; color: #2563eb; }
  .sec-title   { flex: 1; font-size: 10px; font-weight: 700; color: #444;
                 overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sec-sat .sec-title     { color: #111; }
  .sec-planned .sec-title { color: #111; }
  .sec-prog    { font-size: 9px; color: #999; flex-shrink: 0; }
  .sec-bar     { height: 3px; background: #e5e5e5; }
  .sec-bar-fill { height: 100%; background: #f59e0b; border-radius: 0; }
  .sec-bar-sat  { background: #22c55e; }
  .sec-warn    { font-size: 9px; color: #b45309; padding: 3px 8px;
                 border-left: 2px solid #f59e0b; margin: 2px 0; }
  .sec-body    { padding: 5px 4px 4px; }
  .sec-note    { font-size: 9px; color: #999; font-style: italic; padding: 2px 4px; }
  .sec-cat     { padding: 3px 8px; border-left: 2px solid #d4d4d4; margin: 2px 0; }
  .sec-cat-h   { font-size: 7px; font-weight: 700; letter-spacing: .4px;
                 text-transform: uppercase; color: #a3a3a3; }
  .sec-cat-n   { font-size: 9px; color: #525252; line-height: 1.35; }

  /* Req course rows */
  .rc        { display: flex; align-items: center; gap: 5px; margin-bottom: 2px; }
  .rc-icon   { width: 12px; height: 12px; border-radius: 2px; display: inline-flex;
               align-items: center; justify-content: center; font-size: 8px; font-weight: 900;
               flex-shrink: 0; border: 1px solid #d8d8d8; color: #ccc; background: #fff; }
  .rc-icon-done    { background: #dcfce7; border-color: #86efac; color: #16a34a; }
  .rc-icon-planned { background: #dbeafe; border-color: #93c5fd; color: #2563eb; font-size: 9px; }
  .rc-icon-missing { background: #fff; border-color: #d8d8d8; color: #ccc; }
  .rc-icon-dimmed  { background: #f0f0f0; border-color: #999; color: #333; }
  .rc-lbl    { font-size: 10px; }
  .rc-done    .rc-lbl { color: #15803d; }
  .rc-planned .rc-lbl { color: #1d4ed8; }
  .rc-missing .rc-lbl { color: #999; }

  /* Req group rows */
  .rg        { margin-bottom: 3px; }
  .rg-head   { display: flex; align-items: center; gap: 5px; margin-bottom: 2px; }
  .rg-icon   { width: 12px; height: 12px; border-radius: 2px; display: inline-flex;
               align-items: center; justify-content: center; font-size: 8px; font-weight: 900;
               flex-shrink: 0; border: 1px solid #d8d8d8; color: #ccc; background: #fff; }
  .rg-done .rg-icon     { background: #dcfce7; border-color: #86efac; color: #16a34a; }
  .rg-planned .rg-icon  { background: #dbeafe; border-color: #93c5fd; color: #2563eb; }
  .rg-unsat .rg-icon    { background: #fff; border-color: #d8d8d8; color: #ccc; }
  .rg-lbl    { font-size: 10px; font-weight: 600; color: #444; }
  /* A category heading inside one pool, mirroring the panel's XomGroupHeader.
     The markup shipped without this rule, so the heading rendered as an
     unstyled div — visible, but not reading as a heading. */
  .rg-cat    { font-size: 8px; font-weight: 700; letter-spacing: .04em;
               text-transform: uppercase; color: #737373; margin: 3px 0 1px; }
  .rg-done    .rg-lbl   { color: #111; }
  .rg-planned .rg-lbl   { color: #1d4ed8; }
  .rg-unsat   .rg-lbl   { color: #888; }

  /* Page break */
  .page-break { page-break-after: always; }

  /* Semester blocks */
  .sem-block  { margin-bottom: 16px; page-break-inside: avoid; }
  .sem-head   { display: flex; align-items: baseline; gap: 8px; margin-bottom: 5px; }
  .sem-label  { font-size: 13px; font-weight: 700; }
  .sem-sh     { font-size: 10px; color: #888; }
  .sem-block.done    .sem-label { color: #16a34a; }
  .sem-block.current .sem-label { color: #2563eb; }

  /* Course rows */
  .course-row { display: flex; align-items: center; gap: 8px;
                padding: 5px 8px; border: 1px solid #ececec;
                border-radius: 5px; margin-bottom: 3px; }
  .sem-block.done .course-row { background: #f9fffe; border-color: #d1fae5; }
  .pill  { font-size: 8.5px; font-weight: 800; border-radius: 3px; padding: 2px 6px;
           color: #fff; flex-shrink: 0;
           -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .ccode {
    font-size: 11px;
    font-weight: 700;
    white-space: nowrap;   /* prevent code from wrapping */
  }
  .ctitle { font-size: 11px; flex: 1; color: #333; }
  .csh    { font-size: 10px; color: #888; flex-shrink: 0; }
  .np-badges { display: flex; gap: 2px; flex-shrink: 0; }
  .np-badge  { font-size: 8px; font-weight: 700; background: #f3f4f6;
               border: 1px solid #e0e0e0; border-radius: 3px; padding: 1px 4px; color: #666; }.coop-row  { display: flex; align-items: center; gap: 10px;
               padding: 10px 14px; border: 1.5px solid; border-radius: 6px;
               margin-top: 3px;
               -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .coop-icon  { width: 28px; display: flex; justify-content: center; align-self: stretch; flex-shrink: 0; }
  .coop-bar   { width: 4px; border-radius: 2px; align-self: stretch; min-height: 36px; background: #e0e0e0;
                -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .coop-logo  { width: 28px; height: 28px; object-fit: contain; align-self: center; }
  .coop-title { font-size: 12px; font-weight: 600; letter-spacing: 0.08em; color: #595959;
                text-transform: uppercase; font-family: "Inter", -apple-system, sans-serif; }
  .coop-sub   { font-size: 10px; color: #888; margin-top: 2px; }
  .coop-role  { font-size: 10px; color: #595959; margin-top: 1px; font-style: italic; }
  /* Appendix styles */
  .appendix-section {
    margin-top: 20px;
  }
  .appendix-section h2 {
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 0.05em;
    color: #444;
    border-bottom: 2px solid #e5e5e5;
    padding-bottom: 5px;
    margin-bottom: 15px;
  }
  .appendix-course {
    margin-bottom: 32px;
    page-break-inside: avoid;
  }
  .appendix-course-header {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 4px;
    flex-wrap: wrap;
  }
  .appendix-course-code {
    font-size: 12px;
    font-weight: 700;
    color: #111;
    background: #f0f0f0;
    padding: 2px 8px;
    border-radius: 4px;
  }
  .appendix-course-title {
    font-size: 12px;
    font-weight: 600;
    color: #333;
  }
  .appendix-course-credits {
    font-size: 11px;
    color: #888;
    background: #f5f5f5;
    padding: 2px 8px;
    border-radius: 4px;
  }
  .appendix-course-description {
    font-size: 11px;
    color: #555;
    line-height: 1.6;
    padding-left: 10px;
    border-left: 3px solid #e0e0e0;
  }
  .appendix-section .pill {
    font-size: 10px;
  }
  .appendix-section .ccode {
    font-size: 13px;
  }
  .appendix-section .ctitle {
    font-size: 13px;
  }
  .appendix-section .csh {
    font-size: 12px;
  }
  .appendix-section .appendix-course-description {
    font-size: 12px;
  }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head><body>

<!-- ── PAGE 1: Graduation summary ── -->
<h1>${esc(appName)}</h1>
<div class="date">Generated ${esc(date)}</div>

${metaLines ? `<div class="section-title">Program</div>${metaLines}` : ""}

<div class="section-title">Credits</div>
${creditHtml}

${isGrad ? "" : `<div class="section-title">${esc(attrName)} <span class="prog-name">(${esc(npCovered.size)}/${esc(gridCodes.length)} fulfilled)</span></div>
<div class="np-grid">${npHtml}</div>`}

${reqHtml}

${placedOut.size > 0 ? `
<div class="section-title">Placed Out <span class="prog-name">(satisfies prerequisites, no credit)</span></div>
<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">
${[...placedOut].map(id => {
  const c = courseMap[id];
  return c ? `<span style="font-size:10px;font-weight:700;background:#f3f4f6;border:1px solid #e0e0e0;border-radius:4px;padding:2px 7px">${esc(c.code)}</span>` : "";
}).filter(Boolean).join("\n")}
</div>` : ""}

${substitutions.length > 0 ? `
<div class="section-title">Substitutions <span class="prog-name">(course A placed, satisfies course B; credits count once)</span></div>
<div style="display:flex;flex-direction:column;gap:3px;margin-bottom:8px">
${substitutions.map(({ from, to }) => {
  const fc = courseMap[from];
  const tc = courseMap[to];
  if (!fc || !tc) return "";
  const placed = !!placements[from];
  return `<div style="display:flex;align-items:center;gap:6px;font-size:10px;${placed ? "" : "opacity:0.5"}">
    <span style="font-weight:700;color:#2563eb">${esc(fc.code)}</span>
    <span style="color:#888">→ satisfies</span>
    <span style="font-weight:700">${esc(tc.code)}</span>
    ${placed ? "" : '<span style="color:#b45309;font-size:9px">⚠ not placed</span>'}
  </div>`;
}).filter(Boolean).join("\n")}
</div>` : ""}

<div class="page-break"></div>

<!-- ── PAGE 2+: Semester schedule ── -->
<h1>${esc(appName)}: Course Schedule</h1>
<div class="date">Generated ${esc(date)}</div>
<br>
${semHtml}
${appendixHtml.join('\n')}

</body></html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url  = URL.createObjectURL(blob);
  const w    = window.open(url, "_blank");
  if (!w) { URL.revokeObjectURL(url); alert("Pop-up blocked. Please allow pop-ups for this site and try again."); return; }
  w.focus();
  // Close this tab automatically once the print dialog is dismissed.
  w.onafterprint = () => { w.close(); URL.revokeObjectURL(url); };
  setTimeout(() => { w.print(); }, 400);
}

// ── Prereq display formatter ─────────────────────────────────────

/**
 * Turn a ninest prereq token array into a readable string.
 * Substitutes {subject,number} refs with their course codes.
 */
export function formatPrereqSummary(prereqs, courseMap) {
  if (!Array.isArray(prereqs) || prereqs.length === 0) return "—";
  try {
    const parts = prereqs.map(item => {
      if (typeof item === "string") return item;
      if (typeof item === "object" && item.subject && item.number) {
        const id = `${item.subject.toUpperCase()}${item.number}`;
        const c  = courseMap[id];
        return c ? c.code : `${item.subject} ${item.number}`;
      }
      if (Array.isArray(item)) return formatPrereqSummary(item, courseMap);
      return "";
    }).filter(Boolean);
    return parts.join(" ") || "—";
  } catch {
    return "—";
  }
}
