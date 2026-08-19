// ═══════════════════════════════════════════════════════════════════
// A placeholder's choices, written so a reader can tell what the choice IS.
//
// The card says `PHYS 1161 and PHYS 1162 and PHYS 1163 or PHYS 1191 and PHYS 1192 and
// PHYS 1193`. Read aloud that is six courses joined by a coin-flip: nothing says whether
// the `or` splits the whole list or only the pair beside it. It is two lab sequences and
// you take one — which is not recoverable from the sentence.
//
// So the hover brackets the groups. Only where they disambiguate: `(MUSC 2101) or
// (MUSC 2150)` is punctuation pretending to be information.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { optionGroupsText, cardOptionGroups } from "../../src/core/reservations.js";

test("options › the groups are found wherever the card keeps them", () => {
  // `occupantCards` builds the card field by field and does NOT copy `options` up — it
  // carries the whole `reservation` instead. Reading only `card.options` is why the hover
  // silently fell back to the truncated wording on every planner card.
  const groups = [["PHYS1161"], ["PHYS1191"]];
  assert.deepEqual(cardOptionGroups({ reservation: { options: groups } }), groups);
  assert.deepEqual(cardOptionGroups({ options: groups }), groups);
  // The nested one wins, since that is the card the planner actually builds.
  assert.deepEqual(cardOptionGroups({ options: [["X"]], reservation: { options: groups } }), groups);
  for (const bad of [null, undefined, {}, { reservation: {} }, { options: "nope" }]) {
    assert.deepEqual(cardOptionGroups(bad), [], `expected [] for ${JSON.stringify(bad)}`);
  }
});

test("options › two multi-course sequences are bracketed apart", () => {
  assert.equal(
    optionGroupsText([["PHYS1161", "PHYS1162", "PHYS1163"], ["PHYS1191", "PHYS1192", "PHYS1193"]]),
    "(PHYS 1161 and PHYS 1162 and PHYS 1163) or (PHYS 1191 and PHYS 1192 and PHYS 1193)");
});

test("options › single courses take NO brackets", () => {
  // The case the rule exists to keep quiet: with nothing to group, brackets are noise.
  assert.equal(optionGroupsText([["MUSC2101"], ["MUSC2150"], ["MUSC2310"]]),
    "MUSC 2101 or MUSC 2150 or MUSC 2310");
});

test("options › one group needs no brackets — there is no `or` to scope", () => {
  assert.equal(optionGroupsText([["CS1800", "CS1802"]]), "CS 1800 and CS 1802");
  assert.equal(optionGroupsText([["ENGW1111"]]), "ENGW 1111");
});

test("options › mixed arities bracket only the groups that need it", () => {
  assert.equal(optionGroupsText([["MUSC1001"], ["MUSC1002", "MUSC1003"]]),
    "MUSC 1001 or (MUSC 1002 and MUSC 1003)");
});

test("options › EVERY option is listed — no `(+12)` truncation in a hover", () => {
  // The card shows three and appends `(+12)`, which was the most confusing thing on it:
  // the number counted something the reader could not see. A hover has the room.
  const groups = Array.from({ length: 15 }, (_, i) => [`MUSC${2100 + i}`]);
  const out = optionGroupsText(groups);
  assert.equal(out.split(" or ").length, 15);
  assert.ok(!/\(\+/.test(out), "no overflow marker belongs in an expanded list");
  assert.ok(out.includes("MUSC 2114"), "the fifteenth option is present");
});

test("options › ids are spaced for reading, and already-spaced ids are untouched", () => {
  assert.equal(optionGroupsText([["PHYS1161"]]), "PHYS 1161");
  assert.equal(optionGroupsText([["PHYS 1161"]]), "PHYS 1161");
});

test("options › nothing to say returns empty, so the caller can fall back", () => {
  // A free elective names no course, and most placeholders are free electives. An empty
  // string is what lets the card's own wording show instead of an empty bracket.
  for (const bad of [null, undefined, [], [[]], [null], [[], []]]) {
    assert.equal(optionGroupsText(bad), "", `expected "" for ${JSON.stringify(bad)}`);
  }
});
