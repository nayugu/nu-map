# CHART — open defects, as of 2026-08-13

An audit of the plan engine after the merge at `ccc63a342f`. Every entry states what
is wrong, the evidence, where it lives, and what the fix is. Numbers are measured
unless a line says otherwise; where something is a suspicion rather than a
measurement it says so, because the cost of confident-and-wrong here is a student
scheduling a course they cannot take.

Two sections matter as much as the defect list and are easy to skip:
**§Not defects** records things that were investigated and found sound, so nobody
re-hunts them, and **§Dead ends** records fixes that were built, measured, and
removed.

Corpus figures come from `node scripts/verify-chart.js`: **774 plans generated of
1,031 shapes (75.1%)**, 257 refused, 0 thrown.

> **Worked through on 2026-08-13, later the same day.** Defects 1–4 are closed, and
> one of them was closed by finding it did not exist. The headline change: the
> engine's feasibility predicate was `∃ matching over the UNION of concentration
> options`, and it is now `∀ option, ∃ a matching over THAT option`. Read §1 before
> trusting any other claim in this file — the same author wrote both, and one of
> them was wrong.
>
> Against the audit's own baseline of 780 generated, of which **21 were unfollowable
> for at least one concentration**: now 774 generated and **0** unfollowable. On the
> only metric that means anything — plans a student can actually follow — that is
> **759 → 774**.

---

## Severity

| | meaning |
|---|---|
| **S1** | emits a plan that is wrong — a student could follow it and fail to register |
| **S2** | plan is legal but worse than it should be |
| **S3** | hygiene: dead code, dead keys, unclear ownership |

---

## S1 — correctness

### 1. ~~`prereqReachable` converts a known failure into a pass~~ — NOT A DEFECT

**This entry was wrong.** It is kept in full below, struck through, because it was
the top of the order of work and everything under it inherited its framing.

The claim rested on one unchecked sentence: *"`or` is plain JS `||`"*. It is — but
`ops.or` is **never called with a `null` operand**. `foldPrereqTree` wraps both
combinators before the algebra ever sees them
([`prereqFold.js:53-54`](../src/core/prereqFold.js#L53-L54)):

```js
const or  = (a, b) => (a === null ? b : b === null ? a : ops.or(a, b));
const and = (a, b) => (a === null ? b : b === null ? a : ops.and(a, b));
```

So `false || null` never happens. The fold returns `false`, and `?? true` fires only
for a tree with genuinely no readable operand — which is what it is for. The
null-neutrality was centralised into the parser by `d22634cbed` ("one prereq parser,
with a tripwire"), and this audit read the algebra at the call site without reading
the parser that invokes it.

**Measured, not argued.** A differential test ran the shipped `prereqReachable`
against an explicitly three-valued reference — the very fix this entry proposed —
over **all 2,581 prereq trees in the catalog** × 40 randomised placement worlds each:

```
comparisons     103,240
disagreements         0
trees mentioning a renumbered-away course              565
trees of the exact shape alleged here (OR + absent + readable)   537
```

And the specific accusation, against real catalog data — `CS 4530.prereqs` really is
`CS 3100 Or CS 3500`, and `CS 3500` really is absent:

| | claimed | actual |
|---|---|---|
| `CS 4530` in `CS 3100`'s own term | `true` (bug) | **`false`** |
| `CS 4530` one term later | — | `true` |

*The lesson, since this file exists to record them:* the entry was confident, cited a
line number, drew a derivation, and named the comment two lines above as corroboration
— and was refuted in four minutes by running it. **Be hardest on your most confident
claim** is in CLAUDE.md, and this is what skipping it looks like. Defects 2, 3 and 4
were all filed as downstream of this and all three turned out to be real anyway, for a
different reason: the quantifier, not the fold.

<details>
<summary>The original entry, retained</summary>

**`src/engine/witness.js:177`** — `return ok ?? true`.

The three-valued fold is right and the top-level default undoes it. A `course` leaf
returns `null` for a prerequisite that is renumbered out of the catalog ("not an
operand"), `or` is plain JS `||`, and `false || null` evaluates to `null`, which
`?? true` then reads as satisfied:

```
CS 4530.prereqs = CS 3100 OR CS 3500          CS 3100 placed in term index 4
  CS 3100 → in catalog, placed, fi = 4 → fi < ti → 4 < 4 → false
  CS 3500 → absent from courseMap            → null
  false || null                              → null
  null ?? true                               → TRUE
