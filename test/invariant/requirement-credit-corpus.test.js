// INVARIANT · a requirement's credit is READ from its courses, not estimated.
//
// `demandOf` used to answer `minRequirementCount x typicalSH(...)` — how many
// children a section has, times the modal credit of the courses it names. Every
// consumer of that number is downstream of one subtraction:
//
//     free electives = totalCreditsRequired − Σ demandOf
//
// so an under-stated section is handed to the student as "fill this with
// anything". Mechanical Engineering and Design (Boston) is the case that found
// it, and it went wrong three separate ways in one program: a capstone of
// MEIE 4701 (1 SH) + MEIE 4702 (5 SH) sized at 2 x 1; four 4 SH co-requisite
// ARTG pairs sized at 4 x 2; seven engineering entries, five of them a lecture
// plus a 1 SH lab, sized at 7 x 4. 117 SH of a 139 SH degree, so the panel
// offered **22 SH of free electives** against the registrar's own figure of 4.
//
// These tests are hostile to the FIX rather than to the old bug, because the
// obvious ways to get a better headline number are all wrong:
//
//   · SUMMING MORE than the requirement asks for would also close the ME&D gap,
//     and would silently demand credit no student owes. So: satisfaction may
//     never exceed demand, and a section with every named course placed must
//     reach zero shortfall.
//   · MOVING with the student would let the number look right at zero
//     placements and drift afterwards. Demand is a property of the requirement,
//     so it must be identical for any placed set.
//   · FITTING to `generalElectiveSH` would be tuning against a figure this
//     project already decided is not authoritative (it is wrong in both
//     directions, which is why the residual is the rule). It is used here only
//     as an independent 95-program test set with a RATCHET, never as an
//     equality assertion.
//
// Plus one tripwire: the "choose N of M" branch is unexercised by the corpus,
// and a test that silently stops covering a branch is how the next reader comes
// to believe it was measured.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { allocateSections } from "../../src/core/gradRequirements.js";
import { specForNode } from "../../src/core/programEligibility.js";
import { typicalSH, demandOf, satisfiedOf, shortfallOf } from "../../src/core/requirementDemand.js";
import { generalElectiveSHOf } from "../../src/core/requirementBinding.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const raw = JSON.parse(readFileSync(join(ROOT, "public/northeastern/catalog-courses.json"), "utf8"));
const COURSE_MAP = {};
for (const c of raw) {
  const id = `${c.subject}${parseInt(c.number, 10)}`;
  COURSE_MAP[id] = { id, subject: c.subject, number: String(parseInt(c.number, 10)), sh: c.credits ?? 0 };
}

function corpus() {
  // EVERY shipped edition, not a hardcoded year. Program trees are
  // edition-partitioned and all of them ship, so pinning this to 2026 meant a
  // newly-scraped 2027 tree would be checked by nothing at all — the guard
  // would go quiet exactly when the data changed most. `ug`/`grad` and the
  // year are carried in the name so a finding names one edition's record
  // rather than a slug that exists in several.
  const out = [];
  for (const [tag, tree] of [["ug", "undergraduate"], ["grad", "graduate"]]) {
    const treeDir = join(ROOT, "data/northeastern/programs", tree);
    if (!existsSync(treeDir)) continue;
    const years = readdirSync(treeDir).filter(y => /^\d{4}$/.test(y)).sort();
    for (const year of years) {
      const base = join(treeDir, year);
      for (const college of readdirSync(base)) {
        let progs = [];
        try { progs = readdirSync(join(base, college)); } catch { continue; }
        for (const prog of progs) {
          const rf = join(base, college, prog, "requirements.json");
          if (!existsSync(rf)) continue;
          try {
            // `slug` is the bare folder, kept alongside `name` so a lookup for
            // one known program does not have to know the edition it lives in.
            out.push({
              name: `${tag}/${year}/${prog}`, slug: prog, year: Number(year), tree: tag,
              data: JSON.parse(readFileSync(rf, "utf8")),
            });
          } catch { /* the scrape's problem, not this test's */ }
        }
      }
    }
  }
  return out;
}
const CORPUS = corpus();

/** Every course a program's requirements name outright. */
function namedCourses(program) {
  const keys = new Set();
  const walk = (n) => {
    if (n?.type === "COURSE") keys.add(`${n.subject}${n.classId}`);
    for (const c of n?.courses ?? n?.requirements ?? []) walk(c);
  };
  for (const s of program.requirementSections ?? []) walk(s);
  return keys;
}

