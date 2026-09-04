// BROWSER · a plan holding a course the catalog no longer has must still open.
//
// ── Why this exists ────────────────────────────────────────────────
//
// `public/northeastern/catalog-courses.json` is a single CURRENT snapshot and
// the monthly scrape REPLACES it. So every catalog roll deletes courses out
// from under plans that already reference them. Measured for the 2026→2027
// roll (`scripts/edition-probe.js --snapshot --editions 2027 --all-subjects`):
// 974 of our 7,966 courses are absent from the live edition, plus 115 more in
// 10 subjects that no longer have a page at all — about 1,089 retirements.
// `scripts/lib/course-retention.js` rescues the ones a shipped program tree
// still names; CLAUDE.md's simulation of this same roll puts the remainder,
// deleted outright, at 367.
//
// A student who placed one of those 367 has an id in `placements` that
// resolves to nothing. Nothing filters it: the load effect in PlannerContext
// builds `courseMap` from the catalog alone and never reconciles the restored
// plan against it, so `courseMap[id]` is simply `undefined` downstream.
//
// That is not obviously survivable. `occupantCards` warns in as many words
// that "card rendering reads several of these without guarding — color.slice()
// was the one that threw", which is a crash reachable from a missing record.
// And this arrives unattended: the scrape pushes straight to main, so the roll
// lands on a Tuesday morning with nobody watching.
//
// ── What this asserts ──────────────────────────────────────────────
//
// Not that the retired course is rendered nicely — it is gone, and this repo's
// rule is to degrade to LESS information rather than to wrong information. Only
// that the blast radius is the one card:
//
//   1. the app mounts, with no page error and no recovery screen;
//   2. the rest of the plan still renders — a real course seeded beside the
//      dead one is on the board.
//
// (2) is the half worth having. "No error" is also true of a blank page, and a
// plan that silently opens EMPTY is the expensive failure here: it looks like
// the student's own work was lost.
//
// The dead id is synthetic rather than a real retirement, on purpose. A real
// one gets rescued by course-retention or comes back in a later edition, and
// then this test passes for a reason that has nothing to do with what it
// checks. `ZZZZ 9999` can never be in the catalog.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ensureBuild, serveDist } from "./helpers/serveDist.js";

const CS_BS = "../../data/northeastern/programs/undergraduate/2026/" +
  "computer-information-science/computer_science_bscs_(boston)/requirements.json";

/** A course id the catalog cannot ever contain — a retirement that stays retired. */
const DEAD = "ZZZZ9999";

/**
 * A real course to sit beside it, chosen at RUN TIME.
 *
 * Hard-coding one is how the sibling restrictions test broke: the catalog is
 * rescraped monthly and any fixed pick eventually stops being what the test
 * assumed. Picked as: a real CS course of 4 SH or more, so the board shows it
 * as its own card rather than folding it into the collapsed "other credits"
 * group where this test could not see it.
 */
function pickLiveCourse() {
  const catalog = JSON.parse(
    readFileSync(new URL("../../public/northeastern/catalog-courses.json", import.meta.url), "utf8"));
  for (const c of catalog) {
    if (c.subject !== "CS") continue;
    if ((c.credits ?? 0) < 4) continue;
    return { id: `${c.subject}${c.number}`, pattern: new RegExp(`${c.subject}\\s*${c.number}`) };
  }
  return null;
}

// `now` is which semester the plan calls the current one, and it is a
// parameter because the alarm gate below is defined against it: everything
// before it is "completed" and everything from it on is still open.
const seed = (placements, now = "fall2025") => `(${((pl, major, cur) => {
  const P = "ncp-";
  localStorage.setItem(P + "plan-index", JSON.stringify([
    { id: "default", name: "T", studentType: "undergrad", parentId: null, lastOpened: Date.now() },
  ]));
  localStorage.setItem(P + "plan-data-default", JSON.stringify({
    version: 1, studentType: "undergrad",
    entSem: "fall", entYear: 2025, gradSem: "spring", gradYear: 2029,
    currentSemId: cur,
    major, minor1: null, placements: pl,
    specialTermPl: {}, semOrders: {}, placedOut: [], substitutions: [],
  }));
  localStorage.setItem(P + "tour-seen", "true");
}).toString()})(${JSON.stringify(placements)},${JSON.stringify(CS_BS)},${JSON.stringify(now)})`;

