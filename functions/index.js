// ═══════════════════════════════════════════════════════════════════
// EDGE MAINTENANCE GATE — Cloudflare Pages Function on "/" only.
//
// The in-app overlay (src/ui/MaintenancePage.jsx) handles a visitor whose
// browser already has the app. This handles everyone else, and it exists for one
// reason the overlay cannot cover: HTTP STATUS.
//
// A maintenance page served at 200 tells Google that the maintenance page IS
// numap.app's content. Do that for a few hours and the indexed snippet becomes
// "Under maintenance"; do it while a crawl is deep and pages start dropping out.
// The correct answer is 503 Service Unavailable plus `Retry-After`, which every
// major crawler treats as "come back later, keep what you have". Neither
// `_headers` nor `_redirects` can express a status other than 200/3xx on Pages,
// so a Function is the only way to say it — this one.
//
// ── Why this file, and only this file ───────────────────────────────
//
// `functions/_middleware.js` would run on EVERY request, including every hashed
// asset. That is a Worker invocation per asset on the free tier, which is
// exactly the cost `public/_headers` documents refusing for /assets/*. This is a
// ROUTE function on `/`, so it runs once per document request and never for an
// asset — and `/` is the whole app: there is no path routing and no pushState
// anywhere in src/, so every visitor and every crawler arrives here.
//
// ── Fail open, on every path ────────────────────────────────────────
//
// This function sits in front of the homepage. If it can throw, it can take the
// site down harder than any maintenance window would, so every branch — a
// missing schedule, malformed JSON, a subrequest that fails, an unreadable
// template — ends in `next()`, which serves the ordinary app. The only way to
// get a 503 out of here is a schedule that positively says so.
//
// ── Graceful degradation is a query parameter ───────────────────────
//
// `?nomaint=1` passes through and sets a short-lived cookie. That is not a
// backdoor, it is the point: NU Map's plans live in the visitor's own
// localStorage and its catalog is a static JSON, so the app works perfectly
// while we are working on the deployment. A crawler gets the honest 503; a
// student who wants their degree plan gets their degree plan. `hardBlock` is the
// one case that refuses even this — a storage migration, where an edit made now
// would be written into a schema about to be replaced.
// ═══════════════════════════════════════════════════════════════════

import { resolveMaintenance } from "../src/core/maintenance.js";

/** Query parameter and cookie that let a human through. */
const BYPASS = "nomaint";
const BYPASS_COOKIE = "numap_nomaint";
/** Long enough to outlast a window, short enough not to linger for weeks. */
const BYPASS_MAX_AGE = 12 * 3600;

/** Where the template's injection point is. Must match public/maintenance.html. */
const TOKEN = '"__NUMAP_MAINT__"';

/**
 * Is the bypass cookie set?
 *
 * Parsed rather than substring-matched. `header.includes("numap_nomaint=1")` was
 * the first version and it also accepts a cookie called `x_numap_nomaint`, which
 * is a door opened by a name nobody audited. Cheap to do properly.
 * @param {string} header
 */
function hasBypassCookie(header) {
  return String(header || "").split(";").some((part) => {
    const [name, ...rest] = part.split("=");
    return name.trim() === BYPASS_COOKIE && rest.join("=").trim() === "1";
  });
}

/**
 * The one window that closes the door, or null.
 *
 * Uses `resolveMaintenance` — the SAME pure function the app runs, imported
 * rather than reimplemented. This started life as a hand-copied subset with its
 * own duplicated `MAX_OFFLINE_HOURS`, on the assumption that a Pages Function
 * cannot reach `src/`. It can: `cloudflare/mcp-server` has imported across that
 * boundary all along, and wrangler bundles this the same way. So the duplicate
 * is gone, along with the drift it was guaranteed to develop — the edge and the
 * browser now cap, demote and adjudicate windows identically, by construction.
 *
 * Only `blocking` is consulted. Everything softer than an in-window `offline`
 * (a notice, a degraded feature) is served the ordinary app at 200, which is
 * the truth: the site is up.
 *
 * @param {any} env @param {URL} url
 */
async function shutWindow(env, url) {
  let cfg = null;
  try {
    const req = new Request(new URL("/maintenance.json", url).toString(), {
      // A static asset on this same edge — not an API, and not the app. This is
      // the only network read in the whole path, and a failure means "no
      // maintenance", never an error page.
      headers: { "accept": "application/json" },
    });
    const res = env?.ASSETS?.fetch ? await env.ASSETS.fetch(req) : await fetch(req);
    if (!res || !res.ok) return null;
    const text = await res.text();
    // Under the SPA catch-all a missing file answers with index.html at 200 —
    // see public/_headers. So the body is checked, not the status.
    if (!text || text.trimStart().startsWith("<")) return null;
    cfg = JSON.parse(text);
  } catch { return null; }

  try {
    const state = resolveMaintenance(cfg, Date.now());
    if (!state.blocking) return null;
    return {
      start: state.window.start,
      end: state.window.end,
      // What `Retry-After` quotes: the forecast while it holds, the deadline
      // once it does not.
      retryAt: state.overrunning ? state.window.end : (state.window.expectedEnd ?? state.window.end),
      expectedEnd: state.window.expectedEnd,
      overrunning: state.overrunning,
      hardBlock: state.hardBlock,
      kind: state.kind,
    };
  } catch { return null; }
}

