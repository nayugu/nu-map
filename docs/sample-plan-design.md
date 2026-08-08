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

**Binding as a runtime query.** A binding is a fact about a *program*, not a
student. Computing it live means a slot's meaning changes as the student places
courses: satisfy Khoury by hand and the `Khoury Elective` slot re-binds
somewhere else. It still means Khoury.

**Requirement-section pointers as the load-bearing key.** `title#ordinal` is
fragile across re-scrapes and collides outright on dual majors — two programs
both offer `Capstone#0`.

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
- Storing reservations outside `placements` and deriving a view — arrived at
  deliberately this time; see [§2](#2-the-structural-question).

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

## 2. The structural question

**This is the decision that needs making, and it is the only one I am not
prepared to make unilaterally.** It sets how invasive the change is.

### Option A — reservations stored beside placements (incremental-clean)

A plan writes `placements` for named courses and a separate `reservations` map
for unanswered ones. The grid renders a derived view of both.

- **Cost:** low. `placements` keeps its shape; the share codec, audit, MCP and
  every renderer are untouched except where they already read the derived view.
- **Keeps:** the duality. Two stores that must be kept consistent — the
  `reopenOrphanedSlots` class of bug is inherent to it.

### Option B — the plan *is* the structure, answers attach to it (structural)

The student holds a plan instance: years → terms → entries. A placement is
"course X answers entry N". There is no separate notion of a slot; an entry is
answered or it is not.

- **Gains:** the duality disappears. Ordering, credit, and provenance live in
  one place. "Which requirement was this course chosen for" is a field, not a
  reverse lookup. Re-applying a template is a merge over one structure.
- **Cost:** high, and honestly so. It touches the share codec (`p`, `sl`, `so`),
  the graduation audit's input, MCP action semantics (which would need a
  redeploy), and every renderer. It also has to answer what happens to a course
  placed *without* a plan — which is the common case today.

**Recommendation: A, with the entry model of §1 as the reservation payload.**
Option B is the better model, but its cost is concentrated in exactly the
surfaces that are hardest to test (share links, MCP) and it would block the
feature behind a migration. A is reversible; B can be reached later from A once
entries are first-class, because A's `reservations` are already §1 nodes.

**Decision required before any code.**

---

## 3. Binding happens in the scraper

A binding is a fact about a program. The same plan resolves to the same
requirements for every student who loads it, so it is computed at scrape time
and shipped inside `plan.json`.

What this buys:

- **Diffable.** The 36 and/or cells and 14 nested plans appear in a git diff
  under review, instead of being found by an audit months later.
- **Gated.** Binding quality joins `planTermsAgree`/`planTermsDisagree` as a
  data-quality counter that can refuse a write, matching the rails the
  requirements side already has.
- **No meaning drift.** A slot's binding cannot change as a student places
  courses, because it is not a query.
- **No runtime cost**, which is what makes §4 affordable.

The genuinely per-student question — *is this requirement still outstanding for
me?* — is separate, live, and derived from the graduation audit that already
runs. Conflating the two was the central error of the previous attempt.

**Sequencing constraint, easy to get backwards:** binding is computed against
the plan's *own* named courses as though placed. Computed against an empty
plan, every requirement looks outstanding and every binding is noise.

---

## 4. Assignment is solved exactly, not heuristically

The problem is: assign unanswered entries to outstanding requirements such that
no requirement takes more credit than it needs. That is a capacitated
assignment, and min-cost max-flow answers it exactly:

- an edge is **forced** if every maximum flow contains it,
- **impossible** if none does,
- **possible** otherwise.

This replaces a hand-tuned ladder with a `pass < 8` bound and a hand-written
strength table — constants chosen by the author rather than derived. Both are
symptoms of approximating a problem that has an exact answer. Build-time
execution (§3) removes any performance argument against it.

Wording still participates, but only as an **edge filter applied before the
flow**, and only where it can be checked against course sets rather than titles:

| evidence | check | may be relaxed |
|---|---|---|
| catalog printed the codes | — | never |
| cell states its own range (`MATH 3001 to Math 4999`) | — | never |
| subject (`MATH elective`) | does the requirement admit any MATH course? | if infeasible |
| title similarity (`Khoury Elective`) | shared rare tokens | first |

**Title similarity should use corpus IDF, not a hand-written stopword list.**
The previous attempt hand-listed `course`, `elective`, `requirement`… which is
an approximation of inverse document frequency computed by a person. Deriving it
from the corpus of section titles self-maintains through monthly scrapes and
grades the evidence instead of making it boolean. Not fuzzy/edit-distance
matching: our failure is *paraphrase*, not typo, and no edit-distance threshold
separates `Computing and social issues` / `Supporting Course` from a true match.

**Open question (B1):** relaxation currently reruns the whole solve. With exact
flow it may be cleaner to model wording as edge *cost* rather than edge
*existence* — a min-cost flow then prefers well-worded assignments without ever
being unable to find one. Leaning strongly this way; it removes relaxation as a
concept.

---

## 5. What may fill an entry

Ship the **spec**, not a pointer.

```jsonc
"admits": { "keys": ["AFCS2600", "CY4170", "…"], "ranges": [] },
"requirement": { "title": "Supporting Course", "confidence": "forced" }
```

`admits` is self-contained and load-bearing. `requirement` is display metadata
and is **allowed to fail** — if a re-scrape renames the section, the entry
degrades to "we know what fits, we can no longer name why", which is a far
better failure than an unresolvable key. This dissolves the `title#ordinal`
identity problem and the dual-major collision at once.

Three tiers, only the first stored:

| tier | question | source |
|---|---|---|
| **admits** | what does this requirement accept? | shipped spec |
| **allowed** | may the student put this here? | *always yes* — a planner warns, never blocks |
| **recommended** | what should we show first? | `admits` minus already-placed, filtered by term offering and prereq reachability |

**Attributes are a separate axis.** `General elective (NUpath DD)` is a free
elective *plus* an attribute constraint; it never enters `admits`. Codes are
read only where the cell says they are attributes — it names NUpath, or a
parenthetical consists entirely of codes — because `CE` collides with
Computer/Civil Engineering in ~90 cells and a naive match is wrong on four in
five of them. `COMM WI course` is deliberately missed: a bare code with no
parenthetical cannot be told from an abbreviation, and a false attribute
narrows a picker to nothing.

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
| **S1** | §2 — reservations beside placements (A) or plan-as-structure (B)? | **A**, reaching B later |
| **E1** | is `optional` distinct from an `either`? | yes |
| **B1** | wording as edge cost rather than edge filter? | yes |
| **V1** | should binding over-subscription *block* a scrape write, or only report? | report first, block once a baseline exists |
| **C1** | model college-wide requirements (CSSH foreign language), or leave them honestly unbound? | unbound now; §6 turns them into a queue |

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
