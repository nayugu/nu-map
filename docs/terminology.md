# Terminology — what to call a thing in a semester

Written 2026-08-14, after an audit prompted by the observation that the same object is called a
card, a course, a reservation and a placeholder in different files.

**The audit's conclusion was not the expected one, and it took three corrections to get there.**
The vocabulary is very nearly coherent already: almost every word marks either a LAYER or a real
distinction, and the reason it reads as sloppy is that nothing wrote the distinctions down.

Exactly **one** genuine defect was found — `row` used for two things — and it was two comment
lines. The other two candidates were both wrong, and both are recorded below rather than deleted,
because each was a tidy argument that will be made again:

- merging `placeholder` into `reservation`, which would have destroyed a real distinction
- splitting `slot` into two senses, which turned out to be one sense counted two ways

The deliverable is therefore this document, not a rename. A coherent vocabulary that nobody wrote
down reads exactly like an incoherent one, and only one of those is fixed by editing code.

Measured over `src/core`, `src/engine`, `src/ui`, `src/adapters`, `src/ports`, `scripts`, `docs`
and `test`:

| word | uses | concentrated in | student-facing strings |
|---|---|---|---|
| `course` | 5,371 | everywhere | 137 |
| `cell` | 2,381 | `src/engine` (1,189) | **0** |
| `row` | 1,063 | `src/ui` (485) | 1 |
| `card` | 987 | `src/ui` (276) | 10 |
| `reservation` | 726 | `src/core` (155) | **0** |
| `entry`/`entries` | ~900 | `emit.js`, adapters | 9 (mostly other senses) |
| `slot` | 459 | `src/engine` (99) | 7 |
| `placeholder` | 159 | prose, `src/ui` (78) | 4 |

## The pipeline: four names for one obligation, one per layer

These are not synonyms. Each says which layer you are in, and using the wrong one hides a real
boundary.

| term | layer | defined by |
|---|---|---|
| **course** | the catalog | a real entity with an id — `CS 2500`. Never use it for a slot that has no course. |
| **cell** | the engine, before emission | one obligation to schedule. `deriveCells` turns a requirement into cells; the search places cells. |
| **entry** | the emitted plan document | one row of `{ text, sh, options?, binding? }`. The interchange format `emit.js` writes and `applySamplePlan` reads. |
| **card** | the rendered UI | what a student sees and drags. |

A requirement becomes a **cell**, is emitted as an **entry**, and renders as a **card**. `cell`
has **zero** student-facing strings and `card` has ten — that division is correct and worth
keeping.

## The thing with no course in it: three words, three meanings

This is where the audit expected to find sloppiness and did not. All three are load-bearing.

**`reservation`** — *a card in a semester that has not been given a course yet.* The definition is
`src/core/reservations.js`, and it is a **model entity**: it has an id (`isReservationId`), it is
created (`createReservation`), it is persisted in its own map, and it is deliberately kept out of
`placements` so that "what is in this semester?" and "what counts toward my degree?" get different
answers. It is the noun for something in the STUDENT'S plan.

**`placeholder`** — *carries no named course.* A descriptive property, not an entity. Use it when
measuring or describing, especially about plans we did not build: a department's published row is a
placeholder, and calling it a reservation would claim we created it. `chart-gate.js` counts these
as `fillers`.

**`unguided`** — *a placeholder whose wording says nothing specific.* A strict SUBSET of
placeholder, and the distinction is measured, not stylistic. From `chart-gate.js`:

> a department's "PSYC elective" is a placeholder and is NOT unguided, and conflating the two is
> what made CHART look better than the departments at clumping when it is four times worse

So: **every reservation is a placeholder; only some placeholders are unguided; a placeholder in a
published plan is not a reservation.**

> **A proposal that was made and withdrawn.** This audit first recommended retiring `placeholder`
> internally in favour of `reservation`, on the evidence that `reservation` has all the code
> identity (`createReservation`, `isReservationId`, `candidatesForReservation`, `bindReservations`)
> while `placeholder`'s only identifiers — `placeholderColor`, `getByPlaceholder` — turn out to be
> about HTML input placeholders and not courses at all. The identifier counts were right and the
> conclusion was wrong: you *create* a reservation in a student's plan and you *observe* a
> placeholder in a department's, so collapsing them would make it impossible to say the second
> thing. Recorded because the argument is tidy and someone will make it again.

