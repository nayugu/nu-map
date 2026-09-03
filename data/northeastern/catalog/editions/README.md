# Frozen course-catalog editions

Source material, not a shipped artifact. Nothing in `src/` reads this tree yet —
see `docs/catalog-editions-design.md`.

Each `<year>/catalog-courses.json` is a complete course snapshot for one catalog
edition, labelled by its **END** year (the 2025-2026 catalog is `2026`), matching
the `data/northeastern/programs/*/<year>/` convention.

## Why 2026 is here and why it matters

`/archive/2025-2026/` **does not exist on catalog.northeastern.edu.** The archive
runs 2016-2017 → 2024-2025 and the live site serves 2026-2027, so that edition
was never published as browsable HTML — only as a
[PDF](https://catalog.northeastern.edu/pdf/Northeastern%20University%202025-2026%20Course%20Descriptions.pdf).

`public/northeastern/catalog-courses.json` **was** that edition, captured while
it was live. The monthly scrape REPLACES that file, so this copy exists to stop
the only machine-readable copy of a catalog year from being overwritten by a
routine cron job.

Provenance, verified rather than assumed: CS 2500 is present in the 2024-2025
archive, absent here, and absent from live 2026-2027 — so this snapshot sits on
the far side of the roll that retired it. `node scripts/edition-probe.js
--course CS2500` reproduces that.

## The operational rule this tree encodes

**Capture the live edition before it rolls. The archive is not a safety net.**
It lags, and it has already skipped one year. An edition we fail to capture
while live may be recoverable only from a PDF, or not at all.

## Rules

- These files are FROZEN. Nothing regenerates them; a scrape must never write
  here. Losing one is irreversible.
- A snapshot is self-contained by design (no overlay, no merge) so its
  provenance can be checked in isolation — the same property that makes
  `test/invariant/archive-editions.test.js` possible for the program trees.
- `manifest.json` records what each edition is and how it got here. An edition
  present on disk but absent from the manifest is unexplained data; treat that
  as a bug, not as a file to delete.
