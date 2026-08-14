// ═══════════════════════════════════════════════════════════════════
// SMOOTH SCROLL — the DOM half of "bring that card into view"
// ═══════════════════════════════════════════════════════════════════
// The arithmetic is in core/scrollTarget.js; this file owns only the things
// that need a real element: measuring, animating, and getting out of the way.
//
// Why not `el.scrollIntoView({ behavior: "smooth" })`, which the two older
// call sites used?
//   • It centres in the SCROLL BOX, and the timeline's scroll box is not what
//     the user sees — the sticky header covers its top and the info panel
//     covers its bottom. A card can be "centred" and still be behind the panel.
//   • It always scrolls, even when the card is already in front of the user.
//   • It cannot be interrupted. A 700 ms animation that ignores the user's
//     wheel fights them for most of a second.
// Those three are the whole feature, so the scroll is hand-driven.

import { isCardVisible, scrollTargetFor, scrollDuration, easeInOutCubic } from "../core/scrollTarget.js";

// One animation per container, so a second reveal replaces the first instead
// of two rAF loops writing scrollTop on alternate frames.
const running = new WeakMap();

const reducedMotion = () => {
  try { return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true; }
  catch { return false; }
};

/** Stop any animation on this container and drop its listeners. */
export function cancelScroll(container) {
  const s = container && running.get(container);
  if (!s) return;
  cancelAnimationFrame(s.raf);
  s.detach();
  running.delete(container);
}

/**
 * Animate `container.scrollTop` to `to` with ease-in-out.
 * Any scroll gesture from the user cancels it — their input outranks ours.
 */
export function animateScrollTop(container, to, { duration } = {}) {
  if (!container || !Number.isFinite(to)) return false;   // a bad measurement scrolls nowhere
  cancelScroll(container);
  const from = container.scrollTop;
  const dist = to - from;
  if (Math.abs(dist) < 1) return false;

  const ms = duration ?? scrollDuration(dist);
  if (ms <= 0 || reducedMotion()) { container.scrollTop = to; return true; }

  // wheel/touch only: these are the gestures that mean "I am steering now".
  // A keydown is not — the user may be typing in the catalog search, and
  // cutting the scroll for every keystroke would strand them mid-flight.
  const abort = () => cancelScroll(container);
  const detach = () => {
    container.removeEventListener("wheel", abort);
    container.removeEventListener("touchstart", abort);
  };
  container.addEventListener("wheel", abort, { passive: true });
  container.addEventListener("touchstart", abort, { passive: true });

  const t0 = performance.now();
  const state = { raf: 0, detach };
  const step = (now) => {
    const p = Math.min(1, (now - t0) / ms);
    container.scrollTop = from + dist * easeInOutCubic(p);
    if (p < 1) state.raf = requestAnimationFrame(step);
    else { detach(); running.delete(container); }
  };
  state.raf = requestAnimationFrame(step);
  running.set(container, state);
  return true;
}

/**
 * Scroll `el` (a card inside `container`) into the readable band, or do
 * nothing if it is already there.
 *
 * @param {number} scale      the CSS transform scale the app is rendered at
 *                            (desktop `uiScale`, 1 on phone). Rects come back
 *                            in viewport px; `scrollTop` and `clientHeight`
 *                            are layout px. Everything is converted to layout.
 * @param {number} topInset   sticky-header height, layout px.
 * @param {number} bottomInset info-panel height, layout px.
 * @returns {boolean} whether a scroll was started.
 */
export function scrollCardIntoView(container, el, {
  scale = 1, topInset = 0, bottomInset = 0, margin = 8,
} = {}) {
  if (!container || !el) return false;
  const cRect = container.getBoundingClientRect();
  const eRect = el.getBoundingClientRect();
  if (eRect.height === 0) return false;         // detached or unrendered node
  const sc = scale || 1;

  const geo = {
    // Distance from the top of the SCROLLED CONTENT, which is what scrollTop
    // counts. (The container is borderless, so its client top and border-box
    // top coincide; a border here would need subtracting.)
    cardTop:    container.scrollTop + (eRect.top - cRect.top) / sc,
    cardHeight: eRect.height / sc,
    scrollTop:  container.scrollTop,
    viewHeight: container.clientHeight,
    scrollHeight: container.scrollHeight,
    topInset, bottomInset, margin,
  };
  if (isCardVisible(geo)) return false;
  return animateScrollTop(container, scrollTargetFor(geo));
}

/**
 * Height of a thing that covers part of the timeline, in layout px.
 *
 * Measured, never assumed. The sticky header grows a row on a narrow window
 * and shrinks on a phone; the info panel hugs its content, so its stored
 * height is a CAP and a short course's panel is nowhere near it. Assuming
 * either number puts the card in the wrong place — too low to see, or scrolled
 * further than it needed to be.
 *
 * @param {ParentNode} root   `document` for fixed overlays, the container for
 *                            things that scroll with it.
 */
export function overlayHeight(root, selector, scale = 1) {
  const el = root?.querySelector?.(selector);
  if (!el) return 0;
  return el.getBoundingClientRect().height / (scale || 1);
}