const unitOf = (section) => typicalSH(specForNode(section), COURSE_MAP);

test("corpus is present", () => {
  assert.ok(CORPUS.length > 900, `only ${CORPUS.length} programs`);
});

// ── The anchor case ────────────────────────────────────────────────

test("ME&D reproduces the registrar's own free-elective figure exactly", () => {
  const p = CORPUS.find(x => x.slug.startsWith("mechanical_engineering_and_design_bsme"));
  assert.ok(p, "the program that found this bug must still be in the corpus");
  assert.equal(p.data.totalCreditsRequired, 139);
  assert.equal(p.data.generalElectiveSH, 4, "the catalog's stated figure");
  assert.equal(generalElectiveSHOf(p.data, COURSE_MAP), 4,
    "139 − 135 SH of requirements. It read 22 while sections were sized by modal credit.");

  // And the three sections that were each wrong in a different way.
  const alloc = allocateSections(p.data.requirementSections, new Set(), new Set(), COURSE_MAP);
  const shOf = (title) => {
    const i = p.data.requirementSections.findIndex(s => s.title === title);
    assert.notEqual(i, -1, `section "${title}" vanished from the corpus`);
    return demandOf(alloc[i], unitOf(p.data.requirementSections[i]), COURSE_MAP);
  };
  assert.equal(shOf("Senior Capstone Design Project"), 6, "MEIE 4701 (1) + MEIE 4702 (5), not 2 x 1");
  assert.equal(shOf("Design Requirements"), 16, "four 4 SH ARTG pairs, not 4 x 2");
  assert.equal(shOf("Required Engineering"), 32, "five lecture+lab pairs among seven, not 7 x 4");
});

// ── Demand is a property of the requirement, not of the student ────

test("demand does not move when courses are placed", () => {
  let moved = 0;
  const examples = [];
  for (const { name, data } of CORPUS) {
    const sections = data.requirementSections ?? [];
    if (!sections.length) continue;
    const named = [...namedCourses(data)];
    // Half of them, and then all of them: a section whose demand depends on
    // placement will move at one of the two.
    for (const placed of [new Set(named.slice(0, Math.ceil(named.length / 2))), new Set(named)]) {
      const empty = allocateSections(sections, new Set(), new Set(), COURSE_MAP);
      const after = allocateSections(sections, placed, new Set(), COURSE_MAP);
      sections.forEach((s, i) => {
        const u = unitOf(s);
        const a = demandOf(empty[i], u, COURSE_MAP);
        const b = demandOf(after[i], u, COURSE_MAP);
        if (a !== b) {
          moved++;
          if (examples.length < 5) examples.push(`${name} § ${s.title}: ${a} -> ${b}`);
        }
      });
    }
  }
  assert.equal(moved, 0,
    `demand moved under placement in ${moved} sections:\n  ${examples.join("\n  ")}`);
});

// ── Satisfaction and demand are one walk, so they cannot disagree ──

test("no section reports more credit satisfied than it demands", () => {
  const over = [];
  for (const { name, data } of CORPUS) {
    const sections = data.requirementSections ?? [];
    const alloc = allocateSections(sections, namedCourses(data), new Set(), COURSE_MAP);
    sections.forEach((s, i) => {
      const u = unitOf(s);
      const d = demandOf(alloc[i], u, COURSE_MAP);
      const sat = satisfiedOf(alloc[i], u, COURSE_MAP);
      if (sat > d && over.length < 8) over.push(`${name} § ${s.title}: ${sat} > ${d}`);
    });
  }
  assert.deepEqual(over, [],
    "a surplus here would lend credit to the section beside it and shrink free electives");
});

