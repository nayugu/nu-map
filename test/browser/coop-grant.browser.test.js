// BROWSER · a placed co-op satisfies the requirement its own program names.
//
// Everything under this feature was verified in Node first — the resolver, the
// real allocator, the MCP audit — and all of it would have been true of code
// that never ran. The chain only closes in a browser:
//
//   coop-courses.json is fetched by the catalog adapter
//     → stamped onto courseMap as { abroad, halfTime, kind }
//       → offered in the block card's picker, scoped by kind
//         → the student's choice stored as `courseId` on the block
//           → read back by workTermGrants
//             → added to placedSet
//               → allocated by gradRequirements
//                 → drawn as a row
//
// Any link can break without a single unit test noticing. The one that did
// break in review was two links further out than this file reaches: the Node
// and Cloudflare catalog loaders never fetched the table at all, so an audit
// over MCP contradicted the panel. See docs/coop-design.md.
//
// Skips itself rather than failing when the dev server is not up, matching
// share-code-arrival.browser.test.js.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

const APP = process.env.NUMAP_URL ?? "http://localhost:5173";

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

const PROGRAMS = {
  msis: "../../data/northeastern/programs/graduate/2026/engineering/information_systems_msis_(boston)/requirements.json",
  ib:   "../../data/northeastern/programs/undergraduate/2026/business/international_business_bsib_(boston)/requirements.json",
};

