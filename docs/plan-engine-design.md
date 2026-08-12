# CHART — plan engine, design of record (2026-08-08)

**CHART · Course Hierarchy And Requirement Timeline.** Generates a term-by-term plan
for a degree: correct prerequisite chains, every requirement covered, availability
respected, sequencing driven by priorities the student ranks.

**Status: design only. No implementation.** The name is one string and is not yet
final; nothing below depends on it.

Companion to `docs/sample-plan-design.md`, which covers *parsing* a department's
published plan. This covers *generating* one. They share the reservation model, the
candidate machinery, and the requirement allocator.

---

## 1. Why

The catalog's own Sample Plans of Study are frequently not worth following:

- **sequencing is unprincipled** — general electives are spent before the first
  co-op, so the student reaches co-op recruiting with the least major depth they
  will ever have again;
- **prerequisite chains contain real errors**;
- **availability is ignored** — courses appear in seasons they are not offered in.

The minimum bar for CHART is therefore: **every prerequisite chain correct, every
requirement covered.** Availability and principled sequencing come after. Generation
is **optional** — loading the official plan stays.

## 2. The one rule

> **CHART decides WHEN and WHAT KIND. It never decides WHICH COURSE, except where
> the requirement itself names one.**

Output cells are reservations, labelled with the requirement's own title. This keeps
`sample-plan-design.md`'s governing rule ("never decide for them") intact, and it is
what makes the output honest: ~51% of a degree is a genuine choice, and an engine
that quietly picked would be inventing.

**The corollary that makes correctness possible anyway:** CHART proves a legal
completion *exists* without naming it (§6, the witness). We decide nothing, and prove
a decision exists.

---

## 3. Contracts

### 3.1 Input

```js
generate({
  programs: [                     // ORDERED: major first. §12a — a student is not one
    { program, concentration },   //   program, and they cannot be planned separately
    { program, concentration },   //   optional second major
    { program },                  //   optional minor(s)
  ],
  shape,         // §4 — the skeleton, an INPUT not an invention
  studentType,   // "undergrad" | "graduate" — sets the credit envelope
  courseMap,     // id → {id, subject, number, sh, prereqs, coreqs, nuPath, termHistory, birthTermCode}
  ports,         // §3.4 — the only route to institution-specific facts
  priorities,    // { ranked: [{id, tolerance}], thresholds: {…} }
  budget,        // { nodes: 20000, ms: 2000 } — §7.4
}) → Result
```

```js
type Result =
  | { ok: true,  plan: PlanGrid, report: Report }
  | { ok: false, refused: { code: RefusalCode, detail: string } }
```

`refused` is a **return value, not a throw** — see §8 for the codes. It applies to
**16 majors** across the corpus (§8 F1), so it is a real path but a narrow one.

### 3.2 Output is a plan.json grid

CHART emits **the same shape the catalog publishes**, so `applySamplePlan` consumes it
unchanged and reservations, candidates, the grid, PDF export and share links need no
new code:

```jsonc
{ plans: [ { label: "Generated · Four Years, Two Co-ops",
             pattern: "Four Years, Two Co-ops",
             years: [ { label: "Year 1", terms: [
               { term: "Fall", type: "fall", hours: 16, entries: [
                 { text: "Khoury Approved Electives",
                   sh: 4,
                   options: [["CS4500"],["CS4550"]],   // only when small enough to name
                   binding: { targets: [5], forced: true },
                   why: [ … ]                          // §9 — additive, old readers ignore it
                 } ] } ] } ] } ] }
```

It also makes the generated plan **diffable against the official `plan.json`** for the
same program, which is what §11's differential verification needs.

### 3.3 Data location

```
data/northeastern/programs/{undergraduate,graduate}/2026/<college>/<program>/
    requirements.json     (was src/data/majors/2026/**/parsed.initial.json)
    plan.json
```

Same shape as before: `{name, metadata, totalCreditsRequired, totalCreditsSource,
yearVersion, requirementSections, gpaRequirements, concentrations, generalElectiveSH}`.
**532 undergraduate and 485 graduate programs** — grad coverage grew from 36, so grad
is now a first-class case, not an afterthought.

### 3.4 Ports — because core must not import adapters

`src/core/` imports nothing from `src/adapters/` (verified). CHART lives in
`src/engine/` and every institution-specific fact is **injected**, the way
`applySamplePlan` already takes `coopDurations` and `bind-plans` injects
`specAdmitsSubject`:

| port | signature | used for |
|---|---|---|
| `offering.status` | `(courseId, semTypeId) → "yes" \| "no" \| "unknown"` | §5.2 availability. **Three-valued on purpose** |
| `offering.pressure` | `(courseId, semTypeId) → {fill, openPerSection} \| null` | robustness objective |
| `coop.validate` | `(typeId, duration, semId, ctx) → {valid, startId}` | co-op legality (`validateDrop`) |
| `coop.grantedAttrs` | `(specialTermPl) → Set<code>` | `EX` for the NUpath report |
| `calendar.semTypeOf` | `(semId) → semTypeId` | season of a term |
| `credits.min` | `(studentType) → number` | full-time floor: 12 UG / 8 grad — verified (§5.5) |
| `credits.max` | `(studentType) → number` | **registration cap: 19 UG** — hard, and the shipped value is correct. Graduate is per-college |
| `credits.billingCap` | `(semTypeId, studentType) → number` | 16 fall/spring, 8 summer — a **price**, not a cap (§5.5) |
| `credits.isBillable` | `(courseId, plan) → boolean` | false for a mandatory coreq; freebies undetectable, so the estimate is an upper bound (§5.5) |

**`offering.status` returns three values, not a boolean.** `semTypeProb` is `null` for
40.8% of the catalog, and collapsing unknown into "no" would make two courses in five
unschedulable. Unknown must read as *allowed*.

---

## 4. Shape is an input

The official plan encodes real departmental intent about **shape**; it is the ordering
and content that is defective. So shape is given, not invented:

```js
shape = {
  years: 4,
  terms: ["fall2026","spr2027","fall2027", …],   // which terms are used at all
  coops: [{ typeId: "coop", duration: 6, semId: "spr2028" }],
  creditTarget: { fall2026: 16, spr2027: 16, … }, // SOFT — §5.4
}
```

Derived from whichever published variant the student picked (**678 plans across 385
programs, ~1.8 variants each** — so variant choice is a real input, not a detail).
Programs with no published plan get a default skeleton: `years` from
`totalCreditsRequired ÷ (credits.max × terms/year)`, fall/spring only, no co-op.

## 4a. Shape is a structured choice, measured from the corpus

The shape vocabulary is not something to invent — departments publish it. Measured over
all 678 plan variants:

| axis | values |
|---|---|
| **years** | **4 → 497 plans**, **5 → 127**, 1–3 → 52 (minors/certificates), 6 → 2 |
| **co-op cycle** | **`Fall + Summer 2` → 300**, **`Spring + Summer 1` → 292**, everything else <6 |
| **co-op count** | 4 term-cells → 403 (two 6-month), 6 → 114 (three), 2 → 84 (one), none → 66 |

So shape is a triple, and **the student chooses all three**:

```js
shape = { years: 4 | 5, coops: 0 | 1 | 2 | 3, cycle: "spring" | "fall", … }
```

**The cycle is a genuine free choice, not a default with exceptions** — 300 versus 292 is
as even as it gets. That is the strongest possible argument for offering it rather than
inheriting it.

### The shape space is SPARSE — do not offer a cross-product

Measured over all 678 variants, counting co-op **runs** (a 6-month co-op spans two terms,
so cells overcount):

| | plans |
|---|---|
| 4y / 2 co-op / fall | 206 |
| 4y / 2 co-op / spring | 189 |
| 5y / 3 co-op / fall | 58 |
| 5y / 3 co-op / spring | 56 |
| 4y / 1 co-op / spring | 46 |
| 4y / 1 co-op / fall | 33 |
| *(15 more shapes)* | ≤20 each |

**21 distinct shapes observed of 120 possible — 18% dense.** And the top six cover
**588 of 678 (87%)**.

> **Years and co-op count are correlated, not independent.** 4 years → 2 co-ops (402
> undergraduate plans), 5 years → 3 co-ops (114). `5y-2c` is 9 plans and `4y-3c` is 1.
> Offering years × runs × cycle as free axes would present ~100 combinations that
> essentially nobody publishes.

So the shape menu is **the observed set**, not a generated one — derived from the corpus
and per program, exactly as §4a's cycle-support table already is. That is also the honest
form: a shape nobody publishes is one we have no evidence is advisable.

Level splits cleanly too:

```
undergraduate   4y-2c 402 | 5y-3c 114 | 4y-1c 79 | 4y-0c 10 | 5y-2c 9 | 4y-3c 1 | 6y-0c 1
graduate        1y-0c 15 | 2y-0c 20 | 3y-0c 10 | 4y-0c 5 | 5y-0c 4 | 2y-1c 5 | 3y-1c 2
```

**Graduate co-op appears in exactly 7 plans, always as a single run** — an independent
confirmation of the "one co-op" policy in §12f, arrived at from the plan grids rather than
the policy page.

Edge cases to inspect rather than model: cycle `"both"` (10 plans), cycle `"other"` (3),
and the single `4y-3c` undergraduate outlier.

### Half of all programs offer no shape choice at all

| variants published | programs |
|---|---|
| **1** | **203 (53%)** |
| 2 | 127 |
| 4 | 41 (cycle × concentration, most likely) |
| 3 / 5 / 6 / 8 | 14 |

So for **over half of programs the student has no shape to choose** — the engine simply
regenerates the content of the one published skeleton, which is where most of the value
sits anyway. Cycle choice is real only for the 140 programs publishing both (§4a).

### The triple labels a family; the variant IS the shape

`(years, coops, cycle)` almost pins the layout for the dominant shapes and **does not** for
the rest:

| family | co-op year patterns |
|---|---|
| `4y/2c/fall` | **Y2+3+4 in 204 of 206** |
| `4y/2c/spring` | **Y2+3 in 188 of 189** |
| `5y/3c/fall` | Y2+3+4+5 — **unanimous (58)** |
| `5y/3c/spring` | Y2+3+4 — **unanimous (56)** |
| `4y/1c/spring` | **Y3 (34) vs Y2 (12)** — genuinely split |
| `4y/1c/fall` | **Y2+3 (18) vs Y3+4 (14)** vs Y3 (1) — genuinely split |

> **So the engine inherits the concrete variant layout, never a reconstruction from the
> triple.** The triple is the *label* the menu shows; the variant's term-by-term skeleton
> is the shape §4 passes in. For 4y/2c you would get away with reconstructing; for 4y/1c
> you would silently pick one of two real conventions.

**Why fall and spring span different year counts** — a nice structural check. The calendar
anchor is August (`getYearAnchor()`), so a fall-cycle 6-month co-op straddles Summer 2 (end
of one academic year) *and* Fall (start of the next), touching two years; a spring-cycle
co-op sits wholly inside one. Hence `Y2+3+4` for two fall-cycle co-ops versus `Y2+3` for
two spring-cycle ones. The measurement reproduces the calendar model without being told
it.

### Derive shape structurally, never from the pattern label

The published `pattern` strings are unreliable. The same shape appears as
*"Four Years, Two Co-ops in Spring/Summer First Half"*, *"…First-Half"*, and
*"…Two Co-ops Spring/Summer First Half"* (no comma) — **six spellings of one shape** — and
26 plans are labelled just *"Plan 1"*.

But the shape is **exactly recoverable from the grid**: count `years`, find which terms
hold `{coop: true}`, and map `{Spring, Summer 1} → spring cycle`, `{Summer 2, Fall} →
fall cycle`. Same lesson as everywhere else in this codebase — wording is evidence,
structure is authority.

### Most programs support only ONE cycle — and the published variants are how we know

"How would we know which cycles a program allows?" **The variants it publishes are the
evidence**: a department publishes one plan per cycle it supports. Measured per program:

| | programs |
|---|---|
| publishes **both** cycles | 140 |
| **spring only** | 95 |
| **fall only** | 105 |
| no co-op | 37 |
| mixed (one variant spanning both) | 8 |

**200 of 385 programs (52%) publish only one cycle**, so cycle is *not* a free choice for
the majority — which reverses the naive reading of the 300-vs-292 term split above. That
split is even across *plans*; across *programs* the freedom is much narrower.

And the constraint lands on **combined majors**, not standalone ones:

| program | cycles published |
|---|---|
| `computer_science_bscs_(boston)` | both |
| `physics_bs_(boston)` | both |
| **`computer_science_and_physics_bs_(boston)`** | **fall only** |
| **`computer_science_and_linguistics_bs_(boston)`** | **fall only** |
| **`physics_and_philosophy_bs_(boston)`** | **fall only** |
| `physics_and_music_…` | spring only |

Standalone CS and Physics each support both; **CS + Physics does not.** That is exactly
what §4a's term-removal argument predicts — fitting two majors' prerequisite chains
around a cycle that deletes two Fall terms is what exhausts the freedom. The data and the
mechanism agree.

Graduate research degrees (`computer_science_phd`, `physics_ms`, `physics_phd`) publish no
co-op at all.

### But absence of a variant is not proof of prohibition

The same epistemics as the Sample Plan of Study itself: **a published cycle proves it
works; an unpublished cycle does not prove it fails.** A department may simply not have
published the other one.

So the engine must not silently forbid, and must not silently offer:

- cycles the program publishes are **offered normally**;
- an unpublished cycle may still be **attempted**, marked *"not published by the
  department"*, with feasibility checked by CHART itself (§4a) rather than assumed;
- and the 8 "mixed" programs — one variant with co-ops in both spring and fall terms —
  are an edge case to inspect, not to model, until someone looks at what they actually are.

### Choosing the cycle removes terms of that season, and that bites

This is the interaction worth catching: **a co-op cycle consumes two terms, and which two
depends on the cycle.** A fall-cycle student spends Summer 2 + Fall on co-op — so with two
co-ops they lose **two of their four Fall terms**.

Against the measured availability data, that is a hard constraint interaction:

- **988 courses are fall-only** and **973 are spring-only** (§10.7);
- a fall-cycle student has half the fall terms to fit 988 fall-only courses into;
- and co-op terms earn **0 SH**, so the cycle also shifts *standing* progression (§10.7).

