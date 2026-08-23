# Maintenance windows

One JSON file, `public/maintenance.json`, is the whole switch. Edit it with
`npm run maint`, commit, push. The app announces the window, escalates as it
approaches, shows a page during it, and clears itself when the end time passes.

**There is nothing to turn off afterwards.** That is the central design choice and
the rest of this document follows from it: every time in the file is absolute, so
one deploy covers the whole event. If coming back up needed a second deploy, then
a window that overran *because a deploy failed* would strand every visitor on a
maintenance page — the one situation where we are least able to ship anything.

## Ordinary pushes need nothing

Start here, because it is the most useful thing on this page: **a normal deploy
to `main` requires no maintenance at all.** The only user-visible effect is a tab
holding a stale shell that references a deleted chunk, and `index.html`'s
recovery screen already detects that and offers the way back — see the long
comment in `public/_headers`.

An `update` playbook existed for a day and was deleted. It announced a
non-event, which is the same crying-wolf failure the backup prompt is careful to
avoid: notices that fire when nothing is wrong are why nobody reads the one that
matters.

So this whole feature means one thing: **the site is coming off.**

## The command

One playbook, and it does not ask you to choose an announcement window, an
escalation point or a backup policy — standing in front of a broken deploy is the
worst possible time to derive those from first principles.

**The site comes off.** Announced two days out, escalated ten minutes before,
offline with the "Continue anyway" hatch left open.

```bash
npm run maint -- outage --start "2026-08-30 22:00" --expect 8h --write
# announce 48 h · warn 10 min · offline · quote 8 h · guarantee 2 days · 12 h tail
```

### A window always STARTS from the schedule

There is no "take the site off right now" action, and that is deliberate: an
emergency is just a window whose start time is `now`, so the only creation verb
is *schedule*. What you do need is two ways to un-schedule, and they are not
interchangeable:

```bash
npm run maint -- done --write          # STOP a running one → "we're back" notice
npm run maint -- cancel <id> --write   # DROP one that never started
npm run maint -- extend 6h --write     # or push the forecast and deadline out
```

`cancel` refuses a live window on purpose. Deleting a running one would drop the
maintenance page mid-outage with no "we're back" notice — silently — which is the
exact failure `done` exists to avoid. Cancelling something that never began has no
tail to leave, so there it really is just a deletion.

Then `git add public/maintenance.json && git commit && git push`. Everything is a
dry run without `--write`, and the playbook only sets *defaults* — any flag you
type still wins, and it runs through the same code path as a hand-built window,
so there is no second implementation to drift.

## Or from the dev portal

`/northeastern/dev` → **Maintenance**. Three things and nothing else:

- **The queue**, at the top. Three row states, and the difference between them is
  which action the row may offer:

  | State | Looks like | Action |
  |---|---|---|
  | `RUNNING` | tinted red, red rule down the left | **Stop** |
  | queued | plain | **×** cancel |
  | `COMPLETED` | faded, and it *stays* | none |

  A running window is **stopped**, never cancelled — stopping is what leaves the
  "we're back" notice, and cancelling would drop the maintenance page mid-outage
  with nothing said. The CLI refuses it for the same reason. A finished window
  stays in the list as the record of what happened; the CLI keeps a week of them
  (`HISTORY_MS`), which bounds a file every visitor fetches. The start time is
  read-only text throughout — this list never edits anything.
- **One line to fill it**: name, date, time, expected, deadline, `Schedule` hard
  right. Shortcuts underneath — `Now`, `+1h`, `+6h`, `Tonight 2am` — *write into*
  the date and time rather than being a selection of their own, so hand-editing
  the time afterwards can never leave a chip highlighted and lying. Field
  meanings are tooltips on the labels, not a paragraph under the button.
- **The stage chain**, down the right — four circles for the four things a
  visitor passes through, each showing when it begins for the window in hand,
  with a marker on where we are now. **Hover** a circle and the real app renders
  that stage in a small rounded frame; **click** it and the same URL opens
  nearly full-page at real size, closable with the button, the backdrop or Escape.

