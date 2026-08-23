// Static server over `dist/`, for browser tests that must own their own world.
//
// `boot-smoke.browser.test.js` deliberately keeps its OWN copy of this — its
// header explains why: it is the one test that must still work when everything
// else is broken, and a shared helper is one more thing that can break it. Every
// other browser test should import from here rather than adding a third copy.
import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
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
 * Build if `dist/` is missing OR OLDER THAN THE SOURCE.
 *
 * The staleness half is not a nicety, it is the whole point, and it is here
 * because skipping it produced a false pass: a `dist/` left over from an earlier
 * session made a browser run report that new components rendered when they were
 * not in the bundle at all. A browser test whose job is "does this actually
 * render" must never be able to answer for code it did not load.
 *
 * ⚠ `boot-smoke.browser.test.js` keeps its own `ensureBuild` with the older
 * "a present dist/ is the caller's" rule, and therefore has the same blind spot.
 * Left alone deliberately — that file is the one guard the whole project is told
 * to trust, and changing when it rebuilds is a decision for its owners.
 */
export async function ensureBuild() {
  const distHtml = join(DIST, "index.html");
  if (await exists(distHtml)) {
    const built = (await stat(distHtml)).mtimeMs;
    const src = Math.max(
      await newestMtime(join(ROOT, "src")),
      await newestMtime(join(ROOT, "public")),
      (await stat(join(ROOT, "index.html"))).mtimeMs,
    );
    if (built >= src) return;
    console.log("  (dist/ is older than src/ — rebuilding so this test can mean something)");
  }
  await new Promise((res, rej) => {
    const p = spawn("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
    p.on("exit", (c) => (c === 0 ? res() : rej(new Error(`build exited ${c}`))));
    p.on("error", rej);
  });
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
