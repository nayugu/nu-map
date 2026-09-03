// UNIT · parseDescriptionCoreqs — the "Requires concurrent registration in …"
// reader, and the union it forms with the labelled Corequisite(s) line.
//
// A corequisite is a hard same-term constraint that drags cards between terms
// and can refuse a plan, and `coreqPartnersOf` walks the whole connected
// component — so one wrong edge welds two groups together. These tests are
// therefore weighted towards what must NOT be read: a choice, a sentence with
// prose in the operand list, an "Accompanies …" line, a recommendation.
//
// The corpus checks at the bottom pin both directions at once: exactly the
// eight known courses gain refs, and the count of coreq edges moves by exactly
// the fifteen the sentences add.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parseDescriptionCoreqs, mergeDescriptionCoreqs }
  from "../../src/adapters/northeastern/descriptionCoreq.js";
import { normalizeCourse } from "../../src/adapters/northeastern/courseNorm.js";
import { extractEdges, coreqPartnersOf } from "../../src/core/courseModel.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ids = (refs) => refs.map(r => `${r.subject}${r.number}`);

// ── What it reads ───────────────────────────────────────────────────

test("descriptionCoreq › the PHYS lab sentence › both partners", () => {
  const desc = "Accompanies PHYS 1151. Covers topics from the course through various "
    + "experiments. Requires concurrent registration in PHYS 1151 and PHYS 1153.";
  assert.deepEqual(ids(parseDescriptionCoreqs(desc, "PHYS1152")), ["PHYS1151", "PHYS1153"]);
});

test("descriptionCoreq › a comma list › every operand", () => {
  const desc = "Requires concurrent registration in CHEM 1211, CHEM 1212 and CHEM 1213.";
  assert.deepEqual(ids(parseDescriptionCoreqs(desc)), ["CHEM1211", "CHEM1212", "CHEM1213"]);
});

test("descriptionCoreq › it names itself › the self-reference is dropped", () => {
  const desc = "Requires concurrent registration in PHYS 1152 and PHYS 1153.";
  assert.deepEqual(ids(parseDescriptionCoreqs(desc, "PHYS1152")), ["PHYS1153"]);
});

test("descriptionCoreq › the same course twice › one ref", () => {
  assert.deepEqual(ids(parseDescriptionCoreqs("Requires concurrent registration in BIOL 1111 and BIOL 1111.")),
    ["BIOL1111"]);
});

// ── What it refuses ─────────────────────────────────────────────────

test("descriptionCoreq › a CHOICE › refused whole, not read as a conjunction", () => {
  // BIOC 4900, verbatim. Read as an "and" this would demand four research
  // courses in one term; `coreqs` is a flat all-of list with no room for "or".
  const desc = "Requires concurrent registration in BIOC 4991, BIOC 4994, BIOL 4991, "
    + "CHEM 4991, or other 4-SH research course approved by the Biochemistry Director.";
  assert.deepEqual(parseDescriptionCoreqs(desc, "BIOC4900"), []);
  // A bare two-course choice, which no page states today. Refused by the
  // bare-code test rather than by the "or" guard — see the equivalent mutant
  // recorded in mutation-probe.js. Pinned here so the behaviour is covered
  // whichever of the two is doing the work.
  assert.deepEqual(parseDescriptionCoreqs("Requires concurrent registration in PHYS 1151 or PHYS 1153."), []);
  assert.deepEqual(parseDescriptionCoreqs("Requires concurrent registration in PHYS 1151, PHYS 1152, or PHYS 1153."), []);
});

test("descriptionCoreq › prose among the operands › refused whole", () => {
  for (const desc of [
    "Requires concurrent registration in PHYS 1151 and permission of the instructor.",
    "Requires concurrent registration in the associated laboratory section.",
    "Requires concurrent registration in PHYS 1151 and a second-year seminar.",
  ]) assert.deepEqual(parseDescriptionCoreqs(desc), [], desc);
});

