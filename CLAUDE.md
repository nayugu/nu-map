# NU Map — notes for Claude

## Data pipeline: current vs legacy

Read this before touching anything under `.github/workflows/` or `scripts/` that
updates course data. Two workflows are legacy and easy to mistake for the live path.

| Workflow | Cadence | Role |
|---|---|---|
| `update-courses.yml` | Monthly (1st, 06:00 UTC) | **The main pipeline.** Full catalog scrape of all ~130 subjects — titles, descriptions, credits, prereqs/coreqs — plus **NUPath from Tableau** (`fetch-nupath --tableau` → `merge-nupath`), Banner availability, **primary instructors** (`--prof`: one newest completed term per run, cached forever after — one getFacultyMeetingTimes call per section), offering summary, **term windows** (`derive-term-windows`), and manual patches. Pushes directly to main. |
| `update-majors.yml` | Bimonthly (odd months) | Undergrad program requirements. Scrape → `check-major-integrity` → `verify-majors --report --write` → ratchet → push. |
| `update-grad-majors.yml` | Bimonthly (odd months) | Graduate program requirements, same four steps. |
| `catalog-rotate.yml` | **LEGACY — manual only** | Superseded by the monthly full scrape above. Old design: one subject every 3 days via PR review; its schedule was disabled because GitHub Actions here cannot open PRs. Do not re-enable. |
| `update-nupath.yml` | **LEGACY — manual only** | Superseded by the Tableau step now inside `update-courses.yml`. Its one remaining use: it installs Playwright, so it is the manual escalation path if Tableau's REST and direct-CSV routes both break. Do not schedule it — it would double-write the same data. |

Merged summer terms (AY2026+): NEU retired the 40/60 summer codes; a single
`…50` code carries both sessions, split back into synthetic 40/60 codes by
`partOfTerm` in `scrape-availability.js` (full-summer sections count toward
both and carry a `fullSummer` tag). ⚠ The instructor fetch for a synthetic
summer term (via its merged Banner code) first runs for real in the
September 2026 monthly job — verify that run's log.

Facts that follow from this:

- NUPath designations, descriptions, and prereqs all refresh **monthly** — do not
  describe them as static, manual, or annually updated.
