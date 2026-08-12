// ═══════════════════════════════════════════════════════════════════
// CHART · PRE-FLIGHT — refusing before searching
//
// Refusal is a first-class outcome, not a failure. For some programs the
// requirement data is too thin to plan from, and the honest answer is "no
// generated plan is available for this program" alongside the official one, which
// still loads. That is cheaper than a search that fails and far more useful than a
// plan that looks authoritative and says nothing.
//
// Every gate here is decided BEFORE any search runs, and each one names what the
// student or the maintainer can do about it. "Infeasible" is not an answer anyone
// can use; "this shape holds 152 SH and your requirements need 153" is.
//
// ── Why the capacity gate exists at all ────────────────────────────
//
// The first real run spent 45 seconds and 20,000 search nodes discovering that
// Industrial Engineering's 153 SH of cells could not fit a shape holding 152. The
// arithmetic that settles it is one line. A search is the wrong instrument for a
// question with a closed form, and letting it grind is how a generate button
// becomes a hang.
// ═══════════════════════════════════════════════════════════════════

import { cellsSH } from "./demand.js";
import { studyTerms } from "./shape.js";
import { termCapacity } from "./domains.js";
import { GENERAL_ELECTIVE, CONCENTRATION, DEFAULT_UNIT_SH } from "../core/requirementDemand.js";

/**
 * Fraction of a degree that may be unlabelled placeholder before CHART declines.
 *
 * A plan that is mostly `General Elective` looks authoritative and says nothing,
 * which is worse than no plan. Applies only to a bucket we DERIVED: where the
 * catalog states `generalElectiveSH` itself, that is evidence about the degree
 * rather than a gap in our reading, and some degrees genuinely are elective-heavy.
 * Measured: the catalog states it for 95 of 748 programs (12.7%).
 *
 * ── Measured, over all 653 programs with a derived bucket ───────────
 *
 *   median 17%   ·   p75 41%   ·   p90 56%   ·   p95 75%
 *
 *   threshold 0.30 → refuses 36.9%      0.60 → refuses  8.4%
 *   threshold 0.40 → refuses 25.7%      0.70 → refuses  5.4%
 *   threshold 0.50 → refuses 13.6%      0.80 → refuses  2.3%
 *
 * 0.50 is the knee: a generated plan is at most half placeholder, and what it
 * declines is genuinely thin rather than badly parsed. The programs above it are
 * PhDs whose requirements really are "48 credits of dissertation and electives"
 * (1–4 sections for a 48 SH degree, nothing else stated) and a handful of studio
 * BAs — `theatre_ba` publishes 6 sections covering 19 of 132 credits.
 *
 * A caution about how this number was first obtained: measuring the leading 120
 * programs ALPHABETICALLY gave a 36% refusal rate and nearly moved the threshold.
 * That prefix is `admission/` and `arts-media-design/`, which is where the thin
 * programs live. The corpus is not shuffled and must not be sampled in order.
 */
export const MAX_DERIVED_GE_SHARE = 0.5;

/**
 * @typedef {Object} Refusal
 * @property {string} reason   a stable code, for tests and telemetry
 * @property {string} detail   one sentence a person can act on
 * @property {object} [data]
 */

/**
 * Decide whether to generate at all.
 *
 * @param {object} args
 * @param {object} args.programData
 * @param {object[]} args.cells
 * @param {import("./shape.js").Shape} args.shape
 * @param {object} args.ports
 * @param {string} args.studentType
 * @param {object[]} [args.impossible]  cells with an empty domain, from buildDomains
 * @returns {Refusal|null} null to proceed
 */
