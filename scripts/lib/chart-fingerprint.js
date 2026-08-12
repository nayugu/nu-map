/**
 * chart-fingerprint.js — one hash per generated plan, so "this change moved nothing" is a
 * measurement instead of a claim.
 *
 * ── Why this exists ─────────────────────────────────────────────────
 *
 * Every coverage fix from here on has to satisfy a constraint that is easy to state and easy
 * to violate silently: the 647 shapes that generate today must come out IDENTICAL. A change
 * that raises coverage while quietly re-sequencing programs that were already good is not an
 * improvement, and nothing currently notices it.
 *
 * The reason argument is not enough here is measured rather than theoretical. Three separate
 * comparisons during this work were confounded, the worst of them attributing a
 * "85 → 68 programs" swing to one change when it spanned six commits — the controlled test
 * was 66 → 68. An instrument that names exactly which shapes moved makes that class of
 * mistake impossible rather than unlikely.
 *
 * ── Not a committed baseline, and that is deliberate ────────────────
 *
 * The obvious design is a checked-in file of expected hashes, failing CI on any change. It is
 * the wrong design HERE, for a reason specific to this repository: the catalog is re-scraped
 * on the 1st and program requirements bimonthly, both pushing straight to `main` unattended.
 * A course whose offering history tips past the availability bar legitimately changes a plan.
 * A committed baseline would therefore fail the monthly data workflow every month, and a gate
 * that cries every month is a gate people learn to regenerate without reading.
 *
 * So this is a DEVELOPMENT instrument: snapshot before a change, snapshot after, diff the two,
 * with the data held fixed. That is the comparison that was actually needed and repeatedly not
 * made. It couples to nothing and cannot break a pipeline.
 *
 * ── What is hashed is what a student would see ───────────────────────
 *
 * The plan as the grid renders it: every term in order, and within a term every cell in order,
 * with its title, credits and named options. Deliberately NOT hashed: node counts, timings,
 * which rung answered, scores. Those are diagnostics about HOW the plan was found, and they
 * may move freely — a plan found in fewer nodes is the same plan. Including them would make
 * the instrument fire on changes that alter nothing the student sees, which is the same
 * false-alarm failure as the committed baseline.
 */
import { createHash } from "node:crypto";

/**
 * A stable, human-inspectable canonical form of one plan.
 *
 * Text rather than JSON so a diff of two snapshots is readable when a hash does move — the
 * point of the instrument is to say WHAT changed, and a pair of hashes cannot.
 *
 * @param {object} plan one entry of `plans[]` from a generated document
 * @returns {string}
 */
export function canonicalPlan(plan) {
  const lines = [];
  for (const year of plan?.years ?? []) {
    for (const t of year.terms ?? []) {
      const cells = [];
      const walk = (entries, depth) => {
        for (const e of entries ?? []) {
          // A co-op and a vacation are part of the shape, so they are part of the identity:
          // a plan whose co-op moved is a different plan even if every course sits where it
          // did before.
          const kind = e.coop ? "COOP" : e.vacation ? "VAC" : e.heading ? "HEAD" : "CELL";
          const opts = (e.options ?? []).map(g => [...g].sort().join("+")).sort().join("/");
          cells.push(`${"  ".repeat(depth)}${kind} ${e.text ?? ""} `
            + `[${e.sh ?? 0}]${opts ? ` {${opts}}` : ""}`);
          walk(e.children, depth + 1);
        }
      };
      walk(t.entries, 0);
      lines.push(`${year.label ?? ""} / ${t.term ?? ""} (${t.type ?? ""})`);
      // Cells are NOT sorted: order within a term is part of what the grid shows, and a
      // reordering is a change worth seeing.
      for (const c of cells) lines.push(`  ${c}`);
    }
  }
  return lines.join("\n");
}

/** @returns {string} a short hash of `canonicalPlan`, for cheap equality. */
export function fingerprintPlan(plan) {
  return createHash("sha1").update(canonicalPlan(plan)).digest("hex").slice(0, 16);
}

/**
 * Compare two snapshots and say what moved, in the four categories that mean different things.
 *
 * `gained` and `lost` are the coverage story; `moved` is the one this instrument exists for,
 * because it is the one that is otherwise invisible.
 *
 * @param {Record<string,string>} before label → hash
 * @param {Record<string,string>} after
 */
export function compareFingerprints(before, after) {
  const labels = new Set([...Object.keys(before), ...Object.keys(after)]);
  const same = [], moved = [], gained = [], lost = [];
  for (const label of [...labels].sort()) {
    const b = before[label], a = after[label];
    if (b && a) (b === a ? same : moved).push(label);
    else if (a) gained.push(label);
    else lost.push(label);
  }
  return { same, moved, gained, lost };
}
