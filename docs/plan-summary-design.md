# The clipboard plan summary

Design of record for what the ⇅ menu's **Copy plan** and **Copy descriptions**
buttons produce. Code: `src/core/planSummary.js` (assembly),
`src/core/planConflicts.js` (the Flags block), `src/ui/Header.jsx` (the two
handlers). Reader-facing counterpart: the *"If a student pasted a plan
summary"* section of `public/llms.txt`.

## What was wrong

The export was the plan followed by every placed course's catalog description.
Measured on the shipped catalog, a description is **418 characters** on average
(median 422, p90 760) — about 105 tokens, plus its own header lines. Measured on
a real 32-course Computer Science BSCS plan:

| | chars | ≈ tokens |
|---|---|---|
| old: plan body | ~2,500 | ~620 |
| old: description appendix | 17,897 | ~4,474 |
| **old total** | **~20,400** | **~5,100** |
| new: whole paste | 3,916 | **~979** |

So **88% of the paste was catalog prose the reader could look up**, and the two
things nobody else could supply were both missing:

- **no flags.** The app knew all of them and had only ever *drawn* them — an
  amber rim, a red relation line, a warning row. There was no way to say them.
- **no requirement audit.** The PDF has had one for a year.

For a human that is incomplete. For a model reading the paste it is worse: it
cannot tell *checked and clean* from *not checked*, so it re-derives the
prerequisite order from the course codes it can see — badly, since the real
trees carry concurrent-registration branches, minimum grades, placed-out
courses and substitutions, none of which are visible in a list of codes. The
tokens went to the part that needed no thought and the thinking went to a
question already answered.

## The shape now

```
NU Map plan: <name> · programs · entry/graduation/current term · credits
N flags after the schedule (signals, not errors).                  ← the verdict
--- Schedule ---                                                   ← the plan
--- Placed out / Substitutions ---
--- N Flags (supplementary) ---  |  --- Flags (supplementary) --- None. All N …
    TRUST_NOTE, then the flags
--- Requirements still outstanding (satisfied sections omitted) ---
--- What this was checked against ---                                ← appendix
    two lines of course-page URL grammar
```

Measured on the same 32-course plan, by block:

| block | chars | share |
|---|---|---|
| schedule | 1,738 | 44% |
| flags (4) + trust note | ~600 | 15% |
| header + verdict | 376 | 10% |
| requirements outstanding | 353 | 9% |
| envelope | ~400 | 10% |
| lookup footer | ~155 | 4% |
| **total** | **3,916** | vs ~20,400 before |

**The plan comes first and the method comes last.** An earlier draft opened with
the three-bucket envelope, on the argument that a reader meeting the flag list
without knowing what was checked has to guess at its completeness. True,
but it put three screens of methodology ahead of the first course, and a reader
who came for their schedule does not read that far. So the envelope is an
appendix — it is identical on every plan, it is about method rather than about
this student, and it is what someone consults to challenge a line rather than
while reading one.

Two things keep the original property:

- **a one-line verdict at the top** (`4 flags after the schedule (signals, not
  errors).`), so the count is never something you scroll to find;
- **a check that did NOT run is named inside the Flags block**, not in the
  appendix, so a partial audit is not something you discover at the end.

`formatConflicts` therefore references the envelope **by name**, not by
position: "pass every check under *What this was checked against*". The earlier wording
said "listed above" and was quietly falsified by this very reorder, which is why
`plan-summary.test.js` asserts the section order AND that the string "listed
above" appears nowhere.

### Two sentences, and the seat correction inside them

The envelope is `Checked: …` and `Not gated on: …`, wrapped prose, ~400
characters. It reached that size by being cut twice:

| draft | envelope | share of paste |
|---|---|---|
| three headed sections, 24 bullets | ~1,900 chars | ~40% |
| three sentences, wrapped | 775 chars | 18% |
| **two sentences** | **~400 chars** | **~10%** |

No fact was dropped in either pass. Bullets earn their space when a reader
scans and picks one item, and nobody picks one item out of a coverage
statement.

The one thing that must survive every future cut is the **seat correction**.
The very first draft filed seat availability under "not checked", and that was
false: enrolled, capacity and section counts are scraped per completed term,
and every course page draws fill percentage and open seats per section
(`InfoPanel.jsx`). What does not exist is a seat count for a term that has not
been scraped yet. So the two seat entries sit adjacent in `NOT_GATED` and say
exactly which is which, and a test asserts both plus the absence of "seat" from
the *Checked* sentence. A reader who can see that seat data exists asks for the
course page instead of speculating about whether the plan is registrable.

