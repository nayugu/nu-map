// BROWSER · arriving on a share-code link (#c=)
//
// Why this suite exists at all: the bug it guards escaped ~1150 unit,
// contract and invariant tests, because none of them can see the
// difference between the two ways a browser reaches a URL.
//
//   Opening #c=CODE with the app CLOSED is a document load. React mounts,
//   a mount effect runs, the code is claimed. Every earlier test did this.
//
//   Opening the same link with the app ALREADY OPEN is same-document
//   navigation. The browser changes the fragment and fires `hashchange`.
//   It does not reload, React does not remount, and a mount-only effect
//   never sees the code. Nothing happens, silently — which is exactly how
//   it was reported: "it opens NU Map but doesn't ask to load the plan".
//
// A QR is scanned by someone who very often already has the app open, so
// that second path is not an edge case, it is the feature.
//
// Requires the dev server (npm run dev) and the relay (node mcp-server).
// Skips itself when they are not up, so it can never break an ordinary
// `npm test` run; wire it in deliberately with `npm run test:browser`.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";

const APP = process.env.NUMAP_URL ?? "http://localhost:5173";
const RELAY = process.env.NUMAP_RELAY ?? "http://localhost:27182";

const reachable = async (url) => {
  try {
    const c = AbortSignal.timeout(2500);
    const r = await fetch(url, { signal: c });
    return r.ok || r.status < 500;
  } catch { return false; }
};

const up = (await reachable(APP)) && (await reachable(`${RELAY}/health`));

