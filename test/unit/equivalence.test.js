// Course equivalence — the signals, the vetoes, and the tier contract.
//
// Two invariants hold everything together:
//   1. a tier is decided by the KIND of evidence, never by the score;
//   2. the stored tier is program-agnostic, and program membership is a
//      runtime upgrade — so a pair backed by one unrelated program must never
//      read as an entitlement for everybody else.
//
// The regression sets at the bottom are the real test. They are pairs whose
// answer is known independently, and every discriminator in the module exists
// because one of them was previously classified wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TIERS, TIER_C_MIN_EVIDENCE, TIER_C_MIN_STEM, MAX_CROSSLIST_CLUSTER,
  seqNum, titleStem, stemContainment, jaccard,
  courseRole, roleSlot, companionParent, isCompanionTitle,
  isGenericShell, crossesGradBoundary, numericAffinity,
  parseStatedEquivalences, findVetoes, classifyPair, resolveTier, pairKey,
} from "../../scripts/lib/equivalence.js";

// ── sequence detection ──────────────────────────────────────────────

test("seqNum › reads a trailing numeral", () => {
  assert.equal(seqNum("Physics 1"), 1);
  assert.equal(seqNum("Organic Chemistry 2"), 2);
});

test("seqNum › reads a MID-TITLE numeral before a colon", () => {
  // The bug this exists for: end-anchored matching returned null here, so
  // "Legal Studies 1" and "Legal Studies 2" looked like the same course and
  // the pair reached rank 11 on a perfect title score.
  assert.equal(seqNum("Introduction to Legal Studies 1: Law and Legal Reasoning"), 1);
  assert.equal(seqNum("Introduction to Legal Studies 2"), 2);
});

test("seqNum › reads roman numerals, and null when absent", () => {
  assert.equal(seqNum("Fluid Mechanics II"), 2);
  assert.equal(seqNum("Peoples and Cultures"), null);
});

test("seqNum › a four-digit code in a title is not a sequence number", () => {
  assert.equal(seqNum("Lab for PHYS 1151"), null);
});

// ── title stems ─────────────────────────────────────────────────────

test("titleStem › drops stopwords and sequence numerals", () => {
  assert.deepEqual([...titleStem("Physics for Engineering 1")].sort(),
                   ["engineering", "physics"]);
  // "Introduction" carries no signal — every intro course has it.
  assert.ok(!titleStem("Introduction to Sociology").has("introduction"));
});

test("stemContainment › a variant fully contains its base", () => {
  assert.equal(stemContainment("Physics 1", "Physics for Engineering 1"), 1);
  assert.equal(stemContainment("Organic Chemistry 2",
                               "Organic Chemistry 2 for Chemistry Majors"), 1);
});

test("stemContainment › unrelated titles share nothing — the pool signature", () => {
  assert.equal(stemContainment("Peoples and Cultures", "Introduction to Sociology"), 0);
  assert.equal(stemContainment("Introduction to Criminal Justice",
                               "Introduction to Sociology"), 0);
});

// ── roles and bundles ───────────────────────────────────────────────

test("courseRole › classifies the components of a bundle", () => {
  assert.equal(courseRole("Physics for Engineering 1"), "lecture");
  assert.equal(courseRole("Lab for PHYS 1151"), "lab");
  assert.equal(courseRole("Recitation for PHYS 1161"), "recitation");
  assert.equal(courseRole("Interactive Learning Seminar for PHYS 1151"), "seminar");
  assert.equal(courseRole("Statistics in Psychological Research Supplement"), "supplement");
});

test("roleSlot › recitation and seminar are the SAME slot", () => {
  // PHYS 1163 is a Recitation, its engineering counterpart PHYS 1153 is an
  // Interactive Learning Seminar. Exact-role matching dropped both rows.
  assert.equal(roleSlot("recitation"), roleSlot("seminar"));
  assert.notEqual(roleSlot("lab"), roleSlot("lecture"));
});

test("companionParent › reads the parent out of the title", () => {
  assert.equal(companionParent("Lab for PHYS 1151"), "PHYS 1151");
  assert.equal(companionParent("Recitation for CHEM 1161"), "CHEM 1161");
  assert.equal(companionParent("Interactive Learning Seminar for PHYS 1155"), "PHYS 1155");
  assert.equal(companionParent("Physics 1"), null);
});

test("isCompanionTitle › agrees with courseRole", () => {
  assert.equal(isCompanionTitle("Lab for PHYS 1151"), true);
  assert.equal(isCompanionTitle("Physics 1"), false);
});

// ── numeric structure ───────────────────────────────────────────────

