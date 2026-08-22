# Scalability — what runs out first

Target: **10,000 users inside one minute** at peak, millions of requests a year.
Measured baseline: about five users, infrequently.

Everything here was measured on 2026-08-22 with `scripts/load-probe.js`, against
`dist/` and against production. Re-run it rather than trusting these numbers —
that is what it is for, and three of the five figures below move on their own
every time the monthly scrape lands.

---

## The short version

The architecture is already the right one for this load. NU Map is a static SPA
on Cloudflare Pages with no origin server, no database and no accounts, so the
10,000-users-in-a-minute case is served almost entirely by a CDN. The CDN is not
what breaks.

What breaks is everything that is *not* a static file, plus three hard platform
walls that fail a **deploy** rather than a request — which is the worst way to
find out, because the site does not get slower, it stops updating.

| Wall | Measured | Limit | Consumed |
|---|---|---|---|
| Pages files per site | 15,964 | 20,000 (free) · 100,000 (paid) | **80%** |
| Largest single asset | 22.48 MiB | 25 MiB (**all plans**) | **90%** |
| MCP worker isolate heap | 60.6 MB | 128 MB per isolate | **47%** |
| MCP worker cold start | ~197 ms CPU, ~23 MB fan-out | 10 ms CPU (free) | see below |
| ShareBoxDO | one instance, `idFromName("global")` | 1,000 req/s soft, single-threaded | one instance |

And the thing that is not a wall at all but matters more than any of them:

> **There is no telemetry of any kind.** No error reporting, no RUM, no
> analytics. On 2026-08-20 a `const` read before its initializer threw on every
> render; every visitor got the recovery screen while 2,018 unit + 93 contract +
> 254 invariant tests passed, `verify-chart` was green at 794 plans, and `/`, the
> bundle and every JSON asset returned HTTP 200. It was found because someone
> looked. At 10,000 users that is not a detection strategy.

---

## What a visit actually costs

Blocking payload is exactly what `courseCatalog.fetchAll()` awaits, because that
one call is the only thing gating `loading` in `PlannerContext`.

```
                                          raw     brotli q11    on the wire
northeastern/catalog-courses.json       5,066K       696K          958K
northeastern/offering-summary.json      1,633K       193K          286K
northeastern/ratemyhusky.json             179K        44K           58K
northeastern/term-history.json          1,332K        25K           46K
assets/index-<hash>.js                  2,022K       417K             —
(+ subjects, subject-colleges, coop)
                                      ---------------------------------
                                       10,251K     1,377K        1,373K
```

At 10,000 cold visits in a minute that is **~13 GB, or 1.9 Gbit/s sustained,
across ~90,000 requests**. Cloudflare's edge does that without noticing. The cost
is not borne by us; it is borne by the student on campus wifi waiting for 1.4 MB.

### Two thirds of it is one field

```
description   3,309K   65.6%       <- rendered for ONE course at a time
prereqs         506K   10.0%
title           301K    6.0%
scheduleType    196K    3.9%
...

descriptions alone, brotli q11:  577K
everything else, brotli q11:      97K
```

`courseNorm.js` does parse descriptions at load, for a prereq fallback, a
repeatability fallback and a GPA gate. But its own comment records that the
prereq fallback covers **33 courses**, and `repeatable`/`minGPA` now arrive as
real scraped fields, so those parses are precomputable at build time. Splitting
descriptions into a separately-fetched asset would take the dominant blocking
asset from 696K to 97K brotli.

Not yet done — it touches the scrape output and `courseNorm`, so it wants its own
change and its own before/after (`load-probe.js --diff`).

### The edge compresses worse than the build could

```
catalog-courses.json   edge serves 958K   (on-the-fly brotli, low quality)
                       brotli q11  696K   (build-time pre-compress)
                       every visitor pays 262K more than they need to — 37.6%
```

On-the-fly compression cannot afford quality 11; a build step can. This is free
bytes, paid by every visitor on every cold load.

### Nothing is cached, including for returning visitors

All nine blocking assets answer `cache-control: no-cache` and
`cf-cache-status: DYNAMIC`. The `no-cache` comes from the `/*` catch-all in
`public/_headers`, which exists for an excellent and well-documented reason — a
stale HTML shell referencing a deleted chunk hash freezes the page — but it is a
catch-all, so it also lands on ~8 MB of JSON that changes **monthly**.

