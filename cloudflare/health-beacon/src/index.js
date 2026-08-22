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
// ── Counters are written through, and here is the bug that proved why ──
//
// The first version of this file buffered counts in memory and flushed them on a
// 30-second alarm, to turn thousands of storage writes into one. The trade was
// written down as "a shard evicted before its alarm loses up to 30 seconds of
// counts", and that sounded modest enough to accept.
//
// It was wrong, and measurably so: deployed to production, six beacons all
// returned 204 and `/stats` reported zero. A Durable Object is evicted quickly
// when idle, and `this.pending` is a plain in-memory Map — so at low traffic the
// object was ALWAYS evicted between the one increment and the alarm, the alarm
// woke a fresh instance whose `pending` was empty, and it persisted nothing.
//
// The buffer does not lose "up to 30 seconds". It loses EVERYTHING until traffic
// is continuous enough to keep the object resident — which is exactly the
// traffic this project does not have, and exactly the situation the beacon was
// built to observe. An optimisation whose correctness depends on the load being
// high is worthless on a system whose problem is that the load is low.
//
// So: read-modify-write to durable storage on every increment. Durable Object
// fetch handlers are serialised per object by the runtime's input gate, so the
// read-modify-write is atomic without any locking of ours. It costs one storage
// round trip per beacon, which at any traffic this project will see is nothing —
// and unlike the buffer, it is correct at zero traffic as well as at high.
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

/**
 * How many distinct builds each shard keeps counters for.
 *
 * 48 is roughly a fortnight of deploys at this project's rate — enough to
 * compare a bad release against the several before it, which is the only
 * question the history is for.
 */
const KEEP_BUILDS = 48;

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
      //
      // The catch logs rather than swallowing. It used to be `.catch(() => {})`,
      // which is right for the CLIENT — a beacon must never surface an error to
      // a page — but it also meant a completely broken storage path answered 204
      // exactly like a working one. When the counters silently discarded
      // everything, there was no signal anywhere: 204s going out, zeroes coming
      // back, nothing in between. console.error at least reaches `wrangler tail`.
      ctx.waitUntil(
        env.BEACONS
          .get(env.BEACONS.idFromName(`shard-${Math.floor(Math.random() * SHARDS)}`))
          .fetch("https://do/inc", { method: "POST", body: JSON.stringify(payload) })
          .then((r) => {
            if (!r.ok) console.error(`beacon shard rejected an increment: HTTP ${r.status}`);
          })
          .catch((err) => console.error(`beacon shard unreachable: ${err?.message ?? err}`)),
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
    // The sampling rates live in src/core/healthBeacon.js and are 1.0 / 1.0
    // today, so these are visit counts. They will not stay that way: the
    // contract test forces them down as traffic grows, and at that point ok and
    // fail are scaled differently and stop being directly comparable. Saying so
    // here rather than in a doc, because this JSON is what someone reads at 2am.
    note: "Counts are SAMPLED. While the two rates are equal these are also visit "
        + "counts; once they diverge, compare rates within a class rather than "
        + "counts across classes. Current rates: see SAMPLE in src/core/healthBeacon.js.",
    byBuild, byOutcome, byPhase, byEngine, byBucket,
  };
}

/**
 * One shard. Counters are written through to durable storage on every
 * increment — see the header for the buffered version that came before and why
 * it silently discarded everything.
 */
export class BeaconShard {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    // No in-memory accumulator. See the header: one used to live here and it
    // silently discarded every count at low traffic. `loaded` is only a
    // read-through cache of durable state, valid for as long as this instance
    // is resident, and losing it costs nothing but a re-read.
    this.loaded = null;
  }

  /** Durable counts, read once per wake and kept in step with every write. */
  async durable() {
    this.loaded ??= (await this.ctx.storage.get("counts")) ?? {};
    return this.loaded;
  }

  async fetch(request) {
    const { pathname } = new URL(request.url);

    if (pathname === "/inc") {
      let p;
      try { p = await request.json(); } catch { return new Response(null, { status: 204 }); }

      // Read-modify-write, durably, now. The runtime serialises fetch handlers
      // per object, so no two increments interleave and this needs no locking.
      const counts = await this.durable();
      const k = keyOf(p);
      counts[k] = (counts[k] ?? 0) + 1;
      this.prune(counts);
      this.loaded = counts;
      await this.ctx.storage.put("counts", counts);

      return new Response(null, { status: 204 });
    }

    if (pathname === "/dump") {
      return new Response(JSON.stringify({ counts: await this.durable() }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(null, { status: 404 });
  }

  /**
   * Bound what is kept.
   *
   * Without this the counter map grows one entry per
   * (build × outcome × phase × engine × bucket) forever, and "forever" on a
   * project that deploys often is a leak with a slow fuse. Keeping the most
   * recent builds is the right cut: an old build's failure rate is history, and
   * history that costs a read and a write on every beacon is not worth its price.
   *
   * Keys carry no timestamp — deliberately, the client sends no clock — so
   * "recent" is approximated by insertion order, which object key order
   * preserves for non-numeric string keys. Approximate is fine; the requirement
   * is boundedness, not exactness.
   */
  prune(counts) {
    const builds = [...new Set(Object.keys(counts).map((k) => k.split("|")[0]))];
    if (builds.length <= KEEP_BUILDS) return;
    const keep = new Set(builds.slice(-KEEP_BUILDS));
    for (const k of Object.keys(counts)) {
      if (!keep.has(k.split("|")[0])) delete counts[k];
    }
  }
}
