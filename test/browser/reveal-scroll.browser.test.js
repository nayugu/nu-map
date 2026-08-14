// BROWSER · clicking a course anywhere scrolls the planner to its card.
//
// Nothing but a real browser can check this. The arithmetic has its own unit
// suite (test/unit/scroll-target.test.js); what only a DOM can answer is
// whether the numbers fed to it are the RIGHT numbers:
//
//   • the timeline is a scroll container inside a `transform: scale()` shell,
//     so every rect comes back in different units from `scrollTop`;
//   • a sticky header covers the top of that container and the info panel —
//     which opens as a RESULT of the very click that scrolls — covers the
//     bottom, so "centred in the scroll box" can still mean "behind a panel";
//   • the card may be inside a collapsed section, i.e. not in the DOM at all
//     when the scroll is asked for.
//
// And the thing the user actually asked for is a feeling — smooth, with
// acceleration and deceleration — which is only checkable by watching real
// frames go past. So this suite samples them.
//
// Skips itself when the dev server is not up, like the other browser suites.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

const APP = process.env.NUMAP_URL ?? "http://localhost:5173";

// A course and its single prerequisite, both 4 SH, both in the live catalog.
// The prereq matters for the last test: relation lines are drawn between the
// two cards, and they used to be recomputed on every scroll event.
const COURSE = "ACCT3416";
const PREREQ = "ACCT2301";
// A 1 SH course: these land in the collapsible "other credits" strip rather
// than a main slot, which is the case where the card does not exist yet.
const LOW_SH = "ACCT1990";

async function reachable(url) {
  try {
    const c = new AbortController();
    const timer = setTimeout(() => c.abort(), 1500);
    await fetch(url, { signal: c.signal });
    clearTimeout(timer);
    return true;
  } catch { return false; }
}

const up = await reachable(APP);