describe("a retired course in a saved plan", () => {
  let browser, server, port, launchError = null;
  const live = pickLiveCourse();

  before(async () => {
    await ensureBuild();
    ({ server, port } = await serveDist());
    try {
      const { chromium } = await import("playwright");
      browser = await chromium.launch();
    } catch (e) {
      // Recorded and asserted on, never skipped — a missing browser must show
      // up as a gap rather than as a green run.
      launchError = e;
    }
  });

  after(async () => {
    await browser?.close();
    await new Promise((r) => server?.close(r));
  });

  /**
   * Open a seeded plan and return what the page did.
   *
   * `union`, when given, is served in place of retired-courses.json. Serving it
   * by route interception rather than writing the file keeps the repo's real
   * artifact out of the test's way — writing it would make the test pass by
   * mutating the very thing it is checking. The synthetic union also keeps
   * these cases stable: a REAL retirement can be rescued by course-retention
   * or revived in a later edition, and then they would pass for reasons
   * unrelated to what they check. The suite below covers the real artifact.
   */
  async function open(placements, union = null) {
    assert.equal(launchError, null,
      `chromium unavailable — run \`npx playwright install chromium\`: ${launchError?.message}`);
    assert.ok(live, "no 4 SH CS course in the catalog — the picker needs revisiting");

    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await ctx.addInitScript(seed(placements));
    if (union) {
      await ctx.route("**/northeastern/retired-courses.json", route =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(union) }));
    }
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e?.message ?? e)));
    page.on("console", m => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForTimeout(4000);

    const mounted = await page.locator("[data-timeline-header]")
      .waitFor({ state: "visible", timeout: 45_000 }).then(() => true).catch(() => false);
    const bodyText = await page.evaluate(() => document.body?.innerText ?? "");
    await page.close();
    await ctx.close();
    return { errors, mounted, bodyText };
  }

  test("the app still mounts", async () => {
    const { errors, mounted, bodyText } = await open({
      [DEAD]: "fall2025", [live.id]: "fall2025",
    });
    assert.ok(!/Something went wrong/i.test(bodyText),
      "the recovery screen is showing — a retired course took the whole app down");
    assert.deepEqual(errors, [],
      `a retired course in the plan logged errors:\n  ${errors.join("\n  ")}`);
    assert.ok(mounted, "no timeline header — the planner did not mount");
  });

  test("MEASUREMENT — what the credit total does", async () => {
    // Not a guard. This records the CURRENT behaviour so the cost of the roll
    // is written down somewhere other than a comment.
    //
    // `totalSHPlaced` sums `effectiveCourseMap[id]?.sh ?? 0` over placement
    // keys, and PlannerContext says so in as many words: "unknown ids resolve
    // to 0". So a retired course is not a crash — it is a silent subtraction.
    // The plan opens, looks fine, and is short by that course's credits with
    // nothing on screen saying why. Printed rather than asserted because the
    // number is the finding; Milestone A is what changes it.
    const withDead = await open({ [DEAD]: "fall2025", [live.id]: "fall2025" });
    const alone    = await open({ [live.id]: "fall2025" });
    const sh = (txt) => (txt.match(/(\d+)\s*(?:SH|credits?)/i) ?? [])[1] ?? "?";
    console.log(`    retired course seeded: total reads ${sh(withDead.bodyText)}`);
    console.log(`    retired course absent: total reads ${sh(alone.bodyText)}`);
    console.log(`    the dead id appears on screen: ${/ZZZZ\s*9999/.test(withDead.bodyText)}`);
  });

  test("THE FIX — a course in the retired union comes back", async () => {
    // The inversion of the measurement above, and the only end-to-end proof
    // that the union is wired to anything. The same plan, the same dead id,
    // the one difference being that retired-courses.json now carries its
    // record: the card must render and its credits must count.
    //
    // 8 SH is the assertion that matters. A card that draws but contributes
    // nothing would look fixed and still be short-changing the degree, which
    // is the exact failure this whole change exists to end.
    const union = [{
      subject: "ZZZZ", number: "9999", title: "Retired Course", credits: 4,
      description: "A course a frozen edition published and the current catalog does not.",
      scheduleType: "Lecture", nuPath: [], sections: [], prereqs: [], coreqs: [],
      lifespan: { firstEdition: 2026, lastEdition: 2026, editions: [2026], editionsHeld: 1 },
    }];
    const { errors, bodyText } = await open(
      { [DEAD]: "fall2025", [live.id]: "fall2025" }, union);

    assert.deepEqual(errors, [],
      `the union's record threw on render:\n  ${errors.join("\n  ")}`);
    assert.match(bodyText, /ZZZZ\s*9999/,
      "the retired course is in the union and still did not render — the merge is not reaching the board");
    // Anchored to the credit readout, not a bare /\b8\b/ — an unanchored digit
    // matches a course number, a year or a term label, so it would pass with
    // the total still reading 4 and the whole assertion would be decorative.
    const total = (bodyText.match(/(\d+)\s*(?:SH|credits?)/i) ?? [])[1];
    assert.equal(total, "8",
      `the retired course rendered but the total reads ${total} SH, not 8 — its 4 SH are `
      + "not counted. A card that looks right and still under-counts the degree is the "
      + "failure this change exists to end.");

    // The student must be TOLD. Resolving the course silently would replace one
    // quiet wrong answer with another: the card would look like any other, and
    // a course Northeastern no longer teaches would sit in a plan reading as
    // ordinary. This assertion was missing until someone asked why they had
    // never seen a retired course — the honest answer being that NO course in
    // the shipped data carries the flag (0 of 7,966), so the badge, its
    // tooltip and its eight locales have never rendered in production at all.
    // On the roll that goes to ~1,070 at once, unattended.
    // Matched on the badge's own glyph rather than the bare word: "retired"
    // alone could be satisfied by a tooltip, a filter label or any future copy,
    // and an assertion that cannot fail is worse than none.
    assert.match(bodyText, /⚠\s*retired/i,
      "the course resolved but the ⚠ retired badge is not on screen — the flag "
      + "CourseCard reads from `course.retired` is not reaching a union record");
  });

  test("the rest of the plan survives it", async () => {
    // The failure this exists for: the plan opens, throws nothing, and is
    // EMPTY — indistinguishable to the student from having lost their work.
    const { bodyText } = await open({
      [DEAD]: "fall2025", [live.id]: "fall2025",
    });
    assert.match(bodyText, live.pattern,
      `${live.id} was seeded beside a retired course and is not on the board — `
      + "one dead id emptied the plan");
  });
});

