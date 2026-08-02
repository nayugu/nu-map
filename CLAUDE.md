# NU Map — notes for Claude

## Data pipeline: current vs legacy

Read this before touching anything under `.github/workflows/` or `scripts/` that
updates course data. Two workflows are legacy and easy to mistake for the live path.

| Workflow | Cadence | Role |
|---|---|---|
| `update-courses.yml` | Monthly (1st, 06:00 UTC) | **The main pipeline.** Full catalog scrape of all ~130 subjects — titles, descriptions, credits, prereqs/coreqs — plus **NUPath from Tableau** (`fetch-nupath --tableau` → `merge-nupath`), Banner availability, **primary instructors** (`--prof`: one newest completed term per run, cached forever after — one getFacultyMeetingTimes call per section), offering summary, and manual patches. Pushes directly to main. |
| `update-majors.yml` | Bimonthly (odd months) | Undergrad program requirements |
| `update-grad-majors.yml` | Bimonthly (odd months) | Graduate program requirements |
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
- The runtime file is `public/northeastern/catalog-courses.json` (browser app,
  Node MCP server, and Cloudflare worker all load it). `all-courses.json` is the
  scrape intermediate; `merge-nupath.js` backfills nuPath from it at build time.
- Data fixes must live in the scrape scripts (both undergrad and grad paths),
  never in one-off migrations — the next scheduled scrape overwrites anything else.
- The legacy `external/` git submodules (graduatenu, nu-courses, searchneu) were
  removed in July 2026 — our scrapers are the sole data source, and the
  `nayugu/*` forks backing them are deleted from GitHub. Never reintroduce a
  submodule data path; `git submodule update` on pre-removal commits cannot work.

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

## Conventions

- Conventional commits (`type: description`), no Co-Authored-By trailers.
  Keep the subject concise; for features/fixes add a body of bullet points
  explaining how the change works — what was added or fixed and the
  mechanism behind it — detailed enough to follow the design without
  reading the diff.
- Localization: every user-facing string exists in all 8 locales
  (`src/locales/`), hand-written translations. "CLAUDE" stays untranslated.
  Summer terms are "Summer A" / "Summer B", never "Summer 1/2".
