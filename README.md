# NU Map

An unofficial, browser-based degree planner for Northeastern University. Drag courses onto a semester grid, validate graduation requirements live, and export a PDF. No backend, no login.

> Not affiliated with or endorsed by Northeastern University. Always verify your plan with an advisor and DegreeWorks.

**Live:** https://nayugu.github.io/nu-map/  
**Dev portal:** https://nayugu.github.io/nu-map/dev.html  
**Mirror:** https://numap.netlify.app/

---

## Features

- Drag-and-drop semester planning with co-op blocks and current-semester tracking
- Live prereq/coreq validation (SVG overlay lines)
- Graduation requirements panel — majors, concentrations, minors, NUPath
- Course info panel with interactive prereq chips
- PDF export, dark/light themes, auto-save, Cmd+Z undo

---

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173 + catalog check server on :3333
npm run build    # output → dist/
```

---

## Dev portal

There are two ways to access the dev portal (`/dev.html`):

**Remote** (`https://nayugu.github.io/nu-map/dev.html`) — the deployed version, password-protected. Useful for checking the current change log, browsing patches and data sources, and previewing the live site. Work tools (catalog check, applying fixes, pushing to GitHub) are not available here.

**Local** (`http://localhost:5173/dev.html`, after `npm run dev`) — the full portal. No password required on localhost. Includes everything in the remote version plus the Work tab: run the catalog check against `catalog.northeastern.edu`, apply fixes, review diffs, and push to GitHub. The catalog check server starts automatically with `npm run dev` and streams results over SSE on port 3333.

To set or change the remote password (PBKDF2-SHA256, 300k iterations):

```bash
npm run dev:pw   # interactive — generates a hash to paste into public/dev.html PW_HASH
```

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

Automated scraping rotates through all ~130 subjects every 3 days via GitHub Actions, opening a PR for developer review. Rotation state is in `data/scrape-state.json`.

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
| [catalog.northeastern.edu](https://catalog.northeastern.edu/course-descriptions/) | Titles, descriptions, credits, NUPath, prereqs/coreqs | Every 3 days |
| [ninest/nu-courses](https://github.com/ninest/nu-courses) (SearchNEU) | Sections, term availability | Each semester |
| [sandboxnu/graduatenu](https://github.com/sandboxnu/graduatenu) | Major/minor requirement JSON | Ad hoc |

---

## Credits

| | |
|---|---|
| **Course catalog** | [ninest/nu-courses](https://github.com/ninest/nu-courses) by [@ninest](https://github.com/ninest) |
| **Graduation requirements** | [sandboxnu/graduatenu](https://github.com/sandboxnu/graduatenu) by [@denniwang](https://github.com/denniwang) and [Sandbox](https://github.com/sandboxnu) |
| **Built with** | [Claude Sonnet 4.6](https://www.anthropic.com/claude) (Anthropic) |
