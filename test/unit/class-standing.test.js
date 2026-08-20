// UNIT · scripts/lib/class-standing.js › Banner class-standing restrictions
//
// This data decides how early the generator may place a capstone, so the failure
// that matters is a FALSE gate: pushing a course into year 4 on a misread page
// can refuse a plan outright, where a missed gate only sequences one course early.
// Every test below is therefore written to push the module toward inventing a gate,
// and asserts it declines.
//
// The fixtures are real Banner HTML shapes, not invented ones — including the
// inconsistent spacing ("Junior (JR)" beside "Senior(SR)" in one list) that makes
// the parenthesised code, not the label, the only usable key.

import { test } from "node:test";
import assert   from "node:assert/strict";
import {
  parseRestrictions, standingKey, classesOf, lenientStanding,
  termGate, courseGate, STANDING_LADDER, STANDING_FLOOR,
} from "../../scripts/lib/class-standing.js";

// ── Real page shapes ────────────────────────────────────────────────

// ENGW 3302, CRN 10351 shape: the notice, a Levels block, then Classes.
const REAL_PAGE = `
<section aria-labelledby="restrictions">
  <div class="infoicon"><span class="status-bold">Not all restrictions are applicable.</span></div>
  <br/>
  <span class="status-bold">Must be enrolled in one of the following Levels:</span><br/>
  <span class="detail-popup-indentation">Undergraduate (UG)</span><br/>
  <br/>
  <span class="status-bold">Must be enrolled in one of the following Classes:</span><br/>
  <span class="detail-popup-indentation">Junior (JR)</span><br/>
  <span class="detail-popup-indentation">Senior(SR)</span><br/>
</section>`;

const NEGATIVE_PAGE = `
<section aria-labelledby="restrictions">
  <span class="status-bold">Cannot be enrolled in one of the following Classes:</span><br/>
  <span class="detail-popup-indentation">Freshmen (FR)</span><br/>
</section>`;

test("parses a real page into headings and values", () => {
  const p = parseRestrictions(REAL_PAGE);
  assert.deepEqual(p["Must be enrolled in one of the following Levels:"], ["Undergraduate (UG)"]);
  assert.deepEqual(p["Must be enrolled in one of the following Classes:"], ["Junior (JR)", "Senior(SR)"]);
});

test("Banner's own notice is not a heading", () => {
  // It carries class="status-bold" like every heading and differs ONLY by the
  // absent colon. Treating it as a heading would attach the Levels values to it.
  const p = parseRestrictions(REAL_PAGE);
  assert.equal(p["Not all restrictions are applicable."], undefined);
  assert.equal(Object.keys(p).length, 2);
});

test("the parenthesised code wins over the label, whatever the spacing", () => {
  assert.equal(standingKey(["Junior (JR)", "Senior(SR)"]), "JR|SR");
  assert.equal(standingKey(["Senior(SR)", "Junior (JR)"]), "JR|SR", "order must not make two buckets");
  assert.equal(standingKey(["Sophomore(  SH )"]), "SH");
});

test("an unrecognised code is dropped, never carried as a gate", () => {
  // A future Banner value must not silently become a floor.
  assert.equal(standingKey(["Postdoctoral (PD)"]), "");
  assert.equal(standingKey(["Junior (JR)", "Postdoctoral (PD)"]), "JR");
  assert.equal(standingKey(["no code at all"]), "");
  assert.equal(standingKey([]), "");
});

test("positive and negative Classes blocks are kept apart", () => {
  assert.deepEqual(classesOf(parseRestrictions(REAL_PAGE)),     { must: "JR|SR", not: "" });
  assert.deepEqual(classesOf(parseRestrictions(NEGATIVE_PAGE)), { must: "", not: "FR" });
});

test("a Majors block is not mistaken for a Classes block", () => {
  // The 9.3% case. "Must be enrolled in one of the following Majors:" has the same
  // markup, and one of NEU's major codes is two letters in parentheses.
  const page = `<span class="status-bold">Must be enrolled in one of the following Majors:</span>
    <span class="detail-popup-indentation">Business Admin and Law (BALW)</span>
    <span class="detail-popup-indentation">Journalism (JR)</span>`;
  assert.deepEqual(classesOf(parseRestrictions(page)), { must: "", not: "" });
});

// ── Malformed input degrades to no gate ─────────────────────────────

