# numap-health — the health beacon receiver

Answers one question: **is NU Map starting for the people who open it?**

Until this exists and is wired in, that question has no answer. On 2026-08-20 a
bug made the app fail to render for every visitor. The full test suite passed,
`verify-chart` was green, and `/`, the bundle and every JSON asset returned HTTP
200. It was found because somebody happened to look.

## What it is not

It is not analytics, and it cannot be turned into analytics without changing the
payload — which `test/contract/health-beacon-privacy.test.js` will fail you for.
It cannot count users, sessions, returning visitors, popular courses or anything
about a person, because beacons carry **no identifier of any kind** and are
therefore not linkable to each other. That is a deliberate trade, taken to keep
`privacy.html` literally true.

The full policy — the six fields, why each one is there, and what was left out —
is documented in `src/core/healthBeacon.js`.

## Deploying

```sh
cd cloudflare/health-beacon
npx wrangler login
npx wrangler deploy
```

Then, in the dashboard: this worker → Settings → Domains & Routes → add
`health.numap.app`.

Then, in Cloudflare Pages → nu-map → Settings → Environment variables, set:

```
VITE_HEALTH_BEACON_URL = https://health.numap.app
```

and redeploy the site. **Until that variable is set the app sends nothing** —
`src/data/healthReporter.js` and the inline shell copy in `index.html` both
short-circuit on an empty or unsubstituted value. That is the intended state for
every build made before this worker exists, and for every fork.

Also add it to the GitHub repo secrets (Settings → Secrets → Actions) if you
want the `gh-pages` build to report too.

## Reading it

```sh
npx wrangler secret put STATS_TOKEN        # once
curl -H "Authorization: Bearer $TOKEN" https://health.numap.app/stats
```

`/stats` fans in across all 16 shards and returns counts by build, outcome,
phase, engine and timing bucket.

**Read `byBuild` first.** A global success rate tells you something is wrong; the
same number split by build tells you which deploy to roll back, which is the
difference between an alert and a fix. It is the reason the build id is collected
at all.

Remember that successes are sampled at 2% and failures at 25%, so the two classes
are **not** directly comparable — the response repeats this in a `note` field for
the same reason. Multiply failures by 12.5 to put them on the same scale as
successes, or just compare rates within a class over time.

## Architecture note

16 Durable Object shards, picked at random per beacon, counters accumulated in
memory and flushed on a 30-second alarm.

Random rather than hashed because there is no key to hash — beacons carry no
identifier — and because counters commute, so the shard genuinely does not
matter. Sixteen because 16,000 req/s clears the stated peak comfortably while
keeping the read-path fan-out well inside the free plan's 50-subrequest budget.

The in-memory accumulation means an evicted shard loses up to 30 seconds of
counts. That is the right trade for health statistics read as rates and the wrong
trade for almost anything else; if this file is ever reused to count something
where each event matters individually, that design note in `src/index.js` is the
one to go back and delete.

This is deliberately the opposite of `cloudflare/mcp-server/src/shareBoxDO.js`,
which uses a single `idFromName("global")` instance — elegant at five users,
and a 1,000 req/s single-threaded bottleneck at ten thousand. See
`docs/scalability.md`.