So cycle choice is not cosmetic — it can make a requirement infeasible, force different
sequencing, or delay standing. **This is precisely the class of error a human planner
cannot see and the engine can**, and it is a second strong argument for making the cycle
an explicit choice with feasibility checked per option.

Practical consequence: the engine should be able to report *"this program is not feasible
on the fall cycle"* — which means shape is not just an input but something CHART can
**evaluate**, one refusal per option rather than one for the program.

### Two smaller corrections this measurement forces

- **`years: 4` is not a safe default.** 52 plans are 1–3 years (minors, certificates) and
  2 are 6. §9.4's fallback skeleton must derive length from `totalCreditsRequired`, not
  assume four years.
- **66 plans have no co-op at all**, which is the §12d flat-objective case, now
  quantified: for those programs `coop-depth` is constant and rank 1 must be skipped
  rather than banded.

**Accepted consequence, narrowed:** CHART still does not invent a shape — it offers the
ones the program publishes plus the cycle/count axes above, and plans content for the one
chosen. What it does not do is invent a *novel* skeleton (a summer nobody published, a
term off).

---

## 5. Cells

### 5.1 From demand, and the ceil/round asymmetry

`runtimeBinding.outstandingObligations(program, {placements: {}, courseMap})` already
returns what the program demands — `{target, title, spec, shortfallSH, unitSH}` per
obligation, read off the audit's own allocator so scrape-time sizing and runtime
measurement cannot drift.

For each obligation, cell count is

```
n = ceil(shortfallSH / unitSH)
```

**`ceil`, not `round`, and the asymmetry is the point.** A 16 SH obligation of 3 SH
courses rounds to 5 cells = 15 SH and **silently undershoots the requirement** — which
destroys the one guarantee CHART exists to give. Ceil gives 6 cells = 18 SH: it
overshoots, which costs credits, not correctness.

**Overshoot is then absorbed by the general-elective bucket**, not carried into the
total. `generalElectiveSH` is the flexible remainder (`geSH = totalCreditsRequired −
demand`), so named-section overshoot reduces GE cells one for one. That keeps
`Σ cell sh ≈ totalCreditsRequired` instead of inflating the degree.

Sections marked `shared` (314 of them) are deliberately cross-counted and **emit no
cells** — they are answered by courses claimed elsewhere, and cells for them would
double-count.

### 5.2 Labels

The **narrowest titled node** that is still a genuine choice, because that is the node
whose candidate set the cell draws from — a label from a broad ancestor promises a
wider set than the cell offers. Fallbacks in order: nearest titled ancestor →
spec-derived (`MATH 3000–4999`). Needed because untitled sections exist and
`resolveRequirement` correctly refuses to match an empty title.

### 5.3 A cell names nothing

```js
Cell = {
  id,                          // stable, for deterministic tie-breaking
  requirement: {index, title}, // set at construction — no inference needed
  sh,                          // from unitSH
  options: string[][] | null,  // groups, when the candidate set is small enough
  candidates: EligibleSpec,    // otherwise, symbolically
}
```

Because cells are *constructed from* requirements rather than parsed from wording,
the entire §14 wording-evidence stack in `sample-plan-design.md` (IDF, stopwords, the
`subjectOf` false fact) is **not needed for generated plans** — 0 ambiguous cells
instead of 40.4%. That stack stays for catalog plans, which we still parse.

### 5.4 Credit target is soft

§5.1's whole-cell arithmetic means a 16 SH target may only be reachable as 15 or 18.
`creditTarget` is a preference. `credits.min` (12 UG / 8 grad) and `credits.max` (**19**
UG registration cap) are genuine bounds; **Billing Hours is a price, not a bound** —
see §5.5.

## 5.5 Credit limits are TWO quantities, not one