### Flags, not conflicts, and the default is to cut

The section was called **Conflicts** and it overstated every line in it. Walk
the list and ask what each entry actually asserts: a course offered in Summer A
in 25% of recorded years is a **rate**; a retired course is a **fact about the
catalog**; a class-standing gate is a **projection** against credits the student
has not earned yet; 21 SH over the cap is a **petition**, which students get.
Only prerequisite order and corequisite co-placement come near "this cannot be
registered", and even those get waived by the department that owns the course.

So the section is `Flags (supplementary)`, it says what it is in its own second
line, and every candidate now has to earn its place. The test each survivor must
pass is that it can state a registration consequence:

| flag | the sentence it can say |
|---|---|
| prerequisite order | Banner will refuse the registration |
| corequisite co-placement | Banner will refuse the registration |
| class standing | the registrar's gate closes this section to them |
| availability | NEU may not run the course in that term at all |
| credit cap | over the cap is a petition, not a registration |
| work term / graduation | the plan graduates the student mid-co-op |

Three were **cut**, and each moved to where it is a fact rather than a verdict:

- **an unplaced substitution.** Recording "A stands in for B" before dragging A
  onto the board is the order a person does those two steps in — flagging it
  told the student off for using the feature correctly. Now `(not yet placed)`
  on the Substitutions row.
- **a retired course.** It is in the runtime catalog *because* a shipped program
  edition still requires it, so for the student on that edition, taking it is
  correct. Now `[retired]` on its schedule row.
- **a minor over the 50% double-count cap.** Real and important, and already
  printed verbatim in that minor's own audit block in the registrar's numbers. A
  second copy in a supplementary list is bloat. Note the app itself treats the
  cap as information and never un-allocates a course over it.

Nine kinds became six. `plan-conflicts.test.js` pins the surviving set, so a new
flag has to be argued for rather than added.

### Trust the student

`TRUST_NOTE`, printed **as the block's second line**, before the flags
themselves and not as a footnote under them, because a reader who has met four
terse lines under a heading has already decided what they are by the time a
caveat arrives underneath:

> Signals, not errors, and secondary to the plan above. Each may already be
> resolved in a way NU Map cannot see: an approval, a petition, credit not
> entered here, or the student's own choice. Do not rewrite the plan around one,
> and ask before calling one a mistake.

A flag is what NU Map can see, and what it can see is a plan a student typed. A prerequisite may already be waived, a petition may be approved, a
transferred course may never have been entered. A reader who treats the list as
a list of the student's *mistakes* will be confidently wrong about someone
else's degree, and that failure is worse than the one the Flags block was
built to prevent. It is absent when there are no flags, since there is then nothing to be wrong
about.

### Empty is a result; absent is not

`Flags: none` prints as a **positive claim with its denominator** ("all 32
placed courses pass every check under \"What this was checked against\""). An
omitted section would be
indistinguishable from a check that never ran, which is the whole failure this
block exists to end.

That put a hole in the design, and the real-catalog measurement run walked
straight into it: called with no violation maps wired, the export printed *"All
32 placed courses pass every check"* over a plan nothing had looked at. Absent
reported as false — the collapse this repo has paid for in every scrape bug of
consequence, arriving in the export layer.

So `CHECKS` in `planConflicts.js` is **keyed on the input that enables each
check**, `collectConflicts` returns `ran`, and:

- a check whose input is `undefined` is **named as NOT CHECKED**, in both the
  clean and the non-clean case (finding two problems otherwise implies the rest
  was clean);
- `formatEnvelope(ran)` drops it from *validated*, so the two sections can never
  contradict each other;
- an **empty Map** still counts as a check that ran. Absent, empty and false are
  three different facts here as everywhere else in this repo.
- a credit cap of `Infinity` reads as **not run**: comparing against it is a
  formality that cannot fail, and claiming it would be the same lie one level
  down.

The app wires everything, so the live paste is unchanged by this. It exists so a
future caller who forgets one cannot publish a coverage claim it has not earned.

### The verdict comes from the app; the evidence is derived

