// BROWSER · exporting several plans, over and over.
//
// This guards a bug that came back three times, each time looking like a
// different bug, because the failure lives in the BROWSER and not in the
// code. Chrome and Edge gate the second download from a page behind a
// per-site "Automatic downloads" permission: the first file of a burst lands,
// the rest wait on a prompt, and if that prompt is ever dismissed the origin
// is remembered as BLOCKED. From then on a multi-file export yields exactly
// one file, silently, forever.
//
// So the invariant is not "N files arrive" — a headless browser will happily
// accept N downloads and prove nothing. The invariant is:
//
//     exporting several plans must never ISSUE more than one download.
//
// With a directory picker it must issue NONE (files are written straight into
// the folder). Without one it must issue exactly ONE (a zip). Either way the
// permission cannot be reached, so it cannot be blocked. Repetition is the
// point: every previous fix worked once and then stopped.
//
// Skips itself rather than failing when the dev server is not up, matching
// share-code-arrival.browser.test.js.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

// Same env var and default as share-code-arrival.browser.test.js.
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

describe("export · repeated multi-plan export", { skip: up ? false : `no dev server at ${APP}` }, () => {
  let browser, ctx, page;

  const SEED = `(${(() => {
    const P = "ncp";
    const mk = (id, name, parentId, student) => ({
      id, name, studentType: "undergrad", parentId,
      lastOpened: Date.now(), ...(student ? { student } : {}),
    });
    const plans = [
      mk("default", "Loose", null, ""),
      mk("p2", "Current", "f1", "Jane Doe"),
      mk("p3", "Alt", "f1", "Jane Doe"),
      mk("p4", "Four-year", "f1", "Marcus Lee"),
      mk("p5", "Transfer", "f1", "Priya Raman"),
    ];
    localStorage.setItem(`${P}-plan-index`, JSON.stringify(plans));
    localStorage.setItem(`${P}-folder-index`,
      JSON.stringify([{ id: "f1", name: "Advisees", parentId: null }]));
    localStorage.setItem(`${P}-folder-open`, JSON.stringify(["f1"]));
    for (const p of plans) {
      localStorage.setItem(`${P}-plan-data-${p.id}`, JSON.stringify({
        version: 1, placements: {}, specialTermPl: {}, semOrders: {},
      }));
    }
  }).toString()})()`;

  let downloads = [];

  before(async () => {
    const { chromium } = await import("playwright");
    browser = await chromium.launch();
    ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
    page = await ctx.newPage();
    page.on("download", d => downloads.push(d.suggestedFilename()));

    await page.goto(APP, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    // Clear any first-run gate.
    for (let i = 0; i < 4; i++) {
      const b = page.getByRole("button", { name: /agree|accept|continue|got it|start|skip/i }).first();
      if (await b.count() && await b.isVisible().catch(() => false)) {
        await b.click().catch(() => {});
        await page.waitForTimeout(500);
      } else break;
    }
    await page.evaluate(SEED);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    await page.locator("button").filter({ hasText: /Loose|Current|Plan 1/ }).first().click();
    await page.waitForTimeout(500);
    await page.locator("button").filter({ hasText: /Manage/i }).first().click({ force: true });
    await page.waitForTimeout(900);
  });

  after(async () => { await browser?.close(); });

  const exportAll = async () => {
    downloads = [];
    await page.evaluate(() => { window.__wrote = []; });
    await page.keyboard.press("Meta+a");
    await page.waitForTimeout(200);
    await page.locator('[role="dialog"] button').filter({ hasText: /^Export$/ }).last().click();
    await page.waitForTimeout(1500);
    return {
      downloads: downloads.length,
      wrote: await page.evaluate(() => (window.__wrote ?? []).length),
    };
  };

  test("with a folder picker › writes every plan and issues NO downloads", async () => {
    await page.evaluate(() => {
      window.__wrote = [];
      window.showDirectoryPicker = async () => ({
        async getFileHandle(name) {
          return { async createWritable() {
            return { async write() { window.__wrote.push(name); }, async close() {} };
          } };
        },
      });
    });
    for (let round = 1; round <= 4; round++) {
      const r = await exportAll();
      assert.equal(r.wrote, 5, `round ${round}: wrote ${r.wrote} of 5 plans`);
      assert.equal(r.downloads, 0,
        `round ${round}: issued ${r.downloads} download(s) — the folder path must issue none, ` +
        "or it can be blocked by the automatic-downloads permission");
    }
  });

  test("with no picker › issues exactly ONE download every time", async () => {
    await page.evaluate(() => { delete window.showDirectoryPicker; });
    for (let round = 1; round <= 4; round++) {
      const r = await exportAll();
      assert.equal(r.downloads, 1,
        `round ${round}: issued ${r.downloads} downloads — more than one can be throttled`);
    }
  });

  test("a dismissed picker does not wedge the next export", async () => {
    // The "works once, then never" report: only one picker may be open at a
    // time, so a dialog dismissed without resolving used to poison every
    // later export for the rest of the session.
    await page.evaluate(() => {
      window.__wrote = [];
      window.__accept = false;
      window.showDirectoryPicker = async () => {
        if (!window.__accept) { const e = new Error("dismissed"); e.name = "AbortError"; throw e; }
        return { async getFileHandle(name) {
          return { async createWritable() {
            return { async write() { window.__wrote.push(name); }, async close() {} };
          } };
        } };
      };
    });
    const dismissed = await exportAll();
    assert.equal(dismissed.wrote, 0, "a dismissed picker must write nothing");
    assert.equal(dismissed.downloads, 0, "a dismissed picker must not fall back to downloads");

    await page.evaluate(() => { window.__accept = true; });
    const retry = await exportAll();
    assert.equal(retry.wrote, 5, "the export after a dismissal must work");
    assert.equal(retry.downloads, 0, "and must still not reach for downloads");
  });
});