// ── Against the REAL shipped data ───────────────────────────────────
//
// Everything above serves a SYNTHETIC union by route interception, which
// proves the wiring but not the artifact. This one intercepts nothing: it
// seeds a course from the union `derive-retired-union.js` actually wrote and
// asserts the app resolves and badges it.
//
// The distinction earned its place. For the whole of this feature's life the
// shipped catalog contained ZERO retired courses, so every green test was
// green against data that could not exercise the path — and nobody noticed
// until someone asked to be shown one.
describe("a real retired course from the shipped union", () => {
  let browser, server, port, launchError = null;
  const union = JSON.parse(readFileSync(
    new URL("../../public/northeastern/retired-courses.json", import.meta.url), "utf8"));
  // 4 SH or more so the board gives it its own card rather than folding it
  // into the collapsed "other credits" group where this could not see it.
  const subject = union.find(c => (c.credits ?? 0) >= 4);
  // The edition the copy must name, read off the SUBJECT rather than written
  // in. It used to be the literal /2025–2026/, which was correct only while
  // exactly one edition was frozen: every union course then had the same
  // `lastEdition`, so a hardcoded string and a real assertion were
  // indistinguishable. Backfilling 2023–2025 made the union span four
  // editions, this test picked a course last published in 2022-2023, and it
  // failed on copy that was exactly right. Derived, it now checks the property
  // that matters — that the sentence names THIS course's last edition — and
  // survives the next edition landing.
  const lastEd = subject?.lifespan?.lastEdition;
  const editionLabel = lastEd ? `${lastEd - 1}–${lastEd}` : null;

  before(async () => {
    await ensureBuild();
    ({ server, port } = await serveDist());
    try {
      const { chromium } = await import("playwright");
      browser = await chromium.launch();
    } catch (e) { launchError = e; }
  });
  after(async () => {
    await browser?.close();
    await new Promise((r) => server?.close(r));
  });

  test("it resolves, counts, and says it is retired", async () => {
    assert.equal(launchError, null, "chromium unavailable");
    // An empty union is the state this whole feature was invisible in. It is a
    // legitimate state (before an edition roll) but it must not read as a pass.
    assert.ok(subject,
      "retired-courses.json holds no course of 4 SH or more — if the union is "
      + "empty this test proves nothing and should be understood as unrun");

    const id = `${subject.subject}${subject.number}`;
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await ctx.addInitScript(seed({ [id]: "fall2025" }));
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e?.message ?? e)));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForTimeout(4000);
    const bodyText = await page.evaluate(() => document.body?.innerText ?? "");
    await page.close();
    await ctx.close();

    assert.deepEqual(errors, [], `${id} threw on render:\n  ${errors.join("\n  ")}`);
    assert.match(bodyText, new RegExp(`${subject.subject}\\s*${subject.number}`),
      `${id} is in the shipped union and did not render`);
    assert.match(bodyText, /⚠\s*retired/i, `${id} rendered without the retired badge`);

    // The tooltip must be the UNION one, not the retention one. It was the
    // retention sentence's old "it's kept because your catalog year still
    // requires it" clause that forced this branch — a plain falsehood about a
    // union course, which is required by nothing, shipping on all of them.
    // That clause is now deleted from all eight locales, so what separates the
    // two strings today is the positive claim the union one can make and the
    // retention one cannot: naming the edition. Read off the title attribute
    // rather than the body text, since a tooltip is not rendered text and
    // `innerText` cannot see it.
    const tip = await page0Title(browser, port, id);
    // The union string's "No current program requires it; it's kept here
    // because your plan does" was cut too — same objection as the retention
    // clause before it. It explained OUR storage decision to a student who
    // did not ask, and a student holding a retired course needs the registrar
    // fact, not our bookkeeping. So the ONLY thing separating the two strings
    // is now the edition, which is checked immediately below; this assertion
    // just pins that we are not showing the retention wording.
    assert.ok(/last published/i.test(tip),
      `${id} shows the RETENTION tooltip, which cannot name an edition: "${tip}"`);
    assert.ok(editionLabel,
      `${id} is in the union with no lifespan.lastEdition — the union tooltip `
      + "cannot name an edition and this assertion would pass vacuously");
    assert.ok(tip.includes(editionLabel),
      `${id} should name the catalog edition that last published it `
      + `(${editionLabel}), got: "${tip}"`);
  });
});

