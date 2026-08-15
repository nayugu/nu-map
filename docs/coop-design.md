# Co-op: the work term and the course it registers

Status: **built**, and it does not do what the first draft of this document
designed. Measured 2026-08-15 against the 2026 catalog (7,966 courses) and the
1,017-program requirement corpus.

Every number below is reproducible with `scripts/coop-probe.js`.

## What changed after the design, and why

Two things in this document were designed, built, and then removed. Both are
described in place below with the correction attached, so a reader arriving at
the old reasoning meets the answer rather than the mistake.

1. **The resolver that inferred the course is gone.** It read the student's
   program, took the work-term courses that program names, and picked one per
   block by matching flags. It was clever and it was wrong: it chose an option
   that *fit* rather than the one that was *true*, so a student whose co-op
   registered something their section does not accept saw the requirement tick
   anyway. A co-op now registers **only** the course the student names on the
   card, and an unfilled block registers nothing. This also retired the
   `courseGrants: ["COOP3945"]` default, which is the same error at smaller
   scale.
2. **The requirement-row actuator is gone.** *Mark a work term as
   international* was one button in one place, and it was the wrong shape: it
   made the student answer a question about a requirement when what they
   actually know is a course number. The card's course field answers it
   directly.

The classification, the bank change, the concurrent-course rules and the
provenance rendering all shipped as designed. **Internships mirror co-op**
throughout — see §6.

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

**92 work-experience courses**, every one of them **0 SH**, partitioning
perfectly along two flags carried in the title, across 31 subject prefixes:

|            | domestic | abroad |
|------------|---------:|-------:|
| full-time  |       37 |     20 |
| half-time  |       20 |     15 |

87 are recorded by the **co-op** block, 5 by the **internship** block (§6).

A separate **76 courses** are co-op- or internship-*titled* but are ordinary
classes you sit in — `ENCP 2000 Introduction to Engineering Co-op Education`,
`CS 1210 Professional Development for Khoury Co-op`, the CRIM integration
seminars, and the 35 departmental `*994 Internship` courses. **The split is by
title, not by number**: `ENCP 6100` and `ENCP 6954` differ only in what the
title says they are. These 76 are untouched by everything below.

**Is the split real, or are we hiding classes?** Asked directly, and the answer
is measurable: of the 113 co-op-titled courses in the catalog, **23 carry
credit and every one of them is placeable** — the professional-development
seminars (1 SH), the CRIM integration seminars, and `EXED 6959 Cooperative
Education Integrated Experience` (4 SH), which is a *companion* class taken
alongside a co-op and is exactly the concurrent-course case of §5. **Zero
credit-bearing courses are hidden**, and the zero-credit guard in
`derive-coop-courses.js` is what keeps that true on every monthly run. The
partition holds in both directions: registrations are 0 SH, classes carry
credit.

**Asking it the other way round found a real miss.** "Are we leaving a
registration placeable?" turned up `CS 8948/8949 Research Work Experience`
(0 SH, PhD), whose description reads "Doctoral students register for this
course before starting their off-campus internship". No program names them, so
nothing was ever reported wrong — they were simply two draggable cards that
record a work term. Now classified. The remaining judged exclusion is
`BUSN 6970 Professional Projects` (0 SH), which is 10–40 hours of remote
micro-internship *alongside* coursework — explicitly not a full-time block, so
it stays a placeable course.

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

**One title the catalog cannot decide on its own**, and the single place credit
enters the classification: a bare `Internship`. 37 courses carry it — two are
0 SH registrations (`COP 5002`, `PPUA 6861`, the latter "an approved public- or
nonprofit-sector internship that fulfills academic degree requirements"), and
35 are the departmental `*994 Internship` courses at 4 SH each, which a student
pays tuition for and really does place. No wording separates them. That branch
therefore consults credit, which is a deliberate weakening of "classify by
title": the alternative is hiding 35 credit-bearing courses (140 SH between
them) or leaving two registrations placeable. It does not weaken the zero-credit
guard, which still governs everything matched by title.

Undergraduate co-op registers under one central `COOP` subject. **Graduate
co-op registers under the program's own prefix** — `ENCP 6964` for all of the
College of Engineering, `CS 6964` for Khoury, `PPUA 6964` for policy. Only
**11 of the 92** are in subject `COOP` or `COP`, which is why no lookup keyed
on the co-op subject can work — and why the picker orders a student's own
program's options first.

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
{ "COOP3948": { "abroad": true,  "halfTime": false, "kind": "coop"   },
  "ENCP6954": { "abroad": false, "halfTime": true,  "kind": "coop"   },
  "COOP3949": { "abroad": false, "halfTime": false, "kind": "intern" } }
