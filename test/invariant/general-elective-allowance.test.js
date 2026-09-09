// ═══════════════════════════════════════════════════════════════════
// INVARIANT · no shipped program prints a satisfied requirement we never measured.
//
// `test/unit/general-electives.test.js` proves the RULE on hand-built records.
// This proves the CONSEQUENCE on every program we ship, because "the rule is
// right" and "no student's audit claims a met requirement it cannot support"
// are different statements and only the second one reaches anybody.
//
// ── The defect, as it appeared ──────────────────────────────────────
//
// General Electives is built with `sat: true` unconditionally — it is a bucket,
// not a requirement, so there is nothing for it to fail. Its DENOMINATOR came
// from `max(0, (totalCreditsRequired ?? 0) - demand)`, and that `?? 0` turned a
// missing total into a measured zero. The printed report then drew:
//
//     ✓  General Electives                                    0/0 SH
//        ████████████████████████████████████████████████████ 100%
//
// on every degree whose total we do not hold — a fully satisfied requirement,
// on a degree whose size is unknown to us. Same row, same green, as the ones
// the student actually earned.
//
// ── Why the number is not asserted ─────────────────────────────────
//
// The counts move on every edition roll and on every parser fix, in both
// directions, and a corpus test pinned to one of them fails for no defect. What
// is pinned is the PROPERTY (no row claims a measurement it does not have) plus
// the two guard-the-guard floors, so a walk that silently reads nothing cannot
// pass. The distribution is reported for a reader, not asserted.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generalElectiveSHOf } from "../../src/core/requirementBinding.js";
import {
  calculateGeneralElectives, generalElectivesWorthShowing,
} from "../../src/core/gradRequirements.js";
import { sectionProgress } from "../../src/core/planModel.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Every shipped requirements.json, with its path. */
function* shippedPrograms() {
  for (const tree of ["undergraduate", "graduate"]) {
    const base = join(ROOT, "data/northeastern/programs", tree);
    if (!existsSync(base)) continue;
    for (const year of readdirSync(base)) {
      const yd = join(base, year);
      if (!/^\d{4}$/.test(year) || !statSync(yd).isDirectory()) continue;
      for (const college of readdirSync(yd)) {
        const cd = join(yd, college);
        if (!statSync(cd).isDirectory()) continue;
        for (const folder of readdirSync(cd)) {
          const f = join(cd, folder, "requirements.json");
          if (!existsSync(f)) continue;
          let data;
          try { data = JSON.parse(readFileSync(f, "utf8")); } catch { continue; }
          yield { tree, year, folder, data };
        }
      }
    }
  }
}

test("no shipped program renders a General Electives row it cannot support", () => {
  const seen = { programs: 0, positive: 0, zero: 0, unknown: 0, shown: 0 };
  const offenders = [];

  for (const { tree, year, folder, data } of shippedPrograms()) {
    seen.programs++;
    const allowance = generalElectiveSHOf(data, {});

    // The rule's own three-way split, counted so a reader can see the shape.
    if (allowance === null) seen.unknown++;
    else if (allowance > 0) seen.positive++;
    else seen.zero++;

    // The EMPTY plan is the case that shipped: a student who has just chosen
    // their program and placed nothing. Anything the row says here it says
    // without a single course to support it.
    const section = calculateGeneralElectives(new Set(), new Set(), {}, allowance);
    if (!generalElectivesWorthShowing(section)) continue;
    seen.shown++;

    const p = sectionProgress(section);
    // A row that IS shown on an empty plan must have a real denominator — that
    // is the only thing that can make it worth a student's attention.
    if (!(Number.isFinite(section.requiredSH) && section.requiredSH > 0)) {
      offenders.push(`${tree}/${year}/${folder}: shown with requiredSH=${section.requiredSH}`);
    }
    if (p.allowanceUnknown) {
      offenders.push(`${tree}/${year}/${folder}: shown while the allowance is unknown`);
    }
  }

  // Guard the guard. A walk that finds nothing passes every assertion above.
  assert.ok(seen.programs > 1500,
    `only ${seen.programs} programs read — has the tree moved?`);
  assert.ok(seen.positive > 300,
    `only ${seen.positive} programs have a positive allowance — has the rule inverted?`);
  assert.ok(seen.unknown > 0,
    "no program has an unknown allowance, so this test is not exercising the case it exists for");

  assert.deepEqual(offenders, [],
    `${offenders.length} program(s) print a free-elective figure they cannot support:\n  `
    + offenders.slice(0, 20).join("\n  "));

  console.log(`  ${seen.programs} programs · allowance positive ${seen.positive}, `
    + `zero ${seen.zero}, unknown ${seen.unknown} · rows shown on an empty plan ${seen.shown}`);
});

test("a zero allowance still shows once the student places credit against it", () => {
  // The other direction, and the reason the fix is a worth-showing rule rather
  // than "hide it when it is zero". A degree whose requirements already consume
  // its total is exactly where an extra course matters most: it is credit the
  // degree does not account for, and the student has to be able to see it.
  const cm = { XX1000: { subject: "XX", number: "1000", sh: 4 } };
  const s = calculateGeneralElectives(new Set(["XX1000"]), new Set(), cm, 0);
  assert.equal(s.placedSH, 4);
  assert.equal(generalElectivesWorthShowing(s), true,
    "4 SH beyond a full degree was hidden");
  assert.equal(sectionProgress(s).allowanceUnknown, false,
    "a measured zero must not be reported as an unknown");
});

test("an unknown allowance shows once credit is placed, and says it cannot measure", () => {
  const cm = { XX1000: { subject: "XX", number: "1000", sh: 4 } };
  const s = calculateGeneralElectives(new Set(["XX1000"]), new Set(), cm, null);
  assert.equal(generalElectivesWorthShowing(s), true);
  const p = sectionProgress(s);
  assert.equal(p.allowanceUnknown, true);
  assert.equal(p.hasSplit, false, "would have printed `4 completed + 0 planned of null SH`");
});
