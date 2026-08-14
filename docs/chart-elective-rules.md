# General electives — the rules

Design of record. Written after a session in which the engine put four placeholders in Year 3
Fall of International Business, and every fix attempted around the search failed to move them.
The cause was not the search. It was that a general elective had no rules of its own.

## Why they need rules at all

A general elective is the most flexible cell in a plan — any level, any subject, no ordering
requirement — and the engine has always treated that flexibility as licence to defer it. That
is why they stack: electives are the least constrained cells, so most-constrained-first
ordering places them **last**, and by then only the late terms have room. The clumping is an
artifact of *when they are chosen*, not of any decision about where they belong.

They are also not one thing. About half the pool exists to satisfy NUPath competencies the
degree does not otherwise guarantee; the rest is the student's own depth. Those two have
opposite placement logic, and treating them as one category is what makes every plan wrong at
one end or the other.

## The rules

### 1. Split the pool — by arithmetic, per degree

Not a constant. The split is computed from what the major already guarantees:

```
satisfied   = NUPath codes the major's REQUIRED courses carry, whatever the student chooses
remaining   = 13 − satisfied
breadth     = remaining / 1.5          # ~1.5 codes per course, if the student picks efficiently
depth       = generalElectives − breadth
```

Worked: a degree allowing **10** general electives whose required courses guarantee **7**
competencies leaves **6** remaining, which takes about **4** courses to cover, leaving **6**
electives free for anything.

> The worked example first said the required courses guarantee **4**, and that does not follow
> from the formula above it — `13 − 4` is 9, which needs 6 courses and leaves 4 free, not 6. The
> other three numbers (6 remaining, 4 courses, 6 free) are mutually consistent, so the formula
> was right and only `satisfied` was mistyped. Corrected in place rather than deleted, because
> the arithmetic is what the implementation follows and a reader checking it against a wrong
> example would conclude the code was broken.

**Measured, once the formula was wired** (`chart-probe --electives`, 529 undergraduate degrees,
351 with a pool): median pool 11, of which breadth 5 and depth 6, against a median 7 unmet
codes. The pool is entirely breadth for **50 degrees (14.2%)**. The previous fixed rule took
`min(cells, unmet, 4)` — one cell per unmet code, capped at four — so it over-reserved by about
a third, which is exactly the 1.5-codes-per-course factor it did not know about.

Three things this pins down that a fixed "3–4" does not:

- **`satisfied` is what the major guarantees no matter what.** A code carried only by one branch
  of a choice is not satisfied — the student may take the other branch. The same reasoning
  `breadthCodes` already applies to choice cells.
- **1.5 codes per course is an efficiency assumption**, not a fact about the catalog. A course
  carrying two codes does the work of two; the figure is what a student achieves picking well.
  It is the one number here that is an estimate, and it belongs in one named constant.
- **The remainder is what is actually free**, and how it is used depends on the depth of the
  major — which is rule 4, not a separate decision.

Where the arithmetic leaves `depth ≤ 0`, the pool is entirely breadth and there are no depth
electives to place. That is the small-pool case, and it falls out of the formula rather than
needing a threshold of its own.

### 2. No more than N electives in a term — as a CONSTRAINT

Stated as a limit the search must satisfy, not a preference it weighs. A term refuses the
N+1th elective, and even distribution follows by construction; nothing has to hold room open
or reorder anything.

This is the rule that fixes the stacking, and it is the only one that does. Rules 1, 3 and 4
change *which* elective is which; none of them would move a cell out of Year 4.

`UNGUIDED_PER_TERM_CAP` in `search.js` is already this rule, enforced at every rung, in the
packer, and in `objective.js`'s `isLegal` so phase 2 cannot reassemble what placement refused.
International Business's worst term sits at exactly 3 because the cap says 3.

> It was recorded here as "scoped to 'unguided' rather than to electives". That is wrong about
> the code: `reqKey` maps **every** cell whose `target` is `GENERAL_ELECTIVE` to the `UNGUIDED`
> key, labelled or not, and the comment beside it says why — "the bucket is what clumps, not the
> wording on it". So the scope is already exactly "general electives" and the only thing rule 2
> leaves open is N.

**N is 2, and 3 once the ladder concedes.** Measured over the 196 degrees that have depth
electives (321 plans, `chart-probe`):

| cap | refused | short of 4 | terms 3+ unguided | terms 3+ GEs |
|---|---|---|---|---|
| 3 | 41 | 47 | 139 | 138 |
| **2** | 46 | 52 | 9 | **0** |
| 1 | **145** | 68 | 3 | 0 |

