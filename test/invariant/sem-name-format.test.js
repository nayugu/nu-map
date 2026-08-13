// INVARIANT · one semester name, composed in each locale's own word order.
//
// The app used to name a semester two ways at once. Rows and the preview built
// `season + " " + year` and read season-first (春季 2028); the header toast, the
// availability popover and the summer row sent "Fall 2028" to the translation
// engine and got back year-first (2028 年春季). `semName` + the `sem.name.format`
// key replaced both, so these tests pin what that key must satisfy — and pin the
// two failures that made it necessary in the first place.
//
// Hostile on purpose: a format missing a placeholder, a format that drops the
// other one, a season key nobody wrote, a year that is absent, and — the case
// this whole mechanism exists for — CJK locales whose format must NOT be the
// English one, because if a future edit "tidies" them into "{season} {year}" the
// app silently goes back to reading 春季 2028 with no test to notice.
import { test } from "node:test";
import assert from "node:assert/strict";

import { semName } from "../../src/core/semGrid.js";

const CODES = ["en", "zh", "ja", "ko", "es", "fr", "hi", "ar"];
const LOCALES = {};
for (const c of CODES) {
  LOCALES[c] = (await import(`../../src/locales/${c}.js`)).strings;
}

/** The real substitution the app's `t` performs, so this tests the shipped data. */
const tFor = (strings) => (key, vars = {}) =>
  Object.entries(vars).reduce(
    (s, [k, v]) => s.replaceAll(`{${k}}`, String(v)),
    strings[key] ?? key);

const SEASON_KEYS = [
  "claude.sem.fall", "claude.sem.spring", "claude.sem.summer",
  "claude.sem.sum1", "claude.sem.sum2",
];

test("every locale has a format, and it carries BOTH parts exactly once", () => {
  for (const c of CODES) {
    const fmt = LOCALES[c]["sem.name.format"];
    assert.ok(fmt, `${c} is missing sem.name.format`);
    for (const ph of ["{season}", "{year}"]) {
      const n = fmt.split(ph).length - 1;
      assert.equal(n, 1, `${c}: ${ph} appears ${n} times in "${fmt}"`);
    }
  }
});

test("a composed name contains the season and the year, and nothing left over", () => {
  for (const c of CODES) {
    const t = tFor(LOCALES[c]);
    for (const key of SEASON_KEYS) {
      const out = semName(t, key, 2028);
      assert.ok(out.includes(LOCALES[c][key]), `${c}/${key}: season missing from "${out}"`);
      assert.ok(out.includes("2028"), `${c}/${key}: year missing from "${out}"`);
      assert.ok(!out.includes("{"), `${c}/${key}: unfilled placeholder in "${out}"`);
      assert.equal(out, out.trim(), `${c}/${key}: stray whitespace in "${out}"`);
    }
  }
});

test("CJK keeps the year in FRONT — the reason the format key exists", () => {
  // 2028年春季 is what a Chinese, Japanese or Korean reader says. If someone
  // later normalises these formats to the English order, this fails loudly
  // rather than the UI quietly regressing to 春季 2028.
  for (const c of ["zh", "ja", "ko"]) {
    const out = semName(tFor(LOCALES[c]), "claude.sem.fall", 2028);
    assert.ok(out.startsWith("2028"), `${c} should lead with the year, got "${out}"`);
  }
  // And the space-separated languages keep the season in front.
  for (const c of ["en", "es", "fr", "hi", "ar"]) {
    const strings = LOCALES[c];
    const out = semName(tFor(strings), "claude.sem.fall", 2028);
    assert.ok(out.startsWith(strings["claude.sem.fall"]),
      `${c} should lead with the season, got "${out}"`);
  }
});

test("a term with no year is its season alone — no stray 年, no trailing space", () => {
  for (const c of CODES) {
    const t = tFor(LOCALES[c]);
    const season = LOCALES[c]["claude.sem.incoming"];
    for (const year of ["", null, undefined, 0, NaN]) {
      assert.equal(semName(t, "claude.sem.incoming", year), season,
        `${c}: year ${String(year)} must yield the bare season`);
    }
  }
});

test("no season key means the caller's fallback, never \"undefined\"", () => {
  const t = tFor(LOCALES.en);
  assert.equal(semName(t, null, 2028, "Fall 2028"), "Fall 2028");
  assert.equal(semName(t, undefined, 2028), "");
  assert.equal(semName(t, "", 2028, "x"), "x");
});

test("the summer name is written, not engine-translated, in all 8", () => {
  // claude.sem.summer is what the summer row and the preview's shared column
  // compose. A locale missing it would fall back to the key string itself.
  for (const c of CODES) {
    const v = LOCALES[c]["claude.sem.summer"];
    assert.ok(v && !v.includes("claude.sem"), `${c} is missing claude.sem.summer`);
    // The halves' names must start from the same word, or one row reads
    // "夏季 A" under a heading that says something else entirely.
    for (const half of ["claude.sem.sum1", "claude.sem.sum2"]) {
      assert.ok(LOCALES[c][half].startsWith(v),
        `${c}: ${half} ("${LOCALES[c][half]}") should begin with "${v}"`);
    }
  }
});
