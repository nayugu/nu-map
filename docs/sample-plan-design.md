# Sample plans & elective slots — design of record (2026-08-07)

Loading a department's published Sample Plan of Study into a student's planner,
and making the ~51% of it that names no course into something they can act on.

**Status: design only. No implementation.** This supersedes two earlier attempts
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
| **S1** | §2 — resolved: reference + derived answered-ness, per the id-stability rule | settled |
| **E1** | is `optional` distinct from an `either`? | yes |
| **B1** | wording as edge cost rather than edge filter? | yes |
| **V1** | should binding over-subscription *block* a scrape write, or only report? | report first, block once a baseline exists |
| **C1** | model college-wide requirements (CSSH foreign language), or leave them honestly unbound? | unbound now; §6 turns them into a queue |
| **D1** | how legible must a reservation retiring itself be (§2)? | UI question, deferred |
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

## Appendix — why not simply keep the previous attempt

It reached 63.8% forced bindings on real data and correctly identified the
`Computing and social issues` case by pure elimination, so it was not a failure.
It is being replaced because three load-bearing decisions were made under
assumptions later disproved: that binding was a runtime concern (§3), that a
requirement pointer should be the key (§5), and that the entry model beneath it
was sound (§1). The lessons are carried; the constraints are not.
