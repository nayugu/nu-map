// UNIT · the clipped-text fade (ui/FadeText, via core/fadeRamp).
//
// One rule holds this together: A GLYPH THE BOX CUTS THROUGH IS NEVER VISIBLE.
// The fade exists only because a half-cut letter looks broken, so any opacity
// leaking past the last fitting grapheme defeats the whole component. The
// second rule is that a grapheme is what the READER sees — "é" as e + U+0301,
// an emoji ZWJ sequence, a Devanagari consonant + matra — because fading half
// of one is the same defect by another route.
import { test } from "node:test";
import assert from "node:assert/strict";

import { fadeOpacity, graphemes, STEPS, GRADUAL_STEPS } from "../../src/core/fadeRamp.js";

const RAMPS = { STEPS, GRADUAL_STEPS };

test("fade ramp › nothing past the last fitting glyph is ever visible", () => {
  for (const [name, ramp] of Object.entries(RAMPS)) {
    for (let lastFit = -1; lastFit < 40; lastFit++) {
      for (let i = lastFit + 1; i < lastFit + 12; i++) {
        assert.equal(fadeOpacity(lastFit, i, ramp), 0,
          `${name}: glyph ${i} past lastFit ${lastFit} must be invisible`);
      }
    }
  }
});

test("fade ramp › the glyph at the cut is always the faintest step", () => {
  for (const [name, ramp] of Object.entries(RAMPS)) {
    const faintest = ramp[ramp.length - 1];
    for (let lastFit = 0; lastFit < 40; lastFit++) {
      assert.equal(fadeOpacity(lastFit, lastFit, ramp), faintest,
        `${name}: the last visible glyph must sit at the ramp's end`);
    }
  }
});

test("fade ramp › a field too narrow for the whole ramp uses the ramp's TAIL", () => {
  // Anchored at the START instead, a compressed ramp would paint a mid-ramp
  // opacity onto the glyph at the cut — visible, and half a letter wide.
  const ramp = GRADUAL_STEPS;
  const lastFit = 2;                                  // only 3 glyphs fit, ramp is 9
  const shown = [0, 1, 2].map(i => fadeOpacity(lastFit, i, ramp));
  assert.deepEqual(shown, ramp.slice(-3), "compressed ramp must be the tail, not the head");
  assert.equal(shown[shown.length - 1], ramp[ramp.length - 1]);
});

test("fade ramp › the ramp only ever descends toward the edge", () => {
  for (const [name, ramp] of Object.entries(RAMPS)) {
    for (let i = 1; i < ramp.length; i++) {
      assert.ok(ramp[i] < ramp[i - 1], `${name} must decrease monotonically`);
    }
    assert.ok(ramp[0] <= 1 && ramp[ramp.length - 1] > 0, `${name} stays within (0, 1]`);
  }
});

test("fade ramp › glyphs well inside the box are left untouched", () => {
  // undefined, not 1: the component then sets no opacity at all, so nothing
  // creates a stacking context or dims inherited colour.
  assert.equal(fadeOpacity(30, 0, STEPS), undefined);
  assert.equal(fadeOpacity(30, 30 - STEPS.length, STEPS), undefined);
});

test("fade ramp \u203a splitting is by grapheme, so no character is torn in half", () => {
  // Written as \\u escapes, never as literals: an editor or a tool normalising
  // this file would silently turn the decomposed cases back into precomposed
  // ones, and the test would keep passing while proving nothing.
  const torn = [
    ["cafe\u0301",                             "e + combining acute"],
    ["\u{1F469}\u200D\u{1F4BB}",               "ZWJ emoji sequence"],
    ["\u0928\u092E\u0938\u094D\u0924\u0947",  "Devanagari cluster"],
    ["\u05DE\u05B4\u05D1\u05B0",               "Hebrew with points"],
  ];
  for (const [text, why] of torn) {
    const g = graphemes(text);
    assert.ok(g.length < [...text].length,
      `${why}: grapheme split (${g.length}) must be coarser than code-point split (${[...text].length})`);
    assert.equal(g.join(""), text, `${why}: splitting must be lossless`);
    // The real point: no piece of a cluster is ever handed its own opacity.
    for (const unit of g) {
      assert.ok(!/^[\u0300-\u036F\u0591-\u05C7\u0900-\u0903\u093A-\u094F\u200D]/.test(unit),
        `${why}: a combining mark or joiner must never start its own unit (${JSON.stringify(unit)})`);
    }
  }
  // Precomposed text is unaffected either way.
  assert.equal(graphemes("Ma\u00F1ana").length, 6);
});

test("fade ramp › splitting is lossless and total for anything a name can hold", () => {
  for (const s of ["", " ", "  double  spaces  ", "Ω≈ç√", "Study Abroad - CPS", "の", "מִבְטָא"]) {
    assert.equal(graphemes(s).join(""), s);
  }
  assert.deepEqual(graphemes(null), []);
  assert.deepEqual(graphemes(undefined), []);
});