// ── The alarm is withdrawn once the semester is over; the fact is not ───────
//
// Two separate claims, and they are tested apart because they are easy to
// conflate and the conflation is the bug in both directions:
//
//   · the amber OUTLINE is an interruption, so it is owed a decision the
//     student can still make. On a completed term there is none.
//   · the BADGE is information, and "NEU no longer lists this course" stays
//     true of a course already taken. Withdrawing it with the outline would
//     hide the fact rather than stop shouting it — and it is the badge that
//     leads to the panel, which is where the sentence lives.
//
// Everything here reads COMPUTED style off the real DOM. Nothing in Node
// evaluates a React component body, so a gate written into a `borderColor`
// ladder is only actually checkable in a browser.
describe("an availability alarm stops once the semester is over", () => {
  let browser, server, port, launchError = null;
  const union = JSON.parse(readFileSync(
    new URL("../../public/northeastern/retired-courses.json", import.meta.url), "utf8"));
  const subject = union.find(c => (c.credits ?? 0) >= 4);
  // The edition the copy must name, read off the SUBJECT rather than written
  // in. It used to be the literal /2025–2026/, which was correct only while
  // exactly one edition was frozen: every union course then had the same
  // `lastEdition`, so a hardcoded string and a real assertion were
  // indistinguishable. Backfilling 2023–2025 made the union span four
  // editions, this test picked a course last published in 2022-2023, and it
  // failed on copy that was exactly right. Derived, it now checks the property
  // that matters — that the sentence names THIS course's last edition — and
  // survives the next edition landing.
  const lastEd = subject?.lifespan?.lastEdition;
  const editionLabel = lastEd ? `${lastEd - 1}–${lastEd}` : null;

  before(async () => {
    await ensureBuild();
    ({ server, port } = await serveDist());
    try {
      const { chromium } = await import("playwright");
      browser = await chromium.launch();
    } catch (e) { launchError = e; }
  });
  after(async () => {
    await browser?.close();
    await new Promise((r) => server?.close(r));
  });

  /**
   * Place `id` in `sem`, with the plan's "now" at fall2027, and report what the
   * card looks like.
   *
   * The alarm colour is read from the LIVE stylesheet rather than hard-coded to
   * #fbbf24: two themes define `--warn-bright` differently (themes.js line 62
   * against line 187), so a literal would pass or fail on which theme the test
   * happened to boot in, which is exactly the kind of green-for-the-wrong-
   * reason this suite exists to avoid.
   */
  async function card(id, sem) {
    assert.equal(launchError, null,
      `chromium unavailable — run \`npx playwright install chromium\`: ${launchError?.message}`);
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await ctx.addInitScript(seed({ [id]: sem }, "fall2027"));
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e?.message ?? e)));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForTimeout(4000);

    const sel = `[data-drag-id="${id}"][data-drag-from="${sem}"]`;
    const out = await page.evaluate(([s, cssSel]) => {
      const norm = (c) => {
        // Resolve a var() to the rgb() the browser actually painted, by
        // measuring it rather than parsing it.
        const probe = document.createElement("div");
        probe.style.color = c;
        document.body.appendChild(probe);
        const v = getComputedStyle(probe).color;
        probe.remove();
        return v;
      };
      const el = document.querySelector(cssSel);
      return {
        found: !!el,
        border: el ? getComputedStyle(el).borderTopColor : null,
        alarm: norm("var(--warn-bright)"),
        text: el ? el.innerText : "",
      };
    }, [sem, sel]);

    // Open the panel on this card, then read it.
    //
    // `el.click()` rather than `page.click()`: a real pointer click is refused
    // here because the sticky timeline header overlays the card's hit box
    // ("<div> intercepts pointer events", 30 s of retries). That is a layout
    // fact about a card scrolled under a header, not something this test is
    // about — it is checking what the PANEL says once opened. The dispatched
    // event still bubbles to React's delegated root listener, so the same
    // onClick runs.
    let panelText = "";
    if (out.found) {
      await page.$eval(sel, el => el.click());
      await page.waitForTimeout(800);
      panelText = await page.evaluate(() =>
        document.querySelector("[data-info-panel]")?.innerText ?? "");
    }

    await page.close();
    await ctx.close();
    return { ...out, panelText, errors };
  }

  test("a retired course in a COMPLETED semester keeps its badge and loses its outline", async () => {
    assert.ok(subject,
      "retired-courses.json holds no course of 4 SH or more — if the union is "
      + "empty this test proves nothing and should be understood as unrun");
    const id = `${subject.subject}${subject.number}`;
    const c  = await card(id, "fall2025");           // now = fall2027, so this is done

    assert.deepEqual(c.errors, [], `${id} threw on render:\n  ${c.errors.join("\n  ")}`);
    assert.ok(c.found, `${id} is not on the board in fall2025 — the seed did not take`);
    assert.notEqual(c.border, c.alarm,
      `${id} sits in a finished semester and still wears the amber alarm outline (${c.border}). `
      + "An availability warning is a prediction about registration, and that term's "
      + "registration is over.");
    assert.match(c.text, /⚠\s*retired/i,
      `${id} lost its retired BADGE along with the outline. The outline is the `
      + "interruption; the badge is the fact, and the fact did not stop being true "
      + "because the student already took the course.");
  });

  test("the same course in a FUTURE semester still wears the outline", async () => {
    // The other half, and the one that makes the test above mean anything: a
    // gate that suppressed the outline everywhere would pass the first test
    // and delete the feature. This is the mutation the first test cannot see.
    assert.ok(subject, "union is empty — unrun");
    const id = `${subject.subject}${subject.number}`;
    const c  = await card(id, "fall2028");           // now = fall2027, so this is ahead

    assert.deepEqual(c.errors, [], `${id} threw on render:\n  ${c.errors.join("\n  ")}`);
    assert.ok(c.found, `${id} is not on the board in fall2028 — the seed did not take`);
    assert.equal(c.border, c.alarm,
      `${id} is planned for a semester nobody has registered for yet and carries no `
      + `alarm outline (${c.border}, expected ${c.alarm}) — the gate is suppressing `
      + "the warning where it is the whole point of the feature");
  });

  test("the panel states the retirement outright, on a FINISHED placement too", async () => {
    // The panel is unconditional where the board is gated. It is also the only
    // surface that can carry the sentence at all: the card has room for "⚠
    // retired" and a `title=`, and a `title=` does not exist on a touch device.
    assert.ok(subject, "union is empty — unrun");
    const id = `${subject.subject}${subject.number}`;
    const c  = await card(id, "fall2025");           // completed — no outline, still explained

    assert.ok(c.panelText,
      `clicking ${id} opened no info panel, so this test checked nothing`);
    assert.match(c.panelText, /⚠\s*retired/i,
      `the info panel for ${id} does not say it is retired. That is the fact a student `
      + "opens the panel to find, and until now it was only ever in a tooltip.");
    assert.match(c.panelText, /last published/i,
      `the panel for ${id} does not carry the UNION sentence — it is showing the `
      + "retention wording, which says only that the catalog no longer lists the course "
      + "and cannot name the edition that last published it.");
    assert.ok(editionLabel,
      `${id} carries no lifespan.lastEdition — this assertion would pass vacuously`);
    assert.ok(c.panelText.includes(editionLabel),
      `the panel for ${id} does not name the catalog edition that last published it `
      + `(${editionLabel}), which is the one registrar fact an advisor can act on`);
  });
});

