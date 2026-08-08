// UNIT · reservations through the share codec, adversarially.
//
// The codec has dropped fields silently twice before — `conc2` was absent for
// long enough that a shared double major arrived unsatisfiable, and
// `substitutions` was captured but never restored. Both were invisible: the
// link worked, it just came back missing something.
//
// So this suite is written to BREAK the round trip rather than to demonstrate
// it: empty maps, falsy credit, unicode, absurd sizes, adversarial labels,
// version-1 payloads, and keys the codec has never seen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodePlan, decodePlan } from "../../src/core/planShare.js";
import { createReservation } from "../../src/core/reservations.js";

const roundTrip = async (data) => decodePlan(await encodePlan(data));

const res = (over = {}) => ({
  ...createReservation({ semId: "fall2026", label: "Khoury Elective", sh: 4 }),
  ...over,
});
const asMap = (list) => Object.fromEntries(list.map(r => [r.id, r]));

// ── The basic contract ─────────────────────────────────────────────

test("a reservation survives the round trip field for field", async () => {
  const r = res({
    requirement: { index: 7, title: "Khoury Approved Electives" },
    origin: "Four Years, Two Co-ops|2.fall.3",
  });
  const back = await roundTrip({ placements: { CS2500: "fall2026" }, reservations: asMap([r]) });
  assert.deepEqual(back.reservations[r.id], r, "every field, unchanged");
});

test("reservations and placements both survive together", async () => {
  const r = res();
  const back = await roundTrip({
    placements: { CS2500: "fall2026", MATH1341: "spr2027" },
    reservations: asMap([r]),
  });
  assert.deepEqual(back.placements, { CS2500: "fall2026", MATH1341: "spr2027" });
  assert.equal(Object.keys(back.reservations).length, 1);
});

// ── Falsy values, where _isEmpty lives ─────────────────────────────

test("a ZERO-credit reservation keeps its sh rather than losing it", async () => {
  // _isEmpty treats 0 as empty and drops the key. That is applied to TOP-level
  // fields, so a nested sh: 0 must survive — but it is exactly the kind of
  // thing that silently vanishes, so it is checked rather than assumed.
  const r = res({ sh: 0 });
  const back = await roundTrip({ reservations: asMap([r]) });
  assert.equal(back.reservations[r.id].sh, 0, "0 SH is a value, not an absence");
});

test("an empty reservations map round-trips as absent, and reads as empty", async () => {
  const back = await roundTrip({ placements: { CS2500: "fall2026" }, reservations: {} });
  // _isEmpty drops it from the payload, which is correct — it costs nothing on
  // the wire. What matters is that the consumer's `?? {}` makes it harmless.
  assert.deepEqual(back.reservations ?? {}, {});
});

test("a reservation with no requirement and no origin still round-trips", async () => {
  const r = createReservation({ semId: "sumB2028", label: "Elective", sh: 4 });
  const back = await roundTrip({ reservations: asMap([r]) });
  assert.deepEqual(back.reservations[r.id], r);
  assert.equal("requirement" in back.reservations[r.id], false, "absent stays absent");
});

test("requirement index 0 is not mistaken for absent", async () => {
  // Section 0 is a real section, and 0 is the classic falsy-drop victim.
  const r = res({ requirement: { index: 0, title: "Computer Science Overview" } });
  const back = await roundTrip({ reservations: asMap([r]) });
  assert.deepEqual(back.reservations[r.id].requirement, { index: 0, title: "Computer Science Overview" });
});

// ── Hostile content ────────────────────────────────────────────────

test("labels survive unicode, quotes, and codec-significant characters", async () => {
  const nasty = [
    "Khoury Elective",
    "选修课 · 通识",                      // CJK + middot
    'He said "elective" & <b>bold</b>',   // quotes, ampersand, tags
    "Élective — naïve façade",            // accents, em dash
    "a|b|c",                              // the origin key's separator
    "…".repeat(50),                       // ellipsis run
    "🎓 graduation elective 🎓",           // astral-plane emoji
    "line\nbreak\tand\ttabs",             // control whitespace
    "\\backslash\\ and /slash/",
  ];
  const list = nasty.map(label => createReservation({ semId: "fall2026", label, sh: 4 }));
  const back = await roundTrip({ reservations: asMap(list) });
  for (const r of list) {
    assert.equal(back.reservations[r.id].label, r.label, `label mangled: ${JSON.stringify(r.label)}`);
  }
});

