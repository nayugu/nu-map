// NU Map — Copyright (C) 2025-2026 Nathan Gu and Matthew Gu
// SPDX-License-Identifier: AGPL-3.0-only
// AGPL-3.0-only + attribution term under §7(b); see LICENSING.md and NOTICE.
//
// ═══════════════════════════════════════════════════════════════════
// HEALTH BEACON RECEIVER
//
//   POST /b        one boot outcome (see src/core/healthBeacon.js)
//   GET  /stats    the aggregate, fanned in across shards
//   GET  /health   is this worker itself alive
//
// ── Why this is its own Worker ──────────────────────────────────────
//
// It would be less work to add two routes to numap-mcp. That would also make
// the health reporter depend on the health of the thing it most needs to report
// on: numap-mcp's `getQuery` retains ~60 MB in a 128 MB isolate and re-pulls
// ~23 MB on every cold start, so "the MCP worker is struggling" is a state this
// receiver has to survive, not share. Separate Worker, separate isolate, no data
// dependencies, nothing imported that can be slow.
//
// ── Sharding, and the mistake it is copied from ─────────────────────
//
// ShareBoxDO in cloudflare/mcp-server addresses itself with idFromName("global").
// One instance, single-threaded, a documented soft cap of 1,000 requests per
// second, pinned to whichever colo created it, and an O(n) storage.list() on
// every write. It has never been a problem at five users and it is the first
// thing that falls over at ten thousand.
//
// This receiver takes the opposite default: SHARDS independent Durable Objects,
// picked uniformly at random per beacon. Random rather than hashed because there
// is no key to hash — beacons carry no identifier, by design — and because
// counters commute, so which shard a beacon lands in genuinely does not matter.
// Reads fan in across all of them.
//
// The number is 16 for an unglamorous reason: 16 × 1,000 req/s is 16,000/s,
// which is comfortably past the stated peak of 10,000 users in a minute (~167/s
// even if every one of them beaconed unsampled), and every extra shard costs a
// subrequest on the READ path, which is the path with a 50-subrequest budget on
// the free plan. More shards would buy throughput nobody needs and spend a
// budget that is genuinely tight.
//
// ── Why counters live in memory between flushes ─────────────────────
//
// A storage write per beacon would be the real cost here — far more than the
// request itself. Each shard accumulates in memory and flushes to durable
// storage on a 30-second alarm, which turns thousands of writes into one.
//
// The trade, stated plainly: a shard evicted before its alarm loses up to 30
// seconds of counts. That is the right trade for this data and the wrong one for
// almost anything else. These are health statistics read as rates — losing a
// bounded, unbiased sample of them changes no decision anyone would make. If
// this file is ever reused to count something where each event matters
// individually, this is the paragraph to come back and delete.
// ═══════════════════════════════════════════════════════════════════

const SHARDS = 16;

/**
 * Mirrors src/core/healthBeacon.js. Duplicated deliberately — see validate().
 * Exported so test/contract/health-beacon-privacy.test.js can assert the two
 * copies have not drifted apart, which is the one real cost of duplicating them.
 */
export const OUTCOMES = new Set([
  "ok", "shell-only", "chunk-dead", "catalog-failed",
  "render-crash", "storage-full", "storage-blocked", "unknown",
]);
export const PHASES = new Set(["shell", "bundle", "data", "mount"]);
export const ENGINES = new Set(["chromium", "webkit", "gecko", "other"]);
export const MS_BUCKETS = new Set([500, 1000, 2000, 3000, 5000, 8000, 15000, "15000+", null]);

/** Bodies above this are not a beacon. A valid one is under 100 bytes. */
const MAX_BODY = 512;

/** Hours of history each shard keeps. 48 so a Monday can be compared with a Sunday. */
const KEEP_HOURS = 48;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

/**
 * Re-validate the payload against the same closed vocabularies the browser used.
 *
 * The duplication with src/core/healthBeacon.js is intentional and is the point:
 * this Worker must not trust a client to have run our code. Anything can POST
 * here. If the enums were imported from a shared module the check would still be
 * correct, but the reason it exists would be easy to mistake for tidiness and
 * someone would eventually "simplify" it into trusting the input.
 *
 * Unknown keys are DROPPED rather than rejected, so a newer client sending a
 * field this deploy has not learned about still gets its outcome counted. The
 * value of a beacon is the outcome; a strict-reject here would silently blind
 * the receiver for the whole window between two deploys.
 *
 * @returns {{v:number,o:string,p:string,ms:*,b:string|null,e:string}|null}
 */