**N = 1 is not a stricter convention, it is arithmetic failure.** A degree needs at least as many
course-carrying terms as it has elective cells. The median pool is 11, a four-year shape with two
co-ops has about 10, and **53% of degrees have pools larger than 10** — so cap 1 is infeasible for
most of the corpus by counting alone, and 104 more degrees get no plan. That bound was checkable
in seconds and was instead established by an eleven-minute corpus run. *Do the counting argument
before the measurement when the measurement is expensive and the counting is not.*

**N = 2 costs 5 refusals of 321 to remove all 138 three-elective terms**, and 2 is what the corpus
does — departments leave 2 or fewer cells unsaid in 98.8% of 5,978 published terms. So 2 is
enforced in the strict tier and lifted to 3 by the `term-width` rung, which already exists for
"this program cannot meet the conventions". A degree that fits 2 gets 2; a degree that does not
gets 3 rather than nothing, so **no refusal is caused by the cap**. Three stays the ceiling at
every rung: 14 of 5,978 published terms hold four, and that 0.2% tail is where CHART used to live.

This also answers the "does it vary with how elective-heavy the degree is" half of the question —
it does, but through the rung the degree needs rather than through a formula over its pool size.

> **The earlier measurement that rejected 2 is superseded, not wrong.** The comment in `search.js`
> said two "measured WORSE on every axis: refusals 28 → 30 and thin terms 6 → 13". That was true,
> and it was measured against a demand side that had not been fixed yet — breadth bound to the
> first cells, a positional ramp fighting the graph-derived ordering, and every elective ranked as
> filler. The cap did not get cheaper; the plans it applies to got better shaped. Any future
> re-measurement of a cap has to say which demand side it was taken against.

> **Phase 2 cannot read the constant.** With the cap tier-dependent, `objective.js` reading the
> strict value would refuse a plan phase 1 legally built at 3 — a refusal manufactured entirely by
> the objective layer. `isLegal` takes `maxGE`, a non-erosion bound computed from the incoming
> assignment exactly as `maxThin` is.

### 3. Breadth leans late, distributed

Breadth courses are shallow by nature, so they are what a plan can afford to defer — but
deferring *all* of them is what produces the wall of placeholders. Late-leaning, subject to
rule 2, which prevents the lean becoming a clump.

`demand.js` used to bind breadth to the **first** cells of the pool (`breadthAt` walking from 0),
which is backwards: it put the shallowest electives earliest and pushed the student's depth
behind them. It now binds by even stride from the **back** (`breadthIndices`).

### 4. A depth elective is placed by comparing its depth to the major's own courses

A depth elective enters the same **unlock-then-depth** ordering as a major course: place what
unlocks the most first, then take the deepest thing now unlocked.

A depth elective names no course, so it has no depth of its own — it has an **estimated**
depth, and that estimate means nothing in isolation. It is placed by **comparing it against
the depths of the major's own courses**.

That comparison is the whole of the rule, and it is what makes a single policy produce
opposite-looking plans:

- **shallow major** — its courses bottom out early, so the estimate stands *above* them. The
  elective competes for early slots and wins some, which is correct: in International Business
  the electives *are* the student's depth.
- **deep major** — its chains run past a generic elective, so the same estimate stands *below*
  them. The elective loses those contests and fills in around the chains.

One comparison, opposite outcomes, because the comparand differs. This is also why rule 5 is
close to a consequence rather than an independent rule: in a deep major the comparison has
already put the elective behind.

Consequently there is no positional depth curve. `GE_SPREAD_LO → GE_SPREAD_HI` in `demand.js`
imposed one, on top of an ordering derived from the actual prerequisite graph, and could only
fight it. Both constants are now deleted.

**The comparand is MAX IN-PLAN CHAIN HEIGHT, and it was chosen by measurement.** The rule above
says only "depth", and the obvious reading — course level — cannot carry it. Measured over the
351 degrees with an elective pool, the median level target of the major's own named cells is
**0.36 for International Business and 0.36 for Computer Science and Mathematics**: the two
benchmarks picked precisely because they are opposites are indistinguishable on it, and it takes
only 4 distinct values across the whole corpus. A comparand that is near-constant tells every
elective the same thing, which is what "means nothing in isolation" would become in practice.

Max chain height separates them — IB **2**, CS+Math **3** — over 8 distinct values with a real
spread (p10 1, median 2, p90 4, max 7). It is also the right quantity on the rule's own wording:
the rule talks about *chains running past* an elective, and a chain is what this measures.
`GE_DEPTH_ESTIMATE = 2` is the estimate, and what it has to get right is the **order of two
numbers**, not its own value — which is what makes an estimate safe to act on here.

Max rather than median, because the median major chain height is 0 for over half the corpus:
most named cells are leaves whatever the degree's shape. A degree is deep if it *has* a long
chain, not if its typical course sits on one.

