// UNIT · src/core/planCodec.js — the self-contained static-link codec (#p=).
//
// This is the "don't corrupt a shared plan" guarantee for the compact format:
// the whole plan is bit-packed into the URL with NO server storage, so decode
// must reproduce every field a plan carries. Unlike the gzip codec, this one
// preserves fields verbatim (no empty-dropping), so we assert exact equality on
// the reconstructed shape. Runs offline (btoa/atob/TextEncoder are Node globals).
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodePlanStatic, decodePlanStatic } from "../../src/core/planCodec.js";

const rt = (plan) => decodePlanStatic(encodePlanStatic(plan));

// The full shape decode always fills in, so tests can compare against it.
const shape = (over) => ({
  version: 1, entSem: "fall", entYear: 2024, gradSem: "spring", gradYear: 2028,
  placements: {}, specialTermPl: {}, bonusSH: 0, currentSemId: "",
  semOrders: {}, shOverrides: {}, offeredOverrides: {}, collapsedSubs: {},
  major: "", major2: "", conc: "", minor1: "", minor2: "",
  studentType: "undergrad", placedOut: [], substitutions: [], planName: "", locale: "",
  ...over,
});

test("planCodec › a fully-populated plan round-trips field-for-field", () => {
  const plan = shape({
    placements: { CS2000: "fall2024", CS3000: "spr2025", MATH1341: "fall2024" },
    specialTermPl: { w1: { typeId: "coop", semId: "fall2025", duration: 4, company: "Acme" } },
    major: "2026/computer-information-science/computer_science_bs_(boston)",
    minor1: "2026/arts-media-design/animation_minor",
    placedOut: ["ENGW1111", "MATH1341"],
    substitutions: [{ from: "CS2000", to: "CS2001" }],
    studentType: "undergrad", locale: "en", planName: "My Plan", currentSemId: "fall2026", bonusSH: 8,
  });
  assert.deepEqual(rt(plan), plan);
});

test("planCodec › placement course ids and semesters reconstruct exactly", () => {
  const placements = { CS2500: "fall2024", DS3000: "spr2027", THTR1170: "sumA2025", PHIL1100: "sumB2026" };
  assert.deepEqual(rt(shape({ placements })).placements, placements);
});

test("planCodec › the 'incoming' sentinel semester survives", () => {
  const placements = { ENGW1111: "incoming", CS1200: "fall2024" };
  assert.deepEqual(rt(shape({ placements })).placements, placements);
});

test("planCodec › real (long) program ids survive verbatim", () => {
  const major = "2026/computer-information-science/computer_science_and_biology_bs_(boston)";
  assert.equal(rt(shape({ major })).major, major);
});

test("planCodec › co-op entries keep every optional field (or omit cleanly)", () => {
  const specialTermPl = {
    w1: { typeId: "coop", semId: "fall2025", duration: 6, company: "Globex", companyDomain: "globex.com", subline: "SWE" },
    w2: { typeId: "intern", semId: "sumA2026", duration: 4 },
  };
  assert.deepEqual(rt(shape({ specialTermPl })).specialTermPl, specialTermPl);
});

test("planCodec › rare override maps survive verbatim when present", () => {
  const over = { shOverrides: { CS2500: 5 }, offeredOverrides: { CS2500: { fall: "no" } }, semOrders: { fall2024: ["CS2500"] } };
  const decoded = rt(shape(over));
  assert.deepEqual(decoded.shOverrides, over.shOverrides);
  assert.deepEqual(decoded.offeredOverrides, over.offeredOverrides);
  assert.deepEqual(decoded.semOrders, over.semOrders);
});

test("planCodec › non-ASCII plan names survive the round-trip", () => {
  assert.equal(rt(shape({ planName: "計画 — plán 🎓" })).planName, "計画 — plán 🎓");
});

test("planCodec › co-op company names with every uppercase letter survive (charset bounds)", () => {
  // Guards the 6-bit charset: a char that indexed past 63 used to corrupt
  // (e.g. "Tesla" → "aesla"). Exercise the full A–Z range plus digits/symbols.
  const specialTermPl = {
    w1: { typeId: "coop", semId: "fall2025", duration: 4, company: "TUVWXYZ Corp", companyDomain: "tuvwxyz.com" },
    w2: { typeId: "coop", semId: "spr2026", duration: 4, company: "ABCDEFGHIJKLMNOPQRSTUVWXYZ 0189" },
  };
  assert.deepEqual(rt(shape({ specialTermPl })).specialTermPl, specialTermPl);
});

test("planCodec › grad student type and summer entry survive", () => {
  const plan = shape({ studentType: "grad", entSem: "fall", gradSem: "spring", entYear: 2025, gradYear: 2027 });
  assert.deepEqual(rt(plan), plan);
});

test("planCodec › encoded output is URL-safe base64url (no +, /, or = padding)", () => {
  const encoded = encodePlanStatic(shape({ placements: { CS2000: "fall2024" }, planName: "π ∑ 日本語" }));
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
});

test("planCodec › an empty plan encodes tiny and still round-trips", () => {
  const plan = shape({});
  const encoded = encodePlanStatic(plan);
  assert.ok(encoded.length < 40, `empty plan should be tiny, was ${encoded.length}`);
  assert.deepEqual(rt(plan), plan);
});