test("an origin containing the separator still round-trips verbatim", async () => {
  // originKey joins with "|" and a plan label may legitimately contain one.
  const r = res({ origin: "Four Years | Two Co-ops|1.spring.0" });
  const back = await roundTrip({ reservations: asMap([r]) });
  assert.equal(back.reservations[r.id].origin, r.origin);
});

test("a very long label is not truncated", async () => {
  // Note the label is compared to r.label, not to the input: createReservation
  // trims at creation, deliberately. The codec must not truncate beyond that.
  const label = "During the first year of courses, students must complete one course "
    + "for each specialization: ".repeat(8);
  const r = createReservation({ semId: "fall2026", label, sh: 3 });
  const back = await roundTrip({ reservations: asMap([r]) });
  assert.equal(back.reservations[r.id].label, r.label);
  assert.ok(r.label.length > 250, "and it really is long");
});

// ── Ids that are hostile to an object-keyed map ────────────────────

test("a reservation id of __proto__ cannot poison the decoded object", async () => {
  // reservations is an object keyed by id, and ids reach JSON.parse. A key of
  // __proto__ or constructor is the classic way an object-keyed map becomes a
  // prototype-pollution vector. Ids are generated, so this is defence in depth
  // rather than a live hole — but a shared link is attacker-controlled input,
  // and "our ids are safe" is a property of today's generator only.
  for (const id of ["__proto__", "constructor", "prototype", "toString"]) {
    const back = await roundTrip({ reservations: { [id]: { semId: "fall2026", label: "x", sh: 4 } } });
    assert.equal(({}).polluted, undefined, `Object.prototype polluted via ${id}`);
    assert.equal(typeof ({}).toString, "function", `toString clobbered via ${id}`);
    assert.ok(back, "and decoding still returned something");
  }
});

test("a hostile id does not corrupt the placements beside it", async () => {
  const back = await roundTrip({
    placements: { CS2500: "fall2026" },
    reservations: { __proto__: { semId: "fall2026", label: "x", sh: 4 } },
  });
  assert.deepEqual(back.placements, { CS2500: "fall2026" });
});

// ── Scale ──────────────────────────────────────────────────────────

test("a realistic plan's reservations do not blow up the link", async () => {
  // CS and Mathematics reserves 16 cells. A share link is a URL, so this is a
  // real limit rather than a nicety.
  const list = Array.from({ length: 16 }, (_, i) => createReservation({
    semId: ["fall2026", "spr2027", "sumA2027", "sumB2027"][i % 4],
    label: ["Khoury Elective", "MATH elective", "General Elective", "Computing and social issues"][i % 4],
    sh: 4,
    requirement: { index: i % 12, title: "Khoury Approved Electives" },
  }));
  const encoded = await encodePlan({
    placements: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`CS${1000 + i}`, "fall2026"])),
    reservations: asMap(list),
  });
  assert.ok(encoded.length < 4000,
    `share payload is ${encoded.length} chars — too long for a comfortable URL`);
  const back = await decodePlan(encoded);
  assert.equal(Object.keys(back.reservations).length, 16);
});

test("an absurd number of reservations still round-trips exactly", async () => {
  const list = Array.from({ length: 500 }, (_, i) =>
    createReservation({ semId: "fall2026", label: `Elective ${i}`, sh: 4 }));
  const back = await roundTrip({ reservations: asMap(list) });
  assert.equal(Object.keys(back.reservations).length, 500);
  assert.equal(back.reservations[list[499].id].label, "Elective 499");
});

// ── Payloads the codec did not write ───────────────────────────────

test("a version-1 payload without reservations decodes without throwing", async () => {
  const back = await decodePlan(await encodePlan({ version: 1, placements: { CS2500: "fall2026" } }));
  assert.ok(back, "decoded");
  assert.deepEqual(back.reservations ?? {}, {}, "absent reads as none, never as garbage");
});

test("a payload whose reservations are malformed does not corrupt placements", async () => {
  // A link edited by hand, or written by a future version. Losing the
  // reservations is acceptable; losing the courses is not.
  for (const bad of [null, 0, "", [], "not-an-object", { "~res:x": null }]) {
    const back = await roundTrip({ placements: { CS2500: "fall2026" }, reservations: bad });
    assert.deepEqual(back.placements, { CS2500: "fall2026" },
      `placements damaged by reservations=${JSON.stringify(bad)}`);
  }
});

test("ids that look like courses are not silently rewritten", async () => {
  // The prefix is the guard everything else relies on; the codec must not
  // normalise it away.
  const r = res();
  assert.ok(r.id.startsWith("~res:"));
  const back = await roundTrip({ reservations: asMap([r]) });
  assert.ok(Object.keys(back.reservations)[0].startsWith("~res:"));
});
