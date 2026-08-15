# Co-op: the work term and the course it registers

Status: design, not built. Measured 2026-08-15 against the 2026 catalog
(7,966 courses) and the 1,017-program requirement corpus.

Every number below is reproducible with `scripts/coop-probe.js`.

---

## The problem in one sentence

NU Map models a co-op natively — a block that occupies semester slots, grants
`EX`, and zeroes the term's study load — and Northeastern *also* has co-op as a
real registrable course, which 140 programs name as a requirement. The bridge
between the two is one hardcoded string.

```js
// src/adapters/northeastern/specialTerms.js
courseGrants: ["COOP3945"],
```

That string is one cell of a table with 86 entries.

---

## What the catalog actually contains

**86 work-experience courses**, every one of them **0 SH**, partitioning
perfectly along two flags carried in the title, across 30 subject prefixes:

|            | domestic | abroad |
|------------|---------:|-------:|
| full-time  |       33 |     19 |
| half-time  |       19 |     15 |

A separate **26 courses** are co-op-*titled* but are ordinary classes you sit
in — `ENCP 2000 Introduction to Engineering Co-op Education`, `CS 1210
Professional Development for Khoury Co-op`, the CRIM integration seminars.
**The split is by title, not by number**: `ENCP 6100` and `ENCP 6954` differ
only in what the title says they are. These 26 are untouched by everything
below.

**Where the boundary is genuinely hard**, and why `derive-coop-courses.js`
prints its exclusions on every run: `EESC 6400 "Pre-co-op Work Experience"`
matches the work-term pattern on the words *co-op Work Experience*, but its
description is "…in order to **prepare for** graduate co-op" — the same
description as `BINF 6900 "Pre–Co-op Experience"`, which the pattern misses
only because that title happens to omit the word *Work*. Classifying on that
accident would have made one of them a registration and the other a class. The
classroom pattern therefore takes precedence, and the first run of the guard
caught exactly this. (An earlier draft of this document said 87 and 34; those
counts included `EESC 6400`.)

Undergraduate co-op registers under one central `COOP` subject. **Graduate
co-op registers under the program's own prefix** — `ENCP 6964` for all of the
College of Engineering, `CS 6964` for Khoury, `PPUA 6964` for policy. Only
**10 of the 86** are in subject `COOP` or `COP`, which is why no lookup keyed
on the co-op subject can work.

---

## How big the gap is

Across **152 co-op requirement nodes** in **139 programs** (a *node* is the
smallest choice a student makes: an `OR`/`XOM` whose options include a
work-experience course, or a bare `COURSE` that is one):