The small frame answers "is this the right screen"; at ~22% it cannot answer "is
this copy right", which is what the big one is for. There is only ever *one* small
iframe, swapped on hover with a 220 ms debounce — four would be four copies of an
app that loads a 7,966-course catalog, which is not a preview but a stampede — and
the modal's iframe is dropped to `about:blank` on close, or a hidden-but-live app
keeps its timers and its 60 s maintenance poll running all session.

Two things in there were found by testing rather than reasoning, and both were
real bugs rather than test artifacts:

- The small frame's scale is **measured** from the width it actually got. A
  constant cropped the right edge of a centred maintenance page in the 300 px
  column and went comically small at the one-column breakpoint.
- Escape did nothing, because `document.activeElement` was the preview
  **iframe** — the embedded app autofocuses on mount, so the keydown belonged to
  that frame's document. `MaintenancePage` now declines to focus when embedded
  (`window.top !== window.self`), which also stops a thumbnail stealing keystrokes
  from whoever is typing in the portal; and because other components autofocus
  too, the portal additionally listens for Escape inside each same-origin preview
  frame rather than trying to enumerate them all.

That chain replaced two separate things: a monospace list of instants and a row
of preview buttons. They said the same thing in two idioms and neither answered
the question you actually have, which is "at this point in the window, what is on
a student's screen?".

