// BROWSER · Banner's restrictions reach the course card.
//
// ── Why a browser test ─────────────────────────────────────────────
//
// Six links, every one invisible to Node:
//
//   restrictions.json
//     → stampRestrictions in courseNorm.js
//       → applied by the catalog loader (one of three)
//         → read as selCourse.restrictions in InfoPanel
//           → season labelled through claude.sem.* and termYear()
//             → kind named through info.restrictions.name.<Kind>
//               → code glossed through the shipped label map
//
// The fold is unit-tested and the stamp is verified through the Node loader,
// and all of that would be true of a block that renders nothing. `t()` returns
// the KEY when a translation is missing, so a typo'd locale key does not throw
// — it prints `info.restrictions.name.Majors` on screen. Only a browser catches
// that, which is why this file asserts no raw key leaks.
//
// Self-hosts via ensureBuild + serveDist rather than skipping when no dev
// server is up (see boot-smoke.browser.test.js on why a skip is how this class
// of bug travels).

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ensureBuild, serveDist } from "./helpers/serveDist.js";

const CS_BS = "../../data/northeastern/programs/undergraduate/2026/" +
  "computer-information-science/computer_science_bscs_(boston)/requirements.json";

const RESTR = JSON.parse(
  readFileSync(new URL("../../public/northeastern/restrictions.json", import.meta.url), "utf8"));

/** A course that really has restrictions in the shipped asset. */
const SUBJECT = "MEIE4701";

/**
 * The YEARS this course was observed in, per season, read from the asset.
 *
 * Hard-coded years are tests that expire, and these already did once: the
 * assertions named "Summer B 2024", and the 3-academic-year recency window
 * aged that term out the same day it shipped — the data moved to Summer B
 * 2025 and every year-bearing assertion in this file broke at once. The panel
 * prints `season + the years observed`, so the expectation is derivable from
 * the same asset the app reads, which is the only version of it that survives
 * next month's scrape.
 *
 * Mirrors `termYear` in InfoPanel: Banner's YYYY is the year the AY ENDS, so
 * Fall belongs to the previous calendar year.
 */
function expectedYears(season) {
  const years = (RESTR.courses[SUBJECT] ?? [])
    .filter(e => e.season === season)
    .map(e => {
      const y = Number(String(e.term).slice(0, 4));
      return String(e.term).slice(4) === "10" ? y - 1 : y;
    });
  return [...new Set(years)].sort((a, b) => a - b).join(", ");
}

/**
 * Just the Restrictions block's lines, from its heading to its attribution.
 *
 * Scoping is not tidiness. `/^Fall /` matched the OFFERING section further
 * down the same panel and the assertion below read "Sep – Dec" as a
 * restriction value — a test that fails for a reason unrelated to what it
 * checks is worse than no test, because the next person edits the assertion
 * rather than the bug.
 */