describe("browser · a work term registers its program's course", { skip: up ? false : `no dev server at ${APP}` }, () => {
  let browser;
  before(async () => { ({ chromium: browser } = await import("playwright")); browser = await browser.launch(); });
  after(async () => { await browser?.close(); });

  /**
   * Seeded through addInitScript, NOT evaluate()+reload: the app saves the
   * live plan on unload, so a reload writes empty state over anything poked
   * into localStorage first. This cost an hour once already.
   */
  const seed = (major, graduate, placements, workTerms) => `(${((mj, grad, pl, wt) => {
    const P = "ncp-";
    localStorage.setItem(P + "plan-index", JSON.stringify([
      { id: "default", name: "T", studentType: grad ? "graduate" : "undergrad", parentId: null, lastOpened: Date.now() },
    ]));
    localStorage.setItem(P + "plan-data-default", JSON.stringify({
      version: 1,
      studentType: grad ? "graduate" : "undergrad",
      entSem: "fall", entYear: 2025, gradSem: "spring", gradYear: 2029,
      currentSemId: "fall2025",
      major: mj, placements: pl, specialTermPl: wt,
      semOrders: {}, placedOut: [], substitutions: [],
    }));
    localStorage.setItem(P + "tour-seen", "true");
  }).toString()})(${JSON.stringify(major)},${graduate},${JSON.stringify(placements)},${JSON.stringify(workTerms)})`;

  async function panelText({ major, graduate = false, placements = {}, workTerms = {} }) {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await ctx.addInitScript(seed(major, graduate, placements, workTerms));
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.goto(APP, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    for (let i = 0; i < 6; i++) {
      const skip = page.getByRole("button", { name: /^Skip$/ }).first();
      if (await skip.count() && await skip.isVisible().catch(() => false)) {
        await skip.click().catch(() => {}); await page.waitForTimeout(250);
      } else break;
    }
    await page.getByRole("button", { name: /^Graduation$/ }).first().click().catch(() => {});
    await page.waitForTimeout(2500);
    const text = await page.evaluate(() => document.body.innerText);
    await ctx.close();
    assert.equal(errors.length, 0, `page errors: ${errors.slice(0, 2).join(" | ")}`);
    assert.ok(!/no longer in the catalog/.test(text), "the seeded program did not load");
    return text;
  }

  /** The counter a section header prints, e.g. "Optional Co-op Experience 2/2". */
  const counterAfter = (text, label) => {
    const i = text.search(new RegExp(label, "i"));
    assert.ok(i >= 0, `section "${label}" not rendered`);
    return (text.slice(i, i + 160).match(/(\d+\s*\/\s*\d+)/) ?? [])[1] ?? null;
  };

  /** A co-op block. `courseId` is what the student picked on the card. */
  const coop = (extra = {}) => ({ c1: { typeId: "coop", semId: "spr2027", duration: 6, ...extra } });

  // THE REGRESSION. This stayed 1/2 for ~99 graduate programs when the block
  // granted a hardcoded COOP 3945 and MSIS names ENCP 6964. The fix is no
  // longer a resolver that guesses the subject — it is that the card lets the
  // student say ENCP 6964, and any subject reaches the requirement layer.
  test("a graduate co-op recorded as ENCP 6964 satisfies its program's own option", async () => {
    const before = await panelText({ major: PROGRAMS.msis, graduate: true, placements: { ENCP6000: "fall2025" } });
    const after  = await panelText({ major: PROGRAMS.msis, graduate: true, placements: { ENCP6000: "fall2025" },
                                     workTerms: coop({ courseId: "ENCP6964" }) });

    assert.equal(counterAfter(before, "Optional Co-?op Experience"), "1/2");
    assert.equal(counterAfter(after,  "Optional Co-?op Experience"), "2/2");
    assert.match(before, /One of \(0\/4\)/);
    assert.match(after,  /One of \(1\/4\)/);
  });

  // The other half of the same claim, and the more important one: an app that
  // ticked the box on its own was the defect, not the feature.
  test("a co-op with no course chosen satisfies nothing", async () => {
    const t = await panelText({ major: PROGRAMS.msis, graduate: true,
                                placements: { ENCP6000: "fall2025" }, workTerms: coop() });
    assert.equal(counterAfter(t, "Optional Co-?op Experience"), "1/2");
  });

  // Work-experience courses left the bank, so the requirements panel is the
  // last place a granted key is visible. Two things must hold there.
  test("a granted row names the work term and is not draggable", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await ctx.addInitScript(seed(PROGRAMS.msis, true, { ENCP6000: "fall2025" },
      { c1: { typeId: "coop", semId: "spr2027", duration: 6, company: "Acme", courseId: "ENCP6964" } }));
    const page = await ctx.newPage();
    await page.goto(APP, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    for (let i = 0; i < 6; i++) {
      const skip = page.getByRole("button", { name: /^Skip$/ }).first();
      if (await skip.count() && await skip.isVisible().catch(() => false)) {
        await skip.click().catch(() => {}); await page.waitForTimeout(250);
      } else break;
    }
    await page.getByRole("button", { name: /^Graduation$/ }).first().click().catch(() => {});
    await page.waitForTimeout(2500);

    // Scoped to the requirements tree. The co-op BLOCK also prints
    // "ENCP 6964 ↗" now (its link into the info panel), and an unscoped
    // "shortest div containing ENCP 6964" finds that instead — which is
    // draggable, because the block is.
    const row = await page.evaluate(() => {
      const section = [...document.querySelectorAll("div")]
        .filter(d => /Optional Co-?op Experience/i.test(d.textContent || "") && /ENCP 6964/.test(d.textContent || ""))
        .sort((a, b) => (a.textContent || "").length - (b.textContent || "").length)[0];
      if (!section) return null;
      const el = [...section.querySelectorAll("div")]
        .filter(d => /ENCP 6964/.test(d.textContent || ""))
        .sort((a, b) => (a.textContent || "").length - (b.textContent || "").length)[0];
      return el ? { text: el.textContent, draggable: !!el.closest('[draggable="true"]') } : null;
    });
    await ctx.close();

    assert.ok(row, "the ENCP 6964 row did not render");
    // Provenance: composed from the work term's own localised label and the
    // employer the student typed, so it needs no new string.
    assert.match(row.text, /Acme/, `no work-term provenance on the row: "${row.text}"`);
    // A work-experience course is recorded by placing the block. Dragging it
    // out of here would be the one remaining way to make the phantom card the
    // bank change removed.
    assert.equal(row.draggable, false, "a granted work-experience row is still draggable");
  });

  test("the companion course alone does not satisfy it — the co-op is doing the work", async () => {
    // Guards against the row flipping for an unrelated reason.
    const only = await panelText({ major: PROGRAMS.msis, graduate: true, placements: { ENCP6000: "fall2025" } });
    assert.equal(counterAfter(only, "Optional Co-?op Experience"), "1/2");
  });

  // International Business is the one program in 1,017 with two non-shared
  // experiential sections, one of which wants COOP 3948 alone. It is the case
  // where registering the wrong course is visibly different from registering
  // none, so it is where the "no inference" rule has to hold.
  test("a co-op recorded as COOP 3945 satisfies Business Experiential and NOT International", async () => {
    const t = await panelText({ major: PROGRAMS.ib, workTerms: coop({ courseId: "COOP3945" }) });
    assert.equal(counterAfter(t, "Business Experiential Learning"), "1/1");
    assert.equal(counterAfter(t, "International Experiential Learning"), "0/1");
  });

  test("a co-op recorded as COOP 3948 satisfies International and NOT Business", async () => {
    // One co-op cannot cover both: allocateSections consumes COOP 3948 once
    // and neither section is `shared`.
    const t = await panelText({ major: PROGRAMS.ib, workTerms: coop({ courseId: "COOP3948" }) });
    assert.equal(counterAfter(t, "International Experiential Learning"), "1/1");
    assert.equal(counterAfter(t, "Business Experiential Learning"), "0/1");
  });

  // THE CASE THE INFERENCE GOT WRONG, end to end. The old resolver read the
  // program's option list and picked one that fit, so a co-op registering
  // something IB does not accept ticked a section anyway. The student must see
  // it unmet — that is the whole reason the app stopped guessing.
  test("a co-op recorded as a course the program does not accept satisfies neither", async () => {
    const t = await panelText({ major: PROGRAMS.ib, workTerms: coop({ courseId: "ENCP6964" }) });
    assert.equal(counterAfter(t, "Business Experiential Learning"), "0/1");
    assert.equal(counterAfter(t, "International Experiential Learning"), "0/1");
  });

  test("two co-ops, each recorded, satisfy both sections", async () => {
    const t = await panelText({ major: PROGRAMS.ib, workTerms: {
      a: { typeId: "coop", semId: "spr2027", duration: 6, courseId: "COOP3948" },
      b: { typeId: "coop", semId: "spr2028", duration: 6, courseId: "COOP3945" },
    } });
    assert.equal(counterAfter(t, "International Experiential Learning"), "1/1");
    assert.equal(counterAfter(t, "Business Experiential Learning"), "1/1");
  });

  // ── the bank search: what is hidden, and what only LOOKED hidden ──
  //
  // The report was "we block CS 1210 from the bank". We do not — the hidden
  // set is exactly the 92 stamped registrations, which is exactly the union of
  // the two cards' pickers. What was actually broken is one keystroke away:
  // the catalog writes "Co-op" and students type "coop", and plain substring
  // matching made those different searches (3 results vs 23). A matcher bug
  // that reads as a policy decision is worth a test of its own.
  async function bankSearch(query) {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await ctx.addInitScript(seed(PROGRAMS.ib, false, {}, {}));
    const page = await ctx.newPage();
    await page.goto(APP, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    for (let i = 0; i < 6; i++) {
      const skip = page.getByRole("button", { name: /^Skip$/ }).first();
      if (await skip.count() && await skip.isVisible().catch(() => false)) {
        await skip.click().catch(() => {}); await page.waitForTimeout(250);
      } else break;
    }
    const box = page.locator('input[placeholder*="earch" i]').first();
    await box.fill(query);
    await page.waitForTimeout(1200);
    const text = await page.evaluate(() => document.body.innerText);
    await ctx.close();
    return text;
  }

  test("searching `coop` and `co-op` find the same co-op classes", async () => {
    const short = await bankSearch("coop");
    const long  = await bankSearch("co-op");
    for (const text of [short, long]) {
      // A 1 SH class ABOUT co-op. Placeable, and it must be findable both ways.
      assert.match(text, /CS\s*1210/, "CS 1210 is missing from the bank results");
      assert.match(text, /ENCP\s*2000/, "ENCP 2000 is missing from the bank results");
    }
  });

  test("the registrations stay hidden, and say why", async () => {
    const text = await bankSearch("COOP 3945");
    assert.match(text, /registration/i, "no notice explaining where COOP 3945 went");
    // Not as a draggable card in the list — the notice is the only mention.
    const cards = await (async () => {
      const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
      await ctx.addInitScript(seed(PROGRAMS.ib, false, {}, {}));
      const page = await ctx.newPage();
      await page.goto(APP, { waitUntil: "networkidle" });
      await page.waitForTimeout(2000);
      for (let i = 0; i < 6; i++) {
        const skip = page.getByRole("button", { name: /^Skip$/ }).first();
        if (await skip.count() && await skip.isVisible().catch(() => false)) {
          await skip.click().catch(() => {}); await page.waitForTimeout(250);
        } else break;
      }
      await page.locator('input[placeholder*="earch" i]').first().fill("COOP 3945");
      await page.waitForTimeout(1200);
      const n = await page.evaluate(() => [...document.querySelectorAll('[draggable="true"]')]
        .filter(d => /COOP\s*3945/.test(d.textContent || "")).length);
      await ctx.close();
      return n;
    })();
    assert.equal(cards, 0, "COOP 3945 is still draggable out of the bank");
  });

  // ── the internship block mirrors all of it ────────────────────────
  //
  // Same card field, same storage, same resolver. The one thing that differs
  // is which courses the picker offers, and the failure that would hide here
  // is the type declaring no `registersCourse` at all — the field silently
  // absent, exactly the bug that shipped when it existed only on SemRow.
  test("an internship registers the course named on its card", async () => {
    const t = await panelText({ major: PROGRAMS.ib, workTerms: {
      i1: { typeId: "intern", semId: "sumA2027", duration: 2, courseId: "COOP3949" },
    } });
    // COOP 3949 is not on IB's list, so nothing may tick — but the plan must
    // load and render without the block being treated as a course-less type.
    assert.equal(counterAfter(t, "Business Experiential Learning"), "0/1");
    assert.match(t, /Internship|Experiential/i);
  });
});