/**
 * The 503 itself.
 * @param {any} env @param {URL} url @param {{start:number,end:number,hardBlock:boolean,kind:string}} w
 * @param {boolean} bodyless HEAD request
 */
async function maintenanceResponse(env, url, w, bodyless) {
  const headers = {
    "content-type": "text/html; charset=utf-8",
    // Seconds, per RFC 9110. A crawler reads this as "ask again then" and keeps
    // the pages it already has. Quoted from the FORECAST, not the deadline —
    // being asked back sooner than necessary costs a crawler one extra request,
    // whereas quoting a generous deadline keeps us out of the index for the
    // whole of it. Floored at 30 so a window about to end does not invite an
    // immediate retry storm.
    "retry-after": String(Math.max(30, Math.ceil((w.retryAt - Date.now()) / 1000))),
    // NEVER cache a maintenance page. An edge or browser copy would outlive the
    // window and keep serving "we're down" after we are back — the one failure
    // that turns a scheduled 2-hour window into an unscheduled outage, and the
    // hardest to diagnose because the origin is fine.
    "cache-control": "no-store, no-cache, must-revalidate",
    // The app's own recovery screens key off nothing here, but a human reading
    // curl output should be able to tell this apart from a real 503.
    "x-numap-maintenance": w.kind,
  };
  if (bodyless) return new Response(null, { status: 503, headers });

  let html = "";
  try {
    const req = new Request(new URL("/maintenance.html", url).toString());
    const res = env?.ASSETS?.fetch ? await env.ASSETS.fetch(req) : await fetch(req);
    if (res && res.ok) html = await res.text();
  } catch { /* handled below */ }

  // If the template is unreachable there is still a duty to answer with the
  // right STATUS, so a plain built-in body stands in. It is deliberately ugly:
  // seeing it means the deployment is missing a file we shipped.
  if (!html || !html.includes(TOKEN)) {
    if (!html) {
      html = "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        + "<meta name=\"robots\" content=\"noindex\"><title>NU Map — Under maintenance</title></head>"
        + "<body style=\"font-family:system-ui,sans-serif;text-align:center;padding:15vh 24px\">"
        + "<h1 style=\"font-size:18px\">NU Map is under maintenance</h1>"
        + "<p style=\"font-size:13px;color:#64748b\">Your plans are saved in this browser, not on our servers.</p>"
        + "<p style=\"font-size:13px\"><a href=\"/?nomaint=1\" rel=\"nofollow\">Continue anyway</a></p>"
        + "</body></html>";
    }
    return new Response(html, { status: 503, headers });
  }

  // Tier 1 of the page's ETA: hand it the window so it makes zero requests.
  // JSON.stringify keeps this injection-safe — the values are numbers, a
  // boolean and a string from a closed vocabulary, and `</script>` cannot
  // appear in any of them.
  const payload = JSON.stringify({
    end: w.end, start: w.start, expectedEnd: w.expectedEnd,
    overrunning: w.overrunning, hardBlock: w.hardBlock, kind: w.kind,
  });
  return new Response(html.replace(TOKEN, payload), { status: 503, headers });
}

export async function onRequest(context) {
  const { request, env, next } = context;
  try {
    // Anything that is not a plain document read is somebody else's business.
    if (request.method !== "GET" && request.method !== "HEAD") return next();

    const url = new URL(request.url);

    // An explicit ask, from the maintenance page's own link. Remembered in a
    // cookie so a reload — or a share link opened later in the window — does
    // not put the wall back in front of somebody who already decided.
    if (url.searchParams.get(BYPASS) === "1") {
      const res = await next();
      const out = new Response(res.body, res);
      out.headers.append(
        "set-cookie",
        `${BYPASS_COOKIE}=1; Path=/; Max-Age=${BYPASS_MAX_AGE}; SameSite=Lax`,
      );
      return out;
    }

    const w = await shutWindow(env, url);
    if (!w) return next();

    if (!w.hardBlock && hasBypassCookie(request.headers.get("cookie"))) return next();

    return await maintenanceResponse(env, url, w, request.method === "HEAD");
  } catch {
    // See the header comment: this function is in front of the homepage, so an
    // unexpected failure here must be indistinguishable from this file not
    // existing.
    return next();
  }
}
