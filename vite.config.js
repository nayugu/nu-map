import { defineConfig } from "vite";
import net from "net";
import react from "@vitejs/plugin-react";
import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
// Node builtins only, so `test/invariant/dev-data-namespace.test.js` can drive its
// middleware without importing THIS file — which would pull in `vite` and
// `@vitejs/plugin-react`, neither of which the dependency-free invariant job installs.
import aiDataDevPlugin from "./build/aiDataDevPlugin.js";

/** The repo root, resolved from this file rather than from cwd. */
const ROOT = path.dirname(fileURLToPath(import.meta.url));

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

/**
 * Emits dist/assets/build.json — {entry, built} — naming the entry bundle of
 * THIS build. It is the only way the recovery screens can learn what the live
 * deployment's entry bundle is called, and that is the only honest readiness
 * signal they have.
 *
 * Why they can't just ask for their own bundle back: `/* /index.html 200`
 * (public/_redirects) answers a deleted hash with the HTML shell at status
 * 200 — under /assets/*'s year-long `immutable` header, no less — so neither
 * `r.ok` nor `404` distinguishes "the deployment is whole" from "the exact
 * failure we are recovering from". A JSON body that parses does: the shell,
 * and a Cloudflare challenge page, both fail JSON.parse.
 *
 * Why it lives under /assets/ rather than at the root: the zone's Human
 * Verification rule exempts /assets/ and /northeastern/, and a long-lived
 * tab's challenge clearance expires — that is what blinded the probe to real
 * deploys before. Readers must pass `cache: 'no-store'` (the /assets/*
 * immutable header applies to this file too).
 */
function buildManifestPlugin() {
  return {
    name: "build-manifest",
    apply: "build",
    writeBundle(_options, bundle) {
      // Must be the APP entry, not just any entry chunk: the web workers
      // (worker: { format: "es" }) are entry chunks under assets/ too, and if
      // one of those were written here the manifest would name a bundle the
      // shell never references — the recovery screens would then read a
      // permanent disagreement and never offer the way back.
      const entry = Object.values(bundle).find(
        (c) => c.type === "chunk" && c.isEntry && /^assets\/index-[^/]+\.js$/.test(c.fileName)
      );
      if (!entry) return;
      try {
        fs.writeFileSync(
          "./dist/assets/build.json",
          JSON.stringify({ entry: entry.fileName.replace(/^assets\//, ""), built: new Date().toISOString() })
        );
      } catch { /* a missing manifest degrades detection, never the build */ }
    },
  };
}

/** Spawns catalog-check-server alongside the dev server so no second terminal is needed. */
function catalogCheckPlugin() {
  let child;

  // `node --watch` runs the server in a GRANDCHILD, so killing the supervisor
  // alone leaves the process that actually holds the port running, reparented to
  // init. detached:true makes the pair its own process group; a negative pid then
  // kills the group rather than just the supervisor.
  const stop = () => {
    if (!child) return;
    const pid = child.pid;
    child = null;
    try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ }
  };

  const portBusy = (port) => new Promise((resolve) => {
    const probe = net.createConnection({ port, host: "127.0.0.1" });
    probe.once("connect", () => { probe.destroy(); resolve(true); });
    probe.once("error", () => resolve(false));
    probe.setTimeout(300, () => { probe.destroy(); resolve(false); });
  });

  return {
    name: "catalog-check-server",
    async configureServer(server) {
      // Two dev servers at once is normal here. Without this the second spawns a
      // --watch supervisor that can never bind, and retries forever with its
      // stdio inherited — which is what fills the terminal with EADDRINUSE.
      if (await portBusy(3333)) return;

      child = spawn("node", ["--watch", "scripts/catalog-check-server.js"],
                    { stdio: "inherit", detached: true });
      child.on("error", () => {});

      // buildEnd alone was the bug: it is a BUILD hook and never fires when a dev
      // server is interrupted, so every `npm run dev` leaked one supervisor and
      // every Ctrl-C orphaned it. Sixteen had accumulated over nine days. Hook
      // the events that actually end a dev session instead.
      server.httpServer?.once("close", stop);
      process.once("exit", stop);
      for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
        process.once(sig, () => { stop(); process.exit(0); });
      }
    },
    buildEnd: stop,
  };
}

export default defineConfig({
  plugins: [react(), catalogCheckPlugin(), dataMetaPlugin(), buildManifestPlugin(), aiDataPlugin(), aiDataDevPlugin(ROOT)],
  base: "./",
  define: { __COMMIT_DATE__: JSON.stringify(commitDate) },
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
  worker: { format: "es" },
});