```

So **CS 4530 reads as prerequisite-satisfied in the same term as CS 3100**. The
same OR-with-a-renumbered-sibling shape reaches the concentration pools: 6 of
Artificial Intelligence's 10 courses require CS 3100, and CS 3500 sits in those
same chains.

The file already warns about this exact class two comments above the bug — *"Reading
it as `true` was a real bug and a subtle one … 'Cannot be verified' and 'is
satisfied' are different claims, and only the first is true."* The `note` leaf was
fixed for that reason; `ok ?? true` reintroduces it because it cannot tell
**no operand at all** (empty tree — `true` is correct) from **every readable operand
failed** (`false || null` — `true` is wrong).

*Fix.* Track whether any operand was readable. Return `true` only when none was;
return `false` when at least one was and none succeeded. Expect this to move plans
and refuse some, so run `scripts/chart-fingerprint-diff.js` with it, not just the
corpus totals.

</details>

### 2. 27% of concentration plans over-pack a term — FIXED

The rate was right and the counts were not. Re-measured with the independent
instrument built for defect 3, over the emitted documents rather than the engine's
internals:

| | audited | measured |
|---|---|---|
| plans | 39 of 143 | **21 of 77** |
| programs | 28 | **20 of 64** |
| rate | 27% | **27.3%** |

The audit's denominator counted every plan of every program that has a
`concentrations` block; only 77 face a real disjunction (≥2 options, `minOptions ≥ 1`,
pools we can enumerate). The rate survived the correction exactly.

The five CS pools are **pairwise disjoint** (intersection 0, union 36), so the
witness proved three cells fillable by drawing one course from each of three
*different* concentrations. `minOptions` is 1, so no student can do that.

**The cause is not defect 1 — it is the quantifier.** CHART's feasibility predicate
was `∃ matching over ⋃ᵢ Poolᵢ`; the predicate a student needs is `∀i ∃ matching over
Poolᵢ`. Those differ whenever the pools differ, which is always.

*And the binding dimension was not prerequisites.* The worst measured case,
`architectural_studies_and_business_administration`, puts two concentration cells in
Year 1 Summer 1, where the Management concentration runs **exactly one** of its 19
courses. Blocked by **season**, with prerequisites entirely satisfied — which no
capacity vector read off prereq depth could ever have seen. See defect 4.

*Fixed* in `witnessPlan`: when a concentration cell carries `optionPools`, the
matching runs once per option with that cell restricted to that option's courses, and
the plan is feasible only if every option succeeds. Season, prerequisites and
distinctness are all quantified together because the witness already checked all
three — this is a change of quantifier, not of machinery.

Two details are load-bearing and easy to undo by accident:

- **The pools travel on the CELL**, attached by `deriveCells`, rather than being passed
  down through `search → improve → isLegal`. A guard threaded through four layers is a
  guard the fifth caller omits; a guard carried by the data is one nobody can forget.
  It also means the quantifier switches itself off exactly when it should — with a
  concentration chosen, `optionPools` is `null` and there is no disjunction left.
- **`candidatesComplete: false` on the propagator.** Its lists are truncated, and
  intersecting a truncation with one option's pool manufactures a false infeasibility.
  See §Not defects.

**Verified with `chart-fingerprint-diff`, not just corpus totals** — the audit asked
for this and it is the check that matters, because a coverage number cannot tell "12
now generate" from "12 now generate and 40 good ones came out worse":

```
unchanged 732     moved 35     gained 3     lost 9
```

Every one of the 47 changed plans belongs to a program with a real concentration
disjunction; **0 plans without one moved**. The blast radius is exactly the set of
programs the rule is about, which is the strongest available evidence that nothing
leaked. The 9 lost are the 8 genuinely-unfillable shapes plus
`political_science_and_business_administration`, which now exhausts its search budget
rather than emitting a plan four of its concentrations could not follow.

### 3. `gatePlan` cannot see reservation fillability — FIXED

`scripts/verify-chart.js` printed *"✓ every generated plan passes every hard rule"*
over all 780 plans while defect 2 was present in 21 of them. A placeholder carries no
course, so the prereq gate had nothing to evaluate and the claim was **scoped to
named courses only** — true, and not what the sentence said.

*Fixed.* `gatePlan` takes `concentrationOptions` and runs, per option, a matching of
the concentration cells against that option's courses — each offered in its term's
season and prereq-clear by then. Two properties were deliberate:

- **The verdict is the gate's own**, including its own fifteen-line matching. A gate
  that imported `witnessPlan` could not detect `witnessPlan` being wrong, which is the
  one thing it exists for. Only the *pools* are shared, read through core's
  `specForNode`/`materialize` — what an option contains is data, not a verdict.
- **It is necessary, not sufficient.** A candidate's prerequisites are read against
  named courses only, so a prereq another reservation would have supplied reads as
  no-claim. That over-estimates availability, which is the safe direction: a violation
  reported is real, and silence is not proof.

It is part of `ok`, so a regression fails the run rather than being reported. The
denominator is printed beside the count — "0 unfillable" means nothing without how
many plans were *exposed* to the question, and the previous gate scored zero by not
asking.

### 4. `concentrationCapacity` is sound but inert — DELETED, and the deletion is the fix

**`src/engine/demand.js`** — the ∀-options bound added on 2026-08-13. It read
static prereq depth, which assumes every prerequisite is taken as early as
possible, so for CS BSCS it computed:

```
[0, 0, 4, 7, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8]
```

It blocked study terms 1–2 and permitted **8** concentration cells at term 5 where the
true answer is **0**.

The audit offered two fixes — fill it in, or delete it. **Neither was quite right**,
because the entry diagnosed one fault where there were three, and only one of them is
about the numbers:

1. **It counted, but was applied as a unary domain filter.** `p.domain.filter(t =>
   caps[t] >= 1)` restricts each cell independently. "At most *k* of these cells in
   the terms up to *t*" is a *counting* constraint over a *set* of cells, and no
   per-cell domain filter can express one however good the counts are. Fixing the
   arithmetic would not have made it bind.
2. **Its numbers came from static depth**, hence the 8-where-the-answer-is-0.
3. **The dimension that actually bit hardest was season, not depth** — see defect 2's
   Summer-A case. Arrangement-aware *prereq* reachability, the audit's suggested
   fill-in, would still have permitted it.

So it is gone, and the exact statement lives in the witness instead. **Measured
separately, one variable at a time**, so the deletion is not credited to the
quantifier fix:

| | generated | gate violations | followable |
|---|---|---|---|
| baseline | 780 | 21 | 759 |
| ∀-option witness, capacity kept | 769 | 0 | 769 |
| ∀-option witness, capacity deleted | **774** | **0** | **774** |

Deleting it **recovered 5 plans** and dropped `concentration-unfillable` refusals from
10 to 8. It was not inert — it was *harmful*, narrowing domains away from arrangements
the exact check accepts. The audit's estimate of its cost (2 plans) was measured
against the old union predicate; beside the correct one it costs more than twice that.

*The general lesson,* which is why this entry is long: an approximation kept beside an
exact rule is a second thing to get wrong, and it is not neutral — it removes options
the exact rule would have allowed. "Inert guard reads as coverage" was the right
instinct and understated the problem.

### 5. The comment that claimed the guard was enforced

Not in the original audit; found while fixing defect 4, and the most alarming thing
in this file.

`src/engine/index.js` carried:

> *The cumulative form of the same bound is enforced for every arrangement in
> `isLegal`, which is where a rule has to live if no mutation is to erode it.*

`isLegal` ([`objective.js:1161`](../src/engine/objective.js#L1161)) contained **no
concentration handling of any kind**. It called `witnessPlan` with the union
candidates, exactly as everything else did. The sentence describes the property that
would have made the design sound, in the place it would have had to live, and it was
never implemented.

An inert guard reads as coverage. A guard that exists only in a comment reads as
coverage *to the person auditing the design* — this file's defect 4 accepted the
claim and looked no further. **Comments asserting that an invariant is enforced
elsewhere must name a function you have opened.**

It is true now: `isLegal` runs the witness on every arrangement it considers, and the
witness quantifies over options because the pools travel on the cell.

---

## S2 — quality

### 6. Empty semesters in 34.8% of plans

**269 of 774** plans contain a semester the student is not enrolled in; longest run
**10 terms**; **363** empty full terms overall. Overwhelmingly graduate. (Was 275 of
780 / 370 before the defect-2 fix; it moved with the corpus, not because anything
addressed it.)

Root cause unknown after **two** attempts, both measured and reverted: a propagator
(−7 plans) and a graduate level-target (empty 355 → 364, 157 plans moved). Do not
retry either without a new hypothesis.

### 7. Requirement clumping, 10× the departments

**3+ cells of one requirement in a term: 347 of 5,000 terms (6.9%)** against a
department baseline of **0.7%** — was 358 of 5,034 (7.1%) before the defect-2 fix,
which improved it incidentally and was not aimed at it. Was 6.4% before
`reclaimFromFiller`; peaked at 11.1% mid-build and was pulled back by the pile-up
ceiling, which caps at the incoming plan's own maximum rather than at anything
principled.

### 8. Nothing pairs the two halves of one summer

`termCapacity` scales each half independently — 19 × 0.5 = 9.5 — so one summer can
come out **Summer A 5 SH against Summer B 9 SH** with nothing balancing them. A
half-term also carries `maxSlots` 2, so the preview draws the shortfall as empty
dashed cards, which is correct rendering of a lopsided plan.

### 9. Coverage: 257 refusals

```
mostly-unlabelled 105    search-budget-exhausted 64    full-term-cannot-reach-four 16
over-subscribed 16       cell-has-no-legal-term 15     no-candidate 13
named-prereq 10          concentration-unfillable 8    chain-has-no-room-left 7
does-not-fit 1           term-at-credit-cap 1          no-room-left-for-the-rest 1
```

Not a defect in itself — refusal is a defined output and the toggle falls back to
the catalog plan. Listed because `mostly-unlabelled` at 105 is a pre-flight verdict
about thin requirement data, not a search failure, and is the largest single
addressable block.

`concentration-unfillable` is new, and is the only class here that represents plans we
previously *emitted*. Every other line was already a refusal.

**All 8 are the degree, not the clock — measured, because the distinction matters and
"the search gave up" is the easy thing to mistake it for.** Re-running exactly those
shapes at **60,000 ms against the usual 5,000** — 12× — rescued **0 of 8**; every one
still reports `no legal placement exists`. That is the honest form of the claim: these
are degrees where no single arrangement serves every concentration, so more search
time cannot help and neither can a better heuristic.

```
ug/international_business_bsib_(boston)                     grad/media_technology_and_ethics_ms_(boston)
ug/computer_science_bacs_(boston)#1                         grad/business_administration_mbafull-time_(boston)
ug/political_science_and_international_affairs_ba_(boston)  grad/physical_therapy_dptpostbaccalaureate_entry_(boston)
grad/physics_ms_(boston)                                    grad/political_science_ma_(boston)
```

(This is also the third time a time-budget sweep has rescued nothing here — see
§Dead ends, "4× time budget, 0 rescues". The budget is rarely the binding constraint
in this engine, and it is worth checking before assuming it is.)

See the open question at the end of this file: the answer to these 8 is probably to
ask the student which concentration they want.

### 10. Layer 2: properties that live only in branch order

Roughly six sequencing properties are enforced by the order cells are visited
rather than by a threshold or a scored objective, so they can be violated silently.
`scripts/lib/chart-gate.js` counts them every run (`clumped`, `studyTerms`,
`fillerCount`, `fillerPositionSum`, `loadSpread`, `longestEmptyRun`) — the
measurement exists, the enforcement does not.

---

## S3 — hygiene

### 11. Dead locale keys

`chart.explain.complete.*`, `chart.explain.legal.*`, `chart.explain.prefs.*`,
`chart.explain.limits.*` and `chart.contract.note` are referenced by nothing, in all
8 locales, left behind when the explainer was cut to four lists.

### 12. `backup.*` and `storage.alarm.*` were dropped in the merge

The `ccc63a342f` resolution took main's trash implementation entire, and the
whole-library backup export/import and the storage-quota alarm went with it. **Main
has no equivalent for either.** The alarm is the one worth reproposing: plans live
only in the browser, and clearing site data now destroys them with no warning.

### 13. `public/northeastern/programs-bundle.json` ownership is unclear

Tracked, but regenerated by `npm run build` — so any local build dirties the tree
and it is not obvious whether a human should ever commit it.

### 14. `chart-gate.js` said it had three callers and had one — PARTLY FIXED

Its header opened by naming the problem it solves:

> *The same four checks are needed by three callers that must not each write their
> own: `test/invariant/chart-hard-rules.test.js`, `scripts/precompute-plans.js`, the
> app, eventually. Three copies of "what counts as a violation" is exactly how CHART
> came to disagree with the app about availability in the first place — four
> implementations of `offered`, one of them weaker than the rest.*

`grep` for importers of `chart-gate.js` returned **one**: `verify-chart.js`. The
invariant test writes its own checks inline, and `precompute-plans.js` does not check
at all. The file describing the four-implementations bug had become a fifth
implementation.

This mattered concretely rather than aesthetically. `verify-chart.js` runs **monthly**,
in `update-courses.yml`; CI runs `test:invariant` on every push. So the reservation
check added for defect 3 protected nothing until the next scheduled data run — a
regression would have surfaced up to a month after the commit that caused it.

*Partly fixed.* `chart-hard-rules.test.js` now imports `gatePlan` **for the reservation
rule only**, which is the one property here that needs a matching; a fourth hand-rolled
matching would be a fourth thing to get wrong. The rest of that file stays inline on
purpose — it is the APP's checkers, and that is the whole point of it.

Still open: `precompute-plans.js` refuses nothing, and the app uses none of it.

*And a sampling defect found while wiring it.* The invariant suite samples 45 programs
uniformly. Only **64 of 748** have a concentration disjunction, so a uniform sample
carries about three, and roughly a quarter of such plans violated the rule — giving a
new guard something near a coin-flip's chance of catching a regression. Disjunctive
programs are now sampled separately (20 more, appended, leaving the uniform 45 and its
seed untouched so every other assertion compares against the same corpus). **A rare
property needs a stratified sample; a uniform one reports "clean" on tails.**

---

## Not defects — do not re-hunt

- **`wideAt` does not null a cell's candidate list.** It truncates the per-season
  `seasonOk` lists only (`src/engine/domains.js`). `candidates === null` means one
  thing: the cell admits any course. The conflation was found and deliberately fixed
  earlier — the comment records that it once made the witness answer a 247-candidate
  Khoury Electives cell with the first course in the catalog. **I claimed this was
  the concentration bug and was wrong.**
- **Concentration cells are not exempt from the witness.** They are bounded cells
  carrying a real spec, and the final witness runs over them with
  `checkPrereqs: true`. **Also a claim of mine that was wrong**; the defect is
  ~~defect 1~~ the quantifier the witness applied to them — see defect 2. Two wrong
  guesses at this bug preceded the right one, and both were about *whether* the
  witness ran. It ran. It was answering the wrong question.
- **`foldPrereqTree` already handles null neutrality; the callers' `or`/`and` never
  see it.** `run()` short-circuits a null operand before `ops.or`/`ops.and` are
  invoked, so every algebra in the repo — `prereqReachable`, `prereqDepth`,
  `prereqRefIds` — gets two real operands or none. Do not "fix" a caller's
  combinator for null-handling, and do not read one without reading
  `prereqFold.js:46-105` first. This is what defect 1 got wrong; 103,240 differential
  comparisons found 0 disagreements.
- **The `runWitness(false)` propagator must never see option pools.** Its candidate
  lists are truncated, and intersecting a truncation with one option's pool
  manufactures a false infeasibility that prunes a feasible branch in silence.
  `candidatesComplete: false` is what holds this line, and there is a unit test named
  for it. This is the same soundness argument as `checkPrereqs`, one level along.
- **Optional concentrations reserve nothing.** 56 programs have `minOptions: 0`, and
  all 56 emit **0** concentration cells. `demand.js` and `requirementBinding.js`
  agree.
- **No program requires more than one concentration.** `minOptions` is 0 for 56 and
  1 for 93, so the ∀-options quantifier is over single options, never combinations.
- **The empty dashed card in the preview is correct.** `TermBody` draws
  `maxSlots − placed`, and a half term's `maxSlots` is 2.
- **`deriveTerms`' missing death signal is CLOSED.** `docs/plan-engine-design.md`
  §10.1 recorded 733 courses whose last four terms are all `false`, of which 244
  still read as offered. Re-measured 2026-08-13: still 733 with four dead terms,
  **0 of them reported as offered**. Milestone 3b landed; the availability
  constraint is not scheduling discontinued courses.

---

## Dead ends — built, measured, removed

- **Reversing `typicalSH`'s tie-break** toward the larger credit. Looks right; cost
  6 sections — the catalog binding's over-subscription ratchet went 34 → 40 via the
  concentration floor's `min` feeding the derived general-elective budget. The
  standalone-credit filter fixes the lab case without a tie at all.
- **A plan-wide `level-order` guard on `reclaimFromFiller`.** Changed nothing: a swap
  moves two cells, and the filler travelling later improves its level fit by about
  what the requirement travelling earlier worsens its. Aggregates are gameable by
  the other half of a swap; the guard has to be per cell.
- **Symmetric distance-from-home** as that per-cell guard. Correct arithmetic, wrong
  question — home 0.64 of ten study terms is term 5.8, so term 3 really is nearer
  than term 9, and it put a 3000-level writing course in the summer of year one.
  Late and early are not symmetric: the convention is a floor.
- **Unlock value for placement.** The idea that a pool should move early in
  proportion to what its candidates unlock. Measured on CS BSCS at 1, 2 and 3 hops:
  the science pool's max is **5** in-plan candidates against CS Fundamentals' **39**,
  mean 0.3, min 0, and only **4 of 44** candidates gate anything. No aggregate would
  have moved it, and every high-unlock pool is already hard-ordered by prereqs.
- **Candidate-set intersection** across concentration options — empty, 0 of 36. The
  same trap CLAUDE.md already records at 86.7% for a different feature. The sound
  form is `∀ option, ∃ matching`, never `∃ course, ∀ options`.
- Earlier, from the design record: diversified retries (0 rescues of 344 shapes),
  4× time budget (0 rescues of 5 clock-bound shapes), and two empty-semester fixes
  (§6).

---

## To revisit — learn from the catalog, and question our own output

Deliberately not a defect list. These are open questions to work through later, and
they split into two directions that are easy to conflate.

### What the catalog's sample plan might still teach us

CHART inherits the published plan's **shape** and replaces its **content**, on the
grounds that the shape is real departmental intent and the ordering is not. That
judgement was made once and has not been re-examined against the corpus since.
Worth asking:

- **Which of their conventions are signal and which are habit?** The level
  convention already earns its place — it turned out to be the only thing holding a
  3000-level writing course out of year one, because "junior standing or above"
  lives in prose that `RESTRICTION_ONLY` discards. That was discovered by breaking
  it. **How many more unrecorded constraints are we currently respecting by
  accident, and would only notice the same way?** This is the highest-value question
  on the page.
- **Their electives appear in 56% of terms against our 34%** (the figure the
  elective reserve was built from). They spread placeholders and we bunch them. Our
  mean placeholder position is now *later* than theirs — 0.645 against 0.601 — which
  we call an improvement. Both cannot be straightforwardly good; what exactly are we
  claiming is better, and does the reserve still do what it was sized to do now that
  `reclaimFromFiller` pulls against it?
- **They clump 0.7% of terms and we clump 6.9%.** Ten times. We have never
  established what makes their number so low — whether it is a rule they follow, a
  by-product of hand-authoring, or an artifact of how we count.
- **The Sample Plan of Study remains a witness, not a source** (§Major/minor
  requirements in CLAUDE.md) — it takes one branch of every choice, so it can prove
  we dropped a requirement and can never prove we have them all. Any comparison
  below has to respect that asymmetry. 62% of programs publish none at all.
- **Their prereq and availability error rates are the bar we cleared**: 7.7% of
  published plans violate prereq order, 31.9% schedule a course in a season it does
  not run, 35.5% do one or the other — 241 of 678. That is the thing CHART is *for*,
  and it should be re-measured whenever either side's data refreshes rather than
  quoted from memory.

### Things in our own generator that do not obviously make sense

- **Placeholder position is our headline quality number and it may be measuring the
  wrong thing.** Later is not self-evidently better; it was chosen because
  front-loaded electives were the motivating complaint. A metric that rewards
  pushing every placeholder to the final term is satisfied by a plan whose last year
  is nothing but placeholders, which is exactly the failure the pile-up ceiling had
  to be added to prevent. The ceiling caps at *the incoming plan's own maximum*,
  which is a value with no justification behind it beyond "no worse than before".
- **`reclaimFromFiller` fights the elective reserve by construction.** The reserve
  exists so specific courses cannot crowd electives out of early terms; the reclaim
  pass exists to take those terms back. Both are defensible in isolation and nobody
  has written down what the resolution between them should be.
- **Three tiers of relaxation, and we do not know which ones earn their keep.**
  `sequencing-preferences` fires 67 times and `term-width` 37. Whether a plan that
  needed a fallback rung is meaningfully worse than one that did not has never been
  measured.
- **`mostly-unlabelled` refuses 105 shapes**, the largest single refusal class, on a
  threshold picked from a corpus distribution. It is a pre-flight verdict about thin
  requirement data rather than a search failure, and it may be refusing programs a
  student would still find useful.
- **The four-course bar is a convention we enforce as a near-constraint.**
  `barSatisfiable` already concedes it cannot apply when a degree has too few
  courses. It does not apply to graduates at all. It is worth asking why a measured
  corpus *maximum* is enforced anywhere.
- **Graduate plans are the weak half and we treat them as the same problem.** The
  empty-semester defect is overwhelmingly graduate, two fixes aimed at it failed,
  and `docs/plan-engine-design.md` §12f already argues graduate plans are a
  different problem. They may need a different shape derivation rather than a patch
  to this one.
- **We inherit the shape and cannot move a co-op that is scheduled too early.** An
  accepted consequence, recorded in the design, and never revisited against how
  often it actually bites.

---

## Order of work

~~1. **Defect 1** — one function, and it unblocks 2. Fingerprint-diff it.~~
~~2. **Defect 3** — without the gate extension, 1 and 2 cannot be shown fixed.~~
~~3. **Defect 2** — re-measure; expect reordering, not refusal.~~
~~4. **Defect 4** — fill in or delete, do not leave inert.~~

**Done, in the order 1 → 3 → 2 → 4, which survived defect 1 evaporating.** Step 2 was
the load-bearing one and the audit was right about why: the gate had to be able to see
the defect before any fix could be shown to work, and it had to be able to see it
*independently* of the engine.

The audit expected defect 2 to "reorder, not refuse". **Half right, measured**: of the
21 wrong plans, about half reordered into legality and the rest became refusals
(`concentration-unfillable`, 8). Everything under S2 is untouched.

### What this left open — the question worth taking next

`∀ option, ∃ a filling` is the correct predicate for a plan shown to a student who has
**not chosen a concentration**. It is also, for 8 shapes, unsatisfiable — and the
reason is not a defect in CHART:

> We are trying to serve one plan to sixteen different students. For
> `architectural_studies_and_business_administration`, an Accounting student and a
> Management student genuinely cannot follow the same schedule, because Management
> runs one course in Summer A and Accounting runs two.

Refusing there is honest and it is not *good*: the toggle falls back to the
department's published plan, which this file elsewhere measures as violating prereq
order in 7.7% of cases and season in 31.9%. So the fallback is a plan with a *higher*
expected error rate than the one we declined to print.

**Planning against the chosen concentration is already built, and already wired.**
A first draft of this section said the machinery "is not wired to this" and that was
wrong — checked, and the whole path exists: `SamplePlanOffer.jsx` takes a
`concentration` prop and passes it to `planGenerator.generate`, which forwards it to
`generatePlan`, which hands it to `deriveCells`; the pick is part of `genKey`, so
changing it regenerates the plan. With a pick, `optionPools` is `null`, the cell
carries one real pool, and the universal constraint switches itself off. MCP's
`SET_CONCENTRATION` drives the same path.

So `∀ option` governs **only the pre-pick preview**, and the 8 refusals describe a
student who has not chosen yet. Measured — every refusing program × every one of its
concentrations, generated with that pick:

```
107 of 126 (program, concentration) pairs generate once a pick is made   (85%)

