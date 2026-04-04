# NU Map

An unofficial, browser-based degree planner for Northeastern University. Drag courses onto a semester grid, validate graduation requirements live, and export a PDF. No backend, no login.

> Not affiliated with or endorsed by Northeastern University. Always verify your plan with an advisor and DegreeWorks.

**Live:** https://nayugu.github.io/nu-map/  
**Documentation:** https://nayugu.github.io/nu-map/documentation/

---

## Features

- Drag-and-drop semester planning with co-op and internship blocks, touch/mobile support, and current-semester tracking
- Live prereq/coreq validation (SVG overlay lines)
- Graduation requirements panel — majors, concentrations, minors, NUPath
- Course info panel with interactive prereq chips
- Multiple named plans — create, switch, and delete independent degree plans
- Import/export plans as JSON — share between devices or send to an advisor
- PDF export, dark/light themes, auto-save, Cmd+Z undo

---

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173 + catalog check server on :3333
npm run build    # output → dist/
```

For a full code walkthrough — every module, state shape, and interaction — see the **[developer documentation](https://nayugu.github.io/nu-map/documentation/)**.

---

## Dev portal

**Remote** (`https://nayugu.github.io/nu-map/dev.html`) — read-only view of what's currently deployed. Use it to check the change log, browse patches and data sources, or preview the live site. Nothing you do here affects the repo.

**Local** (`http://localhost:5173/dev.html`, after `npm run dev`) — the full portal. Run the catalog check, apply fixes, and review diffs. Changes stay on your machine until you explicitly push from the Work tab.

---

## Data commands

```bash
# Annual refresh (~April, before fall registration)
npm run data:fetch:write    # pull fresh course data from SearchNEU
npm run data:patch:write    # re-apply local YAML corrections
npm run build

# Scrape titles/credits/prereqs from catalog.northeastern.edu
npm run data:scrape:write   # merge latest scrape into all-courses.json
npm run build

# Manual patch workflow
npm run data:validate       # validate all patches in data/patches/
npm run data:patch          # preview what would change (dry run)
```

All data updates are manual — there is no automated scraper. Run Catalog Check or NUPath Update from the local dev portal, then push via the Work tab. Rotation state (for manual use of `data:scrape:rotate`) is in `data/scrape-state.json`. Each run is logged in `public/change-log.json` (capped at 600 entries, ~4.5 years of history).

See [`data/patches/CONTRIBUTING.md`](data/patches/CONTRIBUTING.md) for the manual patch format.

---

## Testing

```bash
npm run test:unit   # 34 unit tests — merge logic, diffCourse, change-log format
npm run test:live   # live CS 2100 scrape against catalog.northeastern.edu
npm run test        # both
```

---

## Deployment

Push to `main` → GitHub Actions builds and deploys to GitHub Pages (`gh-pages` branch) and Netlify auto-deploys the mirror.

---

## Data sources

| Source | Provides | Cadence |
|---|---|---|
| [catalog.northeastern.edu](https://catalog.northeastern.edu/course-descriptions/) | Titles, descriptions, credits, prereqs/coreqs, scheduleType | Manual — `npm run data:scrape:write` |
| [tableau.northeastern.edu](https://tableau.northeastern.edu) | NUPath attribute designations (authoritative) | Manual — `npm run data:nupath` |
| [ninest/nu-courses](https://github.com/ninest/nu-courses) (SearchNEU) | Sections, term availability | Manual — `npm run data:fetch:write` |
| [sandboxnu/graduatenu](https://github.com/sandboxnu/graduatenu) | Major/minor requirement JSON | Ad hoc |

---

## Credits

| | |
|---|---|
| **Course catalog** | [ninest/nu-courses](https://github.com/ninest/nu-courses) by [@ninest](https://github.com/ninest) |
| **Graduation requirements** | [sandboxnu/graduatenu](https://github.com/sandboxnu/graduatenu) by [@denniwang](https://github.com/denniwang) and [Sandbox](https://github.com/sandboxnu) |
| **Built with** | [Claude Sonnet 4.6](https://www.anthropic.com/claude) (Anthropic) |
