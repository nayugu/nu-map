// BROWSER · the per-program catalog-edition selector.
//
// Requirements are frozen at the edition a student entered under, and the entry
// term is what the app derives that from. Advisors report the real rule is more
// variable — a student who SWITCHES INTO a major follows the catalog in force
// when they declared it, which no entry term can know. So the edition is a
// CHOICE, per program, and this is the control for it.
//
// Nothing in Node evaluates a React component body, and every defect this file
// has caught was render-time:
//
//   · the predecessor banner offered an edition absent from the cohort's own
//     option list, so taking it emptied the program box over fully-loaded
//     requirements — no error, no page error, no way back;
//   · the same blank box was reachable with no click at all, from a share link
//     or an edited entry term.
//
// The property that prevents both is that the selector is built ONLY from
// editions we hold for that program, so every option can be loaded, displayed
// and re-selected.
//
// Fails rather than skips when a browser is unavailable: a skip is how this
// class of bug travels.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { ensureBuild, serveDist } from "./helpers/serveDist.js";

const CS = (year) =>
  `../../data/northeastern/programs/undergraduate/${year}/computer-information-science/computer_science_bscs_(boston)/requirements.json`;

const NAME = "Computer Science, BSCS (Boston)";

/** A minor held in both editions. 171 of 191 minors changed between them. */
const MINOR_2026 = "../../data/northeastern/programs/undergraduate/2026/science/mathematics_minor/requirements.json";
const MINOR_NAME = "Mathematics, Minor";

/** A second major, held in both editions. */
const MATH_2026 = "../../data/northeastern/programs/undergraduate/2026/science/mathematics_bs_(boston)/requirements.json";
const MATH_NAME = "Mathematics, BS (Boston)";

/**
 * Held in ONE edition only — NEU replaced the Data Science combined majors with
 * Artificial Intelligence ones for 2027. 180 undergraduate programs and all 524
 * graduate programs are in this state, and for them the row must be absent
 * rather than a dropdown with a single option, which would imply a choice.
 */
const ONE_EDITION = "../../data/northeastern/programs/undergraduate/2026/computer-information-science/data_science_bs_(boston)/requirements.json";

/**
 * The two editions differ in ways a student would notice, which is what makes
 * "the audit re-ran" observable at all: 134 SH against 133, and 2026 carries a
 * `Science Requirement` section that 2027 drops (12 sections against 10).
 *
 * Chosen by DIFFING the two files. The first attempt used a section title that
 * looked 2027-only and was present in both, so the assertion passed in every
 * state and proved nothing.
 */
const SH_2026 = "134 SH", SH_2027 = "133 SH";
const SECTION_2026_ONLY = /Science Requirement/;