```

`kind` says which BLOCK records the course, and is what scopes each card's
picker. A file written before the field existed reads as `coop`, which is the
pre-internship behaviour unchanged.

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

### 3. Resolution — the student names the course, or there is none

**This section replaces a design that was built and removed.** The original is
kept below the rule, because the reason it failed is the most useful thing in
this document.

> A placed, in-timeline block whose type declares `registersCourse` emits the
> single key stored in its `courseId`. A block with no `courseId` emits
> nothing. Blocks resolve in timeline order, so the answer never depends on the
> order they were dragged.

That is the whole rule. `EX` is unaffected — it is a property of *doing* a
co-op, not of which course records it, so an unfilled block still grants it.

<details>
<summary>The resolver that was removed, and why</summary>

It emitted, per block, the variant **from the set of co-op courses this program
names** that matched the block's flags — falling back to the program's base
(full-time domestic) variant when the matching key was already taken. Two
properties were verified against the real allocator, and both were true:

*The subject was never asked and never stored.* Each requirement node lists
only the subjects its program uses, so matching by flags against the node's own
options picked `CS 6964` for a Khoury student and `ENCP 6954` for an engineer,
by elimination — covering all ~99 graduate programs without a question.

*The base fallback made multiple co-ops representable.* The requirement layer
is a `Set` of *base* course keys — `buildPlacedKeySet` maps every placement
through `courseMap` and emits `courseKey(subject, number)`, so `COOP3948#2` is
not representable and `repeatInstances` cannot help. Two identically-flagged
blocks collapsed to one key; emitting the base variant for the second prevented
that.

| plan | keys | International Experiential | Business Experiential |
|---|---|---|---|
| 0 co-ops | — | unmet | unmet |
| 1 domestic | `COOP3945` | unmet | **MET** |
| 1 abroad | `COOP3948` | **MET** | unmet |
| 1 abroad + 1 domestic | `3948, 3945` | **MET** | **MET** |
| 2 abroad (base fallback) | `3948, 3945` | **MET** | **MET** |

Every row there is correct, and the table is still the reason to trust
`allocateSections`: one abroad co-op never satisfies both, because a single
global `used` set consumes the key once and neither IB section is `shared`.
This was *run*, not read — a naive `.some()` harness reported "1 abroad ⇒ both
MET" and was wrong.

**So what was the defect?** Every row above assumes the student's co-op
registered one of the courses their program names. The corpus does not
guarantee that, and the resolver could not tell the difference. International
Business accepts seven courses for `Business Experiential Learning`; a student
whose co-op registered an eighth got a tick, because the resolver picked from
the program's list by construction. There was no plan state in which a
wrongly-registered co-op could show as unmet — the one answer a student most
needs to see before an advisor sees it for them.

The fix is not a better inference. It is that the question — *which course is
your co-op?* — has exactly one authority, and it is the student. Once the card
carries the field, keeping a default is the app asserting something it cannot
support. Degrade to less information, never to wrong information.

What survives of it: `coopOptionsInPrograms` still walks the program tree, but
only to **order the picker**, putting a Khoury student's `CS 6964` at the top
instead of somewhere around `E` in an alphabetical list of 85. Suggesting is a
different act from ticking.

</details>

Verified against the real allocator on International Business, after the
change:

| plan | keys | International Experiential | Business Experiential |
|---|---|---|---|
| 1 co-op, field empty | — | unmet | unmet |
| 1 recorded `COOP3945` | `COOP3945` | unmet | **MET** |
| 1 recorded `COOP3948` | `COOP3948` | **MET** | unmet |
| 1 recorded `ENCP6964` (off-list) | `ENCP6964` | unmet | unmet |
| 2 recorded, `3948` + `3945` | `3948, 3945` | **MET** | **MET** |
| 2 recorded, both `ENCP6964`/`CS6964` | both | unmet | unmet |

The fourth and sixth rows are the ones the old resolver could not produce.

### 4. UI — three surfaces, one of them new

