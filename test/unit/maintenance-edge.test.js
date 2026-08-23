// ═══════════════════════════════════════════════════════════════════
// EDGE MAINTENANCE GATE — functions/index.js, driven with a fake Pages context.
//
// This function sits in front of numap.app's homepage. Two things it must never
// do, and both are asserted here far more than the happy path:
//
//   1. serve a maintenance page at 200 (the SEO failure it exists to prevent);
//   2. fail closed. A missing schedule, an HTML body where JSON was expected, a
//      throwing ASSETS binding, a schedule full of garbage — every one of them
//      must serve the ordinary app.
//
// A Pages Function is a plain module with a `onRequest(context)` export and no
// Cloudflare-only imports, so the whole thing runs in Node against a stub
// `env.ASSETS` and a stub `next()`. That is the only reason these properties are
// checkable at all without a deploy — and they are exactly the properties a
// deploy is a bad place to discover.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../../functions/index.js";

const TEMPLATE =
  '<!DOCTYPE html><html><head><meta name="robots" content="noindex"></head>'
  + '<body><script>var INJECTED = "__NUMAP_MAINT__";</script></body></html>';

const APP = "<!DOCTYPE html><html><body>the app</body></html>";

/**
 * A fake Pages context.
 * @param {object} o
 * @param {object|string|null} o.schedule  what /maintenance.json answers with
 * @param {string} [o.url]
 * @param {string} [o.method]
 * @param {string} [o.cookie]
 * @param {boolean} [o.noTemplate]  /maintenance.html is missing
 * @param {boolean} [o.assetsThrow] the binding itself fails
 */
function ctx({ schedule, url = "https://numap.app/", method = "GET", cookie, noTemplate = false, assetsThrow = false }) {
  let nexted = 0;
  const env = {
    ASSETS: {
      async fetch(req) {
        if (assetsThrow) throw new Error("binding exploded");
        const p = new URL(req.url).pathname;
        if (p === "/maintenance.json") {
          if (schedule == null) return new Response("not found", { status: 404 });
          const body = typeof schedule === "string" ? schedule : JSON.stringify(schedule);
          return new Response(body, { status: 200 });
        }
        // Production serves the template at `/maintenance`; `/maintenance.html`
        // answers 308 there, because Pages normalises HTML URLs. Modelled
        // exactly, so the "template unreachable" fallback cannot come back.
        if (p === "/maintenance") {
          return noTemplate
            ? new Response("nope", { status: 404 })
            : new Response(TEMPLATE, { status: 200 });
        }
        if (p === "/maintenance.html") {
          return new Response(null, { status: 308, headers: { location: "/maintenance" } });
        }
        return new Response("?", { status: 404 });
      },
    },
  };
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  return {
    request: new Request(url, { method, headers }),
    env,
    next: async () => { nexted++; return new Response(APP, { status: 200, headers: { "content-type": "text/html" } }); },
    nexted: () => nexted,
  };
}

const now = Date.now();
const offline = (over = {}) => ({
  windows: [{
    id: "w", severity: "offline",
    start: new Date(now - 30 * 60e3).toISOString(),
    end: new Date(now + 90 * 60e3).toISOString(),
    kind: "deploy", ...over,
  }],
});

// ── The whole reason this file exists ───────────────────────────────

test("edge › an open offline window answers 503, never 200", async () => {
  const c = ctx({ schedule: offline() });
  const res = await onRequest(c);
  assert.equal(res.status, 503);
  assert.equal(c.nexted(), 0, "must not have served the app");

  // Retry-After in seconds, from the window's own end (≈90 min).
  const retry = Number(res.headers.get("retry-after"));
  assert.ok(Number.isInteger(retry), `retry-after not an integer: ${res.headers.get("retry-after")}`);
  assert.ok(retry > 5000 && retry <= 5400, `retry-after ${retry} should be ~5400s`);

  // Never cacheable. An edge copy outliving the window keeps serving "we're
  // down" after we are back — a scheduled window becoming an unscheduled outage.
  const cc = res.headers.get("cache-control") ?? "";
  assert.match(cc, /no-store/);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);

  // The window is handed to the page so it needs zero requests of its own.
  const body = await res.text();
  assert.doesNotMatch(body, /__NUMAP_MAINT__/, "the token should have been substituted");
  const injected = JSON.parse(/var INJECTED = (\{.*?\});/.exec(body)[1]);
  assert.equal(injected.end, Date.parse(offline().windows[0].end));
  assert.equal(injected.hardBlock, false);
});

test("edge › Retry-After never invites an immediate retry storm", async () => {
  // A window ending in one second would otherwise say `Retry-After: 1`.
  const res = await onRequest(ctx({ schedule: offline({ end: new Date(now + 900).toISOString() }) }));
  assert.equal(res.status, 503);
  assert.ok(Number(res.headers.get("retry-after")) >= 30);
});

test("edge › HEAD gets the status and no body", async () => {
  const res = await onRequest(ctx({ schedule: offline(), method: "HEAD" }));
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("retry-after") != null, true);
  assert.equal(await res.text(), "");
});

// ── Fail open ───────────────────────────────────────────────────────

