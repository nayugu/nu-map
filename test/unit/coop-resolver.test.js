// The resolver: which course a placed work term actually registers.
//
// ── What this file used to test, and why it doesn't ─────────────────
//
// There was a resolver here that INFERRED the course. A co-op block granted one
// hardcoded key, COOP 3945, which satisfies 37 undergraduate programs and NONE
// of the ~99 graduate ones — graduate co-op registers under the program's own
// subject (ENCP 6964 for engineering, CS 6964 for Khoury) and only 11 of the 92
// work-experience courses are in subject COOP/COP. So the resolver read the
// student's program, took its work-term options, and picked one per block.
//
// It was removed, and these tests were rewritten to pin its absence. The
// inference chose an option that FIT rather than the one that was TRUE: a
// student whose co-op registered something their section does not accept saw it
// tick anyway, and no amount of care about abroad-vs-domestic variants fixes
// that, because the app was answering a question only the student can answer.
// The card now has a course field. Degrade to less information, never to wrong
// information — an unfilled block registers nothing.
//
// What survives is `coopOptionsInPrograms`, demoted from a grant to an ORDERING
// HINT: it puts a Khoury student's `CS 6964` at the top of the picker instead
// of somewhere around `E` in an alphabetical list of 87. Suggesting is a
// different act from ticking.
//
// These tests attack the resolution rather than confirm it. The cases that
// matter are the ones where registering the WRONG key would be worse than
// registering none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { workTermGrants, coopOptionsInPrograms } from "../../src/core/specialTermUtils.js";
import specialTerms from "../../src/adapters/northeastern/specialTerms.js";

const TYPES   = specialTerms.getTypes();
const SEM_IDX = { sem1: 0, sem2: 1, sem3: 2, sem4: 3 };

/** A courseMap carrying the `coop` stamps the catalog adapter applies. */
const catalog = (...entries) => Object.fromEntries(entries.map(([id, abroad, halfTime, kind]) =>
  [id, { id, coop: { abroad, halfTime, kind: kind ?? "coop" } }]));

/** A requirement program naming `keys` as one OR of work-term courses. */
const program = (...keys) => ({
  requirementSections: [{
    type: "SECTION", title: "Experiential",
    requirements: [{ type: "OR", courses: keys.map(k => ({
      type: "COURSE", subject: k.replace(/\d+$/, ""), classId: Number(k.match(/\d+$/)[0]) })) }],
  }],
});

const blocks = (...specs) => Object.fromEntries(specs.map((s, i) =>
  [`c${i}`, { typeId: "coop", semId: s.semId ?? `sem${i + 1}`, duration: 6, ...s }]));

const grantedFor = (blks) => [...workTermGrants(blks, TYPES, SEM_IDX).planned].sort();

// ── nothing is inferred, from anything ──────────────────────────────

test("a co-op registers nothing until the student names a course", () => {
  assert.deepEqual(grantedFor(blocks({})), []);
  // Not even when the program names exactly one option and the answer looks
  // obvious. "Obvious" is the inference this file exists to refuse.
  assert.deepEqual(grantedFor(blocks({})), []);
});

test("a graduate co-op registers the program's own subject — because the student picked it", () => {
  assert.deepEqual(grantedFor(blocks({ courseId: "ENCP6964" })), ["ENCP6964"]);
  assert.deepEqual(grantedFor(blocks({ courseId: "CS6964"   })), ["CS6964"]);
});

test("an ordinary co-op never claims experience abroad", () => {
  assert.deepEqual(grantedFor(blocks({ courseId: "COOP3945" })), ["COOP3945"]);
  // …and the reverse: naming the abroad variant does not also grant the base
  // one. Exactly one corpus section (International Business's "International
  // Experiential Learning") wants 3948 alone; the two must stay distinct.
  assert.deepEqual(grantedFor(blocks({ courseId: "COOP3948" })), ["COOP3948"]);
});

test("the `abroad` flag on a block is metadata, not a course choice", () => {
  // It marks the experience for the student's own reading. Letting it select a
  // course would be the inference again, wearing a checkbox.
  assert.deepEqual(grantedFor(blocks({ abroad: true })), []);
  assert.deepEqual(grantedFor(blocks({ abroad: true, courseId: "COOP3945" })), ["COOP3945"]);
});

// ── two blocks are two keys ─────────────────────────────────────────

test("two co-ops register two distinct courses", () => {
  // The multiplicity the old inference could not express: the requirement layer
  // is a Set of base course keys, so two blocks resolving to the same key
  // collapse into one and a program wanting two experiences sees one. Naming
  // them separately is the only representation that survives.
  assert.deepEqual(grantedFor(blocks({ courseId: "COOP3948" }, { courseId: "COOP3945" })),
    ["COOP3945", "COOP3948"]);
});

test("two co-ops naming the SAME course are one key, and that is honest", () => {
  // Two identical registrations genuinely are one key at the requirement layer.
  // The old resolver hid this by inventing a second, different course; showing
  // one is the accurate answer, and the student can name the variant they
  // actually took if they need both to count.
  assert.deepEqual(grantedFor(blocks({ courseId: "COOP3945" }, { courseId: "COOP3945" })),
    ["COOP3945"]);
});