describe("share-code arrival", { skip: up ? false : "dev server or relay not running" }, () => {
  let browser;
  before(async () => { ({ chromium: browser } = await import("playwright")); browser = await browser.launch(); });
  after(async () => { await browser?.close(); });

  // Waits on real conditions, not sleeps: the header only exists once the
  // app has booted, and clicking before then silently does nothing —
  // which is how the first draft of this suite "failed".
  const openApp = async (page) => {
    await page.goto(APP, { waitUntil: "domcontentloaded" });
    const io = page.locator("button").filter({ hasText: /⇅/ }).first();
    await io.waitFor({ state: "visible", timeout: 30_000 });
    for (let i = 0; i < 4; i++) { await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(120); }
    await io.click();
    const panel = io.locator("xpath=following-sibling::div[1]");
    await panel.waitFor({ state: "visible", timeout: 10_000 });
    return panel;
  };

  const mintCode = async (page, panel) => {
    await panel.evaluate(p =>
      [...p.querySelectorAll("div")].find(d => getComputedStyle(d).display === "grid").children[0].click());
    await page.waitForTimeout(3000);
    const code = (await panel.innerText()).match(/\b[A-HJ-NP-Z2-9]{6}\b/)?.[0];
    assert.ok(code, "sender did not get a code");
    return code;
  };

  // The import sheet is in-app, NOT window.confirm — a native dialog is
  // suppressible on mobile and returns false when suppressed, which
  // discarded the plan after the claim had already burned the code. Any
  // native dialog appearing here is therefore itself a failure, so these
  // tests refuse to answer one.
  const sheet = (page) => page.locator('[role="dialog"]').filter({ hasText: /Load shared plan/ });
  const failOnNativeDialog = (page) => page.on("dialog", async d => {
    await d.dismiss();
    throw new Error(`a native dialog appeared: ${d.message()}`);
  });

  // THE REGRESSION. Kept first because it is the one that shipped broken.
  test("a link opened while the app is ALREADY OPEN still claims the code", async () => {
    const sender = await (await browser.newContext()).newPage();
    const code = await mintCode(sender, await openApp(sender));

    const recipient = await (await browser.newContext()).newPage();
    failOnNativeDialog(recipient);
    await recipient.goto(APP, { waitUntil: "domcontentloaded" });   // app already open
    await recipient.waitForTimeout(2500);

    // Fragment-only navigation: no reload, hashchange only.
    await recipient.evaluate(u => { window.location.href = u; }, `${APP}/#c=${code}`);

    await sheet(recipient).waitFor({ state: "visible", timeout: 20_000 });
    const navigations = await recipient.evaluate(() => performance.getEntriesByType("navigation").length);
    assert.equal(navigations, 1, "the page reloaded; this no longer tests same-document navigation");
    assert.ok(!recipient.url().includes("#c="), "the burned code was left in the URL");

    await sheet(recipient).getByRole("button", { name: /^Load$/ }).click();
    await recipient.waitForTimeout(1500);
    assert.equal(await sheet(recipient).count(), 0, "the sheet stayed up after Load");
  });

  test("a link opened on a COLD load still claims the code", async () => {
    const sender = await (await browser.newContext()).newPage();
    const code = await mintCode(sender, await openApp(sender));

    const recipient = await (await browser.newContext()).newPage();
    failOnNativeDialog(recipient);
    await recipient.goto(`${APP}/#c=${code}`, { waitUntil: "domcontentloaded" });
    await sheet(recipient).waitFor({ state: "visible", timeout: 20_000 });
    await sheet(recipient).getByRole("button", { name: /^Load$/ }).click();
    await recipient.waitForTimeout(1500);
    assert.equal(await sheet(recipient).count(), 0);
  });

  // The sheet is portalled to document.body to escape the header's
  // stacking context, and body does NOT carry the app's typography — that
  // lives on a wrapper div in App.jsx. The first version inherited the
  // browser default and rendered the confirm in serif. Nothing but a real
  // browser can see that, so check it here.
  test("the sheet uses the app's font, not the browser default", async () => {
    const sender = await (await browser.newContext()).newPage();
    const code = await mintCode(sender, await openApp(sender));

    const recipient = await (await browser.newContext()).newPage();
    failOnNativeDialog(recipient);
    await recipient.goto(`${APP}/#c=${code}`, { waitUntil: "domcontentloaded" });
    await sheet(recipient).waitFor({ state: "visible", timeout: 20_000 });

    const fonts = await sheet(recipient).evaluate(el => {
      const title = el.querySelector("div > div");
      return {
        sheet: getComputedStyle(el).fontFamily,
        title: getComputedStyle(title).fontFamily,
      };
    });
    for (const [where, family] of Object.entries(fonts)) {
      assert.match(family, /Inter/, `${where} fell back to "${family}" instead of the app font`);
    }
  });

  // The phone case that started all this: a suppressed native dialog
  // returns false. Playwright auto-dismisses unhandled dialogs, which is
  // the same thing — so a page with NO dialog handler must still import.
  test("import survives a browser that suppresses native dialogs", async () => {
    const sender = await (await browser.newContext()).newPage();
    const code = await mintCode(sender, await openApp(sender));

    const phone = await (await browser.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    })).newPage();
    // Deliberately no dialog handler: unhandled dialogs are auto-dismissed.
    await phone.goto(`${APP}/#c=${code}`, { waitUntil: "domcontentloaded" });
    await sheet(phone).waitFor({ state: "visible", timeout: 20_000 });
    await sheet(phone).getByRole("button", { name: /^Load$/ }).click();
    await phone.waitForTimeout(2000);
    const active = await phone.evaluate(() =>
      [...Array(localStorage.length).keys()].map(i => localStorage.key(i))
        .filter(k => /active-plan/.test(k)).map(k => localStorage.getItem(k)));
    assert.ok(active[0], "no plan became active after accepting the import");
  });

  test("the QR really decodes to the link, read back by an outside decoder", async (t) => {
    // Self-comparison proves nothing: the earlier version of this check
    // compared generateQr's output against generateQr's output. Decode the
    // rendered pixels with a decoder that shares no code with ours.
    //
    // Skipped ALOUD rather than returning quietly when the decoder is
    // absent — a test that no-ops in silence reports success it never
    // earned. `npm i -D jsqr pngjs` turns it on.
    let jsQR, PNG;
    try {
      jsQR = (await import("jsqr")).default;
      PNG = (await import("pngjs")).PNG;
    } catch {
      return t.skip("jsqr/pngjs not installed — run `npm i -D jsqr pngjs` to verify the QR for real");
    }
    const { readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const sender = await (await browser.newContext({ deviceScaleFactor: 3 })).newPage();
    const panel = await openApp(sender);
    const code = await mintCode(sender, panel);
    const file = join(tmpdir(), `numap-qr-${code}.png`);
    await panel.locator("div").filter({ has: sender.locator("svg") }).last().screenshot({ path: file });

    const png = PNG.sync.read(readFileSync(file));
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    assert.ok(decoded, "the rendered QR could not be decoded at all");
    assert.match(decoded.data, new RegExp(`#c=${code}$`), `QR encoded ${decoded.data}`);
  });
});
