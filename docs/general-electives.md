# General electives

*What "free elective" means here, why the number was wrong for a year, and what
is still wrong with it. Written 2026-08-30, from the Mechanical Engineering and
Design defect.*

---

## 1. What a general elective actually is

Northeastern does not publish a free-elective requirement. It publishes a degree
total and a list of requirements, and the gap between them is the student's to
spend. So a general elective is not a *thing* the catalog states — it is what is
**left over**:

```
free electives = totalCreditsRequired − Σ (credit each requirement section demands)
```

Two facts make this the only defensible rule, and both were checked rather than
assumed.

**NUpath adds nothing to the total.** The university's general-education page
(`catalog.northeastern.edu/undergraduate/university-academics/general-education-requirements/`)
is explicit that "NUpath is competency based rather than course based" — the
eleven competencies are satisfied by courses a student is already taking, one
course covering up to two of them. There is no NUpath credit block to subtract,
so a program's own requirement sections plus the residual really are the whole
degree. A design that reserved credit for NUpath would double-count it.

**The catalog's own stated figure is not authority.** 95 of 1,071 programs print
a `generalElectiveSH`. It disagrees with the degree total in both directions —
one program states 8 SH while 23 SH of the degree is otherwise unaccounted for;
another states 20 against sections totalling 120 for a 133-credit degree.
`totalCreditsRequired` is the headline claim a student is held to, so the
residual wins and the stated figure is kept only as a signal
(`general-elective-disagreement`) marking pages whose own two numbers disagree.

That makes the 95 programs an **independent test set**: a figure the code
deliberately does not read, which we can nonetheless score against. Everything
below is measured on it.

---

## 2. What was wrong

The residual is a subtraction, so it is only as good as `Σ demand`. And
`demandOf` was not measuring demand — it was estimating it:

```js
demand = minRequirementCount × typicalSH(spec, courseMap)   // children × modal credit
```

Both halves are approximations. `minRequirementCount` counts *entries* in a
section, not courses — a co-requisite pair is one entry and two courses.
`typicalSH` is the modal credit over the section's course pool, which answers
"what does a typical course here carry" and not "what does this section cost".

Multiplying two approximations produced errors in every direction at once.
Mechanical Engineering and Design (Boston) is the case that surfaced it, and it
managed all three failure modes in one program:

| Section | What the courses say | What the estimate said |
|---|---|---|
| Senior Capstone Design Project | MEIE 4701 (1 SH) + MEIE 4702 (5 SH) = **6** | modal credit over {1, 5} is 1 → 2 × 1 = **2** |
| Design Requirements | four ARTG co-requisite pairs at 2+2 = **16** | every course is 2 SH → 4 × 2 = **8** |
| Required Engineering | seven entries, five a lecture + 1 SH lab = **32** | modal credit 4 → 7 × 4 = **28** |

Section by section it summed to 117 SH of a 139 SH degree, so the panel offered
**22 SH of free electives**. The registrar's own page for that program says
**4**. Summing the courses gives 135, and 139 − 135 = 4 — exactly.

Note what kind of bug this is. Nothing crashed, no test failed, and the number
was plausible: 22 SH of free electives is an ordinary figure for an engineering
degree. It was simply *false*, and it told a student that a fifth of their
degree was theirs to spend when it was already spoken for.

### Why the estimate existed at all

Not carelessness — it predates having a reason to be exact. `demandOf` was
written to size a requirement for **binding capacity**, which is counted in
cells, not credits: "can this section absorb one more unnamed plan cell?" For
that question a modal unit is fine. The residual then started reading the same
function for a *credit* total, and nobody re-derived whether the unit was right
for the new question. The comment in `engine/demand.js` even documented the
discrepancy and worked around it rather than fixing it — see §4.

---

## 3. What it does now

One walk over the allocation result, returning `{req, sat}` per node:

| node | required | satisfied |
|---|---|---|
| `COURSE` | its own credits | those credits if placed |
| `AND` | Σ children | Σ children |
| `OR` | **min** over branches | best single branch, capped at `req` |
| `XOM` | `reqSh` (the registrar's threshold) | `satSh`, capped |
| `RANGE` | one unit — a subject window names no course | ditto |
| `SECTION` | Σ children when all are required | Σ children |

Three deliberate choices, each of which could have gone the other way:

**One function, not two.** `shortfallOf` subtracts satisfaction from demand, so
any disagreement between them shows up as a section that can never be finished.
They used to be independent walks in two different currencies — demand as
`count × modal`, satisfaction as `satCount × modal` — and agreed only because
both were wrong the same way. Making demand exact while leaving satisfaction
approximate would have left every fully-completed section reporting a residue.
Hence one walk, with `sat` capped at `req` per node so a 12 SH pool answered
with 16 SH cannot lend 4 SH of surplus to the section beside it.

**OR takes the minimum**, and this was measured, not reasoned. 518 of 3,318 OR
nodes offer branches of differing credit, so the tie-break decides real numbers.
Scored against the 95-program test set:

| OR rule | exact matches | within 1 SH | mean \|error\| |
|---|---|---|---|
| **min** | **22** | **54** | **4.29** |
| modal branch | 20 | 49 | 4.33 |
| max | 16 | 44 | 4.32 |

It is also the honest reading — the requirement *is* answerable with the
cheapest branch — and it errs by inflating free electives rather than by
demanding credit the student does not owe.

**The modal unit is now a fallback only**, reached where nothing states a credit
value: a RANGE, a course missing from the catalog (54 nodes corpus-wide), a
section that names no course at all (580 of them, which fall back to the
registrar's `statedSH` first).

### The branch that does not run

A "choose N of M" section would need a fourth rule. It does not get one, because
the corpus contains none: `minRequirementCount >= children.length` for **all
6,887 shipped sections**, with **zero** nested SECTION nodes and **zero** pick-N
concentration options. The code takes the N cheapest children as a conservative
fallback, and `test/invariant/requirement-credit-corpus.test.js` asserts the case
is still absent — because a fallback nobody has measured must not quietly start
deciding credit for a real program.

---

## 4. The insight worth keeping: CHART was already right

This is the part that generalises.

`engine/demand.js` carried a long comment explaining that it could not use
`obligationsOf`'s residual, because `demandOf` "counts a co-requisite pair as one
course at the section's modal credit — 4 SH where `CS 1800 and CS 1802` is really
5. That is the right measure for BINDING CAPACITY, which is counted in cells, and
the wrong one for a credit total." Mixing the two accountings is what once left
Industrial Engineering emitting 129 SH against a 137 SH degree. So CHART took its
residual against its own **cell** total instead, and grew a `reconciliation`
report to record where the two disagreed.

That workaround was correct, and it was load-bearing: it is why the *generated
plans* were fine while the *panel* was wrong by 18 SH. Two consequences:

1. **The fix is mostly invisible in plan output.** An A/B of both readings inside
   one process (an env hatch, deleted with the measurement — a two-run A/B is
   unreliable in a shared checkout), over the **whole corpus**: 864 plans
   unchanged, **12 moved and every one of them "same courses, different
   arrangement"**, 1 gained and 1 lost. Both readings generated 881 of 1,082
   shapes, threw 0, and passed every hard rule; the refusal mix is identical bar
   one plan swapping `concentration-unfillable` for `no-candidate`.
2. **The reconciliation for co-requisite pairs is gone**, because the two
   accountings converged. The unit test that asserted the disagreement now
   asserts its absence, and a genuinely irreconcilable shape (a 3 SH threshold
   over a subject window, where CHART can only emit whole courses) keeps the
   mechanism under test.

The lesson is not "CHART was clever". It is that **a documented workaround is a
bug report with a date on it**. That comment described the defect precisely,
routed around it, and shipped — and the routing-around was so effective that the
underlying error survived in every other consumer for a year. When a comment
explains why one caller cannot use a shared number, that is the moment to ask
whether the shared number is wrong, not to give that caller its own.

### The same shape, twice

`core/requirementBinding.js` opens with a paragraph titled "One rule, because
there used to be three", listing the three ways this allowance was computed and
stating that "all callers now go through `generalElectiveSHOf`".

That was not true. `allocateMajorWithElectives` still read
`major.generalElectiveSH ?? 0` — the very expression the paragraph says was
deleted — so the **PDF export** printed a `/0` denominator for the 976 programs
that state no figure and disagreed with the panel beside it for the 95 that do.
The consolidation had fixed the callers someone thought of and documented itself
as complete.

It is fixed now by making the allowance a **parameter**: core cannot call back
into `requirementBinding` without closing an import cycle, so a caller that wants
a General Electives section must supply the residual, and `RelevanceContext` —
which only ever wanted `allocatedSet` — calls `allocateMajorSections` and never
builds the section at all.

---

## 5. What is still wrong, and it is not arithmetic

After the fix, **51 of 330 Boston undergraduate degrees still report more than
40% of the degree as free electives**:

| program | free / total | |
|---|---|---|
| Theatre BA (Boston) | 116/132 | 88% |
| Philosophy BA (Boston) | 112/128 | 88% |
| Art BA (Boston) | 93/130 | 72% |

Art BA parses to **six sections totalling 37 SH against a 130 SH degree**. No
credit arithmetic can fix that: the requirements are not in the data. This is a
**coverage** defect — a thin or unparsed requirement pane — and it presents
identically to a sizing defect from inside the app, which is exactly why it is
worth stating the difference here. *Before believing a free-elective number,
check the parsed section count and the degree total.*

### ⚠ A correction: the pages DO state it, in prose

An earlier draft of this section said the BA language requirement "is on no
program page" and that fixing it would mean injecting a university-wide rule the
sources do not state. **That was wrong, and it was wrong because it was never
checked against the markup.** Every BA page carries, inside the requirements
pane:

```html
<h2>BA Language Requirements</h2>
<p>All BA students are required to complete the BA degree language requirements,
   for a total of 12 semester hours of language study or demonstrated equivalent
   proficiency, as described in Additional Requirements for BA students.</p>
```

The pane is a sequence of `<h2>` + body pairs, and the parser only ever read the
pairs whose body was a **table**. So this was not a policy gap — it was a parser
that could not see prose. Measured over the 24 undergraduate degrees with the
largest residual, **23 state credit in prose the parser could not see, 1,177 SH
in total**, under two dominant headings:

| heading | pages | nature |
|---|---|---|
| `BA Language Requirements` — 12 SH | 18 of 24 | **additive** — nothing else covers it |
| `<Major> Credit Requirement` — "Complete 56 semester hours in the major" | ~16 of 24 | **a subtotal** — restates sections already parsed |

Those two must be treated oppositely, which is the whole difficulty. Summing the
subtotal would demand the major twice — up to 60 SH of phantom credit on one
page — and over-demanding *refuses valid plans*, the expensive direction.
`parseTotalCredits` already refuses that exact phrasing ("Never matches 'N
semester hours in the major' — that is a major-only subtotal"), and
`proseSectionSH` reuses the refusal. Measured on 30 cached pages, the change
gains **18 sections and loses 0**.

The subtotal is deliberately left on the floor. Where a program's sections are
parsed it is pure restatement; where they are not — Philosophy BA has **zero**
requirement sections, its whole major being five mutually-exclusive
concentrations — it is the only statement of the major's size, and using it there
means treating it as a **lower bound on the concentration floor**, not as a
section. That is a different mechanism, it needs a corpus-wide HTML cache to
validate, and it fails in the expensive direction, so it is written down here
rather than guessed at.

### A required choice that read as optional

Art BA states "A concentration is not required. Students may complete the
electives option **in lieu of** a concentration." `concentrationMinOptions`
matched *"concentration is not required"* and returned 0, so a 20 SH choice
demanded nothing. The sentence is true and the reading was wrong: no
*concentration* is required, but the page lists an **"Electives Option"** beside
the concentrations, and one of the listed options must be done.

The tell is in the option list, not the prose, which is what makes it decidable:
"Electives Option" is the catalog's own name for the opt-out, so its presence
means the opt-out is already a choice and the choice is mandatory. **19 of the 58
programs scoring 0 have one**; the other 39 are genuinely optional ("Astrophysics
Concentration (Optional)") and keep their 0.

### CPS graduate: stale data, not a defect

All 88 CPS graduate programs ship `totalCreditsRequired: 0`, so their residual is
structurally 0. This is **not** a parser gap. Run against the live pages, the
current parser reads their totals correctly — 12, 15, 34, 12, 34 across a
six-program sample, with one program genuinely stating none. The shipped data was
scraped **2026-08-21** and `parseTotalCredits` has not changed since, so the
*pages* changed: the 2026–27 catalog rolled over and CPS pages gained the
standard "Program Credit/GPA Requirements — N total semester hours required"
block. `verify-majors` already flagged every one of them with the
`missing-total-credits` discrepancy at scrape time, which is the system working.

**No code change is needed**; the bimonthly `update-grad-majors.yml` run picks it
up. 93 of 524 graduate programs corpus-wide carry the same gap.

*Method note: the wrong claim and the right one differ only in that the second
one opened the HTML. "The pages don't state it" was inferred from our data being
empty — which is evidence about the parser, not about the pages.*

For contrast, where the data *is* complete the numbers are now sane: Boston
graduate degrees average 1.8 SH of free electives with 251 of 323 at exactly
zero — which is correct, since a master's is prescribed coursework, not a
distribution.

---

## 6. Measurements

Against the 95 programs that state their own `generalElectiveSH` — an
independent set this code does not read:

| | before | after |
|---|---|---|
| exact agreement | 1 / 95 | **22 / 95** |
| within 1 SH | 2 | **54** |
| within 2 SH | 5 | **64** |
| within 4 SH | 14 | **83** |
| mean \|error\| | 15.08 SH | **2.93 SH** |

Residual disagreement is not chased further on purpose. Grinding to exact
agreement would mean fitting to a figure this project has already established is
wrong in both directions — the residual exists precisely because the stated
number is not trustworthy. The ratchet in the invariant test holds these floors
without asserting equality.

Invariants, checked across all 1,071 programs:

- demand never moves when courses are placed (**0** sections drift)
- satisfaction never exceeds demand (**0** sections)
- a section its named courses can supply reaches zero shortfall once they are
  placed (**0** exceptions, after excluding prose-only sections, subject windows,
  and pools demanding repeats such as Music Performance's 4 SH over two 1 SH
  lessons)
- the residual stays within `[0, totalCreditsRequired]` for every program

Suites: 2,183 unit · 198 contract · 273 invariant, all passing; `npm run
test:boot` mounts the app.

`verify-chart --all` — the corpus verdict, 799 degrees over 1,082 shapes:

```
generated 881 (81.4%)   refused 201   threw 0
EMPTY full terms 0                       plans with an empty-semester GAP 0 of 881
terms leaving 4+ cells unguided 0        concentration reservations unfillable 0 of 94
terms with 3+ GENERAL ELECTIVES 124 of 6276 (2.0%)   with 2+: 1188 (18.9%)
```

---

## 7. Instruments

- `node scripts/corpus-ask.js --js '…'` — course/requirement questions, ~0.5 s.
  It now awaits its expression, so a question may `await import(...)` a core
  module the vocabulary does not carry; before that such a question printed `{}`
  (a stringified Promise), which reads as "the answer is empty".
- `node scripts/verify-chart.js` — covering sample, exits 3. `--all` for the
  corpus verdict.
- `test/invariant/requirement-credit-corpus.test.js` — the guards above, plus the
  ME&D anchor case and the pick-N tripwire.