describe("reveal scroll", { skip: up ? false : `dev server not running at ${APP}` }, () => {
  let browser;
  before(async () => { ({ chromium: browser } = await import("playwright")); browser = await browser.launch(); });
  after(async () => { await browser?.close(); });

  const boot = async (page) => {
    await page.goto(APP, { waitUntil: "domcontentloaded" });
    await page.locator("[data-timeline-header]").waitFor({ state: "visible", timeout: 30_000 });
    // Disclaimer / onboarding, if this profile has not seen them.
    for (let i = 0; i < 4; i++) { await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(120); }
    await page.waitForTimeout(400);
  };

  /**
   * Boot once to learn the cohort's semester ids, then seed a plan that puts
   * the two courses in the LAST terms — far enough down that revealing them
   * has to scroll — and reload into it.
   *
   * The seed goes in through an init script, NOT a plain `evaluate` + reload:
   * the app saves on unload, so anything written to storage from the live page
   * is overwritten by the empty plan on the way out. Running before the app's
   * own code on the next load is the only point where the write survives.
   */
  const openWithPlanNearTheEnd = async (context) => {
    const page = await context.newPage();
    await boot(page);
    const sems = await page.evaluate(() =>
      [...document.querySelectorAll("[data-sem-id]")].map(e => e.dataset.semId));
    assert.ok(sems.length > 6, `expected a full cohort of terms, got ${sems.length}`);
    const terms = sems.filter(s => /^(fall|spr)/.test(s));   // full terms, not summer halves
    const late  = terms[terms.length - 1];
    const early = terms[terms.length - 3];
    await context.addInitScript(([a, b, from, to]) => {
      const placements = { [a]: from, [b]: to };
      // Both slots: `ncp-state-v2` is what boots, `plan-data-*` is the plan
      // library's copy of the same plan, and they must not disagree.
      for (const k of ["ncp-plan-data-default", "ncp-state-v2"]) {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const d = JSON.parse(raw);
        d.placements = placements;
        localStorage.setItem(k, JSON.stringify(d));
      }
    }, [PREREQ, COURSE, early, late]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("[data-timeline-header]").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(600);
    await page.locator(`[data-drag-from="${late}"][data-drag-id="${COURSE}"]`)
      .waitFor({ state: "attached", timeout: 15_000 });
    return { page, late, early };
  };

  // The scroll container is found by SCROLLABILITY, not by counting parents:
  // the header renders inside a fragment, so its parent is already the
  // timeline, and an off-by-one here reads a div that never scrolls and
  // reports "nothing moved" no matter what the app does. (It did.)
  const FIND_BOX = `(() => {
    let el = document.querySelector("[data-timeline-header]")?.parentElement;
    while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
    return el;
  })()`;
  const scrollTop = (page) => page.evaluate(`${FIND_BOX}?.scrollTop ?? -1`);
  const setScrollTop = (page, v) => page.evaluate(`${FIND_BOX}.scrollTop = ${v}`);

  /** Click a course's row in the CATALOG side panel, via search. */
  const clickBankRow = async (page, id) => {
    const search = page.getByPlaceholder("⌕ search");
    await search.fill(id.replace(/([A-Z]+)(\d+)/, "$1 $2"));
    await page.waitForTimeout(500);
    const row = page.locator(`[data-drop-bank="true"] [data-drag-id="${id}"]`).first();
    await row.waitFor({ state: "visible", timeout: 10_000 });
    await row.click();
  };

  /**
   * Where the card sits relative to the part of the timeline the user can
   * actually see: the scroll box minus the sticky header and minus the info
   * panel drawn over it.
   */
  const cardVisibility = (page, id) => page.evaluate((courseId) => {
    const card = document.querySelector(`[data-drag-from][data-drag-id="${courseId}"]`);
    if (!card) return { found: false };
    const header = document.querySelector("[data-timeline-header]");
    let box = header.parentElement;
    while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
    const panel = document.querySelector("[data-info-panel]");
    const b = box.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const bandTop = b.top + header.getBoundingClientRect().height;
    const bandBottom = panel ? panel.getBoundingClientRect().top : b.bottom;
    return {
      found: true,
      visible: c.top >= bandTop && c.bottom <= bandBottom,
      behindHeader: c.top < bandTop,
      behindPanel: c.bottom > bandBottom,
      cardTop: c.top, cardBottom: c.bottom, bandTop, bandBottom,
    };
  }, id);

  // ── The feature ────────────────────────────────────────────────────
  test("clicking a placed course in the catalog scrolls its card into view", async () => {
    const context = await browser.newContext();
    const { page } = await openWithPlanNearTheEnd(context);

    await setScrollTop(page, 0);
    assert.equal(await scrollTop(page), 0);

    await clickBankRow(page, COURSE);
    await page.waitForTimeout(1400);            // longer than the longest scroll

    const after = await scrollTop(page);
    assert.ok(after > 0, "the timeline never moved");

    const v = await cardVisibility(page, COURSE);
    assert.ok(v.found, "the card is not in the DOM");
    assert.ok(!v.behindHeader, `card ended up under the sticky header (${JSON.stringify(v)})`);
    // The regression this feature is most likely to ship with: the info panel
    // opens on the same click, so a scroll that ignores it "reveals" the card
    // to a place the panel is covering.
    assert.ok(!v.behindPanel, `card ended up behind the info panel (${JSON.stringify(v)})`);
    assert.ok(v.visible, `card not in the readable band (${JSON.stringify(v)})`);
    await context.close();
  });

  test("the scroll is animated, and it accelerates then decelerates", async () => {
    const context = await browser.newContext();
    const { page } = await openWithPlanNearTheEnd(context);
    await setScrollTop(page, 0);

    // Record every frame the scroll offset takes, from the click onwards.
    await page.evaluate(`(() => {
      const box = ${FIND_BOX};
      window.__frames = [];
      const tick = () => { window.__frames.push(box.scrollTop); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    })()`);
    await clickBankRow(page, COURSE);
    await page.waitForTimeout(1400);
    const frames = await page.evaluate(() => window.__frames);

    const moving = frames.filter((v, i) => i > 0 && v !== frames[i - 1]);
    assert.ok(moving.length >= 6,
      `not an animation: the offset changed on ${moving.length} frames`);

    // Monotone: an eased scroll never backtracks.
    const start = frames[0], end = frames[frames.length - 1];
    for (let i = 1; i < frames.length; i++) {
      assert.ok(frames[i] >= frames[i - 1] - 0.5,
        `the scroll went backwards at frame ${i}`);
    }

    // The shape. Take the frames that actually moved and compare how much
    // ground the first, middle and last thirds cover: ease-in-out means the
    // middle covers markedly more than either end. A linear ramp (or a
    // `scrollTop = x` jump padded with idle frames) fails this.
    const path = [start, ...moving];
    const third = Math.floor(path.length / 3);
    assert.ok(third >= 2, `too few moving frames to judge the shape (${path.length})`);
    const span = (a, b) => Math.abs(path[b] - path[a]);
    const first = span(0, third), mid = span(third, 2 * third), last = span(2 * third, path.length - 1);
    assert.ok(mid > first * 1.3, `no acceleration: first ${first}px vs middle ${mid}px`);
    assert.ok(mid > last * 1.3,  `no deceleration: middle ${mid}px vs last ${last}px`);
    assert.ok(end > start, "ended where it started");
    await context.close();
  });

  test("clicking a card that is already on screen does not move the timeline", async () => {
    // The grid card is a click target like any other, and re-centring the plan
    // under the user's cursor every time they inspect a course would be worse
    // than the problem this solves.
    const context = await browser.newContext();
    const { page } = await openWithPlanNearTheEnd(context);

    await clickBankRow(page, COURSE);
    await page.waitForTimeout(1400);
    const settled = await scrollTop(page);

    const card = page.locator(`[data-drag-from][data-drag-id="${COURSE}"]`).first();
    await card.click();                       // deselects
    await page.waitForTimeout(500);
    await card.click();                       // selects again — already visible
    await page.waitForTimeout(900);

    assert.ok(Math.abs(await scrollTop(page) - settled) <= 2,
      "clicking a visible card scrolled the plan");
    await context.close();
  });

  test("a 1 SH course hidden in a collapsed section is opened, then scrolled to", async () => {
    // The hard case: with "collapse other credits" on, a low-credit card is
    // not merely off screen, it is NOT IN THE DOM when the click happens.
    // Scrolling alone reveals nothing, and the node the scroll needs appears
    // a render or two after the section is told to open.
    const context = await browser.newContext();
    const page = await context.newPage();
    await boot(page);
    const sems = await page.evaluate(() =>
      [...document.querySelectorAll("[data-sem-id]")].map(e => e.dataset.semId));
    const late = sems.filter(s => /^(fall|spr)/.test(s)).pop();
    await context.addInitScript(([id, semId]) => {
      localStorage.setItem("ncp-collapse-other-credits", "true");
      for (const k of ["ncp-plan-data-default", "ncp-state-v2"]) {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const d = JSON.parse(raw);
        d.placements = { [id]: semId };
        localStorage.setItem(k, JSON.stringify(d));
      }
    }, [LOW_SH, late]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("[data-timeline-header]").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(800);

    const card = page.locator(`[data-drag-from][data-drag-id="${LOW_SH}"]`);
    assert.equal(await card.count(), 0, "the section was not collapsed; this tests nothing");

    await setScrollTop(page, 0);
    await clickBankRow(page, LOW_SH);
    await page.waitForTimeout(1600);

    assert.equal(await card.count(), 1, "the collapsed section never opened");
    const v = await cardVisibility(page, LOW_SH);
    assert.ok(v.visible && !v.behindPanel,
      `revealed but not readable (${JSON.stringify(v)})`);
    await context.close();
  });

  test("a course that is NOT in the plan scrolls nowhere", async () => {
    // Silence is the honest answer: there is no card, so any movement at all
    // would be movement to somewhere arbitrary.
    const context = await browser.newContext();
    const { page } = await openWithPlanNearTheEnd(context);
    await setScrollTop(page, 300);
    await clickBankRow(page, "ACCT1201");     // in the catalog, not in this plan
    await page.waitForTimeout(1000);
    assert.equal(await scrollTop(page), 300);
    await context.close();
  });

  // ── The overlay has to keep up ─────────────────────────────────────
  test("prereq lines stay glued to their cards while the plan scrolls", async () => {
    // The lines used to be re-measured on every scroll event, which meant a
    // full provider re-render per frame; they fell behind the cards and read
    // as frozen. They now ride the scroll offset, so this checks the only
    // thing that matters: the line's endpoint is still ON the card.
    const context = await browser.newContext();
    const { page } = await openWithPlanNearTheEnd(context);

    await clickBankRow(page, COURSE);          // selecting draws its prereq line
    await page.waitForTimeout(1400);

    const gap = () => page.evaluate((ids) => {
      const paths = [...document.querySelectorAll("svg path[d^='M ']")];
      if (!paths.length) return { drawn: false };
      // The prereq line runs between the two cards; compare the path's
      // rendered end point with the centre of the course card.
      const card = document.querySelector(`[data-drag-from][data-drag-id="${ids.to}"]`);
      const c = card.getBoundingClientRect();
      const centre = { x: c.left + c.width / 2, y: c.top + c.height / 2 };
      let best = Infinity;
      for (const p of paths) {
        const box = p.getBoundingClientRect();
        for (const pt of [{ x: box.left, y: box.top }, { x: box.right, y: box.bottom },
                          { x: box.left, y: box.bottom }, { x: box.right, y: box.top }]) {
          best = Math.min(best, Math.hypot(pt.x - centre.x, pt.y - centre.y));
        }
      }
      return { drawn: true, best };
    }, { to: COURSE });

    const before = await gap();
    assert.ok(before.drawn, "no relation line was drawn at all");
    const anchored = before.best;
    assert.ok(anchored < 120, `the line does not reach the card even at rest (${anchored}px)`);

    // Scroll the timeline by hand, exactly as a wheel would.
    await page.evaluate(`(() => { const b = ${FIND_BOX}; b.scrollTop = b.scrollTop - 220; })()`);
    await page.waitForTimeout(60);            // one frame's grace, not a settle
    const during = await gap();
    assert.ok(Math.abs(during.best - anchored) < 12,
      `the line came unstuck from its card while scrolling ` +
      `(${anchored.toFixed(1)}px → ${during.best.toFixed(1)}px)`);
    await context.close();
  });
});