test("numericAffinity › same slot + same family + adjacent variant scores high", () => {
  // 1161 → 1151 is the substitution the catalog actually publishes.
  assert.ok(numericAffinity("PHYS 1151", "PHYS 1161") >= 0.9);
  assert.ok(numericAffinity("PHYS 1152", "PHYS 1162") >= 0.9);
});

test("numericAffinity › same slot outranks a different slot in the same family", () => {
  // 1151 ⇄ 1161 is lecture-to-lecture; 1151 ⇄ 1162 crosses lecture to lab.
  assert.ok(numericAffinity("PHYS 1151", "PHYS 1161") >
            numericAffinity("PHYS 1151", "PHYS 1162"));
});

test("numericAffinity › cannot rank sibling variants, and must not pretend to", () => {
  // PHYS 1141 and PHYS 1161 are each one tens-step from 1151, so they are
  // structurally equidistant and this signal scores them the same. What
  // separates them is evidence (12 downstream courses accept 1151/1161 as
  // alternatives; 1 accepts 1151/1141), not numbering. Asserting a numeric
  // preference here would encode a fact the numbers do not contain.
  assert.equal(numericAffinity("PHYS 1151", "PHYS 1161"),
               numericAffinity("PHYS 1151", "PHYS 1141"));
});

test("numericAffinity › cross-subject has no numeric relationship", () => {
  assert.equal(numericAffinity("IE 3412", "MATH 3081"), 0);
});

// ── shells and level boundaries ─────────────────────────────────────

test("isGenericShell › catches the administrative containers", () => {
  for (const t of ["Topics", "Special Topics in Communication Studies", "Research",
                   "Project", "Junior/Senior Honors Project 1", "Doctoral Thesis Continuation",
                   "Co-op Work Experience", "Directed Study", "Elective"]) {
    assert.equal(isGenericShell(t), true, t);
  }
  assert.equal(isGenericShell("Physics for Engineering 1"), false);
});

test("crossesGradBoundary › 5000 is the line", () => {
  assert.equal(crossesGradBoundary("COP 3945", "COP 6945"), true);
  assert.equal(crossesGradBoundary("COMM 4605", "COMM 6605"), true);
  assert.equal(crossesGradBoundary("ALY 5000", "ALY 6000"), false);
  assert.equal(crossesGradBoundary("PHYS 1151", "PHYS 1161"), false);
});

// ── stated equivalences ─────────────────────────────────────────────

test("parseStatedEquivalences › the business formula, with direction and scope", () => {
  const got = parseStatedEquivalences("ACCT 1209",
    "Does not count as credit for business majors. Counts as ACCT 1201 for " +
    "business minors only. Requires second-semester-freshman standing or above.");
  assert.equal(got.length, 1);
  assert.equal(got[0].target, "ACCT 1201");
  assert.equal(got[0].kind, "counts-as");
  assert.equal(got[0].directed, true);
  assert.equal(got[0].scope, "business minors");
  assert.equal(got[0].excludes, "business majors");
});

test("parseStatedEquivalences › cross-listing is symmetric", () => {
  const got = parseStatedEquivalences("INTL 5100", "…pathways. Cross-listed with PPUA 5100.");
  assert.equal(got[0].target, "PPUA 5100");
  assert.equal(got[0].directed, false);
});

test("parseStatedEquivalences › lowercase prose is not a course code", () => {
  // The phrase match is case-insensitive; the CODE must be uppercase, or
  // "counts as chemistry 1211" would be read as a reference.
  assert.deepEqual(parseStatedEquivalences("X 1000", "Counts as chemistry 1211."), []);
});

test("parseStatedEquivalences › no statement, no pairs", () => {
  assert.deepEqual(parseStatedEquivalences("PHYS 1151", "Covers kinematics and dynamics."), []);
});

// ── vetoes ──────────────────────────────────────────────────────────

const ctx = {
  titleOf: {
    "LS 6101": "Introduction to Legal Studies 1: Law and Legal Reasoning",
    "LS 6102": "Introduction to Legal Studies 2",
    "PHYS 1151": "Physics for Engineering 1", "PHYS 1161": "Physics 1",
    "PHYS 1152": "Lab for PHYS 1151", "PHYS 1162": "Lab for PHYS 1161",
    "PSYC 2315": "Statistics in Psychological Research Supplement",
    "PSYC 2320": "Statistics in Psychological Research",
    "SPNS 2102": "Intermediate Spanish 2", "SPNS 3101": "Advanced Spanish 1",
    "ALY 2983": "Topics", "ALY 3983": "Topics",
    "COP 3945": "Co-op Work Experience", "COP 6945": "Co-op Work Experience—Full Time",
  },
  creditsOf: {
    "PHYS 1151": 3, "PHYS 1161": 4, "PHYS 1152": 1, "PHYS 1162": 1,
    "PSYC 2315": 1, "PSYC 2320": 4, "LS 6101": 3, "LS 6102": 3,
  },
  bundleCreditsOf: { "PHYS 1151": 5, "PHYS 1161": 5 },
  prereqEdges: new Set(["SPNS 2102→SPNS 3101"]),
};