physics_ms                    0 with no pick  →  3/3        international_business  →  28/30
business_administration_mba   0 with no pick  →  26/27      political_science_ma    →   4/5
physical_therapy_dpt          0 with no pick  →  0/2        computer_science_bacs#1 →   1/5
```

That reframes the whole question. It is not "build per-option generation" — that
exists and works for 85% of the pairs. It is only: **what should the screen say when
no pick is set and no universal plan exists?** Today it refuses, and the student is
handed the department's published plan, which this file measures at 31.9% season
violations — a worse artifact than the one we declined to print.

The cheap and honest answer is a prompt: *"These concentrations need different
schedules — choose one to see your plan."* That is strictly more information than a
refusal, requires no engine change, and is reachable from the refusal reason, which is
why `concentration-unfillable` is a distinct `failure.kind` rather than folded into
`over-subscribed`.

Two genuine holes remain, and both are small:

- **`physical_therapy_dpt` generates for 0 of its 2 options**, and
  `computer_science_bacs#1` for 1 of 5. A prompt does not help those — they refuse
  with a pick too, for ordinary reasons (`over-subscribed`, `no-candidate`). They are
  separate defects and are not about concentrations at all.
- **Do not add a relaxation rung** that emits the union plan with a caveat. It puts a
  knowingly-unfollowable plan on screen and the gate would have to be taught to accept
  it, against this repo's own instruction — *"fix the engine or the data, do not relax
  the gate."* The prompt gets the same information across without printing a plan
  nobody can follow.

