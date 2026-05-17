#!/usr/bin/env node
/**
 * catalog-check-server.js
 *
 * Thin local server for the NU Map dev portal.
 * Spawns data-update scripts as subprocesses and streams their stdout/stderr
 * to the browser as Server-Sent Events.  No data-processing logic lives here —
 * all logic stays in the individual scripts.
 *
 * Usage:
 *   node scripts/catalog-check-server.js           # port 3333 (default)
 *   node scripts/catalog-check-server.js --port 4000
 *
 * Endpoints:
 *   GET  /adapters    — adapter list with last-updated metadata
 *   GET  /run         — SSE: spawn script, stream output (?adapter=X&write=0|1)
 *   GET  /git-status  — git diff --stat of data files
 *   POST /git-push    — commit + push data files to main
 */

import { createServer }                    from "http";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname }                from "path";
import { fileURLToPath }                   from "url";
import { spawn, execSync }                 from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, "..");
const PORT      = (() => {
  const i = process.argv.indexOf("--port");
  return i !== -1 ? parseInt(process.argv[i + 1], 10) : 3333;
})();

const META_PATH       = resolve(ROOT, "public/data-meta.json");
const CHANGE_LOG_PATH = resolve(ROOT, "public/northeastern/change-log.json");
const CHANGE_LOG_MAX  = 600;

// ── Adapter definitions ───────────────────────────────────────────────────────
const ADAPTERS = {
  offerings: {
    label:    "Course Offerings",
    desc:     "Fetch live section data from husker.vercel.app",
    cmd:      ["node", "scripts/fetch-courses.js", "--write"],
    dryCmd:   ["node", "scripts/fetch-courses.js"],
    workflow: "update-courses.yml",
    schedule: "Jan/Mar/May/Jul/Sep/Nov · 1st · 06:00 UTC",
  },
  catalog: {
    label:    "Course Catalog",
    desc:     "Scrape titles, descriptions, credits, prereqs from catalog.northeastern.edu",
    cmd:      ["node", "scripts/scrape-catalog.js", "--merge", "--write"],
    dryCmd:   ["node", "scripts/scrape-catalog.js", "--merge"],
    workflow: "update-courses.yml",
    schedule: "Every month · 1st · 06:00 UTC",
  },
  majors: {
    label:    "Major Requirements",
    desc:     "Scrape degree requirement trees from catalog.northeastern.edu",
    cmd:      ["node", "scripts/scrape-majors.js", "--write"],
    dryCmd:   ["node", "scripts/scrape-majors.js"],
    workflow: "update-majors.yml",
    schedule: "Jan/Mar/May/Jul/Sep/Nov · 1st · 08:00 UTC",
  },
  nupath: {
    label:    "NUPath Attributes",
    desc:     "Fetch from Tableau (official), falls back to catalog.northeastern.edu",
    cmd:      ["node", "scripts/fetch-nupath.js", "--write"],
    dryCmd:   ["node", "scripts/fetch-nupath.js"],
    workflow: "update-nupath.yml",
    schedule: "Manual",
  },
};

