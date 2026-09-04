# Frozen course-catalog editions

Source material, not a shipped artifact. Nothing in `src/` reads this tree yet —
see `docs/catalog-editions-design.md`.

Each `<year>/catalog-courses.json` is a complete course snapshot for one catalog
edition, labelled by its **END** year (the 2025-2026 catalog is `2026`), matching
the `data/northeastern/programs/*/<year>/` convention.

## What is held

| edition | courses | source |
|---|---|---|
| 2023 (2022-2023) | 7,449 | archive |
| 2024 (2023-2024) | 7,654 | archive |
| 2025 (2024-2025) | 7,561 | archive — the newest the archive publishes |
| 2026 (2025-2026) | 7,966 | our own live scrape; **exists nowhere else** |

A **contiguous** run, and that is the property that matters rather than the
count: `lifespan.lastEdition` is exact for any course retired inside the window,
because there is no edition between two we hold where a course could have
quietly reappeared. `firstEdition` is still only a FLOOR — a course published
since 2015 reads as `2023` — which is why nothing in `src/` renders it.

Note the counts are **not monotonic** (7,449 → 7,654 → 7,561 → 7,966). The
catalog does not simply grow, so any rail that assumes it does is wrong; the
floor check in `runEdition` compares against the NEAREST edition for that reason.

2022 and older are published by NEU but are `descriptive` fidelity — no
prerequisites, no corequisites, no attribute lines, and a title format the
parser does not match, so they would yield an EMPTY snapshot.
`scrape-catalog.js --edition` refuses them outright rather than writing one.

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

## How an archive edition is captured

```
CATALOG_HTML_CACHE=.cache/catalog-editions \
  node scripts/scrape-catalog.js --edition 2024-2025 --dry-run   # 3 subjects, check the markup
  node scripts/scrape-catalog.js --edition 2024-2025             # full run, reports, writes nothing
  node scripts/scrape-catalog.js --edition 2024-2025 --write     # freeze it
```

Set the cache. The three editions above cost **679 requests / ~8 minutes**
once; with the cache warm the `--write` pass made **zero** network requests, so
a parser fix is a re-parse rather than a re-scrape. Never set it in CI.

`runEdition` can reach only this directory — it refuses to run alongside
`--merge`, `--rotate` or `--subjects`, and `test/unit/catalog-edition-scrape.test.js`
fingerprints every live artifact to prove it. Add the manifest entry by hand
afterwards; the run prints a reminder.

## Rules

- These files are FROZEN. Nothing regenerates them; a scrape must never write
  here. Losing one is irreversible.
- A snapshot is self-contained by design (no overlay, no merge) so its
  provenance can be checked in isolation — the same property that makes
  `test/invariant/archive-editions.test.js` possible for the program trees.
- `manifest.json` records what each edition is and how it got here. An edition
  present on disk but absent from the manifest is unexplained data; treat that
  as a bug, not as a file to delete.