function restrictionLines(text) {
  // NBSP → space. The bullet renders as `·` + a NO-BREAK SPACE (U+00A0), not
  // U+0020, so `/^· Industrial/` failed against a line that printed
  // identically and hexdumped as \302\240. Normalising here beats loosening
  // every pattern to `\s`, which would also quietly accept a line break.
  const lines = text.replace(/ /g, " ")
    .split("\n").map(s => s.trim()).filter(Boolean);
  const start = lines.findIndex(l => l === "Restrictions");
  if (start === -1) return [];
  const end = lines.findIndex((l, i) => i > start && /^From Banner/.test(l));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

/**
 * The control, chosen at RUN TIME rather than hard-coded.
 *
 * The first draft named CS 1800 and broke as soon as the capture widened and
 * CS 1800 gained a restriction. The asset grows every time another term is
 * scraped, so any fixed control is a test that expires. Picked here as: a real
 * CS course, 4 SH or more so the board does not file it under the collapsible
 * "other credits" group, and absent from the asset.
 */
function pickControl(restrictions) {
  const catalog = JSON.parse(
    readFileSync(new URL("../../public/northeastern/catalog-courses.json", import.meta.url), "utf8"));
  for (const c of catalog) {
    const id = `${c.subject}${c.number}`;
    if (c.subject !== "CS") continue;
    if ((c.credits ?? 0) < 4) continue;
    if (restrictions.courses[id]) continue;
    return { id, pattern: new RegExp(`${c.subject}\\s*${c.number}`) };
  }
  return null;
}

const seed = (placements) => `(${((pl, major) => {
  const P = "ncp-";
  localStorage.setItem(P + "plan-index", JSON.stringify([
    { id: "default", name: "T", studentType: "undergrad", parentId: null, lastOpened: Date.now() },
  ]));
  localStorage.setItem(P + "plan-data-default", JSON.stringify({
    version: 1, studentType: "undergrad",
    entSem: "fall", entYear: 2025, gradSem: "spring", gradYear: 2029,
    currentSemId: "fall2025",
    major, minor1: null, placements: pl,
    specialTermPl: {}, semOrders: {}, placedOut: [], substitutions: [],
  }));
  localStorage.setItem(P + "tour-seen", "true");
}).toString()})(${JSON.stringify(placements)},${JSON.stringify(CS_BS)})`;

describe("restrictions · the course card", () => {
  let browser, server, port, launchError = null;

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

  async function panelFor(courseId, label) {
    assert.equal(launchError, null,
      `chromium unavailable — run \`npx playwright install chromium\`: ${launchError?.message}`);
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await ctx.addInitScript(seed({ [courseId]: "fall2025" }));
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e?.message ?? e)));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForTimeout(3000);
    for (let i = 0; i < 6; i++) {
      const skip = page.getByRole("button", { name: /^Skip$/ }).first();
      if (await skip.count() && await skip.isVisible().catch(() => false)) {
        await skip.click().catch(() => {}); await page.waitForTimeout(250);
      } else break;
    }
    const card = page.getByText(label).first();
    assert.ok(await card.count(), `${courseId} was not placed on the board`);
    await card.click({ timeout: 10_000 });
    await page.waitForTimeout(1500);
    const text = await page.evaluate(() => document.body.innerText);
    // The YEARS moved out of the visible line and into the row's title, so a
    // test that only reads innerText can no longer tell "provenance relocated"
    // from "provenance deleted" — and deleting it is the failure that matters.
    const titles = await page.evaluate(
      () => [...document.querySelectorAll("[title]")].map(e => e.getAttribute("title")));
    await ctx.close();
    assert.deepEqual(errors, [], `page errors:\n  ${errors.join("\n  ")}`);
    return { text, titles };
  }

  test("a restricted course shows its kinds, values and the term they came from", async () => {
    assert.ok(RESTR.courses[SUBJECT], `${SUBJECT} has no restrictions in the shipped asset`);
    const { text, titles } = await panelFor(SUBJECT, /MEIE\s*4701/);

    assert.match(text, /Restrictions/, "the block did not render");
    // The kind, translated — not the raw Banner noun and not a locale key.
    // `Majors:` rather than `Class standing:`, because the latter also appears
    // in the standing box above and would pass for the wrong reason.
    assert.match(text, /Majors:/);
    // A value, glossed from the shipped label map rather than shown as a code.
    assert.match(text, /Mechanical Engineering/);
    assert.doesNotMatch(text, /\bMECE\b/, "a raw Banner code leaked instead of its label");
    // The season, through the app's own summer wording.
    const sumB = expectedYears("sumB");
    assert.ok(sumB, `${SUBJECT} has no Summer B observation in the asset`);
    assert.match(text, /Summer B/,
      "the season must be named, and summers are 'Summer B' not 'Summer 2'");
    // Every one of this course's rules is on every section, so it reads under
    // the gate heading — which is the sentence that stops five kinds being read
    // as five conditions one student must satisfy at once.
    assert.match(text, /Applies to every section/, "the tier heading did not render");
    // A gate prints no fraction: the heading above already said every section,
    // and repeating it once per season is the noise this replaced.
    assert.doesNotMatch(text, /every section · /);
    // The years are RELOCATED, not dropped — they are the row's title now.
    assert.ok(titles.some(x => x === `Summer B ${sumB}`),
      `no row carries "Summer B ${sumB}" as its provenance; titles: ${titles.join(" | ")}`);
  });

  test("a group's values are listed one per line, under their own term", async () => {
    // The defect this exists for was invisible to all five tests above: the
    // coverage figure used to sit right-aligned on the FIRST line of a
    // five-value group, so it read as belonging to bullet one, and the
    // single-value group beside it rendered with no bullet at all — two
    // indents for the same thing inside one block. Every assertion passed
    // while the panel was unreadable, which is what "tests that confirm are
    // close to worthless" means in practice.
    const { text } = await panelFor(SUBJECT, /MEIE\s*4701/);
    const lines = restrictionLines(text);
    assert.ok(lines.length, "the Restrictions block did not render");

    // Each value owns a line, bulleted — not joined into one run.
    const bulleted = lines.filter(l => l.startsWith("·"));
    assert.ok(bulleted.length >= 2, `expected bulleted values, got:\n  ${lines.join("\n  ")}`);
    assert.ok(bulleted.some(l => /Mechanical Engineering\/Design$/.test(l)),
      "a value should end its own line rather than run into the next");
    // The joined form must be gone: two majors separated by the middot on ONE
    // line is exactly the blob this replaced.
    assert.ok(!lines.some(l => /Mechanical Engineering · Mechanical/.test(l)),
      "values are still being joined into a single run");

    // UNIFORM depth: the single-value Fall group is bulleted too, so it cannot
    // sit at a shallower indent than the five-value Summer B group.
    assert.ok(bulleted.some(l => /Industrial Engineering$/.test(l)),
      "the single-value group must be bulleted like every other group");

    // ASSOCIATION, in Banner's order: sentence → values → the terms those
    // values were seen in. A value's terms are the next non-bullet lines
    // BELOW it, so Mechanical Engineering must be followed by Summer terms
    // and never by a Fall one.
    //
    // Asserted without assuming the order of the groups. Two earlier versions
    // baked in an order — first "Summer B before Fall", then "the term heads
    // the group" — and both were true only of the layout at the time: groups
    // sort by total sections, so capturing a second Fall reordered them, and
    // then the terms moved below the values entirely. Adjacency is the
    // property; absolute position is a rendering detail.
    // Only the SEASON lines. The run below a value now also holds the next
    // kind's sentence and, on a course with both tiers, a tier heading — none
    // of which is a term, and all of which would fail the `every(/Summer/)`
    // check below for a reason that has nothing to do with attribution.
    const termsAfter = (i) => {
      const out = [];
      for (let j = i + 1; j < lines.length && !lines[j].startsWith("·"); j++) {
        if (/^(Fall|Spring|Summer)\b/.test(lines[j])) out.push(lines[j]);
      }
      return out;
    };
    const iMech = lines.findIndex(l => /Mechanical Engineering\/Physics/.test(l));
    assert.ok(iMech > 0, "the Mechanical group did not render");
    const mechTerms = termsAfter(iMech);
    assert.ok(mechTerms.length, "the Mechanical group named no term at all");
    assert.ok(mechTerms.every(l => /Summer/.test(l)),
      `a Mechanical-only group must name only Summer terms, got: ${mechTerms.join(" | ")}`);

    // And somewhere there is an Industrial Engineering value whose terms are
    // the Falls — the advisor's actual case.
    const fallGroup = lines.some((l, i) =>
      // `/^Fall /` with the trailing space, until the years moved into the
      // row's title and the line became bare "Fall".
      /^· Industrial Engineering$/.test(l) && termsAfter(i).some(x => /^Fall\b/.test(x)));
    assert.ok(fallGroup, "no Industrial Engineering group is attributed to Fall");
  });

  test("a restriction that differs BY SEASON shows both readings", async () => {
    // The whole reason the fold keeps every term. MEIE 4701 is Industrial-only
    // in Fall and Mechanical-only in Summer B; a newest-term-only view would
    // show one and silently drop the other, which is the reading an IE student
    // needs. Skips rather than fails while the per-CRN backfill is incomplete —
    // Fall is 6,805 individual requests and may not be captured yet.
    const seasons = new Set((RESTR.courses[SUBJECT] ?? []).map(e => e.season));
    if (seasons.size < 2) {
      console.log(`      (skipped: ${SUBJECT} captured in ${[...seasons]} only — backfill pending)`);
      return;
    }
    const { text, titles } = await panelFor(SUBJECT, /MEIE\s*4701/);
    assert.match(text, /Industrial Engineering/,  "the Fall reading is missing");
    assert.match(text, /Mechanical Engineering/,  "the Summer B reading is missing");
    // Both seasons are named on screen — the season is the actionable half and
    // stays visible; the years are provenance and are asserted on the title,
    // so "we hid the years" and "we hid the season" cannot pass for each other.
    const lines = restrictionLines(text);
    assert.ok(lines.some(l => /^Fall$/.test(l)),     `no bare Fall line: ${lines.join(" | ")}`);
    assert.ok(lines.some(l => /^Summer B$/.test(l)), `no bare Summer B line: ${lines.join(" | ")}`);
    assert.ok(titles.includes(`Fall ${expectedYears("fall")}`));
    assert.ok(titles.includes(`Summer B ${expectedYears("sumB")}`));
  });

  test("the Classes row is not duplicated under the standing box", async () => {
    // The standing box directly above says "Junior standing or above". Printing
    // `Class standing: Junior · Senior` beneath it is the same fact twice in
    // adjacent boxes — suppressed when it adds nothing, kept when standing
    // varies by section or season.
    const { text } = await panelFor(SUBJECT, /MEIE\s*4701/);
    assert.match(text, /Class standing: Junior standing or above/, "the standing box should show");
    // Asserted on the KIND HEADING inside the block, not on the joined values.
    // `Junior · Senior` was the old check and it went vacuous the moment values
    // became bulleted — the panel would now print "· Junior" / "· Senior" on
    // separate lines, so the pattern could never match whether the row was
    // suppressed or not. A negative assertion has to track the positive form.
    assert.ok(!restrictionLines(text).some(l => /following Classes:/.test(l)),
      "the uniform Classes restriction should not repeat the standing box");
    assert.doesNotMatch(text, /Junior · Senior/,
      "the uniform Classes restriction should not repeat the standing box");
  });

  test("no locale key leaks to the screen", async () => {
    // `t()` falls back to the KEY, so a missing or typo'd key renders as
    // `info.restrictions.name.Majors` rather than throwing. This is the only
    // check that catches it.
    const { text } = await panelFor(SUBJECT, /MEIE\s*4701/);
    assert.doesNotMatch(text, /info\.restrictions/, "an untranslated key reached the UI");
    assert.doesNotMatch(text, /claude\.sem\./, "an untranslated season key reached the UI");
    assert.doesNotMatch(text, /\{(kind|n|total)\}/, "an uninterpolated placeholder reached the UI");
  });

  test("a course with no restriction data shows no block", async () => {
    // The control that makes the test above mean something: a course placed the
    // same way, on the same board, that simply is not in the asset.
    const control = pickControl(RESTR);
    assert.ok(control, "no unrestricted 4+ SH CS course left — pick a different subject");
    const { text } = await panelFor(control.id, control.pattern);
    // Anchored on labels unique to this block: "Restrictions" alone is too
    // common a word elsewhere on the page to prove absence.
    assert.doesNotMatch(text, /Class standing:/);
    // Anchored on a string the POSITIVE case is asserted to contain, and
    // re-anchored whenever that string moves. This assertion has now been
    // wrong twice for the same reason: it read `/every section ·/` while the
    // figure came first, then `/· every section/` after the term moved in
    // front of it, and each time it stopped matching anything at all and the
    // control passed for free. A negative assertion that no longer describes
    // the positive case is not a check.
    assert.doesNotMatch(text, /Applies to every section/);
    assert.doesNotMatch(text, /Applies to some sections only/);
  });
});
