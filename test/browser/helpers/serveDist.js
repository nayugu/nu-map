// Static server over `dist/`, for browser tests that must own their own world.
//
// `boot-smoke.browser.test.js` deliberately keeps its OWN copy of this — its
// header explains why: it is the one test that must still work when everything
// else is broken, and a shared helper is one more thing that can break it. Every
// other browser test should import from here rather than adding a third copy.
import { createServer } from "node:http";
import { readFile, readdir, stat, open, rm } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DIST = join(ROOT, "dist");

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2",
  ".map": "application/json", ".txt": "text/plain",
};

const exists = async (p) => { try { await stat(p); return true; } catch { return false; } };

/**
 * Newest mtime under a tree, or 0. Skips the noise that cannot change a bundle.
 * @param {string} dir
 */
async function newestMtime(dir) {
  let newest = 0;
  const walk = async (d) => {
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else {
        try { const s = await stat(p); if (s.mtimeMs > newest) newest = s.mtimeMs; } catch { /* raced */ }
      }
    }
  };
  await walk(dir);
  return newest;
}

/**
 * True when `dist/` is present and NOT OLDER THAN THE SOURCE.
 *
 * The staleness half is not a nicety, it is the whole point, and it is here
 * because skipping it produced a false pass: a `dist/` left over from an earlier
 * session made a browser run report that new components rendered when they were
 * not in the bundle at all. A browser test whose job is "does this actually
 * render" must never be able to answer for code it did not load. It happened
 * again while this file was being changed — a probe served a bundle built with a
 * mutant still applied, and reported a working feature as broken.
 *
 * ⚠ `boot-smoke.browser.test.js` keeps its own `ensureBuild` with the older
 * "a present dist/ is the caller's" rule, and therefore has the same blind spot.
 * Left alone deliberately — that file is the one guard the whole project is told
 * to trust, and changing when it rebuilds is a decision for its owners.
 */
async function distIsFresh() {
  const distHtml = join(DIST, "index.html");
  if (!(await exists(distHtml))) return false;
  const built = (await stat(distHtml)).mtimeMs;
  const src = Math.max(
    await newestMtime(join(ROOT, "src")),
    await newestMtime(join(ROOT, "public")),
    (await stat(join(ROOT, "index.html"))).mtimeMs,
  );
  return built >= src;
}

/**
 * Build if dist/ is missing or stale — and let only ONE process do it.
 *
 * `node --test` runs test FILES in parallel processes, and every browser test
 * calls this. With a stale dist/ they all decided to rebuild, all ran `vite
 * build` into the same directory, and one of them served a half-written bundle.
 * Reproduced deterministically: `touch src/context/PlannerContext.jsx` and run
 * three browser suites together — the third fails. It presents as random
 * flakiness, and dist/ is stale after ANY source change, which is the normal
 * state of an edit-test loop, so `npm run test:browser` was quietly unreliable
 * exactly when it was being used.
 *
 * The lock is an exclusive create (`wx`), which is atomic: the winner builds
 * and unlinks, the losers wait for dist/ to become fresh. Waiting on another
 * process's build is a real wait with no notification available, so a bounded
 * poll is the honest shape here — unlike a poll standing in for a completion
 * signal we already have.
 */
export async function ensureBuild() {
  if (await distIsFresh()) return;

  const lock = join(ROOT, "node_modules", ".browser-test-build.lock");
  let held = false;
  try {
    // O_EXCL: exactly one caller can create it.
    const fh = await open(lock, "wx");
    await fh.close();
    held = true;
  } catch {
    // Someone else is building. Wait for THEIR output rather than starting a
    // second build into the same directory.
    for (let i = 0; i < 240; i++) {                       // ~2 min ceiling
      await new Promise(r => setTimeout(r, 500));
      if (await distIsFresh()) return;
      if (!(await exists(lock))) break;   // builder died; fall through and build
    }
    if (await distIsFresh()) return;
  }

  try {
    console.log("  (dist/ is stale — rebuilding so this test can mean something)");
    await new Promise((res, rej) => {
      const p = spawn("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
      p.on("exit", (c) => (c === 0 ? res() : rej(new Error(`build exited ${c}`))));
      p.on("error", rej);
    });
  } finally {
    if (held) await rm(lock, { force: true }).catch(() => {});
  }
}

/**
 * Serve `dist/`, falling back to `public/` for the runtime-fetched data files.
 * Path traversal is refused rather than normalised away: a test server that
 * serves the whole repo is a worse problem than a failing test.
 */
export function serveDist() {
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
