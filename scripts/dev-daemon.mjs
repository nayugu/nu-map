#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// DEV DAEMON — keep localhost up across terminals and sessions.
//
//   npm run dev:up      start it (no-op if already running)
//   npm run dev:down    stop it, and the catalog-check child with it
//   npm run dev:status  is it up, on what pid, since when
//   npm run dev:log     follow the log
//
// ── Why this exists ────────────────────────────────────────────────
//
// `npm run dev` ties the server to the terminal — or to whatever agent shell
// launched it. Closing the tab, ending the session, or the process group being
// torn down takes localhost with it, which is how a working dev server kept
// "closing" on its own.
//
// So the server is DETACHED: its own process group (`detached: true` +
// `unref()`), stdio to a log file rather than an inherited terminal, and a pid
// file to find it again. Nothing that happens to the shell that started it can
// reach it; only `dev:down` (or a reboot) stops it.
//
// Deliberately not a launchd agent. That survives reboots, which sounds like
// more of a good thing but means a stale build of a fast-moving branch is
// silently serving on 5173 weeks later. A daemon you start once per working
// session is the right amount of persistent.
// ═══════════════════════════════════════════════════════════════════
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const ROOT     = dirname(dirname(fileURLToPath(import.meta.url)));
const DIR      = join(ROOT, ".dev");
const PID_FILE = join(DIR, "vite.pid");
const LOG_FILE = join(DIR, "vite.log");
const PORT     = Number(process.env.PORT || 5173);
const URL      = `http://localhost:${PORT}/`;

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** The pid we started, if it is still running. Clears a stale file. */
function running() {
  if (!existsSync(PID_FILE)) return null;
  const pid = Number(readFileSync(PID_FILE, "utf8").trim());
  if (!pid || !alive(pid)) { rmSync(PID_FILE, { force: true }); return null; }
  return pid;
}

/**
 * Something listening on the port — ours or not.
 *
 * BOTH stacks, because Vite binds `localhost`, which on macOS resolves to ::1
 * first: a probe of 127.0.0.1 alone reported a healthy server as dead, and
 * `dev:up` exited 1 on a start that had in fact worked.
 */
function portUp(port = PORT) {
  const probe = (host) => new Promise((resolve) => {
    const s = net.createConnection({ port, host });
    const done = (v) => { s.destroy(); resolve(v); };
    s.once("connect", () => done(true));
    s.once("error",   () => done(false));
    s.setTimeout(500, () => done(false));
  });
  return Promise.all([probe("127.0.0.1"), probe("::1")]).then(r => r.some(Boolean));
}

const waitFor = async (fn, tries, gapMs) => {
  for (let i = 0; i < tries; i++) {
    if (await fn()) return true;
    await new Promise(r => setTimeout(r, gapMs));
  }
  return false;
};

async function up() {
  const pid = running();
  if (pid) { console.log(`already running (pid ${pid})  →  ${URL}`); return; }

  // A port held by something that is NOT ours is a different problem, and
  // silently starting a second server that fails to bind is how the previous
  // setup produced "it opened, then it was gone".
  if (await portUp()) {
    console.error(`port ${PORT} is already in use by another process.\n` +
                  `  lsof -nP -iTCP:${PORT} -sTCP:LISTEN     # find it\n` +
                  `  PORT=5174 npm run dev:up                # or use another port`);
    process.exit(1);
  }

  mkdirSync(DIR, { recursive: true });
  const out = openSync(LOG_FILE, "a");
  const child = spawn(
    process.execPath,
    [join(ROOT, "node_modules", "vite", "bin", "vite.js"), "--port", String(PORT), "--strictPort"],
    { cwd: ROOT, detached: true, stdio: ["ignore", out, out] },
  );
  child.unref();
  writeFileSync(PID_FILE, String(child.pid));

  if (await waitFor(portUp, 40, 250)) console.log(`dev server up (pid ${child.pid})  →  ${URL}`);
  else {
    console.error(`started (pid ${child.pid}) but nothing is answering on ${PORT} yet.`);
    console.error(`  tail -n 40 ${LOG_FILE}`);
    process.exit(1);
  }
}

async function down() {
  const pid = running();
  if (pid) {
    // The whole group: vite spawns catalog-check-server, and killing only the
    // parent is what left orphans holding port 3333.
    try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch {} }
    await waitFor(async () => !alive(pid), 20, 100);
    if (alive(pid)) { try { process.kill(-pid, "SIGKILL"); } catch {} }
    rmSync(PID_FILE, { force: true });
    console.log(`stopped (pid ${pid})`);
  } else {
    console.log("not running");
  }
}

async function status() {
  const pid = running();
  const up  = await portUp();
  if (!pid && !up)  { console.log("down"); return; }
  if (!pid && up)   { console.log(`port ${PORT} is serving, but not from this daemon (no pid file)`); return; }
  const since = existsSync(PID_FILE) ? statSync(PID_FILE).mtime.toLocaleString() : "?";
  console.log(`up (pid ${pid}) since ${since}  →  ${URL}${up ? "" : "   [not answering yet]"}`);
}

const cmd = process.argv[2];
if      (cmd === "up")     await up();
else if (cmd === "down")   await down();
else if (cmd === "status") await status();
else if (cmd === "restart"){ await down(); await up(); }
else { console.error("usage: dev-daemon.mjs up|down|restart|status"); process.exit(2); }
