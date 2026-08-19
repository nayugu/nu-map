# CHART — who plans which semester

Written 2026-08-18. Supplements `docs/chart-success-criteria.md` and
`docs/plan-engine-design.md`; supersedes neither. Nothing here licenses breaking a
prerequisite, scheduling a course in a season it does not run, or exceeding a
registration cap — those remain the floor.

---

## The rule, whole

> **Semesters 1–4 are the department's published plan.** A course moves only when a
> prerequisite or its own availability makes that semester impossible, and then only to
> the nearest later semester that works.
> **Semesters 5 onward are CHART's.**

That is the entire design. It is one sentence on purpose: a student reading the
explainer should be able to hold it in their head, and every mechanism below exists
only to make it true rather than approximately true.

Three steps, in `src/engine/earlyTerms.js`:

| step | what it does |
|---|---|
| **ADOPT** | read the chosen variant's first four study terms; record which of our cells each named course answers. Recorded as *intent*, legal or not. |
| **REPAIR** | slide a course later until its term is in the cell's **domain** and after its prerequisites. Iterated to a fixpoint, monotone, so it converges. |
| **FIX** | narrow each surviving cell to that one term, so the ordinary search enforces it and `improve()` cannot move it afterwards. |

## Why adopt, and not hint

The published arrangement used to be a branch **order** — try the department's term
first, take another if the search prefers. That cannot deliver the rule, because branch
order is precisely the thing a search is free to ignore. Measured over the whole
undergraduate corpus, it left term-1 agreement at 57.0% with 15.1% of early courses
landing two or more semesters late.

Adopting instead of hinting, same corpus and same instrument
(`node scripts/chart-early.js --all`):

| | hint (before) | adopt + repair |
|---|---|---|
| generated | 254 | **258** |
| refused | 93 | **89** |
| plans falling back | — | 19 |
| term 1 agreement | 57.0% | **72.0%** |
| term 2 | 40.0% | **65.9%** |
| term 3 | 35.6% | **66.0%** |
| term 4 | 22.8% | **34.2%** |
| **terms 1–4** | 44.5% | **64.3%** |
| courses ≥2 terms late | 15.1% | **6.2%** |

> ⚠ **An earlier version of this table read 54.5% → 73.0%, and those figures were
> inflated.** The instrument collected every `options` group from a generated term, so an
> elective PLACEHOLDER that merely listed `BIOL 2301` among its candidates scored as though
> `BIOL 2301` had been placed there. It now counts only committed rows
> (`options.length === 1`) on both sides, which is the honest question: of the courses a
> department commits to, where did we commit them.
>
> The corrected figure is a **lower bound**. A department's `ENGW 1111` answered by our
> "College Writing — ENGW 1111 or 1102" choice cell counts as missed, because we did not
> commit to that course. That is most of the ~22% `missing` column. Erring downward is the
> right direction, but do not quote the missing rate as "courses we failed to place".

Coverage **rose**. That matters more than the agreement figures:
`chart-success-criteria.md` §2 makes the generated count the first number to check, and
a constraint is exactly the kind of change that can reduce it. It does not here, because
fixing four terms *prunes* the search — the same reason seeding lifted coverage when it
was first introduced.

## Why four

Because four is where a department stops agreeing with **itself**. Comparing each
program's own published variants against each other — same degree, different co-op cycle:

| term | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| variants agree | 76.2% | 73.2% | 50.6% | 36.3% | **4.2%** |

Inside the window a published term is a fact about the **degree**. Past the cliff it is a
consequence of one co-op cycle and says nothing about a student on another, so the level
and unlock preferences — 12,848 measured placements — are the better guide and keep the
job.

> Note the ceiling this implies. Our term-4 agreement is **34.2%** against the
> department's own self-agreement of **36.3%**. You cannot agree with a source more often
> than it agrees with itself, so term 4 is within two points of its ceiling and the
> remaining gap is not a defect to chase.

## What repair may and may not do

Repair only ever moves a course **later**, and only ever into a term already in the
cell's own domain. It therefore cannot make an illegal plan legal — every rule the search
applies still applies, and the fix is a unit domain rather than a placement.

Three harms it repairs, and where each is decided:

| | decided by | note |
|---|---|---|
| **availability** | the cell's `domain` | which already encodes season, co-op prep preceding the first work term, and critical-path bounds. None of it is re-implemented. |
| **order** | `precedence` | the successor moves, never the prerequisite. Departments do publish courses sitting at or before what they require. |
| **capacity** | `termCapacity` | the same function the search enforces, so the two cannot disagree. A published term may exceed the registration cap. |

> **Capacity was missed in the first version, and it mattered more than the other two.**
> Computer Science and Biology publishes a **20 SH** first term against a **19 SH** cap.
> One credit of overshoot made the window unsolvable, the all-or-nothing fallback discarded
> all four terms, and the student got a plan with none of their department's arrangement in
> it — first-term agreement 50%, the whole window 20%. With capacity repaired: **87.5%** and
> no fallback, and the course that moves is `CS 1200`, a 1 SH seminar.
>
> That last part is the tie-break doing real work. Within one intended term, cells are
> repaired **heaviest first**, so the 4 SH courses keep the term their department chose and
> the 1 SH seminar is what leaves. Ascending order performs the identical repair and
> produces a visibly worse plan.

Dropping an illegal placement instead of repairing it *sounds* conservative and is not: a
dropped cell returns to the general search, whose measured bias on exactly these courses
is late — so a first-year course published in an unavailable term would be "safely"
relocated to the fourth year.