test("descriptionCoreq › 'Accompanies X' alone › reads nothing", () => {
  // 152 courses say this and 141 already carry a real link; of the rest,
  // BIOL 1112 states "BIOL 1111 (may be taken concurrently)" as a PREREQ —
  // the weaker relation, which permits the lab in a later term.
  assert.deepEqual(parseDescriptionCoreqs("Accompanies BIOL 1111. Covers topics from the course."), []);
});

test("descriptionCoreq › advisory or absent phrasings › read nothing", () => {
  for (const desc of [
    "Students are encouraged to register concurrently in PHYS 1151.",
    "May be taken concurrently with PHYS 1151.",
    "Offers concurrent registration opportunities for qualified students.",
    "", null, undefined,
  ]) assert.deepEqual(parseDescriptionCoreqs(desc), [], String(desc));
});

test("descriptionCoreq › mid-sentence › not read (the anchor is a sentence start)", () => {
  const desc = "Offers a laboratory that requires concurrent registration in PHYS 1151 for majors "
    + "but not for others.";
  // The sentence does not end after the operand list, so the operand segment
  // carries prose and the reader refuses rather than guessing where it stops.
  assert.deepEqual(parseDescriptionCoreqs(desc), []);
});

// ── The union with the labelled field ───────────────────────────────

test("descriptionCoreq › merge › additive, labelled first, deduplicated", () => {
  // PHYS 1157: labelled `Corequisite(s): PHYS 1155`, sentence naming 1155+1156.
  const merged = mergeDescriptionCoreqs(
    [{ subject: "PHYS", number: "1155" }],
    "Requires concurrent registration in PHYS 1155 and PHYS 1156.", "PHYS1157");
  assert.deepEqual(ids(merged), ["PHYS1155", "PHYS1156"]);
});

test("descriptionCoreq › merge › a refused sentence leaves the labelled field alone", () => {
  const labelled = [{ subject: "BIOC", number: "4991" }];
  const merged = mergeDescriptionCoreqs(labelled,
    "Requires concurrent registration in BIOC 4991, BIOL 4991, or other research course.", "BIOC4900");
  assert.deepEqual(ids(merged), ["BIOC4991"]);
});

test("descriptionCoreq › merge › junk in, nothing out", () => {
  assert.deepEqual(mergeDescriptionCoreqs(null, null), []);
  assert.deepEqual(mergeDescriptionCoreqs("not an array", "no sentence here"), []);
  assert.deepEqual(mergeDescriptionCoreqs([{ subject: "X" }, null, {}], ""), []);
});

test("descriptionCoreq › normalizeCourse wires it in › the lab knows its triple", () => {
  const c = normalizeCourse({
    subject: "PHYS", number: "1152", title: "Lab for PHYS 1151", credits: 1,
    coreqs: [],
    description: "Accompanies PHYS 1151. Requires concurrent registration in PHYS 1151 and PHYS 1153.",
  });
  assert.deepEqual(ids(c.coreqs), ["PHYS1151", "PHYS1153"]);
});

// ── Against the shipped catalog ─────────────────────────────────────