## `slot` is coherent — this audit claimed otherwise and was wrong

The audit's second finding was that `slot` carries two unrelated meanings: term capacity
(`termSlotCap`, `maxSlots`, `takeConsumesSlot`) and "a position with no course in it"
(`--border-slot`, "a slot with no course named"). Read across all 459 uses, that is not what the
word does.

**A slot is a position that holds one card.** Capacity is then how many positions a term has, which
is the same concept counted — `SamplePlanPreview` says it outright: "`maxSlots` is a layout constant
from `semGrid.js` — 4 for spring, 5 for fall, 2 for a summer half". `slotLabel` labels a position,
`takeConsumesSlot` says a take uses one up, "32 real courses for exactly 32 slots" counts them.
An empty slot is a position with nothing in it, which is not a second meaning.

Nothing to rename. Recorded because the two-senses reading is superficially convincing — "the slot
cap left no slot for the elective" *sounds* like a pun and is in fact one sentence about positions.

## `row` means a SEMESTER LINE, never an entry — the one real collision

`row` is a UI and layout term — `SemRow`, `SummerRow`, `studyRows` — and 485 of its 1,063 uses are
in `src/ui`. But prose has used it for entries too: `seed.js` said "one term index per reserved
row", meaning one per reserved *entry*. A reader cannot tell whether a "row" is a term or a thing
inside a term.

Rule: a **row** is a semester in the grid. What sits inside it is a card, an entry or a cell,
depending on the layer.

## Quick reference

- Catalog entity → **course**
- Engine's unit of demand → **cell**
- Emitted document line → **entry**
- Rendered tile → **card**
- A card the student has not filled → **reservation**
- Any cell or entry with no named course → **placeholder**
- A placeholder that names nothing at all → **unguided**
- A position that holds one card, and so also the count of them → **slot**
- A semester line in the grid → **row**

Two things the student sees are `card` and `placeholder`: every entry renders as a card, and a card
with no course yet is a placeholder. `cell` and `reservation` stay out of the UI, which they already
did.

## What the student ACTUALLY saw, before this — the deep pass

An earlier draft of this document asserted that "no locale string needs changing". That was wrong,
and it was wrong because it reasoned from the definitions instead of reading the strings. Reading
them, one panel used three different words for one object:

- `grad.reserved.note` — "Your plan reserves **{cards} cards** … you haven't chosen yet"
- `chart.explain.legal.witness` — "For each **open slot**, a real course that fits it was found"
- `chart.explain.complete.unschedulable` — "The plan keeps **the slot**"
- against `onboard.sampleplan.counts` and `grad.plan.replace.*` — "**{n} placeholders**"

**The translations were worse than the English**, which is the part no amount of reasoning would
have found. For this one concept, Spanish used four words (*tarjetas*, *hueco abierto*, *el hueco*,
*espacios libres*), French four (*cartes*, *case libre*, *la place*, *cases libres*), Arabic four.
Chinese was already perfectly consistent (占位 in all of them) and Japanese nearly so.

Fixed by aligning every locale to the word it *already* used in the majority of its placeholder
strings, rather than by inventing one:

| locale | canonical word |
|---|---|
| en | placeholder |
| es | espacio |
| fr | emplacement |
| ar | خانة / خانات |
| hi | स्थान |
| ja | 枠 |
| ko | 자리 |
| zh | 占位 |

Japanese also had one string using the transliteration プレースホルダー where the other six used
枠; that is now 枠 too.

`grad.plan.left` — "{choices} choices and {slots} open slots are yours to fill" — was **dead in all
eight locales**, with no call site anywhere outside `src/locales`. It contributed two more words to
the pile while being unreachable, and is deleted. (Defect 11 in `chart-open-defects.md` is dead
locale keys generally; this was one of them.)

**One accepted mismatch, recorded rather than fixed.** `grad.reserved.note` interpolates `{cards}`
while its text now says "placeholders", and `grad.plan.replace.{gain,lose}.slots` are keyed `slots`
while their text says "placeholders". The key and the parameter are internal names and the data
field behind them is `reserved.cards`; renaming the chain reaches `GradPanel.jsx`,
`SamplePlanOffer.jsx` and core's `planTemplate`, which is more risk than a name nobody reads is
worth. If that chain is ever touched for another reason, rename them then.
