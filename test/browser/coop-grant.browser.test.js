// BROWSER · a placed co-op satisfies the requirement its own program names.
//
// Everything under this feature was verified in Node first — the resolver, the
// real allocator, the MCP audit — and all of it would have been true of code
// that never ran. The chain only closes in a browser:
//
//   coop-courses.json is fetched by the catalog adapter
//     → stamped onto courseMap as { abroad, halfTime }
//       → read by coopOptionsInPrograms against the LOADED major
//         → resolved per block by workTermGrants
//           → added to placedSet
//             → allocated by gradRequirements
//               → drawn as a row
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

  const coop = (extra = {}) => ({ c1: { typeId: "coop", semId: "spr2027", duration: 6, ...extra } });

  // THE REGRESSION. Before the resolver this stayed 1/2 for ~99 graduate
  // programs, because the block granted COOP 3945 and MSIS names ENCP 6964.
  test("a graduate co-op satisfies its program's own ENCP option", async () => {
    const before = await panelText({ major: PROGRAMS.msis, graduate: true, placements: { ENCP6000: "fall2025" } });
    const after  = await panelText({ major: PROGRAMS.msis, graduate: true, placements: { ENCP6000: "fall2025" }, workTerms: coop() });

    assert.equal(counterAfter(before, "Optional Co-?op Experience"), "1/2");
    assert.equal(counterAfter(after,  "Optional Co-?op Experience"), "2/2");
    assert.match(before, /One of \(0\/4\)/);
    assert.match(after,  /One of \(1\/4\)/);
  });

  // Work-experience courses left the bank, so the requirements panel is the
  // last place a granted key is visible. Two things must hold there.
  test("a granted row names the work term and is not draggable", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await ctx.addInitScript(seed(PROGRAMS.msis, true, { ENCP6000: "fall2025" },
      { c1: { typeId: "coop", semId: "spr2027", duration: 6, company: "Acme" } }));
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

  // International Business is the one program in 1,017 where the abroad flag
  // changes an answer, and its two experiential sections are both non-shared.
  test("an ordinary co-op satisfies Business Experiential and NOT International", async () => {
    const t = await panelText({ major: PROGRAMS.ib, workTerms: coop() });
    assert.equal(counterAfter(t, "Business Experiential Learning"), "1/1");
    assert.equal(counterAfter(t, "International Experiential Learning"), "0/1");
  });

  test("a co-op marked abroad satisfies International and NOT Business", async () => {
    // One abroad co-op cannot cover both: allocateSections consumes COOP 3948
    // once and neither section is `shared`.
    const t = await panelText({ major: PROGRAMS.ib, workTerms: coop({ abroad: true }) });
    assert.equal(counterAfter(t, "International Experiential Learning"), "1/1");
    assert.equal(counterAfter(t, "Business Experiential Learning"), "0/1");
  });

  // The abroad flag had no way to be set from the UI at all until this.
  test("the unmet International row offers to mark a work term as international", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await ctx.addInitScript(seed(PROGRAMS.ib, false, {}, coop()));
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

    const before = await page.evaluate(() => document.body.innerText);
    assert.equal(counterAfter(before, "International Experiential Learning"), "0/1");

    const btn = page.getByRole("button", { name: /mark a work term as international/i }).first();
    assert.ok(await btn.count(), "no actuator on the unmet International row");
    await btn.click();
    await page.waitForTimeout(1500);

    const after = await page.evaluate(() => document.body.innerText);
    await ctx.close();
    // Clicking it must actually satisfy the requirement, and must consume the
    // co-op — so Business Experiential goes the other way. One abroad co-op
    // cannot cover both non-shared sections.
    assert.equal(counterAfter(after, "International Experiential Learning"), "1/1");
    assert.equal(counterAfter(after, "Business Experiential Learning"), "0/1");
  });

  test("two co-ops, one abroad, satisfy both — the base-variant fallback", async () => {
    const t = await panelText({ major: PROGRAMS.ib, workTerms: {
      a: { typeId: "coop", semId: "spr2027", duration: 6, abroad: true },
      b: { typeId: "coop", semId: "spr2028", duration: 6 },
    } });
    assert.equal(counterAfter(t, "International Experiential Learning"), "1/1");
    assert.equal(counterAfter(t, "Business Experiential Learning"), "1/1");
  });
});
