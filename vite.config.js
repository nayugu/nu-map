import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { spawn, execSync } from "child_process";

const commitDate = (() => {
  try {
    return execSync('git log -1 --format=%cd --date=format:"%b %Y"').toString().trim();
  } catch { return ""; }
})();

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
  plugins: [react(), catalogCheckPlugin()],
  base: process.env.VITE_BASE_PATH ?? "/",
  define: { __COMMIT_DATE__: JSON.stringify(commitDate) },
});