The data assets are unhashed, so they cannot simply be made `immutable`: there
would be no way to bust them. The fix is a manifest — hash the data filenames the
way `assets/` already are, keep one small unhashed pointer file — at which point a
returning visitor pays one request instead of nine.

---

## The walls, in the order they will be hit

### 1. Pages file count — 15,964 / 20,000

14,406 of those files are the generated AI data export under `dist/data/**`:
8,197 course pages, 3,793 professor pages, 1,329 JSON, plus programs. It grows
with the catalog, which grows every month, unattended.

The failure mode is a **rejected deployment**. The site keeps serving the last
good build and simply stops receiving updates — including data updates from the
monthly scrape.

Three ways out, none yet taken:
- **Upgrade Pages to paid** — the limit becomes 100,000 and this stops being a
  question for years. Cheapest by far in engineering time.
- **Serve `/data/**` from a Worker**, rendering pages on demand from the JSON
  already deployed. Removes 14,406 files. Costs a Worker invocation per AI
  fetch, against a 100,000/day free budget — and these URLs exist specifically
  to be crawled, so that budget is the wrong shape.
- **Drop the per-professor pages** (3,793 files) and keep courses. Smallest win,
  loses real product surface.

### 2. Largest asset — 22.48 / 25 MiB, and it is dead weight

`public/ort/ort-wasm-simd-threaded.asyncify.wasm` is 22.48 MiB, 90% of a
per-file limit that **no paid plan lifts**. It is copied into every build by
`scripts/copy-ort-wasm.js` for `src/workers/translation.worker.js`, which is
loaded only by `TransformersJsEngine` — and that engine is *commented out* of the
cascade in `TranslationContext.jsx`. The live chain is Chrome AI → Google →
MyMemory.

So 35 MB of `dist/` (`ort/`, both wasm files) ships on every deploy for a code
path nothing takes, and one of those files is one dependency bump away from
failing the deploy outright. Removing it also drops the file count.

### 3. The MCP worker re-reads the whole dataset on every cold isolate

`loadData.js` fetches eight JSON assets — ~23 MB — parses them, normalizes 7,966
courses and caches the result in a module-global promise. Measured locally:

```
after JSON.parse of 7 assets      heap 51.1 MB     79 ms
after normalize (7,966 courses)   heap 60.6 MB    109 ms
after createPlannerQuery          heap 60.6 MB    total 197 ms
```

**60.6 MB retained, in a 128 MB isolate, before serving a single request.** An
MCP call then allocates on top of that.

The cold ratio was measured twice on production, minutes apart, and the two runs
disagreed — which is the finding, not noise:

```
run 1 (worker idle)      6/10 warm ~65 ms    4/10 cold ~900 ms
run 2 (immediately after) 11/12 warm  23 ms    1/12 cold  101 ms
```

The cold ratio is a property of **traffic**, not of the worker. Sparse traffic
means cold isolates. Which is exactly why it matters here: the worst case is the
*onset* of a burst, when many isolates start at once and each independently pulls
23 MB. That is an internal bandwidth amplifier and it is invisible from the
client side.

Worth noting honestly: the free plan's documented **10 ms CPU per request** should
have made a 197 ms build impossible, and production answers `/health` at 200
anyway. Either enforcement differs from the documentation for this path, or the
account is not on the plan we think. Do not build on the assumption that 197 ms of
cold-start CPU is safe — verify it.

Directions, none yet taken: fetch `term-details.json` (8.3 MB) and
`programs-bundle.json` (6.6 MB) lazily, only when a tool needs them, which would
roughly halve both the fan-out and the resident heap; or move lookups to KV so the
isolate holds an index rather than a corpus.

### 4. ShareBoxDO is a single global instance

```js
env.SHAREBOX.get(env.SHAREBOX.idFromName("global"))
```

One Durable Object, single-threaded, documented soft cap **1,000 requests/second**,
pinned to whichever colo created it, and `create()` runs an O(n)
`storage.list({prefix:"share:"})` over up to `MAX_OUTSTANDING = 2000` keys on
every call. Sender tabs also park a hibernating WebSocket on that same object.

