# CHART — criteria for success

Agreed 2026-08-13. These **supplement** the optimization logic already recorded in
`docs/plan-engine-design.md` and CLAUDE.md; they do not supersede any of it. Nothing
here licenses breaking a prerequisite, scheduling a course in a season it does not
run, exceeding a registration cap, or weakening the per-field source hierarchy. Those
remain the floor. What follows is what a plan must ALSO be for the engine to be doing
its job.

Each criterion is stated with the measurement that decides it, because a criterion
that cannot be measured is a preference nobody can be held to — and this file exists
to be attacked, not admired.

---

## 1. Every full term must be full — and "full" must be measured accurately

A full fall or spring carries **four courses of at least 3 SH**. The credit envelope
(12–19 undergraduate, 8–16 graduate) is the constraint on what may be added **on top**
of that; it is not the definition of fullness. You cannot take four courses each
carrying a one-credit lab, because that is 20 credits — so credits limit the extras.

**The measurement was wrong and is the reason this is criterion 1.** `termIsFull`
tested slack against the term's TOTAL load, so a term padded with 5 SH of one- and
two-credit courses reported as full at 17 SH with only three real courses. It could
not distinguish:

```
three 6 SH courses, 18 SH             FULL — the registrar would refuse a fourth
three 4 SH courses + 5 SH of labs     NOT full — the labs belong in a term that
and seminars, 17 SH                   already has its four, and the fourth course
                                      fits once they move
```

The second is International Business Spring 2027. Slack is now measured against the
credit held by **real courses only** (`bigSH`), which changes nothing for a term with
no small courses — Architecture's 16 SH studio is 16 SH of real course either way —
and only bites where padding manufactured the fullness.

*Measured by:* `thin full terms` in `verify-chart`, and the `big` count per term. An
empty full term is the extreme failure of this criterion and is counted separately.

## 2. A plan that can be arranged must surface a plan

A refusal is not a safe default. The fallback is the department's published plan,
which this corpus measures at **7.7% prereq-order violations and 31.9% season
violations** — so refusing to print a slightly imperfect plan while recommending a
measurably wrong one is not conservatism.

Two rules follow:

- **Conventions must be relaxable, and the relaxation must be reachable.** The
  four-course bar is a convention (`gatePlan` deliberately keeps `thin` out of `ok`),
  and it must never be the reason a program gets no plan.
- **A guard that turns a flawed plan into a refusal has made things worse.** Prefer a
  preference in `termPreference` over a veto in the placement loop. Measured twice
  today: a crowding veto took International Business from a plan with a short spring
  to no plan at all, and hard breadth binding cost 12 plans.

*Measured by:* generated count and the refusal tally. **Any change that reduces the
generated count has to justify itself against a correctness gain**, and the count is
the first number to check, not the last.

> ⚠ A refusal reason must never claim a proof the search does not have. With
> `surplus >= 0` the courses plainly count, so "no arrangement fills every full term"
> was false; it is now "none of the arrangements tried".

## 3. No semester should be nothing but general electives — via how electives are EVALUATED

The symptom is a term of four identical "General Elective" cards. The cause is not
that they are late, and the fix is not a cap.

**A general elective is the most flexible cell in a plan, and the engine treated it as
the least.** There is no ordering requirement on it whatsoever: it can be a graduate
seminar inside the major, a first-year course outside it, any level, any subject. The
only electives with a real constraint are the ones covering unmet **NUPath**
competencies — those are breadth and are useless for depth. Everything after them is
free, and free means it can go anywhere and be anything.

Because a `spec: null` cell has no candidate set, every ordering signal in the engine —
prereq depth, season, contention, chain height, the witness — is blind to it. It is not
placed badly; it is **outside the model**, so it lands wherever room is left, which is
the end.

So the order of work is: evaluate electives correctly first, and the term-level
distribution follows. A per-term cap is the guard, never the mechanism.

**And the guidance is a LABEL, not a restriction — this is the part that was got wrong
once and is easy to get wrong again.** Naming the competency on the card gives the
student what they need. Narrowing the cell's candidate set to the courses carrying that
code does not, and it costs the one thing that made the cell valuable: measured over the
plans it touched, hard binding sent empty full terms from 18 to 63 while improving
unguided-heavy terms only from ~12 to 2, where labelling alone lands at 19 and 3.

