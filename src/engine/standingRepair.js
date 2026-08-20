// ═══════════════════════════════════════════════════════════════════
// CHART · STANDING REPAIR — the last credit, which the domain cannot see
//
// `buildDomains` narrows a class-standing-gated cell to terms at or after the term
// its credits arrive, and that fixed 53 of the 54 placements measured too early.
// The survivor is structural rather than a bug: the domain is built BEFORE the
// search assigns anything, so the only credit figure available is the shape's
// `targetSH` — what each term INTENDS to carry. The emitted plan can come in
// lighter, and then a floor computed on intent is one course too generous.
//
// MEASURED, over all 278 generable undergraduate plans: exactly one placement, and
// it is short by ONE credit —
//
//   public_health_and_journalism_ba_(boston)
//   "ENGW 3306 or 3314 or 3303"  needs 64 SH (JR)  ·  term 5 holds 63
//
// ── Why a repair and not a bigger margin ────────────────────────────
//
// The obvious alternative is to demand headroom in the floor: require the
// cumulative target to exceed the threshold by a course before allowing the term.
// Measured, that is a bad trade. 672 gated cells are placed across the corpus and
// 200 of them already sit a whole standing ABOVE their gate; a margin pushes every
// one of those later to fix a single case. The engine's own rule applies — do not
// ship what the measurement says is not worth it.
//
// So the correction happens where the real numbers exist: after the search has
// assigned every cell, when per-term credit is known exactly rather than intended.
//
// ── The repair is allowed to fail, and says so ──────────────────────
//
// A nudge is only taken when the destination is provably safe on every axis the
// search itself enforced: the term is in the cell's own DOMAIN (which already
// encodes availability and prerequisite depth), the precedence edges in both
// directions still hold, and the term's credit ceiling is respected. If no such
// term exists the assignment is returned UNCHANGED — a plan that states one course
// one credit early is worth incomparably more than no plan, and this module is the
// last thing standing between a solved arrangement and the student.
// ═══════════════════════════════════════════════════════════════════

import { cellStanding } from "./prereqDepth.js";
import { termCapacity } from "./domains.js";
import { requiredSHFor, earnedSHBefore, meetsStanding } from "../core/classStanding.js";

/**
 * Move class-standing-gated cells later where the assignment's REAL credits leave
 * them short and a safe later term exists.
 *
 * @param {object} args
 * @param {Array<{cell: object, domain: number[]}>} args.plans  cells with domains
 * @param {Map<string, number>} args.termOf        cell id → term index (not mutated)
 * @param {object[]} args.terms                    study terms, in order
 * @param {Record<string, object>} args.courseMap
 * @param {object} [args.precedence]               { before, after, concurrentOk }
 * @param {(studentType: string) => number} [args.creditMax]  the registration cap port
 * @param {string} [args.studentType]
 * @returns {{termOf: Map<string, number>, moved: object[], unfixed: object[]}}
 *   `termOf` is a NEW map when anything moved, the same one when nothing did.
 */
