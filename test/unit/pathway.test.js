// ═══════════════════════════════════════════════════════════════════
// PATHWAY (PlusOne) — hostile tests.
//
// Confirming tests are close to worthless in this repo. These are the ones that
// pay: the safety invariant, the disjunctive cap that everyone gets wrong, the
// direction of the substitution arrow, and inertness.
// ═══════════════════════════════════════════════════════════════════

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  RULE_KINDS, ALL_RULE_KINDS, RULE_CLASS, STATUS, mayViolate, ruleClass,
} from "../../src/core/pathway/ruleKinds.js";
import { EVALUATORS } from "../../src/core/pathway/rules/index.js";
import { evaluateRule, evaluatePathway, summarise } from "../../src/core/pathway/evaluate.js";
import {
  activeShares, pathwaySubstitutions, mergeSubstitutions, assertOneWay,
  shareTotals, excludedIds, resolveCandidates, ambiguousShares,
  shareCandidates, hasOpenShareDomain,
} from "../../src/core/pathway/shareSet.js";
import {
  selectPathways, msProgramFor, isStale, isEligibleFor, matchesEligibility, collegeOf,
} from "../../src/core/pathway/select.js";
import { plannerId, displayCode, inDomain, isGradCode, isUgCode } from "../../src/core/pathway/ids.js";
import { applySubstitutions } from "../../src/core/planModel.js";
import { planConditions } from "../../src/core/prereqConditions.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

// ── load the shipped pathways with fs (no Vite in Node) ───────────
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    // "_" prefix = intake artefact (_inventory.json, _cache/), not a pathway.
    if (name.startsWith("_")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".json")) out.push(p);
  }
  return out;
}
const PATHWAYS = walk(join(ROOT, "data/northeastern/pathways"))
  .map(f => JSON.parse(readFileSync(f, "utf8")))
  .sort((a, b) => a.id.localeCompare(b.id));

const COURSES = JSON.parse(readFileSync(join(ROOT, "public/northeastern/catalog-courses.json"), "utf8"));
const courseMap = Object.fromEntries(COURSES.map(c => [`${c.subject}${c.number}`, c]));

const byId = id => PATHWAYS.find(p => p.id === id);
const MSCS = "khoury/bscs-to-mscs";
const CMPE = "khoury/bscmpe-to-mscs";

/** Minimal ctx builder. */
function ctxFor(pathway, { placements = {}, grades = {}, semIndex = null, includeWithdrawn } = {}) {
  const shares = activeShares({
    pathway, placements, courseMap, grades,
    isVoid: g => g === "W" || g === "F" || g === "U",
  });
  const counting = pathway.counting ?? {};
  return {
    pathway, shares, placements, courseMap, semIndex,
    candidates: resolveCandidates(pathway, { excluded: excludedIds(pathway) }),
    totals: shareTotals(shares, {
      includeWithdrawn: includeWithdrawn ?? !!counting.includeWithdrawn,
    }),
  };
}