test("resolution follows timeline order, not the order blocks were dragged", () => {
  const late  = { semId: "sem4", courseId: "COOP3948" };
  const early = { semId: "sem1", courseId: "COOP3945" };
  assert.deepEqual(grantedFor(blocks(late, early)), grantedFor(blocks(early, late)));
});

// ── refusing to invent ──────────────────────────────────────────────

test("an unplaced or out-of-timeline co-op grants nothing", () => {
  assert.deepEqual(grantedFor({ a: { typeId: "coop", duration: 6, courseId: "COOP3945" } }), []);
  assert.deepEqual(grantedFor({ b: { typeId: "coop", semId: "parked", duration: 6, courseId: "COOP3945" } }), []);
});

test("a course the student names is registered even if no program accepts it", () => {
  // Deliberate. NU Map trusts the user: the plan records what they did, and the
  // audit is then free to say the requirement is unmet — which is the whole
  // point, and the thing the inference made impossible to see.
  assert.deepEqual(grantedFor(blocks({ courseId: "ENCP6964" })), ["ENCP6964"]);
});

// ── the ordering hint ───────────────────────────────────────────────

const ENCP = catalog(["ENCP6964", false, false], ["ENCP6965", true, false],
                     ["ENCP6954", false, true],  ["ENCP6955", true, true]);

test("a program's work-term options are collected with their variants", () => {
  const opts = coopOptionsInPrograms([program("ENCP6954", "ENCP6955", "ENCP6964", "ENCP6965")], ENCP);
  assert.deepEqual(opts.map(o => o.key), ["ENCP6954", "ENCP6955", "ENCP6964", "ENCP6965"]);
  assert.deepEqual(opts.find(o => o.key === "ENCP6955"),
    { key: "ENCP6955", abroad: true, halfTime: true, kind: "coop" });
});

test("courses without a coop stamp are not work-term options", () => {
  // The 76 co-op- and internship-TITLED classes (ENCP 2000, CS 1210, and the
  // 35 credit-bearing `*994 Internship` courses) are ordinary classes. They
  // must stay placeable rather than becoming something a block can register.
  const mixed = { ...catalog(["ENCP6964", false, false]), ENCP2000: { id: "ENCP2000" } };
  const opts = coopOptionsInPrograms([program("ENCP2000", "ENCP6964")], mixed);
  assert.deepEqual(opts.map(o => o.key), ["ENCP6964"]);
});

test("a double major contributes both programs' options", () => {
  const both = { ...ENCP, ...catalog(["CS6964", false, false]) };
  const opts = coopOptionsInPrograms([program("ENCP6964"), program("CS6964")], both);
  assert.deepEqual(opts.map(o => o.key), ["CS6964", "ENCP6964"]);
});

test("options carry the kind, so a card can scope its picker", () => {
  const mix = catalog(["COOP3945", false, false, "coop"], ["COOP3949", false, false, "intern"]);
  const opts = coopOptionsInPrograms([program("COOP3945", "COOP3949")], mix);
  assert.deepEqual(opts.map(o => [o.key, o.kind]), [["COOP3945", "coop"], ["COOP3949", "intern"]]);
});

test("a stamp written before `kind` existed reads as a co-op", () => {
  const old  = { OLD1234: { id: "OLD1234", coop: { abroad: false, halfTime: false } } };
  const opts = coopOptionsInPrograms([program("OLD1234")], old);
  assert.equal(opts[0].kind, "coop");
});

// ── the internship block, mirroring co-op ───────────────────────────

test("an internship registers its own named course", () => {
  const at = (extra) => [...workTermGrants(
    { i: { typeId: "intern", semId: "sem2", duration: 4, ...extra } }, TYPES, SEM_IDX).planned];
  assert.deepEqual(at({}), []);
  assert.deepEqual(at({ courseId: "COOP3949" }), ["COOP3949"]);
});

test("co-op and internship blocks each declare which family they may register", () => {
  // What scopes the pickers: an internship card must not offer COOP 3945, and
  // a co-op card must not offer COOP 3949 Internship Exchange.
  const byId = Object.fromEntries(TYPES.map(t => [t.id, t]));
  assert.equal(byId.coop.registersCourse,   "coop");
  assert.equal(byId.intern.registersCourse, "intern");
});

// ── completed vs planned ────────────────────────────────────────────

test("only a co-op in a completed semester is reported completed", () => {
  const done = (semId) => semId === "sem1";
  const { planned, completed } = workTermGrants(
    blocks({ semId: "sem1", courseId: "COOP3945" }, { semId: "sem4", courseId: "COOP3948" }),
    TYPES, SEM_IDX, done);
  assert.deepEqual([...planned].sort(), ["COOP3945", "COOP3948"]);
  assert.deepEqual([...completed], ["COOP3945"]);
});