export function repairStanding({
  plans = [], termOf = new Map(), terms = [], courseMap = {},
  precedence = null, creditMax = null, studentType = "undergraduate",
} = {}) {
  const moved = [], unfixed = [];
  // Coerced, not just defaulted: a default only fires for `undefined`, and a caller
  // passing an explicit null — which the engine does for `precedence` on some paths —
  // would otherwise throw here. This runs between a solved arrangement and the
  // student, so it degrades rather than raises.
  const cells = Array.isArray(plans) ? plans : [];
  const start = termOf instanceof Map ? termOf : new Map();
  const ts = Array.isArray(terms) ? terms : [];
  const cmap = courseMap ?? {};
  if (studentType === "graduate" || !cells.length) return { termOf: start, moved, unfixed };

  // Which cells carry a gate at all. Computed once: `cellStanding` walks every
  // option of every cell, and the corpus has cells with 247 of them.
  const gated = [];
  for (const p of cells) {
    const code = cellStanding(p, cmap);
    if (code) gated.push({ p, code, need: requiredSHFor(code) });
  }
  if (!gated.length) return { termOf: start, moved, unfixed };
  const gatedIds = new Set(gated.map(g => g.p.cell.id));

  const at = new Map(start);
  const shOf = (p) => (Number.isFinite(p.cell?.sh) ? p.cell.sh : 0);

  /** Credits actually assigned to each term under `at`. */
  const loads = () => {
    const l = new Array(ts.length).fill(0);
    for (const p of cells) {
      const ti = at.get(p.cell.id);
      if (Number.isFinite(ti) && ti >= 0 && ti < l.length) l[ti] += shOf(p);
    }
    return l;
  };

  // The REGISTRATION cap, not `targetSH`. shape.js documents targetSH as a "soft
  // target" and the search routinely exceeds it; using it here as a ceiling rejected
  // every candidate term and the repair silently did nothing on the one case it was
  // written for. `termCapacity` is the bound the search itself respects, including
  // `creditCeiling` as an ABSOLUTE override where a department published the term's
  // size — which is the case that must not be overrun.
  const ceilingOf = (ti) => {
    const t = ts[ti];
    if (!t) return Infinity;
    if (!creditMax) return Infinity;
    return termCapacity(t, { creditMax, studentType });
  };

  /** Does moving `p` to `to` keep every precedence edge the search enforced? */
  const orderOk = (p, to) => {
    if (!precedence) return true;
    const id = p.cell.id;
    const concurrent = (a, b) =>
      precedence.concurrentOk?.has(`${a}|${b}`) || precedence.concurrentOk?.has(`${b}|${a}`);
    for (const other of precedence.before?.get(id) ?? []) {
      const t = at.get(other);
      if (!Number.isFinite(t)) continue;
      if (!(t < to || (t === to && concurrent(other, id)))) return false;
    }
    for (const other of precedence.after?.get(id) ?? []) {
      const t = at.get(other);
      if (!Number.isFinite(t)) continue;
      if (!(to < t || (to === t && concurrent(id, other)))) return false;
    }
    return true;
  };

  // Latest-first, so moving one cell cannot invalidate a decision already made
  // about a later one. Bounded by the number of gated cells: each may move once.
  const order = [...gated].sort((a, b) => (at.get(b.p.cell.id) ?? 0) - (at.get(a.p.cell.id) ?? 0));

  for (const g of order) {
    const id = g.p.cell.id;
    const from = at.get(id);
    if (!Number.isFinite(from)) continue;
    let load = loads();
    if (meetsStanding(earnedSHBefore(from, load, 0), g.code)) continue;

    // Candidate terms: later than now, inside the cell's own domain, and — checked
    // against the loads WITHOUT this cell, since moving it out of `from` lowers the
    // credit that precedes any destination beyond it.
    const without = load.slice();
    without[from] -= shOf(g.p);
    let to = null, swapWith = null;
    for (const cand of (g.p.domain ?? []).filter(t => t > from).sort((a, b) => a - b)) {
      if (!meetsStanding(earnedSHBefore(cand, without, 0), g.code)) continue;
      if (!orderOk(g.p, cand)) continue;
      if (without[cand] + shOf(g.p) <= ceilingOf(cand)) { to = cand; break; }

      // ── No room, so EXCHANGE rather than give up ────────────────────
      //
      // The measured case needed this and a plain move could never have found it:
      // every later term in the domain satisfied the standing and the ordering, and
      // all three were full — one at its 19 SH cap, two half-weight summers at 8 of
      // 9.5. Trading places with an ungated cell already there keeps both terms
      // inside their caps and is the same local exchange `improve` performs, applied
      // to the one property it does not know about.
      //
      // Only ever with an UNGATED partner: swapping two gated cells could satisfy one
      // by breaking the other, and this pass runs once.
      for (const q of cells) {
        if (q === g.p) continue;
        if (at.get(q.cell.id) !== cand) continue;
        if (gatedIds.has(q.cell.id)) continue;
        if (!(q.domain ?? []).includes(from)) continue;
        const a = shOf(g.p), b = shOf(q);
        if (without[cand] - b + a > ceilingOf(cand)) continue;
        if (without[from] + b > ceilingOf(from)) continue;
        // Precedence for BOTH cells, checked against the swap actually applied —
        // `orderOk` reads the live assignment, so a tentative write is the only
        // honest way to ask.
        at.set(g.p.cell.id, cand); at.set(q.cell.id, from);
        const ok = orderOk(g.p, cand) && orderOk(q, from);
        at.set(g.p.cell.id, from); at.set(q.cell.id, cand);
        if (!ok) continue;
        to = cand; swapWith = q;
        break;
      }
      if (to !== null) break;
    }
    if (to === null) {
      if (process.env.CHART_STANDING_DEBUG) {
        const why = (g.p.domain ?? []).filter(t => t > from).map(cand => {
          const okStd = meetsStanding(earnedSHBefore(cand, without, 0), g.code);
          const fits  = without[cand] + shOf(g.p) <= ceilingOf(cand);
          const ord   = orderOk(g.p, cand);
          return `t${cand}[std=${okStd?"y":"n"} fit=${fits?"y":"n"}(${without[cand]}+${shOf(g.p)}<=${ceilingOf(cand)}) ord=${ord?"y":"n"}]`;
        });
        process.stderr.write(`  [standing-repair] ${id} need ${g.need} at t${from} (earned ${earnedSHBefore(from, load, 0)}) `
          + `domain=[${(g.p.domain ?? []).join(",")}] → ${why.join(" ") || "NO LATER TERM IN DOMAIN"}\n`);
      }
      unfixed.push({ cell: id, code: g.code, need: g.need,
                     earned: earnedSHBefore(from, load, 0), term: from });
      continue;
    }
    at.set(id, to);
    if (swapWith) at.set(swapWith.cell.id, from);
    moved.push({ cell: id, code: g.code, from, to,
                 ...(swapWith ? { swappedWith: swapWith.cell.id } : {}) });
  }

  return { termOf: moved.length ? at : start, moved, unfixed };
}