It would also overclaim. `courseMap[id].attributes` covers **1,516 of 7,966 courses —
19%** — so a hard spec excludes four fifths of the catalog on data known to be partial.
A student satisfies IC with any IC course, including the ones the scrape has not
labelled yet. Say what the elective is FOR; do not pretend to know every course that
qualifies.

*Measured by:* unguided cells per term. The corpus bound: over 5,978 published
undergraduate study terms, cells labelled only "Elective"/"General Elective" number
**≤2 in 98.8%**, 3 in 55 terms, 4 in 14 (0.2%). Departments buy headroom past two by
NAMING — "PSYC elective", "Upper-division elective". So ≤2 is the target, 3 the
working bound, and 4 the outer edge of anything the corpus supports.

---

## Dead ends, measured

Kept because each looked obviously right and each cost coverage. The rule they share:
**a change that reduces the generated count has to pay for itself in correctness, and a
convention is not correctness.**

- **Vetoing a small cell out of a term that still owes real courses.** The rule is right
  and the shape was wrong. Removing options does not help a search find an arrangement;
  it makes it fail. International Business went from a plan with a short spring to no
  plan at all.
- **Ordering big cells before small ones in `byConstraint`.** The same rule as a variable
  ordering, which removes nothing — and it still cost plans, because it overrode the
  most-constrained-first heuristic the search depends on. Measured on a 154-plan sample:
  above MRV, thin terms 18 → 15 and **refusals 2 → 7**. Restricted to where MRV is within
  one term of indifferent, 17 → 16 and refusals 2 → 3. As a pure tie-break below MRV it
  changes nothing at all. Removed rather than left inert, because an ordering key that
  does nothing reads as a principle being enforced when it is not.
- **What DID work** is the same rule as a phase-2 repair: `fillFullTerms` may now evict a
  1–2 credit cell to a term that already holds its four, then fit the real course. Every
  move is checked by `fullLegal`, so it can only rearrange a plan that already exists and
  can never produce a refusal.

---

## The standing trap

Every number above is a rate, and this project has now produced **four** wrong
denominators in one day: 39/143 for concentration over-packing (really 21/77), 1.1% of
cell-option pairs for forced choice (really 3.3% of students), 42 co-op terms (really
90 across 42 programs), and "max 2 unguided" (an artifact of matching only the literal
string "General Elective").

So: **state the filter that produced the denominator, and check whether that filter
depends on the thing being measured.** The co-op case is the warning — the same script
returned 42, 38 and 35 as the engine was fixed, because it counted only terms in
programs that generated. A rate that moves when you fix what it measures is not a rate.

---

## Where it stands

Measured against `origin/main` at `f9df193ce2`:

| | main | now |
|---|---|---|
| generated of 1,031 shapes | 774 | **782** |
| `full-term-cannot-reach-four` refusals | 21 | **0** |
| 3+ cells of one requirement in a term | 6.5% | **3.3%** |
| terms leaving 3+ cells unguided | — | **2.1%** (departments 1.2%) |
| terms leaving 4+ cells unguided | — | **0.4%** (departments 0.2%) |
| thin full terms | 2.1% | 2.6% ¹ |
| EMPTY full terms | 360 | **360** |
| plans with an empty-semester gap | 34.8% | **34.0%** |
| hard-rule violations | 0 | 0 |

¹ Not a regression: the measure is stricter now, and 28 of these plans exist at all
only because the four-course rung finally runs.

### The empty-term regression, and what it cost to find

An intermediate version reached 794 generated and pushed empty terms to 391. Three
hypotheses were wrong before the cause turned up, and the sequence is worth keeping:

1. *"The 20 new plans bring their own empty terms."* No — measured per plan, the 29
   newly-generating plans carried **one** empty term between them; the rise was 764
   plans that already existed getting worse.
2. *"The rebalanced tier shares starved the earlier tiers."* Real, and fixed by paying
   for the new rung with new nodes — but it moved the number by 2.
3. *"`bigSH` was added to the receiving term and never subtracted from the donor."* A
   genuine bug, fixed, and still not the cause.

The cause was **binding breadth electives to a candidate set**, and 33 of the 43
regressed plans had reached the *strict* tier — no relaxation involved at all, which is
what ruled out every ladder explanation at a glance once the data was grouped that way.

That diagnosis took three full-corpus runs at ~10 minutes each. `scripts/chart-probe.js`
now runs the same question over a named list of plans in **13 seconds**, and the whole
bisection above was redone with it in under two minutes. A slow feedback loop is not a
neutral cost: it is why three changes were in flight before the first number came back.
