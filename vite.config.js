import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { spawn } from "child_process";

/** Spawns catalog-check-server alongside the dev server so no second terminal is needed. */
function catalogCheckPlugin() {
  let child;
  return {
    name: "catalog-check-server",
    configureServer() {
      child = spawn("node", ["scripts/catalog-check-server.js"], { stdio: "inherit" });
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
});