export function validate(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (raw.v !== 1) return null;
  if (!OUTCOMES.has(raw.o)) return null;
  if (!PHASES.has(raw.p)) return null;
  if (!ENGINES.has(raw.e)) return null;
  if (!MS_BUCKETS.has(raw.ms === undefined ? null : raw.ms)) return null;
  // The one free-ish field. Constrained to the shape Vite emits, and length-capped,
  // because it becomes part of a storage key and unbounded keys are how a counter
  // map becomes a memory leak an attacker controls.
  const b = typeof raw.b === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(raw.b) ? raw.b : null;
  return { v: 1, o: raw.o, p: raw.p, ms: raw.ms ?? null, b, e: raw.e };
}

/** The counter key. Bounded cardinality: 8 outcomes × 4 phases × 4 engines × builds. */
const keyOf = (p) => `${p.b ?? "-"}|${p.o}|${p.p}|${p.e}|${p.ms ?? "-"}`;

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const { pathname } = new URL(request.url);

    if (pathname === "/health") return json({ ok: true, shards: SHARDS });

    if (pathname === "/b" && request.method === "POST") {
      // Read with a cap. `request.text()` on an unbounded body is a way to be
      // handed a large allocation by anyone who wants to.
      const len = Number(request.headers.get("content-length") ?? "0");
      if (len > MAX_BODY) return new Response(null, { status: 204, headers: CORS });

      let payload = null;
      try {
        const text = await request.text();
        if (text.length > MAX_BODY) return new Response(null, { status: 204, headers: CORS });
        payload = validate(JSON.parse(text));
      } catch { payload = null; }

      // 204 whether or not it was valid, and whether or not it was stored.
      // A beacon endpoint that reports its own errors teaches a scanner the
      // shape of a valid payload, and there is no client-side error handling
      // for it to feed anyway — src/data/healthReporter.js never reads the
      // response.
      if (!payload) return new Response(null, { status: 204, headers: CORS });

      // waitUntil, so the response returns before the DO round trip. The client
      // is not waiting on this, and neither should the request.
      ctx.waitUntil(
        env.BEACONS
          .get(env.BEACONS.idFromName(`shard-${Math.floor(Math.random() * SHARDS)}`))
          .fetch("https://do/inc", { method: "POST", body: JSON.stringify(payload) })
          .catch(() => {}),
      );
      return new Response(null, { status: 204, headers: CORS });
    }

    if (pathname === "/stats" && request.method === "GET") {
      // Aggregate and non-identifying, but still gated: an open stats endpoint
      // is free reconnaissance on deploy timing and failure rates, and it is a
      // fan-out of SHARDS subrequests that anyone could trigger in a loop.
      if (env.STATS_TOKEN && request.headers.get("Authorization") !== `Bearer ${env.STATS_TOKEN}`) {
        return json({ error: "Unauthorized" }, 401);
      }
      const parts = await Promise.all(
        Array.from({ length: SHARDS }, (_, i) =>
          env.BEACONS
            .get(env.BEACONS.idFromName(`shard-${i}`))
            .fetch("https://do/dump")
            .then((r) => r.json())
            .catch(() => ({ counts: {} })),
        ),
      );
      const counts = {};
      for (const part of parts) {
        for (const [k, n] of Object.entries(part.counts ?? {})) counts[k] = (counts[k] ?? 0) + n;
      }
      return json(summarize(counts));
    }

    return json({ error: "Not found" }, 404);
  },
};

/**
 * Turn raw counter keys into the two things a person actually wants to know:
 * the boot-success rate, and whether any single build is responsible for the
 * failures.
 *
 * The per-build breakdown is the whole reason `b` is collected. A global
 * success rate of 96% tells you something is wrong; the same number split by
 * build tells you which deploy to roll back, which is the difference between
 * an alert and a fix.
 */