test("junk input yields no gate rather than throwing", () => {
  for (const bad of ["", null, undefined, "<html", "not html at all", "{}", "<span class=\"status-bold\">"]) {
    assert.deepEqual(classesOf(parseRestrictions(bad)), { must: "", not: "" }, `input: ${bad}`);
  }
});

test("an empty Classes block is not a gate", () => {
  // Banner renders the heading with nothing under it on some sections.
  const page = `<span class="status-bold">Must be enrolled in one of the following Classes:</span><br/>`;
  assert.deepEqual(classesOf(parseRestrictions(page)), { must: "", not: "" });
});

// ── The ladder ──────────────────────────────────────────────────────

test("most lenient standing is the earliest rung the key admits", () => {
  assert.equal(lenientStanding("JR|SR"), "JR");
  assert.equal(lenientStanding("SR"), "SR");
  assert.equal(lenientStanding("JR|SH|SR"), "SH");
  assert.equal(lenientStanding("FR|JR|SH|SR"), "FR");
});

test("graduate standing is not a rung on the undergraduate ladder", () => {
  // GR|JR|SR is open to juniors, so junior is the floor.
  assert.equal(lenientStanding("GR|JR|SR"), "JR");
  // A GR-only section has no undergraduate floor at all — mapping it onto one is
  // how a master's student gets barred from their own first term.
  assert.equal(lenientStanding("GR"), null);
  assert.equal(lenientStanding("GR|SR"), "SR");
  assert.equal(STANDING_LADDER.includes("GR"), false);
});

test("the ladder and the floor table agree on membership and order", () => {
  assert.deepEqual(Object.keys(STANDING_FLOOR), STANDING_LADDER);
  const vals = STANDING_LADDER.map(s => STANDING_FLOOR[s]);
  assert.deepEqual(vals, [...vals].sort((a, b) => a - b), "floors must be monotonic in the ladder");
});

// ── Rule 1: every section gated ─────────────────────────────────────

test("ENGW 3302: all 24 sections junior-and-up is a junior gate", () => {
  assert.equal(termGate({ sections: 24, std: { "JR|SR": 24 } }), "JR");
});

test("PJM 4850: one of two sections gated is NOT a gate", () => {
  // The measured counterexample that makes rule 1 necessary rather than tidy —
  // a student can simply take the unrestricted section, in any term.
  assert.equal(termGate({ sections: 2, std: { "SR": 1 } }), null);
});

test("a single ungated section defeats a large gated majority", () => {
  assert.equal(termGate({ sections: 25, std: { "JR|SR": 24 } }), null);
});

test("a graduate-only section is not an undergraduate escape hatch", () => {
  // Rule 1 counts it as gated (so the course is not called ungated) while rule 2
  // finds no undergraduate rung — the honest answer is no undergraduate floor.
  assert.equal(termGate({ sections: 6, std: { "GR": 6 } }), null);
  // Mixed: 3 sections open to juniors, 3 graduate-only. Every section IS gated, and
  // a junior can reach three of them.
  assert.equal(termGate({ sections: 6, std: { "GR|JR|SR": 3, "GR": 3 } }), "JR");
});

test("BIOL 4701: two different gates across 7 sections takes the lenient one", () => {
  assert.equal(termGate({ sections: 7, std: { "JR|SR": 4, "SR": 3 } }), "JR");
});

test("a tally exceeding the section count is unresolvable, not a gate", () => {
  // Shared-section merges and mid-run Banner edits both produce this. Guessing
  // which number is right would be inventing a gate.
  assert.equal(termGate({ sections: 2, std: { "SR": 3 } }), null);
});

test("missing or malformed term detail is no gate", () => {
  assert.equal(termGate(undefined), null);
  assert.equal(termGate({}), null);
  assert.equal(termGate({ sections: 4 }), null);
  assert.equal(termGate({ std: { "SR": 4 } }), null, "no section count = cannot check rule 1");
  assert.equal(termGate({ sections: 0, std: { "SR": 0 } }), null);
  assert.equal(termGate({ sections: -1, std: { "SR": 1 } }), null);
});

// ── Rule 2 across terms ─────────────────────────────────────────────

test("a term with no restriction data does not vote", () => {
  // Silence is not evidence. Terms scraped before --restrictions existed carry
  // enrolment but no `std`, and reading them as "ungated" would erase every gate.
  const gate = courseGate({
    "202510": { sections: 3 },                      // never looked up
    "202610": { sections: 3, std: { "JR|SR": 3 } }, // looked up
  });
  assert.deepEqual(gate, { standing: "JR", terms: 1, agree: true });
});

