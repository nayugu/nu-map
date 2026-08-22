// BROWSER · the /data omnibox actually RUNS.
//
// Everything else about this feature is verified in Node: 46 unit tests, 13
// contract tests over a fixed corpus, and build rails that refuse to ship an
// unsearchable page. None of them load a page in a browser, and nothing in Node
// executes the widget's DOM code — the same blind spot that let a provider throw
// on every render while 2,018 unit tests passed (see boot-smoke.browser.test.js).
//
// So this file asserts the parts that only exist in a browser: the bundle
// parses, the index fetch survives, a keystroke produces rows, the keyboard
// works, and Enter goes where it claims. It FAILS rather than skips when
// chromium is missing, because a skip is how this class of bug travels.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DIST = join(ROOT, "dist");

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain",
  ".xml": "application/xml", ".woff2": "font/woff2",
};

const exists = async (p) => { try { await stat(p); return true; } catch { return false; } };

async function ensureBuild() {
  if (await exists(join(DIST, "data.html"))) return;
  await new Promise((res, rej) => {
    const p = spawn("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
    p.on("exit", (c) => (c === 0 ? res() : rej(new Error(`build exited ${c}`))));
    p.on("error", rej);
  });
}

/**
 * Static server over `dist/`. Absolute asset URLs in the generated pages point
 * at https://numap.app, so the test rewrites that origin to this server — the
 * pages are built for production and should not be built differently to be
 * testable.
 */
function serveDist() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
      if (rel.includes("..")) { res.writeHead(403).end(); return; }
      if (rel === "" || rel.endsWith("/")) rel = join(rel, "index.html");
      let file = join(DIST, rel);
      // Pretty URLs: /data/search is dist/data/search.html.
      if (!(await exists(file)) && await exists(`${file}.html`)) file = `${file}.html`;
      if (!(await exists(file))) { res.writeHead(404).end("not found"); return; }
      let body = await readFile(file);
      if (extname(file) === ".html") {
        body = Buffer.from(body.toString("utf8")
          .replaceAll("https://numap.app/", `http://127.0.0.1:${server.address().port}/`));
      }
      res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch (e) {
      res.writeHead(500).end(String(e?.message ?? e));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

describe("data search widget", () => {
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

  /** A page with the widget mounted, collecting anything it logs. */
  async function open(pathname) {
    assert.equal(launchError, null,
      `chromium unavailable — run \`npx playwright install chromium\`: ${launchError?.message}`);
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e?.message ?? e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
    await page.goto(`http://127.0.0.1:${port}${pathname}`, { waitUntil: "load", timeout: 60_000 });
    return { page, errors };
  }

  /**
   * Type a query and wait for the panel to actually answer IT.
   *
   * `expect` is required because waiting only for "the panel is visible" passes
   * instantly when a previous query already filled it — which made a passing
   * assertion out of a stale result, the exact race a typeahead has to survive.
   */
  const type = async (page, text, expect = ".fx-row") => {
    await page.click("input[name=q]");
    await page.fill("input[name=q]", text);
    await page.waitForSelector(`[data-search-results]:not([hidden]) ${expect}`, { timeout: 15_000 });
  };
  const rows = (page) => page.$$eval(".fx-row",
    (els) => els.map((e) => ({ text: e.innerText.replace(/\s+/g, " ").trim(), href: e.getAttribute("href") })));

  test("the widget loads and answers a course code", async () => {
    const { page, errors } = await open("/data.html");
    // The form must exist even before the script runs — it is the no-JS floor.
    assert.equal(await page.$$eval("[data-search-form]", (e) => e.length), 1);

    await type(page, "chem 2311");
    const found = await rows(page);
    assert.ok(found.length, "no rows for an exact course code");
    assert.match(found[0].text, /Organic Chemistry 1/, `first row was "${found[0].text}"`);
    assert.equal(found[0].href, "/data/courses/CHEM/2311");
    assert.deepEqual(errors, [], `errors on the page:\n  ${errors.join("\n  ")}`);
    await page.close();
  });

  test("a cross-kind query shows more than one kind, labelled", async () => {
    const { page, errors } = await open("/data.html");
    await type(page, "chemistry");
    const found = await rows(page);
    assert.ok(found.length >= 5, `only ${found.length} rows`);
    const kinds = await page.$$eval(".fx-kind", (els) => [...new Set(els.map((e) => e.innerText.trim()))]);
    assert.ok(kinds.length >= 3, `only these kinds shown: ${kinds.join(", ")}`);
    // The tag is what makes the ambiguity legible, so it must be real text.
    for (const k of kinds) assert.match(k, /^(Course|Program|Subject|Professor|NUpath)$/i, `odd kind tag "${k}"`);
    assert.deepEqual(errors, []);
    await page.close();
  });

  test("a nickname resolves, and junk says so", async () => {
    const { page, errors } = await open("/data.html");
    await type(page, "orgo");
    assert.match((await rows(page))[0].text, /Organic Chemistry 1/);

    await type(page, "zzzznope", ".fx-none");
    assert.deepEqual(await rows(page), [], "junk produced result rows");
    const none = await page.$eval(".fx-none", (e) => e.innerText);
    assert.match(none, /No match/i, `empty state said "${none}"`);
    assert.deepEqual(errors, []);
    await page.close();
  });

  test("the keyboard drives it", async () => {
    const { page } = await open("/data.html");
    await type(page, "biology");
    const before = await rows(page);

    await page.keyboard.press("ArrowDown");
    const active = await page.$$eval(".fx-row.on", (els) => els.map((e) => e.getAttribute("href")));
    assert.equal(active.length, 1, "arrow keys did not move a single highlight");
    assert.equal(active[0], before[1].href, "the highlight moved to the wrong row");

    // Enter on a row the user chose navigates there.
    await Promise.all([page.waitForNavigation({ timeout: 15_000 }), page.keyboard.press("Enter")]);
    assert.equal(new URL(page.url()).pathname, before[1].href);
    await page.close();
  });

  test("Escape closes the panel without navigating", async () => {
    const { page } = await open("/data.html");
    await type(page, "biology");
    const url = page.url();
    await page.keyboard.press("Escape");
    assert.equal(await page.$eval("[data-search-results]", (e) => e.hidden), true);
    assert.equal(page.url(), url, "Escape navigated");
    await page.close();
  });

  test("Enter on a weak best guess opens the search page instead of jumping", async () => {
    // The deliberate gate: jumping on a guess navigates away from the one screen
    // that could have shown the right answer.
    const { page } = await open("/data.html");
    await type(page, "biolog");
    await Promise.all([page.waitForNavigation({ timeout: 15_000 }), page.keyboard.press("Enter")]);
    const u = new URL(page.url());
    assert.equal(u.pathname, "/data/search");
    assert.equal(u.searchParams.get("q"), "biolog");
    await page.close();
  });

  test("/data/search?q= renders its results on load, so a search is shareable", async () => {
    const { page, errors } = await open("/data/search?q=organic%20chemistry");
    await page.waitForFunction(
      () => !document.querySelector("[data-search-results]").hidden, null, { timeout: 15_000 });
    const found = await rows(page);
    assert.ok(found.length, "no results rendered from the query string");
    assert.ok(found.some((r) => /Organic Chemistry/i.test(r.text)), found.map((r) => r.text).join(" | "));
    assert.equal(await page.inputValue("input[name=q]"), "organic chemistry");
    assert.deepEqual(errors, []);
    await page.close();
  });

  test("the box survives the index being missing", async () => {
    // On Pages a deleted asset answers with the HTML shell at status 200, so the
    // widget must degrade to a usable form rather than throwing or hanging.
    const { page, errors } = await open("/data.html");
    await page.route("**/assets/data-index-*.json", (r) =>
      r.fulfill({ status: 200, contentType: "text/html", body: "<!DOCTYPE html><html></html>" }));
    await page.reload({ waitUntil: "load" });
    await type(page, "chemistry", ".fx-none");
    const none = await page.$eval(".fx-none", (e) => e.innerText);
    assert.match(none, /unavailable/i, `said "${none}"`);
    // The form still submits to a real page, which is the whole no-JS floor.
    await Promise.all([page.waitForNavigation({ timeout: 15_000 }), page.keyboard.press("Enter")]);
    assert.equal(new URL(page.url()).pathname, "/data/search");
    // A failed fetch is expected here; a THROWN error is not.
    assert.deepEqual(errors.filter((e) => !/fetch|Failed to load|net::/i.test(e)), []);
    await page.close();
  });
});