- **98 nodes (64%)** are satisfied by *any* co-op — the flags are irrelevant.
- **147 of 152** are satisfied by a plain full-time domestic co-op.
- **5 are not.** Three are one parser bug (Economics & Business Administration
  Oakland's `OR` flattened into a conjunction). One is a sibling node in an MBA
  section that has another satisfiable node. **International Business is the
  only genuine case in 1,017 programs.**

But the undergraduate picture is not where the damage is:

| | programs | nodes satisfied by `COOP3945` |
|---|---:|---:|
| undergraduate | 37 | 37 of 41 |
| graduate | ~99 | **0 of 111** |

`courseGrants: ["COOP3945"]` cannot satisfy `ENCP 6964`, so roughly a hundred
master's programs — 82 of them carrying a section literally titled *Optional
Co-op Experience* but encoded with `minRequirementCount: 2` — read permanently
unmet.

**The graduate hole is the feature. International Business is a detail.**

**But "closes ~99 graduate programs" would be an overclaim, and an earlier draft
made it.** Most of those sections are `minRequirementCount: 2` — MSIS's
*Optional Co-op Experience* wants `ENCP 6000` **and** one of
`ENCP 6954/6955/6964/6965`. The resolver satisfies the work-term half; the
companion professional-development course is an ordinary class the student
places, as it should be. Measured end to end with the shipped resolver and the
real allocator: **139 programs gain work-term satisfaction, and fully-satisfied
co-op sections go from 32 to 47.** The node-level figure (37 → 143) and the
section-level figure are different units and must not be quoted
interchangeably.

---

## The measurement that shaped the design

Departments write the co-op course and the co-op block as the same thing.

Across the 385 published sample plans there are **39 cells naming a COOP
course**. **All 39 sit in a term that also holds a co-op block.** Zero
exceptions. A department has never once scheduled a co-op course in a study
term; the course row exists because Banner needs a registration, not because
it is a separate thing to do.

(An earlier draft of this document said "51/51". That was wrong: 51 is the
count of code *mentions*, and one cell can list several codes. The cell count
is 39. The conclusion is unchanged; the number was not.)

---

## Design

### 1. Data — classify in the scrape

The scrape emits `public/northeastern/coop-courses.json`:

```json
{ "COOP3948": { "abroad": true,  "halfTime": false },
  "ENCP6954": { "abroad": false, "halfTime": true  } }
```

A sibling file, not a field on `catalog-courses.json` — that file is loaded by
the browser, the MCP server and the Cloudflare worker, and none of them need
this. Per the pipeline rule the classifier lives in the scrape scripts (both
undergraduate and graduate paths) so the monthly run cannot undo it.

### 2. State — one flag, defaulted

```js
{ typeId: "coop", semId, duration, abroad?: true }
```

Absent means domestic. One share-schema key, one `UPDATE_WORK_TERM` field.
Half-time is deliberately **not** here — see *Out of scope*.

### 3. Resolution — N blocks yield N keys

Replace the constant with a resolver over placed, in-timeline blocks:

> Each block emits the variant, **from the set of co-op courses this program
> names**, that matches its flags. If no such variant exists, or that key was
> already emitted, it emits the program's base (full-time domestic) variant
> instead.

Two properties matter and both were verified by running the real allocator.

**The subject is never asked and never stored.** Each requirement node lists
only the subjects its program uses, so matching by flags against the node's own
options picks `CS 6964` for a Khoury student and `ENCP 6954` for an engineer,
by elimination. That is what covers all ~99 graduate programs for free, and it
is the same by-elimination move slot binding already uses for placeholders.

**The base fallback is what makes multiple co-ops representable.** The
requirement layer is a `Set` of *base* course keys — `buildPlacedKeySet` maps
every placement through `courseMap` and emits `courseKey(subject, number)`, so
`COOP3948#2` is not representable and `repeatInstances` cannot help here. Two
identically-flagged blocks would collapse to one key. Emitting the base variant
for the second block is what prevents that, and it is *true*: a second abroad
co-op with nothing abroad-specific left to claim is still a co-op.

Verified against `allocateMajorSections` on International Business:

| plan | keys | International Experiential | Business Experiential |
|---|---|---|---|
| 0 co-ops | — | unmet | unmet |
| 1 domestic | `COOP3945` | unmet | **MET** |
| 1 abroad | `COOP3948` | **MET** | unmet |
| 1 abroad + 1 domestic | `3948, 3945` | **MET** | **MET** |
| 2 abroad (base fallback) | `3948, 3945` | **MET** | **MET** |

Every row is correct. One abroad co-op never satisfies both — `allocateSections`
runs a single global `used` set and neither IB section is `shared`, so the key
is consumed once. This was *run*, not read; a naive `.some()` harness reported
"1 abroad ⇒ both MET" and was wrong.

### 4. UI — three surfaces, one of them new

**Bank.** The 87 stop being listed. Searching `co-op` or `COOP 3948` returns the
**Co-op** work-term chip carrying one line: *COOP 3948 is recorded by placing a
work term.* Hiding them outright is the trap — a student told to register for
3948 must not conclude the app doesn't have it.

**Block card.** No new control. For 1,008 of 1,017 programs the card is
identical to today. A block flagged abroad shows an `International` tag,
display only.

**Requirement row — the single actuator.** The unmet
`International Experiential Learning` row offers *mark a work term as
international*, setting the flag on the chosen block (asking which, when there
are several). One place to set it, in the place the need is discovered. Not a
novel pattern here: the requirements panel is already a mutating surface —
`repeatInstances.js` treats a drag out of it as an add.

Location as a card field was considered and **rejected**: coupling it to
satisfaction means free-text silently deciding whether a degree is met.

**The grant must render as the co-op.** Today the key lands in `placedSet`
anonymously, so the row shows a checked course that exists nowhere in the plan.
Once the bank no longer carries it, the student has no way to connect it to
anything. The row should read `✓ Co-op · Spring 2027 · Acme`, using the same
*granted* treatment `grad.nupath.granted` already gives `EX`. **This is a
precondition for the bank change, not a follow-up.**

**The block names the course it registers, and that name is a link.** The card
carries a line — `Registers CS 6964 ↗` — that opens the ordinary course info
panel.

The reason is **inspectability, not richness.** Measured across the 86: **zero
carry offering sections, one has a prerequisite, one a corequisite, four carry
any NUPath**, and the 31 "distinct" descriptions are near-identical boilerplate
("Provides eligible students with an opportunity for work experience"). A co-op
course unlocks nothing — no course in the catalog depends on one. So the panel
is not worth opening for its content.

It is worth opening for two other things. The **repeat limit** is real,
program-relevant information and lives nowhere else: `repeatMax` on 25 of the
86, and titles that say "may be repeated up to five times" — which is exactly
the question *how many co-ops does my program allow?* And naming the resolved
course is what makes the derivation **checkable**: the student can see that the
app decided `CS 6964`, and go read it, without ever being asked to choose it.

This also settles the surface question left open earlier. The link works from
the block and from the requirement row, so the resolved course is visible in
both places without a control being added to either. The one risk is
re-importing the two-object confusion the bank change removes; the framing
carries it — *"Registers CS 6964"* is a fact **about** the block, not a second
thing to place.

### 5. Courses during co-op

Policy, verified: full-time co-op (32+ hrs) permits **one course**, no petition
when it doesn't conflict (after 5pm M–F, weekends, asynchronous); more than
4 credits requires the Petition Registration form; two courses needs co-op
coordinator, academic advisor and job supervisor, fall/spring only. Half-time
(16–31 hrs) treats multiple courses as normal.

Independently confirmed by the corpus: `shape.js` records **90 mixed co-op
terms across 42 programs at `targetSH {3:2, 4:86, 16:2}`** — reproduced exactly
from the plan data. NU's written rule and the departments' own plans give the
same number.

The two 16 SH outliers are **parse artifacts, not counterexamples**: Data
Science & Mathematics Year 3 Fall carries `DS 3500, DS 4200, MATH 2331, MATH
Elective` beside its co-op cell, and Political Science Year 4 Spring carries a
full four-course load. Those are study terms whose co-op cell is an
alternative, not terms in which anyone takes 16 SH while employed. Excluding
them, **88 of 88 legitimate mixed terms are ≤4 SH**.

**The cap is advisory and must never block.** This is established practice in
this codebase, not a new judgement — `repeatInstances.js` says it outright:
*"NU Map trusts the user: the repeat limit is never enforced, only reported."*
Two courses on a full-time co-op is permitted with three approvals, so an app
that refused to draw it would be wrong about the policy as well as
paternalistic. Over the cap, warn and name the petition; do not reject.

The strip is **always present** under a co-op card, and under the continuation
card of a six-month co-op — each semester carries its own allowance. Empty, it
is a thin dashed row reading *1 class · up to 4 SH*. That solves the
drop-target problem: the co-op card fills the slot row, so without a visible
strip there is nothing to drag onto and nowhere to put a drop indicator. It
also states the rule instead of rejecting you for breaking it.

Three code changes: `canDropSem` must accept course drops on co-op terms;
`getSemStudySH` must stop returning 0; the cap feeds the load calculation. The
cap itself belongs on the `specialTerms` type (`concurrentCap: { courses: 1,
sh: 4 }`) — it is an NU policy number, so it lives in the adapter, beside the
`creditValue` field that is declared in the port and currently read by nothing.

Two findings that make this smaller than it looks:

**`StatsPanel` is already written for it and the code is currently dead.** It
computes `isPureCoop: hasWork && sh === 0` — but `sh` comes from
`semesterLoad`, which routes through `getSemStudySH` and therefore returns 0
for *every* co-op term. The condition is a tautology today and only becomes
meaningful once concurrent courses count. Nothing to build there; it starts
working.

**The migration risk is real, and confirmed.** `isSlotOccupied` checks only
*other special terms*, never courses, so a co-op can be dropped onto a term
already holding a full load — parked courses are creatable today, not
hypothetical. State cannot distinguish "parked under a co-op" from
"deliberately taken during it": both are `courseId → semId`. So on first load
after this ships, up to 4 SH per co-op term begins counting. The strip makes
those courses *visible* rather than silently hidden, which is the mitigation,
but it is still a change to saved plans and belongs in the change log.

---

## Out of scope

**Half-time co-op.** `occupiesSlot: false` — a study term with a reduced cap,
not a work term with a class attached. Different layout, 34 of the 87 courses,
most of the graduate corpus. Folding it in doubles the surface area of
everything above. Until then half-time-only nodes stay unmet, as today.

**Two parser defects**, separately ticketed: Economics & Business Administration
(Oakland)'s `OR` flattened into a conjunction, unlike its Boston twin; and
Speech-Language Pathology & Audiology + Human Services' `XOM numCreditsMin: 5`
over 0 SH courses, which no co-op can ever satisfy.

---

## Stress test

### Dry run

One default (full-time domestic) co-op placed, across all 139 programs:

| | nodes satisfied |
|---|---:|
| today (`grant = COOP3945`) | 37 of 152 |
| under this design | **143 of 152** |

**106 newly satisfied, 0 regressions.** The remaining 9 are half-time-only
nodes and the two parser defects.

### Inversion — how this produces a *wrong* answer

**1. RANGE requirements capture graduate co-op keys.** `matchRange` *iterates*
`placedSet` rather than testing membership. **146 RANGE requirements across 97
programs** would capture a granted graduate co-op key — all of them `§Electives`
ranges like `CS 5100-7980`. **Zero catch `COOP3945`**, which is precisely why
the current design has never hit this; extending to graduate walks into it.

Severity is bounded but real: **145 of the 146 sit inside a credit-based `XOM`**
(`numCreditsMin`), and co-op courses are 0 SH, so they would be *listed* as
matched electives but cannot falsely satisfy. **One sits under an `OR`** and
could — Environmental Science and Policy MS (Boston), §*College of Social
Sciences and Humanities Elective List*, `PPUA 5100-7346`, which would capture
all four of `PPUA 6954/6955/6964/6965`. The general-elective sweep in
`requirementDemand.js` also iterates `placedSet`, but adds
`courseMap[key]?.sh ?? 0` — zero for these.

**But the real exposure is far smaller, and this was overstated on first
measurement.** 146 counts every RANGE that could catch *any* of the 87 keys. A
student grants exactly **one** key, drawn from their own program's option list.
Re-measured that way: **11 programs** have a RANGE that catches their own
granted key, **all 11 inside credit-based pools**, and **0 could falsely
satisfy anything**. The co-op would be *listed* among matched electives and
contribute its honest 0 SH.

**So the guard is cosmetic polish, not a prerequisite.** Granted keys should
eventually be excluded from `matchRange` and the general-elective sweep — the
existing `placedSet` / `realPlacedSet` split does *not* cover it, since
`matchRange` reads `placedSet` — but it does not block the resolver, and it
should not be bundled into the same change.

**2. Three divergent implementations of the grant.** ✅ **Fixed.**
`planModel.derivePlanSets`, `GradPanel` and `plannerQueryAdapter` each computed
it separately, and only `planModel` used `derivePlanSets` — the function whose
docstring exists so "two derivations disagree" cannot happen. Adding
program-dependent resolution to three call sites is how they drift apart. All
three now call `workTermGrants` in `core/specialTermUtils.js`, which returns
`{ planned, completed }`; `isCompleted` stays a parameter because the callers
genuinely disagree about which semesters count as done. `computeGrantedCourses`
has no callers left outside that one function.

**3. Program data is not available where the grant is computed.**
`derivePlanSets` runs at `planModel.js:438`; the major loads at line 449.
The MCP adapter has `majorJson` synchronously (`programData.get(id)`);
GradPanel has `major`. So the fix is a reordering in `planModel` — move the
`Promise.all` above the `derivePlanSets` call, which is safe today because
`derivePlanSets` does not currently use the major.

*Rejected alternative:* emit every flag-consistent key across all 30 subjects,
which needs no program data. Killed by finding #1 — it would drop four `CS 69xx`
keys into a CS student's elective RANGE.

**4. The base fallback cannot express "domestic only."** A program naming only
`BIOT 6964` will be satisfied by an abroad co-op, because the fallback fires
when no variant matches the block's flags. This is deliberate — refusing would
be a false negative for a student who has definitely done *a* co-op, in a
section titled *Optional Co-op Experience*. The cost is that a genuinely
domestic-only requirement could never be represented. No such requirement
exists in the corpus today.

**5. Title drift.** The classifier reads titles. If NU renames a variant, the
flag silently stops applying. Guard: the scrape asserts the 2×2 partition
covers every work-experience course and that the count does not shrink — the
same `scrape-rails` principle as `fetch-nupath`'s 5% rule.

**6. Migration: parked courses start counting.** State cannot distinguish
"parked under a co-op" from "deliberately taken during it" — both are
`courseId → semId`. Up to 4 SH per co-op term will begin counting in existing
plans. Bounded and defensible, but it is a silent change to saved plans and
belongs in the change log.

### Safety results (things that could have been wrong and are not)

- **`placedSet` never feeds prerequisite evaluation** — no reference in
  `prereqEval.js` or `candidates.js`.
- **Zero courses in the catalog have a co-op work-experience course as a
  prereq or coreq**, so a granted key cannot unlock anything.
- **0 regressions** in the corpus dry run.
- Sample-plan application already collapses `COOP\d` cells into blocks and
  keeps the codes (`plan-grid.js`), so nothing there needs changing.

---

## Sequence

1. ✅ **Built** — `scripts/derive-coop-courses.js` → `coop-courses.json`.
   Dry-run by default; guards refuse to write on a credit-bearing work-term
   course or a >20% shrink, and print the classroom/registration boundary on
   every run. **Not yet wired into `update-courses.yml`** — that workflow
   pushes to main unattended, so adding the step needs a human's approval.
2. ✅ **Built** — `workTermGrants` in `core/specialTermUtils.js`. All three call
   sites collapsed onto one derivation, so the resolver has exactly one place to
   learn about programs. Behaviour-preserving.
3. ✅ **Built** — `coopOptionsInPrograms` + resolution inside `workTermGrants`.
   The catalog adapter stamps `{ abroad, halfTime }` onto the 86 courses from
   `coop-courses.json`, so the flags ride on `courseMap` and reach every
   consumer synchronously; a missing file degrades to the old single grant.
   `planModel` now loads its programs *before* deriving plan sets. 16 hostile
   unit tests in `coop-resolver.test.js`.

   **Provenance did NOT ship with it, and an earlier draft of this document
   said it had to.** That was too strong. Before: a graduate student sees
   "unmet", which is wrong. After: "✓ ENCP 6964", which is right but opaque —
   no worse than the opacity undergraduates have lived with since the COOP 3945
   bridge landed. Strictly better, so not a precondition. It is still the next
   thing to do, and it is blocked only on the locale files being free.
4. Bank removal + search redirect + `Registers … ↗` on the block
5. Requirement-row actuator + the `abroad` flag
6. Courses during co-op
7. Drop co-op courses from CHART's cell set — which retires open defect #16
   (a `COOP 3948` cell placed in Year 1 Fall) rather than patching it

Steps 1–4 give ~99 graduate programs a satisfiable work-term requirement and
touch almost no student-visible UI.
The `grantedKeys` RANGE guard is deliberately *not* on this path — measured at
11 exposed programs and 0 able to falsely satisfy, it is its own later ticket.

## Decide before step 3

`test/invariant/coop-requirements-corpus.test.js` currently **asserts** that the
abroad and half-time sections stay unmet. That pin is the existing design;
rewriting it is the decision, not a test fix.

## Still open

- Whether one abroad co-op should satisfy both IB sections. This design says no
  (verified above). No evidence either way about IB's intent — catalog text or
  an advisor, not a probe.
- The Petition Registration form mechanics came from a D'Amore-McKim page, which
  is one college. Verify per-college before shipping copy that names a form.
- Whether removing co-op cells from CHART disturbs the International Business
  8-SH cheapest-option bug documented at `demand.js:305-320`, which depends on
  `COOP 3945` being an option.

## Sources

- <https://catalog.northeastern.edu/undergraduate/academic-policies-procedures/cooperative-education/>
- <https://www.khoury.northeastern.edu/undergraduate-co-op-policies/>
- <https://damore-mckim.northeastern.edu/resources/petition-registration-form/>
- <https://coe.northeastern.edu/academics-experiential-learning/co-op-experiential-learning/co-op/undergraduate-co-op/>