describe("catalog editions · the per-program year selector", () => {
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

  /** Seeded through addInitScript — the app writes the live plan on unload. */
  const seed = (major, entYear, minor = "", major2 = "") => `(${((mj, ey, mn, m2) => {
    const K = "ncp-";
    localStorage.setItem(K + "plan-index", JSON.stringify([
      { id: "default", name: "T", studentType: "undergrad", parentId: null, lastOpened: Date.now() },
    ]));
    localStorage.setItem(K + "plan-data-default", JSON.stringify({
      version: 1, studentType: "undergrad",
      entSem: "fall", entYear: ey, gradSem: "spring", gradYear: ey + 4,
      currentSemId: "fall" + ey,
      major: mj, major2: m2, minor1: mn, placements: {},
      specialTermPl: {}, semOrders: {}, placedOut: [], substitutions: [],
    }));
    localStorage.setItem(K + "tour-seen", "true");
  }).toString()})(${JSON.stringify(major)},${entYear},${JSON.stringify(minor)},${JSON.stringify(major2)})`;

  async function openPanel(major, entYear, minor = "", major2 = "") {
    assert.equal(launchError, null,
      `chromium unavailable — run \`npx playwright install chromium\`: ${launchError?.message}`);
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await ctx.addInitScript(seed(major, entYear, minor, major2));
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e?.message ?? e)));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForTimeout(2500);
    for (let i = 0; i < 6; i++) {
      const skip = page.getByRole("button", { name: /^Skip$/ }).first();
      if (await skip.count() && await skip.isVisible().catch(() => false)) {
        await skip.click().catch(() => {}); await page.waitForTimeout(250);
      } else break;
    }
    await page.getByRole("button", { name: /^Graduation$/ }).first().click().catch(() => {});
    await page.waitForTimeout(2500);

    // Proof the panel actually OPENED. Without it a click swallowed by a modal
    // leaves an empty board, and every "no row is shown" assertion below passes
    // for the worst possible reason.
    const opened = await page.evaluate(() => document.body.innerText);
    assert.match(opened, /GPA requirements|NUPATH|NUPath/,
      `the graduation panel did not open:\n${opened.slice(0, 600)}`);

    const boxOf = (field) => page.locator(`[data-claude-focus="${field}"] input`).first();
    const selOf = (field) => page.locator(`[data-claude-focus="${field}"] select`).first();

    const read = async () => {
      const text = await page.evaluate(() => document.body.innerText);
      // Every selector on screen, WITH the program it belongs to. Four combos
      // exist (two majors, two minors) and a row rendered under the wrong one
      // is invisible to any count.
      const rows = await page.evaluate(() =>
        [...document.querySelectorAll("[data-claude-focus] select")].map(s => ({
          owner: s.closest("[data-claude-focus]")?.getAttribute("data-claude-focus"),
          year: s.value,
          options: [...s.options].map(o => o.text),
        })));
      return {
        rows,
        rowFor: (f) => rows.find(r => r.owner === f) ?? null,
        box: await boxOf("major").inputValue(),
        minorBox: await boxOf("minor1").inputValue().catch(() => null),
        major2Box: await boxOf("major2").inputValue().catch(() => null),
        hints: text.match(/your cohort: [\d-]+/g) ?? [],
        sh: (text.match(/13[0-9] SH/g) ?? [])[0] ?? null,
        has2026Section: SECTION_2026_ONLY.test(text),
      };
    };
    const saved = (key) => page.evaluate((k) =>
      JSON.parse(localStorage.getItem("ncp-plan-data-default"))[k], key);

    return { ctx, page, read, saved, selOf, errors };
  }

  test("A · on the cohort's edition: a selector, and nothing else", async () => {
    const { ctx, read, errors } = await openPanel(CS(2026), 2025, MINOR_2026);
    const s = await read();
    assert.deepEqual(s.rowFor("major")?.options, ["2025-2026", "2026-2027"],
      "the selector must offer exactly the editions we hold for this program");
    assert.equal(s.rowFor("major")?.year, "2026");
    assert.equal(s.box, NAME, "the program box lost its name");
    // No hint and no reset: this student is on the edition their entry term
    // implies, which is the overwhelmingly common case and must be quiet.
    assert.deepEqual(s.hints, [], `a correctly pinned plan was told about its cohort: ${s.hints}`);
    await ctx.close();
    assert.deepEqual(errors, [], `page errors:\n  ${errors.join("\n  ")}`);
  });

  test("B · a program held in ONE edition gets no row at all", async () => {
    // A single-option dropdown would imply the student had a choice.
    const { ctx, read, errors } = await openPanel(ONE_EDITION, 2025);
    const s = await read();
    assert.equal(s.rowFor("major"), null,
      "a selector appeared for a program with only one edition held");
    assert.deepEqual(s.hints, []);
    await ctx.close();
    assert.deepEqual(errors, [], `page errors:\n  ${errors.join("\n  ")}`);
  });

  test("C · choosing another edition re-audits the degree, and persists", async () => {
    // The feature itself. The degree total is the number a student plans
    // against, so it is what proves the audit re-ran rather than the label
    // merely changing.
    const { ctx, page, read, saved, selOf, errors } = await openPanel(CS(2026), 2025);

    const before = await read();
    assert.equal(before.sh, SH_2026);
    assert.ok(before.has2026Section, "the 2026-only section is missing before the switch");

    await selOf("major").selectOption("2027");
    await page.waitForTimeout(3000);

    const after = await read();
    assert.equal(after.sh, SH_2027, "the degree total did not follow the edition");
    assert.equal(after.has2026Section, false, "a section dropped in 2027 is still on screen");
    assert.equal(after.box, NAME, "changing the edition emptied the program box");
    assert.match(await saved("major"), /\/2027\//, "the choice did not reach the saved plan");
    // Now off-cohort, so the hint and its reset appear — exactly one of them.
    assert.deepEqual(after.hints, ["your cohort: 2025-2026"]);

    // And the reset puts it back, which is the repair path for every plan the
    // predecessor banner pushed forward without asking.
    await page.getByRole("button", { name: /^use$/ }).first().click();
    await page.waitForTimeout(3000);
    const back = await read();
    assert.equal(back.sh, SH_2026, "the reset did not restore the cohort's edition");
    assert.match(await saved("major"), /\/2026\//);
    assert.deepEqual(back.hints, [], "the hint survived being obeyed");

    await ctx.close();
    assert.deepEqual(errors, [], `page errors:\n  ${errors.join("\n  ")}`);
  });

  test("D · a plan already off its cohort is named, and told which edition is its own", async () => {
    // Reachable with no interaction: a share link, or editing the entry term.
    // Before the fix this arrived with an EMPTY box over loaded requirements.
    const { ctx, read, errors } = await openPanel(CS(2027), 2023, MINOR_2026);
    const s = await read();
    assert.equal(s.box, NAME, "the box is blank on arrival");
    assert.equal(s.rowFor("major")?.year, "2027");
    // Cohort 2024, and we hold no 2024 — the closest honest answer is the
    // oldest edition held, never the current one.
    assert.deepEqual(s.hints, ["your cohort: 2025-2026"]);
    await ctx.close();
    assert.deepEqual(errors, [], `page errors:\n  ${errors.join("\n  ")}`);
  });

  test("E · minors get their own selector, independent of the major", async () => {
    // "Switched into" applies to a minor as much as a major, and a minor
    // declared in a different year than the major is exactly the case a single
    // plan-wide catalog year could not express.
    const { ctx, read, errors } = await openPanel(CS(2027), 2026, MINOR_2026);
    const s = await read();
    assert.equal(s.minorBox, MINOR_NAME, "the minor box is blank");
    assert.equal(s.rowFor("minor1")?.year, "2026", "the minor's selector shows the major's edition");
    assert.equal(s.rowFor("major")?.year, "2027", "the major's selector shows the minor's edition");
    // Cohort 2027: the major is on it, the minor is not. Exactly one hint, and
    // it belongs to the minor.
    assert.deepEqual(s.hints, ["your cohort: 2026-2027"]);
    await ctx.close();
    assert.deepEqual(errors, [], `page errors:\n  ${errors.join("\n  ")}`);
  });

  test("F · the second major's selector moves only the second major", async () => {
    const { ctx, page, read, saved, selOf, errors } =
      await openPanel(CS(2027), 2026, "", MATH_2026);
    const before = await read();
    assert.equal(before.major2Box, MATH_NAME, "the second major's box is blank");
    assert.equal(before.rowFor("major2")?.year, "2026");

    await selOf("major2").selectOption("2027");
    await page.waitForTimeout(3000);

    assert.match(await saved("major2"), /\/2027\//, "the second major did not move");
    // Keyed on IDENTITY, not year: major 1 is already on 2027, so a year-only
    // check passes even when a shared handler overwrites it with the second
    // major's 2027 path.
    assert.match(await saved("major"), /2027\/computer-information-science\/computer_science_bscs/,
      "the first major was overwritten when the second's edition changed");
    assert.equal((await read()).major2Box, MATH_NAME, "the second major's box emptied");

    await ctx.close();
    assert.deepEqual(errors, [], `page errors:\n  ${errors.join("\n  ")}`);
  });
});
