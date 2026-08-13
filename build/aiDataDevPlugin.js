// ═══════════════════════════════════════════════════════════════════
// BUILD · ai-data-dev — the dev-only twin of aiDataPlugin
//
// Lives in its own module, importing Node builtins ONLY, and that is the whole
// reason it is not still inline in vite.config.js.
//
// `test/invariant/dev-data-namespace.test.js` drives this plugin's middleware for real —
// it pushes URLs through it and asserts which ones go back to Vite. To reach the plugin
// it used to import `vite.config.js`, which imports `vite` and `@vitejs/plugin-react`.
// Both are devDependencies, and `.github/workflows/test.yml` deliberately omits
// `npm ci` from the unit and invariant jobs:
//
//   "the unit and invariant import only src/ + Node builtins (committed data, no
//    runtime deps), and keeping it that way is enforced here by omitting the install
//    step. Do not add an install step to unit or invariant."
//
// So the test passed locally, where vite is installed, and failed on CI with
// ERR_MODULE_NOT_FOUND. The fix belongs here rather than in the workflow: adding an
// install step would trade a real architectural constraint for one test's convenience,
// and making the test skip when vite is absent would leave it green in CI while
// checking nothing, which is worse than a red build.
// ═══════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";

/**
 * Dev-only twin of aiDataPlugin: the /data surface is generated at build
 * time, so the plain dev server has nothing to serve there and every link
 * 404s into the SPA shell. On the first /data* request this builds the
 * surface into dist/ (once, ~15s), then serves it with the same pretty-URL
 * resolution Cloudflare Pages applies — and rewrites the pages' absolute
 * https://numap.app/data links to local paths so navigation stays on
 * localhost.
 *
 * @param {string} root absolute path to the repo root. Passed in rather than derived
 *   from this file's location, so moving the module cannot silently change which
 *   directory the middleware treats as the project.
 */
export default function aiDataDevPlugin(root) {
  let building = null;
  return {
    name: "ai-data-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || "").split("?")[0];
        if (url !== "/data" && url !== "/data.html" && !url.startsWith("/data/")) return next();
        if (url.includes("..")) return next();
        // Two different things claim /data in dev, and only one of them is
        // this surface. The repo's own `data/` directory sits at the project
        // root, so Vite serves the planner's requirement files as module URLs
        // under /data/northeastern/programs/**/requirements.json — the lazy
        // import.meta.glob in src/data/majorLoader.js. Swallowing those and
        // answering with the not-found page breaks every major in dev with
        // "Failed to fetch dynamically imported module", because the AI
        // surface has no such file to serve and never will.
        //
        // So: a Vite module request, or any /data path that is a real file on
        // disk, belongs to the app and goes back to Vite.
        if (/[?&](import|t=|v=)/.test(req.url || "")) return next();
        try {
          // Resolved from the repo root, not cwd: a middleware that answers
          // differently depending on where the process was started is a bug
          // waiting for the one caller that starts it elsewhere.
          const onDisk = path.join(root, decodeURIComponent(url));
          if (fs.existsSync(onDisk) && fs.statSync(onDisk).isFile()) return next();
        } catch { /* undecodable URL — let the surface handle it */ }
        try {
          if (!fs.existsSync(path.join(root, "dist/data.html"))) {
            building ??= import(`${path.join(root, "scripts/build-ai-data.js")}`)
              .then((m) => m.buildAiData());
            await building;
          }
          const rel = url === "/data" || url === "/data.html"
            ? "data.html" : decodeURIComponent(url.slice(1));
          for (const c of [rel, `${rel}.html`, `${rel}/index.html`]) {
            const p = path.join(root, "dist", c);
            if (fs.existsSync(p) && fs.statSync(p).isFile()) {
              const type = c.endsWith(".json") ? "application/json"
                : c.endsWith(".xml") ? "application/xml" : "text/html";
              res.setHeader("Content-Type", `${type}; charset=utf-8`);
              let body = fs.readFileSync(p, "utf8");
              if (type === "text/html") body = body.replaceAll("https://numap.app/data", "/data");
              res.end(body);
              return;
            }
          }
        } catch (e) {
          res.statusCode = 500;
          res.end(`ai-data-dev: ${e}`);
          return;
        }
        // No such page: same not-found the production rewrite serves.
        //
        // Read defensively, and note that this sits OUTSIDE the try above. An
        // unguarded readFileSync on the fallback path turns "page not found"
        // into "dev server dead" — the process exits on an unhandled ENOENT and
        // takes the whole session with it. That is exactly what happened when
        // 99ec1ab81c folded public/data-404.html into the site-wide
        // public/404.html and left this line pointing at the deleted file.
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        let notFound = "<!doctype html><meta charset=utf-8><title>Not found</title><h1>404 — not found</h1>";
        try { notFound = fs.readFileSync(path.join(root, "public/404.html"), "utf8"); }
        catch { /* inline fallback */ }
        res.end(notFound);
      });
    },
  };
}