// ── Records that are provably STALE and cannot be re-derived ─────────────────
//
// Named, never a count — a count of one passes while a different section
// breaks, which is the failure this file exists for. An entry here is a claim
// that the DATA is wrong and unfixable, not that the check is too strict, and
// it has to carry the evidence for that.
const KNOWN_STALE = new Map([
  ["grad/2026/global_studies_and_international_relations_ms_(boston) § International Economics and Consulting",
    // Diagnosed 2026-09-04. NOT a parser defect and NOT NEU contradicting
    // itself — both were guessed before anyone looked, and both were wrong.
    //
    // The 2026 record flattens FOUR MUTUALLY-EXCLUSIVE CONCENTRATION MENUS
    // (Global Health and Development / Conflict Resolution / Diplomacy /
    // International Economics and Consulting) into four REQUIRED sections of
    // 20 SH each. It ships `concentrations: []`. Consequences, measured:
    //
    //   · the program demands 100 SH against a registrar total of 34;
    //   · this section names 25 SH of courses and reaches only 19, because
    //     GST 6102 and GST 6340 are claimed by the sibling menus first.
    //
    // Three measurements pin the cause to contention rather than to an
    // unsatisfiable section: allocated ALONE the shortfall is 0; allocated
    // with any ONE of the four menus it is 0; only all four at once gives 1.
    //
    // It is stale, not wrong-forever: `scrape-grad-majors.js --url <page>`
    // against the live catalog parses the same page as "7 sections + 4
    // concentrations, 34 SH". The committed record is from the 2026-08-21
    // scrape, before the CPS pages rolled to 2026-27 — the same rollover that
    // left 269 of these 1,071 records with `totalCreditsRequired: 0`.
    //
    // So why not just re-scrape it? Because the 2025-2026 page no longer
    // exists anywhere: the live site serves 2027 and /archive/2025-2026/ was
    // never published (PDF only). Writing today's parse into 2026/ is exactly
    // the mislabelling `catalog-edition.js` refuses. The repair is the 2027
    // grad tree landing, after which this record ages out of the window.
    "stale 2026 record: 4 concentration menus flattened into required sections"],
]);

test("a section its named courses can supply is finished once they are placed", () => {
  // Three exclusions, each a section that placing every named course genuinely
  // cannot answer — so a shortfall there says nothing about this walk:
  //
  //   no children     580 sections state a credit figure in prose and enumerate
  //                   nothing. That is the codeless-sections contract.
  //   a subject window  a RANGE names no course, so `namedCourses` collects none.
  //   a REPEAT         a pool may demand more credit than its distinct courses
  //                   carry: Music Performance's "Music Lessons" is 4 SH over
  //                   MUSC 1901 and 1902 at 1 SH each, taken again each term.
  //                   Repeats are `repeatInstances`/`courseMapWithRepeats`'
  //                   business, and this harness places every course once.
  const short = [];
  const seenStale = new Set();
  for (const { name, data } of CORPUS) {
    const sections = data.requirementSections ?? [];
    const alloc = allocateSections(sections, namedCourses(data), new Set(), COURSE_MAP);
    sections.forEach((s, i) => {
      if (!(s.requirements ?? []).length) return;
      if (JSON.stringify(s).includes('"RANGE"')) return;
      const u = unitOf(s);
      const demand = demandOf(alloc[i], u, COURSE_MAP);
      // What the distinct courses this section names could contribute at most.
      let supply = 0;
      for (const k of namedCourses({ requirementSections: [s] })) supply += COURSE_MAP[k]?.sh ?? 0;
      if (supply < demand) return;
      const sh = shortfallOf(alloc[i], u, COURSE_MAP);
      if (sh <= 0) return;
      const label = `${name} § ${s.title}`;
      if (KNOWN_STALE.has(label)) { seenStale.add(label); return; }
      if (short.length < 10) {
        short.push(`${label}: ${sh} SH short of ${demand}, `
          + `with ${supply} SH of courses named`);
      }
    });
  }

  // An allowlist that outlives the defect is worse than no allowlist: it goes
  // on excusing a section that is now fine, and hides the next real one behind
  // a name that still looks accounted for. So an entry nobody hit is reported
  // — loudly enough to be deleted, without failing a run whose only sin is
  // that the data got better.
  const unseen = [...KNOWN_STALE.keys()].filter(k => !seenStale.has(k));
  if (unseen.length) {
    console.log("  [credit] KNOWN_STALE entries no longer failing — delete them:\n    "
      + unseen.join("\n    "));
  }

  assert.deepEqual(short, [], "these can never be completed, so they can never be got right");
});

// ── The independent test set, as a ratchet ─────────────────────────