export function preflight({
  programData, cells, shape, ports, studentType = "undergraduate", impossible = [],
}) {
  const sections = programData?.requirementSections ?? [];

  if (!sections.length) {
    return {
      reason: "no-requirements",
      detail: "This program has no parsed requirement sections, so there is nothing to build a plan from.",
    };
  }

  const total = programData?.totalCreditsRequired;
  if (!total || !(total > 0)) {
    return {
      reason: "no-total-credits",
      detail: "This program does not state a total credit requirement, so a plan cannot be sized against it.",
    };
  }

  if (!cells.length) {
    return {
      reason: "no-cells",
      detail: "The requirement sections yielded nothing to schedule.",
    };
  }

  // A degree that is mostly unlabelled placeholder. Counted on the DERIVED bucket
  // only — a stated one is the catalog telling us something true.
  const derived = cells.filter(c => c.derivedBucket);
  if (derived.length) {
    const share = cellsSH(derived) / total;
    if (share > MAX_DERIVED_GE_SHARE) {
      return {
        reason: "mostly-unlabelled",
        detail: `We can only account for ${Math.round((1 - share) * 100)}% of this degree's ` +
                `${total} credits; the rest would be unlabelled placeholders.`,
        data: { derivedSH: cellsSH(derived), total, share },
      };
    }
  }

  // ── Sections that total more than the degree ─────────────────────
  //
  // Six sections reading "choose one course from College X" are not six
  // requirements — the student takes three electives from ANY of them, and the
  // catalog is listing where they may come from. `data_science_ms` states 32
  // credits and its sections sum to 44; CHART emitted a 48-credit plan for it,
  // which is wrong in a way a student would act on.
  //
  // Nothing in the data distinguishes "six requirements" from "one requirement,
  // six sources". Choosing three of the six would be a guess dressed as an answer,
  // so this refuses instead and says exactly what does not add up. The honest fix
  // is a pooled remainder cell drawing from the union of those sections, which is
  // real work and not a guess — recorded as the next step rather than improvised.
  // Measured against what the plan will actually SCHEDULE, not against the
  // sections alone. Excluding the concentration let one program through at 140
  // credits for a 133-credit degree: its sections came to 132, under the bar, and
  // the eight credits of concentration nobody counted put it over.
  //
  // General electives are excluded because they are the residual and are already
  // clamped to zero when the sections overrun — including them would double-count
  // the overrun.
  // ── Not a refusal. A DISAGREEMENT, reported ─────────────────────
  //
  // This used to refuse, and refusing was answering the wrong question. "The sections
  // total more than the degree" is a statement about the CATALOG's internal
  // consistency; whether a plan can be built is a question about capacity, and the
  // gate below already asks it exactly.
  //
  // Where the excess is poolable, `poolExcess` has already absorbed it. Where it is
  // not — the remaining cases are programs whose surplus is all NAMED courses, and a
  // named course cannot be dropped — the two possibilities are:
  //
  //   it still fits    emit it, and say the requirements exceed the stated degree.
  //                    A plan the student can follow plus a discrepancy they should
  //                    raise beats no plan at all.
  //   it does not fit  `does-not-fit` refuses, naming the credit and the room, which
  //                    is the more useful sentence anyway.
  //
  // Refusing on the totals alone discarded 26 programs, some of which fit fine.
  const scheduled = cellsSH(cells.filter(c => c.target !== GENERAL_ELECTIVE));
  const excess = scheduled > total + DEFAULT_UNIT_SH
    ? { scheduled, total, over: scheduled - total } : null;

  const terms = studyTerms(shape);
  if (!terms.length) {
    return {
      reason: "no-study-terms",
      detail: "The plan shape has no term that could hold a course.",
    };
  }

  // ── Capacity, in closed form ────────────────────────────────────
  const need = cellsSH(cells);
  const room = terms.reduce((n, t) =>
    n + termCapacity(t, { creditMax: ports.creditMax, studentType }), 0);
  if (need > room) {
    return {
      reason: "does-not-fit",
      detail: `This program's requirements come to ${need} credits, and ${terms.length} ` +
              `study terms at ${ports.creditMax(studentType)} credits each hold ${room}.`,
      data: { need, room, terms: terms.length },
    };
  }

  // A cell no term can hold. Reported with the reason `buildDomains` derived, so
  // "never offered in any term this plan uses" is distinguishable from "its prereq
  // chain is longer than the plan".
  if (impossible.length) {
    const first = impossible[0];
    return {
      reason: "cell-has-no-legal-term",
      detail: `"${first.title}" cannot be placed in any term of this plan (${first.reason}).`,
      data: { count: impossible.length, cells: impossible.slice(0, 5) },
    };
  }

  return excess ? { warn: "sections-exceed-degree", data: excess } : null;
}

/**
 * A per-term capacity check, for the terms the shape itself over-fills.
 *
 * Distinct from the total: 153 SH can fit 160 SH of total room and still be
 * impossible if a single term must hold 24 of it. Not a refusal — the search can
 * usually move things — but it is the first thing to report when the search fails,
 * so the failure names a term rather than the whole plan.
 */
export function tightestTerms({ plans, terms, ports, studentType }) {
  const out = [];
  terms.forEach((t, ti) => {
    const cap = termCapacity(t, { creditMax: ports.creditMax, studentType });
    // Cells with no other legal term: their load is unavoidable here.
    const forced = plans.filter(p => p.domain.length === 1 && p.domain[0] === ti);
    const forcedSH = forced.reduce((n, p) => n + (p.cell.sh ?? 0), 0);
    if (forcedSH > cap) {
      out.push({ term: ti, label: `${t.label} ${t.termLabel}`.trim(), cap, forcedSH,
                 cells: forced.map(p => p.cell.title) });
    }
  });
  return out;
}