### 15. A reservation that is fillable but not CHOOSABLE

Measured 2026-08-13, after the defect-2 fix. Not yet acted on; recorded so the numbers
survive and nobody has to re-derive them.

`minDepthOf` takes the **minimum** over a pool's candidates — "the cell needs only ONE
of them to be takeable" — so one early outlier licenses a term for the whole pool. The
witness then proves the cell *fillable*. But the card says "Concentration" and renders
as a slot the student is invited to fill, which promises a **choice**. Those are two
different claims and only the first is enforced.

Per student — the plan generated **for their own concentration**, which is what they
actually see:

| | ≤1 takeable course | ≤2 |
|---|---|---|
| (plan, concentration) pairs, 690 | **23 (3.3%)** | 66 (9.6%) |
| pre-pick plan, per option, 574 | 24 (4.2%) | 88 (15.3%) |

The per-pair rate is 1.1% of 2,204 and **that is the wrong denominator** — nobody
experiences pairs. It also hides that the failure is concentrated rather than spread:

```
political_science_and_business_administration · Identity, Culture and Politics · [1,2,2,2] of 6
political_science_and_business_administration · Law and Legal Studies          · [1,3,3,1] of 7
computer_science_bscs                         · Foundations                    · [2,1,3]   of 8
```

For those students the concentration is a forced sequence wearing the costume of a
choice.

