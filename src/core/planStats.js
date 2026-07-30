// ═══════════════════════════════════════════════════════════════════
// PLAN STATISTICS  (pure domain logic — no React, no I/O)
//
// Derivations behind the Stats panel. Kept institution-agnostic and
// side-effect-free so the numbers are testable and, if wanted later,
// shareable with the MCP query layer (mirrors offeringStats.js). Offering-
// and program-shaped stats (seat availability, instructors, double-count)
// stay in the UI where the injected adapters live.
// ═══════════════════════════════════════════════════════════════════
import { extractEdges } from "./courseModel.js";

// Course numbers ≥ this are graduate level (matches the MCP courseLevel rule).
export const GRAD_LEVEL_MIN = 5000;

/** The 1000-block a course number falls in (1000, 2000, …), or null. */
export function courseTier(number) {
  const n = parseInt(String(number).match(/\d+/)?.[0] ?? "", 10);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n / 1000) * 1000;
}

export function isGradCourse(course) {
  const t = courseTier(course?.number);
  return t != null && t >= GRAD_LEVEL_MIN;
}

/**
 * Level distribution across placed courses: one entry per 1000-tier that
 * actually appears (ascending), plus undergrad-vs-grad totals split at
 * GRAD_LEVEL_MIN.
 *
 * @param {string[]} placedIds
 * @param {Record<string, object>} courseMap
 */
export function levelDistribution(placedIds, courseMap) {
  const tiers = new Map();
  let ugCount = 0, ugSH = 0, gradCount = 0, gradSH = 0;
  for (const id of placedIds) {
    const c = courseMap[id];
    if (!c) continue;
    const tier = courseTier(c.number);
    if (tier == null) continue;
    const sh = c.sh ?? 0;
    const e = tiers.get(tier) ?? { tier, count: 0, sh: 0 };
    e.count += 1; e.sh += sh;
    tiers.set(tier, e);
    if (tier >= GRAD_LEVEL_MIN) { gradCount += 1; gradSH += sh; }
    else                        { ugCount += 1;   ugSH += sh; }
  }
  return {
    tiers: [...tiers.values()].sort((a, b) => a.tier - b.tier),
    undergrad: { count: ugCount, sh: ugSH },
    grad:      { count: gradCount, sh: gradSH },
  };
}

/**
 * Per-department (subject) breakdown, ranked by credits. Each row carries
 * its undergrad/grad split so the bar can show the composition.
 *
 * @param {string[]} placedIds
 * @param {Record<string, object>} courseMap
 */
export function deptBreakdown(placedIds, courseMap) {
  const map = new Map();
  for (const id of placedIds) {
    const c = courseMap[id];
    if (!c?.subject) continue;
    const sh = c.sh ?? 0;
    const grad = isGradCourse(c);
    const e = map.get(c.subject) ??
      { subject: c.subject, count: 0, sh: 0, ugSH: 0, gradSH: 0, ugCount: 0, gradCount: 0 };
    e.count += 1; e.sh += sh;
    if (grad) { e.gradSH += sh; e.gradCount += 1; }
    else      { e.ugSH += sh;   e.ugCount += 1; }
    map.set(c.subject, e);
  }
  return [...map.values()].sort(
    (a, b) => b.sh - a.sh || b.count - a.count || a.subject.localeCompare(b.subject)
  );
}

/**
 * Collapse the semester grid into load-timeline buckets, merging a
 * consecutive Summer A + Summer B into ONE summer bucket (the way the
 * planner pairs them into a SummerRow) and dropping the incoming slot.
 * SH per bucket is left to the caller (it needs the credit helper).
 *
 * @param {{id:string,type:string,semTypeId?:string,label?:string}[]} semesters
 * @returns {{id:string,type:string,semTypeId?:string,semIds:string[],repSem:object,isMergedSummer:boolean}[]}
 */
export function mergeLoadTimeline(semesters) {
  const list = (semesters ?? []).filter(s => s.id !== "incoming");
  const out = [];
  let i = 0;
  while (i < list.length) {
    const sem = list[i];
    const next = list[i + 1];
    const pairedSummer =
      sem.type === "summer" && next?.type === "summer" &&
      next.id.replace("sumB", "") === sem.id.replace("sumA", "");
    if (pairedSummer) {
      out.push({ id: sem.id, type: "summer", semTypeId: sem.semTypeId,
        semIds: [sem.id, next.id], repSem: sem, isMergedSummer: true });
      i += 2;
    } else {
      out.push({ id: sem.id, type: sem.type, semTypeId: sem.semTypeId,
        semIds: [sem.id], repSem: sem, isMergedSummer: false });
      i += 1;
    }
  }
  return out;
}

/**
 * Longest prerequisite chains among placed courses. Edges are restricted to
 * the placed set (a chain you're actually taking), so a lone prereq off-plan
 * doesn't extend it. Cycle-guarded; returns the longest distinct chains,
 * dropping any chain that is a suffix of a longer one already kept.
 *
 * `excludeFromDepth` (e.g. transfer / incoming-credit courses) still appear
 * in the path so a chain reads correctly, but contribute 0 to its depth —
 * the depth counts only the courses that must be taken in-program.
 *
 * `order` (id → semester ordinal) enforces temporal logic: a prerequisite
 * only links to a course when it is actually placed in an EARLIER semester.
 * Without it, a "prereq" you happen to take later (or a transfer course you
 * completed before) would form a nonsensical chain link.
 *
 * @param {string[]} placedIds
 * @param {Record<string, object>} courseMap
 * @param {{ topN?: number, excludeFromDepth?: Set<string>, order?: Record<string, number> }} [opts]
 * @returns {{len:number, path:string[]}[]}
 */
export function longestPrereqChains(placedIds, courseMap, { topN = 3, excludeFromDepth = new Set(), order = null } = {}) {
  const placed = new Set(placedIds);
  const before = (from, to) =>
    !order || (order[from] != null && order[to] != null && order[from] < order[to]);
  const prereqsOf = new Map();
  for (const id of placedIds) {
    const c = courseMap[id];
    if (!c) { prereqsOf.set(id, []); continue; }
    const froms = extractEdges(id, c.prereqs, c.coreqs)
      .filter(e => e.type === "prerequisite" && e.from !== id && placed.has(e.from) && before(e.from, id))
      .map(e => e.from);
    prereqsOf.set(id, [...new Set(froms)]);
  }

  const memo = new Map();
  const visiting = new Set();
  function best(id) {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) return { len: 0, path: [] }; // cycle guard
    visiting.add(id);
    let child = { len: 0, path: [] };
    for (const p of prereqsOf.get(id) ?? []) {
      const r = best(p);
      // Prefer more depth; on a tie prefer the longer path so a zero-weight
      // (excluded) prereq still shows in the chain rather than being dropped.
      if (r.len > child.len || (r.len === child.len && r.path.length > child.path.length)) child = r;
    }
    visiting.delete(id);
    const weight = excludeFromDepth.has(id) ? 0 : 1;
    const res = { len: child.len + weight, path: [...child.path, id] };
    memo.set(id, res);
    return res;
  }

  const chains = placedIds
    .map(best)
    .filter(r => r.len >= 2)
    .sort((a, b) => b.len - a.len);

  const kept = [];
  const keptSigs = [];
  for (const ch of chains) {
    const sig = ch.path.join(">");
    if (keptSigs.some(s => s.includes(sig))) continue; // suffix of a longer chain
    keptSigs.push(sig);
    kept.push(ch);
    if (kept.length >= topN) break;
  }
  return kept;
}