test("veto › a prerequisite edge means a sequence, not a choice", () => {
  assert.ok(findVetoes({ a: "SPNS 2102", b: "SPNS 3101" }, ctx).includes("sequence-prereq"));
});

test("veto › differing sequence numbers", () => {
  assert.ok(findVetoes({ a: "LS 6101", b: "LS 6102" }, ctx).includes("sequence-number"));
});

test("veto › a lab cannot stand in for a lecture", () => {
  assert.ok(findVetoes({ a: "PHYS 1152", b: "PHYS 1161" }, ctx).includes("role-mismatch"));
});

test("veto › but lab-for-lab is allowed — it is a row of the substitution", () => {
  assert.deepEqual(findVetoes({ a: "PHYS 1152", b: "PHYS 1162" }, ctx), []);
});

test("veto › credits compare over the BUNDLE, not the bare lecture", () => {
  // 3 SH vs 4 SH looks like a mismatch; 3+1+1 vs 4+1+0 is equal.
  assert.ok(!findVetoes({ a: "PHYS 1151", b: "PHYS 1161" }, ctx).includes("credit-mismatch"));
});

test("veto › a 1 SH supplement does not replace a 4 SH course", () => {
  const v = findVetoes({ a: "PSYC 2315", b: "PSYC 2320" }, ctx);
  assert.ok(v.includes("credit-mismatch") || v.includes("supplement-pair"));
});

test("veto › generic shells and the grad boundary", () => {
  assert.ok(findVetoes({ a: "ALY 2983", b: "ALY 3983" }, ctx).includes("generic-shell"));
  assert.ok(findVetoes({ a: "COP 3945", b: "COP 6945" }, ctx).includes("grad-boundary"));
});

// ── tiering ─────────────────────────────────────────────────────────

test("tier › an explicit catalog statement is tier A", () => {
  const r = classifyPair({ a: "ACCT 1201", b: "ACCT 1209" },
    { stated: { kind: "counts-as", directed: true, from: "ACCT 1209" } },
    { titleOf: { "ACCT 1201": "Financial Accounting and Reporting",
                 "ACCT 1209": "Financial Accounting and Reporting" }, creditsOf: {} });
  assert.equal(r.tier, "A");
  assert.equal(r.approval, false);
});

test("tier › a cross-listing is tier B", () => {
  const r = classifyPair({ a: "INTL 5100", b: "PPUA 5100" },
    { crossListCluster: 2 },
    { titleOf: { "INTL 5100": "Climate and Development", "PPUA 5100": "Climate and Development" },
      creditsOf: {} });
  assert.equal(r.tier, "B");
});

test("tier › prereq-OR evidence with a shared stem is tier C, needing approval", () => {
  const r = classifyPair({ a: "PHYS 1151", b: "PHYS 1161" },
    { prereqOr: 12 }, ctx);
  assert.equal(r.tier, "C");
  assert.equal(r.approval, true);
  assert.equal(r.offer, true);
});

test("tier › below the evidence threshold is not tier C", () => {
  const r = classifyPair({ a: "PHYS 1151", b: "PHYS 1161" },
    { prereqOr: TIER_C_MIN_EVIDENCE - 1 }, ctx);
  assert.equal(r.tier, "D");
});

test("tier › plenty of evidence but unrelated titles is a POOL, not tier C", () => {
  // ANTH 1101 / SOCL 1101: 32 downstream courses accept either, because the
  // gate is "any one social science". Evidence alone cannot see the difference.
  const poolCtx = {
    titleOf: { "ANTH 1101": "Peoples and Cultures", "SOCL 1101": "Introduction to Sociology" },
    creditsOf: { "ANTH 1101": 4, "SOCL 1101": 4 }, prereqEdges: new Set(),
  };
  const r = classifyPair({ a: "ANTH 1101", b: "SOCL 1101" }, { prereqOr: 32 }, poolCtx);
  assert.equal(r.tier, "D");
  assert.ok(r.reasons.some(x => /choice pool/.test(x)));
});

test("tier › a veto demotes tier C even with strong evidence", () => {
  const r = classifyPair({ a: "LS 6101", b: "LS 6102" }, { prereqOr: 22 }, ctx);
  assert.equal(r.tier, "D");
});

test("tier › an inference veto does NOT demote a stated equivalence", () => {
  // Tier A rests on the catalog, not on our inference, so a credit or sequence
  // objection has no standing against it.
  const r = classifyPair({ a: "PSYC 2315", b: "PSYC 2320" },
    { stated: { kind: "counts-as", directed: true, from: "PSYC 2315" } }, ctx);
  assert.equal(r.tier, "A");
});

