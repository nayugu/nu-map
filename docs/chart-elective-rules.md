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

Worked, from the specification: a degree allowing **10** general electives whose required
courses guarantee **4** competencies leaves **6** remaining, which takes about **4** courses to
cover, leaving **6** electives free for anything.

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

`UNGUIDED_PER_TERM_CAP` in `search.js` is already this rule, enforced at every rung and in the
packer — set to 3, and scoped to "unguided" rather than to electives. International Business's
worst term sits at exactly 3 because the cap says 3.

> **Open decision: N = 1 or 2**, and whether it varies with how elective-heavy the degree is.

### 3. Breadth leans late, distributed

Breadth courses are shallow by nature, so they are what a plan can afford to defer — but
deferring *all* of them is what produces the wall of placeholders. Late-leaning, subject to
rule 2, which prevents the lean becoming a clump.

Today `demand.js` binds breadth to the **first** cells of the pool (`breadthAt` walks from 0),
which is backwards: it puts the shallowest electives earliest and pushes the student's depth
behind them.

### 4. Every other elective has no special rule

A depth elective enters the same **unlock-then-depth** ordering as a major course: place what
unlocks the most first, then take the deepest thing now unlocked.

This is the rule that makes a single policy produce opposite-looking plans. Where a major has
deep chains of its own, electives fill in around them. Where it does not — International
Business — the electives *are* the depth, and the ordering puts them early on its own, without
a special case. The elective's depth is always **relative to its major**.

Consequently there is no positional depth curve. `GE_SPREAD_LO → GE_SPREAD_HI` in `demand.js`
imposes one, on top of an ordering derived from the actual prerequisite graph, and can only
fight it.

### 5. An elective never takes a slot an unlocked major course could use

Measured on `computer_science_and_mathematics_bs`: a reservation took Year 1 Summer 1 and
pushed CS 3100 to Year 2 Fall. An elective can go anywhere; a major course whose prerequisites
are now met has a reason to be exactly there.

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
   electives by capping them elsewhere.
4. **Rule 4 is the ordinary ordering** and needs no priority of its own — it *is* the priority
   the rest of the engine already uses.

## What the code contradicts today

| rule | current behaviour |
|---|---|
| 1 | breadth capped by unmet-code COUNT — one cell per code — rather than by `remaining / 1.5` |
| 2 | cap is 3, scoped to "unguided" rather than electives |
| 3 | breadth binds to the **first** cells, not the later ones |
| 4 | `GE_SPREAD` ramp imposes a positional depth curve |
| 5 | not enforced; a reservation can outrank an unlocked major course |
| 6 | correct — labelled, not restricted, and the code no longer prints it |

`src/engine/electives.js` predates rule 1's arithmetic — its `breadthSplit` uses a fixed 3–4
with a small-pool threshold, which the formula above replaces. Nothing is wired.

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
