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

1. **The archived program editions carry a bug we have already fixed, and
   their program ids do not match live.** This entry previously said the
   mismatch was the on-disk SHAPE — live is one `requirements.json` per program
   (896 files), archive is one bundle per college (9 files), and the loader glob
   matches only the first. That is true, and it is the cosmetic half. The
   bundles are `{slug: record}` whose records carry the same keys as a live
   `requirements.json`, so exploding them is a loop.

   The blocking half is IDENTITY, measured 2026-09-03 over archive 2025 against
   live 2026:

   | | count |
   |---|---|
   | archive slugs | 852 |
   | match a live slug exactly | **175** |
   | match only after dropping the campus suffix | 654 |
   | …of which **one archive slug → 2+ live programs** | **89** |
   | match neither way | 23 |

   Those 89 are the pre-variant flattening: the archive was scraped before
   `program-variants.js` existed, so a page publishing Boston and Oakland
   variants was collapsed into one program. That is precisely the defect
   CLAUDE.md records fixing — *159 phantom requirement sections across 35
   programs*, 42 pages with the wrong credit total — frozen into committed data.

   **So the six editions must be RE-SCRAPED from the archive URLs with the
   current parser, not converted.** Converting would ship known-wrong
   requirements under ids that cannot resolve against a student's current
   program anyway. Note the cost this adds: `shared-sections.json` is adjudicated
   per catalog (`ADJUDICATED_EDITION`) and an unfound title hard-stops the run,
   so each edition needs its own adjudication pass.
2. **Payload, on the PROGRAM side only.** `programs-bundle.json` is 6.6 MB, of
   which `programData` is 6.1 MB and the index only **517 KB**, so seven
   editions is ~45 MB of program data. The browser is fine (lazy globs), but
   `cloudflare/mcp-server/src/loadData.js` fetches the bundle **wholesale**.
   Multi-edition must not mean multi-edition-eagerly-loaded.
   The course side does **not** contribute to this: under §5b/§6 it ships one
   current catalog plus a ~1.2 MB retired union, not seven snapshots.

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

Two consolations, and the second was only visible after §5b.

**The descriptive era ages out by itself.** The window is anchored to the live
edition, so as it slides 2021–2027 → 2022–2028, the degraded era leaves the
window in 2029 with no code change.

**And it is needed for far less than this section implies.** Under §5b, history
only supplies a retired course's LAST record, so the pre-2022 markup is
required solely for courses that died in the 2021→2022 roll — not for reading
five old editions in full. Check whether that set is even non-empty before
building the bare-credits parser (§8, step 11). The `fidelity` rule above
stands regardless, because it governs how any degraded record is displayed.

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

## 5b. What follows the entry year, and what follows the current catalog

**This is the governing decision. Everything downstream — storage, scope, the
UI, how far back we scrape — follows from it, and nothing should be decided
before it.**

The split is not uniform across data types, and treating it as uniform is what
produced two contradictory versions of §6:

| Question a student is really asking | Governed by | Why |
|---|---|---|
| What must I complete for my degree? | **Entry edition** | Requirements are genuinely locked to the catalog you entered under. We already hold 7 editions. |
| Can I register for this next spring? | **Current catalog** | The registrar enforces prerequisites, credits and standing at registration, under the catalog in force then. |
| Does this course still exist? What was it called? | **Lifespan** | Needs history. This is the CS 2500 problem, and it is the only thing that does. |

Consequences, all of which shrink the build:

- The planner keeps using **current** prereqs, credits and offerings. No
  historical mechanics reach the engine.
- History is needed only to answer *existence* and *identity over time*, which
  is a lifespan index plus a last-known record — not seven full course
  snapshots (§6).
- The **descriptive era matters far less than §4 implies.** Since only a
  retired course's LAST record is needed, the pre-2022 markup is required only
  for courses that died in the 2021→2022 roll. Small set, and it leaves the
  window entirely in 2029.
- Retirement is a fact about existence, so it is independent of all of the
  above and can ship first (§8, Milestone A).

### Status of the underlying claim

