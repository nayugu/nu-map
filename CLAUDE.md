# NU Map — notes for Claude

## Data pipeline: current vs legacy

Read this before touching anything under `.github/workflows/` or `scripts/` that
updates course data. Two workflows are legacy and easy to mistake for the live path.

| Workflow | Cadence | Role |
|---|---|---|
| `update-courses.yml` | Monthly (1st, 06:00 UTC) | **The main pipeline.** Full catalog scrape of all ~130 subjects — titles, descriptions, credits, prereqs/coreqs, **NUPath** — plus Banner availability, **primary instructors** (`--prof`: one newest completed term per run, cached forever after — one getFacultyMeetingTimes call per section), offering summary, and manual patches. Pushes directly to main. |
| `update-majors.yml` | Bimonthly (odd months) | Undergrad program requirements |
| `update-grad-majors.yml` | Bimonthly (odd months) | Graduate program requirements |
| `catalog-rotate.yml` | **LEGACY — manual only** | Superseded by the monthly full scrape above. Old design: one subject every 3 days via PR review; its schedule was disabled because GitHub Actions here cannot open PRs. Do not re-enable. |
| `update-nupath.yml` | **LEGACY — manual only** | Superseded: NUPath rides the monthly catalog scrape (`nuPath` is a diff field in `scrape-catalog.js`). Kept only as a manual cross-check against the Registrar's Tableau dashboard, the authoritative NUPath source. Do not schedule it. |

Merged summer terms (AY2026+): NEU retired the 40/60 summer codes; a single
`…50` code carries both sessions, split back into synthetic 40/60 codes by
`partOfTerm` in `scrape-availability.js` (full-summer sections count toward
both and carry a `fullSummer` tag). ⚠ The instructor fetch for a synthetic
summer term (via its merged Banner code) first runs for real in the
September 2026 monthly job — verify that run's log.

Facts that follow from this:

- NUPath designations, descriptions, and prereqs all refresh **monthly** — do not
  describe them as static, manual, or annually updated.
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
- Code changes go branch → PR → squash-merge: `git switch -c fix/short-name`,
  push, open a PR, partner skims, merge. The repo is squash-only and
  auto-deletes merged branches. Trivial docs edits may go straight to main.
- No long-lived or personal branches — they drift fast here (the monthly
  scrape commits straight to main; one March branch died 469 commits behind).
- Never enable required-PR branch protection on main: the scheduled data
  workflows push to it directly and would break.
- IDEAS.md = shared idea scratchpad (tag entries with initials); TODO.md =
  agreed tasks.

## Conventions

- Conventional commits (`type: description`), no Co-Authored-By trailers.
- Localization: every user-facing string exists in all 8 locales
  (`src/locales/`), hand-written translations. "CLAUDE" stays untranslated.
  Summer terms are "Summer A" / "Summer B", never "Summer 1/2".