A term has **two** credit numbers and they are not the same: `getSemesterMax = 19` is the
*registration* cap, and 16 is the *billing* threshold
([CSSH Undergraduate Advising FAQs](https://cssh.northeastern.edu/resources/undergraduate-advising/undergraduate-advising-faqs/)):

> "The registration system allows students to register for up to **19 credits**."
>
> "If **Billing Hours** goes above **16** for a fall or spring term, or above **8** for
> a summer term, the student will be charged for an overload."
>
> "Both 'Total Credit Hours' and 'Billing Hours' appear on the Add/Drop screen."

| quantity | limit | kind |
|---|---|---|
| **Total Credit Hours** | ≤ **19** | **hard** — the registration system will not exceed it |
| **Billing Hours** | ≤ **16** fall/spring, ≤ **8** summer | **a price** — above it is an overload fee |
| Total Credit Hours | ≥ **12** UG / **8** grad | full-time floor, verified |

**Non-billable courses are what open the gap between the two**, and the list is
explicit — mandatory co-requisites ("0 SH or 1 SH labs for science courses",
"Recitations", "0 SH or 1 SH Tools courses") and "freebies" (introductory seminars,
intro to co-op, 1 SH music ensembles).

So four 4 SH courses plus a 1 SH science lab is **17 total / 16 billable → no charge**,
while four 4 SH courses plus a 3 SH course is **19 total / 19 billable → charged for 3**.
A plain 2–3 SH course is a regular course and is billable; a mandatory lab is not.

### Can we compute Billing Hours? Partly, and in the safe direction

| | |
|---|---|
| courses at 0–1 SH | 2,297 |
| **…that are a mandatory coreq of another course** | **199 — detectable** |
| …0–1 SH and nobody's coreq | 2,098 — ambiguous |

The 199 are recognisable **structurally from the `coreqs` graph, with no title parsing**
(`ARCH 1311 "Recitation for ARCH 1310"` is found because ARCH 1310 names it, not because
of its title). The freebies are not detectable — `ACCT 1990 "Elective"` at 1 SH looks
identical to a music ensemble and is genuinely billable.

> **So our Billing Hours estimate is an UPPER bound: we may count a freebie as billable
> and predict an overload that would not be charged.** That is the safe direction —
> over-warning about a cost, never silently planning one. State it as an estimate.

In practice the gap is small for generated plans: cells come from requirement sections,
0 SH recitations consume no credit either way, and a mandatory coreq is placed because
the coreq constraint forces it, not because the engine chose it.

### Graduate is per-college, which breaks the single-constant model

The 8 SH full-time floor is university-wide and our code is right. The **ceiling is per
college** ([Khoury Course Overload](https://catalog.northeastern.edu/graduate/computer-information-science/academic-policies-procedures/course-overload/)):

> "The full-time load for Khoury College graduate students is **8-9 credits** per
> semester, depending on the program. … A credit overload includes a maximum of **12
> credits** in a fall or spring term."

— gated on ≥8 earned credits **and a 3.500 GPA**. So `getSemesterMax(graduate) = 16` is
wrong for Khoury, and one university-wide grad ceiling is the wrong shape.

### Consequences for the engine

1. **Two constraints, not one.** `totalSH ≤ 19` is hard and belongs in the capacity
   propagator (§7.1). `billableSH` is a **threshold with a price** (§10 tier 2) and
   belongs in the report — planning 18 SH is legal and costs money, which is the
   student's call to make knowingly rather than the engine's to spend silently.
2. **Summer already works.** Billing ≤ 8 per summer half is 2 courses, which is exactly
   the `maxSlots = 2` the semester model already gives half-weight terms.
3. **The grad ceiling needs a port that varies by program**, not an adapter constant.
4. **A from-scratch plan can never assume a graduate overload** — it has no grades, so
   it cannot assert the 3.500 GPA the overload is gated on. The effective grad ceiling
   is therefore the *standard* load (8–9), not the overload maximum. That is a logical
   consequence, not a chosen conservatism.
5. `creditSystem.getSources()` returns `[]`. Every number above now has a citation and
   belongs in it.

---

## 6. Domains — the core idea

**A cell does not need a position in the prerequisite DAG. It needs a domain.**

```
domain(c) = { T ∈ shape.terms :
                ∃ x ∈ candidates(c) .
                     offering.status(x, semTypeOf(T)) ≠ "no"
                   ∧ earliest(x) ≤ index(T)
                   ∧ T is not occupied by a work term
            }
```

where `earliest(x)` is the length of the longest prerequisite chain ending at `x` —
computable from the memoised machinery behind `longestPrereqChains`. If `x` needs a
chain of *d* courses before it and each needs its own term, `x` cannot sit earlier
than term *d*.

Named courses get **narrow** domains (a 4-deep chain plus fall-only leaves perhaps two
terms). `General Elective` gets a **wide** one.

> **The DAG supplies a lower bound on the domain. It never supplies the placement.**

That distinction is load-bearing. Placing each cell at its minimum candidate depth
would put a broad Khoury Elective in year 1 — *precisely the defect CHART exists to
fix*. Feasibility bound and placement preference are different questions, and
conflating them reproduces the catalog's mistake.

**Conservative details.** A concurrent prerequisite (`tok.concurrent`) permits
same-term placement, so it contributes 0 to depth. An unresolvable prerequisite atom
(13.2% of atoms name renumbered courses) contributes 0 rather than +∞ — otherwise 33
courses become permanently unplaceable for a data defect.

---

## 7. Search

### 7.0 What kind of problem this is, and the workflow

**It is not a Markov chain, and not an MDP.** Nothing here is stochastic and there are
no transition probabilities. Formally it is a **constraint satisfaction problem with a
lexicographic objective**:

```
variables    x[c][t] ∈ {0,1}     cell c placed in term t
             Σ_t x[c][t] = 1     every cell placed exactly once
constraints  per-term capacity (slots, credits), precedence, alldifferent (§7.2),
             offering ≠ "no", campus, standing (§10.7)
objective    lexicographic over ranked terms, with tolerance bands (§10)
```

Structurally that is **precedence-constrained scheduling** (the RCPSP family, NP-hard
in general) wrapping a **polynomial** assignment sub-problem — cells→courses is
bipartite matching. Hence **CP, not MIP and not reinforcement learning**:
`alldifferent` propagates strongly in constraint programming and weakly as integer
inequalities, and the instance is tiny (~40 cells × ~12 terms), so exact search is
realistic.

**Where a stochastic framing would earn its place, and why it is rejected.** Model
uncertainty — will it be offered, will a seat exist, will the student pass — and the
plan becomes a policy over a stochastic process, i.e. an MDP. We have 13 terms of
offering history and **no per-student seat probability at all**, so the transition
model would be invented rather than measured. The cheap honest substitute is
**recourse**: for each placement, which other terms remain in its domain. That
delivers *Adaptive* ("name what would change this") without fabricated probabilities.

**The workflow, and the one sentence that describes the reasoning:**

```
0  pre-flight        refuse programs we cannot plan (§8)
1  obligations       runtimeBinding.outstandingObligations → what the degree demands
2  cells             obligations → cells, by ceil arithmetic (§5.1). No choice made.
3  candidates        per cell, an EligibleSpec (spec algebra, never expanded)
4  domains           legal terms per cell: depth bound, offering, campus, standing (§6)
5  propagate         precedence · capacity · alldifferent, to fixpoint (§7.1)
6  search            MRV cell choice + objective-guided value order, backtrack (§7.3)
7  improve           local search in tolerance bands (§7.5)
8  emit + report     plan.json grid + why[] + NUpath/risk/trade report (§9)
```

> **We never decide freely — we eliminate.** Every step above removes possibilities;
> the search only ever picks among what survived. That is the same monotone-narrowing
> discipline `candidates.js` already enforces (a filter returns what to *remove* and
> cannot add), and it is why the engine can be honest about deciding nothing while
> still producing a plan.

### 7.1 Three propagators

All monotone: they only ever *remove* terms from domains. That is what makes the
fixpoint below terminate, and it is the same structural guarantee `candidates.js`
already relies on (a filter returns what to remove and cannot add).

| propagator | rule |
|---|---|
| **precedence** | for named single-course cells `x → y`, every `T ∈ domain(y)` with no `T' ∈ domain(x)`, `T' < T`, is removed (and symmetrically) |
| **capacity** | a term whose assigned cells reach `credits.max` (19 UG) is removed from every unassigned domain. **Not `maxSlots`** — §12e measures 1,692 published terms exceeding it |
| **alldifferent** | cells must map to **distinct** courses — §7.2 |

### 7.2 alldifferent is a matching, and that is the witness

"No two cells answered by the same course" is an `alldifferent` constraint over
candidate sets, and the standard propagator for `alldifferent` is maximum bipartite
matching. So `maxFlow` (already in `src/core/requirementBinding.js`) becomes the
**propagator** — the witness is not a separate verification pass, and there is no
propose→verify→repair loop to design.

```
build bipartite graph:  cell  ──  course
  edge (c, x) iff  x ∈ candidates(c)
                 ∧ offering.status(x, season(term(c))) ≠ "no"
                 ∧ prereqs(x) satisfiable at term(c) given cells assigned earlier
if maximum matching < |cells|  →  fail (F4), naming an unmatched cell
```

**Two things the right-hand side must be, or this is wrong:** **takes, not courses** —
24.6% of the catalog is repeatable and a requirement can want four takes of one 1 SH course
(§12b) — and scoped **per program**, since one take may answer a cell in a major *and* a
minor, which is what double-counting means (§12a).

```
```

**Feasibility only — not full Régin filtering.** Régin's propagator also deletes edges
in no maximum matching, via SCCs of the residual graph. At ~40 cells and ~100
candidates each, the extra pruning is not worth the implementation risk; weaker
propagation plus backtracking is sound, just occasionally slower.

**The matching is a witness and is discarded.** It proves a legal completion exists; it
is never shown, because showing it would be deciding. (Same stance the repo already
takes on the catalog's plan pane: *a witness, not a source*.)

**Honest scope:** the witness is a proof against **today's catalog**, applied to a term
up to four years out. Offering status is a historical rate projected forward. That is
the same limitation the catalog's own plans have, and it should be stated in the
report rather than implied away.

### 7.3 The loop

```
domains ← §6
loop:
  propagate to fixpoint (§7.1)          # monotone ⇒ terminates
  if some domain is empty      → backtrack (or F3/F4 at the root)
  if every cell is assigned    → done
  c ← unassigned cell with the SMALLEST domain      # MRV
      ties broken by cell.id                        # determinism
  T ← best term in domain(c) by the objective       # value ordering
  assign, recurse
```

**MRV is what produces the behaviour the complaint asks for.** The most-constrained
cells — deep chains, fall-only courses — are placed first; the widest cells are placed
last, into whatever gaps remain. **Electives become the filler rather than the
front-loaded thing**, as a consequence of the search order rather than a special rule.

**Value ordering by the objective costs nothing and buys quality.** It cannot affect
completeness — only which solution is found first — so phase 1's first feasible plan
is already a decent one.

### 7.4 Termination and budget

- propagation: domains are finite and only shrink ⇒ fixpoint in ≤ Σ|domain(c)| steps.
- search: one cell assigned per level, finite domains ⇒ finite tree.
- **complete**: if a legal plan exists within the domain structure, it is found. A
  greedy would fail spuriously; that matters when the guarantee is the product.
- size: ~40 cells × ~12 terms × ~100 candidates. Expected to solve without
  backtracking on almost every program.
- **but a pathological program could thrash**, so the node/ms budget is a real
  parameter and exhausting it is a defined refusal (F5), not a hang.

### 7.5 Phase 2 — quality

Phase 1 gives a feasible plan. Phase 2 improves it by local search:

- **moves**: relocate one cell to another term in its domain; swap two cells' terms.
- accept iff all hard constraints still hold (re-propagate) **and** the objective
  improves within the current rank's band.
- stop on no improving move, or on budget.

Ranked objectives are **lexicographic with tolerance bands** (§10). Establishing each
band requires optimising that objective *alone* first — N extra local searches before
the banded passes. Cheap here, but it is a real step in the cost model.

---

## 8. Refusal

CHART declines rather than emitting a plan it cannot stand behind. Two of these are
**pre-flight** — decided before any search runs, so most refusals cost nothing.

| code | when | why it is a refusal, not a warning |
|---|---|---|
| **F1** `no-total-credits` | `totalCreditsRequired` absent | nothing to size a plan against. `docs/verification-report.md` records **267 programs** here |
| **F2** `requirements-too-thin` | `generalElectiveSH` was *derived* and is a large fraction of the degree | the plan would be mostly unlabelled placeholders — worse than no plan, because it looks authoritative and says nothing. **Threshold set from the corpus distribution (§11 M1), not guessed.** If the catalog *stated* the GE figure, trust it: some degrees genuinely are elective-heavy |
| **F3** `cell-unplaceable` | a domain is empty at the root | no term can hold some requirement — names the cell |
| **F4** `no-distinct-answer` | no perfect matching | a requirement cannot be answered without reusing a course — names the cell |
| **F5** `budget-exhausted` | node/ms budget hit | honest "could not decide in time", never a hang |

Refusal is per-program and surfaces as *"no generated plan available"*, alongside the
official plan, which still loads.

---

## 9. Legibility is a data structure

Every cell carries why it is where it is, so the reasoning cannot drift from the plan:

```jsonc
why: [
  { kind: "requirement", target: 5, title: "Khoury Approved Electives" },
  { kind: "term", cause: "prereq-lower-bound" | "only-season-offered"
                       | "capacity" | "threshold" | "objective" | "filler",
    detail: "no candidate is reachable before Year 3" },
  { kind: "traded", against: "early-breadth", amount: "1 subject" }
]
```

`cause` is a **closed vocabulary** so the UI can render it and tests can assert it.
`traded` is what distinguishes a considered sacrifice from a bug — without it, a
ranked priority silently starving a lower one is indistinguishable from a defect.

**Report** (alongside the plan):

- NUpath: codes **guaranteed** by program structure vs still **open** (§12);
- availability risk: which placements rest on `"unknown"` offering status;
- the trade log from §10;
- overshoot: where whole-cell arithmetic exceeded a requirement's demand.

---

## 10. Priorities

Three tiers, because most preference is satisficing rather than maximising.

| tier | form | examples |
|---|---|---|
| **constraints** | must hold | §7's propagators, `credits.min`/`credits.max` (12–19 UG), co-op legality, offering ≠ `"no"`, campus |
| **thresholds** | at least / at most — checked and repaired, never scored | **Billing Hours ≤ 16 fall/spring, ≤ 8 summer** (an overload fee, §5.5); ≥3 distinct subjects in year 1. **NOT "at most N summer terms"** — §12e measures that as determined, not choosable, in the modal shape |
| **ranked** | direction + tolerance band | below |

**Ranked, not weighted.** A weighted sum would force "peak course level", "distinct
subjects" and "SH variance" onto one invented scale, and those numbers would then be
defended as if measured. A ranking is a sentence the plan can be checked against.

**Bands, because strict lexicographic degenerates.** If rank 1 is real-valued it
usually has a unique maximum, so ranks 2+ never speak — and it would trade away
arbitrarily much of rank 2 for a trivial gain in rank 1. Each rank carries a tolerance
in **its own units**:

```
1. co-op depth    within 1 course of best achievable
2. early breadth  within 1 subject of best, inside that band
3. load balance   within 2 SH
```

**Ceiling: 3–4 ranked objectives.** Each rank consumes the freedom the next needs, so
ranks 5+ are decoration. Rank a few honestly rather than offering nine that pretend to
matter.

### 10.0 Why "too many things to optimize" is a real problem — and where it actually is

The instinct is right, but the cost is not where it looks.

> **Hard constraints are nearly free. Objectives are what cost.**

A hard constraint *shrinks* the search space. Adding `total SH ≤ 19`, campus, offering,
coreq-joint and cell↔cell precedence makes the problem **easier**, because propagation
collapses domains faster and the tree gets smaller. Twelve constraints is less work than
three. So the constraint list in §5 should be *complete* — every one of them.

They also can never be traded against a goal: phase 2 re-propagates after each move and
rejects any move that breaks a hard constraint, so **`19 SH` holds while optimising, by
construction rather than by weighting.**

**The objectives are the expensive list**, because each ranked one needs its own
"best achievable" solve to set a band (§10.5) plus a dimension for local search. §10
claims a ceiling of 3–4 and then lists nine — that is the actual over-specification.

### 10.0a Nine objectives reduce to four

Three of them are not objectives at all — they are **already produced by the search
order**, and stating them again would double-count the same structure:

| candidate | verdict |
|---|---|
| `generators-first` | **falls out of MRV + leverage for free.** Most-constrained-first already places gateway courses early; §10.4 measured `ENGW1111`/`MATH1341` as ~325-course gateways. Making it an objective re-weights what the search already does |
| `validate-premises` | the same computation as `generators-first` — an entry course preceding a stack *is* the prereq lower bound |
| `decide-late` | **subsumed by robustness.** Option value is `log₂ n(c,t)`, and `n(c,t)` is the candidate-availability curve robustness already scores (§10.6) |
| `concentration penalty` | part of robustness — spreading low-`n` cells *is* preserving option value |
| `chain fragility` | part of robustness — one term of a broader "how many ways can this still go right" |

What survives, and why each earns a rank:

| # | objective | why it is irreducible |
|---|---|---|
| 1 | **`coop-depth`** | the stated motivating goal; nothing else measures major depth before the first co-op |
| 2 | **`early-breadth`** | *directly opposed* to 1 (§10.2), which is what makes ranking them meaningful rather than decorative |
| 3 | **`robustness`** | absorbs decide-late, concentration and fragility into one number: availability risk plus the candidate-availability curve |
| 4 | **`interleave`** | per-term subject spread — orthogonal to all three above |

**Four ranked objectives, and three of the nine cut themselves** by already being in the
search order. Load balance is *not* on this list: it is a threshold (≥12, ≤19, target
~16), not something to maximise.

### Cost, so tractability is not a guess

- **phase 1** — ~40 cells × ~12 terms with propagation; near-zero backtracking expected
- **phase 2** — 4 objectives → 4 best-achievable solves + 4 banded local searches
- each local-search pass — ~40 × 12 ≈ 480 candidate moves, each a propagate-and-test

Well under a second. **The problem was never compute — it was design surface**, and
§10.0a is the cut.

### 10.1 The rankable objectives

The four that survive §10.0a, each computable from data that exists:

| id | computed as |
|---|---|
| `coop-depth` | required-bucket courses placed + max **boolean chain depth** (§10.4, not level) in the major subject(s), before the first co-op term |
| `early-breadth` | `w·H_college + (1−w)·H_subject` over years 1–2 (§10.4) |
| `robustness` | Σ over placements of `1 − offering.status` risk, plus `Σ log₂ n(c,t)` retained option value (§10.6), plus seat pressure where it discriminates |
| `interleave` | per-term subject spread |

Deliberately **not** here: `generators-first` and `validate-premises` (already produced
by MRV + leverage), `decide-late`, concentration and fragility (folded into
`robustness`). See §10.0a.

**`coop-depth` needs "major subject" defined** and it is not: *Computer Science and
Mathematics* has two. Proposal — modal subject(s) of the required bucket, tracked per
major and summed, rather than one "primary".

### 10.2 Opposed by construction

`coop-depth` wants major depth **front-loaded**; `early-breadth` and `decide-late` want
breadth and deferred commitment. They compete for the same year-1/2 slots. A ranking
*will* sacrifice the loser, so §9's `traded` entry is not decoration — it is how a
student tells a considered trade from a bug.

### 10.3 What does not survive contact with the data

Stated rather than quietly dropped:

| principle | why not |
|---|---|
| cost by your own bottleneck | **no difficulty or workload data exists** — no grade distributions, nothing. Must be user-supplied per subject or invented |
| redundancy for high-variance outcomes | not schedule-shaped |
| attach work to existing structure | not schedule-shaped |
| motivational fuel / scaffolding | no data |
| scope before you start | a process rule, not plan content |
| people over labels | **partial** — we know who typically teaches a course each season, but `ratemyhusky.json` stores name→slug with **no ratings** |

*Protect slack* survives as a **threshold** (≥1 free slot), not a maximisation —
maximising slack just empties the plan.

---

## 10.4 Depth and breadth — measured, not labelled

§10.1 used "depth" and "breadth" as if they were obvious. Three sources were
candidates — **descriptions**, **labels**, and **graph structure** — and measuring
them settles it: the answer is structure, but *three different structures answer three
different questions*, and conflating them is where a plausible objective goes wrong.

**Descriptions: no.** Wording is the failure mode this codebase keeps paying for —
1,353 distinct cell wordings, the ART/ARTF false fact, and a `standing of` regex in
this very document that matched **"understanding of"** and inflated a count 16×.
`sanitizeDesc` also deletes some descriptions outright.

**Labels: not the right question.** For a generated plan, cells are constructed *from* sections, so
the section identity is exact rather than inferred. The useful question is not what the
title says but what the requirement's **candidate set** admits — which is structural.

### Depth vs breadth is structural, and nearly binary

Measured over all **4,234** enumerable undergraduate requirement sections, by how many
distinct subjects each section's spec admits:

| subjects admitted | sections | |
|---|---|---|
| 1 | **2,627** | 62.0% |
| 2–3 | 1,144 | 27.0% |
| 4–10 | 392 | 9.3% |
| 11–40 | 71 | 1.7% |
| **40+** | **0** | — |

**89% of sections admit ≤3 subjects, and not one admits more than 40.** So requirement
sections are essentially *all* depth requirements, and breadth is not a section
property at all — it exists only as the `~general` bucket, which admits everything.

> **The classification needs no heuristic.** A cell bound to a *section* is depth; a
> cell bound to `~general` is breadth. The *degree* of depth is the subject count,
> which is a real continuous signal for the 11% admitting 4+.

### Course depth: boolean-aware, and weak on its own

`depth(x)` = how much had to come first. But the obvious implementation is wrong:

```
depth(AND(a,b)) = max(depth a, depth b)
depth(OR (a,b)) = min(depth a, depth b)      ← you only need ONE branch
depth(course)   = 1 + depth(its prereq expression)
```

**`longestPrereqChains` is not this function and must not be used for a domain bound.**
It runs over `extractEdges`, which *flattens* And/Or, so every OR alternative counts as
required. Measured: it **overestimates depth for 1,169 of 7,966 courses (14.7%), worst
case by 9 terms.** Using it would forbid legal placements — the one error the domain
formulation exists to avoid.

Residual risk in the other direction: an unresolvable prerequisite atom (13.2% of
atoms) contributes 0, so `OR` can pick a phantom zero-cost branch and *under*-estimate.
Permissive is the right default (§6), but it must be reported rather than silently
zeroed.

**And depth cannot carry an objective alone — it is 0 for 6,053 of 7,966 courses
(76%).**

### Course numbering IS authoritative — about year, not depth

Northeastern publishes the numbering system
([Course Numbering System](https://catalog.northeastern.edu/graduate/academic-policies-procedures/course-numbering/)),
which makes it **evidence, not a heuristic** — and it answers the question we otherwise
have no data for: *what year is this course meant for?* That is the standing proxy the
missing Banner restrictions (§10.7) would have provided.

| range | registrar's words | engine use |
|---|---|---|
| 0001–0999 | "Orientation and basic… **No degree credit**" | **moot — 0 such courses exist in the catalog** |
| 1000–1999 | "Introductory level (first year)… **normally with no prerequisites**" | year-1 prior |
| 2000–2999 | "Intermediate (sophomore/junior)… in some cases open to freshman majors" | year-2 prior, soft |
| 3000–3999 | "Upper-intermediate (junior)… **prerequisites are normally required, and these courses are prerequisites for advanced courses**" | year-3 prior |
| 4000–4999 | "Advanced (senior)… research, capstone, thesis" | year-3/4 prior |
| 5000–5999 | "primarily for graduate students **and qualified undergraduates with permission**" | permission gate, not exclusion |
| 6000–6999 | "**Generally** for master's and clinical doctorate only" | prior only — **see below** |
| 7000–8999 | master's/doctoral, thesis, comprehensive-exam prep | grad |
| 9000–9999 | "Doctoral research and dissertation" | grad; counts as full-time on its own (§10.7) |

**Two independent validations of the graph measurements.** The policy says 1000-level
courses "normally" have no prerequisites — measured, **94% have depth 0**. It says
3000-level courses both require and are prerequisites — measured, **depth peaks exactly
at 3000**. Convention and structure agree, which is what makes numbering a legitimate
signal rather than a folk belief.

**But the numbering prior must never override the program's own requirements.**
Measured: **25 of 532 undergraduate programs require a 6000+ course** — `SLPA6219`,
`BINF6200`, `COMM6320` — because PlusOne and combined pathways genuinely do. The
registrar's word is "generally", and per the source-hierarchy rule the program page is
the authority for requirements. So:

> **Numbering is a prior for cells with no named course (electives). It is never a
> filter on a course a requirement names.** Building the obvious "no 6000+ in an
> undergraduate plan" guard would break 25 programs.

### Level is not a depth proxy

Mean boolean depth by tier:

| tier | 1000 | 2000 | 3000 | 4000 | 5000 | 6000 | 7000 | 8000 |
|---|---|---|---|---|---|---|---|---|
| mean depth | 0.08 | 0.26 | **0.64** | **0.66** | **0.10** | 0.37 | 0.36 | 0.14 |

Depth rises to 3000 then **flatlines** (3000 and 4000 are indistinguishable), and
**graduate levels are shallower than 3000-level undergraduate** — because grad courses
gate on *admission*, not on a course chain. 66% of 4000-level courses have depth 0.

**Numbering and depth measure different things and neither substitutes for the other.**
Numbering is the registrar's year convention (§10.7); depth is structural. Both are
inputs; neither is a fallback.

### Leverage is the strong graph signal

`leverage(x)` = number of courses reachable downstream of `x`. Far better distributed
than depth, and it names the real gateways:

```
courses unlocking anything: 1,513    more than 5: 404    max 326
highest: ENGW1111 (326) · MATH1341 (326) · ENGW1102 (325) · MATH1241 (324) · MATH1251 (317)
```

First-year writing and calculus each unlock ~325 courses. **"Generators before
consumers" falls straight out of the graph** — no wording, no labels, no judgement.

### Connectedness to the plan is NOT a fourth signal

Tempting: a cell whose candidates feed many later plan courses is load-bearing; one
connecting to nothing is filler. True — but that is **already** what MRV exploits via
domain size and what leverage measures. Adding it as a separate objective term would
double-count the same structure three ways and make the weights meaningless.

**And it has a trap worth naming.** A `~general` cell admits *everything*, so
union-based connectedness comes out misleadingly **high** — it "connects" to the whole
catalog. Any connectedness metric over an unbounded cell is meaningless, the same way
`courseSpec` must return `null` rather than the bounded part of an unbounded card
(see `sample-plan-design.md`). Filler cells would score as the most connected in the
plan, which is exactly backwards.

### Cell ↔ cell precedence: rare, real, and worth propagating

§7.1's precedence propagator only handles *named single-course* cells. Two
**reservations** can also be ordered, when every candidate of B requires some candidate
of A. Measured over 140 programs / 6,636 ordered section pairs:

| relation | rate | usable as |
|---|---|---|
| **strict** — *every* candidate of B needs one of A | **61 (0.92%)** | a **constraint** |
| loose — *some* candidate of B needs one of A | 486 (7.3%) | a preference only |

0.92% is rare but not zero, and where it fires it is a genuine sequence the engine would
otherwise get wrong:

```
architecture_bs_(boston):   EVERY candidate of "SEMESTER 2" needs one of "SEMESTER 1"
architecture_and_english:   EVERY candidate of "Major Seminar" needs one of "Foundational Courses"
```

**Build the strict form; never use the loose form as a constraint** — 7.3% of pairs have
*some* dependency, and forcing order on those would forbid legal plans. Cost is
`|sections|²` candidate-set comparisons per program (~47), which is nothing.

**A validation worth noticing:** Architecture encodes its studio sequence in the section
*titles* ("SEMESTER 1", "SEMESTER 2"). We recover that ordering **structurally, from
prerequisites, without reading the titles at all** — and would equally catch a program
that has the same real ordering but does not name its sections that way, while not being
fooled by one that names them so without meaning it. That is the wording-is-evidence-
never-authority rule paying off in a place we did not design it for.

### Summary: which source answers which question

| question | source | strength |
|---|---|---|
| is this cell depth or breadth? | **spec confinement** | decisive — 89% of sections ≤3 subjects, breadth only via `~general` |
| how much did this course require first? | **boolean-aware chain depth** | weak alone (0 for 76%) |
| how much does it unlock? | **descendant count** | strong, concentrated, actionable |
| what year is it meant for? | **course numbering** | **authoritative** (registrar-published) — the standing proxy we lack Banner data for. Not depth |
| anything at all | descriptions | **never** |

### Breadth is entropy, at two granularities

Breadth is diversity of subject, and Shannon entropy over the distribution is the
standard index:

```
H_subject = −Σᵢ pᵢ log₂ pᵢ      pᵢ = share of placed courses in subject i
```

**But subject entropy treats CS and DS as unrelated when they are adjacent.** Real
intellectual breadth is about *distance*, and we have the data for it —
`subject-colleges.json` maps 187 subjects to colleges. So:

```
breadth = w · H_college + (1−w) · H_subject       w > 0.5
```

College entropy weighted higher, because crossing a college is genuinely more
decorrelated than crossing a subject inside one. This is exactly the "decorrelated
samples" principle made measurable.

## 10.5 Where information theory actually applies

Entropy is the right tool for **three** things here and decoration for the rest.
Being precise about which is the difference between a model and a vocabulary.

**Legitimate:**

1. **Breadth** — §10.4. Textbook diversity index.
2. **Option value ("decide late")** — `Σ_c log₂ |candidates(c)|` over unresolved
   cells is *literally the bits of freedom retained*. This makes "decide late"
   quantitative and unit-consistent with breadth, instead of a vibe.
3. **Information-gain ordering ("generators before consumers")** — place early the
   cell whose resolution most reduces uncertainty about the rest, measured as the
   expected reduction in Σ log₂|candidates| across *other* cells. That is a real
   formalisation of "do the things that produce information other decisions depend
   on, first."

**Decoration — do not dress these up:**

| | why it is not entropy |
|---|---|
| availability risk | that is a probability. `−log p` adds no information over `p` |
| seat scarcity | a capacity count |
| fill % | a ratio |

## 10.6 The candidate-availability curve — how far forward a cell can go

The question "how far forward can a subject's elective be pushed?" has a better answer
than a single bound, and it turns out to be the same quantity as §10.5's option value.

For a cell `c` and term `t`:

```
n(c, t) = |{ x ∈ candidates(c) : depth(x) ≤ index(t)
                               ∧ offering.status(x, season(t)) ≠ "no"
                               ∧ campus(x) admits the program (§10.7) }|
```

- `min{ t : n(c,t) > 0 }` is the domain lower bound §6 already uses.
- **The curve itself is the useful object.** If `n(c, year1) = 2` and
  `n(c, year3) = 40`, placing that cell in year 1 is *legal but starved* — it will be
  answerable in principle and miserable in practice.

So the engine prefers placements where `n` is high, which is the entropy term again:
`log₂ n(c,t)` is the freedom that placement preserves. **Their question and the
option-value objective are the same computation**, which is a good sign the model is
coherent rather than a pile of heuristics.

It also gives a directly useful report line per requirement: *"CS electives: 3
available by Year 2, 41 by Year 3"* — which explains a placement without the student
reading the algorithm.

## 10.7 Constraints that were missing

### Campus — hard, and affects ~133 programs

**3,128 courses are offered on Boston only**; 98 on a single non-Boston campus. And
the corpus is not all Boston:

| | Boston | non-Boston |
|---|---|---|
| undergraduate | 320 | **33** (31 Oakland, 2 Charlotte) |
| graduate | 357 | **~100** (Portland 19, Arlington 19, Oakland 18, Seattle 16, Toronto 11, Vancouver 10, Miami 7) |

For those ~133 programs, ignoring campus generates plans full of courses the student
**physically cannot take**. Program location is already in the program name/metadata
and `offering-summary.cmp` carries the campuses, so this is a cheap hard filter that
nothing currently applies. `"Online"` and `"No campus, no room needed"` admit
everyone and must not be treated as a location.

### Class standing — authoritative, and computable from the plan

Northeastern defines undergraduate standing by **earned semester hours**, not by year
([Academic Progression Standards](https://catalog.northeastern.edu/undergraduate/academic-policies-procedures/progression-standards/)):

| standing | earned SH |
|---|---|
| Freshman | < 32 |
| Sophomore | ≥ 32, < 64 |
| Junior | ≥ 64, < 96 |
| Senior | ≥ 96 |

Standard load is **16 SH/term**; the full-time minimum is **12**. Both match
`creditSystem`'s existing numbers, which is a useful independent check on the code.

**So the engine already knows every student's standing at every term** — it is the
cumulative SH of all terms before it. No scrape is needed for the *student* side; what
Banner would add is which *courses* gate on it.

**And this produces a consequence a human planner would miss.** Standing is credit-
driven, so load and standing interact:

| load | terms to reach junior (64 SH) |
|---|---|
| 16 SH (standard) | 4 terms — start of year 3 |
| 12 SH (full-time minimum) | **6 terms — start of year 4** |

A plan that runs light reaches junior standing **a full year later**, and any course
gated on junior standing becomes unschedulable in year 3. **Co-ops make it worse: a
work term earns 0 SH**, so each co-op pushes standing back by a term.

This is a genuine hard interaction between three things the engine controls — load,
co-op placement, and course eligibility — and it is exactly the class of error that
makes a hand-built plan wrong. `standing(t)` should therefore be a **derived quantity
propagated alongside credit**, not an afterthought.

### Graduate students have no standing ladder

Different model entirely
([Student Time Status](https://catalog.northeastern.edu/graduate/academic-policies-procedures/student-time-status/)):
there is no freshman/junior equivalent. Instead, **time status** — full-time at ≥8 SH,
≥6 with a stipended assistantship, and Dissertation/Dissertation Continuation counting
as full-time regardless — plus **milestones**: matriculated vs special, and for
doctoral work, candidacy.

So grad needs no new machinery: the existing `grad-admission` (209 courses) and
`candidacy` (29) conditions in `prereqConditions.js` are already the right model, and
`credits.min(graduate) = 8` is already correct. **The standing propagation above is
undergraduate-only** — applying a credit ladder to a grad plan would invent a rule
Northeastern does not have.

### Course-side standing gates — a scrape gap, not a data limit

Only ~25 courses state a standing requirement in prose, and 5 of those are
`graduate standing` (already handled by the `grad-admission` condition).
`classifyCondition`'s `"standing"` bucket **never fires** on real data. ENGW 3302's
record carries no standing requirement at all — its only prerequisite is
`ENGW 1102/1111` at minimum grade C.

**But Banner almost certainly has it, under section Restrictions** (class standing,
major, level, campus, program), which `scrape-availability.js` does not fetch. That is
the same per-CRN detail pattern as the `getFacultyMeetingTimes` call it already makes,
so it is an additive scrape step, not a redesign. Restrictions barely change, so fetch
**once per course and cache forever** rather than per term — the instructor pass
already establishes that pattern.

Until then, **course level is the available proxy**: 100% coverage, and it is the
registrar's own encoding of the same idea. "Do not place a 4000-level course in year 1"
is expressible today; "requires junior standing" is not.

### Season availability is the strongest constraint we have, and only we have it

Measured:

| | |
|---|---|
| courses with offering history | 4,716 |
| **offered in exactly ONE season** | **2,094 (44.4%)** |

And the catalog's own plans do not respect it:

| | |
|---|---|
| named-course placements in published plans | 13,761 (1,091 with no history to judge) |
| **placed in a season the course was never offered** | **105** |
| **plan variants with ≥1 such placement** | **73 of 678 (10.8%)** |

Examples: `ARTG 1270` and `ARTG 1271` in Summer 1 (Design and Public Health),
`ARTD 4565` in Fall (Media Arts BFA), `SMFA 4000` in Fall (Studio Art BFA).

**Honest caveats.** Several hits are `COOP 39xx` registration courses, whose offering
pattern is administrative rather than pedagogical — those should be excluded from the
headline. And 1,091 placements had no history to judge at all. So 105 is a floor with
noise, not a precise defect count. The direction is not in doubt.

This is the single best argument for the engine: **the constraint is strongly binding
(44.4% of courses are single-season), the published plans violate it in one variant in
nine, and NU Map is the only thing that has the data to check.**

### Seat supply, not just offered-or-not

`offering.status` is three-valued but binary in effect. Supply is a separate axis, and
your ENGW case is the right instinct:

```
advanced writing (ENGW 33xx, 10 courses)
season   seats  enrolled  sections  fill%
fall      5568      5284       298     95%
spring    7041      6624       372     94%
sumA      2123      1985       113     93%
sumB      2154      1959       114     91%
```

**The measurement contradicts the logistics half of the hypothesis.** Summer carries
4,277 seats a year — a third of annual supply — at the same ~92% fill as fall and
spring. A plan placing advanced writing in summer is not logistically impossible.

Two lessons the numbers force:

- **Supply belongs in the model** (seats and section count per season), because
  "offered" and "offered at scale" are different facts;
- **but fill% is flat here (91–95%) and therefore uninformative within this family.**
  It discriminates across the catalog (p10 23%, median 74%, p90 100%) and not within
  every subset. The engine must not treat a flat signal as informative — a rule worth
  asserting in tests, not just remembering.

**What we cannot do:** `fmt` and `cmp` are unions across *all* terms, so there is no
per-term online-vs-in-person seat split. The "online is more flexible but has fewer
seats" trade is **not measurable today** and would need per-section scraping.

### Corequisites are a joint constraint

A coreq pair must land in the *same* term **and both be offered that season**. Treating
them as two independent constraints admits a term where one is offered and the other is
not. `allocateNode` already pulls coreqs in when matching; the engine must place them
as a unit.

### Risk concentration

Four cells in one term each answerable by only 2–3 courses is far more fragile than
four cells spread across terms. Both satisfy every hard constraint. So the objective
needs a **concentration penalty**: prefer spreading low-`n` cells (§10.6) across terms
rather than clustering them. This is the same shape as `interleave` but about
*answerability* rather than subject variety.

### Chain fragility — what one failure costs

A chain A→B→C placed in consecutive terms has zero slack: fail A and everything
downstream slips a year, worse if A is offered only one season. Measurable today:

```
fragility(x) = |downstream(x)| × (1 / seasons_offered(x))
```

The plan's total fragility is a legitimate robustness objective, and it makes the
student's *"what happens if this goes wrong"* answerable. This is their **Robust**
principle — "name the two or three assumptions this plan dies without" — as a
computation rather than an aspiration.

### Summer has a price

Summer terms are weight 0.5 with `maxSlots` 2, and using them is a real cost (tuition,
no break) that the engine would otherwise spend freely to relieve a heavy fall.
Summer use should be a **threshold the student sets** ("at most N summer terms"), never
something the objective quietly optimises into.

### Level clustering interacts with offering

If every 4000-level course lands in year 4 and 4000-level courses skew fall-only, year 4
fall becomes infeasible while every constraint looks locally satisfiable. Level
distribution and season availability are correlated and must be propagated together —
which the domain formulation in §6 does automatically, provided level is not used as a
*separate* placement rule that bypasses it.

## 11. Verification

**Invariants** — asserted by a corpus test over all 532 + 485 programs, the pattern
`test/invariant/candidates-corpus.test.js` already uses:

| | |
|---|---|
| I1 | every cell assigned exactly one term |
| I2 | no term exceeds `credits.max` (19 UG). **Not `maxSlots`** — §12e |
| I3 | every named course's prerequisites satisfied at its term |
| I4 | a perfect cell→course matching exists |
| I5 | `Σ cell sh ≥ Σ obligation shortfall` (coverage) |
| I6 | total credits ≥ `totalCreditsRequired` |
| I7 | **determinism** — same input yields byte-identical output |
| I8 | propagation never grows a domain |

**Differential** — generated vs published plan, per program, per gate. The bar is
**never worse on a hard gate** (I3, I4, I5), with deltas reported elsewhere. "Never
worse on any gate" would reject 1 SH over a term max in exchange for fixing three
prerequisite violations, which is a better plan.

**Milestones** — the first three are independent and two improve the app on their own:

1. **M1 baseline** — run the gates over all 678 published plans. Evidence for the
   feature, the number to beat, and F2's threshold from the real distribution.
2. **M2 `deriveTerms` death signal** — **244 courses last offered ≥4 terms ago still
   read as offered**, because `birthTermCode` has no counterpart for discontinuation
   and the 2/3 ratio runs over all post-birth terms. Pre-existing; the course bank
   shows them today. **The availability constraint is meaningless until this lands.**
   Care needed in the other direction: a brand-new course looks identical to a dead one.
3. **M3 pre-flight** (§8 F1/F2) — small, self-contained.
4. **M4 demand → cells** (§5). Verify: cells sum to demand, `shared` emits none, every
   cell resolves through `resolveRequirement`.
5. **M5 domains + propagation + search** (§6, §7) — feasibility only, no priorities.
   Verify: I1–I8 on every program, and a defined refusal where impossible.
6. **M6 thresholds**, then **M7 ranked objectives + bands**.
7. **M8 UI** — generation as an alternative to loading the official plan; the ranking
   control; the NUpath view.

---

## 12. NUpath is reported, never planned

NUpath appears **nowhere** in `requirements.json` — it is a separate axis carried on
courses. It splits, and the split is computed:

- **guaranteed** — codes granted by *every* candidate of some requirement, so the
  student gets them whichever course they pick. Plus `EX` from a co-op.
- **open** — everything else, landing on general electives, which are the student's
  free choice.

Measured over 529 undergraduate programs:

| | |
|---|---|
| courses carrying any NUpath code | **1,516 of 7,966 (19%)** |
| codes guaranteed by program structure | **median 2 of 13**, max 9 |
| programs guaranteeing zero | **144 (27%)** |

So ~11 of 13 codes are typically open. **NUpath therefore cannot be a constraint** —
forcing coverage would require naming general electives, the one thing §2 forbids.

And it needs no solver. Once the plan exists the student can see which codes are
missing and where their general-elective cells sit, and match them up. `getCoverage`
already computes coverage and the NUpath panel already renders it; the only new thing
is that a generated plan makes the free slots legible next to the gaps.

---

## 12a. A student is not one program

**172 of the 532 undergraduate "programs" in the corpus are minors.** And the planner
already supports `major`, `major2`, `minor1`, `minor2`, `conc`, `conc2` — they are
first-class fields in the share codec. `generate({ program, … })`, singular, cannot
express a real student.

**And it is not additive — you cannot plan the major then bolt the minor on.** Three
reasons, each fatal on its own:

1. **Courses double-count deliberately.** A minor's courses may already be in the major;
   that is much of the point. `allocateSections` consumes greedily within one program, so
   spanning two needs one allocation over the union, not two runs.
2. **They compete for one credit budget and one set of terms.** A second major consumes
   the *free electives* — which is why CLAUDE.md records "two plans need 262 SH" as
   rhetoric and the real gap as about three courses.
3. **`shared` sections already exist** (314 of them) precisely because cross-counting is
   real inside one program. Across programs it is the norm, not the exception.

So the contract becomes:

```js
generate({
  programs: [                       // ordered: major first
    { program, concentration },     // major
    { program, concentration },     // optional second major
    { program },                    // optional minor(s)
  ],
  shape, studentType, courseMap, ports, priorities, budget,
})
```

Obligations are computed over the **union**, with double-counting allowed where the
programs permit it and the `alldifferent` propagator (§7.2) enforcing that one *take*
answers at most one cell **per program** — not globally, or legitimate double-counting
becomes impossible.

**Concentration was also missing from the signature** and 51 programs require one;
`bf05fdb7f9` already lands concentration narrowing at the candidate level, so the engine
only has to pass it through.

## 12b. Repeatable courses and `alldifferent`

**1,959 courses (24.6%) are repeatable**, and only 505 declare a `repeatMax`. If a
requirement wants 4 SH from a 1 SH repeatable course, that is **four takes of the same
course** — which `alldifferent` over course *ids* forbids outright.

Concretely:

- the matching's right-hand side is **takes**, not courses: `MUS1990`, `MUS1990#2`, …
- take count for a course is bounded by `repeatMax` where declared, and **unbounded where
  not** — matching the existing convention that an over-limit repeat is *reported, not
  blocked* (`repeatInstances.js`)
- `repeatMaxSH` bounds total credit from one course, which is a different limit and also
  needs honouring

Getting this wrong makes music, studio, directed-study and thesis requirements
unsatisfiable — and those are exactly the programs whose plans are hardest to build by
hand.

## 12c. Smaller gaps

| miss | what it needs |
|---|---|
| **GPA requirements exist in 313 of 532 programs (59%)** — mostly "2.500 GPA required in the minor" | a from-scratch plan has no grades, so this can only be **reported**, never checked. `setConstraintStatus` already exists for the shape of it. 59% coverage makes it worth surfacing rather than ignoring |
| **AP / transfer credit is a from-scratch input**, not mid-degree state | it lives in the `incoming` term (`maxSlots: 99`) and `placedOut`. It satisfies prereqs *regardless of term*, and it **counts toward earned SH — so it reaches junior standing sooner** (§10.7). Distinct from §13's out-of-scope "fit around existing courses" |
| **Cohort anchors missing from `shape`** | `buildCohortSemesters` needs entry *and* graduation term+year, not just `years: 4`. `inCohortWindow` depends on them |
| **Capacity pre-flight** | `Σ demand ≤ Σ (credits.max × usable terms)` is cheap arithmetic that catches an impossible *shape* before any search runs — a fourth refusal code alongside §8's F1/F2 |
| **Vacation terms** | published plans carry `vacation` cells; a student may deliberately take a term off. Shape should be able to mark a term unused rather than the engine assuming every term is available |

## 12d. Lifecycle

What happens after "emit a grid". Four of these are defects rather than omissions.

### The emitted grid must contain co-op and vacation entries

`applySamplePlan` builds co-op blocks from **`{coop: true}` entries in the grid**
(`applySamplePlan.js:91` pushes to `coopCells`, then merges runs). A grid of course cells
alone therefore produces **no co-op blocks at all** — the work terms silently become empty
study terms, and every credit and standing calculation downstream is wrong.

So the emitter must write `{coop: true}` in each co-op term and `{vacation: true}` where
the shape marks a term unused. Shape carrying `coops[]` (§4) is *not* sufficient; the
grid is the interface.

### Generating after loading the official plan duplicates everything

`originKey(planLabel, yearIndex, termType, ordinal)` de-dupes by **plan label**. A
generated plan's label differs from the catalog's, so its origins never match — load the
official plan and then generate, and the student gets **two complete sets of
reservations**, roughly double the cells, with no warning.

Two things needed: generated plans take a **distinguishable origin namespace**, and
generating must **replace** any previously applied plan rather than add to it. Note this
is the same trap `sample-plan-design.md` records for re-applying a *different variant* of
the official plan, still open there.

### `why[]` is provenance, and a manual move drops it

A cell annotated `cause: "prereq-lower-bound"` that the student then moves carries a claim
that is **no longer true**, and the governing rule is degrade to less information, never to
wrong information — a stale reason is worse than none.

So `why[]` describes *placement at generation time* only, and any manual move drops it (or
re-labels it "originally placed here because…"). Same provenance-not-identity distinction
`sample-plan-design.md` makes for a reservation's `origin`.

### Determinism needs derived cell ids

`createReservation` uses `Date.now()`, so reservation ids are non-deterministic **by
design**. That is fine for the applied state, but the engine's MRV tie-break and the I7
byte-identical invariant are about the **grid**, which must therefore key cells on
something derived — `(programIndex, sectionIndex, ordinal)` — never on a generated id.
State I7 as a property of the emitted grid, not of the applied plan.

### Three more

| | |
|---|---|
| **a flat objective makes its band meaningless** | a program with no co-op has constant `coop-depth`; best = worst, so the tolerance band is vacuous and rank 1 silently yields to rank 2. Detect flat objectives and skip them rather than computing a degenerate band |
| **`why[]` and the report are user-facing** | so every `cause` value needs a key in all **8 locales** (CLAUDE.md). Cell labels come from catalog section titles, which are English source text and flow through `useTranslatedText` like course titles do |
| **phone performance** | the app runs on phones throughout (`isPhone`). Phase 2's ~480-move passes × 4 banded searches may not be sub-second on a low-end device; the engine may need to run off the main thread |

### A limit on what verification can claim

§11's invariants test **constraints**, which are absolute. Nothing tests whether the
objective produced a *good* plan, because "better" is only defined relative to another plan.
So objective quality is testable **only by differential comparison** — against the published
plan, and against the same program under a different ranking. A limit to state, not an
oversight to fix.

## 12e. Term load, measured

Measured over the **394** four-year / two-co-op plans (the modal shape):

```
total SH in plan        mean 131.3   median 131   min 120   max 154
study terms used        mean  9.8    median  10
   of which SUMMER      mean  3.8    median   4    plans using ZERO summers: 0

per term type      terms    SH p25/med/p75    cells p25/med/p75
  Fall              1166       16/17/17            4/5/5
  Spring            1200       16/16/17            4/4/5
  Summer 1           826        8/ 8/ 8            2/2/2
  Summer 2           679        8/ 8/ 8            2/2/2
```

### Summers are not optional — they are forced by arithmetic

**Zero of 394 plans use no summer terms**; the median uses **four**.

The arithmetic is unforgiving: a four-year shape has 8 fall/spring terms, two 6-month
co-ops consume **two of them**, leaving 6 × ~17 SH ≈ 102 SH against a median requirement
of **131 SH**. The ~29 SH gap is almost exactly four summer terms at 8 SH.

> **So "minimise summer classes" is not an available objective for this shape — it is
> determined.** A candidate preference dies to arithmetic, which is the cheapest way for
> one to die. It survives only where the shape has slack: five-year plans, one-co-op
> plans, and the 66 no-co-op programs.

This also prices §10.7's "summer has a price" honestly: the cost is real but **not
avoidable** in the modal shape, so presenting it as a choice would be misleading.

### `maxSlots` is layout, not a constraint

`semGrid` sets `maxSlots = weight >= 1.0 ? 4 : 2`. Measured: **1,692 published fall/spring
terms carry more than 4 cells**, and the median Fall term carries **5**.

The reason is exactly §5.5's two-quantity model: 17 SH across 5 cells is *four regular
4 SH courses plus a 1 SH lab*. The fifth cell is a **non-billable mandatory coreq**, not a
fifth course.

> **So `maxSlots` must not be a hard constraint** — it would make the engine reject plans
> the catalog publishes. Remove it from the capacity propagator (§7.1) and from invariant
> I2. The credit constraints already do the real work: `total ≤ 19` and
> `billable ≤ 16`. Slot count is a **layout** concern (how many cards fit a row), not an
> academic limit.

### The "four courses" rule is real — about billable courses

The instinct that fall/spring are "full with 4 courses of ≥3 credits" is confirmed, in the
precise form: **p25 is 16 SH across 4 cells**, and the median's 5th cell is a coreq. So the
norm is *four regular billable courses*, and everything above that is non-billable.

That is a clean corroboration of §5.5 from a completely independent direction — the term
loads in published plans reproduce the billing rule without being told it.

## 12f. Graduate plans are a different problem

Measured over the graduate corpus, plus the authoritative policies. Almost nothing above
transfers.

```
485 programs with requirements.json   but only 36 with plan.json   (62 variants)

totalCreditsRequired    p25 16   median 32   p75 36   min 10   max 123
years per plan          1→15  2→25  3→12  4→5  5→4  6→1
co-op term-cells        0→55   1→5   2→2        ← 55 of 62 plans have NO co-op
summer terms used       median 0    zero-summer 32/62

per term type     SH p25/med/p75    cells p25/med/p75
  Fall               2/ 8/12             2/3/4
  Spring             1/ 8/12             2/2/4
  Summer Full Sem.   0/ 2/ 6             1/1/2      ← 50 occurrences
```

### 93% of graduate programs publish no plan at all

**36 of 485.** So §4's "inherit the shape" is not the primary path for graduate work — it
is the exception. §9.4's derived skeleton becomes the **main** mechanism, and it must be
good rather than a fallback. That inverts the priority §4 assumed.

### Graduate terms sit at the full-time FLOOR, not a standard load

Fall and Spring median **8 SH** — exactly `credits.min(graduate)`. Undergraduate plans run
at the standard load (16 of a 19 cap); graduate plans run at the *minimum*. So the
user-visible question is opposite: for undergrad the engine is fitting credits into scarce
terms; for grad there is **headroom** (8 used of 12–16 available) and the binding
constraint is something else.

Combined with a **median 32 SH degree** and a **seven-year limit**
([Regulations for Master's Programs](https://catalog.northeastern.edu/graduate/academic-policies-procedures/regulations-masters-programs/)),
graduate plans have enormous slack: 32 SH across up to 7 years. **Credit capacity is
almost never the binding constraint** — availability (§10.7) and prerequisite order are.

That reorders the objectives for grad: `coop-depth` is nearly meaningless (see below),
`interleave` and `early-breadth` matter little in a 32 SH degree, and **`robustness`
becomes the dominant term.**

### The co-op answers: one, not more — and 8 months exists

[Cooperative Education](https://catalog.northeastern.edu/graduate/academic-policies-procedures/cooperative-education/):

> "Graduate students have the opportunity to complete **one** co-op."
>
> Duration: "**Four months** (spring, fall, or summer full terms)" or "**Six months**" or
> "**Eight months**." College of Professional Studies: "three months or six months."
>
> Eligibility: "cumulative **3.000 GPA**", "completion of **16 semester hours**",
> full-time status, and "the co-op preparatory course or equivalent".

So directly answering the questions:

- **More co-ops is not available.** One. The "more co-ops → more classes per term"
  scenario does not arise.
- **A longer co-op is available** (8 months), and it does *not* force a heavier course
  load — it extends time-to-degree, which the 7-year limit makes almost free. Only if the
  student insists on the *same* graduation date does coursework compress, and then the
  ceiling is the overload cap (12 at Khoury) gated on a 3.500 GPA.
- **The earliest possible co-op is term 3**, because 16 SH must be completed first and a
  term carries 8. That is a real, computable placement bound the engine should enforce.
- **Accelerating is permitted** — there is no minimum time, and the 7-year rule binds only
  the slow side. So "finish quickly" is legal; whether it is wise is a preference, not a
  rule, and the engine should not encode an opinion about it.

### Two gaps in shipped code

| gap | detail |
|---|---|
| **8-month co-op is not representable** | `specialTerms.js` declares co-op durations **4 and 6 months only**. The graduate 8-month option cannot be expressed, and CPS's 3-month option is also missing |
| **co-op terms are forced to 0 study SH** | `getSemStudySH` returns 0 for a work term. But graduate co-op explicitly permits concurrent enrolment — full-time can be met by "one half-time job with concurrent enrolment in **3 or more academic credits**", and "if a student takes a credit-bearing class while on co-op, tuition will be charged at the per-credit rate". So a graduate co-op term may legitimately carry credit, and the model forbids it |

### Two data-shape notes

- **"Summer Full Semester" appears 50 times** in graduate plans as a term type. It spans
  *both* summer halves, while the app's grid has `sumA`/`sumB`. Per CLAUDE.md the
  availability scraper already splits merged summer codes by `partOfTerm`; the **plan**
  side needs the same mapping, or 50 graduate plan terms have nowhere to land.
- **Graduate course credits expire after seven years**, which matters for a plan spanning
  the limit — a course placed in year 7 against a credit earned in year 1 may no longer
  count. Out of scope for a from-scratch plan, but it is the one place time-to-degree has
  a *correctness* consequence rather than a preference one.

### The honest summary

Graduate planning is not "undergraduate with different numbers". It is a **smaller,
slacker problem with a different binding constraint**, no published shape to inherit
93% of the time, one co-op rather than three, and a term load at the floor rather than the
standard. The CSP core still applies unchanged; the **shape generator, the objective
weights, and the co-op model** all need a separate graduate path.

## 13. Deliberately not doing

| | why |
|---|---|
| **fitting around already-placed courses** | a sample plan is from scratch. Reverse-inferring which requirements a student's existing courses were for is inference, not arithmetic — a different and harder problem |
| **section-level timetables** | **no clock times exist.** `beginTime`/`endTime` are returned by Banner and discarded at `scrape-availability.js:256`, so **time-conflict freedom cannot be claimed** at any effort |
| **moving co-ops** | shape is inherited (§4). Overrides deferred, which is why shape is a parameter |
| **naming electives** | §2 |
| **difficulty-aware load balancing** | no difficulty data of any kind (§10.3) |

## 14. Evaluation — what this design actually is

### 14.1 Three layers, and they are cleanly separable

| layer | question | method | certainty |
|---|---|---|---|
| **demand** | what must be taken? | arithmetic over the audit's own allocator | **exact** — no choice is made |
| **feasibility** | where can it go? | constraint propagation + matching | **exact per term**, greedy across |
| **quality** | which legal plan is better? | ranked objectives, local search | **heuristic, and unverifiable except comparatively** |

**The stated minimum bar — prerequisites correct, requirements covered — needs only
layers 1 and 2.** Objectives are pure upside. That is the most important structural
property of this design: there is a valuable, verifiable core and a speculative shell, and
they are separable.

And the core already beats the published plans on measured defects: **10.8% of variants
place a course in a season it is never offered**, plus the prerequisite errors that
prompted this. So value lands before any objective work happens.

### 14.2 Domains are the join point

Everything expresses itself as one thing:

```
requirements → obligations → cells → candidates ─┐
                                                  ├→ DOMAINS → propagate → search → grid
offering · campus · boolean depth · standing ─────┤
shape (co-op terms removed) ─────────────────────┘
```

Availability, campus, prerequisite depth, standing and the co-op shape are five unrelated
facts that all reduce to *"remove terms from this cell's domain"*. That is why the design
holds together rather than being a pile of rules — **there is exactly one place facts
land**, and adding a sixth fact costs nothing structurally.

Objectives never touch domains. They only order values and drive local search. That
separation is what lets `19 SH` hold while optimising, and what makes the objective layer
removable.

### 14.3 What is load-bearing

Remove any of these and the design fails:

| | why |
|---|---|
| **the inversion** (cells constructed *from* requirements) | without it we are back to 40.4% ambiguous cells and cannot claim correctness at all |
| **domains, not DAG positions** | without it there is no algorithm — reservations are 51% of a plan and have no DAG node |
| **MRV ordering** | without it broad electives get placed early, which *is* the original complaint |
| **availability as a hard constraint** | the strongest signal (44.4% single-season) and the one thing only NU Map can check |
| **`deriveTerms` death fix (A1#1)** | 244 dead courses read as offered; **availability means nothing until this lands** |
| **credit bounds (12 / 19)** | the only thing preventing arithmetic nonsense |
| **per-variant shape inheritance** | `4y/1c` splits Y3-vs-Y2, so reconstructing from the triple silently picks a convention |

### 14.4 What is weakest — and it is the part that sounds best

**The objective layer is the least evidenced thing in this document.**

- I have **no measurement** that any of the four objectives improves a plan, because
  "better" is only definable comparatively (§12d).
- The **tolerance bands** are unmeasured — I do not know whether rank 4 sees any freedom
  after ranks 1–3.
- The **3–4 ceiling** is asserted from reasoning, not measured.
- **`interleave` has no evidence at all** behind it; it is an intuition.
- The **information-theory framing** is legitimate for breadth and option value, but it may
  be a *redescription* rather than a mechanism: option value is already what MRV exploits,
  so entropy might change no decision.

This matters because of a pattern in how this document was built: **every time something
was measured, the measurement changed the design.** Fourteen corrections, including
`longestPrereqChains` being the wrong depth, `maxSlots` rejecting 1,692 real terms, summers
being forced rather than minimisable, level not proxying depth, and 52% of programs
supporting one cycle. The reliability of each part is roughly proportional to how much of
it was measured — and the objective layer was measured least.

> **Expect the objective layer to be wrong in ways we cannot currently see, and sequence it
> accordingly.**

### 14.5 The one real risk

Not compute, and not the CSP. **It is the objective layer** (§14.4) — the least measured
part of the design, the only part with no evidence behind it, and the only thing standing
between "a correct plan" and "a plan worth following". §15.4 gives the measurement that
would test it before it is built.

Two things that look like risks and are not:

**Refusal is narrow.** Of the 267 programs lacking `totalCreditsRequired`: **172 minors, 43
certificates, 36 master's, 16 majors.** For a minor or certificate the requirement sections
*are* the whole program, so the total is derivable as `Σ` demand — and a minor is never
planned standalone anyway (§12a). CHART refuses **16 majors**. F2's threshold is still worth
setting from data.

**Availability coverage is good where it matters.** The engine only looks at courses that
are candidates for a requirement:

| denominator | coverage |
|---|---|
| whole catalog | 59.2% |
| **courses NAMED by a requirement** | **91.4%** (22,448 / 24,554) |
| any candidate of a requirement | 85.1% |
| per-program candidate coverage | p10 **78%**, median **89%**, p90 100%, **worst 47%** |

The catalog-wide gap is dominated by courses no program requires — graduate research,
directed study, discontinued long tail. What survives is **per-program**: 8.6% of named
courses lack history and the worst program sits at 47%, so the report states *"availability
verified for 89% of candidates"* and a bottom-decile program carries a visible caveat rather
than a silent one.

### 14.6 Over- and under-designed

| over-designed | why |
|---|---|
| the three-tier priority system with tolerance bands | bands cost N extra solves to establish and there is no evidence they matter. One objective would prove the mechanism |
| `why[]`'s closed vocabulary and `traded` entries | good ideas, but this specifies UI before an engine exists |

| under-designed | why |
|---|---|
| **the multi-program demand union** | §12a states the problem and not the solution. Structurally significant, but a reasonable v2 — the common case is a student wanting their major plan |
| **the graduate path** | 93% publish no shape, so the derived skeleton is the main mechanism and is barely specified. Also **low priority**: the engine's value scales with plan complexity, and a 32 SH master's is 4 terms of 2 courses |

### 14.7 Sequencing

1. **Score the published plans against the four proposed objectives** (§15.4) — the
   highest-value action in this plan. It tests §14.4's weakest layer with data already on
   disk, before a line of engine code. If `coop-depth` cannot separate the two variants of a
   program publishing both cycles, the metric is useless and we learn that for free.
2. **A1#1 (`deriveTerms` death signal)** — availability is load-bearing and currently
   broken. Improves the shipped app on its own.
3. **M1 baseline** — the defect baseline and F2's threshold.
4. **Demand + domains + propagate + search** — the whole minimum bar, **zero objectives**.
   Deliverable and verifiable on its own.
5. **Stop and evaluate against published plans** before writing a single objective.
6. Objectives last, one at a time, each justified by a differential measurement.

**Measure before building the witness matching** (§7.2): if `cells ≤ |candidates|` never
fires across the corpus, the matching propagator is guarding an empty set and step 4 gets
simpler.

### 14.8 The honest summary

**The skeleton is sound and the muscle is speculative.** The layered separation, the
domain join point, and the inversion are all well-founded and measured. The minimum bar is
achievable, verifiable, and already better than what the catalog publishes.

The priority system — the part that generated the most discussion — is the part with the
least evidence behind it, and it is also the part that is safe to defer, because layers 1
and 2 deliver the stated goal without it.

**The single most valuable next action is not code. It is milestone 1**, which would tell
us the refusal rate, the real defect baseline, and F2's threshold — three numbers that
between them determine whether any of this is worth building.

## 15. Plugging the gaps — sorted by how each one closes

### 15.1 Closable now, from our own code (no new data)

Pure derivation or deletion. All of Appendix A1 except #4 and #5:

`deriveTerms` death signal · boolean-aware depth · drop `maxSlots` as a constraint ·
stem in `tokens()` · incremental soft pass · resolve the `effectiveOffered`/`BankPanel`
disagreement · delete dead `getOfferedFromTerms` · fill `getSources()` · extract the credit
rules and `coopGradConflicts` into core.

**Nine of twelve A1 defects need no new information at all.** Several improve the shipped
planner independently of CHART, and #1 is a hard prerequisite for the availability
constraint meaning anything.

### 15.2 Closable by reading the official catalog — bounded and cheap

Most of what we needed has already been answered this way: standing thresholds, the 12/19
credit model, Billing vs Total Hours, the 7-year limit, one graduate co-op at 4/6/8 months,
the numbering system. **The one substantial read left is per-college graduate credit
ceilings** (A1#4) — each college publishes its own *Course Overload* / *Full-Time Status*
page, so this is roughly ten targeted fetches, not research.

Worth noting the pattern: every catalog read in this document either confirmed or corrected
a number we had guessed. The catalog is unusually good at answering these, and reading it is
the cheapest gap-closing mechanism available.

### 15.3 Closable by scraping — and cheaper than it looked

| gap | cost |
|---|---|
| **clock times** (A3#19) | **nearly free.** `beginTime`/`endTime` sit in the *same* `meetingsFaculty[].meetingTime` object the scraper already reads for weekday letters. This is not a new Banner request — it is *not discarding* what we already fetch |
| **per-section rows** (A3#20) | same shape: CRNs are already fetched for the instructor pass and then dropped by `serializeDetail`. Keeping them is a storage decision, not a fetch |
| **section Restrictions** (A3#21) | one detail call per course, the same pattern as `getFacultyMeetingTimes`, and **cacheable forever** since restrictions rarely change — so per-course, not per-term |
| **forward-looking terms** (A3#22) | Banner publishes about a term ahead — CLAUDE.md relies on exactly this for pinned term windows. The data exists; we choose not to store sections for incomplete terms |

**The two largest data gaps require no new Banner traffic.** That materially changes their
priority: a section-level future (time conflicts, real seat counts) is closer than
§13 implies.

### 15.4 Closable by measuring now — including the weakest layer

- **Refusal rate and F2's threshold** — milestone 1. Three numbers that decide whether the
  premise holds.
- **The objective layer can be tested before it is built.** Score the *published* plans
  against the four proposed objectives today:
  - if `coop-depth` cannot distinguish the two variants of a program that publishes both
    cycles, the metric is useless and we learn that for free;
  - the observed *range* of each objective across 678 plans bounds how much freedom exists,
    which is exactly what §10.5's tolerance bands need and currently guess;
  - and if the published plans already score well on an objective, that objective is not
    worth optimising.

  **This is the single most valuable unclaimed measurement**, because it attacks §14.4's
  weakest layer using data we already have.

### 15.5 Not closable — accept and design around

| gap | why, and what to do instead |
|---|---|
| **course difficulty / workload** | no authoritative source exists. RateMyHusky has ratings but scraping third-party ratings carries provenance and terms-of-use exposure that `NOTICE` and `LICENSING.md` §6.2 are deliberately careful about. **Require user-supplied weights; never infer** |
| **per-student seat probability** | needs registration-time priority, class-year restrictions and historical outcomes we do not have. `seatStats` is a historical fill rate and must be presented as one |
| **waitlist** | NEU's Banner reports 0. Documented dead end |
| **whether a plan is "good"** | only definable comparatively (§12d). Not a gap to close — a limit to state |

### 15.6 The honest ranking

1. **Milestone 1** — refusal rate, defect baseline, F2 threshold. Cheapest, and it gates everything.
2. **Score published plans against the proposed objectives** — attacks the weakest layer with existing data.
3. **A1#1** — availability is load-bearing and currently broken.
4. **Stop discarding clock times and CRNs** — free at the point of scrape, and unlocks a whole later feature class.
5. Everything else in A1 — small, independent, improves the shipped app.

## Appendix A — defects and gaps in shipped code

Every item was **measured**, not inferred. Most are independent of CHART and shippable on
their own; several improve the planner today. Grouped by whether they produce a wrong
answer, block representing something real, or are data we never collected.

### A1. Wrong answers today

| # | defect | scale | where |
|---|---|---|---|
| 1 | **`deriveTerms` has no death signal.** `birthTermCode` excludes pre-existence, but nothing excludes discontinuation, and the 2/3 ratio runs over all post-birth terms | **244 courses** last offered ≥4 terms ago still read as *offered*; 733 look discontinued | `courseNorm.js` |
| 2 | **`longestPrereqChains` flattens And/Or**, so every OR alternative counts as required | overestimates depth for **1,169 of 7,966 (14.7%)**, worst **+9** terms. Wrong for any domain bound | `planStats.js:135` |
| 3 | **`maxSlots = 4`** — *not a defect today*, because nothing enforces it; it is layout data. Listed because CHART must not mistake it for a constraint (§12e) | **1,692 published fall/spring terms exceed it**; median Fall carries **5** | `semGrid.js` |
| 4 | **`getSemesterMax(graduate) = 16`** | Khoury's overload maximum is **12**, and the grad ceiling is **per-college**, not university-wide | `creditSystem.js:11` |
| 5 | **`subjectOf` composes a guess with a fact and applies it as a fact.** "Art and design fundamentals elective" → subject `ART` (a real subject), whose spec holds ARTF courses, so `admits` deletes the edge | **20 cells** forced to `~general` against a section they name exactly | `plan-hints.js` |
| 6 | **`bindCells`'s soft pass is all-or-nothing per program** — one bad wording hint discards every good one, including exact title matches | **119 of 501 plan variants (23.8%)** discard all wording evidence | `requirementBinding.js:223` |
| 7 | **`tokens()` does not stem**, so `Science Elective` ≠ `Science Electives` | **562 cells** lost to a trailing `s` — twice the exact-match population | `plan-hints.js` |
| 8 | **`effectiveOffered` and `BankPanel` disagree** on an empty `terms[]`: `prob === null` → `offered: true`, but an empty `terms[]` filters the course out of the bank | **571 courses** have full history yet derive to empty | `offeringStats.js:47` vs `BankPanel.jsx:300` |
| 9 | **`classifyCondition`'s `"standing"` kind never fires** — dead branch | **0** of 244 note-bearing courses classify as standing | `prereqConditions.js` |
| 10 | **`getOfferedFromTerms` is dead and weaker than the live path** (no birth filter, no 2/3 rule) — a trap for a new consumer | 0 call sites | `courseModel.js:67` |
| 11 | **`linked` / `lab` is uniformly false** — dead data downstream | **0 of 17,341** records | `scrape-availability.js` |
| 12 | **`creditSystem.getSources()` returns `[]`** — no citation for any credit number, in a file with a mechanism for exactly that | all 4 numbers | `creditSystem.js:12` |

### A2. Cannot represent something real

| # | gap | scale |
|---|---|---|
| 13 | **Co-op durations are `[4, 6]` only** — the graduate **8-month** co-op and CPS's **3-month** option cannot be expressed | policy-documented options |
| 14 | **`getSemStudySH` forces 0 SH on a co-op term.** Graduate co-op explicitly permits concurrent enrolment ("3 or more academic credits", billed per-credit) | all graduate co-op terms |
| 15 | **`"Summer Full Semester"` has no mapping** to the grid's `sumA`/`sumB` | **50** graduate plan terms |
| 16 | **A student is one program.** No representation for major + 2nd major + up to 2 minors as a *single* plan, though the share codec already has the fields | **172 of 532** undergraduate "programs" are minors |
| 17 | **`alldifferent` over course ids forbids repeat takes** | **1,959 courses (24.6%)** are repeatable; only 505 declare a `repeatMax` |
| 18 | **`originKey` de-dupes by plan label**, so a generated plan and the official plan never match | loading both ⇒ **double** the reservations |

### A3. Data we never collected

| # | gap | consequence |
|---|---|---|
| 19 | **`beginTime`/`endTime` discarded** at `scrape-availability.js:256` | **time conflicts are undetectable at any effort.** Only weekday letters survive |
| 20 | **Per-section rows discarded** — CRNs fetched for the instructor pass, then dropped | cannot answer "which section has seats left" |
| 21 | **Section Restrictions never fetched** (class standing, major, level, program) | standing gates unenforceable; ~25 courses state one in prose and the rest are invisible |
| 22 | **Only completed terms stored** ("stable-only", deliberate) | newest data is Spring 2026; no forward-looking section list |
| 23 | prereq atoms naming a course the catalog lacks (NEU renumbered CS 2500/2510/3500) | **33 courses (0.4%) permanently blocked** — a live false violation. 13.2% of *atoms* are unresolvable but `partial = 0`, so an unresolvable atom **never** silently removes an alternative a student could have used |
| 24 | **CS 2500 absent from the catalog** while `CS 2501 "Lab for CS 2500"` is present | verify catalog completeness before trusting it |
| 25 | **No difficulty or workload data of any kind** | any "hard term" notion would be invented |
| 26 | **`ratemyhusky.json` stores name→slug only, no ratings** | "people over labels" is not scorable |
| 27 | **267 programs have no `totalCreditsRequired`**; 113 plan cells bind to nothing | CHART must refuse these (§8 F1) |

### A4. Architecture / consistency

| # | | |
|---|---|---|
| 28 | **Credit min/max exists only as three independent UI reads** of the adapter — the "second implementation of one rule" the conventions warn about | `SemRow.jsx:172-173`, `StatsPanel.jsx:953-954`, `plannerQueryAdapter.js:538-539` |
| 29 | **`coopGradConflicts` lives in `PlannerContext.jsx:1496`** (UI), not core — CHART cannot reuse it | needs extraction |

### A5. Fixed during this work

| | |
|---|---|
| `dropOnCard` returned `null` for any card with no seat — dragging a bank/panel course onto a reservation silently did nothing | fixed |
| the legacy course path wrote `placements[targetId] = undefined`, **un-placing the card dropped on** | fixed |
| a stale reservation id was inserted into the term order as a ghost card | fixed |
| `resolveRequirement` returned a **string** index for a stored `"0"`, and `isSentinel` then read it as "admits any course" | fixed |
| `resolveRequirement` matched an **empty title** against untitled sections, adopting an arbitrary requirement's courses | fixed |
| a reservation offered a grade dropdown | fixed |

### Suggested independent order

**1, 3, 4, 12** are small, self-contained, and improve the planner with no engine work —
and **1 is a prerequisite for CHART's availability constraint meaning anything**. **6 and
7** together are the cheapest large gain in binding quality. **19 and 21** are additive
scrape steps with the biggest long-term payoff.

## 17. Coverage without moving the plans that already work (2026-08-12)

36% of shapes refuse. Fixing that is the remaining work, and it is constrained by
something that is easy to state and easy to violate: **CS+Math's plan is currently
good, and it must come out identical.** A coverage fix that quietly re-sequences the
479 programs that already generate is not an improvement, it is a regression nobody
asked for wearing a coverage number as a disguise.

So the architecture question is not "how do we search harder". It is **where a fix is
allowed to live** such that it cannot reach a plan that already succeeds.

### 17.1 The placement rule

Every change gets one of four homes, and only the first three are permitted:

| home | when it runs | output-neutral for today's plans? |
|---|---|---|
| **a later rung** | only after every earlier rung has refused | **yes, by construction** |
| **a pre-flight verdict** | before the search; decides routing, not domains | **yes** — converts refusal↔attempt, nothing else |
| **a non-erosion guard** | rejects a phase-2 move that worsens a phase-1 property | **yes** wherever phase 2 was not already worsening it |
| ❌ rung-1 propagators, branch order, objective weights | every program | **no — forbidden** |

The fourth row needs stating carefully, because the first version of this section got
it **wrong in the direction that matters** — it forbade the single most valuable fix
available.

What it said: *strengthening propagation is never output-neutral*, because the search
picks the next cell by MRV — fewest legal terms first (`byConstraint`) — so a
propagator changes domain *sizes*, hence the variable order, hence which solution DFS
reaches first, hence the plan.

That argument is sound only for a propagator that **rewrites domains**. It is false
for one that only **prunes**. A pruning propagator answers a single question — *is this
branch dead* — and cutting branches that contain no solution cannot change the order in
which SOLUTIONS are encountered. The variable order is untouched because
`plan.domain.length` is untouched. The plan is bit-identical and merely reached without
the detour.

So the real rule is finer, and it is the one that decides where a fix may live:

| propagator | effect | where it may live |
|---|---|---|
| **prunes** — returns "dead branch" | traversal order of solutions unchanged | **anywhere, including rung 1** |
| **rewrites** — narrows `plan.domain` | changes MRV order → moves plans | a later rung only |

This is not reasoned about, it is tested. `chart-propagator-neutral.test.js` generates
every sampled program twice, with and without the propagator, and asserts that no plan
moved and none was lost. It has demonstrated teeth: an off-by-one probe (`>=` for `>`)
lost 9 plans and re-sequenced 12 — **while gaining 2**. That last number is the trap
this whole section exists to close. An unsound propagator can raise the coverage
figure and break twenty-one plans in the same change, and a coverage percentage cannot
tell the two apart.

The rest still holds: **every program we want to rescue fails rung 1 by definition**, so
a *rewriting* propagator loses nothing by living in a later rung.

Two properties of the existing ladder make this sound, both verified rather than
assumed:

- **rungs are domain-isolated.** Each rung re-derives from the original `plans`
  (`plans.map(p => ({ ...p, domain: [...p.domain] }))`), so a nogood learned under one
  constraint set cannot narrow the next rung's space.
- **rungs are budget-additive, not budget-stealing.** A rung takes half of what is
  *left* (`(nodeBudget - totalNodes) / 2`), and the wall clock is a single shared
  deadline that every rung checks. So appending a rung spends budget that was
  otherwise unspent, and cannot make a succeeding program slower or a hung tab more
  likely.

### 17.1a The measurement that reordered this section

Written before the post-change sweep landed, §17 assumed `search-budget-exhausted`
dominated the refusals. **It does not**, and the real breakdown moves the priorities:

```
1031 shapes · generated 647 (62.8%) · refused 384 · threw 0
thin full terms 1 of 2019 (0.0%)

search-budget-exhausted   153      no-candidate                14
mostly-unlabelled         105      over-subscribed              9
cell-has-no-legal-term     89      full-term-cannot-reach-four  9
                                   named-prereq 3 · does-not-fit 1 · infeasible 1
```

Three things follow, and two of them contradict what §17 was built around:

- **`search-budget-exhausted` is 40% of refusals, not 75%.** Rung S is still the
  single biggest lever, but it is not most of the problem.
- **194 of 384 refusals (50.5%) are decided BEFORE any search runs** —
  `mostly-unlabelled` in pre-flight and `cell-has-no-legal-term` in domain
  construction. No amount of search strength touches either. A design aimed
  entirely at the search would have addressed under half the population.
- **`mostly-unlabelled` (105) is a CORRECT refusal and must stay.** It fires when
  more than half the degree is derived placeholder — measured at
  `MAX_DERIVED_GE_SHARE = 0.5`, the knee of the distribution — and what it declines
  are PhDs whose stated requirements really are "48 credits of dissertation and
  electives" and studio BAs like `theatre_ba`, which publishes 6 sections covering
  19 of 132 credits. A plan that is 60% "General Elective" cards looks authoritative
  and says nothing. Refusing is the right answer.

Which means the **honest denominator is not 1031.** 105 shapes are refused on
purpose, so the figure that measures the engine rather than the catalog is
647 / 926 = **69.9%**, and the remaining work is 279 shapes, not 384.

### 17.1b `cell-has-no-legal-term` is a catalog fact, not a search failure

Measured at a 60 ms budget — every class here is decided before the search runs, so
the budget cannot affect the anatomy — the 89 blocked shapes break down by which
bound killed the cell:

```
89  (66.4%)  never-offered-in-any-term-this-plan-uses
43  (32.1%)  prereq-chain-longer-than-plan
 1  ( 0.7%)  no-legal-term-after-prerequisites
 1  ( 0.7%)  no-catalog-course-answers-it

blocked cells per refused shape: min 1 · median 1 · max 5
65 of 89 shapes are blocked by exactly ONE cell
```

**A median of one cell blocks a whole degree**, which is why this class looked like a
search problem and is not one at all.

Traced to the end, the `never-offered` majority is **program requirements naming
courses that no longer run.** `CS 3700 Networks and Distributed Systems` blocks four
cybersecurity degrees on its own. Its offering history ends at 202430 — Spring 2024 —
so its fall and spring probability is 0.333 and the >50% bar reads `false` in every
season. `CS 4700 Network Fundamentals` runs 202530, 202540, 202610, 202630 with all
its seasons populated. CS 3700 was renumbered; the requirements still name the dead
one. This is the same pattern already recorded for CS 2500/2510/3500.

Two things this settles, both of which had to be checked rather than assumed:

- **the engine and the app agree.** `offeringProbability` and `offered` return the
  same verdict here, so this is not another instance of the four-implementations bug.
  Refusing to schedule CS 3700 is *correct given the data* — it is not offered.
- **`terms: []` is not the documented unknown case.** 3,250 courses (40.8%, matching
  the recorded figure exactly) have no offering history and read as unknown, hence
  allowed. A further **571 have history that clears no season's bar**, which reads as
  "never offered anywhere". Those are two different states and only the first is the
  one the design licenses as permissive.

So the addressable population splits again, and only two thirds of it is code:

| class | shapes | what actually fixes it |
|---|---|---|
| `search-budget-exhausted` | ~153 | **rung S** — sound, no decision needed |
| `prereq-chain-longer-than-plan` | ~29 | **rung F** — sound, no decision needed |
| requirements naming retired courses | ~59 | **a policy decision**, not an algorithm |
| `mostly-unlabelled` | 105 | nothing — the refusal is right |
| the remainder | ~38 | individually diagnosable |

The retired-course class is the one that cannot be fixed by searching harder, because
the search is right. The options are to keep refusing the degree, or to emit the plan
with the stale requirement named as an unresolvable gap — which trades
"requirement coverage is true by construction" for giving the student the 31 of 32
courses that are correct. That is a product decision about what a student should see,
not an engine question, and it is recorded here as open rather than settled quietly.
Auto-substituting a successor course is explicitly **not** on the list: a wrong
substitution is a wrong plan, and conservative beats clever.

And one problem this section was written to solve has already been solved by the
preference-free rung: **thin full terms are 1 of 2019 (0.0%)**, down from 27 of 1659
(1.6%). The four-course rule no longer needs new machinery — §17.5's guard exists to
stop a *future* optimiser eroding it, not to fix a live defect.

### 17.2 The refusal reason we have is not a diagnosis

153 refusals report `search-budget-exhausted`. That string is a fact about the
search, not about the degree, and it conflates two problems with opposite fixes:

- **unsolved** — a legal plan exists and we did not find it → *search harder*
- **infeasible** — no legal plan exists in this shape → *change the shape, or refuse*

Relaxing constraints for the first is wrong (it degrades a plan that did not need
degrading). Searching harder for the second is wrong (it burns the whole budget
proving nothing). Today the ladder does both blindly, in a fixed order, for every
program.

**Mechanism 1 — the feasibility verdict.** A pre-flight that runs the propagators over
the *whole* problem at depth 0: the cells→seats matching that `alldifferent` already
uses, plus the full-term cardinality arithmetic (`surplus`), over domains that
precedence has already narrowed transitively (`critical.earliest/latest`, applied in
index.js).

The verdict is deliberately **one-sided**, and saying so is the point:

- relaxation **infeasible** ⟹ *provably* no plan in this shape. Sound: the relaxation
  drops constraints, so infeasible-when-relaxed is infeasible-when-not.
- relaxation **feasible** ⟹ **undecided**. It drops credit knapsacking, prereq
  reachability and the interaction between precedence and season, any of which can
  still block.

One-sided is enough to route. On an infeasible verdict the strong-search rung is
*skipped entirely* — it cannot succeed, and skipping it hands its budget to the rung
that can. And the verdict is reportable in the degree's own arithmetic, which
`search-budget-exhausted` never was:

> Industrial Engineering, four years, two co-ops: 32 real courses; 6 full terms need
> 24 of them and 4 half terms hold at most 8. 24 + 8 = 32, zero slack — every full
> term must hold exactly four and every summer exactly two.

That is the sentence a student or an advisor can act on.

### 17.3 Mechanism 2 — a stronger search, for the unsolved

Same constraints. Same hard rules. More competent search, and nothing else.

**1. Chain propagation over the cells not yet placed — BUILT, and it landed the case
this was written for.** `violatesPrecedence` checks edges against cells that already
have a term, and `criticalPath` narrows domains once before the search starts. Between
them sat the blocking case: a chain of three *unplaced* cells needs three distinct terms
in increasing order, and if the assignment has left only two terms where they can go
that is decided immediately — but nothing noticed until all three had been tried and the
budget was spent.

It is the same longest-path computation `criticalPath` performs, with the one difference
that is the point: **a placed cell contributes its actual term instead of its domain's
endpoint**, so every bound tightens as the assignment grows. Two linear sweeps over a
precomputed topological order, run *before* the matchings so a branch the chains already
forbid never pays for one.

Result: **Industrial Engineering and Computer Science generates on all four published
variants**, including the exactly-tight v0/v1 that had survived a six-fold budget
increase, fresh domains, and every constraint relaxation tried individually. Those were
never short of time — they were looking in a space nothing could prune, because the
instance is feasible on capacity, availability and depth (a matching seats all 36 cells)
and its real obstruction is precedence interacting with the two spring terms its co-op
cycle leaves. That is also, retrospectively, why the matching form of `canStillSeat` was
built, measured and dropped: a capacity propagator has nothing to say here.

**2. The cost of a node, which turned out to be the whole story.** `firstFree` re-sorted
`Object.keys(courseMap)` — all 7,966 catalog ids — on every call, and it is called once
per *unbounded* cell per *node*. A degree with five general-elective cells performed five
8,000-element string sorts at every node.

```
business_administration_bsba, one of the clock-bound refusals
  before   5,041 ms      477 nodes    10.6  ms/node
  after      508 ms   16,251 nodes     0.031 ms/node      ~340x
```

Corpus effect: **694 → 744 shapes (67.3% → 72.2%)**, `search-budget-exhausted` 151 → 65,
and the fingerprint diff read **690 unchanged, 0 moved, 50 gained, 0 lost** — the ideal
shape of a performance change, and the clearest demonstration that the §17.1 discipline
works.

Found by *profiling*, after two wrong guesses (an unbounded budget, then per-attempt
setup cost in `unlockValues`, which measures 0 ms). The V8 tick profile was 13.1%
`StringCompare` and 8.7% `ArrayTimSort`, which pointed straight at it.

### 17.3a Three things that were tried and did NOT work

Recorded because each cost real time and the next person will otherwise have the same
three ideas. All were measured, not reasoned about.

**Diversified retry orders — 0 rescues of 344 shapes.** Six extra attempts after the
ladder, each varying the tie-break in `byConstraint`. Node counts rose 16,251 → 20,001,
proving the leftover budget was being spent, and nothing was rescued. Why: re-ordering the
*last* key of a five-key comparator only moves cells that tie on all four keys before it,
and few do — the search re-explored the same region more thoroughly. If diversification is
attempted again, perturb the **value** order (which term a cell tries first), which is what
actually differs between arrangements. Removed; 80 lines for no gain.

**More time — 0 rescues of 5 clock-bound shapes at 4x.** This is the one that matters
most, because it kills a whole feature's justification. Twenty seconds bought only
1,798–3,222 nodes on those shapes, so the budget was never the binding constraint; the
cost of a node was. It follows that **"remove the time limit" buys no coverage**, and
therefore a streaming UI or a Web Worker cannot be justified as a coverage fix. Both may
still be worth building to *explain* the engine — a different argument, which must be made
on its own terms.

**Raising `NODES_PER_MS` to the newly-measured rate — a regression.** Once a node cost
0.031 ms rather than 0.4 ms, correcting 2.5 → 20 looked like straightforward bookkeeping.
It cost 4 plans (744 → 740) and tripled thin terms (1 → 3), and the rung tally says why:
fallback usage collapsed from 74/42 to 49/18. A larger strict allowance spends more of the
*shared wall clock*, so the tiers that actually rescue coverage never ran. This constant
has now failed the same way three times (60% of the node budget, a flat 3,000, and the
"correct" rate), and the invariant behind all three is worth stating once:

> **The strict tier must not be able to spend the clock the fallbacks need.** Coverage is
> carried by the fallback rungs, so starving them is always the wrong trade — even in
> exchange for a strictly better tier running longer.

The node *budget* was raised instead, which gives the rungs headroom without touching the
strict tier's share.

### 17.3b Still to do

1. **Conflict-directed backjumping.** Chronological backtracking re-walks into the same
   wall by a different route; jumping to the deepest cell in the conflict does not. Note
   the risk asymmetry that makes this acceptable to attempt: a CBJ bug costs coverage,
   never correctness, because every returned plan still passes the full prereq-aware
   witness and the hard-rule gate.
2. **Another profiling pass.** The first one found a 340x win in one line. The profile
   after the fix has not been read, and there is no reason to assume it is now flat.

### 17.4 Mechanism 3 — rung F, for the provably infeasible

Reached **only** on an infeasible verdict, which is the guard that matters: a program
that merely needed more search must never have its shape altered, because that is
answering a different question from the one asked.

Ordered by how much of the deal it changes, least first:

1. use a half term the published shape leaves blank (already legal — `optional` terms
   are demoted in branch order, not forbidden — so the verdict tells us whether this
   is even the binding constraint);
2. add one half term: +4 SH, still four years;
3. extend by a full term: changes the number of years.

Each is named in `relaxed[]` so the UI can say *which*, exactly as the existing rungs
do. A plan silently spanning 13 terms when the department published 12 would be worse
than a refusal.

### 17.5 Mechanism 4 — the non-erosion vector

The second permanent problem is not coverage, it is that **the objective is incomplete
and therefore cannot be optimised harder safely.** Measured against the code: the
default ranked objectives are `coop-depth`, `level-order`, `robustness`. These are
*not* scored and exist only as phase-1 branch ordering:

| what makes a plan read well | implemented as | scored? |
|---|---|---|
| electives spread rather than stacked | `crowded` | ❌ |
| a pool placed where its pool is open | `reachAt` / `poolReachMin` | ❌ |
| generators early, terminal courses late | `claimRank` / `generatorBar` | ❌ |
| room left for the electives still to come | `takesReserved` | ❌ |
| a blank summer stays blank | `byOptional` | ❌ |

So a strictly stronger optimiser — branch-and-bound over the stated objective — would
maximise three scores while being free to wreck five properties it cannot see. It
would stack the general electives again and score better for it. That is Goodhart's
law, and it is the specific reason "optimise harder" is not automatically an
improvement here.

The fix is **not** to promote them to scores. Adding scores changes phase 2's landscape
and therefore changes plans that are already good — the forbidden fourth row of §17.1.

The fix is to generalise the one guard that already works. `maxThin` is established
from the plan phase 1 hands over and enforced at every phase-2 commit through
`fullLegal`, so phase 2 cannot erode the four-course floor no matter which pass tries.
That pattern extends to a **vector**: phase 1 records a profile of every convention it
achieved, and phase 2 may not worsen any entry.

Why this is the right shape and not a dodge:

- it is **output-neutral** wherever phase 2 was not already degrading the property, so
  the plans that read well today are untouched;
- it only ever rejects a move that was making the plan worse on a measured axis;
- it makes the objective *complete for the purpose that matters* — a future
  branch-and-bound cannot wreck these, because they are constraints on the trajectory
  rather than scores in the sum;
- it needs no invented weights, which is the thing this codebase keeps refusing to do.

The honest cost, to be measured rather than assumed: the guard can block a move that
gains a lot of `coop-depth` while worsening `crowded` by one. Given the stated priority
— hard correctness first, sequencing explicitly a nice-to-have — that is the right way
to be wrong, but the number of blocked moves is a measurement owed, not a guess.

### 17.6 Mechanism 5 — fingerprints, so "unchanged" is a test and not a claim

Everything above rests on an invariant that is currently checked by argument:
*adding a rung, or a later-rung propagator, must not change any plan that generates
today.* Argument is not enough — three separate measurements this month were
confounded by uncontrolled comparisons, and one attributed a six-commit span to a
single change.

So: a committed file of one hash per generating shape. A change that moves a plan
fails loudly and names the shape. `--accept` regenerates it deliberately, so an
intended improvement arrives as a reviewed diff rather than as silence.

This is cheap (~630 hashes), exact, and it is what converts §17.1's table from a
design intention into an enforced property.

### 17.7 What is deliberately not done

- **No branch-and-bound yet.** It is the last step, not the first, precisely because
  §17.5 must land before a stronger optimiser is safe.
- **No new relaxation rungs.** The hard rules — prerequisite order, availability,
  distinctness, the registration cap, requirement coverage, and four real courses in
  every full fall and spring — do not move. The whole point of the verdict is to stop
  trading them for coverage when the real problem was the search.
- **No wall-clock decisions.** Budgets stay in nodes. The clock may turn an answer into
  a refusal; it must never turn it into a different answer.

### 17.8 Order of work, risk-ordered

Fingerprints first, because it is the instrument every later step is verified with;
then the verdict, because it is a measurement that decides how much of rung S versus
rung F is worth building. Neither changes any output.

1. fingerprints (§17.6) — output-neutral
2. the feasibility verdict (§17.2) — output-neutral; reclassifies the 269 refusals
3. rung S (§17.3) — reachable only by programs that already refuse
4. rung F (§17.4) — reachable only on a proven-infeasible verdict
5. the non-erosion vector (§17.5) — the only step with a measurable quality trade

## 16. Licence / IP

Greenfield and clean-room. It must not touch `sandboxnu/graduatenu` (copyleft,
unsellable under Option B) and consumes `gradRequirements`' public contract only —
that file is the cured one, and `LICENSING.md` §9.1(g)(i) makes the cure prospective.

`src/engine/` as a named, cleanly bounded component with one public entry point is also
what makes it separately licensable: `LICENSING.md` §5 already reserves the NU Map
marks, and a diffuse set of edits across `src/core/` would not be licensable as a unit.

Two conditions in §9.2 keep authorship clean, and both are about *how* the work is
done: **do not submit any part of it for course credit** — that would hand
Northeastern an academic-use licence in the most probable commercial licensee's own
product — and **do not build it under NU employment**.