### 5. An elective never takes a slot an unlocked major course could use

Measured on `computer_science_and_mathematics_bs`: a reservation took Year 1 Summer 1 and
pushed CS 3100 to Year 2 Fall. An elective can go anywhere; a major course whose prerequisites
are now met has a reason to be exactly there.

Implemented as `yieldsToMajor` in the term comparator: an elective ranks a term last if some
still-unplaced major **named** cell could use it and the elective would leave no room for a real
course behind it. A **preference**, not a veto — see the priority section — and backed by a
per-term counter of unplaced major cells rather than a scan, because a scan inside a comparator
is O(cells) per node.

> **It does not reach its own motivating case, and that is a fact about reachability rather than
> about the rule.** Measured after wiring, it changes neither benchmark:
>
> - **CS+Math has no depth electives at all** — pool 7, unmet 10, so breadth 7 and depth 0.
>   Breadth electives are filler and are placed *after* every major course, so by the time one
>   picks a term there is no unplaced major cell left to displace and the rule cannot fire. The
>   Year 1 Summer 1 elective is therefore not "taking a slot CS 3100 could use" in the sense
>   stated; whatever pushed CS 3100 to Year 2 Fall, it was not an elective winning a contest.
> - **International Business generates at the `sequencing-preferences` rung**, which is
>   `preferenceFree` — the entire term comparator is skipped, rule 5 with it.
>
> So the rule is live only for a degree that is shallow, *has* depth electives, and generates
> without the preference-free rung. The next person to work on the CS+Math sequencing should
> start from the ordering of major courses, not from the electives.

### 6. Labelled, never restricted

A breadth cell carries its competency as a **label**. It is never given the courses carrying
that code as a hard candidate set.

Measured both ways: a real spec cost 18 → 63 empty full terms while improving unguided terms
only ~12 → 2. And it would overclaim — `attributes` covers 1,516 of 7,966 courses (19%), so a
hard spec excludes four fifths of the catalog on data known to be partial. A student satisfies
IC with any IC course, including ones our scrape has not labelled.

The competency is **not printed on the card** either. Binding it is guidance, one ordering
among several; printing it reads as an instruction about a choice that was never the plan's to
make.

## Priority against the other goals

Most of this is layering rather than ranking.

1. **Hard criteria win.** If a full term needs a fourth real course and only a breadth elective
   can fill it, it goes there — rule 3 yields. The alternative is a refused plan.
2. **Rule 2 is a constraint, so it does not compete.** It bounds the others rather than being
   traded against them.
3. **Rule 5 governs contested slots**, but only slots rule 2 has not already reserved to
   electives by capping them elsewhere. It is a **preference**, and that is not a weakening —
   it is the one shape it can take. Rule 2 bounds a term's *contents*, so it is checkable against
   the term alone and refusing is a true statement about the plan. Rule 5 is about a cell that has
   not been placed yet, so as a veto it forbids a placement on a *prediction*, and a wrong
   prediction costs the student the whole plan instead of one imperfect term. `search.js` has
   already paid for this lesson twice: `crowdsOutAReal` as a veto "took International Business
   from a plan with a short spring to no plan at all", and the standing floor as a filter cost 15
   points of coverage.
4. **Rule 4 is the ordinary ordering** and needs no priority of its own — it *is* the priority
   the rest of the engine already uses.

This is the one place the document's own general lesson needs qualifying. "A correct rule stated
as a constraint removes a class of failures; a preference plus a mechanism relocates it" is right
about rule 2 and wrong as a universal: it holds for rules that bound *what already exists*, and
not for rules that bound *what a search will do next*. The test is whether the rule can be checked
without predicting anything.

## What the code contradicts today

All six are now wired. What the table recorded, and what replaced it:

| rule | was | now |
|---|---|---|
| 1 | breadth capped by unmet-code COUNT — one cell per code, ceiling 4 | `ceil(remaining / 1.5)`, in `electives.js`, called from `deriveCells` |
| 2 | cap is 3 | `UNGUIDED_PER_TERM_CAP` 2 in the strict tier, `UNGUIDED_RELAXED_CAP` 3 from `term-width` on |
| 3 | breadth binds to the **first** cells | binds by even stride from the **back** (`breadthIndices`) |
| 4 | `GE_SPREAD` ramp overrode the engine's own depth estimate | ramp deleted; `GE_DEPTH_ESTIMATE` compared against the major's max chain height |
| 5 | not enforced | `yieldsToMajor`, as a preference — but see the reachability note under rule 5 |
| 6 | correct — labelled, not restricted, and the code no longer prints it | unchanged |

