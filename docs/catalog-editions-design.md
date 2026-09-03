# Catalog editions — across-year support

Design of record for showing a student the catalog **they entered under**, not
the one that happens to be live.

Status: design. Step 1 (course-parser extraction) landed 2026-09-03.
Instrument: `node scripts/edition-probe.js` (see §9).

---

## 1. What we are fixing

A degree is locked to a catalog edition. Program requirements already know
this — `data/northeastern/programs/<tree>/<year>/…` is edition-partitioned and
the year is inside every program id. The **course catalog is not**:
`public/northeastern/catalog-courses.json` is a single CURRENT snapshot that is
REPLACED, not merged.

That asymmetry is the whole bug class. Measured on the live 2027 roll: **3,660
dangling course references across 579 of 651 programs**. `course-retention.js`
closes it going *forward* by unioning back any course a shipped edition still
names. It cannot look *backward*: a course that died before our data begins is
simply absent, which is why **CS 2500 shows no "retired" badge — we never had
it**. It existed in 2024-25 (with CS 2510, 2511, 2810, 3500, 3501, 3540) and
NEU replaced the sequence with CS 2000/2100.

So across-year support means: *hold N editions of both halves, and resolve
every question against the student's edition.*

### The policy, as actually written

There is no single "catalog of record" statement at NEU. I looked; it does not
exist. The rule is assembled, and it is **not uniform**:

| Situation | Rule |
|---|---|
| Continuing students | *"Students who enrolled in their programs prior to fall 2026 should consult **previous versions of the Northeastern academic catalogs**, their academic advisors, and/or their degree audit reports for their specific requirements."* |
| UG readmission | Requirements **in the current catalog** |
| CPS return | **Most current** curriculum |
| Grad Engineering | *"Catalog year of entry does not change"* — original admission year, **unless** readmitted after withdrawal, then current |
| A required course is discontinued | **No policy exists.** Generic course-substitution route: advisor + program director + the department that offered the original course |

Two consequences, both load-bearing:

1. **The catalog itself instructs students to consult prior editions.** This
   feature is NEU's own advice, in NEU's own words.
2. **A retired course has no encodable resolution.** No equivalency table, no
   automatic substitution, no sunset schedule — it is a human conversation. So
   our job is to *state the fact precisely* and **never invent a replacement**.
   That is why the shipped design badges rather than substitutes, and it must
   stay that way.

Because the readmission rules disagree with each other by college, the app must
treat the edition as a **student-supplied fact**, not something it derives. We
can default it from the cohort year and let it be changed; we must not compute
it and present it as authoritative.

---

## 2. Vocabulary

- **Edition** — one catalog year, labelled by its **END** year. The 2025-2026
  catalog is edition `2026`. This already matches
  `data/northeastern/programs/*/<year>/` and `parseEditionArg`.
- **Live edition** — what `catalog.northeastern.edu/` serves now: **2027**.
- **Window** — the editions we ship. `KEEP_YEARS = 7`, sized in
  `prune-catalog-years.js` from the longest realistic path (5-year co-op degree,
  plus a leave or an extra co-op cycle, plus a year of margin). Today that is
  **2021–2027**.
- **Fidelity** — `full` or `descriptive`; see §4.

---

## 3. What exists already (do not rebuild it)

Far more than expected. The *program* half is largely built and starved of data.

| Piece | Where | State |
|---|---|---|
| 6 archived program editions, 2020–2025 | `data/northeastern/programs/archive/` (27 MB) | **Scraped, committed, never shipped** |
| Live program edition | `…/programs/{undergraduate,graduate}/2026/` | Shipped |
| Per-edition scrape | `--edition` on `scrape-majors.js`, `scrape-grad-majors.js` | Works |
| Edition provenance guard | `scripts/lib/catalog-edition.js` + `test/invariant/archive-editions.test.js` | Works |
| Cohort → edition selection | `pickCatalogYear(years, cohortYear)` — greatest edition ≤ cohort | **Built + unit-tested** |
| Edition rewriting | `withCatalogYear(id, year)` | Built |
| Stale-path recovery | `resolveInMap`, 4 tiers, prefers closest edition ≤ requested | Built |
| Year in program identity | `2026/college/slug`, `grad/2026/college/slug` — **0 of 1,071 ids lack a year** | Done |
| Loader globs | `**/requirements.json` — year-agnostic, picks up new editions automatically | Done |
| Retention across a roll | `scripts/lib/course-retention.js` | Shipped |
| Deletion guard | `prune-catalog-years.js` (manual only, refuses below KEEP_YEARS) | Works |

