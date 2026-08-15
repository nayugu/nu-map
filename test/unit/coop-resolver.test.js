// The resolver: which course a placed work term actually registers.
//
// A co-op block used to grant one hardcoded key, COOP 3945. That satisfies 37
// undergraduate programs and NONE of the ~99 graduate ones, because graduate
// co-op registers under the program's own subject — ENCP 6964 for engineering,
// CS 6964 for Khoury — and only 10 of the 86 work-experience courses are in
// subject COOP. See docs/coop-design.md.
//
// These tests attack the resolution rather than confirm it. The cases that
// matter are the ones where granting the WRONG key would be worse than
// granting none: an ordinary co-op must never claim experience abroad, and a
// program whose options are exhausted must get nothing rather than something
// plausible.
import { test } from "node:test";
import assert from "node:assert/strict";
import { workTermGrants, coopOptionsInPrograms } from "../../src/core/specialTermUtils.js";
import specialTerms from "../../src/adapters/northeastern/specialTerms.js";

const TYPES   = specialTerms.getTypes();
const SEM_IDX = { sem1: 0, sem2: 1, sem3: 2, sem4: 3 };

/** A courseMap carrying the `coop` stamps the catalog adapter applies. */
const catalog = (...entries) => Object.fromEntries(entries.map(([id, abroad, halfTime]) =>
  [id, { id, coop: { abroad, halfTime } }]));

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

const grantedFor = (blks, opts) =>
  [...workTermGrants(blks, TYPES, SEM_IDX, null, opts).planned].sort();

// ── the graduate hole this exists to close ──────────────────────────

const ENCP = catalog(["ENCP6964", false, false], ["ENCP6965", true, false],
                     ["ENCP6954", false, true],  ["ENCP6955", true, true]);

test("a co-op in an engineering program registers ENCP 6964, not COOP 3945", () => {
  const opts = coopOptionsInPrograms([program("ENCP6954", "ENCP6955", "ENCP6964", "ENCP6965")], ENCP);
  assert.deepEqual(grantedFor(blocks({}), opts), ["ENCP6964"]);
});

test("the subject is never guessed — it comes from the program's own option list", () => {
  const CS = catalog(["CS6964", false, false], ["CS6965", true, false]);
  const opts = coopOptionsInPrograms([program("CS6964", "CS6965")], CS);
  assert.deepEqual(grantedFor(blocks({}), opts), ["CS6964"]);
});

// ── abroad, and the thing that must never happen ────────────────────

const IB = catalog(["COOP3945", false, false], ["COOP3946", false, true],
                   ["COOP3947", true, true],   ["COOP3948", true, false]);
const ibOpts = () => coopOptionsInPrograms([program("COOP3945", "COOP3946", "COOP3947", "COOP3948")], IB);

test("an ordinary co-op never claims experience abroad", () => {
  const granted = grantedFor(blocks({}), ibOpts());
  assert.deepEqual(granted, ["COOP3945"]);
  assert.ok(!granted.includes("COOP3948"));
});

test("a co-op marked abroad registers the abroad variant", () => {
  assert.deepEqual(grantedFor(blocks({ abroad: true }), ibOpts()), ["COOP3948"]);
});

test("one abroad co-op grants ONE key — it cannot cover two sections by itself", () => {
  assert.equal(grantedFor(blocks({ abroad: true }), ibOpts()).length, 1);
});

// ── the base fallback: why two co-ops are two keys ──────────────────

test("two abroad co-ops emit the abroad variant AND the base one", () => {
  // Without this, both collapse onto COOP3948 and a program wanting two
  // experiences sees one. The second co-op has nothing abroad-specific left to
  // claim, and a co-op abroad is still a co-op.
  assert.deepEqual(grantedFor(blocks({ abroad: true }, { abroad: true }), ibOpts()),
    ["COOP3945", "COOP3948"]);
});

test("an abroad co-op plus a domestic one emits both variants", () => {
  assert.deepEqual(grantedFor(blocks({ abroad: true }, {}), ibOpts()),
    ["COOP3945", "COOP3948"]);
});

test("resolution follows timeline order, not the order blocks were dragged", () => {
  const late  = { abroad: true,  semId: "sem4" };
  const early = { abroad: false, semId: "sem1" };
  assert.deepEqual(grantedFor(blocks(late, early), ibOpts()),
                   grantedFor(blocks(early, late), ibOpts()));
});

// ── refusing to invent ──────────────────────────────────────────────

test("exhausted options grant NOTHING rather than an unrelated key", () => {
  const only = catalog(["BIOT6964", false, false]);
  const opts = coopOptionsInPrograms([program("BIOT6964")], only);
  // Three co-ops, one option. The extras must not fall back onto COOP 3945,
  // which this program does not name.
  assert.deepEqual(grantedFor(blocks({}, {}, {}), opts), ["BIOT6964"]);
});

test("a domestic co-op cannot satisfy an abroad-only option set", () => {
  const abroadOnly = catalog(["COOP3948", true, false]);
  const opts = coopOptionsInPrograms([program("COOP3948")], abroadOnly);
  assert.deepEqual(grantedFor(blocks({}), opts), []);
});

test("an unplaced or out-of-timeline co-op grants nothing", () => {
  const opts = ibOpts();
  assert.deepEqual(grantedFor({ a: { typeId: "coop", duration: 6 } }, opts), []);
  assert.deepEqual(grantedFor({ b: { typeId: "coop", semId: "parked", duration: 6 } }, opts), []);
});

// ── degrading, not breaking ─────────────────────────────────────────

test("no options at all falls back to the type's static grant", () => {
  // No program chosen, or a catalog with no coop stamps. This is exactly the
  // behaviour before the resolver existed, so a missing data file is a
  // no-change rather than a regression.
  assert.deepEqual(grantedFor(blocks({}), []), ["COOP3945"]);
  assert.deepEqual(grantedFor(blocks({}), undefined), ["COOP3945"]);
});

test("courses without a coop stamp are not work-term options", () => {
  // The 26 co-op-TITLED seminars (ENCP 2000, CS 1210) are ordinary classes and
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

test("an internship still grants no course", () => {
  const granted = workTermGrants({ i: { typeId: "intern", semId: "sem2", duration: 4 } },
    TYPES, SEM_IDX, null, ibOpts()).planned;
  assert.equal(granted.size, 0);
});

// ── completed vs planned ────────────────────────────────────────────

test("only a co-op in a completed semester is reported completed", () => {
  const done = (semId) => semId === "sem1";
  const { planned, completed } = workTermGrants(
    blocks({ semId: "sem1" }, { semId: "sem4", abroad: true }), TYPES, SEM_IDX, done, ibOpts());
  assert.deepEqual([...planned].sort(), ["COOP3945", "COOP3948"]);
  assert.deepEqual([...completed], ["COOP3945"]);
});