test("descriptionCoreq › live catalog › exactly the known sentences are read", () => {
  const raw = JSON.parse(readFileSync(join(ROOT, "public/northeastern/catalog-courses.json"), "utf8"));
  const courses = Array.isArray(raw) ? raw : (raw.courses ?? Object.values(raw));

  const gained = [];
  let added = 0;
  for (const c of courses) {
    const id = `${(c.subject ?? "").toUpperCase()}${c.number ?? ""}`;
    const before = (c.coreqs ?? []).length;
    const after = mergeDescriptionCoreqs(c.coreqs ?? [], c.description, id).length;
    if (after > before) { gained.push(id); added += after - before; }
    assert.ok(after >= before, `${id} lost a corequisite`);
  }

  // ── This assertion INVERTED on 2026-09-03, and the inversion is success ──
  //
  // It used to require that exactly the four PHYS lecture/lab/seminar triples
  // GAIN coreqs here, and that 15 refs were added. That measured the runtime
  // stopgap doing work: the shipped catalog carried only the LABELLED coreqs,
  // and `courseNorm.js` re-read the description on load to recover the rest.
  //
  // The scraper is the canonical caller of the same reader
  // (`catalog-course-parser.js` → `mergeDescriptionCoreqs` at capture time),
  // and the first scrape to include it landed with the 2027 edition roll. The
  // links are now IN the data, so re-reading adds nothing and `gained` is
  // empty. That is the stopgap becoming redundant, exactly as intended.
  //
  // The trap in relaxing it: "gains nothing" is ALSO true of a catalog where
  // these coreqs were deleted outright — which is the failure this test exists
  // for, and the expensive one, since PHYS 1152 carries no labelled
  // Corequisite(s) line at all and the sentence is the only thing tying the lab
  // to its own triple. So presence is asserted directly, and idempotence is
  // asserted beside it rather than in place of it.
  assert.deepEqual(gained.sort(), [],
    "the description reader added corequisites the SCRAPE should already have "
    + "baked in — the canonical path in catalog-course-parser.js has regressed");

  const coreqIds = (subject, number) => {
    const c = courses.find(x => x.subject === subject && String(x.number) === number);
    assert.ok(c, `${subject} ${number} is missing from the catalog entirely`);
    return (c.coreqs ?? []).map(r => `${r.subject}${r.number}`).sort();
  };
  // The four triples, each member naming the other two. PHYS 1157's link to
  // 1155 is the one the labelled field also carried; every other ref here
  // exists ONLY because the description sentence was read.
  assert.deepEqual(coreqIds("PHYS", "1152"), ["PHYS1151", "PHYS1153"]);
  assert.deepEqual(coreqIds("PHYS", "1153"), ["PHYS1151", "PHYS1152"]);
  assert.deepEqual(coreqIds("PHYS", "1156"), ["PHYS1155", "PHYS1157"]);
  assert.deepEqual(coreqIds("PHYS", "1157"), ["PHYS1155", "PHYS1156"]);
  assert.deepEqual(coreqIds("PHYS", "1172"), ["PHYS1171", "PHYS1173"]);
  assert.deepEqual(coreqIds("PHYS", "1173"), ["PHYS1171", "PHYS1172"]);
  assert.deepEqual(coreqIds("PHYS", "1176"), ["PHYS1175", "PHYS1177"]);
  assert.deepEqual(coreqIds("PHYS", "1177"), ["PHYS1175", "PHYS1176"]);
  assert.equal(added, 0, "nothing should be left for the runtime reader to add");
});

test("descriptionCoreq › live catalog › every triple is a complete group", () => {
  const raw = JSON.parse(readFileSync(join(ROOT, "public/northeastern/catalog-courses.json"), "utf8"));
  const courses = Array.isArray(raw) ? raw : (raw.courses ?? Object.values(raw));
  const edges = courses.flatMap(c => {
    const id = `${(c.subject ?? "").toUpperCase()}${c.number ?? ""}`;
    return extractEdges(id, c.prereqs, mergeDescriptionCoreqs(c.coreqs ?? [], c.description, id));
  });

  for (const [lecture, lab, seminar] of [
    ["PHYS1151", "PHYS1152", "PHYS1153"],
    ["PHYS1155", "PHYS1156", "PHYS1157"],
    ["PHYS1171", "PHYS1172", "PHYS1173"],
    ["PHYS1175", "PHYS1176", "PHYS1177"],
  ]) {
    for (const member of [lecture, lab, seminar]) {
      const group = new Set([member, ...coreqPartnersOf(edges, member)]);
      assert.deepEqual([...group].sort(), [lecture, lab, seminar],
        `${member} does not see its whole triple`);
    }
  }

  // BIOC 4900's choice stayed out of the graph.
  assert.deepEqual(coreqPartnersOf(edges, "BIOC4900"), []);
  // BIOL 1112's "(may be taken concurrently)" stayed a prerequisite: a coreq
  // would forbid taking the lab in a later term, which the catalog allows.
  assert.deepEqual(coreqPartnersOf(edges, "BIOL1112"), []);
});
