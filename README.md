# NU Map

An unofficial, browser-based degree planner for Northeastern University. Drag courses onto a semester grid, check graduation requirements against your plan, and export a PDF. No backend, no login — plans live in your browser.

> Not affiliated with or endorsed by Northeastern University. Course data is collected from public sources on a schedule and may be outdated or incomplete. Always verify your plan with your academic advisor and DegreeWorks.

**Live:** https://numap.app/
**Story & principles:** https://numap.app/story
**Mirror:** https://nayugu.github.io/nu-map/

---

## Features

- Drag-and-drop semester planning with co-op and internship blocks, touch/mobile support, and current-semester tracking
- Prereq/coreq checking as you place courses
- Graduation requirements panel — majors, concentrations, minors, NUPath
- Course details: offering history by semester, seat statistics from past terms, typical meeting patterns, and which instructors have taught each semester (last 3 years)
- Multiple named plans; import/export as JSON; PDF export
- 8 interface languages, dark/light themes, auto-save, Cmd+Z undo
- An optional AI integration (Claude) exists behind explicit opt-in in settings; it is off by default and nothing in the app requires it

---

## Data for AI assistants (llms.txt)

NU Map publishes its public catalog data as small human-readable pages under
**[numap.app/data](https://numap.app/data)** — every course with prerequisites,
offering history and professors; every major and minor with requirements; NUpath;
equivalences — free, no auth, no rate limits. The pages are the primary machine
surface too (plain text, fully expanded, every reference a link); AI assistants
should start at the guide, **[numap.app/llms.txt](https://numap.app/llms.txt)**.
A structured JSON API for developers lives under `numap.app/data/json`, and
everything is mirrored at
[nayugu.github.io/nu-map/llms.txt](https://nayugu.github.io/nu-map/llms.txt).

---

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # output → dist/
```

---

## Architecture

Institution-specific logic lives in adapters (`src/adapters/northeastern/`); the rest of the app has no NU-specific imports.

```
Adapters (NU-specific)       →  Ports (contracts)  →  Core + UI (institution-agnostic)
src/adapters/northeastern/      src/ports/I*.js       src/core/, src/ui/
```

UI components read adapters via `usePort()`; core functions receive adapter config as explicit parameters. Forking for another university means writing a new adapter set against the same ports.

---

## Data pipeline

Data refreshes automatically via GitHub Actions:

| Workflow | Cadence | Covers |
|---|---|---|
| `update-courses.yml` | Monthly | Full catalog scrape (titles, descriptions, credits, prereqs), NUPath from the Registrar's Tableau dashboard, Banner term availability and enrollment, instructors, manual patches |
| `update-majors.yml` / `update-grad-majors.yml` | Every two months | Undergraduate / graduate program requirements, cross-checked against the catalog before the push (see [`docs/verification-report.md`](docs/verification-report.md)) |

`catalog-rotate.yml` and `update-nupath.yml` are superseded by the monthly scrape and kept for manual cross-checks only.

### Source hierarchy

Authority is **per field**, not a single ranking — each source is definitive for
different things, and no source covers everything:

| Field | Authoritative source | Fallback |
|---|---|---|
| NUPath designations | Tableau (Registrar's NUpath dashboard) | Catalog, additive only |
| Titles, descriptions, credits, prereqs/coreqs | Catalog course pages | — |
| Sections, terms, seats, instructors | Banner SSB | — |
| Major/minor requirements | Catalog Program Requirements pane | **none — see below** |

Degree requirements are the one field with **no second source**. Banner exposes
no program endpoints, Degree Works and the CourseLeaf admin are SSO-gated, and
the per-page PDF is the same render as the HTML. So `npm run data:verify`
performs internal-consistency checking, not source triangulation: it confirms
we parsed the catalog faithfully, and cannot confirm the catalog is right. Each
program carries a verdict — green (fully corroborated by the catalog's own
sample plan), grey (checks pass but no sample plan exists to check against), or
amber (known discrepancies) — surfaced in the UI and in `audit_requirements`.

Two rules keep a weaker source from degrading a stronger one:

1. **Capability** — a source may only remove a code it is able to express. The
   catalog prints just 11 of the 13 NUPath codes (never `WF` or `WD`), so its
   silence about those two is not evidence of absence.
2. **Trust** — only the authoritative source for a field may remove anything.
   The catalog runs as the NUPath fallback when Tableau is unreachable, and in
   that role it can add designations but never delete them.

Tableau needs no rotation: it is a single CSV covering every NUPath-bearing
course, so the monthly job refreshes all of it in one request.

Manual commands for local data work:

```bash
npm run data:scrape:write   # catalog scrape → all-courses.json
npm run data:patch:write    # re-apply YAML corrections from data/patches/
npm run data:validate       # validate patches (dry run: data:patch)
```

Data corrections belong in the scrape scripts or `data/northeastern/patches/` — anything else is overwritten by the next scheduled run. See [`data/northeastern/patches/PATCH-FORMAT.md`](data/northeastern/patches/PATCH-FORMAT.md) for the patch format.

---

## Dev portal

- **Remote** (`https://numap.app/northeastern/dev.html`) — read-only view of the deployed data: change log, patches, data sources.
- **Local** (`http://localhost:5173/northeastern/dev.html`) — run catalog checks and review diffs; changes stay on your machine until pushed.

---

## Testing

```bash
npm test            # scrape/merge logic, major-file integrity, live catalog check
```

---

## Deployment

Push to `main` → GitHub Actions publishes `dist/` to the `gh-pages` branch (mirror), and Cloudflare Pages deploys `numap.app`.

---

## Data sources

| Source | Provides | Cadence |
|---|---|---|
| [catalog.northeastern.edu](https://catalog.northeastern.edu/course-descriptions/) | Titles, descriptions, credits, prereqs/coreqs; NUPath fallback (11 of 13 codes, additive only) | Monthly (automated) |
| [nubanner.neu.edu](https://nubanner.neu.edu) (Banner SSB) | Term availability, enrollment, instructors | Monthly (automated) |
| [tableau.northeastern.edu](https://tableau.northeastern.edu) | NUPath designations — authoritative, all 13 codes | Monthly (automated) |
| [catalog.northeastern.edu](https://catalog.northeastern.edu/) (program pages) | Major/minor/grad requirement JSON | Every two months (automated) |

---

## License

NU Map is **dual-licensed**.

- **Free under [AGPL-3.0](LICENSE)** — use it, study it, modify it, run your own copy, fork it for another university. No fee, no need to ask. Two conditions: keep the attribution notice visible ([`NOTICE`](NOTICE)), and if you run a modified version as a service for others, share your source with them.
- **[Commercial license](COMMERCIAL.md)** — for building something closed-source on it. Schools pay $1 per enrolled student per year, counted from their public IPEDS filing. Companies and individuals pay by the trailing-twelve-month revenue of the product containing NU Map, and pay nothing below $10k — that tier is a one-time self-certification, no contract. Annual, with a perpetual fallback so nothing you ship can be taken away.

Note that the AGPL already permits commercial use *with* source disclosure — the paid license buys relief from disclosure, not permission to earn revenue. The full terms are in [`LICENSING.md`](LICENSING.md); contributor terms are in [`CONTRIBUTING.md`](CONTRIBUTING.md).

The **"NU Map" name, logo, and domains are not licensed**. Forks are welcome — the architecture is built for them — but must ship under their own name.

---

## Credits

| | |
|---|---|
| **Original course data & prereq schema** | [ninest/nu-courses](https://github.com/ninest/nu-courses) by [@ninest](https://github.com/ninest) — seeded the initial course snapshot, since superseded by our own catalog + Banner scrapers |
| **Major2 schema & original requirements data** | [sandboxnu/graduatenu](https://github.com/sandboxnu/graduatenu) by [@denniwang](https://github.com/denniwang) and [Sandbox](https://github.com/sandboxnu) |
| **Built with** | [Claude](https://www.anthropic.com/claude) (Anthropic) |
