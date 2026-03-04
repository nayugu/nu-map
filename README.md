# NU Map

An unofficial, browser-based degree planner for Northeastern University. Drag courses onto a semester timeline, validate graduation requirements, and export a PDF. No backend, no login.

> Not affiliated with or endorsed by Northeastern University. Always verify your plan with an advisor and DegreeWorks.

**Live site:** https://numap.netlify.app/ · **Backup:** https://nayugu.github.io/nu-map/

---

## What it does

- **Drag-and-drop planning** across a trimmed semester timeline (set your entry/grad dates, add co-op blocks, mark your current semester)
- **Live prereq/coreq validation** with SVG overlay lines: red for wrong order, yellow for misplaced coreqs
- **Graduation requirements panel:** pick your major, concentration, and minors; sections, AND/OR groups, and elective pools validate live against your placed courses
- **NUPath tracking:** 13-attribute grid shows which NUPath requirements your plan covers
- **Course info panel:** full details, interactive prerequisite chips (click to navigate, drag to place)
- **PDF export:** one-page graduation summary + full semester schedule, auto-closes after print
- **Dark / light themes**, auto-save to `localStorage`, undo with Cmd+Z

---

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # output → dist/
```

The app loads `public/all-courses.json` on startup. To bundle a local snapshot:

```bash
curl https://husker.vercel.app/courses/all -o public/all-courses.json
```

---

## Keeping data up to date

All data changes must be reviewed and approved before merging. Automated workflows open pull requests — never push data directly to `main`.

See [`data/patches/CONTRIBUTING.md`](data/patches/CONTRIBUTING.md) for the full manual-patch workflow.

### Automated catalog scraping (every 3 days)

The `.github/workflows/catalog-rotate.yml` workflow scrapes one subject per run from [catalog.northeastern.edu](https://catalog.northeastern.edu/course-descriptions/), rotating through all ~130 subjects. Each run:

1. Overlays catalog fields (title, description, credits, NUPath, prereqs/coreqs) onto `all-courses.json`
2. **Preserves** sections/terms data from the SearchNEU enrollment snapshot
3. Produces a field-level diff (per-course, per-field before → after)
4. Opens a PR with the full scrape log — **developer must approve before merge**

Rotation state is tracked in `data/scrape-state.json`. To run manually:

```bash
npm run data:scrape:rotate          # dry run — shows what would change
npm run data:scrape:rotate:write    # write changes + advance rotation index
```

### Annual course refresh (~April, before fall registration)

```bash
npm run data:fetch          # preview diff from SearchNEU API
npm run data:fetch:write    # write fresh all-courses.json
npm run data:patch:write    # re-apply local corrections
npm run build               # verify, then open a PR
```

### Manual corrections (any time)

Copy `data/patches/TEMPLATE.yaml`, fill in `add`/`update`/`remove` entries, then open a PR. GitHub Actions validates and posts a diff summary.

```bash
npm run data:validate   # validate all patches locally
npm run data:patch      # preview what would change
```

### Updating majors / minors

Edit files under `graduatenu/packages/api/src/major/majors/` or `.../minor/minors/` directly, then open a PR.

---

## Developer portal

A password-protected admin UI is served at `/dev.html` (https://numap.netlify.app/dev.html).

Tabs:
- **Dashboard** — course count, last-updated timestamp, quick-copy npm commands, links to GitHub
- **Change Log** — full history of every rotate scrape run: fields changed per course, courses added/removed, rotation status
- **Course Patches** — form UI to generate `add`/`update`/`remove` YAML patches with download
- **Preview** — in-portal iframe with phone/tablet/desktop sizing
- **Data Sources** — source table and update workflow guide

First login sets the password (stored as a SHA-256 hash in `localStorage` — never sent anywhere).

---

## Testing

```bash
npm run test          # all tests (unit + live scrape)
npm run test:unit     # 34 unit tests — merge logic, diffCourse, change-log format (no network)
npm run test:live     # live CS 2100 scrape against catalog.northeastern.edu
```

---

## Deployment

| Host | URL | Trigger |
|---|---|---|
| Netlify (primary) | https://numap.netlify.app/ | Push to `main` (auto) |
| GitHub Pages (backup) | https://nayugu.github.io/nu-map/ | Push to `main` via `deploy-pages.yml` |

**GitHub Pages one-time setup:** Settings → Pages → Source → "Deploy from a branch" → `gh-pages` / `/` → Save.

---

## Data sources

| Source | Provides | Updated |
|---|---|---|
| [catalog.northeastern.edu](https://catalog.northeastern.edu/course-descriptions/) | Titles, descriptions, credits, NUPath, prereqs/coreqs | Every 3 days (rotating) |
| [ninest/nu-courses](https://github.com/ninest/nu-courses) (SearchNEU) | Live sections, term availability | Each semester |
| [sandboxnu/graduatenu](https://github.com/sandboxnu/graduatenu) | Major/minor requirement JSON | Ad hoc |

---

## Credits

| | |
|---|---|
| **Course catalog** | [ninest/nu-courses](https://github.com/ninest/nu-courses), built and maintained by [@ninest](https://github.com/ninest) |
| **Graduation requirements** | [sandboxnu/graduatenu](https://github.com/sandboxnu/graduatenu), built by [@denniwang](https://github.com/denniwang) and [Sandbox](https://github.com/sandboxnu) |
| **Built with** | [Claude Sonnet 4.6](https://www.anthropic.com/claude) (Anthropic) |