test("edge › anything unreadable serves the app", async () => {
  const cases = {
    "no schedule at all": null,
    "the SPA shell (a 404 under the catch-all)": "<!DOCTYPE html><html>…",
    "invalid JSON": "{oops",
    "empty": "",
    "an array of nothing": [],
    "no windows key": { hello: "world" },
    "junk windows": { windows: [null, 3, "x", {}, { start: "???", end: "???" }] },
    "a window with no severity": { windows: [{ start: new Date(now - 1e3).toISOString(), end: new Date(now + 1e6).toISOString() }] },
  };
  for (const [why, schedule] of Object.entries(cases)) {
    const c = ctx({ schedule });
    const res = await onRequest(c);
    assert.equal(res.status, 200, why);
    assert.equal(c.nexted(), 1, why);
    assert.equal(await res.text(), APP, why);
  }
});

test("edge › a throwing ASSETS binding serves the app", async () => {
  const c = ctx({ schedule: offline(), assetsThrow: true });
  const res = await onRequest(c);
  assert.equal(res.status, 200);
  assert.equal(c.nexted(), 1);
});

test("edge › softer severities are served at 200, because the site is up", async () => {
  for (const severity of ["notice", "degraded", "OFFLINE", "offline "]) {
    const c = ctx({ schedule: offline({ severity }) });
    assert.equal((await onRequest(c)).status, 200, severity);
    assert.equal(c.nexted(), 1, severity);
  }
});

test("edge › a window outside its own times is served at 200", async () => {
  const past = offline({
    start: new Date(now - 3 * 3600e3).toISOString(),
    end: new Date(now - 3600e3).toISOString(),
  });
  assert.equal((await onRequest(ctx({ schedule: past }))).status, 200, "already over");
  const future = offline({
    start: new Date(now + 3600e3).toISOString(),
    end: new Date(now + 2 * 3600e3).toISOString(),
  });
  assert.equal((await onRequest(ctx({ schedule: future }))).status, 200, "not yet");
});

test("edge › an implausibly long offline window cannot lock the site out", async () => {
  // The hand-copied MAX_OFFLINE_HOURS cap. A wrong year at the edge is worse
  // than in the app, because nobody can click past it.
  const typo = offline({ end: new Date(now + 400 * 24 * 3600e3).toISOString() });
  const c = ctx({ schedule: typo });
  assert.equal((await onRequest(c)).status, 200);
  assert.equal(c.nexted(), 1);
});

test("edge › non-GET requests are somebody else's business", async () => {
  for (const method of ["POST", "PUT", "OPTIONS", "DELETE"]) {
    const c = ctx({ schedule: offline(), method });
    assert.equal((await onRequest(c)).status, 200, method);
  }
});

// ── Graceful degradation ────────────────────────────────────────────

test("edge › ?nomaint=1 passes through and remembers", async () => {
  const c = ctx({ schedule: offline(), url: "https://numap.app/?nomaint=1" });
  const res = await onRequest(c);
  assert.equal(res.status, 200);
  assert.equal(c.nexted(), 1);
  const cookie = res.headers.get("set-cookie") ?? "";
  assert.match(cookie, /numap_nomaint=1/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /SameSite=Lax/);
});

test("edge › the cookie alone is enough on later requests", async () => {
  const c = ctx({ schedule: offline(), cookie: "theme=dark; numap_nomaint=1" });
  assert.equal((await onRequest(c)).status, 200);
  assert.equal(c.nexted(), 1);
  // The cookie is PARSED, not substring-matched. Each of these contains the
  // bypass name as a substring and none of them is the bypass cookie; the first
  // version of this check accepted all three.
  for (const bad of [
    "numap_nomaintenance=1",
    "x_numap_nomaint=1",
    "other=numap_nomaint=1",
    "numap_nomaint=0",
    "numap_nomaint=",
  ]) {
    const d = ctx({ schedule: offline(), cookie: bad });
    assert.equal((await onRequest(d)).status, 503, `should not open the door: ${bad}`);
  }
  // …and the real thing works in any position, with or without spaces.
  for (const good of ["numap_nomaint=1", " numap_nomaint=1 ", "a=b;numap_nomaint=1;c=d"]) {
    const d = ctx({ schedule: offline(), cookie: good });
    assert.equal((await onRequest(d)).status, 200, good);
  }
});

test("edge › hardBlock refuses even an explicit ask", async () => {
  for (const url of ["https://numap.app/", "https://numap.app/?nomaint=1"]) {
    const c = ctx({ schedule: offline({ hardBlock: true }), url, cookie: "numap_nomaint=1" });
    const res = await onRequest(c);
    // `?nomaint=1` is honoured before the schedule is read, by design — it is a
    // deliberate escape hatch for us as much as for a visitor. The COOKIE path
    // is the one hardBlock closes, which is what stops a stale cookie from a
    // previous window carrying somebody into a migration.
    if (url.includes("nomaint")) assert.equal(res.status, 200, "explicit ask still wins");
    else assert.equal(res.status, 503, "a leftover cookie must not");
  }
});

// ── The template ────────────────────────────────────────────────────

test("edge › a missing template still answers 503, with a usable body", async () => {
  const res = await onRequest(ctx({ schedule: offline(), noTemplate: true }));
  assert.equal(res.status, 503, "the status is the part that must not be lost");
  const body = await res.text();
  assert.match(body, /maintenance/i);
  assert.match(body, /noindex/, "the stand-in must not be indexable either");
  assert.match(body, /nomaint=1/, "and must still let a person through");
});
