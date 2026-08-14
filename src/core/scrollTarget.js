// ═══════════════════════════════════════════════════════════════════
// SCROLL TARGET — the arithmetic behind "bring that card into view"
// ═══════════════════════════════════════════════════════════════════
// Clicking a course anywhere (bank row, prereq chip, requirement row, a
// NUPath witness) scrolls the timeline to its card when the course is in
// the plan. The DOM half of that lives in ui/smoothScroll.js; the numbers
// live here, pure, because the two decisions that matter are decisions
// about numbers and both are easy to get quietly wrong:
//
//   1. IS IT ALREADY VISIBLE? — if it is, we must not move at all. A click
//      on a card that is already on screen must not yank the view, and the
//      grid card itself is a click target like any other.
//   2. WHERE DOES IT LAND? — centred in the part of the viewport the user
//      can actually see, which is NOT the scroll box: a sticky header sits
//      over the top of it and the info panel covers the bottom. Centring in
//      the raw box puts a card behind the panel and calls it "revealed".
//
// Every length here is CONTENT/LAYOUT px — the units of `scrollTop` — not
// viewport px. On desktop the app is inside `transform: scale(uiScale)`, so
// rects measured from the DOM must be divided by that scale before they get
// here (ui/smoothScroll.js does it). Mixing the two systems is the bug this
// note exists to prevent.

/**
 * The band of the scroll box the user can actually see, in content coords.
 * @returns {{top: number, bottom: number, height: number}}
 */
export function visibleBand({ scrollTop, viewHeight, topInset = 0, bottomInset = 0 }) {
  const top    = scrollTop + topInset;
  const bottom = scrollTop + viewHeight - bottomInset;
  return { top, bottom, height: Math.max(0, bottom - top) };
}

/**
 * True when the card needs no scrolling at all.
 *
 * `margin` keeps a card that is technically on screen but flush against the
 * header or the panel from counting as visible — a card with one pixel of
 * clearance is not something the user can read.
 *
 * A card TALLER than the band can never sit inside it; it counts as visible
 * when it covers the band, which is the best that band can do. Without this
 * case such a card is permanently "not visible" and every click on it
 * re-scrolls the timeline.
 */
export function isCardVisible({ cardTop, cardHeight, scrollTop, viewHeight,
                                topInset = 0, bottomInset = 0, margin = 0 }) {
  const band = visibleBand({ scrollTop, viewHeight, topInset, bottomInset });
  if (band.height <= 0) return false;           // nothing is visible; scroll anyway
  const cardBottom = cardTop + cardHeight;
  if (cardHeight >= band.height) return cardTop <= band.top && cardBottom >= band.bottom;
  return cardTop >= band.top + margin && cardBottom <= band.bottom - margin;
}

/**
 * The `scrollTop` that centres the card in the visible band, clamped to the
 * range the container can actually reach.
 *
 * Clamping is what makes the first and last rows behave: a card in the first
 * semester cannot be centred without scrolling above the content, so it ends
 * up at the top, which is where the user expects it.
 */
export function scrollTargetFor({ cardTop, cardHeight, viewHeight, scrollHeight,
                                  topInset = 0, bottomInset = 0 }) {
  const bandHeight = Math.max(0, viewHeight - topInset - bottomInset);
  // Card centre and band centre coincide:
  //   target + topInset + bandHeight/2 === cardTop + cardHeight/2
  const ideal = cardTop + cardHeight / 2 - topInset - bandHeight / 2;
  const max   = Math.max(0, scrollHeight - viewHeight);
  return Math.min(max, Math.max(0, ideal));
}

// Duration ramp. A short hop should not take as long as crossing the plan, but
// neither should a 4000 px jump finish in a blink — the point of animating at
// all is that the user sees WHERE the view went, so the ceiling is high enough
// to read and the floor high enough to register as motion rather than a cut.
export const MIN_MS = 260;
export const MAX_MS = 820;

/** Milliseconds for a scroll of `distance` content px (sign ignored). */
export function scrollDuration(distance) {
  const d = Math.abs(Number(distance) || 0);
  return Math.round(Math.min(MAX_MS, Math.max(MIN_MS, 240 + d * 0.32)));
}

/**
 * Ease-in-out cubic: accelerate away, decelerate in. Symmetric, so the motion
 * reads the same in both directions, and its velocity is 0 at both ends — a
 * linear ramp stops dead at the target and looks like a jump cut.
 *
 * Clamped, because a rAF callback can fire after its deadline. A progress
 * that is not a number at all resolves to 1, i.e. DONE: the animation's
 * caller reads `p < 1` to decide whether to keep going, so finishing at the
 * target ends it, while treating it as 0 would both freeze the scroll and
 * loop forever. Degrade to the right final position, never to a wrong one.
 */
export function easeInOutCubic(t) {
  if (!Number.isFinite(t)) return 1;
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