- **NUPath has 13 codes, not 12.** 11 competencies, but competency 9 ("Writing
  Across Audiences and Genres") is awarded as three: `WF`, `WD`, `WI`.
- **Source authority is per field, not a global ranking** (see README → Source
  hierarchy). For NUPath, Tableau is authoritative and the catalog is a fallback;
  for titles/descriptions/prereqs the catalog is authoritative. Two invariants
  live in `scripts/lib/nupath.js` and must not be weakened:
  1. a source may only *remove* a code it can express — the catalog prints 11 of
     13 and never `WF`/`WD`, so its silence there means nothing;
  2. only the authoritative source may remove at all; fallbacks are additive.
  `fetch-nupath` also refuses to write if a run would clear more than 5% of
  courses, so a broken upstream cannot silently empty the catalog.
- The catalog's `Attribute(s):` line is a plain `<p class="courseblockextra">`
  with **no** nupath/attribute class — find it by its label text
  (`findAttributeText`), never by a class selector. A class-based selector
  matched zero blocks and made the catalog contribute no NUPath at all.
- **Term windows are read where possible, estimated only as a fallback.**
  Which semester is "now" — and therefore which courses count as completed —
  comes from `src/adapters/northeastern/termWindows.js`, regenerated monthly
  by `derive-term-windows.js`. Three tiers, in order:
  1. **`pinned`** — Banner publishes about a term ahead, so the semester the
     planner actually cares about usually has a *published* start date. Used
     verbatim + 1 day. This is what makes a shifted calendar a non-event; no
     fit of ordinary years could ever have predicted Spring 2022's 12-day
     COVID delay, but Banner knew it.
  2. **Fall's Labor Day rule** — the Wednesday after Labor Day, exact in 9/9
     measured years, so no statistical margin, just the same +1 day.
  3. **The fitted fallback** — median + 2·MADN over a **rolling 5-year
     window**, for terms past Banner's horizon. MADN (not σ) because one
     COVID year pulls σ from 1.2d to 6.0d and would push the threshold later
     than the hand-picked guess this replaced. Capped so no term is ever
     recognised more than 7 days late.
  Never re-freeze any of this as constants: NU moved Spring to a Wednesday
  start in 2026, and only the rolling derivation noticed.
  The measured guarantee, over 31 terms 2018–2026: recognition lands strictly
  *after* the first class in **27/27 ordinary terms**, by **1 day** when the
  date is known and ≤7 days (mean 2.9) when fitted. Anomalous years are
  discounted by design, not by excuse — that is exactly what MADN buys, and
  the only 3 misses are the COVID terms, which a pinned date would now catch
  anyway. Don't re-tune the thresholds to cover an outlier year: pinning
  Spring to its 2021 date would cost every ordinary year 12 days of lag.
  `isTermPast` is a *separate*, later threshold (start + 14d) about Banner
  enrolment settling after add/drop — do not re-merge the two.
- **"Now" is the most recent term to have BEGUN**, never the one about to.
  With one pointer the break has to be spent on one term or the other, and
  the deliberate choice is that "in progress" is a fact, not a forecast: a
  finished Fall stays current for the 28–31 days of winter break rather than
  Spring being named before anyone attends it. This is the trade, not a bug —
  don't "fix" the lingering by handing off at the old term's end without
  re-deciding it. The guarantee is bounded, not absolute: a threshold fitted
  to ordinary years fires early in one that runs late (Spring 2022 began
  Jan 18 under COVID, 7 days after the threshold). If the lingering ever
  needs fixing, the cheap route is gating the words "in progress"
  (`planModel.js` prints them literally) on the end dates, which already
  exist — not moving the pointer.
- The runtime file is `public/northeastern/catalog-courses.json` (browser app,
  Node MCP server, and Cloudflare worker all load it). `all-courses.json` is the
  scrape intermediate; `merge-nupath.js` backfills nuPath from it at build time.
- Data fixes must live in the scrape scripts (both undergrad and grad paths),
  never in one-off migrations — the next scheduled scrape overwrites anything else.
- The legacy `external/` git submodules (graduatenu, nu-courses, searchneu) were
  removed in July 2026 — our scrapers are the sole data source, and the
  `nayugu/*` forks backing them are deleted from GitHub. Never reintroduce a
  submodule data path; `git submodule update` on pre-removal commits cannot work.

## Major/minor requirements

- **There is no Tableau-equivalent for majors.** Verified 2026-08-02 and
  recorded in `scripts/lib/major-verify.js`: Banner has no program/degree
  endpoints (404), Degree Works and CourseLeaf CIM are SSO-gated, the per-page
  PDF is the same render as the HTML, and `sandboxnu/graduatenu` is GPL-3.0
  (incompatible with the Option B commercial licence) with known errors. The
  catalog's Program Requirements pane is the single authority. Don't re-hunt.
- Both scrapers share `scripts/lib/catalog-program-parser.js`. Requirement
  tables live under **27 different container ids** including NEU's own typos,
  52 pages spread them across more than one pane, and the Sample Plan of Study
  pane is excluded deliberately. Match `*textcontainer` + "has tables"; never
  hard-code `programrequirementstextcontainer`.
- **The Sample Plan of Study is a witness, not a source.** It is one valid
  path, so it can prove we dropped requirements and can never prove we have
  them all. Never assert parsed ⊆ plan — the plan takes one branch of every
  choice. Its total legitimately exceeds the minimum, so it is info only.
- Concentrations are found through the page's **anchor graph**, not heading
  text — wording varies far too much. A concentration's title is its only
  identity across saved plans, share links and MCP `SET_CONCENTRATION`, so
  every lookup goes through `src/core/concentrationResolve.js`.
- `verify-majors.js` must run **after** the scrape: the scraper deliberately
  drops `metadata.verification` rather than carry a stale verdict forward.
- Both scrapers buffer their whole run and refuse to write if it looks like
  upstream breakage (`scripts/lib/scrape-rails.js`) — same principle as
  `fetch-nupath`'s 5% rule. They push straight to main unattended.
- Program discovery uses the **sitemap**; `/azindex/` is `Disallow`ed in
  robots.txt and both scrapers used to violate it.

## Claude/MCP integration

- Node dev server: `mcp-server/` (port 27182). Production: `cloudflare/mcp-server/`
  (Durable Objects + OAuth), deployed with `npx wrangler deploy`, live at
  mcp.numap.app. Both compose the same shared adapters in `src/adapters/mcp/` —
  changes to action semantics or tool docs need a worker redeploy to reach prod.
- Hexagonal rules: UI imports ports only (`src/ports/`), adapters import core only.
  The Claude UI motif is orange `#fb923c`; previews are dashed-orange ghosts.

## Team workflow (two humans + pipeline bots)

- Start by syncing with `origin/main`: `git pull` (or at least `git fetch` +
  `git diff HEAD origin/main` to see what changed). Pull again before editing
  shared docs (TODO.md, IDEAS.md). With `pull.rebase` set, pull refuses while
  you have uncommitted changes — commit or stash first.
- **Default flow: branch → commit → rebase onto origin/main → `git merge
  --ff-only` → delete the branch.** Pairing is the normal mode here, so
  **no PRs** — do not open one unless explicitly asked. The branch is just
  somewhere to commit work that is not a coherent unit yet; every commit
  lands in main by its own SHA, so deleting the label afterwards loses
  nothing.
- **Stay mergeable at all times**: rebased on `origin/main`, tests green, no
  half-finished commit at the tip. Merging should never be a project — if it
  is, the branch drifted too long.
- **Committing needs no permission; pushing does.** Always ask before
  `git push`. Commits are local and easy to amend or reset; a push is
  outward-facing and may carry someone else's commits with it.
- **A branch does not isolate a shared checkout.** Branches are per-repo, not
  per-agent: one `HEAD`, one working tree. When two sessions run at once,
  `git switch` moves both, and uncommitted edits follow across the switch —
  this is how one session's edits to majorLoader.js/minorLoader.js ended up
  inside the other's commit on Aug 2, 2026. So stage your own files
  explicitly, never `git add -A`, and leave the partner's uncommitted work
  and unpushed commits alone. For real isolation use `git worktree` (its own
  directory, `HEAD` and branch) — it needs a separate `npm install`, so it
  is worth it only when both sessions are live in the same files.
- If a PR is explicitly requested, it merges as a **merge commit**. Never
  squash-merge — squashing collapses the branch's commits into one, so the
  individual history is lost the moment the branch ref is deleted. A merge
  commit keeps every commit AND marks which branch they came from, so
  deleting the branch afterwards is safe (GitHub: Settings → General →
  Pull Requests).
- No long-lived or personal branches — they drift fast here (the monthly
  scrape commits straight to main; one March branch died 469 commits behind).
- Never enable required-PR branch protection on main: the scheduled data
  workflows push to it directly and would break.
- Ideas and tasks live in per-person lists under `notes/` (`ideas-nathan.md`,
  `ideas-matthew.md`) — only edit your own, so they never conflict. The repo
  is public: keep notes whiteboard-safe.

## Working method

Every input here is scraped, the workflows push to main unattended, and a wrong
number reaches a student planning their degree. Confident-and-wrong is the
expensive failure, so the loop is:

- **Measure before designing.** Argue from the corpus, not from intuition —
  most good calls in this repo were made by a script that took two minutes.
  Ideas that read well and died on contact: candidate-set intersection (empty
  **86.7%** of the time), a first-run "load a sample plan" toggle (**62%** of
  programs publish none), per-section pending marks (a median of **2 sections
  out of 11**). A measurement that kills your idea has done you a favour.
- **Attack your own work.** Tests that confirm are close to worthless here. The
  ones that pay are hostile: malformed specs, stale ids, junk locale shapes,
  hundreds of random gestures. Do not stop at first green — stop when you have
  tried everything you can think of and it still holds.
- **Verify, never assume.** `subjects` is an array at runtime and an object in
  the scraper. `CS 3500` does not exist. Four core modules were imported by
  nothing at all. Each was found by *checking*, and each would have shipped in
  silence.
- **Be hardest on your most confident claim.** "Two plans need 262 SH" was
  rhetoric — a second major consumes the free electives, so the real gap is
  three courses, not double. "Provenance proves replacing is safe" was false; it
  proves the canvas *started* as a template. Re-derive the number you are most
  sure of.
- **Fix the cause, and check whether the guard is the bug.** A persistence
  invariant stripped `//` comments *after* splitting on commas, so a comma
  inside a comment invented a field and reported it lost on reload. A test that
  punishes commas in comments teaches people to write worse comments.
- **Conservative beats clever.** Ambiguity is cheap; false confidence is not.
  Degrade to less information, never to wrong information — and do not ship what
  the measurement says is not worth it.
- **Say plainly when you were wrong.** Correct it in place, in the document or
  the comment that carries the claim, so the next reader inherits the correction
  rather than the mistake.
- **Edit code with the editing tools, never through the shell.** `sed`, `node -e`
  rewrites and heredocs are not code editing — they skip the read-before-write
  the editors enforce, they are invisible in review, and a bad regex silently
  mangles a file nobody re-reads. Shell is for *running* things: tests, builds,
  git, throwaway measurement scripts. It is not for changing source, and that
  includes locale files.
- **Never idle on a long command.** `verify-chart` is 4–10 minutes and the suites
  are minutes more. Background them and keep editing, reading or writing the next
  thing while they run; collect the result when it lands. Waiting for a number
  before doing anything else turns a ten-minute run into ten wasted minutes, and
  it happens a dozen times in a session.
  - The only reason to block is when the very next edit depends on the answer and
    getting it wrong would be expensive to unwind — landing a change on main,
    or a measurement that decides whether to keep or revert work already built.
    That is rare. Default to carrying on.
  - Prefer ONE reusable instrument over a stream of throwaway scripts.
    `scripts/chart-probe.js` answers the same questions over a named list of
    plans in ~13 seconds where the corpus sweep takes ten minutes; every `node -e`
    heredoc instead reloads the 8,000-course catalog from scratch. Extend the
    instrument, do not write another script.
- **Re-anchor these rules as a session runs long.** Drift is the default, not
  the exception — the shell creeps back in, tests get gentler, claims get
  confident again. Re-read this section periodically and after any long stretch
  of implementation. An explicit instruction from the user overrides any of it;
  absent that, return to it rather than to whatever the last hour settled into.

## Conventions

- Conventional commits (`type: description`), no Co-Authored-By trailers.
  Keep the subject concise; for features/fixes add a body of bullet points
  explaining how the change works — what was added or fixed and the
  mechanism behind it — detailed enough to follow the design without
  reading the diff.
- Localization: every user-facing string exists in all 8 locales
  (`src/locales/`), hand-written translations. "CLAUDE" stays untranslated.
  Summer terms are "Summer A" / "Summer B", never "Summer 1/2".