// ── A retired course sinks below its LIVE twin, and stays findable ─────────
//
// NEU renumbers far more often than it retires. After the 2023–2025 archive
// backfill, 389 retired courses share a subject and title with a live one
// (ALY 6015 → ALY 6125 "Intermediate Analytics"). The bank scores a title
// query identically for both — no code token matches — so the winner fell to
// the alphabetical tie-break on code, and the retired number is usually the
// LOWER one: measured, the retired twin ranked first in 292 of the 389.
//
// Both halves are asserted, because each is a different way to get this wrong:
//
//   · the live course must come FIRST. A student searching by name was being
//     offered, at the top, the course NEU no longer teaches.
//   · the retired course must still be THERE. Filtering it out was the
//     documented plan (docs/catalog-editions-design.md §8 step 7) and the
//     backfill is what refutes it — three years of retired courses are courses
//     students actually TOOK, and one recording CS 2500 from 2023 has to be
//     able to find it. A filter would break the use case the data exists for.
//
// This runs in a browser because the ranking lives in a React `useMemo`, which
// nothing in Node evaluates.
describe("a retired course ranks below its live twin without disappearing", () => {
  let browser, server, port, launchError = null;

  // The pair is DERIVED from shipped data rather than named, so the test keeps
  // testing after a roll changes which courses are retired. It picks the
  // regression case specifically: a twin whose retired code sorts FIRST, which
  // is the one the old comparator got wrong.
  const union = JSON.parse(readFileSync(
    new URL("../../public/northeastern/retired-courses.json", import.meta.url), "utf8"));
  const live = JSON.parse(readFileSync(
    new URL("../../public/northeastern/catalog-courses.json", import.meta.url), "utf8"));

  const liveByTitle = new Map();
  for (const c of live) {
    const k = `${c.subject}|${(c.title ?? "").toLowerCase()}`;
    if (!liveByTitle.has(k)) liveByTitle.set(k, c);
  }
  const pair = (() => {
    for (const r of union) {
      const title = (r.title ?? "").trim();
      // A short or punctuation-heavy title makes the search box match dozens of
      // unrelated courses and the ordering claim stops being about this pair.
      if (title.length < 12 || /[^\w\s\-—–&:,.']/.test(title)) continue;
      const l = liveByTitle.get(`${r.subject}|${title.toLowerCase()}`);
      if (!l) continue;
      const rCode = `${r.subject}${r.number}`, lCode = `${l.subject}${l.number}`;
      // Only the case the fix is for: without the retired rung, this pair
      // would come back retired-first.
      if (rCode.localeCompare(lCode) < 0) return { title, rCode, lCode };
    }
    return null;
  })();

  before(async () => {
    await ensureBuild();
    ({ server, port } = await serveDist());
    try {
      const { chromium } = await import("playwright");
      browser = await chromium.launch();
    } catch (e) { launchError = e; }
  });
  after(async () => {
    await browser?.close();
    await new Promise((r) => server?.close(r));
  });

  test("the live course is offered first, and the retired one is still offered", async () => {
    assert.equal(launchError, null, "chromium unavailable");
    // No pair means no renumbered twins in the shipped data. That is a
    // legitimate state and it must not read as a pass — this test would be
    // asserting nothing at all.
    assert.ok(pair,
      "no retired course shares a subject and title with a live one, so this "
      + "test proves nothing and should be understood as unrun");

    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e?.message ?? e)));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForTimeout(3500);

    // The bank's search box, found by its placeholder rather than by position.
    await page.fill("input[placeholder*='search']", pair.title);
    await page.waitForTimeout(1200);

    const order = await page.$$eval("[data-bank-id]", els =>
      els.map(e => e.getAttribute("data-bank-id")));
    await page.close();
    await ctx.close();

    assert.deepEqual(errors, [], `searching threw:\n  ${errors.join("\n  ")}`);

    const liveAt = order.indexOf(pair.lCode);
    const retAt  = order.indexOf(pair.rCode);

    assert.ok(liveAt >= 0,
      `searching "${pair.title}" did not return the LIVE course ${pair.lCode}; `
      + `got ${order.slice(0, 8).join(", ") || "nothing"}`);
    assert.ok(retAt >= 0,
      `searching "${pair.title}" did not return the RETIRED course ${pair.rCode}. `
      + "A retired course must be demoted, never filtered — a student recording a "
      + "course they actually took has to be able to find it.");
    assert.ok(liveAt < retAt,
      `${pair.rCode} (retired) ranked above ${pair.lCode} (live) for "${pair.title}" `
      + `— positions ${retAt} and ${liveAt}. The retired tie-break in BankPanel is not firing.`);
  });

  test("an exact code query still returns the retired course first", async () => {
    // The demotion is below `score`, not above it. Typing a retired course's
    // own code is asking for that course, and burying it there would make the
    // course effectively unreachable — the filter behaviour by another route.
    assert.equal(launchError, null, "chromium unavailable");
    assert.ok(pair, "unrun — see above");

    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForTimeout(3500);

    const m = /^([A-Z]+)(\d.*)$/.exec(pair.rCode);
    await page.fill("input[placeholder*='search']", `${m[1]} ${m[2]}`);
    await page.waitForTimeout(1200);
    const order = await page.$$eval("[data-bank-id]", els =>
      els.map(e => e.getAttribute("data-bank-id")));
    await page.close();
    await ctx.close();

    assert.equal(order[0], pair.rCode,
      `searching the retired course's own code "${m[1]} ${m[2]}" put ${order[0]} first. `
      + "The retired rung must sit below score, not above it.");
  });
});

/** The `title` of the retired badge on a freshly opened plan holding `id`. */
async function page0Title(browser, port, id) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await ctx.addInitScript(seed({ [id]: "fall2025" }));
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load", timeout: 60_000 });
  await page.waitForTimeout(4000);
  const tip = await page.getAttribute("span[title*='catalog']", "title").catch(() => null);
  await page.close();
  await ctx.close();
  return tip ?? "";
}
