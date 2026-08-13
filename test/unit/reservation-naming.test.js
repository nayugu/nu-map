// UNIT · a placeholder is NAMED the same way on every surface.
//
// A reservation carries two English phrases for one thing — the plan's wording
// (`code`) and the requirement it stands for (`title`) — and three surfaces used
// to pick between them independently. The requirements tree translated the
// title, the planner card printed the label untranslated, and the sample-plan
// preview translated the LABEL. The last one is why one requirement appeared as
// 安全必修课程 in the panel and 保安课程 ("security guard course") on the card
// beside it: not a worse engine, a different source string.
//
// So these tests do not check that a name is pretty. They check the two
// properties agreement depends on:
//
//   1. the string handed to the translator is the requirement's title whenever
//      one exists, because that is the string the tree hands over;
//   2. the second line never repeats the first, whatever shape the repetition
//      takes — plural, case, punctuation, or an English reader for whom the
//      "translation" is the source text itself.
//
// Everything here is hostile input: absent fields, empty strings, null cards,
// prose that differs only by an "s", and a locale that returns the source.
import { test } from "node:test";
import assert from "node:assert/strict";

import { reservationNameSource, reservationSubline } from "../../src/core/reservations.js";

test("the name source is the requirement title — the string the tree translates", () => {
  const card = { code: "Concentration Course", title: "Advanced Concentration Requirement" };
  assert.equal(reservationNameSource(card), "Advanced Concentration Requirement");
});

test("the plan's own wording is the name only when no requirement is bound", () => {
  assert.equal(reservationNameSource({ code: "Elective", title: "" }), "Elective");
  assert.equal(reservationNameSource({ code: "Elective", title: null }), "Elective");
  assert.equal(reservationNameSource({ code: "Elective" }), "Elective");
});

test("a card with neither names nothing rather than \"undefined\"", () => {
  for (const junk of [{}, { code: "", title: "" }, { code: null, title: null }, null, undefined]) {
    const out = reservationNameSource(junk);
    assert.equal(typeof out, "string", `${JSON.stringify(junk)} must yield a string`);
    assert.equal(out, "");
  }
});

test("the subline is the plan's wording when it adds something", () => {
  const card = { code: "Concentration Course", title: "Advanced Concentration Requirement" };
  assert.equal(reservationSubline(card, "高级方向要求"), "Concentration Course");
});

test("the subline disappears when it would repeat the name", () => {
  // The English reader: the engine hands back the source text, so a second line
  // would print the same phrase twice on every placeholder in the plan.
  assert.equal(reservationSubline({ code: "Khoury Approved Elective" }, "Khoury Approved Elective"), "");
  // Plural only — the two strings the corpus actually pairs.
  assert.equal(reservationSubline({ code: "Khoury Approved Elective" }, "Khoury Approved Electives"), "");
  assert.equal(reservationSubline({ code: "Khoury Approved Electives" }, "Khoury Approved Elective"), "");
  // Case and punctuation only.
  assert.equal(reservationSubline({ code: "Concentration course" }, "CONCENTRATION COURSE"), "");
  assert.equal(reservationSubline({ code: "Co-op / Vacation" }, "Co-op/Vacation"), "");
  assert.equal(reservationSubline({ code: "Elective (any)" }, "Elective any"), "");
});

test("a difference that is a real difference survives normalisation", () => {
  // Guard against the normaliser being so aggressive it swallows distinct
  // phrases: stripping non-alphanumerics must not make these equal.
  assert.equal(reservationSubline({ code: "Elective 1" }, "Elective 2"), "Elective 1");
  assert.equal(reservationSubline({ code: "CS Elective" }, "Math Elective"), "CS Elective");
  // A digit is not punctuation — "4000-level" must not collapse into "level".
  assert.equal(reservationSubline({ code: "4000-level Elective" }, "Elective"), "4000-level Elective");
});

test("nothing to say beats saying something wrong", () => {
  // No label: nothing to print. No translation yet (the engine is async and the
  // first render has none): printing the label alone would flash English under
  // English, so it waits.
  assert.equal(reservationSubline({ code: "" }, "任意选修"), "");
  assert.equal(reservationSubline({ code: "Elective" }, ""), "");
  assert.equal(reservationSubline({ code: "Elective" }, undefined), "");
  assert.equal(reservationSubline(null, "任意选修"), "");
  assert.equal(reservationSubline(undefined, undefined), "");
});

test("a non-Latin name never suppresses the English handle", () => {
  // The normaliser drops non-[a-z0-9], so a fully translated name normalises to
  // "" — which must NOT be read as "equal to the label", or the one line a
  // student can search Banner with vanishes in exactly the locales that need it.
  for (const translated of ["安全必修课程", "履修モデル", "표준 이수", "متطلب أمني", "सुरक्षा आवश्यकता"]) {
    assert.equal(
      reservationSubline({ code: "Security Required Course" }, translated),
      "Security Required Course",
      `a ${translated} name must keep its English subline`);
  }
});