function summarize(counts) {
  let ok = 0, fail = 0;
  const byOutcome = {}, byBuild = {}, byEngine = {}, byPhase = {}, byBucket = {};
  for (const [k, n] of Object.entries(counts)) {
    const [b, o, p, e, ms] = k.split("|");
    (o === "ok" ? (ok += n) : (fail += n));
    byOutcome[o] = (byOutcome[o] ?? 0) + n;
    byPhase[p] = (byPhase[p] ?? 0) + n;
    byEngine[e] = (byEngine[e] ?? 0) + n;
    byBucket[ms] = (byBucket[ms] ?? 0) + n;
    byBuild[b] ??= { ok: 0, fail: 0 };
    byBuild[b][o === "ok" ? "ok" : "fail"] += n;
  }
  // Rates are reported alongside raw counts, never instead of them: a 100%
  // failure rate over three samples and over three thousand are different
  // situations and a bare percentage cannot tell them apart.
  const rate = (a, b) => (a + b > 0 ? +((100 * a) / (a + b)).toFixed(2) : null);
  for (const b of Object.values(byBuild)) b.successRate = rate(b.ok, b.fail);
  return {
    sampled: { ok, fail, total: ok + fail },
    successRate: rate(ok, fail),
    note: "Successes are sampled at 2%, failures at 25% — these are SAMPLE counts, "
        + "not visit counts, and the two classes are not directly comparable. "
        + "Compare rates within a class, or scale by 12.5 to put failures on the ok scale.",
    byBuild, byOutcome, byPhase, byEngine, byBucket,
  };
}

/**
 * One shard. Holds counters in memory and flushes them on a 30-second alarm.
 */
export class BeaconShard {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    /** @type {Map<string, number>} unflushed counts */
    this.pending = new Map();
    this.loaded = null;
  }

  /** Durable counts, loaded once per wake. */
  async durable() {
    this.loaded ??= (await this.ctx.storage.get("counts")) ?? {};
    return this.loaded;
  }

  async fetch(request) {
    const { pathname } = new URL(request.url);

    if (pathname === "/inc") {
      let p;
      try { p = await request.json(); } catch { return new Response(null, { status: 204 }); }
      const k = `${keyOf(p)}`;
      this.pending.set(k, (this.pending.get(k) ?? 0) + 1);
      // Arm the flush if it is not already armed. Checking first matters: an
      // unconditional setAlarm on every beacon would reschedule the flush
      // forward on each one, so a shard under continuous load would never
      // flush at all — the classic self-postponing alarm.
      if ((await this.ctx.storage.getAlarm()) === null) {
        await this.ctx.storage.setAlarm(Date.now() + 30_000);
      }
      return new Response(null, { status: 204 });
    }

    if (pathname === "/dump") {
      // Durable plus not-yet-flushed, so a read is never 30 seconds stale.
      const merged = { ...(await this.durable()) };
      for (const [k, n] of this.pending) merged[k] = (merged[k] ?? 0) + n;
      return new Response(JSON.stringify({ counts: merged }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(null, { status: 404 });
  }

  async alarm() {
    if (this.pending.size === 0) return;
    const counts = await this.durable();
    for (const [k, n] of this.pending) counts[k] = (counts[k] ?? 0) + n;
    this.pending.clear();

    // Bound what is kept. Without this the counter map grows one entry per
    // (build × outcome × phase × engine × bucket) forever, and "forever" on a
    // project that deploys often is a leak with a slow fuse. Keeping the most
    // recent builds is the right cut: an old build's failure rate is history,
    // and history that costs memory on every wake is not worth its price.
    const builds = [...new Set(Object.keys(counts).map((k) => k.split("|")[0]))];
    if (builds.length > KEEP_HOURS) {
      // Keys carry no timestamp — deliberately, the client sends no clock — so
      // "recent" is approximated by insertion order, which object key order
      // preserves for non-numeric string keys. Approximate is fine here; the
      // requirement is boundedness, not exactness.
      const keep = new Set(builds.slice(-KEEP_HOURS));
      for (const k of Object.keys(counts)) {
        if (!keep.has(k.split("|")[0])) delete counts[k];
      }
    }

    this.loaded = counts;
    await this.ctx.storage.put("counts", counts);
  }
}
