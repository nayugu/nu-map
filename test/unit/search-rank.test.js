// UNIT · src/core/searchRank.js — order program search results by closeness.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rankOptions } from "../../src/core/searchRank.js";

const opts = [
  { path: "cs-bos", label: "Computer Science Bscs", location: "Boston",  folder: "computer_science_bscs_(boston)",  grp: "2026 — CIS" },
  { path: "cs-ba",  label: "Computer Science Bacs", location: "Boston",  folder: "computer_science_bacs_(boston)",  grp: "2026 — CIS" },
  { path: "cs-oak", label: "Computer Science Bscs", location: "Oakland", folder: "computer_science_bscs_(oakland)", grp: "2026 — CIS" },
  { path: "cs-bn",  label: "Computer Science AND Behavioral Neuroscience Bs", location: "Boston", folder: "cs_and_behavioral_neuroscience_bs_(boston)", grp: "2026 — CIS" },
  { path: "bio",    label: "Biology Bs", location: "Boston", folder: "biology_bs_(boston)", grp: "2026 — Science" },
];

test("rankOptions › closest program name ranks first", () => {
  const r = rankOptions(opts, "computer science").map(o => o.path);
  assert.equal(r[0], "cs-bos", "plain CS BSCS ranks first");
  assert.ok(r.indexOf("cs-bn") > r.indexOf("cs-bos"), "combined major ranks below plain CS");
});

test("rankOptions › BS ranks before BA within the same campus", () => {
  const r = rankOptions(opts, "computer science").map(o => o.path);
  assert.ok(r.indexOf("cs-bos") < r.indexOf("cs-ba"), "BSCS (Boston) before BACS (Boston)");
});

test("rankOptions › location breaks ties deterministically (Boston first)", () => {
  const r = rankOptions(opts, "computer science bscs");
  assert.deepEqual(r.map(o => o.location).slice(0, 2), ["Boston", "Oakland"]);
});

test("rankOptions › word-start beats mid-string substring", () => {
  const r = rankOptions(opts, "biology");
  assert.equal(r[0].path, "bio");
});

test("rankOptions › matches on folder / group as a fallback", () => {
  const r = rankOptions(opts, "bscs");
  assert.ok(r.some(o => o.path === "cs-bos"));
});

test("rankOptions › typo tolerance via in-order subsequence", () => {
  // "compter" drops the 'u' from "computer" — still an in-order subsequence.
  const r = rankOptions(opts, "compter science");
  assert.ok(r.length > 0, "a dropped letter still finds results");
  assert.ok(r[0].path.startsWith("cs"), "the CS programs surface");
});

test("rankOptions › no match → empty; empty query → empty", () => {
  assert.deepEqual(rankOptions(opts, "zzzzzq"), []);
  assert.deepEqual(rankOptions(opts, "   "), []);
});

test("rankOptions › respects the result cap", () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ path: `p${i}`, label: `Data Science ${i}`, location: "Boston" }));
  assert.equal(rankOptions(many, "data", 60).length, 60);
});
