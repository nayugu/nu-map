// UNIT · the reveal-scroll geometry (core/scrollTarget, driven by ui/smoothScroll).
//
// Clicking a course anywhere in the app scrolls the planner to its card. Two
// numbers decide whether that helps or hurts, and both are hostile to
// intuition because the scroll box is NOT what the user sees — a sticky
// header covers its top, the info panel covers its bottom:
//
//   • scrolling when the card is already in front of the user yanks the view
//     for nothing (and the grid card is itself a click target);
//   • "revealing" a card to a position behind the info panel is worse than
//     not scrolling at all — it moves the plan and shows nothing.
//
// So the property that matters is not "did it centre" but: AFTER THE SCROLL,
// IS THE CARD ACTUALLY VISIBLE — unless the container physically cannot get
// there, which is the first and last row of the plan. Everything below is
// aimed at that, plus the easing claim (accelerate, decelerate) the feature
// was asked for.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  visibleBand, isCardVisible, scrollTargetFor, scrollDuration, easeInOutCubic,
  MIN_MS, MAX_MS,
} from "../../src/core/scrollTarget.js";

// A deterministic LCG — a fuzz that fails must fail the same way tomorrow.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Random plausible geometry: a timeline of semesters, a card, two insets. */
function randomGeometry(r) {
  const viewHeight   = 200 + Math.floor(r() * 900);
  const scrollHeight = viewHeight + Math.floor(r() * 6000);
  const topInset     = Math.floor(r() * 120);
  const bottomInset  = Math.floor(r() * 400);
  const cardHeight   = 8 + Math.floor(r() * 300);
  const cardTop      = Math.floor(r() * Math.max(1, scrollHeight - cardHeight));
  const scrollTop    = Math.floor(r() * Math.max(1, scrollHeight - viewHeight));
  return { viewHeight, scrollHeight, topInset, bottomInset, cardHeight, cardTop, scrollTop, margin: 8 };
}

// ── The reveal actually reveals ──────────────────────────────────────

test("scroll target › after scrolling there, the card is visible", () => {
  const r = rng(20260813);
  let checked = 0;
  for (let i = 0; i < 20000; i++) {
    const g = randomGeometry(r);
    const band = visibleBand(g);
    // Preconditions: there has to BE a readable band, and the card has to fit
    // in it with its clearance. Outside those the geometry itself is the
    // constraint, not the arithmetic — covered by their own tests below.
    if (band.height < g.cardHeight + 2 * g.margin) continue;
    const target = scrollTargetFor(g);
    const max = Math.max(0, g.scrollHeight - g.viewHeight);
    // Clamped at an end = the container cannot scroll any further; the card is
    // as visible as it can be made. Everywhere else, visible is not optional.
    if (target === 0 || target === max) continue;
    checked++;
    assert.ok(isCardVisible({ ...g, scrollTop: target }),
      `card at ${g.cardTop}+${g.cardHeight} not visible after scrolling to ${target} ` +
      `(view ${g.viewHeight}, insets ${g.topInset}/${g.bottomInset})`);
  }
  assert.ok(checked > 5000, `fuzz covered too little: only ${checked} cases`);
});

test("scroll target › a card at the very top or bottom still lands on screen", () => {
  // The two cases clamping owns: nothing can be centred past the ends of the
  // content, so "as close as possible" has to be good enough.
  //
  // At the bottom that is only true because the timeline carries trailing
  // padding (App.jsx) at least as tall as the info panel. Without it the last
  // row can never come out from under the panel — no arithmetic here can fix
  // that, which is why the padding is part of this feature's correctness and
  // is modelled explicitly below.
  const base = { viewHeight: 800, scrollHeight: 5000, topInset: 60, bottomInset: 200, margin: 8 };
  const first = { ...base, cardTop: 70, cardHeight: 80, scrollTop: 3000 };
  assert.equal(scrollTargetFor(first), 0);
  assert.ok(isCardVisible({ ...first, scrollTop: 0 }));

  const bottomPad = 240;                         // ≥ bottomInset, as App.jsx sets
  const last = { ...base, cardTop: 5000 - bottomPad - 80, cardHeight: 80, scrollTop: 0 };
  assert.equal(scrollTargetFor(last), base.scrollHeight - base.viewHeight);
  assert.ok(isCardVisible({ ...last, scrollTop: base.scrollHeight - base.viewHeight }),
    "the last row must be reachable from under the info panel");
});

