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
  shareTotals, excludedIds, resolveCandidates,
} from "../../src/core/pathway/shareSet.js";
import { selectPathways, msProgramFor, isStale } from "../../src/core/pathway/select.js";
import { plannerId, displayCode, inDomain, isGradCode, isUgCode } from "../../src/core/pathway/ids.js";
import { applySubstitutions } from "../../src/core/planModel.js";
import { planConditions } from "../../src/core/prereqConditions.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

// ── load the shipped pathways with fs (no Vite in Node) ───────────
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
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
describe("earliestTerm is conservative about what it cannot see", () => {
  const semIndex = { incoming: 0, fall2025: 1, spring2026: 2, fall2026: 3, spring2027: 4 };

  test("a graduate course before the third term is flagged", () => {
    const d = evaluateRule({ kind: "earliestTerm", afterTerms: 3 },
      ctxFor(byId(MSCS), { placements: { CS5800: "spring2026" }, semIndex }));
    assert.equal(d.status, STATUS.VIOLATED);
  });

  test("at or after the third term is fine", () => {
    const d = evaluateRule({ kind: "earliestTerm", afterTerms: 3 },
      ctxFor(byId(MSCS), { placements: { CS5800: "fall2026" }, semIndex }));
    assert.equal(d.status, STATUS.SATISFIED);
  });

  test("a term outside the timeline is UNKNOWN, never a violation", () => {
    const d = evaluateRule({ kind: "earliestTerm", afterTerms: 3 },
      ctxFor(byId(MSCS), { placements: { CS5800: "fall2099" }, semIndex }));
    assert.equal(d.status, STATUS.UNKNOWN,
      "a parked card is not evidence of being early");
  });

  test("with no semIndex at all nothing is asserted", () => {
    const d = evaluateRule({ kind: "earliestTerm", afterTerms: 3 },
      ctxFor(byId(MSCS), { placements: { CS5800: "fall2026" } }));
    assert.equal(d.status, STATUS.UNKNOWN);
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
describe("selection is undergraduate-only and program-scoped", () => {
  test("a graduate plan gets nothing", () => {
    assert.deepEqual(
      selectPathways(PATHWAYS, {
        studentType: "graduate",
        ugProgramId: "2026/computer-information-science/computer_science_bscs_(boston)",
      }), []);
  });

  test("a BSCS plan finds its pathways", () => {
    const got = selectPathways(PATHWAYS, {
      studentType: "undergrad",
      ugProgramId: "2026/computer-information-science/computer_science_bscs_(boston)",
    });
    assert.ok(got.length >= 3, `expected several, got ${got.length}`);
    assert.ok(got.every(p => p.eligibility.some(
      e => e.ugProgram === "2026/computer-information-science/computer_science_bscs_(boston)")));
  });

  test("an unrelated program finds none", () => {
    assert.deepEqual(selectPathways(PATHWAYS, {
      studentType: "undergrad",
      ugProgramId: "2026/health-sciences/nursing_bsn_(boston)",
    }), []);
  });

  test("no program means no pathways, not all of them", () => {
    assert.deepEqual(selectPathways(PATHWAYS, { studentType: "undergrad" }), []);
  });

  test("a concentration-scoped entry closes when another concentration is chosen", () => {
    const p = [{
      id: "x",
      eligibility: [{ ugProgram: "P", requiresMsConcentration: "MSMD" }],
      msPrograms: [], shares: [], rules: [],
    }];
    assert.equal(selectPathways(p, { ugProgramId: "P", msConcentration: "MSMD" }).length, 1);
    assert.equal(selectPathways(p, { ugProgramId: "P", msConcentration: "POWR" }).length, 0);
    assert.equal(selectPathways(p, { ugProgramId: "P" }).length, 1, "undecided still offers");
  });

  test("campus variants resolve, and default to the first listed", () => {
    const p = byId(MSCS);
    assert.ok(msProgramFor(p, "Oakland").includes("(oakland)"));
    assert.ok(msProgramFor(p, "Silicon Valley").includes("(silicon_valley)"));
    assert.equal(msProgramFor(p), p.msPrograms[0]);
    assert.equal(msProgramFor(p, "Nowhere"), p.msPrograms[0], "unknown campus falls back");
  });

  test("an undated pathway is stale by definition", () => {
    assert.equal(isStale({ source: {} }), true);
    assert.equal(isStale({ source: { retrievedAt: "not-a-date" } }), true);
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
