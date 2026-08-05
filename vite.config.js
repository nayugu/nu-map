import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { spawn, execSync } from "child_process";
import fs from "fs";

/**
 * Emits the AI-readable data export (dist/northeastern/ai/**, see
 * scripts/build-ai-data.js) as part of EVERY production build. Lives
 * inside the Vite build on purpose: Cloudflare Pages builds numap.app
 * with its own dashboard-configured command, so a package.json chain
 * step is not guaranteed to run there — a plugin is.
 */
function aiDataPlugin() {
  return {
    name: "ai-data-export",
    apply: "build",
    async closeBundle() {
      const { buildAiData } = await import("./scripts/build-ai-data.js");
      buildAiData();
    },
  };
}

/**
 * Dev-only twin of aiDataPlugin: the /data surface is generated at build
 * time, so the plain dev server has nothing to serve there and every link
 * 404s into the SPA shell. On the first /data* request this builds the
 * surface into dist/ (once, ~15s), then serves it with the same pretty-URL
 * resolution Cloudflare Pages applies — and rewrites the pages' absolute
 * https://numap.app/data links to local paths so navigation stays on
 * localhost.
 */
function aiDataDevPlugin() {
  let building = null;
  return {
    name: "ai-data-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || "").split("?")[0];
        if (url !== "/data" && url !== "/data.html" && !url.startsWith("/data/")) return next();
        if (url.includes("..")) return next();
        try {
          if (!fs.existsSync("./dist/data.html")) {
            building ??= import("./scripts/build-ai-data.js").then((m) => m.buildAiData());
            await building;
          }
          const rel = url === "/data" || url === "/data.html" ? "data.html" : decodeURIComponent(url.slice(1));
          for (const c of [rel, `${rel}.html`, `${rel}/index.html`]) {
            const p = `./dist/${c}`;
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
        next();
      });
    },
  };
}

const commitDate = (() => {
  try {
    return execSync('git log -1 --format=%cd --date=format:"%b %Y"').toString().trim();
  } catch { return ""; }
})();

/** Injects the git commit date into data-meta.json for the dev server and production build. */
function dataMetaPlugin() {
  return {
    name: "data-meta-inject",
    configureServer(server) {
      server.middlewares.use("/data-meta.json", (_req, res) => {
        try {
          const meta = JSON.parse(fs.readFileSync("./public/data-meta.json", "utf8"));
          if (commitDate) meta.lastUpdated = commitDate;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(meta));
        } catch {
          res.statusCode = 500; res.end("{}");
        }
      });
    },
    writeBundle() {
      const path = "./dist/data-meta.json";
      try {
        const meta = JSON.parse(fs.readFileSync(path, "utf8"));
        if (commitDate) meta.lastUpdated = commitDate;
        fs.writeFileSync(path, JSON.stringify(meta, null, 2));
      } catch { /* dist not present or file missing — skip */ }
    },
  };
}

/** Spawns catalog-check-server alongside the dev server so no second terminal is needed. */
function catalogCheckPlugin() {
  let child;
  return {
    name: "catalog-check-server",
    configureServer() {
      child = spawn("node", ["--watch", "scripts/catalog-check-server.js"], { stdio: "inherit" });
      child.on("error", () => {}); // silently ignore if port already in use
    },
    buildEnd() {
      if (child) { child.kill(); child = null; }
    },
  };
}

export default defineConfig({
  plugins: [react(), catalogCheckPlugin(), dataMetaPlugin(), aiDataPlugin(), aiDataDevPlugin()],
  base: "./",
  define: { __COMMIT_DATE__: JSON.stringify(commitDate) },
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
  worker: { format: "es" },
});