**Bank.** The 92 stop being listed. Searching `co-op` or `COOP 3948` returns
one line: *COOP 3948 is recorded by placing a work term — drag one from WORK
EXPERIENCE above.* Hiding them outright is the trap — a student told to
register for 3948 must not conclude the app doesn't have it.

**Block card — the course field.** Below `CO-OP 1`, a search input mirroring
`CompanySearch`: subtle placeholder, empty by default, and showing the whole
list on focus the way the concentration search does. Typing filters; selecting
sets the block's `courseId` and prints the code as the subline. It is scoped by
`kind`, so an internship card cannot offer `COOP 3945`. Present on **both**
`SemRow` and `SummerRow` — it shipped on only the first once, which made it
invisible for summer co-ops, and NU's own default patterns put co-ops in
summer.

Clicking the card opens the course info panel, exactly like a course, but
**only when a course was chosen** — there is nothing to open otherwise. Drag
still drags: the field and the company/role inputs stop propagation, so no
gesture has to be guessed.

<details>
<summary>Rejected: the requirement-row actuator (built, then removed)</summary>

The unmet `International Experiential Learning` row offered *mark a work term
as international*, setting the `abroad` flag on the chosen block. One place to
set it, in the place the need is discovered, and not a novel pattern —
`repeatInstances.js` already treats a drag out of the requirements panel as an
add.

It was removed for two reasons. It asked the student to answer a question about
a **requirement** ("is this one international?") when what they actually hold
is a course number; and it could only ever express the one distinction the
corpus happened to need, so every further one would want another button. A card
field answers all of them at once. The `abroad` flag survives as metadata the
student can set for their own reading — it no longer selects a course.

The original note here read: *"Location as a card field was considered and
rejected: coupling it to satisfaction means free-text silently deciding whether
a degree is met."* That is exactly what the field does, and it is right rather
than dangerous — the student deciding whether their degree is met is the
correct authority, and the audit is then free to tell them it is not.

</details>

**The grant must render as the co-op.** Today the key lands in `placedSet`
anonymously, so the row shows a checked course that exists nowhere in the plan.
Once the bank no longer carries it, the student has no way to connect it to
anything. The row should read `✓ Co-op · Spring 2027 · Acme`, using the same
*granted* treatment `grad.nupath.granted` already gives `EX`. **This is a
precondition for the bank change, not a follow-up.**

**The block names the course it registers, and that name is a link.** The card
carries a line — `Registers CS 6964 ↗` — that opens the ordinary course info
panel.