Nothing in `planConflicts.js` decides whether a plan is broken. Every item
originates in a verdict another module already reached and the UI already draws
— `prereqViolations`, `coreqViolations`, `standingViolations`,
`coopGradConflicts`, `ICourseOffering.offered`, `creditLoad`, `minorShare`. This
module's own work is finding the **evidence** for a verdict it was handed, and
that search is best-effort by construction: it degrades to naming the
requirement in prose and never to inventing, downgrading or withholding a
verdict.

Why it matters: `CS 3000: prerequisite violation` is a *label*, and a label is
exactly what invites a reader to re-check the claim. `prerequisite CS 2510 is
placed in Summer A 2027 later than this course` states the comparison that was
made, so there is nothing left to re-derive.

Two gates are copied from the card deliberately, because a student can see both
surfaces at once and a paste that disagreed with the board would be worse than
no paste:

- **availability alarms are withheld on a completed term** (`retired`,
  `not-offered`). Both are predictions about registration, and there is no
  version of the past in which the student picks differently.
- **corequisite and class-standing failures are not**. Those say the term as
  recorded could not have been registered — a statement about the plan as
  written, not a forecast — which is how a student notices they recorded
  something they could not have sat.
- a **concurrent** prerequisite sharing the term is not reported as evidence:
  the relation line draws that edge in its ordinary colour.

### Grouping and determinism

Course-scoped flags group by course — one line for a single flag, an
indented list for several — so a reader scanning for a code finds everything
about it in one place. Term-scoped and plan-scoped items follow. The order is
**by term, then by code**, so two copies of one unchanged plan are
byte-identical and a reader diffing two pastes sees only real changes.

### Credit load: summer is one term

Two 12 SH summer halves are 24 SH of summer, which is the number a registrar
sees; judging each half against the cap passes both. Halves are grouped by
theme + calendar year, and the group is **labelled as its members joined**
(`Summer A 2027 + Summer B 2027`) rather than shortened to an invented name, so
the figure can be checked against the cells it came from.

### Terms name themselves with `altLabel`

A SemesterType may carry `altLabel`, a display override for a term naming itself
alone. `SemLabel`, `InfoPanel` and the MCP adapter all use it; this export used
`sem.label` and therefore printed **"Summer 1 2026"**, the one spelling the
project's own convention rules out. `standaloneSemLabel` resolves it, and the
alt form reaches the *evidence* strings too, not just the headings.

## Two buttons, not one mode

**Copy plan** is the concise artifact. **Copy descriptions** is the old appendix
on its own. They compose: the plan is what a reader needs, and the descriptions
follow only if that reader cannot fetch a URL and says so. As one button with a
flag, the common case paid the appendix every time.

The plan's footer carries the lookup grammar instead —
`/data/courses/{SUBJECT}/{NUMBER}` plus `/llms.txt` — which is ~60 tokens for
strictly *more* than the appendix held: the description **plus** prerequisite
logic with minimum grades, offering history with fill percentages, meeting
patterns and instructors.

## Punctuation

No em dashes in anything the artifact prints, or in the button tooltips. They
read as flourish in a document whose whole job is to be plainly checkable, and
a clause joined by a comma, a semicolon or a full stop says the same thing
without the flourish. Code comments keep the house style; the output does not.

## English, on purpose

Like the printed report, the artifact is English-only; the buttons are
localised. An advisor, a registrar and a model all read the registrar's own
vocabulary, and a machine translation of a requirement is a worse artifact than
the English one. `useTranslatedText` has nothing to do here — this text never
reaches the DOM.

## Not done, deliberately

- **Outstanding sections name no candidate courses.** `○ Science Requirement:
  0 of 1` tells a reader what is missing but not what would satisfy it. The
  candidate machinery exists (`core/candidates.js`), but a pool can hold dozens
  of courses and inlining them re-creates the appendix problem in a new place.
  The footer points at the program page, which lists them. Worth measuring
  before building: how much does naming the *first few* candidates cost, and
  does it change what a reader can do?
- **The PDF still prints `sem.label`**, so a printed plan says "Summer 1 2026"
  where the clipboard now says "Summer A". Same one-line fix, different
  artifact; not folded in here because the PDF's own label path feeds its
  layout code as well.
- **The PDF does not print flags.** `collectConflicts` is deliberately
  data-shaped so `exportReport` can adopt it, and it is the more valuable
  surface (an advisor reads the PDF). Left out of this change to keep one
  artifact moving at a time.