**The cause is SEASON, not prerequisites** — and this is the part worth reading before
designing anything, because the obvious fix is a dead end:

| blocked by | all pairs | tight pairs (≤3 takeable) |
|---|---|---|
| season | **93.1%** | **86.0%** |
| prerequisites | 5.3% | 9.2% |
| both | 1.6% | 4.7% |

Half-terms hold 11.5% of concentration cells and 24.5% of the collapsed ones. So
replacing `minDepthOf`'s minimum with a *quantile of candidate depth* — the elegant fix,
and the one that suggests itself — would address the 9% and leave the 86% untouched. It
belongs in §Dead ends the moment anyone builds it.

*If it is acted on,* the lever is a placement **preference** in `termPreference`, ranking
terms by how many of the cell's candidates survive there. A preference rather than a
constraint, so it yields where there is no alternative and cannot cost coverage by
construction — which is what the four failed empty-semester attempts lacked. The signal
needs no new machinery: `seasonOk` (`domains.js`) already holds the season-legal
candidates per cell per season, truncation is harmless because only small counts matter,
and for a chosen concentration `candidates` is already that option's pool.

**Measure this first.** A 1-takeable cell is a misrepresentation but still followable —
*unless the student has already taken that course*, in which case it is genuinely
unregistrable and this is S1 rather than S3. CHART plans around completed courses, so
that path exists. It is one probe and it decides the severity of the whole entry.
