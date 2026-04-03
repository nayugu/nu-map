import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { spawn, execSync } from "child_process";
import fs from "fs";

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
  plugins: [react(), catalogCheckPlugin(), dataMetaPlugin()],
  base: process.env.VITE_BASE_PATH ?? "/",
  define: { __COMMIT_DATE__: JSON.stringify(commitDate) },
});
