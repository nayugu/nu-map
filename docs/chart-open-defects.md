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

Corpus figures come from `node scripts/verify-chart.js`: **780 plans generated of
1,031 shapes (75.7%)**, 251 refused, 0 thrown.

---

## Severity

| | meaning |
|---|---|
| **S1** | emits a plan that is wrong — a student could follow it and fail to register |
| **S2** | plan is legal but worse than it should be |
| **S3** | hygiene: dead code, dead keys, unclear ownership |

---

## S1 — correctness

### 1. `prereqReachable` converts a known failure into a pass

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

### 2. 27% of concentration plans over-pack a term

Downstream of defect 1, and measured independently of it with `evalPrereqTree`
against an explicit completed-set:

- **39 of 143 plans** generated for concentration programs, across **28 programs**
- worst shape: **3 concentration cells in a term where the tightest concentration
  offers 0 takeable courses**
- Computer Science BSCS, per option, in that term: **0, 1, 2, 0, 1** — every one
  short of three

The five CS pools are **pairwise disjoint** (intersection 0, union 36), so the
witness proves three cells fillable by drawing one course from each of three
*different* concentrations. `minOptions` is 1, so no student can do that.

*Fix.* Defect 1 first, then re-measure — most of these should reorder rather than
refuse, since concentration cells are ~3 per plan and there are later terms plus
general electives to trade with.

### 3. `gatePlan` cannot see reservation fillability

`scripts/verify-chart.js` prints *"✓ every generated plan passes every hard rule"*
over all 780 plans while defect 2 is present in 39 of them. A placeholder carries no
course, so the prereq gate has nothing to evaluate and the claim is **scoped to
named courses only**.

This is the more serious half of defect 2: without it, any fix is unverifiable by
the instrument we quote.

*Fix.* Extend `gatePlan` to check, per term and per concentration option, that the
cells placed there admit distinct reachable courses.

### 4. `concentrationCapacity` is sound but inert

**`src/engine/demand.js`** — the ∀-options bound added on 2026-08-13. It reads
static prereq depth, which assumes every prerequisite is taken as early as
possible, so for CS BSCS it computes:

```
[0, 0, 4, 7, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8]
```

It blocks study terms 1–2 and permits **8** concentration cells at term 5 where the
true answer is **0**. It never binds where it matters and costs **2 plans**
(782 → 780).

*Fix.* Either fill it in with arrangement-aware reachability — candidates whose
prerequisites are satisfied by courses placed strictly earlier — or delete it. It
should not stay as it is: an inert guard reads as coverage.

---

## S2 — quality

### 6. Empty semesters in 35.2% of plans

**275 of 780** plans contain a semester the student is not enrolled in; longest run
**10 terms**; **370** empty full terms overall. Overwhelmingly graduate.

Root cause unknown after **two** attempts, both measured and reverted: a propagator
(−7 plans) and a graduate level-target (empty 355 → 364, 157 plans moved). Do not
retry either without a new hypothesis.

### 7. Requirement clumping, 10× the departments

**3+ cells of one requirement in a term: 358 of 5,034 terms (7.1%)** against a
department baseline of **0.7%**. Was 6.4% before `reclaimFromFiller`; peaked at
11.1% mid-build and was pulled back by the pile-up ceiling, which caps at the
incoming plan's own maximum rather than at anything principled.

### 8. Nothing pairs the two halves of one summer

`termCapacity` scales each half independently — 19 × 0.5 = 9.5 — so one summer can
come out **Summer A 5 SH against Summer B 9 SH** with nothing balancing them. A
half-term also carries `maxSlots` 2, so the preview draws the shortfall as empty
dashed cards, which is correct rendering of a lopsided plan.

### 9. Coverage: 251 refusals

```
mostly-unlabelled 105    search-budget-exhausted 64    full-term-cannot-reach-four 16
over-subscribed 16       cell-has-no-legal-term 15     no-candidate 13
named-prereq 10          chain-has-no-room-left 7      does-not-fit 1
term-at-credit-cap 1     no-room-left-for-the-rest 1
```

Not a defect in itself — refusal is a defined output and the toggle falls back to
the catalog plan. Listed because `mostly-unlabelled` at 105 is a pre-flight verdict
about thin requirement data, not a search failure, and is the largest single
addressable block.

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
  defect 1, one level down.
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

## Order of work

1. **Defect 1** — one function, and it unblocks 2. Fingerprint-diff it.
2. **Defect 3** — without the gate extension, 1 and 2 cannot be shown fixed.
3. **Defect 2** — re-measure; expect reordering, not refusal.
4. **Defect 4** — fill in or delete, do not leave inert.

Everything under S2 is a real improvement and none of it is a wrong number, so it
waits.