The policy says *"Students are expected to meet prerequisites as listed in the
course description of each course **in which they enroll**"*
([Registration and Taking Courses](https://catalog.northeastern.edu/undergraduate/academic-policies-procedures/registration-taking-courses/)),
present tense, in the 2026-2027 edition. That is **consistent with** the reading
above but does not state it outright, and NEU is thin on exactly these
statements (§1). Adopted as a decision on 2026-09-03 rather than a proven fact.

If it ever turns out a department honours entry-year prerequisites for a
continuing student, the retired-union model still holds unchanged — only the
"current mechanics always" rule gains an exception. That asymmetry is why it was
safe to decide without waiting.

---

## 6. Storage shape

> **This section was written twice, and the first version was wrong in an
> instructive way.** It opened "DECIDED: a snapshot per edition" and chose
> between two storage layouts using a drift measurement — before §5b had
> settled *which data is edition-scoped at all*. That is backwards: storage is
> downstream of the requirement, so the decision flipped as soon as the
> requirement was pinned. The measurement below is still good; the conclusion
> it was used for was premature. Settle what a system must answer before
> choosing how to store it.

Given §5b, the course side does **not** need seven full snapshots. It needs to
answer exactly two historical questions:

1. *Did this course exist in edition N?* → a **lifespan index**.
2. *What was it, if it no longer exists?* → a **last-known record**.

Everything else about a course — prereqs, credits, offerings — comes from the
current catalog, because that is what the registrar enforces (§5b).

### The shape

- `public/northeastern/catalog-courses.json` — the current catalog, unchanged.
- **A retired-course union** — every course that existed in the window and is
  not in the current catalog, each carrying its last-known record, the edition
  that last published it, and that record's `fidelity`.
- **A lifespan index** — `{ key → { firstEdition, lastEdition, editions[] } }`
  over the window, for current and retired courses alike.

This is a **disjoint union, not an overlay**: a key is either current or
retired, never both, so there is no field-level merge and no reconciliation
step. That matters, because the strongest objection to the overlay design was
that a merge resolved wrongly yields a well-formed record with the wrong
prerequisites — the exact defect shape this project keeps paying for. A
disjoint union cannot produce that.

### Size, derived rather than measured

Six subjects hold 678 of ~7,966 courses (8.5%) and lost 27 in one roll, so
~317 retire per roll catalog-wide, ~1,900 over six rolls before subtracting
reappearances. At ~620 bytes/course that is roughly **1.2 MB, against 34 MB for
seven snapshots.** Worth confirming with `edition-probe.js` before building,
but the gap is a factor of 25, not a rounding difference.

The frozen per-edition snapshots in `data/northeastern/catalog/editions/`
remain the **source** these are derived from, and stay full snapshots — they
are archival material, not a shipped artifact, and their self-containment is
what lets provenance be checked in isolation (§5b, and the property that makes
`test/invariant/archive-editions.test.js` possible for the program trees).

### The measurement that informed this

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

Three readings, and the third corrects a claim this document made in its first
version.

1. **Membership churn is real and roughly symmetric** — 27 out and 28 in on one
   roll, against 651 stable. That churn IS the retired union; it is the whole
   reason the lifespan index exists.
2. **Credits, coreqs and nuPath did not move at all** (0.0% across 651
   courses). This is what makes §5b affordable rather than merely defensible.
   The strongest case for carrying full historical records was "a course was
   4 SH then and 3 SH now, and the audit should count 4" — and empirically that
   case barely arises.
3. **Prereqs are the most volatile field at 3.7%, and the first version of this
   document pointed that finding the wrong way.** It argued prereq drift meant
   "edition inaccuracy produces a wrong plan", i.e. that we needed historical
   prereqs. The opposite follows. A prerequisite is enforced at registration
   under the catalog in force *then* (§5b), so today's prereqs are the correct
   ones for any future term, and a completed course's prereq is moot. The 3.7%
   is therefore a measure of **how wrong we would be if we fed a reconstructed
   old edition's prereqs to the planner** — an argument against historical
   prereqs in the engine, not for them.

Caveat on the evidence: this is ONE adjacent pair over six subjects, and the
2024→2025 leg of the same run died on a transient `fetch failed`. Do not quote
5.1% as a per-roll constant without re-taking it across more pairs.

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
  Note this is the ONE place historical course *mechanics* are shown, and it is
  display only: a retired course cannot be registered for, so showing its last
  prereqs contradicts nothing in §5b. They are labelled with the edition they
  came from, never presented as current.
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
2. **Measure edition drift.** ✅ *Done 2026-09-03* — see §6.
   `scripts/edition-probe.js` is the committed instrument.
3. **Preserve edition 2026 before the next roll.** ✅ *Done 2026-09-03* —
   `data/northeastern/catalog/editions/2026/`, the only copy in existence (§5).

### Milestone A — retirement becomes truthful

Ships alone, needs **no year picker**, and improves the app for *every*
student rather than only continuing ones. This is the CS 2500 fix.

4. **`--edition` on `scrape-catalog.js`**, reusing `catalog-edition.js`
   (`parseEditionArg`, `editionBasePath`, `assertEdition`) so the per-page
   provenance assertion is shared, writing into
   `data/northeastern/catalog/editions/<year>/` and **never** able to overwrite
   `catalog-courses.json`.
5. **Backfill editions 2022–2025** from the archive, one rail-guarded run per
   edition. ~230 subjects x 400 ms is ~90 s of fetching each.
6. ~~**Derive the retired union + lifespan index** (§6) and ship them.~~
   **DONE, 2026-09-03** — `scripts/derive-retired-union.js` →
   `public/northeastern/retired-courses.json`, merged by `mergeRetiredUnion`
   in `courseNorm.js` and read by all three loaders (browser, Node MCP,
   worker). Step 2b-i½ of `update-courses.yml`, after the scrape so the union
   is disjoint from retention's rescued courses.

   Done ahead of steps 4–5 deliberately, and the reason is a deadline rather
   than a preference: **the roll lands on 1 October**, when the monthly scrape
   first pulls the 2026-2027 catalog, and `course-retention.js:245`
   (`if (!need.has(key)) { dropped.push(key); continue; }`) then deletes every
   retired course no shipped program requires. It needs no archive work at
   all — the "before" side is the snapshot already frozen at
   `data/northeastern/catalog/editions/2026/`, and the "after" side is live.

   Sized over all 227 subjects (`edition-probe --snapshot --editions 2027
   --all-subjects`): **974** of our 7,966 courses are absent from live 2027,
   plus **115** in 10 subjects with no live page at all (DGTR 33, EAI 16,
   HLS 14, PTH 12, SMT 10, RFA 7, AFRS 6, IS 6, RPT 6, CJS 5) — ~**1,089**
   retirements. That corroborates CLAUDE.md's independent simulation of the
   same roll (703 retained + 367 dropped = 1,070) within ~2%, by a different
   method. Caveat worth keeping: 974 removals against **923 additions** is
   suspiciously balanced, so some fraction is *renumbering* rather than
   retirement. That does not change the storage — a renumbered course is still
   a course a plan can name — but it does mean 1,089 overstates the harm, and
   it must never become a reason to synthesize a successor (§2).

   What the 367 actually cost was measured in the browser rather than
   reasoned about (`test/browser/retired-course.browser.test.js`): a plan
   holding a course the catalog lacks **opens with no error and no recovery
   screen**, the rest of the board renders, and the course is simply gone —
   no card, no notice, and `totalSHPlaced` sums
   `effectiveCourseMap[id]?.sh ?? 0`, so its credits become zero.
   PlannerContext says it outright: *"unknown ids resolve to 0"*. A **silent
   subtraction from a degree**, which is degrading to wrong information, not
   to less.

   Two notes for whoever touches this next:
   - The derivation reports **0 courses** against the repo today, correctly —
     the frozen 2026 snapshot *is* the shipped catalog. So the code that
     matters is exercised by nothing until the roll runs unattended. The pure
     function is separated from its IO and the roll is **simulated** in
     `test/unit/retired-union.test.js` against the real 7,966-course snapshot.
     `mutation-probe.js --only union:` covers it, 5/5 — and it earned its
     keep immediately, catching that the `retired`/`retiredSince` strip was
     deletable because the pre-roll snapshot carries neither field, so the
     assertion guarding it passed trivially.
   - Retired courses are **not filtered out of search**. That is not an
     oversight but it is not a decision either: nothing filtered `retired`
     before this change, so retention's rescued courses are already
     browsable. Whether ~1,089 extra records is real noise is worth measuring
     *after* the roll, when there is something to measure. Deciding it now,
     against an empty file, would be speculation.
7. **Retirement UI** (§7) — lifespan copy naming the edition, full last-known
   record, fidelity gating, all 8 locales. **Partly shipped**: the badge and
   tooltip exist in all 8 locales and `normalizeCourse` now carries `lifespan`
   through to the card.

   ⚠ **BLOCKER — the tooltip is FALSE for union courses, and this ships the
   moment the roll lands.** There are two populations of retired course and
   one string:

   > "Northeastern's catalog no longer lists this course. It's kept because
   > **your catalog year still requires it** — ask your advisor about a
   > substitution."

   - a **retention** rescue (~703 on the measured roll) is kept precisely
     because a shipped program edition requires it. True.
   - a **union** course (~367) is required by nothing. It is kept only so a
     saved plan that already names it still resolves. The sentence is false,
     and since nothing filters `retired` out of search, it is false on a card
     any student can browse to.

   Two things follow, and they are separate decisions:
   1. **The copy must distinguish them**, which is decidable from the record
      itself: a union course carries `lifespan`, a retention rescue carries
      `retiredSince`. With the lifespan the union case can also do what §7
      wanted anyway — name the edition ("last published in the 2025–2026
      catalog") instead of a date that is a fact about our scrape.
   2. **A union course arguably does not belong in SEARCH at all.** This was
      deferred as "measure the noise after the roll", and the copy bug sharpens
      it into a correctness question rather than a volume one: a retention
      rescue is required by a program, so a student may legitimately need to
      add it, whereas a union course is required by nothing and exists solely
      to resolve a plan that ALREADY names it. Offering it as something to add
      is offering a course NEU no longer teaches and no program wants. Note
      this does not by itself fix (1) — a student holding one in their plan
      still sees the tooltip.

   Not fixed in the same pass only because a partner session held all eight
   locale files uncommitted; staging them would have swept their work into this
   change. **Do not ship the union to production before (1).**
8. **Guards for A**: the union is derived and never hand-edited; a retired
   course never gains a substitute; `fidelity` is respected wherever an empty
   field is read.

### Milestone B — the student picks their catalog year

9. **Re-scrape the six archived program editions** with the current parser
   (`scrape-majors.js --edition`), writing per-program files the loader's glob
   already matches. NOT a conversion of the committed bundles: 89 of their 852
   slugs are pre-variant flattenings of campus variants, i.e. the 159-phantom-
   section bug frozen in data (§3). Budget an adjudication pass over
   `shared-sections.json` per edition.
10. **Edition-aware runtime** — feed `pickCatalogYear` a real list, lazy
    per-edition loading, and fix the MCP worker's wholesale 6.6 MB bundle fetch.
11. **Descriptive-era reading**, *if still needed* — only for courses that died
    in the 2021→2022 roll (§5b). Re-check whether the set is non-empty before
    building it; it leaves the window in 2029 regardless.
12. **Guards for B**: extend `catalog-covers-programs` per edition; an invariant
    that every shipped program edition can be resolved; a `data-staleness`
    check that the live edition was captured before it rolled (§5).

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

*Resolved 2026-09-03: "which edition does a course record inside a plan belong
to" is answered by §5b — requirements by entry edition, mechanics current,
history only for existence. It is left here as a pointer because it was the
question whose absence produced two contradictory versions of §6.*

- **Is the descriptive era needed at all?** (§8 step 11.) Decidable by counting
  the courses that died in the 2021→2022 roll and are named by a shipped
  program edition. If that set is empty, the bare-credits parser is never built.
- **Do `course-equivalences.json`, `plan-order.json` and `early-donors.json`
  need an edition key?** All three are derived from the current program/course
  pair.
- **The §5b claim is adopted, not proven** — NEU states prerequisites are met
  "as listed in the course description of each course in which they enroll" but
  never says which catalog year. Worth confirming with the registrar; the
  failure mode if wrong is bounded (§5b).
- **When the window slides past an archived edition**, the oldest *archived*
  edition is the right one to retire, not the oldest live one, and it is
  unrecoverable. `prune-catalog-years.js` already says this; courses make it
  sharper.