Cells now carry `geRole` (`"breadth"` or `"depth"`), derived from the same set as the `nupath`
label so the two cannot disagree, and `chart-probe --electives` asserts that the emitted roles
match the arithmetic across all 529 undergraduate degrees.

`src/engine/electives.js` no longer predates the rules: `breadthSplit` takes
`{cells, remaining}` and returns `{breadth, depth, all}`, and the fixed 3–4 with its separate
small-pool threshold is gone — the small-pool case falls out of `depth <= 0`.

## How we landed on these

The rules above are the residue of a day of wrong turns. Each dead end is recorded with what
killed it, because every one of them looked correct at the time and will look correct again.

**We started by fixing the search, and the search was not the problem.** International Business
put four placeholders in Year 3 Fall. Four constructors were added around it — eviction repair,
narrow-first packing, term-major packing, a seed from the department's own plan — and none of
them addressed the clumping. Two of them made it worse. The changes that *did* hold up were
demand-side: corequisite grouping, and a choice cell costing its cheapest option. That is the
shape of the whole session — the cells were wrong, and machinery was added to compensate.

**Feasibility-first plus anytime local search — disproved by measurement.** The textbook
answer: find any legal plan, then improve it by feasibility-preserving moves. Eviction repair
is that idea at depth one, and on IB it returned `repairs = 0`. Every blocking term's occupants
had somewhere to go in their *domain* and nowhere with *room*, because the instance is
saturated. An anytime repair loop is the same move with a clock, so it is dead precisely on the
degrees that need it.

**The department's own plan as a seed — actively harmful.** Reading where a department puts each
course sounds like free information. Named courses are fine; the *reservation spread* was
dealt against our cells in cell-id order, which is not a pairing at all — a cell could be handed
Year 1 Spring because its id sorted early. Consulted ahead of the measured ordering, it
produced `CS 4530 or 4535` in Year 1 Spring and CS 3000 at the end of Computer Science. Removed.
Refusals then fell 28 → 22 and short terms 12 → 8, so it had been costing coverage too.

**A level-versus-time correlation metric — measuring a rule we do not hold.** Built to detect
bad sequencing, it assumed deeper-is-later. Our stated optimization says the opposite: major
depth goes **early**, because that is what a co-op recruiter sees. The instrument scored the
engine's best property as a defect (CHART 0.738 against the departments' 0.814), and acting on
it would have destroyed exactly what makes these plans worth reading. Deleted. Its replacement
must measure the rules in the explainer panel — unlock position and the level floor — not
course numbers.

**A positional depth curve for electives — fighting the ordering.** `GE_SPREAD_LO → HI` ramps
an expected depth across the elective sequence. But depth already comes from the prerequisite
graph, so a hand-fitted curve on top of a graph-derived ordering can only disagree with it —
and with breadth bound to the first cells, it disagreed in the wrong direction.

**Holding room open (the `reserve`) — superseded, and this is the important one.** Having
established that electives stack because they are placed *last*, the natural fix was capacity:
reserve slots in every term so space still exists when they are finally placed. That works, and
it is more machinery than the problem needs. Stated instead as a **constraint** — no more than
N electives in a term — the spread is structural: the term refuses the N+1th and nothing has to
be held back, reordered, or weighed. `UNGUIDED_PER_TERM_CAP` was already doing this, at the
wrong number.

That is the general lesson, and it is why these are rules rather than preferences with
mechanisms behind them: **a correct rule stated as a constraint removes a class of failures; a
preference plus a mechanism relocates it.** Every clumping fix attempted as a preference this
session moved the problem somewhere else.

**Reverting to the older engine — measured, and mixed.** The Aug 13 engine sequences
`computer_science_and_mathematics` better: it gets both CS 3000 and CS 3100 into first-year
summers, where the current one lets a reservation take Year 1 Summer 1 and pushes CS 3100 to
Year 2 Fall. But its International Business plan **fails the independent hard-rule gate**. So
neither state dominates, and the target is the union: the old sequencing with the current
legality. That is what rule 5 is.

**One number that frames the remaining work:** 234 of 702 generated plans reach the
`sequencing-preferences` fallback rung, meaning a third of plans are ordered *without* the
measured logic. Whether those read badly to an advisor is unmeasured — "took a fallback" is a
fact about our machinery, not about students — and no architectural argument should be made
about it until that gap is closed.

## The test

Two benchmarks, both in `scripts/chart-bench.js`:

- **International Business** — saturated (32 real courses for exactly 32 slots), shallow major,
  large elective pool. Its published plan passes our hard rules, so a compliant arrangement
  provably exists. If the rules work, Years 3–4 stop being four placeholders.
- **Computer Science and Mathematics** — deep chains of its own. If the rules work, CS 3100
  returns to Year 1 Summer 2 and no reservation displaces it.