// Files touched by data updates — used for git-status and git-push
const GIT_DATA_FILES = [
  "public/northeastern/all-courses.json",
  "public/northeastern/catalog-courses.json",
  "public/northeastern/change-log.json",
  "public/northeastern/scrape-state.json",
  "src/core/dataMeta.json",
  "public/data-meta.json",
  "src/data/majors",
  "data/northeastern",
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function sendJSON(res, cors, status, body) {
  res.writeHead(status, { ...cors, "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readMeta() {
  try { return JSON.parse(readFileSync(META_PATH, "utf8")); } catch { return {}; }
}

function appendChangeLog(entry) {
  try {
    const log = existsSync(CHANGE_LOG_PATH)
      ? JSON.parse(readFileSync(CHANGE_LOG_PATH, "utf8"))
      : { runs: [] };
    if (!Array.isArray(log.runs)) log.runs = [];
    log.runs.unshift(entry);
    if (log.runs.length > CHANGE_LOG_MAX) log.runs = log.runs.slice(0, CHANGE_LOG_MAX);
    writeFileSync(CHANGE_LOG_PATH, JSON.stringify(log, null, 2) + "\n", "utf8");
  } catch { /* non-fatal */ }
}

// ── Server ────────────────────────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const server = createServer((req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return; }
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── GET /adapters ──────────────────────────────────────────────────────────
  if (req.method === "GET" && url.pathname === "/adapters") {
    const meta = readMeta();
    const list = Object.entries(ADAPTERS).map(([id, a]) => ({
      id, label: a.label, desc: a.desc,
      workflow: a.workflow, schedule: a.schedule,
      lastUpdated: id === "catalog" ? (meta.lastUpdated ?? null) : null,
      courseCount: id === "catalog" ? (meta.courseCount ?? null) : null,
    }));
    sendJSON(res, CORS, 200, { ok: true, adapters: list });
    return;
  }

  // ── GET /run?adapter=X&write=0|1 — SSE subprocess stream ──────────────────
  if (req.method === "GET" && url.pathname === "/run") {
    const id    = url.searchParams.get("adapter");
    const write = url.searchParams.get("write") === "1";
    const def   = ADAPTERS[id];
    if (!def) { sendJSON(res, CORS, 400, { ok: false, error: "Unknown adapter" }); return; }

    res.writeHead(200, {
      ...CORS,
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
    });
    res.flushHeaders?.();

    const send = (type, data) => {
      try { res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`); } catch {}
    };

    const [bin, ...args] = write ? def.cmd : def.dryCmd;
    send("start", { adapter: id, label: def.label, write, cmd: [bin, ...args].join(" ") });

    const child = spawn(bin, args, { cwd: ROOT, env: process.env });
    let killed = false;
    req.on("close", () => { killed = true; child.kill(); });

    child.stdout.on("data", chunk => {
      chunk.toString().split("\n").forEach(line => { if (line) send("log", { msg: line }); });
    });
    child.stderr.on("data", chunk => {
      chunk.toString().split("\n").forEach(line => { if (line) send("err", { msg: line }); });
    });
    child.on("close", code => {
      if (!killed) {
        send("done", { code });
        if (write) appendChangeLog({
          type:      "manual-trigger",
          subject:   `${def.label} (manual)`,
          adapter:   id,
          timestamp: new Date().toISOString(),
          exitCode:  code,
        });
      }
      res.end();
    });
    return;
  }

  // ── GET /git-status ────────────────────────────────────────────────────────
  if (req.method === "GET" && url.pathname === "/git-status") {
    try {
      const opts   = { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 };
      const files  = GIT_DATA_FILES.join(" ");
      const status = execSync(`git status --short -- ${files}`, opts).toString().trim();
      const diff   = status
        ? execSync(`git diff --stat -- ${files}`, opts).toString().trim()
        : "";
      sendJSON(res, CORS, 200, { ok: true, dirty: !!status, status, diff });
    } catch (e) {
      sendJSON(res, CORS, 500, { ok: false, error: e.message });
    }
    return;
  }

  // ── POST /git-push ─────────────────────────────────────────────────────────
  if (req.method === "POST" && url.pathname === "/git-push") {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      try {
        const opts   = { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 };
        const files  = GIT_DATA_FILES.join(" ");
        const status = execSync(`git status --short -- ${files}`, opts).toString().trim();
        if (!status) {
          sendJSON(res, CORS, 200, { ok: true, msg: "Nothing to commit — already up to date." });
          return;
        }
        const date = new Date().toISOString().slice(0, 10);
        execSync(`git add -- ${files}`, opts);
        execSync(`git commit -m "data: update data files ${date}"`, opts);
        const out = execSync("git push", { ...opts, encoding: "utf8" });
        sendJSON(res, CORS, 200, { ok: true, msg: "Pushed successfully.", output: out.trim() });
      } catch (e) {
        sendJSON(res, CORS, 500, { ok: false, error: e.message });
      }
    });
    return;
  }

  // ── Root: usage ────────────────────────────────────────────────────────────
  res.writeHead(200, { ...CORS, "Content-Type": "text/plain" });
  res.end([
    `NU Map Dev Portal Server  —  :${PORT}`,
    ``,
    `GET  /adapters             adapter list + metadata`,
    `GET  /run                  SSE script runner  (?adapter=X&write=0|1)`,
    `GET  /git-status           git diff of data files`,
    `POST /git-push             commit + push data files`,
  ].join("\n"));
});

server.listen(PORT, () => {
  console.log(`\n✅  Dev portal server → http://localhost:${PORT}`);
  console.log(`   Open dev.html → Trigger tab → click Preview or Run\n`);
  console.log(`   Stop with Ctrl+C\n`);
});