**The course half has none of this.** `scrape-catalog.js` has no `--edition`
at all, and there is no historical course data.

### Two structural mismatches to reconcile

1. **The two program trees have different on-disk shapes.** Live is one
   `requirements.json` per program (896 files). Archive is one bundle per
   college (9 files). The loader glob only matches the first — *this is why six
   scraped editions are invisible to the app.*
2. **Payload.** `programs-bundle.json` is 6.6 MB, of which `programData` is
   6.1 MB and the index only **517 KB**. Seven editions is ~45 MB of program
   data plus ~34 MB of course catalogs. The browser is fine (lazy globs), but
   `cloudflare/mcp-server/src/loadData.js` fetches the bundle **wholesale**.
   Multi-edition must not mean multi-edition-eagerly-loaded.

---

## 4. The hard constraint: two markup eras

Measured 2026-09-03 by `edition-probe.js --fidelity` over six subjects
(cs, math, biol, eece, engw, phys), ~2,000 course blocks per edition:

```
  edition  blocks  parsed  prereqLines  coreqLines  attrLines  fidelity
  2020       1941       0            0           0          0  descriptive
  2021       2034       0            0           0          0  descriptive
  2022       1864     675          319          71        124  full          ← boundary
  2023       1870     678          322          68        124  full
  2025       1908     689          333          69        128  full
```

Two readings of that table matter. First, the boundary is a property of the
CATALOG, not of one subject — it holds across all six. Second, **the
descriptive era parses to literally zero**: the regex rejection below is
measured, not theoretical.

(`blocks` overcounts, because `[class*='courseblock']` also matches the nested
title and description elements. It is a raw presence signal, not a course
count — do not quote it as one.)

- **Editions ≥ 2022 are `full`**: parenthesised credits, plus
  `Prerequisite(s)`, `Corequisite(s)`, `Attribute(s)`.
- **Editions ≤ 2021 are `descriptive`**: title, credits and description only.
  Zero prereq lines, zero attribute lines, and credits print **bare**
  (`4 Hours.`) rather than parenthesised (`(4 Hours)`).

Two things follow.

**The current title regex rejects the entire descriptive era.** It requires
`\((\d+…)\s+Hours?\)` or `N SH`. On a 2019-20 page it matches nothing and the
page silently yields zero courses. Reading that era is an explicit, tested
change — never an assumption that it already works.

**An empty field in the descriptive era means "unpublished", not "none".**
This is the `knownTermCodes` distinction again, and it is the most dangerous
thing in this document: a planner that reads unpublished-as-none will happily
schedule a course *before the courses it actually requires*. So:

- every historical course record carries `fidelity: "full" | "descriptive"`;
- **nothing may infer absence from an empty field on a `descriptive` record** —
  not the prereq engine, not CHART, not the audit, not the info panel;
- the UI says *"the 2020–2021 catalog did not publish prerequisites"*, never an
  empty list.

The consolation: **the descriptive era ages out by itself.** The window is
anchored to the live edition, so as it slides 2021–2027 → 2022–2028, the
degraded era leaves the window in 2029 with no code change. It is worth
carrying tiering for that finite period rather than either dropping two
editions or pretending they are complete.

---

## 5. Source pathways

**Primary: CourseLeaf `/archive/{start}-{end}/`.** Sitemaps 200 on every
edition; identical markup; every page carries a `"2016-2017 Edition"` banner,
so `assertEdition` works unchanged. Subject counts are plausible (254 / 222 /
230 across 2019/2022/2025 vs 232 live). Available: **2016-17 → 2024-25**.