test("scroll target › the last row is reachable exactly when the padding covers the panel", () => {
  // Stated as the rule it is: the trailing padding must be at least the panel
  // height plus the margin, or the final card is unrevealable however the
  // scroll is computed. Guards App.jsx's 240px against being trimmed.
  const check = (bottomPad, bottomInset) => {
    const scrollHeight = 5000, viewHeight = 800, margin = 8;
    const g = { viewHeight, scrollHeight, topInset: 60, bottomInset, margin,
                cardTop: scrollHeight - bottomPad - 80, cardHeight: 80, scrollTop: 0 };
    return isCardVisible({ ...g, scrollTop: scrollTargetFor(g) });
  };
  assert.equal(check(240, 200), true);
  assert.equal(check(240, 232), true);
  assert.equal(check(240, 233), false);   // panel + margin now exceeds the padding
  assert.equal(check(24, 200), false);
});

test("scroll target › never scrolls outside what the container can reach", () => {
  const r = rng(7);
  for (let i = 0; i < 20000; i++) {
    const g = randomGeometry(r);
    const t = scrollTargetFor(g);
    assert.ok(t >= 0, `negative scrollTop ${t}`);
    assert.ok(t <= Math.max(0, g.scrollHeight - g.viewHeight), `overscrolled to ${t}`);
    assert.ok(Number.isFinite(t), `non-finite target ${t}`);
  }
});

test("scroll target › content shorter than the viewport never scrolls", () => {
  // No scrollbar at all: scrollHeight === viewHeight. Any non-zero target
  // would be a scroll the browser silently refuses, and the animation would
  // spend its whole duration writing a value that never changes.
  for (const cardTop of [0, 50, 300, 700]) {
    const t = scrollTargetFor({
      cardTop, cardHeight: 70, viewHeight: 800, scrollHeight: 800,
      topInset: 60, bottomInset: 120,
    });
    assert.equal(t, 0);
  }
});

// ── Visibility: the insets are the whole point ───────────────────────

test("scroll target › a card behind the header or the panel is NOT visible", () => {
  const g = { viewHeight: 800, scrollHeight: 5000, topInset: 60, bottomInset: 200,
              scrollTop: 1000, cardHeight: 70, margin: 0 };
  // Inside the scroll box, but under the sticky header.
  assert.equal(isCardVisible({ ...g, cardTop: 1010 }), false);
  // Inside the scroll box, but under the info panel.
  assert.equal(isCardVisible({ ...g, cardTop: 1560 }), false);
  // Between them: visible.
  assert.equal(isCardVisible({ ...g, cardTop: 1200 }), true);
  // Exactly flush with each edge: visible with no margin demanded…
  assert.equal(isCardVisible({ ...g, cardTop: 1060 }), true);
  assert.equal(isCardVisible({ ...g, cardTop: 1530 }), true);
  // …and not once a margin is, which is what the margin is for: a card with
  // one pixel of clearance is not a card the student can read.
  assert.equal(isCardVisible({ ...g, cardTop: 1060, margin: 8 }), false);
  assert.equal(isCardVisible({ ...g, cardTop: 1530, margin: 8 }), false);
});

test("scroll target › a card taller than the band counts as visible when it covers it", () => {
  // Otherwise such a card is permanently "not visible" and every single click
  // on it re-scrolls the timeline — the exact yank this feature must not do.
  const g = { viewHeight: 400, scrollHeight: 5000, topInset: 50, bottomInset: 50,
              cardHeight: 600, margin: 8 };
  // band [1100,1400] ⊂ card [1000,1600] — the best this viewport can do.
  assert.equal(isCardVisible({ ...g, cardTop: 1000, scrollTop: 1050 }), true);
  assert.equal(isCardVisible({ ...g, cardTop: 1000, scrollTop: 700 }),  false); // band above it
  assert.equal(isCardVisible({ ...g, cardTop: 1000, scrollTop: 1600 }), false); // band below it
});

test("scroll target › nothing is visible when the panel swallows the viewport", () => {
  // A dragged-tall info panel on a phone can leave no band at all. Claiming
  // the card is visible there would mean never scrolling again.
  const g = { viewHeight: 300, scrollHeight: 5000, topInset: 60, bottomInset: 300,
              cardTop: 1000, cardHeight: 70, scrollTop: 900 };
  assert.equal(visibleBand(g).height, 0);
  assert.equal(isCardVisible(g), false);
});

