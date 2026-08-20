// BROWSER · the built app MOUNTS. Nothing else in this repo checks that.
//
// ── Why this file exists ────────────────────────────────────────────
//
// On 2026-08-20 the planner threw `ReferenceError: Cannot access 'supersededTakes'
// before initialization` on every render. The provider never mounted and every
// visitor got the recovery screen. It reached production with the whole suite green:
//
//     npm run build            succeeds
//     test:unit       2,018    pass
//     test:contract      93    pass
//     test:invariant    254    pass
//     verify-chart      794 plans, 0 hard-rule violations
//
// Every one of those runs in Node, and nothing in Node evaluates a React component
// body. HTTP checks were no help either — `/`, the bundle and every JSON asset all
// returned 200 while the app was unusable. Status is not proof.
//
// The existing browser tests could not have caught it. They `skip` unless a dev
// server is already listening, and CI never starts one, so in CI they are a no-op.
// A skip is exactly how this class of bug travels.
//
// So this test owns its own world: it builds if there is no build, serves `dist/`
// itself, and FAILS rather than skips. It asserts one thing — loading the app
// produces no page error — which is the cheapest possible guard against the app
// being completely dead, and it would have caught the outage above in seconds.
//
// ── Deliberately not a feature test ────────────────────────────────
//
// It does not assert what is on screen. Anything more specific belongs in the
// feature-shaped files beside it, and would give this one a reason to be edited —
// which is how a smoke test loses the property that makes it valuable: it should
// only ever fail when the app is broken for EVERYONE.

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
  ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2",
  ".map": "application/json", ".txt": "text/plain",
};

const exists = async (p) => { try { await stat(p); return true; } catch { return false; } };

/** Build only if there is nothing to serve — a present `dist/` is the caller's. */
async function ensureBuild() {
  if (await exists(join(DIST, "index.html"))) return;
  await new Promise((res, rej) => {
    const p = spawn("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
    p.on("exit", (c) => (c === 0 ? res() : rej(new Error(`build exited ${c}`))));
    p.on("error", rej);
  });
}

/**
 * Static server over `dist/`, plus `public/northeastern/*` which the app fetches
 * at runtime and `vite build` copies in. Path traversal is refused rather than
 * normalised away, because a test server that serves the repo is a worse problem
 * than a failing test.
 */
function serveDist() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
      if (rel.includes("..")) { res.writeHead(403).end(); return; }
      if (rel === "" || rel.endsWith("/")) rel = join(rel, "index.html");
      let file = join(DIST, rel);
      if (!(await exists(file))) {
        const alt = join(ROOT, "public", rel);
        if (await exists(alt)) file = alt;
        else { res.writeHead(404).end("not found"); return; }
      }
      const body = await readFile(file);
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

describe("boot smoke", () => {
  let browser, server, port, launchError = null;

  before(async () => {
    await ensureBuild();
    ({ server, port } = await serveDist());
    try {
      const { chromium } = await import("playwright");
      browser = await chromium.launch();
    } catch (e) {
      // Recorded and asserted on, never skipped: a missing browser must be visible
      // as a gap rather than as a green run. `npx playwright install chromium`.
      launchError = e;
    }
  });

  after(async () => {
    await browser?.close();
    await new Promise((r) => server?.close(r));
  });

  test("the app mounts with no page error", async () => {
    assert.equal(launchError, null,
      `chromium unavailable — run \`npx playwright install chromium\`: ${launchError?.message}`);
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e?.message ?? e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load", timeout: 60_000 });
    // The catalog is fetched after mount, so give the first render room to throw.
    await page.waitForTimeout(4000);

    // A ReferenceError in a provider body surfaces as a pageerror AND leaves the
    // recovery screen behind, so both are checked — the second is what a user sees
    // and it survives even if the error is swallowed somewhere.
    const bodyText = await page.evaluate(() => document.body?.innerText ?? "");
    await page.close();

    assert.deepEqual(errors, [], `the app logged errors on boot:\n  ${errors.join("\n  ")}`);
    assert.ok(!/Something went wrong/i.test(bodyText),
      "the recovery screen is showing, so the app did not mount");
  });

  test("the timeline actually rendered", async () => {
    // One structural assertion, because "no error" is also true of a blank page —
    // which is the failure mode a smoke test most easily misses.
    assert.equal(launchError, null, "chromium unavailable");
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load", timeout: 60_000 });
    const seen = await page.locator("[data-timeline-header]")
      .waitFor({ state: "visible", timeout: 45_000 }).then(() => true).catch(() => false);
    await page.close();
    assert.ok(seen, "no timeline header appeared — the planner did not mount");
  });
});
