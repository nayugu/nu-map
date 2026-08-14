# CHART · the derivation view — showing the process, accurately

Design of record for a second page beside the text explainer: not *what* the plan is, but *how
the engine arrived at it*. Nothing here is built yet.

The governing constraint is honesty. A visualization of a search is a claim about how the search
behaves, and this engine has already been burned once by an instrument that measured a rule it
did not hold (`docs/chart-elective-rules.md`, the level-versus-time metric that scored the
engine's best property as a defect). So every form below is chosen because it is *true* at the
scale the data actually occupies, not because it looks like a search.

## 1. What the process actually is

**Not one tree.** The DFS in `attemptPlacement` is a tree — levels are cards in a fixed
`byConstraint` order, branches are terms in `termPreference` order, and it returns at the first
acceptable leaf — but a full generate is a **forest walked in stages**:

| stage | what it is | size |
|---|---|---|
| **Demand** | requirements become cards (`deriveCells`) | ~40 cards, no search |
| **Narrowing** | each card gets its legal terms (`buildDomains`, `criticalPath`) | 40 × 14, no search |
| **Attempts** | up to **40 restarts** × up to **4 ladder rungs**, each rung a *different constraint set* and therefore a different tree | 52 to 20,176 nodes |
| **Packer** | first-fit-decreasing fallback — a greedy, **not a tree at all** | 5 passes |
| **Improvement** | hill climbing over *complete* assignments — local search, **also not a tree** | p50 4 moves, max 18 |

Any single picture captioned "the search tree" would misdescribe the architecture. The view has
to be staged because the process is.

## 2. The measurements that decide the forms

Sampled over the corpus (every 5th undergraduate degree, 49 generating plans):

| | nodes |
|---|---|
| p50 | **52** |
| p90 | **17,144** |
| max | 20,176 (the budget ceiling) |

- ≤ 60 nodes: **51%** of plans
- ≤ 500: 57%
- ≤ 2,000: 63%
- the rest sit at 17k–20k

**The distribution is bimodal, and that is the single most important design fact here.** A degree
is either easy — a few dozen placements, almost no backtracking — or it is saturated and grinds
against the node budget. There is very little in between, so this is not a "degrade gracefully"
problem: it is two populations that want two different levels of detail.

> **A correction this measurement forces.** `search.js` states "a program that generates uses a
> median of 19 and a p90 of 36" in the `DEFAULT_NODE_BUDGET` note. Measured now, p50 is 52 and p90
> is 17,144. The comment is stale — it predates the goal test moving into the search (the
> four-course bar is now checked at every complete assignment, so a lopsided arrangement
> backtracks instead of being accepted). The budget's *sizing argument* still holds; the numbers
> quoted for it do not, and they should be updated whether or not this view gets built.

A second measurement kills the obvious cheap version of this feature. Over 35 plans and 1,168
cards carrying a reason, today's emitted `why` is:

| cause | share |
|---|---|
| `load-balance` | **92.6%** |
| `prereq-forced` | 5.0% |
| `only-season-offered` | 1.7% |
| `forced` | 0.8% |

So a page that simply renders the existing per-card reason would print "placed to even out the
term loads" 1,081 times out of 1,168. **The derivation has to be recorded, not harvested.**

And the two measurements together give the honest headline: **per card the space was wide — 92.6%
of cards were genuinely free — yet 29% of degrees refuse and International Business burns 23,132
nodes on 32 real courses for exactly 32 slots.** The constraint is not per-card, it is *joint*.
A per-card view alone would mislead by whispering "everything was free".

## 3. Architecture — an OUTPUT port, mirroring the input one

`src/engine/ports.js` defines the *input* contract with a permissive default. A trace sink is the
same idea pointing outward: the engine emits events to something it knows nothing about.

```
src/engine/trace.js          the event vocabulary + NULL_TRACE, the free default
src/core/derivation/
    events.js                the event shapes as data; no logic
    reduce.js                events -> a Derivation model (stages, profile, perCard, narrowing)
    profile.js               events -> depth-over-attempts series, envelope-preserving downsample
    causes.js                events -> the card x cause matrix
    tree.js                  events -> a literal tree, ONLY under the drawable threshold
src/ui/derivation/
    DerivationPanel.jsx      the shell and the stage spine
    SearchProfile.jsx        the depth/attempt line
    NarrowingMatrix.jsx      cards x terms, by fate
    CauseMatrix.jsx          card x cause, for the saturated population
```

Rules this respects, from CLAUDE.md: **UI imports ports only, adapters import core only**, and
`src/core/` is pure — no React, no I/O. Everything from events to a renderable model is core, so
it is unit-testable without a browser, which is where the hostile tests go.

**The sink must be free when off.** `verify-chart` generates 1,031 shapes in the monthly workflow
and a 20,000-node trace per shape would be both slow and pointless. `NULL_TRACE` is a frozen
object of empty functions and the call sites are guarded (`if (trace) …`), so a run with tracing
off pays one truthiness check per branch.

**Nothing ships in `plan.json`.** A 20k-node trace is ~40k integers — far too much for the data
pipeline, and it never needs to go there, because **CHART runs in the browser**. The trace is
recorded during a live generate, held in memory for the panel, and discarded. The data pipeline
is untouched, which also means the monthly scrape cannot be broken by this feature.

## 4. The visualization, form by form

Following the procedure in the `dataviz` skill: form first, colour last, and validate the palette
with the script rather than by eye.

### 4a. The stage spine — always shown

A horizontal segmented run: Demand → Narrowing → rung 0 … rung 3 → [packer] → Improvement. Each
segment labelled with what it *gave up* (`sequencing-preferences`, `term-width`, …) and what it
cost. This is the only element that shows the forest, and it is small and exact.

Not a chart of magnitudes — a stepped path. Colour: one accent for the rung that answered,
recessive gray for the ones that failed. That is **emphasis**, which the skill calls the most
underused form, and it is the honest encoding: one attempt produced the plan.

### 4b. The search profile — the primary form, and it works at BOTH scales

**x = attempt index, y = depth (cards committed). One line.**

- rising = committing cards
- a downward spike = a backtrack
- a sawtooth plateau = thrash
- a drop to zero = a restart
- a horizontal reference line at "all cards placed" makes success visible as touching the top

This is the standard way to render DFS behaviour, and the reason it is the right choice here is
the bimodality: **a 52-node staircase and a 17,144-node sawtooth are the same chart.** Nothing is
truncated and nothing is faked, and the difference between the two pictures *is* the insight —
you can see a degree being easy, or see the engine hammering at depth 30 for seventeen thousand
attempts.

One series, so per the skill **no legend** — the title names it. Colour is one accent plus gray,
so no categorical palette and nothing to validate.

**The downsample must preserve the envelope, not average.** At 20k points, render ~2,000 buckets
carrying each bucket's min and max depth. Averaging would smooth away the backtrack spikes, which
are the entire content. This is the one implementation detail most likely to be got wrong.

### 4c. The narrowing matrix — cards × terms, by fate

Rows = cards, columns = terms, each cell one of: **before its prerequisites** · **not offered
then** · **outside its precedence window** · **legal, not chosen** · **chosen**.

**It must be a matrix and not the prettier Gantt of ranges, because domains are not intervals.**
A spring-only course is legal in terms 1, 3, 5 — season availability punches holes. A bar spanning
earliest→latest would draw legality that does not exist. The matrix represents holes correctly;
the bar lies. This is the clearest case in the whole design of the data's nature choosing the form.

Four categories plus a distinguished mark. The chosen cell carries a **ring**, not just a hue, so
identity is never colour-alone; the four fates get a labelled legend. This is the only element
needing `scripts/validate_palette.js`, and it must be run for light *and* dark surfaces.

### 4d. The cause matrix — for the saturated population only

You cannot draw 17,144 nodes and should not pretend to. But every abandoned branch already carries
a named cause — `term-at-credit-cap`, `term-at-slot-cap`, `too-many-of-one-requirement`,
`term-at-its-course-ceiling`, `prereq-order-with-what-is-placed`, plus the propagator kills
`chain-has-no-room-left`, `no-room-left-for-the-rest`, `full-term-cannot-reach-four`. So aggregate
to (card × cause) counts.

"MGSC 2301's placement was rejected 4,102 times, for slot cap" is true, compact, and more useful
than a hairball. Counts are **magnitude**, so this is a heatmap on a **sequential single hue** —
again nothing categorical to validate.

**The panel should say which population the program is in, and why it is being shown this instead
of a tree.** A summary that pretends to be a trace is the dishonest version.

## 5. What NOT to build first

**The literal tree.** For the ≤60-node half it is drawable and adds what the profile cannot show —
*which* of the 14 terms each branch was, and the sibling structure. But it is a second renderer
serving half the cases, and the profile plus the narrowing matrix already answer "why is this card
here". Build it only if, with the first three views in front of a reader, the missing branch
identity is what they actually ask about. `tree.js` is listed above so the seam exists; it stays
empty until that is observed rather than assumed.

## 6. What has to be instrumented

1. **`src/engine/trace.js`** — the vocabulary and `NULL_TRACE`.
2. **`step()` and `block()` in `search.js`** — emit enter / reject(cause) / backtrack; the causes
   already exist as strings, so this is plumbing, not new judgement.
3. **The rung ladder and the restart loop** — emit rung and restart boundaries.
4. **`buildDomains`** — record, per excluded term, *which* narrowing removed it (depth, season,
   the co-op-prep bound), and emit `domain` per cell, which is computed today and thrown away.
   `criticalPath` narrows afterward and must record too.
5. **The report** — carry the bottleneck on success, not only on refusal. `worstFailure` and
   `blockedBy` already exist as locals.

Nothing in 1–5 changes a placement decision. That is the property to hold onto and to test: the
derivation view must be **observation only**, and `chart-propagator-neutral.test.js` is the
template — a trace that changes a plan is a defect in the same class as a rewriting propagator.