At five users this is elegant — it makes claim-once atomic and the outstanding
cap trivial, which is exactly what its header comment says. At ten thousand it is
the first thing to fall over, and a user in Asia pays a round trip to Virginia to
create a share code.

`cloudflare/health-beacon` deliberately takes the opposite default (16 shards,
picked at random, counters fanned in on read) and its header says why, so the
contrast is documented where someone will read it.

### 5. Reconnect has backoff but no jitter

`src/adapters/northeastern/aiAssistant.js` doubles from 1 s to 30 s, which is
correct, but every client uses the same schedule with no randomisation. When the
worker redeploys, every connected browser disconnects at the same instant and
retries in lockstep at 1 s, 2 s, 4 s. At current scale this is invisible; it is a
textbook thundering herd and the fix is one line of jitter.

---

## What has been built so far

**`scripts/load-probe.js`** — the instrument. Four modes: `--budget` (offline,
~1 s, accounts a cold visit and every wall), `--edge` (real delivery, true wire
bytes, cache headers), `--worker` (cold-isolate ratio), `--load` (concurrency,
refused against non-localhost without `--i-mean-it`). `--json` and `--diff` so
two runs compare exactly.

Every number in this document came out of it, and it exists so the next person
asking these questions pays seconds rather than an afternoon.

**The health beacon** — `src/core/healthBeacon.js` (pure policy),
`src/data/healthReporter.js` (transport), `cloudflare/health-beacon/` (sharded
receiver), wired into the catalog load, `RecoveryBoundary`, and the three
shell-level failure paths in `index.html`.

Six fields, closed vocabularies, no identifier of any kind, no client clock,
bucketed timings, and `classify()` as a hard redaction boundary between anything
throwable and the eight words that may be sent. Successes sampled at 2%, failures
at 25% — both ceilings, sized so that a total outage costs 2,500 requests a minute
against a 100,000/day free budget rather than blinding the receiver exactly when
it matters. `test/contract/health-beacon-privacy.test.js` tries to smuggle a plan,
a course code, a file path, an email address, a session id and a stack frame
through it, and checks the browser's and the receiver's vocabularies have not
drifted apart.

Inert until `VITE_HEALTH_BEACON_URL` is set, so every build made before the
receiver exists — and every fork — sends nothing.

**Deep `/health`** on the MCP worker. `ok: true` used to mean only "the build did
not throw", which a half-failed scrape or a `DATA_ORIGIN` serving the SPA shell
both satisfy. It now reports counts against order-of-magnitude floors and answers
503 when the data is present but wrong, plus `isolate: {builtAt, buildMs, ageMs}`
so a probe can read the cold/warm split as a fact instead of inferring it from
latency.

---

## Not done, in the order worth doing

1. **Split descriptions out of the boot payload.** Biggest user-visible win;
   696K → 97K on the dominant asset. Touches the scrape and `courseNorm`.
2. **Delete the ORT wasm from the build.** Removes 35 MB and steps back from a
   90%-consumed hard limit, for a code path nothing takes.
3. **Decide the Pages file wall** — upgrade, or move `/data/**` to a Worker.
   This one has a deadline set by the monthly scrape, not by us.
4. **Hash the data assets + a manifest**, so returning visits stop revalidating
   nine files, and pre-compress at brotli q11.
5. **Shard ShareBoxDO**, and drop the O(n) scan per create.
6. **Jitter the reconnect backoff.** One line.
7. **Gate deploys on tests.** GitHub Actions runs the suite on push to `main`;
   Cloudflare Pages builds on the same push, independently. They race, and a red
   suite still deploys. There is no automated rollback.

## A latent bug found on the way

`src/adapters/northeastern/planGenerator.js` fetches `PLAN_ORDER_URL =
"/northeastern/plan-order.json"` — an absolute path, where every other asset uses
`import.meta.env.BASE_URL`. Vite is configured `base: "./"`, and
`deploy-pages.yml` publishes the same build to `nayugu.github.io/nu-map/`. On that
deployment the absolute path resolves to the wrong origin root and 404s. Same for
`EARLY_DONORS_URL`. Unrelated to scale; found while enumerating what a visit
fetches.