test("tier › a program-backed pair stays program-AGNOSTIC in the stored tier", () => {
  // 2,536 of 3,525 program-backed pairs come from exactly one program. Tiering
  // on that would tell every student "your program accepts either".
  const r = classifyPair({ a: "PHYS 1151", b: "PHYS 1161" },
    { programs: 1, prereqOr: 12 }, ctx);
  assert.equal(r.tier, "C");
  assert.equal(r.programBacked, true);
});

// ── runtime scoping ─────────────────────────────────────────────────

test("resolveTier › membership in a publishing program upgrades to A", () => {
  const pair = { t: "C", e: { p: [3, 9] } };
  assert.deepEqual(resolveTier(pair, new Set([9])), { tier: "A", scoped: true });
});

test("resolveTier › a non-member keeps the stored tier", () => {
  const pair = { t: "C", e: { p: [3, 9] } };
  assert.deepEqual(resolveTier(pair, new Set([4])), { tier: "C", scoped: false });
});

test("resolveTier › no program context is safe", () => {
  assert.equal(resolveTier({ t: "B", e: {} }, new Set()).tier, "B");
  assert.equal(resolveTier({ t: "D", e: { p: [1] } }, null).tier, "D");
});

// ── the tier contract ───────────────────────────────────────────────

test("contract › only tier C requires approval; only A/B/C may be offered", () => {
  assert.deepEqual(Object.keys(TIERS).filter(k => TIERS[k].approval), ["C"]);
  assert.deepEqual(Object.keys(TIERS).filter(k => TIERS[k].offer), ["A", "B", "C"]);
  assert.equal(TIERS.D.offer, false);
});

test("contract › thresholds are the documented, measured values", () => {
  assert.equal(TIER_C_MIN_EVIDENCE, 5);
  assert.equal(TIER_C_MIN_STEM, 0.6);
  assert.equal(MAX_CROSSLIST_CLUSTER, 3);
});

test("pairKey › order-independent", () => {
  assert.equal(pairKey("PHYS 1161", "PHYS 1151"), pairKey("PHYS 1151", "PHYS 1161"));
});

test("jaccard › empty sets never divide by zero", () => {
  assert.equal(jaccard(new Set(), new Set(["a"])), 0);
  assert.equal(jaccard(null, undefined), 0);
});

// ── regression set: every one of these was once classified wrong ────

test("regression › known interchangeable pairs reach an offerable tier", () => {
  const cases = [
    ["PHYS 1151", "Physics for Engineering 1", "PHYS 1161", "Physics 1", 12],
    ["CHEM 2313", "Organic Chemistry 2", "CHEM 2317", "Organic Chemistry 2 for Chemistry Majors", 19],
    ["CHEM 2311", "Organic Chemistry 1", "CHEM 2315", "Organic Chemistry 1 for Chemistry Majors", 5],
  ];
  for (const [a, ta, b, tb, q] of cases) {
    const c = { titleOf: { [a]: ta, [b]: tb }, creditsOf: {}, prereqEdges: new Set() };
    const r = classifyPair({ a, b }, { prereqOr: q }, c);
    assert.equal(r.tier, "C", `${a} ⇄ ${b} should be offerable, got ${r.tier}`);
  }
});

test("regression › known NON-equivalent pairs are never offerable", () => {
  const cases = [
    // sequences whose numbering or prereq edge gives them away
    ["LS 6101", "Introduction to Legal Studies 1: Law and Legal Reasoning",
     "LS 6102", "Introduction to Legal Studies 2", 22, new Set()],
    ["SPNS 2102", "Intermediate Spanish 2", "SPNS 3101", "Advanced Spanish 1", 10,
     new Set(["SPNS 2102→SPNS 3101"])],
    // choice pools: strong evidence, unrelated titles
    ["ANTH 1101", "Peoples and Cultures", "SOCL 1101", "Introduction to Sociology", 32, new Set()],
    ["CRIM 1100", "Introduction to Criminal Justice", "SOCL 1101", "Introduction to Sociology", 24, new Set()],
    ["MGSC 2301", "Business Statistics", "PSYC 2320", "Statistics in Psychological Research", 38, new Set()],
    // different courses that merely co-occur
    ["FINA 3301", "Corporate Finance", "FINA 3303", "Investments", 20, new Set()],
  ];
  for (const [a, ta, b, tb, q, edges] of cases) {
    const c = { titleOf: { [a]: ta, [b]: tb }, creditsOf: {}, prereqEdges: edges };
    const r = classifyPair({ a, b }, { prereqOr: q }, c);
    assert.equal(r.offer, false, `${a} ⇄ ${b} must not be offerable, got tier ${r.tier}`);
  }
});
