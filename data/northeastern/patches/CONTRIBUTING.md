# Course Data Update Guide

## Overview

Course data (`public/all-courses.json`) comes from the [ninest/nu-courses](https://github.com/ninest/nu-courses) API and is bundled with the app for offline use.

Majors and minors come from the `graduatenu/` directory (a local fork of [sandboxnu/graduatenu](https://github.com/sandboxnu/graduatenu)).

---

## Annual Course Refresh (full resync)

Run once a year (fall registration opens, ~April):

```bash
# 1. Fetch fresh snapshot — review the diff before writing
node scripts/fetch-courses.js

# 2. If the diff looks right, write it
node scripts/fetch-courses.js --write

# 3. Re-apply local patches on top
node scripts/apply-patches.js --write

# 4. Build and verify
npm run build
```

Open a PR with the updated `public/all-courses.json`. GitHub Actions will automatically post a diff summary as a PR comment.

---

## Manual Corrections (incremental patches)

When a specific course is wrong, missing, or needs early removal:

1. Copy `data/patches/TEMPLATE.yaml` to a new file: `data/patches/YYYY-MM-DD_short-description.yaml`
2. Fill in only the sections you need (`add`, `update`, or `remove`).
3. Run validation locally:
   ```bash
   node scripts/validate-patches.js
   ```
4. Preview changes:
   ```bash
   node scripts/apply-patches.js
   ```
5. Open a PR. GitHub Actions will validate and post a diff summary.

---

## Updating Majors / Minors

Major and minor requirement files live in:
```
graduatenu/packages/api/src/major/majors/
graduatenu/packages/api/src/minor/minors/
```

Each major has a `parsed.initial.json` containing its semester plan and requirement groups.

To update:
1. Edit the relevant `parsed.initial.json` directly.
2. Open a PR. GitHub Actions will list which major files changed.
3. Once merged, the app automatically picks up changes on next `npm run build`.

---

## npm Scripts

| Command | What it does |
|---------|-------------|
| `npm run data:fetch` | Dry-run fetch — shows diff, no write |
| `npm run data:fetch:write` | Fetch and overwrite `all-courses.json` |
| `npm run data:patch` | Dry-run apply patches — shows changes |
| `npm run data:patch:write` | Apply patches and overwrite |
| `npm run data:validate` | Validate all patch files (used by CI) |
| `npm run data:update` | Full update: fetch --write + patch --write |

---

## Patch File Format

See `TEMPLATE.yaml` for a fully annotated example.

### Required fields for `add`:
- `subject` — 2–6 uppercase letters (e.g. `CS`)
- `number` — 4-digit string (e.g. `"2500"`)
- `title` — course title
- `credits` — positive number

### NUPath codes
`ND` `EI` `IC` `FQ` `SI` `AD` `DD` `ER` `CE` `WI` `EX`

### scheduleType values
`Lecture` `Lab` `Seminar` `Studio` `Individual Instruction` `Off-campus instruction`