**The archive lags, and it can skip an edition.** Live is 2026-27; the archive
ends at 2024-25. **2025-2026 exists nowhere on CourseLeaf** — it is published
only as a [PDF](https://catalog.northeastern.edu/pdf/Northeastern%20University%202025-2026%20Course%20Descriptions.pdf),
and the registrar points "web course descriptions" at Banner instead. We are
covered only because we scraped it while it was live (our `2026/` tree).

> **Operational rule: capture the live edition before it rolls. The archive is
> not a safety net.** This belongs in the runbook, not in someone's memory,
> because the failure is silent and has a period of one year.

### ⚠ We are currently holding the only copy of edition 2026

`public/northeastern/catalog-courses.json` **is** the 2025-2026 course catalog —
it was scraped before the 2027 roll. Since `/archive/2025-2026/` does not exist,
that file is the only machine-readable copy of that edition anywhere outside
NEU's PDF.

Proof it is 2026 and not 2027: CS 2500 is present in the 2024-25 archive,
absent from this file, and absent from the live 2027 catalog — so this file
sits on the far side of the roll that retired it. `edition-probe.js --course
CS2500` reports exactly that, and dates the retirement to the 2024-2025
catalog.

It is committed, so git history holds it and the situation is not an emergency.
But it is one `git checkout` away from being a thing someone has to *know* to
go looking for, and the monthly scrape REPLACES the file. Promoting it to a
first-class edition snapshot is the cheapest irreversible-loss prevention
available here, and it should happen before the next roll rather than as part
of step 5.

**Secondary: Banner.** 60 terms back to Spring 2022 — but section-level and
per-term, so it answers "did this course *run*", never "what did the catalog
*say*". Useful as corroboration for a course's lifespan and nothing else.
`term-history.json` already covers 13 terms (202360–202660) for 4,726 courses.

**Refused: the PDFs.** A different parser, a different failure mode, for one
edition we already hold. If we ever lose an edition we never captured, this is
the escalation path — not the default.

---

## 6. Storage shape — DECIDED: a snapshot per edition

The question was whether editions differ mostly in **membership** (which
courses exist) or also in **field values**, since that is what decides between:

- **(A) Snapshot per edition** — `…/editions/<year>/catalog-courses.json`.
  Simple, immutable, ~34 MB for 7. Lazily fetched per edition.
- **(B) Current snapshot + per-edition overlay** — store only what differs.
  Smaller, but every read becomes a merge.

Measured by `edition-probe.js --drift --editions 2023,2024,2025` over the six
sample subjects:

```
  membership   2023: 678   2024: 679   stable: 651   added: 28   removed: 27

  field drift over the 651 stable courses
    title           8   (1.2%)
    credits         0   (0.0%)
    creditsMax      0   (0.0%)
    description     8   (1.2%)
    scheduleType    0   (0.0%)
    prereqs        24   (3.7%)
    coreqs          0   (0.0%)
    nuPath          0   (0.0%)

  ANY field changed: 33 of 651 (5.1%)
  → a snapshot stores 679; an overlay stores 61 (added + changed) + 27 tombstones
```

**Decision: (A), snapshots.** An overlay is roughly 8x smaller per edition
(88 records against 679), and that saving is still not worth taking, because
the measurement shows what it does and does not buy:

1. **Runtime cost is identical.** Only ONE edition is ever loaded in a session,
   so the browser fetches ~4.9 MB either way. The overlay saves repo and build
   size, not the thing a student waits for.
2. **The repo already accepts this pattern at this scale** — the program
   archive is 27 MB of full per-edition snapshots, and
   `test/invariant/archive-editions.test.js` can check a frozen snapshot's
   provenance precisely *because* it is self-contained.
3. **A merge step is an invisible failure class.** An overlay resolved wrongly
   produces a well-formed course record with the wrong prerequisites, which is
   the exact shape of defect this project keeps paying for. Conservative beats
   clever, and the clever option's only prize is disk.

The drift numbers carry a second, more important finding: **prereqs are the
most volatile field, at 3.7% — three times the rate of titles or
descriptions, while credits, coreqs and nuPath did not move at all.** Prereqs
are what the planner acts on, so edition-inaccuracy here produces a wrong
*plan*, not a cosmetically wrong label. That is the argument for doing this
properly rather than approximating an old edition with today's course data.

Caveat on the evidence: this is ONE adjacent pair over six subjects. The
2024→2025 leg of the same run died on a transient `fetch failed`, and the
figures above should be re-taken across more pairs before anyone quotes 5.1%
as a per-roll constant. It is enough to decide A-vs-B, which is all it was
run for.

Independent of A/B, one derived artifact is definitely wanted:

**A course lifespan index.** `{ key → { firstEdition, lastEdition, editions[] } }`
over the window. This is what turns "retired" from a boolean into a fact, and
it is small (7,966 keys × a few numbers).

---

## 7. Retirement, restated as a lifespan

Today `retired` is a boolean stamped by `course-retention.js`. With editions it
becomes relational, and **the question is only ever answerable relative to a
student's edition**:

```
retiredFor(courseKey, studentEdition):
  present in studentEdition?          → not retired; render that edition's record
  absent from studentEdition?         → not their course at all
  present in studentEdition, absent from live
                                      → RETIRED FOR THEM. Say which edition
                                        last published it.
```

Consequences:

- **Name the edition, never lump.** "Last published in the **2024–2025**
  catalog", not "Retired". A boolean cannot express that a course which died in
  2026 is irrelevant to a 2023 student and central to a 2026 one.
- **Render the full record from the last edition that had it** — title, credits,
  description, prereqs, coreqs, NUPath — so a retired course is as informative
  as a live one, which is the explicit goal. Plus `term-history` and offering
  data, which are term-indexed and already historical, so they need nothing.
- **Fidelity gates the panel** (§4). A course whose last edition is
  `descriptive` shows "this edition did not publish prerequisites", not an
  empty list.
- **Never suggest a substitute.** NEU has no rule (§1); inventing one would be
  us making an advising decision. State the fact, name the edition, point at
  the substitution process.
- The badge stays a *fact*, not a blocker — same rule as the 2× badge and the
  minor cap: it never un-allocates and never refuses a plan.

---

## 8. Build order

Each step must be independently shippable and independently verifiable.

1. **Extract the course parser.** ✅ *Landed 2026-09-03.*
   `scripts/lib/catalog-course-parser.js`. A second caller now exists, and a
   byte-identical copy in two scripts is how a fix lands in one path only — the
   lesson `catalog-program-parser.js` already paid for. Proved verbatim by a
   body-level diff showing only the two intended deltas (`SUBJECT` became a
   parameter; the three hard-space regexes hoisted to one named `NBSP`).
   Nine imports orphaned by the move were removed. Verified on a live page:
   188 CS courses, correct credits/NUPath/description.
2. **Measure edition drift.** ✅ *Done 2026-09-03* — see §6. Decided snapshots
   over overlays, and found that prereqs drift 3x faster than any other field.
   `scripts/edition-probe.js` is the committed instrument.
2b. **Preserve edition 2026 before the next roll** (§5) — the only copy, and
   the cheapest irreversible-loss prevention on this list.
3. **`--edition` on `scrape-catalog.js`**, reusing `catalog-edition.js`
   (`parseEditionArg`, `editionBasePath`, `assertEdition`) so the per-page
   provenance assertion is shared, plus an edition-scoped output path that
   **cannot** overwrite `catalog-courses.json`.
4. **Descriptive-era reading** — the bare-credits title form, `fidelity` on
   every record, and a test that a descriptive record's empty `prereqs` is
   never read as "none".
5. **Backfill 2021–2026 course editions**, one rail-guarded run per edition.
6. **Reconcile the two program tree shapes** so the archive's six editions
   become visible to the loader at all (§3).
7. **Edition-aware runtime** — feed `pickCatalogYear` a real list; lazy
   per-edition loading for both catalogs; fix the MCP worker's wholesale
   bundle fetch.
8. **Lifespan index + retirement UI** (§7), incl. all 8 locales.
9. **Guards**: extend `catalog-covers-programs` per edition; an invariant that
   every shipped program edition has a course edition to resolve against; a
   `data-staleness` check that the live edition was captured before it rolled
   (§5).

---

## 9. Instrument

`scripts/edition-probe.js` — the committed instrument for every question in
this document, so the next edition question does not pay full price again (six
`*probe*` scripts already accreted from not doing this).

It must answer, over a named subject sample or the whole catalog:

- **membership drift** per edition pair: added, removed, stable;
- **field drift** on the stable set: which of title / credits / description /
  prereqs / coreqs / nuPath actually change, and how often;
- **fidelity** per edition, measured rather than assumed from §4's table;
- **lifespan** for a named course (`--course CS2500`) — which editions had it.

Sample by default; whole-catalog is opt-in and needs a reason, per the
verification rules. A 230-subject × 7-edition sweep is ~1,600 fetches at 400 ms
and must never be the default.

---

## 10. Open questions

- **Which edition does a *course* record inside a plan belong to?** A plan spans
  years; a student takes a course as it existed *when they took it*. Probably
  the plan's edition governs the audit and the term governs the offering, but
  this is unresolved and it is where a subtle wrong number could reach a
  student.
- **Do `course-equivalences.json`, `plan-order.json` and `early-donors.json`
  need an edition key?** All three are derived from the current program/course
  pair.
- **2025-2026 recovery** if our `2026/` tree is ever lost — PDF only (§5).
- **When the window slides past an archived edition**, the oldest *archived*
  edition is the right one to retire, not the oldest live one, and it is
  unrecoverable. `prune-catalog-years.js` already says this; courses make it
  sharper.
