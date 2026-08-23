// BROWSER · the maintenance screens RENDER.
//
// Nothing in Node evaluates a React component body, so the whole maintenance
// feature could ship with a green suite and throw on first paint — which is
// exactly the outage `boot-smoke` exists for. Worse, these components render
// `null` in the state every other test runs in: with nothing scheduled there is
// no strip and no page, so `boot-smoke` passing says nothing at all about them.
//
// The `?maint=` preview hatch (localhost/dev only, same gate as
// `?preview=recovery`) is what makes this testable without faking a clock or
// writing to public/maintenance.json.
//
// Like boot-smoke and unlike the older files here, this FAILS rather than skips
// when a browser is unavailable: a skip is how this class of bug travels.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureBuild, serveDist } from "./helpers/serveDist.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DIST = join(ROOT, "dist");
/** What "nothing scheduled" looks like on the wire. */
const EMPTY_SCHEDULE = JSON.stringify({ windows: [] }, null, 2);

describe("maintenance screens", () => {
  let browser, server, port, launchError = null;

  before(async () => {
    await ensureBuild();
    // Serve an EMPTY schedule, written explicitly rather than copied from
    // `public/`. These tests assert behaviour, not whatever is scheduled on the
    // machine they run on — and copying the real file made them fail the moment
    // a developer used the dev portal, which is not a regression in anything.
    await writeFile(join(DIST, "maintenance.json"), EMPTY_SCHEDULE);
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

  /** Load a URL, collect every error, return the visible text. */
  const visit = async (path, { wait = 3500 } = {}) => {
    assert.equal(launchError, null,
      `chromium unavailable — run \`npx playwright install chromium\`: ${launchError?.message}`);
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e?.message ?? e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
    await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForTimeout(wait);
    const text = await page.evaluate(() => document.body?.innerText ?? "");
    const html = await page.content();
    await page.close();
    assert.deepEqual(errors, [], `${path} logged errors:\n  ${errors.join("\n  ")}`);
    return { text, html };
  };

  // ── The header strip ──────────────────────────────────────────────

  test("a scheduled window puts a strip in the header", async () => {
    const { text } = await visit("/?maint=scheduled");
    assert.match(text, /Maintenance/i);
    // The countdown AND the absolute window — a countdown alone is not a
    // schedule, and the timezone is what stops the absolute time being a lie.
    assert.match(text, /in \d+ (hours?|minutes?)/i, `no countdown in:\n${text.slice(0, 400)}`);
    assert.match(text, /shipping an update/i, "the reason should be stated");
    assert.match(text, /saved in this browser/i, "the reassurance is the point of the strip");
    // The app is still there underneath — this is a strip, not a takeover.
    assert.match(text, /COURSE BANK/i);
  });

  test("an imminent window escalates and offers the backup", async () => {
    const { text } = await visit("/?maint=imminent");
    assert.match(text, /Maintenance starts/i);
    assert.match(text, /Save my plans/i, "the backup button must be reachable");
    assert.match(text, /changes how plans are stored/i);
  });

  test("a degraded window names the affected features", async () => {
    const { text } = await visit("/?maint=degraded");
    assert.match(text, /Claude connection/i);
    assert.match(text, /Share codes/i);
    assert.match(text, /Everything else keeps working/i);
    assert.match(text, /COURSE BANK/i, "degraded must not take the app away");
  });

  test("a finished window says so, with a way to reload", async () => {
    const { text } = await visit("/?maint=restored");
    assert.match(text, /Maintenance finished/i);
    assert.match(text, /Reload/i);
  });

  // ── The full-screen page ──────────────────────────────────────────

  test("an offline window shows the page, with a way through", async () => {
    const { text } = await visit("/?maint=offline");
    assert.match(text, /under maintenance/i);
    assert.match(text, /Back in \d+ (hours?|minutes?)/i, `no ETA in:\n${text.slice(0, 400)}`);
    // The property this whole design turns on: plans are local, so a window we
    // chose to take must never be a wall.
    assert.match(text, /Keep using my plan/i);
    assert.match(text, /Save my plans/i);
    assert.match(text, /saved in this browser/i);
  });

  test("past the forecast it stops counting down", async () => {
    // The state the real world reaches most often on an unplanned outage, and
    // the one where a stale countdown would make a live page look abandoned.
    const { text } = await visit("/?maint=overrun");
    assert.match(text, /Taking longer than expected/i);
    assert.doesNotMatch(text, /Back in \d+/i, "must not still be counting down");
    // Still down, and still lets a person through.
    assert.match(text, /Keep using my plan/i);
  });

  test("the offline page replaces the app rather than sitting under it", async () => {
    // Both render — the overlay is a sibling of the app so the backup button can
    // reach the library — so the check is that the strip yields to the page and
    // does not double up on the same message.
    const { text } = await visit("/?maint=offline");
    assert.doesNotMatch(text, /Maintenance in progress/i,
      "the header strip should stand down while the full page is showing");
  });

  // ── The static page, which must work with nothing else running ────

  test("the static maintenance page renders on its own", async () => {
    const { text, html } = await visit("/maintenance.html", { wait: 1500 });
    assert.match(text, /under maintenance/i);
    assert.match(text, /NU MAP/i, "the wordmark carries the brand — it is CSS-uppercased");
    assert.match(text, /Continue anyway/i);
    // Self-contained: no stylesheet, no webfont, no raster image. Anything it
    // fetched from us could fail together with what it is apologising for.
    assert.doesNotMatch(html, /<link[^>]+stylesheet/i, "must not load a stylesheet");
    assert.doesNotMatch(html, /<img\s/i, "must not load an image");
    assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic|\.woff/i, "must not load a font");
    assert.match(html, /name="robots"[^>]*noindex/i, "must be noindex for the 200 fallback path");
  });

  // ── The dev portal panel ──────────────────────────────────────────

  test("the dev portal's Maintenance panel runs the real resolver", async () => {
    assert.equal(launchError, null, `chromium unavailable: ${launchError?.message}`);
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e?.message ?? e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

    await page.goto(`http://127.0.0.1:${port}/northeastern/dev.html`, { waitUntil: "load", timeout: 60_000 });
    await page.getByRole("button", { name: /Maintenance/ }).click();
    await page.waitForTimeout(1200);

    // The queue reads the real schedule, which ships empty.
    assert.match(await page.locator("#maint-queue").innerText(), /Nothing queued/i);

    // The pickers open PREFILLED — an empty "mm/dd/yyyy, --:-- --" was the
    // thing that made the old single control read as broken.
    assert.match(await page.inputValue("#maint-date"), /^\d{4}-\d{2}-\d{2}$/);
    assert.match(await page.inputValue("#maint-time"), /^\d{2}:\d{2}$/);

    // A shortcut WRITES into the fields rather than holding state of its own.
    await page.getByRole("button", { name: "Tonight 2am" }).click();
    await page.waitForTimeout(400);
    assert.equal(await page.inputValue("#maint-time"), "02:00", "the shortcut should fill the time field");

    // Composing a window drives the stage chain.
    await page.fill("#maint-name", "Fix the prereq crash");
    await page.fill("#maint-date", "2026-08-30");
    await page.fill("#maint-time", "22:00");
    await page.waitForTimeout(500);

    assert.match(await page.locator("#maint-chain-for").innerText(), /Fix the prereq crash/);

    // Four stages, each carrying the instant it begins — DERIVED from the
    // window by the shared resolver, not a static list.
    const stages = await page.locator("#maint-chain .stage").count();
    assert.equal(stages, 4, "expected four stages in the chain");
    const chain = await page.locator("#maint-chain").innerText();
    for (const label of ["Announced", "10 minutes to go", "Off", "Back on"]) {
      assert.ok(chain.includes(label), `no "${label}" in:\n${chain}`);
    }
    assert.match(chain, /Aug 28/, "the announce stage should be 48 h before the start");
    assert.match(chain, /Aug 30/, "the off stage should be the start");

    // HOVERING a circle answers "what does a visitor see at this stage" — no
    // click needed, and it swaps the single iframe rather than opening a tab.
    await page.locator("#maint-chain .stage").first().hover();
    await page.waitForTimeout(600);
    assert.match(await page.locator("#maint-stage-detail").innerText(), /notice in the app header/i);
    assert.match(
      await page.evaluate(() => document.getElementById("maint-shot-frame")?.src ?? ""),
      /\?maint=scheduled$/,
      "the preview iframe should follow the hovered stage",
    );

    // Typing must not reload the preview. It used to live inside the element
    // that gets rewritten on every keystroke, so the app booted once per
    // character and the frame strobed.
    let reloads = 0;
    const countReload = f => { if (f !== page.mainFrame() && /maint=/.test(f.url())) reloads++; };
    page.on("framenavigated", countReload);
    await page.waitForTimeout(800);
    const before = reloads;
    await page.locator("#maint-name").type("abcdefghij", { delay: 30 });
    await page.waitForTimeout(800);
    page.off("framenavigated", countReload);
    assert.equal(reloads - before, 0, "the preview reloaded while typing");
    await page.fill("#maint-name", "Fix the prereq crash");   // `type` appended
    await page.waitForTimeout(300);

    // The small iframe is scaled to the width it actually got, not a constant.
    const scale = Number(await page.evaluate(
      () => document.getElementById("maint-shot")?.style.getPropertyValue("--shot-scale")));
    assert.ok(scale > 0.05 && scale < 1, `implausible preview scale: ${scale}`);

    // CLICKING opens the near-full-page look, at real size — the small frame
    // can say "right screen?" but not "right copy?".
    await page.locator("#maint-chain .stage").nth(2).click();
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => document.getElementById("maint-big").style.display), "flex");
    assert.equal(await page.locator("#maint-big-title").innerText(), "Off");
    assert.match(
      await page.evaluate(() => document.getElementById("maint-big-frame").src),
      /\?maint=offline$/,
    );
    // The Off stage owns the overrun boundary.
    const off = await page.locator("#maint-stage-detail").innerText();
    assert.match(off, /503/);
    assert.match(off, /Continue anyway/i);
    assert.match(off, /taking longer than expected/i);

    // Escape closes it, and the iframe is unloaded — a hidden-but-live app
    // would keep its timers and its 60 s maintenance poll running all session.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.getElementById("maint-big").style.display), "none");
    assert.match(await page.evaluate(() => document.getElementById("maint-big-frame").src), /about:blank/);

    // The payoff of sharing the resolver: a deadline past the safety cap is
    // caught by the SAME code the app runs, so the panel cannot promise
    // something the browser would demote.
    await page.fill("#maint-deadline", "10d");
    await page.waitForTimeout(400);
    assert.match(await page.locator("#maint-plan-warn").innerText(), /72h cap|demoted/i);

    // And the hand-run fallback reflects the form, name included.
    await page.fill("#maint-deadline", "2d");
    await page.fill("#maint-expect", "3h");
    await page.waitForTimeout(400);
    const cmd = await page.evaluate(() => document.getElementById("maint-cmd").textContent);
    assert.match(cmd, /outage .*--expect 3h --for 2d --name "Fix the prereq crash" --write/);

    await page.close();
    assert.deepEqual(errors, [], `the portal logged errors:\n  ${errors.join("\n  ")}`);
  });

  test("the queue's three row states offer three different actions", async () => {
    // The distinction is the whole point: a RUNNING window must be stopped (which
    // is what leaves the "we're back" notice), a queued one can just be
    // cancelled, and a finished one stays as the record with nothing to press.
    assert.equal(launchError, null, `chromium unavailable: ${launchError?.message}`);
    const now = Date.now();
    const seed = {
      windows: [
        { id: "hist", name: "Prereq crash hotfix", severity: "offline", kind: "infra",
          start: new Date(now - 60 * 3600e3).toISOString(), end: new Date(now - 57 * 3600e3).toISOString() },
        { id: "live", name: "Storage migration", severity: "offline", kind: "migration",
          start: new Date(now - 3 * 3600e3).toISOString(), end: new Date(now + 45 * 3600e3).toISOString(),
          expectedEnd: new Date(now + 3 * 3600e3).toISOString() },
        { id: "soon", name: "Catalog reindex", severity: "offline", kind: "data",
          start: new Date(now + 96 * 3600e3).toISOString(), end: new Date(now + 100 * 3600e3).toISOString() },
      ],
    };
    await writeFile(join(DIST, "maintenance.json"), JSON.stringify(seed, null, 2));
    try {
      const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e?.message ?? e)));
      await page.goto(`http://127.0.0.1:${port}/northeastern/dev.html`, { waitUntil: "load", timeout: 60_000 });
      await page.getByRole("button", { name: /Maintenance/ }).click();
      await page.waitForTimeout(1400);

      assert.equal(await page.locator(".maint-q").count(), 3, "a finished window must STAY in the queue");
      assert.match(await page.locator(".maint-q.live .nm").innerText(), /Storage migration[\s\S]*RUNNING/);
      assert.match(await page.locator(".maint-q.over .nm").innerText(), /Prereq crash hotfix[\s\S]*COMPLETED/);

      // Actions, per state.
      assert.equal(await page.locator(".maint-q.live .maint-act.stop").count(), 1, "running → Stop");
      assert.equal(await page.locator(".maint-q.live .maint-x").count(), 0, "running must NOT offer cancel");
      assert.equal(await page.locator(".maint-q:not(.live):not(.over) .maint-x").count(), 1, "queued → cancel");
      assert.equal(await page.locator(".maint-q.over .maint-x").count(), 0, "finished → nothing to press");

      // Faded as a whole, and the start time is plain readable text, not a field.
      const op = Number(await page.locator(".maint-q.over").evaluate(e => getComputedStyle(e).opacity));
      assert.ok(op > 0.2 && op < 0.7, `completed row should be faded, got ${op}`);
      assert.equal(await page.locator(".maint-q.live .when input").count(), 0, "the start time is never editable");
      assert.match(await page.locator(".maint-q.live .when").innerText(), /\w{3},\s\w{3}\s\d+/);

      await page.close();
      assert.deepEqual(errors, [], `the portal logged errors:\n  ${errors.join("\n  ")}`);
    } finally {
      // Back to empty, so later tests see a clean queue.
      await writeFile(join(DIST, "maintenance.json"), EMPTY_SCHEDULE);
    }
  });

  test("the preview hatch is invisible without the parameter", async () => {
    // The state 99% of loads are in, and the one every other test assumes.
    const { text } = await visit("/");
    assert.doesNotMatch(text, /Maintenance/i);
    assert.doesNotMatch(text, /under maintenance/i);
  });
});