The reason is **inspectability, not richness.** Measured across the 86 then
classified: **zero carry offering sections, one has a prerequisite, one a
corequisite, four carry any NUPath**, and the 31 "distinct" descriptions are
near-identical boilerplate ("Provides eligible students with an opportunity for
work experience"). A co-op course unlocks nothing — no course in the catalog
depends on one. So the panel is not worth opening for its content.

It is worth opening for the **repeat limit**, which is real, program-relevant
information living nowhere else: `repeatMax` on 25 of them, and titles that say
"may be repeated up to five times" — exactly the question *how many co-ops does
my program allow?*

The one risk is re-importing the two-object confusion the bank change removes;
the framing carries it — *"Registers CS 6964"* is a fact **about** the block,
not a second thing to place.

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
"deliberately taken during it": both are `courseId → semId`.

**Counting is therefore all-or-nothing, which reverses an earlier decision in
this document.** The first draft said the first ≤4 SH would count and the
remainder would render greyed as parked. That contradicts making the cap
advisory: truncating at 4 invents a number the student cannot see, and it
disagrees with the term header, which sums what is actually there. So every
course in a capped term counts, and the strip warns above the cap
(`⚠ 8 / 4 SH`) while still accepting the drop. The cost is a larger migration
than the first draft implied — a plan with three courses parked under a co-op
gains all of their credit on first load, not four hours of it — but the courses
are now visible in the strip and removable, where before they were invisible
and uncounted. Belongs in the change log either way.

A type with **no** `concurrentCap` — the internship — keeps the old behaviour
exactly: courses stay parked, contribute 0, and cannot be dropped in. The
one-course rule is published as *co-op* policy and nothing sourced says it
governs internships, so guessing a number onto a student's credit total was
the worse error.

### 6. Internships mirror all of it

Same card field, same `courseId`, same resolver, same bank hiding. The type
declares `registersCourse: "intern"` and the picker is scoped to the courses
stamped with that kind. Nothing in the resolution layer knows or cares which
block it is looking at.

**What differs is which courses belong to it, and that turns on credit.**
Northeastern registers two different things under the word *internship*, and
the official policies say so plainly:

- **Co-op carries no academic credit.** "No tuition is charged while a student
  is on co-op only", and the student receives Satisfactory/Unsatisfactory. The
  registration course is 0 SH.
- **An internship is credit-bearing and tuition-charged.** A student "must work
  at least 12 hours per week to earn academic credit for an internship in a
  term". Departments publish these as the 4 SH `*994 Internship` courses —
  `BIOL 4994`, `COMM 4994`, `HIST 4994`, 35 of them.

So the 35 credit-bearing ones are **ordinary courses you place on the board**,
and the block does not touch them. Only the 5 zero-credit registrations —
`COOP 3949 Internship Exchange`, `EEBA 2945/2948 Internship Experience`,
`COP 5002`, `PPUA 6861` — are recorded by the block, because those are the ones
that record a work term rather than award credit for one.

This is the same partition as co-op, arrived at from the other side: for co-op
the *title* decides and the zero-credit guard verifies it, because no
credit-bearing co-op course exists. For internships a bare `Internship` title
decides nothing, so credit is consulted directly (§*What the catalog actually
contains*).

**The label dropped its qualifier.** "Full-Time Internship" became
"Internship" in all 8 locales. The qualifier described the block accurately but
was doing no work — nothing on the board is a part-time internship, and the
phone card already truncated it to *Internship* to fit, so the short name was
the one most students saw. The concurrent-course asymmetry it hinted at is
recorded above, where it belongs, rather than in a chip label.

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
4. ✅ **Built** — the `abroad` flag can actually be set and kept: share key
   `ab` in `planSchema`, plus `ADD_WORK_TERM` / `UPDATE_WORK_TERM` on both the
   browser reducer and the MCP adapter. Absent means domestic, so a share link
   never carries a redundant key.

   **This was missed for three commits and it mattered.** The resolver read
   `d.abroad` from the first, and nothing could write it — so the flag was
   unreachable by any user action, and because share links map nested keys
   explicitly it would have been *silently dropped* from every link, export
   and backup. That is precisely the `conc2` incident this schema's own
   comments memorialise. Verified by round-trip: `abroad` survives
   `encodePlan` → `decodePlan`, and a domestic block stays absent.
5. ✅ **Built** — MCP `ADD_COURSE` refuses a work-experience course and names
   `ADD_WORK_TERM` instead, with `abroad: true` when the course is an abroad
   variant. It used to place `COOP 3945` happily, giving a 0 SH phantom card
   with no `EX`, no co-op rendering, and a term the load calculation thought
   was free.

### Still to build

Ordered so everything needing no new user-facing string comes first — the
locale files are contended, and a string is not a reason to stall the rest.

| | needs a locale string? |
|---|---|
| ✅ Bank hides the 86 work-experience courses | no |
| ✅ Courses during co-op: `canDropSem`, `getSemStudySH`, the 1 course / 4 SH cap | no |
| CHART: drop them from `deriveCells` (retires defect #16) | no |
| Course info panel says how a work-term course is recorded | no |
| Bank search redirect to the work-term chip | **yes** |
| `Registers CS 6964 ↗` on the block | **yes** |
| Requirement row renders as the co-op, not a bare key | **yes** |
| "Mark a work term as international" actuator | **yes** |
| Over-cap petition warning | **yes** |

Deliberately deferred, each with a measured reason above: the `grantedKeys`
RANGE guard, and half-time co-op.

CHART is unstarted for a second reason beyond ordering: `engine/demand.js` is
contended, and the change is subtle. Pruning work-experience options out of a
`choice` cell would raise that cell's cheapest option — and International
Business's `Business Experiential Learning` is exactly the case the 8 SH
under-credit fix turns on, where the 0 SH co-ops are what keep `min` at zero.
The correct shape is to drop the whole node as already-satisfied when the shape
carries a co-op, mirroring how `grantedAttributes` handles `EX`, not to filter
options.

Blocked on a human: wiring `derive-coop-courses.js` into `update-courses.yml`
(it pushes to main unattended), and a worker redeploy for the MCP changes.

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
- <https://catalog.northeastern.edu/undergraduate/university-academics/undergraduate-internships/>
  — the 12 hrs/week minimum, and that internships earn credit where co-op does not
