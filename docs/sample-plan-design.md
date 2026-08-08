# Sample plans & elective slots — design of record (2026-08-07)

Loading a department's published Sample Plan of Study into a student's planner,
and making the ~51% of it that names no course into something they can act on.

**Status: §§1–4 implemented on `feat/sample-plan-redesign`; §§9–14 are design
only.** One shipped decision deliberately diverges from §2 — see §9.1. This
supersedes two earlier attempts
(`feat/elective-slots`, `feat/plan-slot-binding`), which are kept as reference
branches and are not merged. Everything asserted below is measured against the
shipped corpus; the numbers are in [Evidence](#evidence), and every design
choice cites the measurement that forced it.

---

## The one rule everything follows from

> **A sample plan is a set of decisions the student must make. Our job is to say
> what each decision is and when it falls — never to make one for them.**

Four corollaries, each of which kills a design that would otherwise look
reasonable:

1. **Never invent.** Dropping an entry costs a student a little; fabricating one
   places a course into their plan as though the department asked for it. When
   in doubt, offer less, never more.
2. **Never collapse a choice.** If the catalog gives options, the stored form
   keeps *all* of them, in the shape the catalog gave them. A choice flattened
   into a list is a decision made on the student's behalf, silently.
3. **Wording may narrow; only arithmetic decides.** The plan pane and the
   requirements pane are two descriptions of one degree written by the same
   department, and they do not agree with each other.
4. **Ambiguity is cheap; false confidence is not.** An unresolved decision costs
   a longer list of options. A wrongly-resolved one tells a student they are
   done when they are not.

---

## Evidence

Every number here is measured, not estimated. They are the constraints the
design has to satisfy.

### Scale

| | |
|---|---|
| plans published (undergrad + grad, all variants) | **678** |
| programs shipping a plan | **385** undergrad, **36** grad |
| cells naming no course ("placeholders") | **9,629** |
| distinct wordings for those 9,629 cells | **1,353** |
| share of a plan's credit that is a placeholder | **~51%** |

### The parse is mechanically sound

The catalog prints each term's total beside it, which makes the grid
self-checking.

| | terms |
|---|---|
| parsed entries sum to the catalog's stated total | **9,485** |
| disagree | **7** |
| **agreement** | **99.93%** |

**This is why the HTML→grid reader is not being rewritten.** Its column
walking, code-from-link-titles, and hours pairing are verified. Only the *shape
it emits* is wrong.

### Why wording cannot be the key

The same requirement — identical ten-course list, same 4 SH — is titled two
different ways in two programs, and each program's plan cell matches the *other*
program's title:

| program | plan cell says | requirement section titled |
|---|---|---|
| CS **and Mathematics**, BS | `Computing and social issues` | **Supporting Course** |
| CS, **BSCS** | `Computing and Social Issues` | **Computing and Social Issues** |

A matcher keyed on wording gets one right, the other wrong, and cannot tell the
two situations apart.

### Why arithmetic can be

The same program's plan and requirements reconcile to the credit hour:

| requirement outstanding | demand | cells that answer it |
|---|---|---|
| Khoury Approved Electives | 8 SH | 2 × `Khoury Elective` |
| Mathematics Electives | 12 SH | 2 × `MATH elective` + 1 × `Math elective` |
| Supporting Course | 1 course | 1 × `Computing and social issues` |
| general electives | 28 SH | 7 × `General Elective` |
| | **52 SH** | **52 SH** |

Note *how* the hard one resolves: three of the four have usable wording, and
`Computing and social issues` is identified because it is the only thing left
standing. Elimination is the mechanism; wording only narrows the field it works
over.

### Known defects in the current data shape

| defect | scale | severity |
|---|---|---|
| `choice` flattens `and`/`or` grouping | **36 cells** | **confidently wrong** |
| grids that nest under heading rows | **14 plans** / 13 programs, 60 nested course rows | **confidently wrong** |
| heading rows become reservations | **109 cells** (1.1%) | phantom slots |
| `COOP`/`VACATION` race, both anchored | ~7 cells | option silently dropped |
| `Summer 1` and `Summer Full Semester` both map to `sumA` | 1 plan | terms merge |
| slot ids collide on case (`SOCL elective` / `SOCL Elective`) | 11 terms | slot silently lost |

The first is the sharpest: `'PSYC 3200 or PT 5410 and PT 5411'` means
`PSYC 3200 OR (PT 5410 AND PT 5411)`. Stored flat, a student taking PT 5410
alone is told the requirement is satisfied.

### Requirement-side facts the design must accommodate

| | |
|---|---|
| `generalElectiveSH` recorded | **95 of 532** programs — must be derived for the rest |
| sections marked `shared` (deliberately cross-counted) | **314** |
| programs requiring a concentration | **51** |
| XOM nodes nested deeper than a section's immediate child | **0** — a shallow read is sufficient, and should be *asserted* |
| cells naming specific NUpath codes | ~150 |
| cells where `CE` means Computer/Civil Engineering, not NUpath | ~90 |

---

## What is being left behind

Not because the code is bad, but because each was decided under an assumption
we have since disproved.

**The six-kind entry taxonomy** (`course | courses | choice | coop |
placeholder | vacation`). These are one thing described at varying precision,
and every confidently-wrong defect above lives in a seam between two kinds.

**`constraint: exact | inferred | open`.** Measurement showed `inferred` permits
everything, so the field only ever does work for `exact`. It conflates *what is
allowed* with *what is suggested* — two questions with different answers.

**Label-slug slot identity.** Directly caused the 11-term data loss.

**Binding as a runtime query.** Computing it live means a slot's meaning changes
as the student places courses: satisfy Khoury by hand and the `Khoury Elective`
slot re-binds somewhere else. It still means Khoury. (Its *resolution* against
the student's concentration and placements stays live — see §3.)

**`filledBy`, and the two-store duality it served.** Answered-ness is derivable
from `placements` plus the audit, so storing it only created a second copy to
keep consistent — and `reopenOrphanedSlots` existed solely to repair it.

**Materializing the plan into the student's state.** A reference is 10–20×
smaller on the wire, stays current with the scrape, and makes re-application
idempotent by construction.

---

## What survives

Lessons, not code:

- Elimination over wording; evidence may narrow but never decide.
- Ambiguity is cheap — prefer a longer option list to a guess.
- Candidates as a **spec** (`{keys, ranges}`), never an expanded id list. A
  `MATH 3001–4999` requirement is four numbers, not the 41 ids it happens to
  expand to today, and a spec cannot go stale against next month's scrape.
- Consume demand from the graduation audit's own allocator rather than a second
  implementation, so a slot binds to exactly what the audit reports as unmet.
- The catalog's own arithmetic as a verification gate.
- Reservations never enter `placements`, so nothing that totals credit toward
  the degree can see one. That safety property is the reason the previous
  design existed and it survives unchanged — now for free, since reservations
  are derived rather than stored at all.

---

## 1. The entry model

One node type. What varies is how precisely the catalog named the answer.

```jsonc
{
  "options": [["CS2100", "CS2101"]],   // groups; every member of a group required
  "sh": 5,                             // low end of a range, always
  "text": "CS 2100 and CS 2101",       // verbatim, for display and provenance
  "children": [],                      // rows this row labels
  "optional": false
}
```

`options` is a **list of groups**, and that single choice makes the 36-cell bug
structurally impossible:

| catalog cell | `options` |
|---|---|
| `CS 1200` | `[["CS1200"]]` |
| `CS 2100 and CS 2101` | `[["CS2100","CS2101"]]` |
| `CS 4530 or 4535` | `[["CS4530"],["CS4535"]]` |
| `PSYC 3200 or PT 5410 and PT 5411` | `[["PSYC3200"],["PT5410","PT5411"]]` |
| `Khoury Elective` | `[]` — named nothing |

An empty `options` is what used to be called a slot. It is not a different kind
of thing; it is the same node with the answer left unstated.

**Rows that label other rows** carry `children` rather than becoming
reservations. Credit decides before wording: a row carrying hours is always a
reservation however it reads, because Business Administration BSBA prints a
term's hours *on* the heading and leaves the courses beneath blank — discarding
priced headings loses 8 SH from a term, which is the one direction that must
never happen.

**Non-course entries** (`coop`, `vacation`) become an explicit either, so
`Co-op or vacation` and `Vacation or optional co-op #2` stop being decided by
whichever anchored regex runs first:

```jsonc
{ "either": ["coop", "vacation"], "text": "Co-op or vacation" }
```

**Open question (E1):** does `optional` need a distinct representation from an
`either` containing "nothing"? `Elective (optional)` and `Optional 4-month
co-op` both exist. Leaning yes — optionality is about whether the student *must*
decide, which is different from what they may decide.

---

## 2. What is stored

Three facts. Everything else is derived.

```jsonc
placements:  { "CS2500": "fall2026", … }        // unchanged, authoritative
appliedPlans: [{ programKey, planLabel, startYearIndex }]
planEdits:   { "<entryId>": { semId?, deleted? } }   // divergences only
```

The entry tree is **re-derived from the shipped `plan.json`** on load. It is not
copied into the student's state.

### Why a reference and not a copy

A materialized plan is a median **3.4 KB** of JSON (max 6.3 KB); a reference
plus divergences is 150–400 bytes. Slots already serialize whole into share
links, so this is a 10–20× difference on the wire. The reference also stays
current with the monthly scrape for free, and — the part that matters more —
**"apply a plan" becomes idempotent by construction**, because applying twice
sets the same reference. The previous design needed slot-id de-duplication to
achieve that, and got it wrong (11 terms silently lost a reservation to a
case-folding collision).

### The rule that decides what may be keyed by what

Positional entry ids (`p0.Year 2.Fall.3`) are the only handle a derived tree
offers, and they are **not stable**. Measured against archived editions:

| edition → 2026 | positions compared | stability |
|---|---|---|
| 2025 | 114 | 95.6% |
| 2024 | 38 | 86.8% |
| 2021–23 | 38 | 39.5% |

The sample is small — few archived programs carry a `planGrid` and slugs were
renamed — so the magnitude is not trustworthy. That is precisely the point:

> **If id stability cannot be proven, nothing that matters may be keyed by an
> id. Anchor consequential state on course ids, which do not drift; anchor only
> cosmetic state on positions.**

~96%/year compounds to ~83% across a four-year plan — about one answer in six
re-pointing to the wrong entry. Under this rule that is survivable, because the
only things keyed positionally are **moves and deletions**. A drifted id makes a
reservation reappear where the student dismissed it, or sit in its published
term rather than the one they dragged it to. Their courses are untouched.

### Answered-ness is derived, never stored

This is what removes the duality entirely. There is no `filledBy`, no
`reopenOrphanedSlots`, no second store to keep consistent.

- An entry with `options` is answered iff one of its option **groups** is fully
  placed — computable from `placements` alone.
- An entry with `options: []` is answered iff the requirement it binds to has
  been satisfied beyond what other entries bound to it already claim — which is
  exactly what the graduation audit computes.

Delete a course and its reservation returns, with no bookkeeping. No stored
mapping means no id-stability exposure on the one thing that would have been
corrupting. The audit consumes `placements`; entries are not placements; there
is no cycle.

**Which reservation retires must be deterministic.** Two `Khoury Elective`
entries and one newly-placed Khoury course is ambiguous, and resolving it
differently between renders would make the plan visibly churn. Rule: retire the
**earliest unanswered entry bound to that requirement, in plan order** — a total
order that exists in the shipped data, so every client agrees without storing
anything.

**Accepted consequence:** placing a course for one reason can retire a
reservation created for another — put any Khoury-eligible course anywhere and
the `Khoury Elective` reservation goes. That is correct (the requirement *is*
satisfied), but with ~51% of a plan's credit being reservations it will be
visible, and the UI has to make it legible rather than surprising.

---

## 3. Binding is computed in the scraper and shipped beside the requirements

A binding says which requirement a cell stands for. It is computed at scrape
time, written into `plan.json`, and reviewed as a git diff.

What this buys: the 36 and/or cells and 14 nested plans surface under review
rather than in an audit months later; binding quality joins
`planTermsAgree`/`planTermsDisagree` as a gate that can refuse a write; and a
slot's meaning can no longer drift as a student places courses, because it is
no longer a query.

### The pointer cannot dangle, so it can be an index

Earlier drafts avoided requirement pointers because `title#ordinal` is fragile
across re-scrapes and collides on dual majors. **That concern dissolves once
binding is generated at scrape time**: `plan.json` and `parsed.initial.json` are
produced in the same run and shipped together, so a binding always references
the requirement list it was computed against. It cannot outlive it.

So the binding is a **section index**, and `admits` is derived at runtime from
`requirementSections[i]` — already loaded, because the audit needs it. No spec
duplication in the shipped data, no staleness, no identity scheme.

### Student-level inputs are named, not baked

Binding is *not* purely program-level, and the earlier draft was wrong to say
so. Concentrations are a student choice and **51 programs require one**; plan
variant, substitutions, dual majors and placed-out credit are all student-level.

The split: a binding names its target (`section 7`, or the sentinel
`~concentration` / `~general`), and *resolution* happens at runtime against the
student's actual selections. Nothing student-specific is ever baked.

**Sequencing constraint, easy to get backwards:** binding is computed against
the plan's own named courses as though placed. Against an empty plan every
requirement looks outstanding and every binding is noise.

---

## 4. Assignment is solved exactly

Assign unanswered entries to outstanding requirements without exceeding any
requirement's capacity — a capacitated assignment, answered exactly by min-cost
max-flow:

- an edge is **forced** if every maximum flow contains it,
- **impossible** if none does,
- **possible** otherwise.

This replaces a hand-tuned relaxation ladder with a `pass < 8` bound and a
hand-written strength table — constants chosen by an author rather than derived,
which is what approximating an exactly-solvable problem looks like.

**Honest scope:** this buys *rigor*, not *coverage*. The ~35% ambiguity in the
previous attempt came from genuinely ambiguous data and from requirements
missing from our source; an exact solver creates no information that is not
there. It is worth doing because build-time execution makes its cost irrelevant
and because "forced" then means something provable.

**Two kinds of evidence, and they must not be mixed** — conflating them is the
entire reason relaxation had to exist:

| evidence | role | example |
|---|---|---|
| checkable against course sets | edge **existence** (hard) | `MATH elective` — Khoury admits no MATH course, so that edge does not exist |
| wording only | edge **cost** (soft) | `Khoury Elective` ~ `Khoury Approved Electives` |

As cost rather than filter, a maximum flow always exists and well-worded
assignments are merely preferred. Relaxation stops being a concept.

Title similarity should use **corpus IDF over section titles**, not a
hand-written stopword list — that list was an author's approximation of IDF, and
a derived one self-maintains through monthly scrapes. Not edit-distance: our
failure mode is paraphrase, and no threshold separates `Computing and social
issues` / `Supporting Course` from a true match.

---

## 5. What may fill an entry

| tier | question | source |
|---|---|---|
| **admits** | what does the bound requirement accept? | derived from `requirementSections[i]` |
| **allowed** | may the student put this here? | *always yes* — a planner warns, never blocks |
| **recommended** | what to show first | `admits` minus already-placed, filtered by term offering and prereq reachability |

Only `recommended` needs computing per student, and it depends on live state, so
none of this is storable anyway.

**Attributes are a separate axis.** `General elective (NUpath DD)` is a free
elective *plus* an attribute constraint; it never enters `admits`. Codes are
read only where the cell says they are attributes — it names NUpath, or a
parenthetical consists entirely of codes — because `CE` means Computer/Civil
Engineering in ~90 cells and a naive two-letter match is wrong on four in five
of them. `COMM WI course` is deliberately missed: a bare code cannot be told
from an abbreviation, and a false attribute narrows a picker to nothing.

---

## 6. Verification

The plan side gets the same treatment as the requirements side.

| gate | catches |
|---|---|
| per-term sum vs the catalog's printed total | any row-parsing regression (baseline **99.93%**) |
| grid course set ⊆ flattened plan-of-study witness | the two readings of one pane diverging |
| binding over-subscription | requirements claimed beyond capacity |
| entries with `options: []` **and** no binding | requirements missing from our data — see below |
| XOM depth == 0 assertion | the shallow shortfall read silently becoming wrong |

**Unbindable entries are discoveries, not failures.** The three `Foreign
Language` cells in Media & Screen Studies + Philosophy bind to nothing because
that requirement is CSSH-wide and absent from the program page. The plan is
telling us our requirement data is incomplete. CLAUDE.md already frames the plan
as a witness that can prove we dropped requirements; we have only ever used it
in one direction. This set is a work queue for the requirements scraper.

---

## 7. Decisions required

| # | question | leaning |
|---|---|---|
| **S1** | ~~§2 — reference + derived answered-ness~~ | **SUPERSEDED by §9.1** — reservations are stored, and answered-ness is explicit |
| **E1** | is `optional` distinct from an `either`? | yes |
| **B1** | wording as edge cost rather than edge filter? | yes |
| **V1** | should binding over-subscription *block* a scrape write, or only report? | report first, block once a baseline exists |
| **C1** | model college-wide requirements (CSSH foreign language), or leave them honestly unbound? | unbound now; §6 turns them into a queue |
| **D1** | ~~how legible must a reservation retiring itself be (§2)?~~ | **MOOT under §9.1** — a reservation no longer retires itself; it is filled explicitly |
| **D3** | plan applied, then the student changes major — do reservations vanish or warn? | warn, then vanish on confirm |
| **D2** | widen the id-stability sample — few archived programs carry a planGrid | not blocking; the rule makes the number non-load-bearing |

---

## 8. Sequencing

Each step is independently shippable and independently verifiable.

1. **Entry model in `plan-grid.js`** — emit §1 nodes. The 99.93% checksum must
   hold across the change; it is the regression test.
2. **Verification gates** (§6) — before binding, so binding's quality is
   measurable from its first run.
3. **Build-time binding** (§3, §4) into `plan.json`, reviewed as a diff.
4. **Runtime: apply a plan** (§2 option A) — reservations, ordering, fill.
5. **Runtime: what's still outstanding** — the live, per-student half.
6. **UI.**

Steps 1–3 are data-only and cannot affect the running app. The feature becomes
visible at step 4.

---

## 9. What shipped, and what it measures

Steps 1–4 of §8 are implemented. The numbers below are measured against the
shipped corpus as of 2026-08-08 and are the constraints §§10–13 have to satisfy.

### 9.1 One deliberate divergence from §2

§2 settled on *reference + derived answered-ness*: no stored reservations, a
card retiring itself as soon as the audit says its requirement is met. What
shipped instead is a **stored `reservations` map** (`src/core/reservations.js`)
with explicit fill.

The reason is a requirement that arrived after §2 was written: a reservation
must **look and act exactly like a normal course card in the planner**. That
forces three things a derived card cannot give:

- **Its own position.** A card dragged to an arbitrary term needs its term and
  its index stored. A derived card needs a divergence record for the same
  information, so the storage is not actually saved — only renamed.
- **Its own identity across a gesture.** Drag, drop, reorder and undo all key on
  a stable id. §2's positional ids are 39–96% stable across editions, which §2
  itself rules out for anything consequential.
- **Not vanishing when the student touches something else.** §2 accepts that
  placing any Khoury-eligible course anywhere retires a `Khoury Elective` card.
  That is *correct about the degree* and *wrong about the card*: normal courses
  do not disappear because you placed a different course. The isolation boundary
  is what keeps the degree answer honest; the card does not have to.

What survives from §2 unchanged, and is load-bearing: **reservations never enter
`placements`**, so nothing totalling credit toward the degree can see one.

De-duplication on re-apply is handled by `origin` (§2 predicted a reference
would make this free; a stored map has to pay for it). `originKey` is built from
*position* — plan, year, term type, ordinal — never from the label, which is
what caused the 11-term case-folding loss in the previous attempt.

### 9.2 The binding census

9,599 cells name no course. Where they bind:

| | cells | share |
|---|---|---|
| forced → a real requirement section | **1,333** | 13.9% |
| forced → `~general` | 4,261 | 44.4% |
| forced → `~concentration` | 10 | 0.1% |
| ambiguous (2–13 candidates) | **3,882** | 40.4% |
| unbound | 113 | 1.2% |

The headline number is **13.9%**, not 58.4%. "Forced to `~general`" is a real
result — it means *anything counts* — but it names no requirement and needs no
picker beyond ordinary course search.

Two facts that decide §10:

| | |
|---|---|
| candidate courses for a forced-to-section cell | median **11**, max 564 |
| such cells with ≤12 candidates | **797 of 1,333** |

A median of 11 is a picker you can simply *render*. No search, no ranking, no
progressive disclosure — a list.

### 9.3 A second population, currently bound zero times

The census above counts only cells with `options: []`. There is a second kind of
undecided cell — one that **names its options** — and it behaves in the exact
opposite way:

| cell kind | count | certainty about the requirement |
|---|---|---|
| unnamed (`options: []`) | 9,599 | 13.9% name a requirement; candidate ∩ empty **86.7%** |
| **named options** (`CS 4300 or 4100`) | **1,386** | **86.9% have a PROVABLE requirement** |

Near-perfect mirror images, and generalising from the first to the second is
wrong.

For a named-options cell, certainty is not inferred from the flow solve at all:

> section *i* is **certain** for a cell iff every one of its option groups
> **counts toward** section *i*.

**"Counts toward", not "satisfies"** — this wording was wrong in the first draft
and the error is the kind that propagates. `courseEligible` says a course is
named by, or in range for, a section. A section needing three courses is not
answered by one. What is provable is *where the credit lands*, which is all the
pending mark in §12 claims.

`CS 4300 or 4100` against a `One of (0/2)` section containing exactly those two
courses is certain by inspection — whichever the student picks, the credit lands
there. Measured across the corpus, **1,205 of 1,386** such cells have at least
one certain section; the median certain-set size is **1** and the max is **2**,
so it is not a vague narrowing but a single named requirement.

**Certainty must be intersected with outstanding demand before it is shown.**
A section already answered by the plan's own named courses still *admits* the
option, so it still tests certain — and marking it pending would be wrong.
Measured: **15 of 1,205 (1.2%)** have no certain section carrying any shortfall.
Small, but it is a correctness bug rather than a coverage gap, so the mark is
gated on `obligationsOf` rather than on eligibility alone.

**This is a stronger claim than "forced."** Forced means *every maximum flow
contains this edge* — it depends on the demand arithmetic, the general-elective
derivation, and the shortfall model all being right. Certain means *every
outcome lands in this set* — pure membership, no flow, no demand model. It
cannot be wrong unless the eligibility spec is.

**And `bind-plans` computes it for none of them.** `isUnnamed` excludes any cell
with options, so all 1,386 ship with `binding` absent, become reservations
carrying `r.options` and no `requirement`, and therefore contribute nothing to
the requirements panel. This is a pipeline gap, not a UI one.

Cost is negligible and does *not* need the poset rejected in §13: it is
`|groups| × |sections|` membership tests per cell, using specs the audit already
builds.

---

## 10. Answering a reservation

Two halves: the gesture that answers one, and what it offers.

### 10.1 The gesture

**Currently broken, not merely missing.** Dragging a course from the bank, the
requirements panel or the info panel onto a reservation does *nothing* —
`dropOnCard` calls `exists(state, dragId)`, which is false for a course that has
no placement, and returns `null`. Verified directly against
`src/core/planDrop.js`. That is the failure mode the file's own comment already
rejects: *"a silently ignored drag reads as the app being broken rather than a
rule being applied."*

> **The rule: a card dropped on a reservation SWAPS with it if it already has a
> seat, and ANSWERS it if it does not.**

This completes the swap decision rather than contradicting it. A swap needs both
ends to have somewhere to go. A bank course has no seat to give back, and a
reservation has no home in the bank — dropping one there deletes it
(`dropOnBank`). The symmetric gesture is undefined at that end, so fill is the
only total reading.

**The discriminator is `!placements[dragId]` — a fact about state — not which
panel raised the drag.** `fromSem` is `null` from `BankPanel`, `GradPanel` and
`InfoPanel`, so panel-of-origin *looks* usable. It is not: `GradPanel` renders
`draggable={!!course}` on every course node including ones already placed and
already checked off, so a drag from there can carry a card that does have a
seat. The placement check is also the predicate that currently returns `null`,
so it costs nothing to reuse.

**It belongs inside `dropOnCard`.** A parallel copy of a drop rule in
`PlannerContext` is exactly what made the forward drag a no-op, and the invariant
suite reads source to guard against a second copy appearing.

Three sub-decisions (see §14):

- **Position** — the course takes the reservation's index in the term. That is
  the point of the gesture; landing at the end would make it a different one.
- **Credit mismatch** — a 4 SH reservation answered by a 3 SH course changes the
  term load. That should be *visible*, never blocking: a planner warns.
- **Coreq partners** — the dragged course's partners need seats too. The
  existing `moving` logic carries them; which term they land in is a choice.

### 10.2 What the picker offers

**The load-bearing insight: filling is not a commitment to a requirement.** The
reservation is deleted and a real course is placed; `allocateSections` then
assigns that course optimally across the whole degree. The binding never had to
be right — a "wrong" suggestion simply allocates elsewhere.

So the only outcome that can hurt a student is picking a course that counts
toward **nothing outstanding**, and that is a test against the *union* of open
requirements, not an intersection.

**Conservatism therefore belongs in the label, not the filter.** Four tiers,
every one of them a true statement:

| tier | claim | membership |
|---|---|---|
| 1 | counts *here* | in ∩ of the candidate requirements' specs |
| 2 | counts toward *this card* | in ∪ of them |
| 3 | counts *elsewhere* in your degree | eligible for some other outstanding requirement |
| 4 | counts as a general elective only | neither |

**How often tier 1 fires depends entirely on which population the cell is in**,
and this is the correction §9.3 forces:

| cell kind | tier 1 |
|---|---|
| named options (`CS 4300 or 4100`) | the **normal** case — 86.9%, and the option list *is* the picker |
| unnamed (`Khoury Elective`) | **rare** — the candidate intersection is empty 86.7% of the time |

For a named-options cell the picker is finished before it starts: two or three
courses, given by the catalog, with a provable requirement behind them. No
ranking, no search, no tiers. The four-tier structure exists for the unnamed
population, which is where the uncertainty actually lives.

The list stays fully searchable regardless, because 44.4% of cells are
`~general` where every course in the catalog is a valid answer.

**Rank by term reachability, not by wording.** A reservation sits *in a
semester* — information ordinary course search does not have. Evaluating each
candidate's prereqs against the term the card occupies turns *"Khoury Elective —
100 candidates"* into *"the 22 you could actually take by Fall 2028."*
`prereqEval.js` already computes this for placed courses. §13 explains why this
is the right use of prereq data and the intersection is not.

---

## 11. Runtime narrowing must be monotone

§3 rejected *binding as a runtime query*, and the argument is sound: satisfy
Khoury by hand and a live re-solve re-points the `Khoury Elective` card at
general electives. It still means Khoury.

But that argument covers **re-pointing**, and there is a second operation it does
not cover:

| operation | example | verdict |
|---|---|---|
| **narrowing** | a cell ambiguous among {A,B,C}; the student's placements make B and C impossible → forced to A | information-gaining; the card's meaning never changed, we only learned which of its existing readings it was |
| **re-pointing** | a cell forced to A; A gets satisfied by hand → rebinds to `~general` | the §3 failure mode |

> **Rule: a runtime solve may only intersect with the build-time candidate set.
> It may never introduce a target the scrape-time solve did not already allow.**

Under that rule the build-time binding stays authoritative about *meaning* and
the runtime solve only removes possibilities — so §3 holds and the 3,882
ambiguous cells still sharpen as the student works, which is exactly when a
picker needs to be sharp.

If every build-time candidate becomes impossible, the card does **not** rebind.
It reads *"your plan already covers this"* — which is §2's retire-the-earliest
behaviour surfaced as information instead of as a disappearance.

Cost is not a factor: `bindCells` is pure, and the graphs are ~40 nodes for
~375 max-flow solves — single-digit milliseconds, one memo.

**Consequence to handle:** a reservation's stored `requirement` field and a live
solve can disagree. The stored field is **provenance** (what the published plan
claimed) and keeps serving `origin` and de-duplication; the live solve owns the
picker. `resolveRequirement` already degrades to "keep the label, stop
suggesting" rather than to a wrong answer.

---

## 12. Reserved demand in the requirements panel

Worth showing, under one hard rule: **it must never read as met.**

The isolation boundary is about the *answer* — "have you satisfied this?" must
stay no, and `placements` is what guarantees it. "Have you *planned* for this?"
is a different question with an honest answer, and the panel already gives a
student the vocabulary to tell the two apart.

But it is only honest where the requirement is **not a guess**. A marker on an
ambiguous section would be wrong 40.4% of the time.

Two populations qualify, and they qualify at different strengths:

| where | cells | shown |
|---|---|---|
| named-options cells with a certain section (§9.3) | **1,205** | a pending marker — **provable**, by set membership |
| unnamed cells forced to a section | **1,333** | a pending marker — forced by the flow solve |
| unnamed cells, ambiguous | 3,882 | a footer tally: *"6 reserved cells not tied to a specific requirement"* |
| unnamed cells → `~general` | 4,261 | counted against the general-elective allowance |

**2,538 cells can honestly mark a requirement, not 1,333** — nearly twice what
§12 claimed before §9.3 was measured, and the larger half of the gain is the
half that needs no arithmetic to justify it.

### 12.0 Pending marks must be capacity-clamped — they are not today

The two populations above mark sections **independently**, and neither is aware
of the other or of the section's room. Measured over the corpus:

| sections receiving ≥1 pending mark | 1,646 |
|---|---|
| **over-subscribed** (more pending than room) | **44 (2.7%)** |
| worst case | Pharmacy PharmD, *Professional Electives*: **12 pending vs room 1** |

Rendering twelve pending marks against a requirement needing one course is
exactly the false confidence rule 4 forbids. Two cells can both *count toward* a
section without both being *for* it.

This makes decision **N2 mandatory rather than a refinement.** Named-option
cells must enter the same flow as the unnamed ones, consuming the same capacity,
so the two populations are reconciled by the solver instead of racing:

> **A section's pending count is a flow result, never a sum of independent
> claims.** Whatever cannot be seated within a section's room is not pending for
> it, and belongs in the unassigned tally.

That also disposes of the double-count without a clamp — a clamp would hide the
surplus, whereas the flow *reassigns* it to whichever requirement can still take
it.

Whether the two strengths should render identically is open (**M3**). They are
different claims: one survives any error in our demand model, the other does
not. Leaning identical anyway — a student cannot act on the distinction, and two
shades of pending is a worse panel.

### 12.1 A pending mark must not propagate downward

Satisfaction in the panel today propagates: `dimmed={r.sat && !c.sat}`
(`GradPanel.jsx` 372, 375, 399) fades the alternatives a student did *not* take
once a parent is satisfied, and 788 does the same for pool members once the
count is met. That is right for real satisfaction — the decision is made, the
roads not taken should recede.

It is wrong for pending, and the reason is that "satisfied" currently bundles
two claims that a reservation splits apart:

| claim | real satisfaction | a reservation |
|---|---|---|
| the section's demand is spoken for | yes | **yes** |
| *which child* answers it is decided | yes | **no** |

A `CS 4300 or 4100` card provably answers its `One of (0/2)` section (§9.3) —
and the entire remaining content of that card is that the student still has to
choose. Dimming CS 4100 because CS 4300 might be picked would use a proof about
the *section* to make a claim about a *child* that no evidence supports.

> **Rule: a pending mark applies to the section and stops there. Child boxes
> stay empty, at full strength, and the satisfied-count numerator is never
> touched.**

So `One of (0/2)` stays `0/2` with a pending mark beside it — never `1/2`, never
`0/2` with one child faded. The numerator belongs to the audit, which reads
`placements` and cannot see a reservation at all; that is the isolation boundary
doing its job rather than a rule anyone has to remember.

This is also why the marker should be visually its own thing rather than a
lighter checkmark. A grey check says *the same thing, less certainly*. What we
mean is *a different thing*: something is coming, and nothing here is decided.

A sharper version is available if forced-only proves too coarse. The flow
already yields a per-requirement **range**: min is the flow lost when that
requirement is deleted from the graph, max is what it can absorb. *"2–5
reserved"* is exact rather than conservative, and the catalog prints ranges
itself (`3-4` SH), so students already read them. Held in reserve — start
coarse.

---

## 13. Rejected, with the measurement that rejected them

Both of these are reasonable ideas. Both were measured before being dropped.

### Shared prereq chains, as a STATIC edge — 3.1%

**Scope, corrected.** What follows rejects drawing a prereq edge from a
*corpus-level* intersection. It does not reject using prereqs on these cards at
all — §15 measures two live uses that are worth an order of magnitude more, and
the first draft of this section wrongly read as a rejection of both.

The proposal: if the courses that could answer a cell all require the same
course, draw that prereq even before the student chooses.

A prereq is *certain* only if every candidate provably needs it — set every
other course available; if the expression still fails, that atom is mandatory.
Measured across the corpus:

| | cells | with a certain prereq |
|---|---|---|
| either-cells (`CS 4300 or 4100`) | 1,386 | **45** (3.2%) |
| forced-to-section reservations | 1,333 | **41** (3.1%) |

And that is the *generous* measurement — only reservations with ≤40 candidates
were tested, where a shared floor is most likely. Elective pools exist precisely
to offer alternatives at different levels, so they almost never share one.

**Kept from the idea:** the same data, applied *per candidate against the card's
term* instead of intersected across candidates — 3% applicability becomes 100%.
That is §10.2's ranking.

### The requirement containment lattice — 10.1% **for unnamed cells only**

The proposal: exploit the fact that a narrow requirement's courses are often all
inside a broader one (every CS elective also counts toward Khoury electives), so
an ambiguous cell can offer the narrowest set and be safe under every reading.

**Scope this rejection carefully.** It applies to cells with `options: []`,
where the candidate requirements come from the flow solve. The same
intersect-and-see-what-survives idea applied to cells that *name* their options
succeeds 86.9% of the time (§9.3) — the operation is similar, the population is
not, and the first draft of this section wrongly generalised from one to the
other.

For unnamed cells the structure is real but rare:

| ambiguous cells | 3,882 |
|---|---|
| intersection of candidate specs **empty** | **3,366 (86.7%)** |
| intersection median / union median | **0** / 34 |
| candidates **nested** (smallest ⊆ all others) | **393 (10.1%)** |

**Cost was never the objection.** `EligibleSpec` is a compressed set closed
under the operations needed — union is concatenation, intersection is
`keys∩keys` plus keys-tested-against-ranges plus interval overlap per subject,
and membership is already O(1). Nothing enumerates the catalog at runtime. The
lattice itself is program-static, so the one awkward operation (subset with
range exceptions) can be expanded exactly, offline, in `bind-plans` — the whole
corpus expands in under a minute.

It is dropped because a 10% payoff does not justify shipping a poset per
program, and because §10.2 shows the intersection is the wrong gate anyway.

---

## 14. Wording evidence is ordered, not binary

§4 splits evidence in two — *checkable facts* delete edges, *wording* is applied
only when free. Measurement says that split is right in spirit and too coarse in
practice, in three separate ways. Exact title matching is the case that exposes
all three.

### 14.1 The population is smaller than it feels, and one character triples it

| | cells | of 9,599 |
|---|---|---|
| text **exactly** matches a section title (normalised) | **287** | 3.0% |
| matches only if plurals are folded (`Elective` / `Electives`) | **562** | 5.9% |
| | **849** | **8.8%** |

Exact matching alone is a 3% feature. **The near-miss population is twice the
exact one and is lost to a trailing `s`** — `tokens()` already lowercases and
strips punctuation but does not stem, so `Science Elective` and `Science
Electives` are different strings. Folding plurals is the cheapest single
improvement available anywhere in the binding pipeline.

Of the 287 exact matches: 153 are already forced correctly, 106 are ambiguous
but include the right section, 1 is genuinely ambiguous (two sections share a
title), 7 are unbound — and **20 are bound to something else entirely**.

### 14.2 Good evidence dies with bad, because the switch is global

`bindCells` decides whether to honour wording **once per program**:

```js
const useSoft = hasSoft.some(Boolean) && maxFlow(N, build(softOrHard), SRC, SNK) === flowHard;
```

One cell whose preference breaks feasibility discards every other cell's
preference in that plan, including an exact title match.

| plan variants with any wording evidence | 501 |
|---|---|
| wording changed the outcome | 382 |
| **wording discarded wholesale** | **119 (23.8%)** |

> **Rule: apply soft evidence incrementally, strongest first, keeping each
> restriction that preserves the maximum flow — never as one global switch.**

That is a maximal-feasible-subset pass rather than an all-or-nothing one. It is
still monotone (it can only narrow a cell's candidates, never re-point them, so
§11 is unaffected), and it makes "wording may narrow, only arithmetic decides"
true per cell rather than per program — which is what §4 meant.

**A greedy pass is order-dependent, so the order must be pinned.** Two cells
with equally strong hints competing for one seat: whichever is tried first
wins. Left to object-iteration order, the same input can produce different
`plan.json` on two runs — and these files are written to main by an unattended
workflow and reviewed as a git diff, so churn is not cosmetic. Ties break by
**plan order**, which is a total order present in the shipped data.

### 14.3 The hard tier contains a guess wearing a fact's clothing

The 20 wrongly-bound exact matches are not the arithmetic overruling wording.
They are a **false fact**, and this is the most serious finding here, because
the hard tier deletes edges unconditionally and nothing downstream can appeal.

Media Arts BFA, cell `Art and design fundamentals elective`:

```
subjectOf("Art and design fundamentals elective") = ART   ← "ART" is a real
                                                            subject: "Art - CPS"
section courses: ARTF1240, ARTF1241                       ← ARTF, not ART
specAdmitsSubject(spec, "ART") = false
admits(cell, section)          = false                    ← edge deleted
```

The guard `known.has(up)` exists precisely to stop this and cannot: Northeastern
publishes a subject literally called `ART`, alongside ARTD/ARTE/ARTF/ARTG/ARTH/
ARTS. The leading word of an English phrase collided with it, and five cells in
one program were forced to `~general` against a section they name exactly.

The diagnosis generalises past this one collision:

> `admits` composes **a guess** ("the label's leading token is a subject code")
> with **a fact** ("this section admits no course in that subject"). A
> conjunction is only as hard as its weakest term, so the result is a guess —
> and it was being applied with the authority of a fact.

`specAdmitsSubject` is genuinely checkable. `subjectOf` is not. Only the stated
range (`MATH 3001–4999`) and the free-elective test are facts about the cell,
because there the catalog printed the constraint rather than us inferring it.

So the tiers should be:

| strength | evidence | effect |
|---|---|---|
| fact | cell states a range; cell is a bare "elective" | deletes edges |
| strong | exact title match (plural-insensitive) | restriction, applied first |
| weak | leading token is a known subject code | restriction, applied after |
| weakest | token overlap | restriction, applied last |

**Exact match must stay a restriction, never a hard edge.** Three
`Science Elective` cells against a section needing one course means two of them
are for something else — wording gives intent, never capacity. Capacity is
already modelled (`room = max(1, round(shortfallSH / unitSH))`), and a section
needing exactly one thing is `room = 1`. With the edge intact and the
restriction applied, the flow forces it on its own; no new rule is needed for
the case that prompted this section.

**Ordering also repairs ART/ARTF without special-casing it.** A cell that names
a section exactly is not a subject-prefixed elective, so strong evidence
suppresses weak evidence on the same cell — which is a general rule rather than
a patch for one subject code.

---

## 15. Prereq chains for reservations that name their courses

§13 rejected a static shared-prereq edge at 3.1%. That number answered *"can we
draw an edge from the corpus alone?"* — and it is the wrong question twice over.
Both better questions are about the **student's plan**, which is where the
information actually is, and both are cheap on named-option cells because the
option list is two or three courses.

| | of 1,386 named-option cells |
|---|---|
| **parents** — every option carries prereqs, so an OR-check is a real constraint | **507 (36.6%)** |
| some options carry prereqs (OR trivially satisfiable) | 292 (21.1%) |
| no option carries prereqs (nothing to check) | 587 (42.4%) |
| **children** — some course exists that tells the options apart | **743 (53.6%)** |
| distinguishing courses per such cell | median **2**, max 185 |

### 15.1 Parents — the card is prereq-checkable, exactly like a course

For 36.6% of these cells, *every* option has prereqs, so the disjunction

```
prereqs(option₁) ∨ prereqs(option₂) ∨ …
```

is a genuine constraint that can be evaluated against what the student placed
earlier. When it is false, the card is in a term where **nothing it could
become is takeable yet** — a true, actionable statement, and one that needs no
choice to have been made.

That is 12× the 3.1% figure because it is a different predicate. §13 asked
whether one course is required under *every* branch; this asks whether *any*
branch is open. `prereqEval.js` already computes the second for placed courses.

The remaining 42.4% have no prereqs on any option and are correctly silent.

### 15.2 Children — a later course can force the choice

This is the mechanism neither of us had costed, and it is the larger half.

If the student places a course whose prereqs are satisfied by option A and not
by option B, then picking B breaks their own plan. So B can be eliminated — and
not as a preference. **Elimination through the prereq graph is a third narrowing
mechanism, independent of the arithmetic in §4 and the wording in §14.**

`ECON 1115 or 1116` has **15** downstream courses that tell its options apart.
`GSND 7990 or 7995` has one, `GSND 7996`, and that one is enough.

**The rule has to check the rest of the plan, not just the dependent.** A
dependent's prereqs might already be met by some other placed course, in which
case the reservation is not load-bearing and nothing may be eliminated:

> Eliminate option B only if some placed course's prereqs are unsatisfiable
> **without** the reservation, and option B does not satisfy them.

That is the same feasibility test §4 runs for flow edges, applied to a different
graph, and it keeps the mechanism conservative by construction.

**Honest scope: 53.6% is a ceiling, and there is also a floor.** The two bound
different assumptions about the rest of the plan, and quoting only the first was
the flaw in this section's first draft:

| | assumes | rate |
|---|---|---|
| **ceiling** — some course is satisfied by one option and not another | the emptiest plan: nothing else helps | **743 (53.6%)** |
| **floor** — some course *cannot* be satisfied without that option | the fullest plan: everything else is already there | **494 (35.6%)** |

The gap is the 1.5× of cases where the dependent has an OR escape.
`ENCP 2000` accepts any of twelve first-year seminars, so placing it forces
nothing about `ARTF 1000 or ARCH 1000` unless the reservation is the student's
only source. `GSND 7996` names `GSND 7990` with no alternative, so placing it
forces that option no matter what else is in the plan.

**The floor is the number that matters**, because those 494 fire on placement
alone with no further condition to check. Neither is a yield — both still
require the student to place the dependent, which cannot be measured without
real plans.

Worth building either way: the graph and the placements are both already loaded,
so the marginal cost is a lookup, and when it fires it is a *proof* rather than
a preference.

### 15.4 Lines and warnings are different mechanisms, and already are

The awkward case: `CS 4300 or 4100` share `CS3100 or CS3500`, but CS 4300 also
accepts `EECE 2560` and CS 4100 does not. Placing EECE 2560 opens one option and
not the other. Collapsing that into a single boolean is what makes it awkward —
and the planner already refuses to collapse it for ordinary courses.

**What the planner does today.** `extractEdges` discards the boolean structure
completely: every course named anywhere in a prereq expression becomes an edge,
And/Or ignored. A line is then drawn only when **both endpoints are placed**
(`PlannerContext.jsx:869`). So a line already means *"you took this, and it
feeds that"* — never *"this is required"*. Satisfaction is computed separately,
by `evalPrereqTree`, and shown as a badge.

Two mechanisms, already decoupled. Reservations need no third one:

| | rule for a course | rule for a reservation |
|---|---|---|
| **line** | every mentioned course, drawn when both ends are placed | **union over options** — draw if the course feeds *any* option |
| **badge** | `evalPrereqTree` on the expression | **OR over options** — a violation only when *every* option is blocked |

The union is not noisy, because "both endpoints placed" is already the filter:
you only ever see arrows from courses you actually took.

**Worked through, with `CS 4300 or 4100` in some term:**

| placed before it | CS 4300 | CS 4100 | line drawn | badge |
|---|---|---|---|---|
| CS 3100 | open | open | `CS3100 → card` | none |
| nothing | blocked | blocked | none | **"nothing here is takeable yet"** |
| EECE 2560 + CS 2810 | open | blocked | `EECE2560 → card`, `CS2810 → card` | none — the card is still answerable |
| CS 2510 only | blocked | blocked | `CS2510 → card` | violation |

Row 3 is the case that felt awkward, and it resolves without a special rule: the
line is honest (EECE 2560 really does feed this card), and the badge stays quiet
because the card *can* still be answered. Row 4 shows lines and badges
disagreeing on purpose — exactly as they already do for a plain course whose
second clause is unmet.

**The awkwardness only exists if the options are collapsed, so do not collapse
them.** The picker shows per-option status:

```
CS 4300   open        EECE 2560 ✓   CS 2810 ✓
CS 4100   blocked     needs CS 3100, CS 3500 or DS 3500
```

That is strictly more useful than any single verdict, and it is the same surface
§15.2's elimination renders into — a blocked option and an eliminated option
differ only in the reason printed beside them.

**A blocked option is never removed.** Removal is a claim about the future, and
the student may still reorder their plan. Grey it, print the reason, leave it
choosable.

### 15.3 Why this ordering matters

§13 stands and §15 is not a reversal of it. The distinction worth keeping:

| | asks | answer lives in |
|---|---|---|
| §13 static edge | is one course required under every branch? | the catalog — **3.1%** |
| §15.1 parents | is any branch open from here? | catalog **×** the plan — **36.6%** |
| §15.2 children | does the plan already exclude a branch? | catalog **×** the plan — **53.6%** |

The pattern generalises past prereqs: **a question answered against the corpus
alone will almost always look barren, and the same question answered against the
student's plan is where the information is.** The intersection idea in §13 and
the containment lattice both failed for exactly this reason, and both times the
live formulation was the one worth having.

---

## 16. Decisions required (runtime half)

§7 covers the build-time half. These are new.

| # | question | leaning |
|---|---|---|
| **G1** | fill-on-drop discriminated by `!placements[dragId]` rather than drag origin | yes — `GradPanel` drags placed courses with `fromSem: null` |
| **G2** | does the filling course take the reservation's index, or the end of the term? | its index |
| **G3** | credit mismatch on fill — warn, or silently re-total? | warn; a planner never blocks |
| **G4** | where do coreq partners of a filling course land? | same term; open |
| **P1** | picker tiers labelled (§10.2) rather than filtered | yes |
| **P2** | rank candidates by prereq reachability from the card's term | yes |
| **R1** | runtime narrowing, restricted to intersection with the build-time set | yes — §11 |
| **R2** | when every candidate becomes impossible: rebind, or say "already covered"? | say it; never rebind |
| **M1** | requirements panel: forced-only pending marker, or the exact min–max range? | forced-only first |
| **M2** | is a pending marker a violation of the isolation boundary? | no — it answers a different question, and must never render as a check |
| **M3** | render *provable* (§9.3) and *forced* pending markers differently? | no — a student cannot act on the distinction |
| **N1** | should `bind-plans` bind named-options cells too (§9.3)? currently `isUnnamed` skips all 1,386 | yes — it is the highest-confidence population and we bind none of it |
| **N2** | do named-options cells enter the flow solve as capacity? | **required, not optional** — §12.0 measures 44 sections over-subscribed without it, worst 12 pending against room 1 |
| **W1** | fold plurals in `tokens()` (§14.1) | yes — 562 cells, one stemming step, the cheapest win in the pipeline |
| **W2** | replace the global `useSoft` switch with an incremental strongest-first pass (§14.2) | yes — 23.8% of plans currently discard all wording |
| **W3** | demote `subjectOf` from fact to weak restriction (§14.3) | **measure first.** The edge deletion is doing real work — it is what keeps `MATH elective` out of the Khoury bucket — and demoting it could lose forced bindings. The ART/ARTF defect is proven; the cost of the fix is not |
| **W4** | should exact title match ever be a hard edge? | **no** — wording gives intent, capacity is the flow's job |
| **W5** | is `known.has(up)` salvageable, or is any leading-token subject read unsafe? | demoting it (W3) makes the question moot; revisit only if W3 loses cells |
| **M4** | pending mark propagates to children? (§12.1) | **no** — boxes stay empty, nothing dims, numerator untouched |
| **M5** | grey check, or a mark of its own? | its own — a grey check says "the same thing, less certainly"; we mean "a different thing" |
| **X1** | prereq-check named-option reservations by OR over their options (§15.1) | yes — 36.6% carry a real constraint, and `prereqEval.js` already does it |
| **X2** | eliminate an option when a placed course depends on it (§15.2) | yes — but only when the dependent is unsatisfiable without the reservation |
| **X3** | does §15.2 elimination feed back into the §4 flow solve, or stay a display-time narrowing? | feed back — it removes candidate courses, which can change which requirements remain possible |
| **X4** | do §15 checks extend to unnamed reservations via their candidate set? | not yet — a 100-course candidate set makes the OR trivially true and the elimination never fire |
| **X5** | repeat instances: `placements` keys can carry `#n`, so a bare course id may read as unplaced and take the fill path instead of the swap path (§10.1) | resolve the key the way `applySamplePlan` does (`split("#")[0]`) before testing |
| **X6** | prereq lines to a reservation — union over options, or only shared prereqs? (§15.4) | union — a line already means "feeds", not "requires", and the both-ends-placed filter keeps it quiet |
| **X7** | prereq badge on a reservation — when? | only when **every** option is blocked; one open option means no warning |
| **X8** | is a blocked option removed from the picker, or greyed with a reason? | greyed — removal claims the plan will not change |
| **X9** | do §15.4 lines also cover coreqs of options? | yes, same union; consistent with G4 carrying coreq partners on fill |

---

## 17. Consolidation — one object, two sets, N filters

§§9–15 grew by accretion. Each question added a mechanism, and nobody factored
out what the mechanisms share. They share almost everything.

### 17.1 Every rule in this document is the same shape

| § | mechanism | what it actually does |
|---|---|---|
| 4 | flow arithmetic | removes candidate **requirements** |
| 14 | wording | removes candidate **requirements** |
| 9.3 | certainty | removes candidate **requirements** |
| 11 | runtime narrowing | removes candidate **requirements** |
| 15.1 | prereqs | removes candidate **courses** |
| 15.2 | dependents | removes candidate **courses** |
| 10.2 | picker tiers | *ranks* candidate courses |

There are exactly **two sets per card**, and they are linked — the courses are
the union of what the candidate requirements admit. Every mechanism is a
monotone filter over one of them. Nothing here is a special case; the document
just never said so.

```jsonc
Card       { options?: [[courseId]], sh, semId }
Candidates { requirements: Set<sectionIdx|sentinel>, courses: EligibleSpec }
narrow     (candidates, plan) => candidates      // may only REMOVE
```

Everything the UI needs is then a read of that one structure:

| question | answer |
|---|---|
| which requirement is this for? | `requirements.size === 1` |
| pending mark in the panel? | same test |
| what can fill it? | `courses` |
| prereq warning? | `courses` is empty |
| prereq lines? | edges into `courses` |

### 17.2 Named and unnamed cells are one population

§9.3 treats `CS 4300 or 4100` as a separate kind with its own certainty
computation, its own binding question (N1), its own capacity question (N2). It
is not a separate kind:

> **`options` is simply a course candidate set the catalog pre-seeded.**

An unnamed cell starts with *everything its candidate requirements admit*; a
named cell starts with *two courses*. Same object, different starting width, one
code path.

**This is where simplification buys robustness rather than only tidiness.** The
44 over-subscribed sections in §12.0 — worst case twelve pending marks against a
requirement needing one course — exist *because* the two populations were
solved separately and neither knew the other's claims. One population means one
flow, and that bug becomes **structurally impossible** rather than clamped.

### 17.3 What this deletes

| removed | why |
|---|---|
| **N1**, **N2** | dissolve — named cells are cells; they bind and consume capacity because everything does |
| **§12.0's clamp** | unnecessary; one flow cannot over-subscribe |
| **M3** (provable vs forced marks) | both are `requirements.size === 1` |
| **X4** | dissolves — one path already covers both |
| **§10.2's four tiers** | tiers 1–2 collapse into `courses`; tiers 3–4 are "not in `courses`", i.e. ordinary search. **One list plus search** |
| **§15.4's union-vs-intersection question** | lines are edges into `courses`, which is the same object |

Five of the 29 open decisions disappear, and one measured defect stops being
possible.

### 17.4 What does *not* simplify, and should not be forced to

Being honest about the floor:

- **§14.3's false fact** (`ART` vs `ARTF`). A real defect at any architecture.
  Ordering evidence by strength is the actual domain, not accidental complexity.
- **§12.1** — a pending mark must not propagate to children. A genuine UI rule
  with no structural equivalent.
- **The flow solve.** It is an exact answer to an exactly-posed question; the
  alternative is the relaxation ladder this design already replaced once.
- **§10.1 fill-on-drop.** Already one sentence.

### 17.5 The cost, stated plainly

1. **Candidates become live state**, re-narrowed when the plan changes. That is
   a memo, but it is a memo the whole UI now depends on.
2. **Monotonicity stops being advice and becomes load-bearing.** §11's rule —
   narrowing may only intersect — has to hold for *every* filter, or a card can
   silently regain a candidate. That is one invariant test rather than a rule
   remembered per mechanism, which is the trade being made.
3. **Debuggability**: "which filter removed this candidate?" needs an answer, so
   each removal records its reason. That cost is already paid — the picker has
   to print exactly that (`blocked: needs CS 3100`), so provenance is a
   requirement, not overhead.

### 17.6 Verdict

The consolidation is worth doing **before** implementation, not after. It
removes five decisions, deletes one measured class of bug, and makes the
narrowing rules additive — a new one is a function, not a new surface. It does
not simplify the domain, and §17.4 is the irreducible part.

The document stays long because the *evidence* is long. The *system* it
describes should be one object, two sets, and a list of filters.

---

## 18. Residual risk — claims not yet verified

Recorded so they are not mistaken for measured facts.

| claim | status |
|---|---|
| §15.1 36.6% / §15.2 floor 35.6% are *possibilities*, not yields | both need real student plans; unmeasurable now |
| demoting `subjectOf` (W3) does not lose forced bindings | **unmeasured** — the one change here that could regress coverage |
| §11 narrowing stays monotone once §15.2 elimination feeds back (X3) | argued, not proven. Eliminating options can only *grow* a cell's certain set, which claims more capacity, which shrinks others' candidates — shrinking is safe, but the composition with N2 has not been checked |
| the 113 unbound cells are missing requirements, not §14.3 false facts | untested; the ART/ARTF defect deletes edges silently and could account for some |
| positional `origin` keys survive a re-scrape well enough for de-duplication | §2's stability sample was 38–114 positions; still small |
| §12.0's flow-reconciled pending count terminates cleanly when a section is `shared` | `shared` sections are deliberately cross-counted and are excluded from demand; their pending behaviour is undefined |

---

## Appendix — why not simply keep the previous attempt

It reached 63.8% forced bindings on real data and correctly identified the
`Computing and social issues` case by pure elimination, so it was not a failure.
It is being replaced because three load-bearing decisions were made under
assumptions later disproved: that binding was a runtime concern (§3), that a
requirement pointer should be the key (§5), and that the entry model beneath it
was sound (§1). The lessons are carried; the constraints are not.