test("no looked-up term at all yields null, not a default", () => {
  assert.equal(courseGate({ "202510": { sections: 3 }, "202530": { sections: 2 } }), null);
  assert.equal(courseGate({}), null);
  assert.equal(courseGate(undefined), null);
});

test("terms disagreeing on the gate take the lenient reading", () => {
  const gate = courseGate({
    "202510": { sections: 2, std: { "SR": 2 } },
    "202610": { sections: 2, std: { "JR|SR": 2 } },
  });
  assert.equal(gate.standing, "JR", "a relaxed gate must not be read forward as the old strict one");
  assert.equal(gate.agree, false);
  assert.equal(gate.terms, 2);
});

test("one term seeing the course ungated removes the gate entirely", () => {
  // This is the strongest conservatism claim in the module, so it gets its own
  // test: a term that looked and found no gate is EVIDENCE, and the most lenient
  // reading of "no gate" is no gate.
  const gate = courseGate({
    "202510": { sections: 2, std: { "SR": 1 } },     // looked up, rule 1 fails
    "202610": { sections: 2, std: { "SR": 2 } },     // looked up, gated
  });
  assert.equal(gate, null);
});

test("agreement across three terms is reported as agreement", () => {
  const gate = courseGate({
    "202410": { sections: 1, std: { "JR|SR": 1 } },
    "202510": { sections: 2, std: { "JR|SR": 2 } },
    "202610": { sections: 4, std: { "JR|SR": 4 } },
  });
  assert.deepEqual(gate, { standing: "JR", terms: 3, agree: true });
});

test("a negative-only term counts as looked up", () => {
  // `stdNot` alone proves the page was fetched. It contributes no floor (the
  // negative form is 0.3% of sections and deliberately unmodelled), so the honest
  // result is "looked, found no floor" — which removes any gate other terms saw.
  assert.equal(courseGate({
    "202510": { sections: 2, stdNot: { "FR": 2 } },
    "202610": { sections: 2, std: { "SR": 2 } },
  }), null);
});

// ── Property sweep: never invent a gate ─────────────────────────────

test("random tallies never produce a gate stricter than every section allows", () => {
  const KEYS = ["FR", "SH", "JR", "SR", "GR", "JR|SR", "GR|JR|SR", "JR|SH|SR", "FR|SH"];
  // xorshift32 — an LCG here loses its low bits to float rounding past 2^53 and its
  // bottom bit has period 2 either way, which is how a sweep passes while covering
  // almost nothing. See the same note in term-history.test.js.
  let rng = 20260820;
  const rand = (n) => {
    rng ^= rng << 13; rng >>>= 0;
    rng ^= rng >>> 17;
    rng ^= rng << 5;  rng >>>= 0;
    return rng % n;
  };

  for (let i = 0; i < 4000; i++) {
    const sections = 1 + rand(12);
    const std = {};
    let placed = 0;
    while (placed < sections && Object.keys(std).length < 3) {
      const k = KEYS[rand(KEYS.length)];
      const n = 1 + rand(sections - placed);
      std[k] = (std[k] ?? 0) + n;
      placed += n;
    }
    const gate = termGate({ sections, std });
    const lenients = Object.keys(std).map(lenientStanding).filter(Boolean);

    if (gate === null) {
      // Only three reasons are allowed to produce null, and every one of them is
      // a fact about the input rather than a judgement call.
      const ruleOneFailed = placed !== sections;
      assert.ok(ruleOneFailed || lenients.length === 0,
        `refused a gate with no reason: std=${JSON.stringify(std)} sections=${sections}`);
      continue;
    }

    assert.equal(placed, sections, "a gate implies rule 1 held");

    // What a gate MEANS: the earliest term the student could take the course at
    // all — the most lenient rung any section admits. Deliberately not "every
    // section admits it": {SR:3, JR|SR:4} floors at JR because four sections are
    // open to juniors, and a floor's job is to not forbid a legal placement.
    const expected = lenients.reduce((a, b) =>
      STANDING_LADDER.indexOf(a) < STANDING_LADDER.indexOf(b) ? a : b);
    assert.equal(gate, expected, `std=${JSON.stringify(std)}`);

    // The claim is never stricter than some real section allows — the direction
    // that can refuse a plan.
    assert.ok(Object.keys(std).some(k => lenientStanding(k) === gate),
      `gate ${gate} is stricter than every section in ${JSON.stringify(std)}`);
  }
});