test("scroll target › visibility is exactly 'no scroll needed'", () => {
  // These two must agree, or a click either scrolls when it shouldn't or
  // decides to scroll and then computes a target that changes nothing.
  const r = rng(99);
  for (let i = 0; i < 20000; i++) {
    const g = randomGeometry(r);
    if (visibleBand(g).height < g.cardHeight + 2 * g.margin) continue;
    if (!isCardVisible(g)) continue;
    const t = scrollTargetFor(g);
    const max = Math.max(0, g.scrollHeight - g.viewHeight);
    // A visible card may still not be centred, so the target legitimately
    // differs — but scrolling to it must never HIDE the card.
    assert.ok(isCardVisible({ ...g, scrollTop: Math.min(max, Math.max(0, t)) }),
      "scrolling to the target hid a card that was already visible");
  }
});

// ── Duration ─────────────────────────────────────────────────────────

test("scroll duration › bounded, symmetric, and monotonic in distance", () => {
  assert.equal(scrollDuration(0), MIN_MS);
  assert.equal(scrollDuration(-4000), scrollDuration(4000));
  assert.equal(scrollDuration(1e9), MAX_MS);
  let prev = 0;
  for (let d = 0; d < 6000; d += 7) {
    const ms = scrollDuration(d);
    assert.ok(ms >= MIN_MS && ms <= MAX_MS, `duration ${ms} out of bounds at ${d}px`);
    assert.ok(ms >= prev, `duration went backwards at ${d}px`);
    prev = ms;
  }
});

test("scroll duration › junk in, a usable number out", () => {
  // The distance comes from DOM measurements, and a detached node measures
  // NaN-adjacent nonsense. A NaN duration makes the animation never finish.
  for (const junk of [NaN, undefined, null, "", "abc", Infinity, -Infinity, {}]) {
    const ms = scrollDuration(junk);
    assert.ok(Number.isFinite(ms) && ms >= MIN_MS && ms <= MAX_MS, `${String(junk)} → ${ms}`);
  }
});

// ── Easing ───────────────────────────────────────────────────────────

test("easing › starts at 0, ends at 1, never overshoots or goes backwards", () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  let prev = 0;
  for (let i = 0; i <= 1000; i++) {
    const v = easeInOutCubic(i / 1000);
    assert.ok(v >= 0 && v <= 1, `overshoot ${v} at ${i / 1000}`);
    assert.ok(v >= prev - 1e-12, `went backwards at ${i / 1000}`);
    prev = v;
  }
});

test("easing › clamped outside [0,1]", () => {
  // rAF can fire after the deadline, and a negative first frame is possible
  // when the clock is read before the start stamp. Either would fling the
  // scroll past the target and back.
  for (const t of [-5, -0.01, 1.01, 12, NaN]) {
    const v = easeInOutCubic(t);
    assert.ok(v >= 0 && v <= 1, `unclamped: ${t} → ${v}`);
  }
});

test("easing › symmetric, and it really does accelerate then decelerate", () => {
  assert.ok(Math.abs(easeInOutCubic(0.5) - 0.5) < 1e-12);
  for (let i = 0; i <= 500; i++) {
    const t = i / 1000;
    assert.ok(Math.abs(easeInOutCubic(t) + easeInOutCubic(1 - t) - 1) < 1e-12,
      `asymmetric at ${t}`);
  }
  // The requested feel, stated as a measurement rather than a promise: the
  // speed at both ends is a fraction of the speed in the middle, and it rises
  // to the middle and falls after it.
  const dt = 1e-4;
  const speed = t => (easeInOutCubic(t + dt) - easeInOutCubic(t)) / dt;
  const mid = speed(0.5 - dt / 2);
  assert.ok(speed(0) < mid * 0.05, "does not start slow");
  assert.ok(speed(1 - dt) < mid * 0.05, "does not end slow");
  for (let i = 1; i < 500; i++) {
    assert.ok(speed(i / 1000) >= speed((i - 1) / 1000) - 1e-9, "not accelerating before the midpoint");
    const t = 0.5 + i / 1000;
    if (t + dt <= 1) {
      assert.ok(speed(t) <= speed(t - 0.001) + 1e-9, "not decelerating after the midpoint");
    }
  }
});