// ═══════════════════════════════════════════════════════════════════
describe("the safety invariant — only computable rules may fail a student", () => {
  test("every kind in the vocabulary has an evaluator, and vice versa", () => {
    for (const kind of ALL_RULE_KINDS) {
      assert.equal(typeof EVALUATORS[kind], "function", `no evaluator for kind "${kind}"`);
    }
    for (const kind of Object.keys(EVALUATORS)) {
      assert.ok(RULE_KINDS[kind], `evaluator "${kind}" is not in RULE_KINDS`);
    }
  });

  test("mayViolate is true for computable kinds and false for every other class", () => {
    for (const kind of ALL_RULE_KINDS) {
      const cls = ruleClass(kind);
      assert.equal(mayViolate(kind), cls === RULE_CLASS.COMPUTABLE, `${kind} (${cls})`);
    }
  });

  test("an unknown kind never violates — it degrades to unknown", () => {
    assert.equal(mayViolate("noSuchRuleKind"), false);
    const d = evaluateRule({ kind: "noSuchRuleKind" }, ctxFor(byId(MSCS)));
    assert.equal(d.status, STATUS.UNKNOWN);
  });

  // The real teeth. A deliberately misbehaving evaluator is injected for EVERY
  // non-computable kind, and the ENGINE — not a copy of its logic — has to
  // refuse to pass the failure through.
  const rogue = () => ({ status: STATUS.VIOLATED, messageKey: "rogue", evidence: {} });

  test("the engine downgrades a violated status from every non-computable kind", () => {
    const nonComputable = ALL_RULE_KINDS.filter(k => ruleClass(k) !== RULE_CLASS.COMPUTABLE);
    assert.ok(nonComputable.length >= 9, `expected several, got ${nonComputable.length}`);

    for (const kind of nonComputable) {
      const d = evaluateRule({ kind }, ctxFor(byId(MSCS)), {
        evaluators: { ...EVALUATORS, [kind]: rogue },
      });
      assert.equal(d.status, STATUS.UNKNOWN, `${kind} must not be able to violate`);
      assert.equal(d.evidence.downgradedFrom, STATUS.VIOLATED,
        `${kind} should record that it was downgraded`);
    }
  });

  test("a computable kind IS allowed through the same seam", () => {
    const d = evaluateRule({ kind: "shareCap" }, ctxFor(byId(MSCS)), {
      evaluators: { ...EVALUATORS, shareCap: rogue },
    });
    assert.equal(d.status, STATUS.VIOLATED,
      "the guard must be about the class, not about suppressing everything");
  });

  test("strict mode throws on a breach instead of silently downgrading", () => {
    assert.throws(
      () => evaluateRule({ kind: "gpaMin", min: 3.0 }, ctxFor(byId(MSCS)), {
        strict: true, evaluators: { ...EVALUATORS, gpaMin: rogue },
      }),
      /may never report "violated"/,
    );
  });

  test("the shipped evaluators pass strict mode on every pathway", () => {
    for (const p of PATHWAYS) {
      assert.doesNotThrow(() => evaluatePathway(ctxFor(p), { strict: true }), p.id);
    }
  });

  test("no shipped pathway produces a violation from a non-computable rule", () => {
    for (const p of PATHWAYS) {
      for (const d of evaluatePathway(ctxFor(p))) {
        if (d.status === STATUS.VIOLATED) {
          assert.equal(ruleClass(d.kind), RULE_CLASS.COMPUTABLE, `${p.id}: ${d.kind}`);
        }
      }
    }
  });

  test("an evaluator that throws degrades to unknown instead of taking the panel down", () => {
    // subBudget with a malformed domain must not crash the run.
    const d = evaluateRule({ kind: "subBudget", domain: null, maxSH: 8 }, ctxFor(byId(MSCS)));
    assert.ok([STATUS.SATISFIED, STATUS.UNKNOWN, STATUS.INFO].includes(d.status));
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("the share cap is DISJUNCTIVE — four courses OR 16 SH", () => {
  const cap = { kind: "shareCap", courses: 4, semesterHours: 16 };
  const run = totals => evaluateRule(cap, { ...ctxFor(byId(MSCS)), totals });

  test("4 courses / 16 SH — the plain case", () => {
    assert.equal(run({ courses: 4, semesterHours: 16 }).status, STATUS.SATISFIED);
  });

  // Bouvé: five 3 SH courses. Fails the course limb, passes the SH limb.
  test("Bouvé's 5 courses at 15 SH is LEGAL (the SH limb carries it)", () => {
    const d = run({ courses: 5, semesterHours: 15 });
    assert.equal(d.status, STATUS.SATISFIED);
    assert.equal(d.evidence.byCourses, false);
    assert.equal(d.evidence.bySH, true);
  });

  // College of Science: 17 SH over four courses. Fails the SH limb, passes the course limb.
  test("the College of Science's 17 SH over 4 courses is LEGAL (the course limb carries it)", () => {
    const d = run({ courses: 4, semesterHours: 17 });
    assert.equal(d.status, STATUS.SATISFIED);
    assert.equal(d.evidence.byCourses, true);
    assert.equal(d.evidence.bySH, false);
  });

  test("5 courses at 20 SH fails BOTH limbs and is the only violation", () => {
    assert.equal(run({ courses: 5, semesterHours: 20 }).status, STATUS.VIOLATED);
  });

  // An `&&` implementation passes the first case and fails both middle ones;
  // Math.min fails them too. This asserts the shape, not just the outcomes.
  test("neither AND nor min could produce these four results", () => {
    const results = [
      [4, 16, STATUS.SATISFIED],
      [5, 15, STATUS.SATISFIED],
      [4, 17, STATUS.SATISFIED],
      [5, 20, STATUS.VIOLATED],
    ].map(([c, sh, want]) => run({ courses: c, semesterHours: sh }).status === want);
    assert.deepEqual(results, [true, true, true, true]);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("substitutions run one way: graduate → undergraduate", () => {
  test("every shipped pathway produces only grad→ug pairs", () => {
    for (const p of PATHWAYS) {
      const subs = pathwaySubstitutions({ pathway: p, placements: {} });
      assert.deepEqual(assertOneWay(subs), [], `${p.id} produced a reversed pair`);
    }
  });

  test("a reversed pair is detected rather than tolerated", () => {
    assert.deepEqual(assertOneWay([{ from: "CS3000", to: "CS5800" }]),
                     [{ from: "CS3000", to: "CS5800" }]);
    assert.deepEqual(assertOneWay([{ from: "CS5800", to: "CS3000" }]), []);
  });

  test("the graduate side satisfies the undergraduate side, never the reverse", () => {
    const p = byId(MSCS);
    const subs = pathwaySubstitutions({ pathway: p, placements: { CS5800: "fall2026" } });
    // grad placed → ug satisfied
    const withGrad = applySubstitutions({ CS5800: "fall2026" }, subs);
    assert.equal(withGrad.CS3000, "fall2026", "CS 5800 should satisfy CS 3000");
    // ug placed → grad NOT satisfied
    const withUg = applySubstitutions({ CS3000: "fall2026" }, subs);
    assert.equal(withUg.CS5800, undefined, "CS 3000 must never satisfy CS 5800");
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("declaring a pathway is inert until a graduate course is placed", () => {
  test("pre-armed substitutions leave an empty plan byte-identical", () => {
    const p = byId(MSCS);
    const placements = { CS2500: "fall2025", CS2510: "spring2026" };
    const subs = pathwaySubstitutions({ pathway: p, placements });
    assert.ok(subs.length >= 10, "expect the pathway to pre-arm its table");

    const before = JSON.stringify(placements);
    const after = applySubstitutions(placements, subs);
    assert.equal(JSON.stringify(placements), before, "must not mutate");
    assert.deepEqual(after, placements, "no placed graduate course ⇒ no effect");
  });

  test("an unplaced substitution contributes no credit", () => {
    const p = byId(MSCS);
    const subs = pathwaySubstitutions({ pathway: p, placements: {} });
    const out = applySubstitutions({}, subs);
    assert.deepEqual(out, {});
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("noGradIfUgDone — the share is withdrawn, not merely flagged", () => {
  test("placing the undergraduate version removes the pair from the offer", () => {
    const p = byId(MSCS);
    const without = pathwaySubstitutions({ pathway: p, placements: {} });
    assert.ok(without.some(s => s.from === "CS5800" && s.to === "CS3000"));

    const withUg = pathwaySubstitutions({ pathway: p, placements: { CS3000: "fall2025" } });
    assert.ok(!withUg.some(s => s.to === "CS3000"),
      "CS 3000 already taken ⇒ CS 5800 may not be shared for it");
  });

  test("removing the undergraduate placement restores the pair", () => {
    const p = byId(MSCS);
    const back = pathwaySubstitutions({ pathway: p, placements: { CS2500: "fall2025" } });
    assert.ok(back.some(s => s.from === "CS5800" && s.to === "CS3000"));
  });

  test("placing BOTH is reported, since the student can still do it", () => {
    const p = byId(MSCS);
    const ctx = ctxFor(p, { placements: { CS3000: "fall2025", CS5800: "fall2026" } });
    const d = evaluateRule({ kind: "noGradIfUgDone" }, ctx);
    assert.equal(d.status, STATUS.VIOLATED);
    assert.deepEqual(d.evidence.conflicts, [{ grad: "CS5800", ug: "CS3000" }]);
  });

  test("a repeat instance of the undergraduate version still counts as taken", () => {
    const p = byId(MSCS);
    const subs = pathwaySubstitutions({ pathway: p, placements: { "CS3000#2": "fall2025" } });
    assert.ok(!subs.some(s => s.to === "CS3000"));
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("mandatory and conditionally-mandatory shares", () => {
  test("CS 5010 is mandatory for the Computer Engineering pathway", () => {
    const d = evaluateRule({ kind: "mandatoryShares" }, ctxFor(byId(CMPE)));
    assert.equal(d.status, STATUS.VIOLATED);
    assert.ok(d.evidence.required.includes("CS5010"));
    assert.ok(d.evidence.missing.includes("CS5010"));
  });

  test("CS 5800 stops being mandatory once CS 3000 is in the plan", () => {
    const without = evaluateRule({ kind: "mandatoryShares" }, ctxFor(byId(CMPE)));
    assert.ok(without.evidence.required.includes("CS5800"));

    const withUg = evaluateRule({ kind: "mandatoryShares" },
      ctxFor(byId(CMPE), { placements: { CS3000: "fall2025" } }));
    assert.ok(!withUg.evidence.required.includes("CS5800"),
      "CS 3000 completed ⇒ CS 5800 is no longer required");
  });

  test("placing every mandatory share satisfies the rule", () => {
    const d = evaluateRule({ kind: "mandatoryShares" },
      ctxFor(byId(CMPE), { placements: { CS5010: "fall2026", CS5800: "spring2027" } }));
    assert.equal(d.status, STATUS.SATISFIED);
  });

  test("a pathway with no mandatory shares is satisfied, not violated", () => {
    const d = evaluateRule({ kind: "mandatoryShares" }, ctxFor(byId(MSCS)));
    assert.equal(d.status, STATUS.SATISFIED);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("chooseK refuses to guess an ambiguous source", () => {
  test("the Computer Engineering pathway reports unknown, not a number", () => {
    const rule = byId(CMPE).rules.find(r => r.kind === "chooseK");
    assert.equal(rule.counts, "unknown", "the source does not resolve this");
    const d = evaluateRule(rule, ctxFor(byId(CMPE)));
    assert.equal(d.status, STATUS.UNKNOWN);
  });

  test("but the university cap is still enforced on that pathway", () => {
    const placements = {
      CS5010: "fall2026", CS5800: "spring2027", CS5200: "fall2027",
      CS5600: "spring2028", CS5700: "fall2028",
    };
    const d = evaluateRule({ kind: "shareCap", courses: 4, semesterHours: 16 },
      ctxFor(byId(CMPE), { placements }));
    assert.equal(d.status, STATUS.VIOLATED, "5 courses / 20 SH must fail both limbs");
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("per-term rate limit, and the counting conventions that differ", () => {
  test("Khoury allows one graduate course per term", () => {
    const ok = evaluateRule({ kind: "maxGradCoursesPerTerm", max: 1 },
      ctxFor(byId(MSCS), { placements: { CS5800: "fall2026", CS5200: "spring2027" } }));
    assert.equal(ok.status, STATUS.SATISFIED);

    const bad = evaluateRule({ kind: "maxGradCoursesPerTerm", max: 1 },
      ctxFor(byId(MSCS), { placements: { CS5800: "fall2026", CS5200: "fall2026" } }));
    assert.equal(bad.status, STATUS.VIOLATED);
  });

  test("History's two-per-term is the same rule with different data", () => {
    const d = evaluateRule({ kind: "maxGradCoursesPerTerm", max: 2 },
      ctxFor(byId(MSCS), { placements: { CS5800: "fall2026", CS5200: "fall2026" } }));
    assert.equal(d.status, STATUS.SATISFIED, "two per term is legal where published");
  });

  test("an unstated limit checks nothing rather than defaulting to 1", () => {
    const d = evaluateRule({ kind: "maxGradCoursesPerTerm" }, ctxFor(byId(MSCS)));
    assert.equal(d.status, STATUS.UNKNOWN);
  });

  test("withdrawals count toward the budget but not toward the per-term rate", () => {
    const placements = { CS5800: "fall2026", CS5200: "fall2026" };
    const grades = { CS5200: "W" };

    const rate = evaluateRule({ kind: "maxGradCoursesPerTerm", max: 1 },
      ctxFor(byId(MSCS), { placements, grades }));
    assert.equal(rate.status, STATUS.SATISFIED, "a withdrawn course is not being carried");

    const shares = activeShares({
      pathway: byId(MSCS), placements, courseMap, grades, isVoid: g => g === "W",
    });
    assert.equal(shareTotals(shares, { includeWithdrawn: true }).courses, 2);
    assert.equal(shareTotals(shares, { includeWithdrawn: false }).courses, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("earliestTerm is stated, never evaluated", () => {
  // Demoted from computable after driving the real app: summers occupy term
  // ordinals, so "the fall of year two" is the 5th term for a fall entrant and
  // a different one for a spring entrant. An ordinal threshold produced a false
  // violation on a legal plan. See rules/earliestTerm.js.
  const semIndex = { incoming: 0, fall2026: 1, spr2027: 2, sumA2027: 3, sumB2027: 4, fall2027: 5 };

  test("it never reports a violation, whatever the placement", () => {
    for (const semId of ["fall2026", "sumA2027", "fall2027", "fall2099"]) {
      const d = evaluateRule({ kind: "earliestTerm", afterTerms: 3 },
        ctxFor(byId(MSCS), { placements: { CS5800: semId }, semIndex }));
      assert.equal(d.status, STATUS.INFO, semId);
      assert.equal(d.evidence.evaluated, false);
    }
  });

  test("the class prevents it violating even if the evaluator regresses", () => {
    assert.equal(ruleClass("earliestTerm"), RULE_CLASS.INFORMATIONAL);
    assert.equal(mayViolate("earliestTerm"), false);
  });

  // The measurement that forced the demotion, pinned so a future "fix" that
  // reinstates an ordinal threshold has to confront it.
  test("summer terms occupy ordinals, so fall of year two is NOT the third term", () => {
    assert.equal(semIndex.sumA2027, 3, "the 3rd term is a summer");
    assert.equal(semIndex.fall2027, 5, "the fall of year two is the 5th");
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("targets that are not courses produce no substitution", () => {
  test("a requirement target is carried but never substituted", () => {
    const p = byId("khoury/to-ms-cybersecurity");
    const reqShares = p.shares.filter(s => s.target.kind === "requirement");
    assert.equal(reqShares.length, 3, "three Cybersecurity Elective rows");

    const subs = pathwaySubstitutions({ pathway: p, placements: { CY5010: "fall2026" } });
    assert.ok(!subs.some(s => s.from === "CY5010"),
      "an elective requirement has no single course to satisfy");
  });

  test("but such a share is still ACTIVE and still consumes the cap", () => {
    const p = byId("khoury/to-ms-cybersecurity");
    const ctx = ctxFor(p, { placements: { CY5010: "fall2026" } });
    assert.ok(ctx.shares.some(s => s.gradId === "CY5010"));
    assert.equal(ctx.totals.courses, 1);
  });

  test("a slot target likewise: CS 5010 shares without replacing a course", () => {
    const subs = pathwaySubstitutions({ pathway: byId(CMPE), placements: { CS5010: "fall2026" } });
    assert.ok(!subs.some(s => s.from === "CS5010"));
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("excludedFromShare", () => {
  const pathway = {
    id: "test/excluded",
    shares: [{ grad: "CS 5800", target: { kind: "course", ref: "CS 3000" } }],
    rules: [{ kind: "excludedFromShare", courses: ["EECE 5698", "EECE 6400"] }],
  };

  test("a listed course never becomes a candidate", () => {
    const p = { ...pathway, shares: [...pathway.shares, { grad: "EECE 5698", target: { kind: "slot", label: "x" } }] };
    const ids = resolveCandidates(p, { excluded: excludedIds(p) }).map(c => c.gradId);
    assert.ok(!ids.includes("EECE5698"));
    assert.ok(ids.includes("CS5800"));
  });

  test("placing one is reported, because the student may think it shares", () => {
    const d = evaluateRule(pathway.rules[0], ctxFor(pathway, { placements: { EECE5698: "fall2026" } }));
    assert.equal(d.status, STATUS.VIOLATED);
    assert.deepEqual(d.evidence.placed, ["EECE5698"]);
  });

  test("not placing one is satisfied", () => {
    const d = evaluateRule(pathway.rules[0], ctxFor(pathway));
    assert.equal(d.status, STATUS.SATISFIED);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("subBudget — one evaluator, eleven published rules", () => {
  const domain = { excludeSubject: "EECE", min: 5000 };

  test("ECE's non-EECE ceiling is enforced when the concentration matches", () => {
    const pathway = {
      id: "t", shares: [
        { grad: "CS 5800", target: { kind: "slot", label: "TE" } },
        { grad: "CS 5200", target: { kind: "slot", label: "TE" } },
      ],
      rules: [], selectedMsConcentration: "CCSP",
    };
    const ctx = ctxFor(pathway, { placements: { CS5800: "f", CS5200: "s" } });
    ctx.pathway.selectedMsConcentration = "CCSP";
    const d = evaluateRule(
      { kind: "subBudget", domain, maxSH: 8, scope: { msConcentration: "CCSP" } }, ctx);
    assert.equal(d.status, STATUS.SATISFIED, "8 SH of non-EECE is exactly the CCSP limit");
    assert.equal(d.evidence.usedSH, 8);
  });

  test("over the ceiling violates", () => {
    const pathway = {
      id: "t", shares: [
        { grad: "CS 5800", target: { kind: "slot", label: "TE" } },
        { grad: "CS 5200", target: { kind: "slot", label: "TE" } },
        { grad: "CS 5600", target: { kind: "slot", label: "TE" } },
      ],
      rules: [], selectedMsConcentration: "CCSP",
    };
    const ctx = ctxFor(pathway, { placements: { CS5800: "f", CS5200: "s", CS5600: "f2" } });
    ctx.pathway.selectedMsConcentration = "CCSP";
    const d = evaluateRule(
      { kind: "subBudget", domain, maxSH: 8, scope: { msConcentration: "CCSP" } }, ctx);
    assert.equal(d.status, STATUS.VIOLATED);
    assert.equal(d.evidence.usedSH, 12);
  });

  // The important one: a POWR budget must not be reported as cleared by a CCSP
  // student who was never under it.
  test("a scoped rule for another concentration is INAPPLICABLE, not satisfied", () => {
    const pathway = { id: "t", shares: [], rules: [], selectedMsConcentration: "CCSP" };
    const ctx = ctxFor(pathway);
    ctx.pathway.selectedMsConcentration = "CCSP";
    const d = evaluateRule(
      { kind: "subBudget", domain, maxSH: 8, scope: { msConcentration: "POWR" } }, ctx);
    assert.equal(d.status, STATUS.INFO);
    assert.equal(d.evidence.applicable, false);
  });

  test("an unscoped budget always applies", () => {
    const pathway = { id: "t", shares: [{ grad: "CS 5800", target: { kind: "slot", label: "x" } }], rules: [] };
    const d = evaluateRule({ kind: "subBudget", domain, maxSH: 2 },
      ctxFor(pathway, { placements: { CS5800: "f" } }));
    assert.equal(d.status, STATUS.VIOLATED);
  });

  test("Bouvé's subject-set top-up is the same kind with different data", () => {
    const pathway = { id: "t", shares: [{ grad: "CHEM 5628", target: { kind: "slot", label: "x" } }], rules: [] };
    const d = evaluateRule({
      kind: "subBudget",
      domain: { subjects: ["PHSC", "PMLC", "PMST", "NNMD", "BIOL", "BIOT", "CHEM"], min: 5000 },
      maxSH: 5,
    }, ctxFor(pathway, { placements: { CHEM5628: "f" } }));
    assert.equal(d.status, STATUS.SATISFIED);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("anonymous domain shares", () => {
  const pathway = {
    id: "t",
    shares: [{
      grad: null, gradDomain: { subject: "CS", min: 5000, max: 7980 }, count: 2,
      target: { kind: "slot", label: "General Elective" },
    }],
    rules: [],
  };

  test("any graduate course in the domain becomes an active share", () => {
    const ctx = ctxFor(pathway, { placements: { CS5800: "f", CS5200: "s" } });
    assert.equal(ctx.shares.length, 2);
    assert.equal(ctx.totals.courses, 2);
  });

  test("`count` bounds how many placements a domain share absorbs", () => {
    const ctx = ctxFor(pathway, { placements: { CS5800: "f", CS5200: "s", CS5600: "f2" } });
    assert.equal(ctx.shares.length, 2, "count: 2 must not absorb a third");
  });

  test("a course outside the domain is not absorbed", () => {
    const ctx = ctxFor(pathway, { placements: { PHTH5212: "f" } });
    assert.equal(ctx.shares.length, 0);
  });

  test("an undergraduate course is never absorbed by a graduate domain", () => {
    const ctx = ctxFor(pathway, { placements: { CS3000: "f" } });
    assert.equal(ctx.shares.length, 0);
  });

  test("a named share wins over a domain share for the same placement", () => {
    const p = {
      id: "t",
      shares: [
        { grad: "CS 5800", target: { kind: "course", ref: "CS 3000" } },
        { grad: null, gradDomain: { subject: "CS", min: 5000 }, count: 4, target: { kind: "slot", label: "GE" } },
      ],
      rules: [],
    };
    const ctx = ctxFor(p, { placements: { CS5800: "f" } });
    assert.equal(ctx.shares.length, 1, "CS 5800 must be counted once, not twice");
    assert.equal(ctx.shares[0].targetId, "CS3000");
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("anyone may declare any pathway — eligibility only warns", () => {
  // The rule this encodes, and the reason the old gate was wrong twice over:
  // our eligibility data is a hand transcription of a marketing page, and
  // Khoury MSCS shipped listing ONE of the 71 programs it is actually open to.
  // Gating on that silently denied real students their programme. It also
  // contradicted the project's own principle — flag, never block.
  const ALL = PATHWAYS.length;

  test("an undergraduate plan is offered every pathway, whatever their major", () => {
    assert.equal(selectPathways(PATHWAYS, { studentType: "undergrad" }).length, ALL);
  });

  test("even with no major declared at all", () => {
    assert.equal(selectPathways(PATHWAYS, {}).length, ALL);
  });

  test("a graduate plan is offered none — sharing needs undergraduate status", () => {
    assert.deepEqual(selectPathways(PATHWAYS, { studentType: "graduate" }), []);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("eligibility is a rule, not a list of program ids", () => {
  const prog = (id, label) => ({ id, label });
  const BSCS = prog("2026/computer-information-science/computer_science_bscs_(boston)",
                    "Computer Science, BSCS (Boston)");
  const CSBIO = prog("2026/computer-information-science/computer_science_and_biology_bs_(boston)",
                     "Computer Science and Biology, BS (Boston)");
  const CMPE = prog("2026/engineering/computer_engineering_and_computer_science_bscmpe_(boston)",
                    "Computer Engineering and Computer Science, BSCmpE (Boston)");
  const NURSING = prog("2026/health-sciences/nursing_bsn_(boston)", "Nursing, BSN (Boston)");

  test("the college is read straight off the id — no lookup needed", () => {
    assert.equal(collegeOf(BSCS.id), "computer-information-science");
    assert.equal(collegeOf("grad/2026/engineering/x_ms_(boston)"), "engineering");
    assert.equal(collegeOf("nonsense"), null);
  });

  test("a college entry admits the whole college", () => {
    const e = { college: "computer-information-science" };
    assert.equal(matchesEligibility(BSCS, e), true);
    assert.equal(matchesEligibility(CSBIO, e), true);
    assert.equal(matchesEligibility(NURSING, e), false);
  });

  // "and all combined majors" works because NEU names a combined major after
  // both halves, and such a major may be housed in ANOTHER college — which is
  // exactly what Khoury says: "eligible regardless of their home college".
  test("a name entry catches combined majors, including outside the college", () => {
    const e = { nameIncludes: "Computer Science" };
    assert.equal(matchesEligibility(BSCS, e), true);
    assert.equal(matchesEligibility(CSBIO, e), true);
    assert.equal(matchesEligibility(CMPE, e), true, "housed in engineering, still eligible");
    assert.equal(matchesEligibility(NURSING, e), false);
  });

  test("a name entry accepts several phrases", () => {
    const e = { nameIncludes: ["Data Science", "Computer Science"] };
    assert.equal(matchesEligibility(BSCS, e), true);
    assert.equal(matchesEligibility(NURSING, e), false);
  });

  test("an exact program id still works", () => {
    assert.equal(matchesEligibility(BSCS, { ugProgram: BSCS.id }), true);
    assert.equal(matchesEligibility(CSBIO, { ugProgram: BSCS.id }), false);
  });

  test("an empty entry matches nothing rather than everything", () => {
    assert.equal(matchesEligibility(BSCS, {}), false);
    assert.equal(matchesEligibility(BSCS, null), false);
    assert.equal(matchesEligibility(null, { college: "x" }), false);
  });

  test("a deliberate wildcard is honoured", () => {
    assert.equal(matchesEligibility(NURSING, { anyMajor: true }), true);
  });

  test("isEligibleFor is false with no declared programme, never a crash", () => {
    assert.equal(isEligibleFor(byId(MSCS), []), false);
    assert.equal(isEligibleFor(byId(MSCS), [null]), false);
  });

  test("a concentration-scoped entry closes when another is chosen", () => {
    const pw = { eligibility: [{ nameIncludes: "Physics", requiresMsConcentration: "MSMD" }] };
    const phys = prog("2026/science/physics_bs_(boston)", "Physics, BS (Boston)");
    assert.equal(isEligibleFor(pw, [phys], "MSMD"), true);
    assert.equal(isEligibleFor(pw, [phys], "POWR"), false);
    assert.equal(isEligibleFor(pw, [phys]), true, "undecided still offers");
  });

  // The measurement that proves the fix: 1 -> 71.
  test("Khoury MSCS is open to the whole college plus combined majors elsewhere", () => {
    const bundle = JSON.parse(readFileSync(
      join(ROOT, "public/northeastern/programs-bundle.json"), "utf8"));
    const ug = bundle.programs.filter(p => p.level === "undergrad" && p.type === "major");
    const n = ug.filter(u => isEligibleFor(byId(MSCS), [u])).length;
    assert.ok(n >= 60, `expected the whole Khoury college and more, got ${n}`);
    assert.ok(n < ug.length, "but not literally every major at the university");
  });

  test("every shipped pathway admits at least one real programme", () => {
    const bundle = JSON.parse(readFileSync(
      join(ROOT, "public/northeastern/programs-bundle.json"), "utf8"));
    const ug = bundle.programs.filter(p => p.level === "undergrad" && p.type === "major");
    for (const pw of PATHWAYS) {
      const n = ug.filter(u => isEligibleFor(pw, [u])).length;
      assert.ok(n > 0, `${pw.id} admits nobody — eligibility is mistranscribed`);
    }
  });

  test("campus variants resolve, and default to the first listed", () => {
    const p = byId(MSCS);
    assert.ok(msProgramFor(p, "Oakland").includes("(oakland)"));
    assert.equal(msProgramFor(p), p.msPrograms[0]);
    assert.equal(msProgramFor(p, "Nowhere"), p.msPrograms[0], "unknown campus falls back");
  });

  test("an undated pathway is stale by definition", () => {
    assert.equal(isStale({ source: {} }), true);
    assert.equal(isStale({ source: { retrievedAt: "2026-08-13" } }, Date.parse("2026-08-20")), false);
    assert.equal(isStale({ source: { retrievedAt: "2020-01-01" } }, Date.parse("2026-08-20")), true);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("a PlusOne plan asserts graduate admission", () => {
  test("without a pathway, an undergraduate plan asserts nothing", () => {
    assert.equal(planConditions({ studentType: "undergrad" }).has("grad-admission"), false);
  });

  test("with one, it asserts grad-admission", () => {
    assert.equal(
      planConditions({ studentType: "undergrad", plusOne: MSCS }).has("grad-admission"), true);
  });

  test("a graduate plan still asserts it", () => {
    assert.equal(planConditions({ studentType: "graduate" }).has("grad-admission"), true);
  });

  // The measured reason this matters: 7 of the shareable courses gate on it.
  test("the courses that need it are still in the corpus and still gated", () => {
    const gated = ["CS5310", "CY5200", "CY5210", "CY5240", "CHEM5628", "CHEM5676", "ME5250"];
    for (const id of gated) {
      const c = courseMap[id];
      assert.ok(c, `${id} missing from the corpus`);
      assert.match(JSON.stringify(c.prereqs ?? []), /admission/i,
        `${id} no longer states graduate program admission — re-measure`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("one graduate course can never satisfy two undergraduate courses", () => {
  // The bug this pins SHIPPED. Khoury's table maps CS 5500 to both CS 4500 and
  // CS 4530 (alternatives a student picks between), and emitting a substitution
  // per matching ROW meant one 4 SH placement satisfied BOTH requirements and
  // counted as 2 courses / 8 SH against the cap. "Credits counted once" broken
  // in the most expensive direction. The pathway file even carried a note saying
  // only one could be shared — the note was there and the guard was not.
  const p = () => byId(MSCS);

  test("a doubled graduate course yields NO automatic substitution", () => {
    const subs = pathwaySubstitutions({ pathway: p(), placements: { CS5500: "fall2027" } });
    assert.deepEqual(subs.filter(s => s.from === "CS5500"), []);
  });

  test("and satisfies neither alternative", () => {
    const placements = { CS5500: "fall2027" };
    const ep = applySubstitutions(placements, pathwaySubstitutions({ pathway: p(), placements }));
    assert.equal(ep.CS4500, undefined);
    assert.equal(ep.CS4530, undefined);
  });

  test("it counts ONCE against the cap, at its real credit value", () => {
    const ctx = ctxFor(p(), { placements: { CS5500: "fall2027" } });
    assert.equal(ctx.totals.courses, 1);
    assert.equal(ctx.totals.semesterHours, 4);
  });

  test("the alternatives are reported so the student can choose", () => {
    const amb = ambiguousShares({ pathway: p(), placements: { CS5500: "fall2027" } });
    assert.deepEqual(amb, [{ gradId: "CS5500", targets: ["CS4500", "CS4530"] }]);
    const ctx = ctxFor(p(), { placements: { CS5500: "fall2027" } });
    assert.equal(ctx.shares[0].ambiguous, true);
    assert.deepEqual(ctx.shares[0].altTargets, ["CS4500", "CS4530"]);
  });

  test("taking one alternative collapses the choice and arms the other", () => {
    const placements = { CS5500: "fall2027", CS4500: "fall2025" };
    assert.deepEqual(ambiguousShares({ pathway: p(), placements }), []);
    const subs = pathwaySubstitutions({ pathway: p(), placements });
    assert.deepEqual(subs.filter(s => s.from === "CS5500"), [{ from: "CS5500", to: "CS4530" }]);
  });

  test("an unambiguous course is unaffected", () => {
    const subs = pathwaySubstitutions({ pathway: p(), placements: { CS5800: "fall2027" } });
    assert.deepEqual(subs.filter(s => s.from === "CS5800"), [{ from: "CS5800", to: "CS3000" }]);
    assert.equal(ctxFor(p(), { placements: { CS5800: "f" } }).totals.courses, 1);
  });

  // The same shape exists in the cybersecurity pathway, TWICE — CS 5500 covers
  // CS 4500/CS 4530 and CS 5700 covers CS 3700/CS 4700 — so the guard is checked
  // there too rather than only where it was found.
  //
  // Note the scope: `ambiguousShares` is a PATHWAY-level query ("which rows of
  // this table are alternations?"), not a placement-level one, so it lists both
  // regardless of what is placed. The panel renders ambiguity per ACTIVE share
  // via activeShares().ambiguous, which is placement-scoped.
  test("the cybersecurity pathway has two alternations, and neither auto-substitutes", () => {
    const cy = byId("khoury/to-ms-cybersecurity");
    assert.deepEqual(ambiguousShares({ pathway: cy, placements: {} }), [
      { gradId: "CS5500", targets: ["CS4500", "CS4530"] },
      { gradId: "CS5700", targets: ["CS3700", "CS4700"] },
    ]);
    for (const id of ["CS5500", "CS5700"]) {
      const subs = pathwaySubstitutions({ pathway: cy, placements: { [id]: "f" } });
      assert.deepEqual(subs.filter(s => s.from === id), [], id);
    }
  });

  // Corpus-wide guard: no shipped pathway may ever let one placement satisfy
  // more than one undergraduate course.
  test("no shipped pathway emits two substitutions from one graduate course", () => {
    for (const pw of PATHWAYS) {
      const placements = Object.fromEntries(
        (pw.shares ?? []).filter(s => s.grad).map(s => [plannerId(s.grad), "fall2027"]));
      const subs = pathwaySubstitutions({ pathway: pw, placements });
      const perFrom = new Map();
      for (const s of subs) perFrom.set(s.from, (perFrom.get(s.from) ?? 0) + 1);
      for (const [from, n] of perFrom) {
        assert.equal(n, 1, `${pw.id}: ${from} produced ${n} substitutions`);
      }
    }
  });

  test("and every placement counts exactly once toward the totals", () => {
    for (const pw of PATHWAYS) {
      const named = [...new Set((pw.shares ?? []).filter(s => s.grad).map(s => plannerId(s.grad)))];
      const placements = Object.fromEntries(named.map(id => [id, "fall2027"]));
      const ctx = ctxFor(pw, { placements });
      assert.equal(ctx.totals.courses, named.length,
        `${pw.id}: ${named.length} distinct courses placed but ${ctx.totals.courses} counted`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("semester hours are read from BOTH course shapes", () => {
  // The bug this pins shipped and was invisible to the suite: shOf read only
  // `credits`, which is the RAW catalog field, while the app's courseMap holds
  // courses normalised by courseNorm.js where the field is `sh`. Every share
  // reported 0 SH in the browser and every test passed, because the tests build
  // their map from catalog-courses.json.
  const pathway = {
    id: "t",
    shares: [{ grad: "CS 5800", target: { kind: "course", ref: "CS 3000" } }],
    rules: [],
  };
  const shares = map => activeShares({ pathway, placements: { CS5800: "fall2026" }, courseMap: map });

  test("the RUNTIME shape (`sh`) is counted", () => {
    assert.equal(shares({ CS5800: { sh: 4 } })[0].sh, 4);
  });

  test("the RAW catalog shape (`credits`) is counted", () => {
    assert.equal(shares({ CS5800: { credits: 4 } })[0].sh, 4);
  });

  test("`sh` wins when both are present, since that is the runtime truth", () => {
    assert.equal(shares({ CS5800: { sh: 4, credits: 99 } })[0].sh, 4);
  });

  test("a course we cannot resolve contributes 0, never NaN", () => {
    const s = shares({})[0];
    assert.equal(s.sh, 0);
    assert.equal(Number.isFinite(shareTotals([s]).semesterHours), true);
  });

  test("the real corpus map yields a non-zero total for a real share", () => {
    const s = shares(courseMap);
    assert.ok(s[0].sh > 0, "CS 5800 must have credit hours in the shipped corpus");
    assert.equal(shareTotals(s).semesterHours, 4);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("ids", () => {
  test("both spellings normalise to the planner form", () => {
    assert.equal(plannerId("CS 5800"), "CS5800");
    assert.equal(plannerId("cs5800"), "CS5800");
    assert.equal(plannerId("  CS  5800 "), "CS5800");
    assert.equal(displayCode("CS5800"), "CS 5800");
  });

  test("junk is null, not a string that silently never matches", () => {
    for (const bad of ["", null, undefined, "CS", "5800", "CS 58", "CS 58000", "General Elective"]) {
      assert.equal(plannerId(bad), null, JSON.stringify(bad));
    }
  });

  test("the 5000 boundary matches the equivalence engine's", () => {
    assert.equal(isGradCode("CS 5000"), true);
    assert.equal(isGradCode("CS 4999"), false);
    assert.equal(isUgCode("CS 4999"), true);
    assert.equal(isUgCode("CS 5000"), false);
    assert.equal(isGradCode("nonsense"), false);
    assert.equal(isUgCode("nonsense"), false, "junk is neither level");
  });

  test("domains honour subject, subjects, exclusion and bounds", () => {
    assert.equal(inDomain("CS5800", { subject: "CS", min: 5000, max: 7980 }), true);
    assert.equal(inDomain("CS8000", { subject: "CS", min: 5000, max: 7980 }), false);
    assert.equal(inDomain("EECE5698", { excludeSubject: "EECE", min: 5000 }), false);
    assert.equal(inDomain("CS5800", { excludeSubject: "EECE", min: 5000 }), true);
    assert.equal(inDomain("BIOL5591", { subjects: ["BIOL", "CHEM"], min: 5000 }), true);
    assert.equal(inDomain("CS5800", { subjects: ["BIOL", "CHEM"], min: 5000 }), false);
    assert.equal(inDomain("CS5800", null), false);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("merging with the student's own substitutions", () => {
  test("a manual substitution wins over a derived duplicate", () => {
    const user = [{ from: "CS5800", to: "CS3000" }];
    const derived = [{ from: "CS5800", to: "CS3000" }, { from: "CS5200", to: "CS3200" }];
    const merged = mergeSubstitutions(user, derived);
    assert.equal(merged.length, 2);
    assert.equal(merged[0], user[0], "the user's own object is preserved by reference");
  });

  test("merging is stable and adds nothing when derived is empty", () => {
    const user = [{ from: "CS5800", to: "CS3000" }];
    assert.deepEqual(mergeSubstitutions(user, []), user);
    assert.deepEqual(mergeSubstitutions([], []), []);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("every shipped pathway is coherent", () => {
  test("ids are unique", () => {
    const ids = PATHWAYS.map(p => p.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("each names a source with a date, since none of this is in the catalog", () => {
    for (const p of PATHWAYS) {
      assert.ok(p.source?.url, `${p.id} has no source url`);
      assert.match(p.source.retrievedAt, /^\d{4}-\d{2}-\d{2}$/, `${p.id} retrievedAt`);
    }
  });

  test("each carries the university cap and the admission caveat", () => {
    for (const p of PATHWAYS) {
      const kinds = p.rules.map(r => r.kind);
      assert.ok(kinds.includes("shareCap"), `${p.id} must state the credit-sharing cap`);
      assert.ok(kinds.includes("admissionNotGuaranteed"),
        `${p.id} must say admission is not guaranteed`);
    }
  });

  test("evaluating an empty plan never violates a rule about credit", () => {
    for (const p of PATHWAYS) {
      const diags = evaluatePathway(ctxFor(p));
      const capViolated = diags.some(d => d.kind === "shareCap" && d.status === STATUS.VIOLATED);
      assert.equal(capViolated, false, `${p.id}: an empty plan cannot exceed the cap`);
    }
  });

  test("summarise separates 'wrong' from 'cannot tell'", () => {
    const s = summarise([
      { status: STATUS.VIOLATED }, { status: STATUS.UNKNOWN },
      { status: STATUS.UNKNOWN }, { status: STATUS.INFO }, { status: STATUS.SATISFIED },
    ]);
    assert.equal(s.violated, 1);
    assert.equal(s.unknown, 2);
    assert.equal(s.ok, false);
    assert.equal(summarise([{ status: STATUS.UNKNOWN }]).ok, true,
      "unknown alone must not read as a failure");
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("the candidate list — what a student should take", () => {
  const p = () => byId(MSCS);
  const cands = (placements = {}) =>
    shareCandidates({ pathway: p(), placements, courseMap });

  test("one row per GRADUATE course, not per table row", () => {
    const rows = cands();
    // CS 5500 appears twice in the published table (CS 4500 / CS 4530).
    assert.equal(rows.filter(r => r.gradId === "CS5500").length, 1);
    assert.equal(new Set(rows.map(r => r.gradId)).size, rows.length);
  });

  test("an unstarted plan shows every course as available, with real credits", () => {
    const rows = cands();
    for (const r of rows) {
      // "open" or "choose" — both are available; nothing is taken or foreclosed
      // in a plan with no placements. CS 5500 is `choose` because the published
      // table gives it two targets.
      assert.ok(["open", "choose"].includes(r.state), `${r.gradId} is ${r.state}`);
      assert.ok(r.sh > 0, `${r.gradId} has no credits`);
    }
    assert.equal(rows.filter(r => r.state === "choose").length, 1, "only CS 5500 alternates");
  });

  test("a placed course becomes `taken`", () => {
    const r = cands({ CS5800: "fall2027" }).find(x => x.gradId === "CS5800");
    assert.equal(r.state, "taken");
  });

  test("an alternation is `choose` and carries both targets", () => {
    const r = cands().find(x => x.gradId === "CS5500");
    assert.equal(r.state, "choose");
    assert.equal(r.ambiguous, true);
    assert.deepEqual(r.targets, ["CS4500", "CS4530"]);
  });

  // The row that must NOT silently disappear: an option foreclosed by the
  // student's own undergraduate coursework needs its explanation.
  test("taking the undergraduate version marks the row `blocked`, not absent", () => {
    const rows = cands({ CS3000: "fall2025" });
    const r = rows.find(x => x.gradId === "CS5800");
    assert.ok(r, "the row must still be listed");
    assert.equal(r.state, "blocked");
    assert.deepEqual(r.blockedBy, ["CS3000"]);
    assert.deepEqual(r.targets, []);
  });

  test("an alternation with one target taken stays open on the other", () => {
    const r = cands({ CS4500: "fall2025" }).find(x => x.gradId === "CS5500");
    assert.equal(r.state, "open");
    assert.deepEqual(r.targets, ["CS4530"]);
    assert.deepEqual(r.blockedBy, ["CS4500"]);
  });

  test("a slot-filler with no course target stays open and keeps its label", () => {
    const r = shareCandidates({ pathway: byId(CMPE), placements: {}, courseMap })
      .find(x => x.gradId === "CS5010");
    assert.equal(r.state, "open");
    assert.equal(r.mandatory, true);
    assert.equal(r.slotLabel, "General Elective");
  });

  test("mandatory rows sort first, foreclosed rows last", () => {
    const rows = shareCandidates({
      pathway: byId(CMPE), placements: { CS3200: "fall2025" }, courseMap,
    });
    assert.equal(rows[0].gradId, "CS5010", "the required course leads");
    assert.equal(rows[rows.length - 1].state, "blocked", "foreclosed rows trail");
  });

  test("open-ended pathways are flagged so the table is not read as the limit", () => {
    assert.equal(hasOpenShareDomain(byId(MSCS)), false, "Khoury publishes a closed table");
    assert.equal(hasOpenShareDomain({
      shares: [{ grad: null, gradDomain: { subject: "CS", min: 5000 }, target: { kind: "slot", label: "x" } }],
    }), true);
  });

  test("every shipped pathway produces a usable list", () => {
    for (const pw of PATHWAYS) {
      const rows = shareCandidates({ pathway: pw, placements: {}, courseMap });
      assert.ok(rows.length >= 3, `${pw.id} offers only ${rows.length} courses`);
      for (const r of rows) {
        assert.ok(r.sh > 0, `${pw.id}: ${r.gradId} has no credits`);
        assert.ok(r.targets.length || r.slotLabel,
          `${pw.id}: ${r.gradId} has neither a target nor a slot label`);
      }
    }
  });

  test("a junk pathway yields an empty list rather than throwing", () => {
    for (const bad of [null, undefined, {}, { shares: null }]) {
      assert.deepEqual(shareCandidates({ pathway: bad, courseMap }), []);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("a course is shared once however many times it is attempted", () => {
  // Found by probing before a push. Keying shares by PLACEMENT rather than by
  // course made a retake ("CS5800" + "CS5800#2") read as 2 courses / 8 SH, which
  // can push a legal plan over a 4-course / 16 SH cap on the strength of one
  // course. Same family as the CS 5500 alternation bug: the cap counts COURSES.
  const p = () => byId(MSCS);
  const sharesFor = (placements, grades = {}) => activeShares({
    pathway: p(), placements, courseMap, grades, isVoid: g => g === "W",
  });

  test("a retake counts once", () => {
    const s = sharesFor({ CS5800: "fall2026", "CS5800#2": "spring2027" });
    assert.equal(s.length, 1);
    assert.equal(shareTotals(s).courses, 1);
    assert.equal(shareTotals(s).semesterHours, 4);
  });

  test("three attempts still count once", () => {
    const s = sharesFor({ CS5800: "f1", "CS5800#2": "f2", "CS5800#3": "f3" });
    assert.equal(shareTotals(s).courses, 1);
  });

  test("a withdrawn first attempt plus a passed retake is ONE active share", () => {
    const s = sharesFor({ CS5800: "fall2026", "CS5800#2": "spring2027" }, { CS5800: "W" });
    assert.equal(s.length, 1);
    assert.equal(s[0].withdrawn, false, "the take that counts is the one that stuck");
    assert.equal(s[0].semId, "spring2027", "and it sits in the term it was earned");
    assert.equal(shareTotals(s, { includeWithdrawn: true }).courses, 1);
  });

  test("a single withdrawn attempt stays withdrawn", () => {
    const s = sharesFor({ CS5800: "fall2026" }, { CS5800: "W" });
    assert.equal(s[0].withdrawn, true);
    assert.equal(shareTotals(s).courses, 0, "not carried");
    assert.equal(shareTotals(s, { includeWithdrawn: true }).courses, 1, "but Khoury counts it");
  });

  test("distinct courses still count separately", () => {
    const s = sharesFor({ CS5800: "f1", CS5200: "f2" });
    assert.equal(shareTotals(s).courses, 2);
  });

  // Transfer credit may not apply to a PlusOne master's (university policy), so
  // a graduate course placed out must not appear as a share.
  test("a graduate course placed out is not a share", () => {
    const s = activeShares({
      pathway: p(), placements: {}, courseMap, placedOut: new Set(["CS5800"]),
    });
    assert.equal(s.length, 0);
  });

  test("but a placed-out UNDERGRADUATE target still forecloses its share", () => {
    const placedOut = new Set(["CS3000"]);
    const subs = pathwaySubstitutions({ pathway: p(), placements: {}, placedOut });
    assert.ok(!subs.some(s => s.to === "CS3000"));
    const row = shareCandidates({ pathway: p(), placements: {}, placedOut, courseMap })
      .find(r => r.gradId === "CS5800");
    assert.equal(row.state, "blocked");
    assert.deepEqual(row.blockedBy, ["CS3000"]);
  });
});