The four stages are the resolver's phases minus the two that are not a thing a
visitor sees: `cleared` is the *absence* of all this, and `expected` is a
boundary **inside** `Off` rather than a stage of its own — so it is described in
the Off stage ("from 10:55 PM it stops counting down and says taking longer than
expected") rather than pretending to be a fifth circle.

### How the buttons actually reach the file

Two routes, tried in this order:

1. **On `npm run dev`: straight to the CLI.** `POST /__maint` on the Vite dev
   server (`maintenanceDevPlugin` in `vite.config.js`) runs
   `scripts/maintenance.js` and writes `public/maintenance.json` locally. No token,
   no workflow, no second process — it exists whenever the dev server does, and a
   Vite dev middleware has no production counterpart so it cannot ship. The verb
   is checked against a closed list and args go to `spawn` as an array with no
   shell.
2. **Otherwise: dispatch `.github/workflows/maintenance.yml`** with the GitHub PAT
   the Trigger tab already stores, so it works from a phone. Unlike Trigger this
   panel is *not* hidden over HTTPS, because it goes through the GitHub API rather
   than a local server.

With neither — no dev server and no saved PAT — it does not just refuse. It
expands the "…or do it by hand" block, copies the equivalent command to the
clipboard, and says so. The first version showed a dialog whose entire content was
"you can't", in the one place you are most likely to be trying this out.

The `name` is **ours**: it appears in the queue and nowhere in the app. That is
what lets it be free text — a student-facing string would have to exist in all
eight locales, which is exactly why `kind` is a closed vocabulary instead.

Two more things worth knowing:

- **It runs the real resolver.** `src/core/maintenance.js` is copied to
  `dist/northeastern/maintenance-core.js` at build (`maintenanceCorePlugin` in
  `vite.config.js`), so the panel's phase labels, timeline and cap warnings are
  the app's, not a re-derivation. A portal that said "scheduled" while the app
  said "active" is how a wrong call gets made at 2 a.m. In `npm run dev` it falls
  back to importing `/src/core/maintenance.js` directly.
- **It needs the pipeline healthy.** A dispatch requires Actions *and* the Pages
  deploy to work. If the pipeline is the thing that is broken, committing by hand
  fails for the same reason — both paths end in "deploy the static file". The fix
  for that case is an override that skips the deploy entirely; it is not built.
  There is an "…or do it by hand" block with the exact command for when no token
  is saved.

### `end` and `expectedEnd` are two different promises

This is the one part of the model worth reading twice, because it is what makes
an unplanned outage expressible at all.

| | What it is | Who reads it |
|---|---|---|
| `end` (`--for`, default 2 d) | **the deadline.** The site turns itself back on here even if every deploy fails. | the resolver, the edge, the recovery screen |
| `expectedEnd` (`--expect`) | **the forecast.** The number we quote. Optional. | the countdown, `Retry-After` |

Once the forecast passes and the deadline has not, the state is `overrunning`
and every surface stops counting down and says *"taking longer than expected"*
instead. A visible countdown that has run out while the page is still up is the
fastest way to look abandoned — and quoting a generous deadline instead would
keep us out of Google's index for the whole of it.

So: **quote hours, guarantee days.** `--expect 8h --for 2d` says "we think eight
hours, and we promise you're not stuck past Friday" — and `done` collapses it the
moment the fix lands.

Nothing writes without `--write`. A dry run prints the JSON *and* the derived
timeline, because every mistake this command can make is a schedule mistake —
wrong month, an announcement that fires after the window opens, an `offline`
where a `notice` was meant — and all of them are obvious in a timeline and
invisible in JSON.

```
  ▶ 2026-08-30-02-00-deploy  notice  deploy
      · scheduled  Fri, Aug 29, 10:00 PM EDT   header notice appears
        imminent   Sat, Aug 30, 01:30 AM EDT   notice escalates
        active     Sat, Aug 30, 02:00 AM EDT   notice: in progress
        restored   Sat, Aug 30, 04:00 AM EDT   'we're back' notice
        cleared    Sat, Aug 30, 06:00 AM EDT   nothing, automatically
```

To end a window **early**, `npm run maint -- clear --write` and push. To end one
on time, do nothing.

## Severity: pick `notice` unless you truly cannot serve

| Severity | What a visitor gets | HTTP |
|---|---|---|
| `notice` (default) | a strip in the app header with the window and a countdown | 200 |
| `degraded` | the same strip, naming which features will fail | 200 |
| `offline` | the maintenance page, with a "Continue anyway" link | **503** |

`notice` is the default because of a fact about this app that is easy to forget
when writing a maintenance feature: **NU Map does not need us in order to work.**
Plans live in the visitor's own `localStorage`, the catalog is a static JSON
already in memory, and there is no account and no server-side state. A visitor
with the page open is unaffected by anything we do to the deployment, and a
visitor arriving fresh only needs the static assets. So `offline` does not
describe a state we are in — it is a decision to stop serving, and it causes an
outage that would not otherwise exist. Reach for it when the deployment genuinely
cannot answer, not when we are busy.

`degraded` names features from a closed list (`claude`, `share`, `ratings`,
`translation`, `catalog`), and two of them are now **enforced**, not just
announced: `claude` closes the MCP surface and `share` closes the code relay, in
`cloudflare/mcp-server/src/maintenance.js`. The other three (`ratings`,
`translation`, `catalog`) are still declarative — the strip names them, nothing
switches them off. `isFeatureDown()` in `MaintenanceContext` is the hook for
wiring those in the client.

## What the visitor actually sees, in order

1. **`scheduled`** — from 24 h out by default (`--announce`). A strip appears as
   the first row of the sticky header: dot, label, countdown, absolute window.
   In flow, not floating, so it can never cover a course card.
2. **`imminent`** — from 30 min out (`--imminent`). The strip re-opens even if
   the earlier one was dismissed, because dismissals are keyed on `id:phase` and
   these are two different messages. This is where `--backup` asks.
3. **`active`** — `notice`/`degraded` keep the strip; `offline` shows
   `MaintenancePage` over the app (and a 503 at the edge for new arrivals).
4. **`restored`** — for 2 h after the end (`restoredHours`), a green strip with a
   reload button. A tab left open through a deploy is running a bundle that no
   longer exists, and reloading is the fix.
5. **gone** — automatically. No deploy.

## The backup prompt

`--backup optional` or `--backup recommended` adds one button that runs the same
whole-library export the plan library offers.

It is *not* on by default, and that is deliberate. The honest message on a
routine window is "your plans are in this browser; this cannot touch them" —
which the strip says on every window. Adding a scary "save your work" to all of
them is crying wolf, and the cost of crying wolf is that the one window where it
matters gets ignored too. Use `recommended` for a storage-schema change; that is
what it is for.

## Technical correctness at the edge

`functions/index.js` is a Cloudflare Pages Function on **`/` only**. During an
`offline` window it returns:

- **HTTP 503 Service Unavailable**, not 200. A maintenance page at 200 tells
  Google that "Under maintenance" *is* numap.app's content; do that during a
  crawl and pages start dropping out of the index.
- **`Retry-After`**, in seconds, computed from the window's own end. Crawlers
  read it as "come back then" and keep what they have.
- **`Cache-Control: no-store, no-cache, must-revalidate`**. Never cache a
  maintenance page: an edge or browser copy outliving the window keeps serving
  "we're down" after we are back, which turns a scheduled 2-hour window into an
  unscheduled outage that looks like it is coming from nowhere.
- **`X-Robots-Tag`** is *not* set, and `noindex` in the HTML is there only for the
  manual escalation path below. On a 503 the status is the signal; a `noindex`
  would be a second, weaker claim about the same thing.

Three properties of that function are load-bearing:

- **It is on `/`, not `_middleware.js`.** Middleware runs on every request
  including every hashed asset — a Worker invocation per asset on the free tier,
  which is exactly the cost `public/_headers` documents refusing for `/assets/*`.
  A route function on `/` runs once per document request, and `/` is the whole
  app: there is no path routing and no `pushState` anywhere in `src/`.
- **Every branch fails open.** Missing schedule, malformed JSON, an unreachable
  template, an unexpected throw — all of them end in `next()`, which serves the
  ordinary app. This file sits in front of the homepage; if it can fail, it can
  cause a worse outage than any window. The only way to get a 503 out of it is a
  schedule that positively says so.
- **`?nomaint=1` passes through** and sets a 12-hour cookie. Not a backdoor —
  the point. A crawler gets the honest 503; a student who clicks "Continue
  anyway" gets their degree plan, because the app works fine without us.
  `--hard-block` removes that link, and is only correct when an edit made during
  the window would be written into a schema you are replacing.

Measured against a real Pages runtime (`npx wrangler pages dev dist`, 2026-08-22),
with a 12-hour `offline` window open:

```
GET /                 503  Retry-After: 29361  Cache-Control: no-store, no-cache, must-revalidate
GET /?nomaint=1       200  Set-Cookie: numap_nomaint=1  Cache-Control: no-cache
GET /logo.png         200  image/png          (assets never reach the function)
GET /maintenance.json 200                     (the data surface stays up)
GET /  (no window)    200  Cache-Control: no-cache
```

Two things that check settled and were genuinely open beforehand: `next()`
**does** carry the `_headers` rules through (the passthrough still answers
`no-cache`, not a default), and the injected window arrives in the body as
`var INJECTED = {"end":…}` so the page makes no request of its own.

⚠ **`wrangler pages dev` does not reproduce everything.** Pages normalises HTML
URLs in production: `/maintenance.html` answers **308** to `/maintenance`. The
function originally asked for `.html` and gated on `res.ok`, so in production a
308 read as "template unreachable" and every real 503 would have served the plain
built-in fallback instead of the designed page — while passing locally. It now
asks for `/maintenance` first and decides it has the template by finding the
injection token rather than by the status. If you add anything else that fetches
its own assets, curl production after the deploy; the local runtime will not tell
you.

If it ever misbehaves, deleting `functions/index.js` restores pure static serving
and everything else here still works — only the status code is lost.

Netlify (`netlify.toml`) and GitHub Pages do not run Pages Functions. On those,
the schedule still drives the whole in-app experience; only the 503 is missing.

## Resilience: the four layers

Each one covers a failure the one above it cannot.

| Layer | Runs when | Where |
|---|---|---|
| Header strip | the app is running | `src/ui/MaintenanceNotice.jsx` |
| Full-screen page | the app is running, window is `offline` | `src/ui/MaintenancePage.jsx` |
| Static page + 503 | a fresh request during an `offline` window | `functions/index.js` + `public/maintenance.html` |
| MCP 503 | Claude talks to mcp.numap.app | `cloudflare/mcp-server/src/maintenance.js` |
| Recovery screen wording | **the bundle never executed** | `index.html` |

The MCP layer matters because the worker is a **separate deployment** — without
it, taking the site off for safety would leave Claude reading and proposing
against a deployment we had deliberately shut down. It returns 503 +
`Retry-After` with a message written to be read aloud ("NU Map is under
maintenance until…; plans are stored in the user's own browser and are
unaffected"), so whatever surfaces it can say something true instead of
"connection failed". `/health` is **never** gated — it is how you find out what
state everything is in, and taking it down during an incident would remove the
one instrument that matters. Same reasoning leaves the health beacon,
stripe-split and translate-proxy alone: the first must stay up to observe, and
the other two have no user-visible failure worth announcing.

That last one matters more than it looks: a failed boot *during a window* is the
likeliest way anyone ever sees the recovery screen, and it used to say "NU Map
just updated". It now reads the schedule from `localStorage` (mirrored by
`src/data/maintenanceSource.js`) and names the end time instead.

`public/maintenance.html` is **self-contained on purpose** — inline CSS, inline
SVG mark, system fonts, no webfont, no `<img>`, one request at 7.2 KB gzipped,
and it renders with JavaScript disabled. Anything it fetched from us would be something that could
fail together with the thing it is apologising for. Its ETA degrades through
three tiers: injected by the edge function (zero requests) → a fetch of the
static `maintenance.json` → no ETA at all, just "we'll be back shortly" and the
one fact that matters, that plans are local.

Its eight locales are inlined and therefore duplicated from `src/locales/`. That
is accepted, for the same reason the recovery screen in `index.html` duplicates
its strings: neither file may depend on a bundle.

## Previewing without scheduling anything

`?maint=offline`, `?maint=degraded`, `?maint=notice`, `?maint=scheduled`,
`?maint=imminent`, `?maint=restored` — localhost and dev builds only, the same
gate and the same reason as `index.html`'s `?preview=recovery`. Production
visitors can never summon these by URL.

## Manual escalation (the real outage case)

If the deployment is broken in a way a schedule cannot describe, add one line
above the SPA catch-all in `public/_redirects` and deploy:

```
/*  /maintenance.html  200
```

This is the only path here that serves the page at **200**, which is why that
file carries `noindex`. It is the equivalent of `update-nupath.yml` in the data
pipeline: a manual escalation, not a scheduled mechanism. Remove the line to come
back.

## Two rules for changing this code

- **There is exactly ONE resolver, and that was worth fixing.** The edge function
  and the MCP worker both `import { resolveMaintenance }` from
  `src/core/maintenance.js`. The function originally carried a hand-copied subset
  with its own `MAX_OFFLINE_HOURS`, on the assumption that a Pages Function
  cannot reach `src/`. It can — `cloudflare/mcp-server/src/loadData.js` has
  imported across that boundary all along, and it is verified working through
  `wrangler pages dev`. So caps, demotion and window adjudication are now
  identical everywhere by construction rather than by discipline.
  `MAX_OFFLINE_HOURS` is **72 h**, not 24: at 24 it silently demoted this
  project's own stated worst case (off for up to two days) to a notice — the
  guard firing on the real case instead of on the typo it exists for.
  Two hand-copied strings remain, both unavoidable: `CACHE_KEY` in
  `maintenanceSource.js` (read in ES5 by `index.html`, which runs before any
  module exists) and `TOKEN` in `functions/index.js` (must match the placeholder
  in `maintenance.html`).
- **`src/core/maintenance.js` is pure and stays pure.** Every safety property
  above is a property of `resolveMaintenance`, and each is a test in
  `test/unit/maintenance.test.js` — including a fuzz pass whose one assertion is
  that nothing but a deliberate, in-window, under-the-cap `offline` window can
  ever produce `blocking: true`.