**General electives are never fixed.** They are the search's slack, and holding them still
is what would turn a heavy published term into a refusal.

## The fallback

If the search cannot solve with the four terms fixed, they are **all** dropped and the
plan is generated exactly as before, with `report.relaxed` carrying
`"department-early-terms"`. One fallback, not a ladder.

This is what makes the rule incapable of costing a student a plan, and it is
non-negotiable: the alternative a refused student is left with is the published plan
itself, which this corpus measures at 7.7% prereq-order and 31.9% season violations.
Refusing to print a slightly imperfect plan while recommending a measurably wrong one is
not conservatism.

Measured: **19 of 258** plans take the fallback. It was 35 before capacity was repaired —
half the fallbacks were a published term being over the credit cap, not a degree that
could not be arranged.

## When the department publishes nothing

365 of 1,031 shapes publish no plan. For those, `scripts/lib/early-donors.js` builds a
stand-in and it is read through **the same adopt/repair path** — there is one mechanism
here, not two.

Two properties do the work:

- **Per cluster, not per program.** A degree is a bag of subject clusters, and its nearest
  whole-program neighbour is a compromise between them. Asking per cluster lets the
  Biology half of a degree learn from a Biology-heavy program while its Computer Science
  half learns from a CS-heavy one.
- **Similarity is set distance, not overlap.** Jaccard — shared ÷ union — so a donor is
  penalised for requirements the target does *not* have as well as for ones it misses:

  | donor for a 6-course Biology cluster | shared | union | score |
  |---|---|---|---|
  | a 10-course Biology major covering all 6 | 6 | 10 | 0.60 |
  | a 5-course Biochemistry cluster matching 5 | 5 | 6 | **0.83** |

  The tighter program is the better teacher despite matching fewer courses, because
  **structure** is what is being compared. Raw overlap would rank the sprawling one first.

A donor supplies **when**, never **what**: only courses the target already requires are
placed, so the worst case is a requirement scheduled in a term some other department
favours — never a degree with a course in it nobody asked for. Below `MIN_SIMILARITY`
(0.4) nothing is borrowed at all, which degrades to today's behaviour and is always safe.

> ⚠ State the reach honestly. The donor pool reaches **42** programs (35 graduate, 7
> undergraduate), not the whole no-plan population: 358 of the 365 are graduate, and only
> ~36 graduate programs publish a plan to learn from. Held-out accuracy is undergraduate
> 76.5% recall / 68.0% precision, graduate 29.6% / 70.4%, against controls of 31.7% and
> 13.0%.

## What the student sees

The rule is worthless if it is invisible, so `report.earlyTerms` drives a
**"Who planned which semester"** section in `ChartExplainer`, above the caveats:

- one sentence naming the source — the department's plan, similar programs, or CHART's
  own. `source` is read from the report and never inferred from a published plan being
  present, because the fallback drops the arrangement while the plan is still in scope.
  A plan modelled on other programs must never read as this department's.
- every repaired course, with the reason in plain words — "not offered then", or "to keep
  it after a course it requires" — because this is the engine contradicting the catalog
  and a student is entitled to know which of their early semesters we moved.

Terms are emitted as `{ year, semTypeId }`, never as an English phrase: the catalog's own
wording is "Summer 1", which every locale must render "Summer A".

## Measuring it

```
node scripts/chart-early.js            # 60-program sample
node scripts/chart-early.js --all      # the whole undergraduate corpus
node scripts/chart-early.js --all --off  # with the arrangement off, for comparison
```

`test/invariant/chart-early-terms.test.js` ratchets first-term agreement so the mechanism
cannot silently stop reaching the search.

## Dead ends, recorded

- **The early-window hint override** (`EARLY_SEED_TERMS` in `seed.js`, consulted in
  `termPreference`). Right about the trade, wrong instrument — see above. Removed, and the
  removal is **not free**: measured over the full corpus, agreement across terms 1–4 falls
  73.0% → 72.5% on the instrument of the day, with coverage unchanged. The residue sits in
  the plans that take the fallback, where the hint was the only early guidance left. Kept
  out anyway: half a point against a twenty-point gain is a poor reason to run two
  mechanisms for one idea, and the whole point of this design is that a reader can hold the
  rule in their head. Restore it only with a number that says it earns its keep.

  > That comparison was measured before capacity repair and before the instrument was
  > corrected, so treat the 0.5 as an order of magnitude rather than a figure. It has not
  > been re-run, because the decision does not turn on it.
  >
  > Coverage held at the corpus level, and that is a NET figure which should not be read as
  > "no program regresses". On the seeded 60-program sample the count moved 51 → 50, so at
  > least one program lost its plan and at least one elsewhere gained one. State the
  > denominator: a net that holds still can hide two moves in opposite directions.
- **Its measurement hatch never worked.** `earlySeedTerms` was threaded from `generateOnce`
  into `placeCells`, which does not accept that parameter and silently dropped it, so
  `attemptPlacement` always ran the hardcoded default. The commit that added it reports
  "55.9% against 53.4% with the window off"; the code could not produce the second figure.
  A knob that cannot be turned is not a hatch — check that a new one is actually threaded
  before quoting a number from it.
- **Restricting adoption to `named` cells.** Covers only 42.5% of published early courses
  against 61.8% when `choice` cells are included. Fixing a "pick one of" row fixes *when*
  the requirement is met without deciding *which* course meets it, which is sound because
  the search must still answer the cell with an option legal in that term, or fail.