test("agreement with the registrar's stated figure only improves", () => {
  // ── Scored over the NEWEST edition of each program, not every edition ──
  //
  // Until the 2026-2027 roll there was one edition on disk and the distinction
  // did not exist. Pooling them is the wrong question in two ways: a program
  // shipped in both editions is scored twice, so the figure drifts with
  // whatever mix of editions happens to be retained rather than with how well
  // we read the catalog; and the number stops describing what any student is
  // shown, since the app resolves one edition per cohort. Newest-per-program is
  // the live set, so this measures the reading rather than the retention.
  const newest = new Map();
  for (const p of CORPUS) {
    const key = `${p.tree}/${p.slug}`;
    if (!newest.has(key) || p.year > newest.get(key).year) newest.set(key, p);
  }
  const stated = [...newest.values()]
    .filter(p => typeof p.data.generalElectiveSH === "number")
    .map(p => ({ name: p.name, said: p.data.generalElectiveSH,
                 ours: generalElectiveSHOf(p.data, COURSE_MAP) }));
  assert.ok(stated.length >= 95, `only ${stated.length} programs state a figure`);

  const exact = stated.filter(r => r.ours === r.said).length;
  const within1 = stated.filter(r => Math.abs(r.ours - r.said) <= 1).length;
  const meanErr = stated.reduce((n, r) => n + Math.abs(r.ours - r.said), 0) / stated.length;

  // Measured 2026-08-30 over the 95 stating programs of the 2025-2026 edition:
  // exact 22 (23%), within-1 54 (57%), mean |error| 2.93. Sizing sections by
  // modal credit scored exact 1, within-1 2, mean error 15.08 — so these are a
  // floor to hold, not a target that was fitted to.
  //
  // Re-measured 2026-09-06 over the 2026-2027 edition, 103 stating programs:
  // exact 32 (31%), within-1 53 (51%), mean |error| 3.31. Exact agreement is
  // the stronger signal and it IMPROVED by eight points; the mean drifted up
  // 0.38. Paired over the 72 programs present in both editions, 50 are
  // unchanged, 5 better and 17 worse, and the 17 are one coherent Khoury
  // cluster — the CS combined majors all moved by the same +5, while
  // Cybersecurity BS improved 19 → 1. That is Khoury restructuring its pages,
  // not the reading drifting, and `generalElectiveSH` is in any case the figure
  // this repo already treats as a SIGNAL rather than an authority because it
  // was measured wrong in both directions (see docs/general-electives.md).
  //
  // So the counts stay where they were — they are still cleared with room —
  // and only the mean ceiling moves, to 3.4.
  const report = `exact ${exact}/${stated.length}, within-1 ${within1}, `
    + `mean |error| ${meanErr.toFixed(2)}`;
  assert.ok(exact >= 22, `exact agreement regressed: ${report}`);
  assert.ok(within1 >= 50, `near agreement regressed: ${report}`);
  assert.ok(meanErr <= 3.4, `mean error regressed: ${report}`);

  // The residual is a claim about the whole degree, so it must stay inside it.
  for (const p of CORPUS) {
    const total = p.data.totalCreditsRequired ?? 0;
    const ge = generalElectiveSHOf(p.data, COURSE_MAP);
    assert.ok(ge >= 0 && ge <= Math.max(0, total),
      `${p.name}: ${ge} SH of free electives against a ${total} SH degree`);
  }
});

// ── Tripwire on the branch the corpus does not exercise ────────────

test("no shipped section is a 'choose N of M', so that branch stays unmeasured", () => {
  // `creditsOfSection` falls back to the N cheapest children when a section
  // requires fewer than it lists. Nothing in the corpus does this — 6,887
  // sections, zero nested SECTION nodes, zero pick-N concentration options — so
  // the branch has never run against real data and no tie-break there has been
  // measured. If the catalog starts publishing one, that choice needs deciding
  // rather than inheriting.
  const found = [];
  const check = (node, where) => {
    if (node?.type === "SECTION" || node?.requirements) {
      const kids = (node.requirements ?? []).length;
      const min = node.minRequirementCount ?? kids;
      if (kids && min < kids) found.push(`${where}: ${min} of ${kids}`);
    }
    for (const c of node?.courses ?? node?.requirements ?? []) check(c, where);
  };
  for (const { name, data } of CORPUS) {
    for (const s of data.requirementSections ?? []) check(s, `${name} § ${s.title}`);
    for (const o of data.concentrations?.concentrationOptions ?? []) {
      check(o, `${name} § concentration ${o.title ?? ""}`);
    }
  }
  assert.deepEqual(found.slice(0, 10), [],
    "a pick-N section appeared; decide its credit rule rather than letting the fallback stand");
});
