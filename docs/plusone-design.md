# PlusOne — complete design

**Status: design only. No implementation.** Supersedes the first draft of this
file (commit `2962f80994`); the parts that changed are called out in §11.
Companion to `docs/plusone-research.md`, which establishes what PlusOne is and
where its data lives. Measurements were taken against the committed corpus on
**2026-08-13** and should be re-taken, not assumed, after a scrape that changes
the parsers.

---

## 1. The one idea to keep

**PlusOne's "double count" is never a double count inside any single audit.** In
the bachelor's audit the graduate course fills one slot, once. In the master's
audit it fills one slot, once. The sharing is only visible comparing two audits.

D'Amore-McKim states the same thing as policy, and adds the precedence:

> Credits counted once, applied to undergraduate degree first.

Consequences: **no new credit arithmetic anywhere**, and `applySubstitutions` in
[planModel.js:22](../src/core/planModel.js#L22) already implements the
bachelor's side exactly — `{from, to}` means "placing `from` also satisfies
`to`", with credits taken from real placements only.

The substitution arrow is **one-way, graduate → undergraduate**. `CS 5800`
satisfies `CS 3000`; `CS 3000` never satisfies `CS 5800`. This is why the plan's
own `substitutions` field is the right primitive and the **equivalence index is
not** — pairs there are symmetric `{a, b}`, and routing PlusOne through them
would let an undergraduate course claim master's credit. Khoury makes the
one-wayness sharper still: taking the undergraduate version doesn't merely fail
to substitute, it **forecloses** the graduate version.

---

## 2. Rule inventory — the technicalities, and which ones bite

Gathered from Khoury (MSCS, MSDS, MS Cybersecurity, CE→MSCS), COE (ChE
curriculum sheet, ECE, MIE, CEE/SBS, policy page, co-op policy), Bouvé (11
programs, the double-counting PDF), College of Science (8 programs, Bioinformatics
PDF), CSSH (Economics, History, SCCJ), D'Amore-McKim (Accounting), CPS, and the
graduate catalog's Course Credit Sharing policy.

The right-hand column is the design's spine. **C** = computable from data we
hold. **A** = assertable, only the student can tell us. **U** = unknowable, and
must never be evaluated.

### 2.1 Budgets

| # | Rule | Instance | Cls |
|---|---|---|---|
| 1 | Share cap, **disjunctive** | "not more than four graduate courses **or** 16 SH, **whichever is greater**" (university) | **C** |
| 2 | Cap variant — SH limb | Bouvé: 5 courses / 15 SH | **C** |
| 3 | Cap variant — course limb | CoS: **17** SH (4 courses) | **C** |
| 4 | Governance exception to the cap | "must be approved through governance processes" | **U** |
| 5 | **Sub-budget on a course domain, scoped by concentration** | ECE non-ECE SH max: CCSP 8, CSYS 12, CVLA 12, ELPO 8, HSMI 12, MSMD 8, POWR 8 | **C** |
| 6 | Nested breadth cap | ECE: "up to two breadth courses, not to exceed concentration limits" | **C** |
| 7 | Elective top-up budget over a subject set | Bouvé Pharmacology: "up to 3 SH from 5000-level in PHSC, PMLC, PMST, NNMD, BIOL, BIOT, CHEM"; Pharmaceutics 8 SH; Biomedical 10 SH; MedChem 5 SH | **C** |
| 8 | Withdrawals consume the budget | Khoury: "four graduate courses total (**including withdrawals**)" | **C** |
| 9 | External total-credit target | D'Amore-McKim: 134 UG credits, **150 total** (CPA 150-hour rule) | **C** |

### 2.2 Membership of the share set

| # | Rule | Instance | Cls |
|---|---|---|---|
| 10 | Explicit course→course table | Khoury MSCS (12 rows), MSDS (12 rows), MS Cyber (11 rows) | **C** |
| 11 | Graduate course fills a **named** UG course | `BIOT 5621`+`BIOL 5100` → `CHEM 5620` (Bouvé) | **C** |
| 12 | Graduate course fills a **typed slot** | `BINF 6200` "replaces general elective"; CEE: "Technical Elective or General Elective" | **C** |
| 13 | Graduate course replaces a **named requirement** | `CAEP 6327` "BNS Breadth (substitute for PHYS 1 requirement)" | **C** |
| 14 | Anonymous graduate slots | COE ChE sheet: `Graduate Course #1`–`#4` | **C** |
| 15 | **Share set defined by the MS tree itself** | CEE/SBS: "any graduate course that contributes to the MS degree requirements may be shared" | **C** |
| 16 | Left side is a requirement, not a course | Khoury Cyber: "Cybersecurity Elective" → `CY 5010` / `CY 5200` / `CY 5210` | **C** |
| 17 | **Mandatory** share member | CE→MSCS: "all students must take `CS 5010`" | **C** |
| 18 | **Conditionally** mandatory | CE→MSCS: "`CS 5800` if they haven't already completed `CS 3000`" | **C** |
| 19 | **Choose-k** from the table | CE→MSCS: "choose **two**" (vs BSCS's four) | **C** |
| 20 | Per-course exclusion | ECE: `EECE 5698`, `EECE 7398`, `EECE 6400` may **not** count toward the UG degree | **C** |
| 21 | Capstone exclusion | Bouvé MSHI: any MSHI course shareable **except** `HINF 7701` | **C** |
| 22 | Subject-domain restriction | SCCJ: electives outside CRIM/INSH/POLS/PPUA/SOCL need permission | **C**+**U** |
| 23 | Open tail, advisor-determined | Bouvé: "where fewer than four courses are listed, the remaining … in consultation" | **U** |
| 24 | **Structural partition** | CSSH Economics: 4 core **as UG** + 4 electives **as grad** | **C** |
| 25 | Track-conditional share list | D'Amore-McKim: Audit → `ACCT 5255`,`6217`; Tax → `ACCT 6243`,`6292` | **C** |
| 26 | Cohort/co-op-conditional maps | Bouvé BSN: **5 distinct course maps** by 4- vs 5-year plan and co-op schedule | **C** |
| 27 | Concentration excluded entirely | Bouvé MSHI PlusOne is "no concentration option" only | **C** |
| 28 | Soft recommendation | Khoury MSDS: `CS 5800`*, `DS 5110`* "strongly recommended" | **C** (info) |

### 2.3 Exclusivity and sequencing

| # | Rule | Instance | Cls |
|---|---|---|---|
| 29 | **No graduate version if UG version completed** | Khoury, all pathways | **C** |
| 30 | Must meet the **UG version's** prereqs | Khoury | **C** |
| 31 | Graduate course's own prereqs apply | CEE: "prerequisites of all graduate courses must be considered" | **C** |
| 32 | A specific course must be **first** | `PHSC 5100` "must be taken in first semester of PlusOne"; `HIST 5101` first semester | **C** |
| 33 | Max graduate courses **per term** | Khoury **1**; History **2**; COE ChE sheet shows **2** | **C** |
| 34 | Earliest term | Khoury: no grad course in first-year summer; earliest **fall of year 2** | **C** |
| 35 | Not in the final UG semester (application) | COE | **C** |
| 36 | Min credits completed before entry | SCCJ **64 SH**; Bouvé SLPA **109 credits** by the preceding summer | **C** |
| 37 | Min semesters remaining | CoS **≥2**; Marine Biology (Three Seas) **≥3** | **C** |
| 38 | Apply no earlier than Nth semester | CoS: not before the **5th** | **C** |
| 39 | Advisor meeting by Nth semester | Khoury: by the **3rd** | **U** |
| 40 | Entry term restricted | D'Amore-McKim Accounting: **Fall only** | **C** |
| 41 | Hard application deadline | D'Amore-McKim: **Nov 15**; Bouvé: Fall Jun 15–Aug 1, Spring Nov 1–Dec 1, Summer Apr 1 (HINF only) | **C** (info) |
| 42 | Prereq set with a **term deadline** | Accounting: 5 ACCT courses before **Fall senior start**, 3 more before graduation | **C** |
| 43 | Seasonal availability | BINF fall/spring only; many Bouvé courses fall-only or spring-only | **C** |
| 44 | Post-BS terms are **summers** | Accounting: Summer 1 + Summer 2 course lists | **C** |
| 45 | Must complete a graduate course **before applying** | Khoury | **C** |

### 2.4 Gates on facts we do not hold

| # | Rule | Instance | Cls |
|---|---|---|---|
| 46 | GPA minimum, **multiple scopes at once** | Accounting: cumulative **3.0** *and* accounting-coursework **3.25**; Khoury: cumulative *and* in-major 3.0 | **A** |
| 47 | GPA preferred vs required | Bouvé: "3.0 minimum, **3.5 preferred**" (5 programs) | **A** |
| 48 | GPA by undergraduate major | Bouvé MPH: **3.2–3.7** depending on major | **A** |
| 49 | GPA maintenance, graduate subset | Khoury: cumulative 3.0 **in all graduate CS courses** | **A** |
| 50 | GPA gate on MS conferral | COE: 3.0 to remain eligible | **A** |
| 51 | GPA for direct entry | CSSH History: **3.25** | **A** |
| 52 | **Co-op as a prerequisite** | Accounting: "one completed six-month co-op required" | **A** |
| 53 | Registration override to enrol | SCCJ: override required above 5000 level | **U** |
| 54 | Permission for out-of-domain electives | SCCJ | **U** |
| 55 | Advisor / director sign-off | Bouvé Course Review Form; COE Plan of Study Form | **U** |
| 56 | Admission to PlusOne ≠ admission to MS | Khoury, verbatim | **U** |
| 57 | "Placement is not guaranteed" | Khoury CE→MSCS | **U** |

### 2.5 Downstream consequences (after the BS)

| # | Rule | Instance | Cls |
|---|---|---|---|
| 58 | No deferral — enrol the next semester | Khoury, COE | **C** (info) |
| 59 | Full-time graduate minimum | Khoury: **8 SH**; MSDS page: "two courses per fall/spring" | **C** |
| 60 | Transfer credit may not apply to a PlusOne MS | University policy | **C** (info) |
| 61 | Shared courses may not also serve a graduate certificate | University policy | **C** |
| 62 | Extra graduate SH beyond the cap does **not** transfer | COE | **C** (info) |
| 63 | Total co-op cap across both degrees | COE: **3** | **C** |
| 64 | Graduate co-op eligibility depends on UG co-op count | COE: 1 grad co-op if **≤2** UG co-ops | **C** |
| 65 | Graduate co-op sequencing | 1 full-time grad semester (8 SH) **before**; ≥1 academic semester (≥4 SH) **after** | **C** |
| 66 | Co-op shape | 4–8 months, 32+ hrs/week | **C** (info) |
| 67 | Scholarship ineligibility | Double Husky (Khoury, CoS, COE); New Program/Location Launch (COE) | **C** (info) |
| 68 | Automatic scholarship | COE: **25%** applied after add/drop | **C** (info) |
| 69 | UG financial aid ends at graduate status | CoS | **C** (info) |
| 70 | Tuition rate for shared courses | Accounting: "at **undergraduate** tuition rates" | **C** (info) |
| 71 | MS campus set differs by pathway | Khoury CS: Boston/Oakland/Silicon Valley/Seattle; others Boston only | **C** |
| 72 | Eligibility scoped by **concentration** | ECE: BS Physics eligible for **MSMD only** | **C** |
| 73 | Cross-college advising owner | Khoury: combined majors in another college use a "Khoury Secondary Advisor" | **U** (info) |

**73 rules. 48 computable, 8 assertable, 17 unknowable-or-informational.** That
ratio is the design: most of this is real work we can actually do, and a hard
minority must never be evaluated.

---

## 3. What the corpus supports — measured

| Check | Result |
|---|---|
| Graduate program requirements | **485** verified files for 2026, already in `programs-bundle.json` |
| MS CS (Boston) | 32 SH, min GPA 3.000 → 16 shared SH is exactly half |
| Shareable courses satisfying MS requirements | **12/12** (10 named; `CS 5340`, `CS 5310` via `RANGE CS 5100–7980`) |
| Shareable courses existing in the catalog | **56/56** probed across Khoury, Bouvé, CoS, COE, CSSH, D'Amore-McKim |
| Graduate offering data | **57.0%** of 4,297 grad courses vs **59.0%** of UG — parity. Seasonality derivable (`CS 5150` only in `…30` terms) |
| Graduate courses gated on `graduate program admission` | **7 of 56** shareable courses (`CS 5310`, `CY 5240`, `CY 5200`, `CY 5210`, `CHEM 5628`, `CHEM 5676`, `ME 5250`); **209** corpus-wide |
| Timeline extension cost | `buildCohortSemesters` is a pure function of cohort bounds, `numY = max(2, gradYear − startYear + 2)`, no cap → **one parameter** |
| Share-link cost of materializing 13 substitutions | +116 b64 chars vs +20 for deriving; **17.7% of QR v40 capacity** → not a capacity problem |

Two constraints that bind:

- **Substitutions are strictly one-to-one** (commit `cfbdf5dd01`), so rule #11's
  `BIOT 5621 + BIOL 5100 → CHEM 5620` cannot be a substitution.
- **`GradPanel.jsx` is 2,021 lines and not generic over programs** —
  hand-duplicated state, loaders, localStorage keys and section memos for
  `major`/`major2`/`minor1`/`minor2`, and it picks `loadGradMajor` vs `loadMajor`
  from a **per-plan** `isGrad` ([GradPanel.jsx:1366](../src/ui/GradPanel.jsx#L1366)).
  PlusOne needs a *graduate* program loaded inside an *undergraduate* plan, so
  that choice must become **per-slot**.

---

## 4. The model

### 4.1 The universal core

Stripped of every college's decoration, a pathway is:

```
Pathway :  (ugProgram, ugConcentration?) ──▶ (msProgram, msConcentration?, campus)
           with a set of CANDIDATE SHARES
           and a set of RULES
```

and a **share** is:

```
Share :  gradSource ──▶ ugTarget
         gradSource = a named course | a domain (subject/level range)
         ugTarget   = a named course | a named requirement | a slot type
```

That is the whole universal model. Everything in §2 is a **rule over a chosen set
of shares**, not a new kind of structure. This is what makes the design tractable.

### 4.2 What this deliberately is *not*

It is **not a solver.** The temptation is to compute an optimal share set under 73
constraints. Resist it: the repo already has an allocator
(`allocateMajorWithElectives`, `requirementDemand.js`, `reservations.js`) and a
plan generator that is *still unimplemented* (CHART). PlusOne's engine has three
jobs, all cheap:

1. **Enumerate** candidate shares for a pathway — a data lookup.
2. **Validate** the student's active shares against the rules — a pure predicate
   battery returning diagnostics.
3. **Project** the master's side — run the existing `validateMajor` over the MS
   tree with the shared courses as input.

Substitutions feed the *existing* allocator. We add validators, not a solver.

### 4.3 The tri-state contract, which is the safety property

The codebase already settled this, and it did so **anticipating PlusOne**.
`src/core/prereqConditions.js`, verbatim:

> A condition may only ever SATISFY, never violate. Unrecognized or unmet
> conditions are neutral (null), never "missing": **an undergrad in a combined
> BS/MS legitimately takes 5000-level courses on permission we cannot see**, so a
> note must not manufacture a red card.

So every PlusOne rule evaluates to one of:

| Status | Meaning | Used for |
|---|---|---|
| `satisfied` | we checked, it holds | computable rules (**C**) |
| `violated` | we checked, it fails | computable rules only — **flags, never blocks** |
| `unknown` | we cannot know | assertable (**A**) and unknowable (**U**) rules |
| `info` | nothing to check; say it | deadlines, scholarships, tuition |

**A rule classified A or U may never return `violated`.** That single invariant is
what keeps this feature from telling a student something false about their degree,
and it is the one test I would write first.

### 4.4 A one-line correctness fix that falls out

`planConditions(plan)` asserts `grad-admission` only for
`studentType === "graduate"`. A PlusOne student **is** admitted to a graduate
program. Without the fix, placing any of the 7 measured shareable courses that
carry a `graduate program admission` prereq shows a prereq problem we have no
evidence for — precisely the red card the module's invariant forbids.

```js
if (plan?.studentType === "graduate" || plan?.plusOne) met.add("grad-admission");
```

---

## 5. Architecture

Hexagonal, per CLAUDE.md: **UI imports ports only; adapters import core only.**

```
                    ┌───────────────────────────────────────────┐
   UI               │ PlusOnePanel.jsx · PlusOneSlot (Header)    │
   (ports only)     │ usePathway() hook                         │
                    └───────────────┬───────────────────────────┘
                                    │ usePort(IAcceleratedPathway)
                    ┌───────────────▼───────────────────────────┐
   PORT             │ src/ports/IAcceleratedPathway.js          │
   (institution-    │  listPathways · getPathway                │
   neutral)         │  getShareCandidates                       │
                    └───────────────┬───────────────────────────┘
              ┌─────────────────────┴──────────────────┐
              │                                        │
   ┌──────────▼──────────────┐        ┌────────────────▼─────────────┐
   │ adapters/generic/       │        │ adapters/northeastern/       │
   │  acceleratedPathway.js  │        │  acceleratedPathway.js       │
   │  → no pathways (no-op)  │        │  → loads NEU pathway data    │
   └─────────────────────────┘        │  + NEU-only evaluators       │
                                      └────────────────┬─────────────┘
                    ┌──────────────────────────────────▼───────────┐
   CORE             │ src/core/pathway/                            │
   (pure, no I/O)   │  ruleKinds.js      — the vocabulary          │
                    │  evaluate.js       — engine + registry       │
                    │  rules/*.js        — one evaluator per kind  │
                    │  shareSet.js       — active shares, derived  │
                    │  project.js        — MS-side projection      │
                    └──────────────────────────────────────────────┘
```

**"PlusOne" is Northeastern branding, so it does not appear in the port or the
core.** The port is `IAcceleratedPathway`; the NEU adapter maps PlusOne (and later
PlusJD, which has different caps) onto it. This follows the existing pattern
exactly: 18 ports in `src/ports/`, generic fallbacks in `src/adapters/generic/`,
wired by `wire()` and read by `usePort()`.

### 5.1 SOLID, concretely

- **SRP** — one evaluator per rule kind, one file each. `shareCap.js` knows the
  disjunctive cap and nothing else; `noGradIfUgDone.js` knows exclusivity and
  nothing else.
- **OCP** — the engine never switches on rule kind. It looks the kind up in a
  registry:
  ```js
  export const EVALUATORS = { shareCap, subBudget, chooseK, /* … */ };
  ```
  Adding rule #74 means adding a file and a registry line. **The engine does not
  change.** This is the property the whole design exists to buy, because §2 is
  certainly incomplete.
- **LSP** — every evaluator has one signature and one return contract:
  ```js
  /** @returns {Diagnostic} { kind, status, message, evidence } */
  (rule, ctx) => Diagnostic
  ```
  so the engine can run them uniformly and a new kind cannot surprise it.
- **ISP** — do **not** widen `IMajorRequirements`. A separate, narrow port; and
  the port is **data-only**. Evaluation is pure and lives in core, so no adapter
  can accidentally own policy.
- **DIP** — core defines the `Rule` and `Diagnostic` shapes; the adapter supplies
  data conforming to them. `src/core/pathway/` imports nothing from adapters.

### 5.2 The escape hatch, and its leash

Some rules are genuinely institution-specific (ECE's per-concentration non-ECE SH
budgets). Two ways to handle them, and the choice matters:

- **Preferred: express them as data in a generic kind.** ECE's rule is
  `subBudget { domain: {excludeSubject: "EECE"}, maxSH: 8, scope: {concentration: "CCSP"} }`.
  A generic `subBudget` evaluator covers all seven ECE concentrations *and*
  Bouvé's four pharmacology top-ups (#7). One evaluator, eleven published rules.
- **Fallback: a NEU-only evaluator**, registered by the adapter into the same
  registry. Allowed, but it must still return the standard `Diagnostic`, and it
  may not read anything the port doesn't expose.

The leash: **a rule kind with exactly one instance is a smell.** Before adding an
evaluator, check whether an existing kind plus different data covers it. That
check is what turned 73 rules into ~20 kinds.

### 5.3 Derive the share set; do not materialize it

Store `plusOne` (the MS program id) on the plan. **Derive** the substitution list
from pathway data at read time and concatenate with the user's own.

Measured: materializing 13 pairs costs +116 b64 chars vs +20, at 17.7% of QR
capacity — so **this is not a size argument** and I won't pretend it is. The
reasons are:

- **One source of truth.** A materialized copy can disagree with the pathway data
  after a data update.
- **Rule #29 needs withdrawal.** When the student has already taken `CS 3000`, the
  `CS 5800` substitution must *disappear*. Trivial when derived; a sync problem
  when stored.
- **No phantom user state.** The student never opens their substitutions list and
  finds 13 entries they didn't create.

Pre-arming is safe for a reason worth stating: `applySubstitutions` fires only
`if (placements[from])`, so an unplaced substitution is **inert**. Deriving all
candidates has zero effect until a graduate course is actually placed.

---

## 6. Data schema

`data/northeastern/pathways/<college>/<slug>.json`, one file per pathway,
mirroring how programs are stored.

```jsonc
{
  "id": "khoury/ce-to-mscs",
  "brand": "PlusOne",                    // NEU label; core never reads this
  "college": "khoury",

  // Eligibility is (program × concentration), per rule #72.
  "eligibility": [
    { "ugProgram": "2026/engineering/computer_engineering_bsce_(boston)" },
    { "ugProgram": "2026/science/physics_bs_(boston)",
      "requiresMsConcentration": "MSMD" }
  ],

  // MS target is a SET of campus variants, per rule #71.
  "msPrograms": [
    "grad/2026/computer-information-science/computer_science_mscs_(boston)",
    "grad/2026/computer-information-science/computer_science_mscs_(oakland)"
  ],

  "shares": [
    { "grad": "CS 5010", "target": { "kind": "slot", "label": "General Elective" },
      "mandatory": true },                                          // #17
    { "grad": "CS 5800", "target": { "kind": "course", "ref": "CS 3000" },
      "mandatoryUnless": { "completed": "CS 3000" } },              // #18
    { "grad": "CS 5200", "target": { "kind": "course", "ref": "CS 3200" } },
    { "grad": "CS 5600", "target": { "kind": "course", "ref": "CS 3650" } },
    { "grad": null, "gradDomain": { "subject": "CS", "min": 5000, "max": 7980 },
      "target": { "kind": "slot", "label": "Technical Elective" } } // #14, #15
  ],

  "rules": [
    { "kind": "shareCap", "courses": 4, "semesterHours": 16 },      // #1
    { "kind": "chooseK", "k": 2, "from": "optional" },              // #19
    { "kind": "maxGradCoursesPerTerm", "max": 1 },                  // #33
    { "kind": "countWithdrawals" },                                 // #8
    { "kind": "noGradIfUgDone" },                                   // #29
    { "kind": "earliestTerm", "afterTerms": 2, "notSummerOfYear1": true }, // #34
    { "kind": "excludedFromShare", "courses": ["EECE 5698"] },      // #20
    { "kind": "subBudget", "domain": { "excludeSubject": "EECE" },
      "maxSH": 8, "scope": { "msConcentration": "CCSP" } },         // #5
    { "kind": "gpaMin", "min": 3.0, "scopes": ["cumulative", "major"] },   // #46 → A
    { "kind": "admissionNotGuaranteed" },                           // #56 → U
    { "kind": "noDeferral" },                                       // #58 → info
    { "kind": "scholarshipIneligible", "names": ["Double Husky"] }   // #67 → info
  ],

  "notes": [
    { "text": "BIOT 5621 + BIOL 5100 together replace CHEM 5620.",
      "reason": "two-for-one; substitutions are one-to-one" }        // #11
  ],

  "source": { "url": "…", "kind": "html", "retrievedAt": "2026-08-13",
              "contentHash": "…" },
  "confidence": "published"
}
```

**Every rule carries its classification in code, not in data** — `ruleKinds.js`
owns the `C`/`A`/`U` map, so a data author cannot accidentally promote an
unknowable rule into one that can fail a student.

### 6.1 Curated, not scraped — with a leash

The research established there is no catalog source (7 stub pages, ~450 chars of
prose, zero tables). Scraping instead means eight marketing sites plus PDFs where
we already found a dead domain (`plusone.northeastern.edu`), a policy page only
reachable via a **staging host**, a PDF stating its own expiry, and internal
contradictions inside one official PDF. So: curate, and make staleness loud.

- `contentHash` per source; a CI job re-fetches and **fails on change**. It never
  edits data.
- Past a staleness horizon, the UI shows "last verified <date>" rather than
  silently trusting.
- A verifier (§7) refuses to ship a pathway whose courses or programs don't
  resolve.

---

## 7. Code inventory

### New — core (pure, no React, no I/O)

| File | ~LOC | Contents |
|---|---|---|
| `src/core/pathway/ruleKinds.js` | 120 | The ~20 kinds, each with its `C`/`A`/`U` class and required params. The single place the safety classification lives. |
| `src/core/pathway/evaluate.js` | 140 | Engine + `EVALUATORS` registry. Runs rules, returns `Diagnostic[]`. Enforces "A/U may never return `violated`" as an assertion, not a convention. |
| `src/core/pathway/shareSet.js` | 160 | Derives active shares from `plusOne` + pathway + placements; applies #18/#29 withdrawal; emits the `{from,to}` list for `applySubstitutions`. |
| `src/core/pathway/project.js` | 110 | MS-side projection: `validateMajor` over the MS tree with shared courses only; splits before/after graduation. |
| `src/core/pathway/rules/*.js` | ~20 × 40 | One evaluator per kind: `shareCap`, `subBudget`, `chooseK`, `mandatory`, `excludedFromShare`, `noGradIfUgDone`, `maxGradCoursesPerTerm`, `earliestTerm`, `firstSemesterCourse`, `minCreditsBefore`, `minSemestersRemaining`, `seasonal`, `domainRestriction`, `partition`, `coopPrereq`, `gpaMin`, `advisorApproval`, `admissionNotGuaranteed`, `informational`, `totalCreditTarget`. |

### New — port and adapters

| File | ~LOC | Contents |
|---|---|---|
| `src/ports/IAcceleratedPathway.js` | 110 | Port + typedefs (`Pathway`, `Share`, `Rule`, `Diagnostic`). Institution-neutral. |
| `src/adapters/generic/acceleratedPathway.js` | 25 | No-op default: no pathways. Keeps non-NEU wiring working. |
| `src/adapters/northeastern/acceleratedPathway.js` | 180 | Loads `data/northeastern/pathways/**` via `import.meta.glob`, resolves campus variants, registers any NEU-only evaluators. |

### New — UI

| File | ~LOC | Contents |
|---|---|---|
| `src/ui/PlusOnePanel.jsx` | 320 | **Separate panel, not a 5th GradPanel clone.** Share meter (courses/SH against the disjunctive cap), diagnostics grouped by status, the MS projection split before/after graduation, source + `retrievedAt`. |
| `src/ui/PlusOneSlot.jsx` | 120 | The selector below minors; undergrad-only. |
| `src/ui/usePathway.js` | 90 | Hook: reads the port, memoises evaluation. |

### Changed — small and specific

| File | Change |
|---|---|
| `src/core/planSchema.js` | Add `{ name: 'plusOne', share: 'p1' }` — and `plusOneConc` if pathways need the MS concentration. Registry then wires all four doors. |
| `src/core/prereqConditions.js` | `planConditions`: assert `grad-admission` when `plusOne` is set (§4.4). |
| `src/ui/GradPanel.jsx` | Make the `loadGradMajor` vs `loadMajor` choice **per-slot** instead of per-plan `isGrad`. |
| `src/ports/index.js` | Add `acceleratedPathway` to `AdapterOverrides`. |
| `src/adapters/{generic,northeastern}/index.js` | Wire the new port. |
| `src/locales/*.js` (×8) | Panel strings, hand-written. "PlusOne" stays untranslated (proper noun, same rule as "CLAUDE"). |
| `src/adapters/mcp/*` | Expose `plusOne` in the plan snapshot and a `SET_PLUSONE` action; document in `get_meta` actionDocs. Needs a worker redeploy to reach prod. |

### New — scripts and data

| File | ~LOC | Contents |
|---|---|---|
| `data/northeastern/pathways/**` | — | The curated pathways. Khoury first. |
| `scripts/verify-pathways.js` | 220 | Every `ugProgram`/`msProgram` id resolves; every named course exists; `grad` ≥5000 and `target.ref` <5000; each pathway satisfies its own cap; **every share satisfies something in the MS tree** (the check that catches a wrong course number — known to pass 12/12 for Khoury). |
| `scripts/check-pathway-sources.js` | 120 | Re-fetch each `source.url`, compare `contentHash`, fail loudly. CI only; never writes data. |
| `package.json` | — | `data:pathways:verify`, `data:pathways:sources`. |

Roughly **2,400 LOC new**, ~8 files touched. The bulk is 20 small evaluators and
one panel.

---

## 8. Tests — hostile, per the working method

Confirming tests are close to worthless here. The ones that pay:

1. **The safety invariant.** For every rule kind classified `A` or `U`, assert the
   evaluator *cannot* return `violated` — driven off `ruleKinds.js`, so a new kind
   is covered the moment it is registered. This is the first test to write.
2. **The disjunctive cap.** Property test: `courses ≤ 4 || SH ≤ 16`. Must accept
   Bouvé's 5 × 3 SH **and** CoS's 4 × 17 SH, and reject 5 × 4 SH. A `&&` or a
   `Math.min` implementation fails all three.
3. **One-wayness.** Assert no derived substitution ever has an undergraduate
   `from` and a graduate `to`. The bug this prevents is silent and would credit an
   undergraduate course toward a master's.
4. **Inertness.** A pathway declared with all candidates armed and nothing placed
   must produce a plan byte-identical to no pathway at all.
5. **Withdrawal (#29).** Place the UG version, assert the grad substitution
   disappears — and that it comes back if the UG placement is removed.
6. **Every pathway round-trips every door.** Declare, share, export, re-import,
   share-link, MCP snapshot — the `conc2`/`substitutions`/`grades` bug class is
   the repo's most repeated, and `planSchema` exists because of it.
7. **Fixture-driven rule coverage.** One fixture per *published* pathway, asserting
   the parsed rules match the source. Bouvé's known contradictions are encoded as
   `expected-source-error` fixtures so they don't read as our bugs.
8. **Corpus sanity, re-measured not assumed.** All shareable courses exist; all
   MS programs resolve; ≥1 share per pathway lands in the MS tree.

---

## 9. Phasing

| Phase | Deliverable | Gate |
|---|---|---|
| **0** | Fix the derived-row tier bug (`build-equivalences.js:361` promotes tier D → C with `offer: true`; `ARCH 3211/5211`, proven by 48.6 − 0.1 = 48.5). Pre-existing, own commit, `RAILS` re-checked. | — |
| **1** | Port, generic no-op, core engine + registry, ~8 evaluators covering Khoury only, `verify-pathways.js`, Khoury pathway data (4 pathways). Tests 1–5. | Verifier green on all 4 |
| **2** | `plusOne` on `planSchema`; slot below minors; derived one-way substitutions; share meter; diagnostics; `planConditions` fix. Tests 6. | Door round-trip green |
| **3** | MS projection panel, split before/after graduation. | 12/12 still lands |
| **4** | Widen: COE (needs `subBudget`, `excludedFromShare`, per-concentration eligibility), CoS, then Bouvé (needs `partition`, `firstSemesterCourse`, `notes`). Test 7 per pathway. | Per-college |
| **5** | Second graduation: extend `gradYear`, derived per-term phase, two graduation rows, both flags on `PLAN_FIELDS`. | §10 |
| **6** | MCP surface + worker redeploy. | — |

Phases 1–3 are Khoury-only and independently shippable. **Phase 4 is where the
architecture earns its keep** — if adding COE requires touching `evaluate.js`, the
registry design failed and that is the moment to find out.

---

## 10. Two graduations

Cheaper than I claimed in the first draft, and worth correcting: the timeline is
one parameter, because `buildCohortSemesters` is a pure function of the cohort
bounds with no length cap. Extend `gradYear` and the grid follows.

**One plan with two graduations beats two linked plans** — it removes the very
objection I raised against my own earlier phase 4 (cross-plan pointers, a scar
`planFolders.js` explicitly comments on). No pointers, no sync, no dangling
reference when a plan is deleted. Dropping the linked-plans design.

The real work is that graduation is currently singular:

- `gradSemId` is one derived id; `isGraduated` is one boolean
  ([PlannerContext.jsx:241](../src/context/PlannerContext.jsx#L241)).
- `isGraduated` is a raw localStorage boolean and is **not in `PLAN_FIELDS`** — so
  it rides neither share links nor exports today. A second flag added the same way
  inherits exactly the bug the registry was built to stop. **Put both on the
  registry**, which is also the migration the registry's own comment invites.
- Do **not** repurpose `studentType` for the master's year: it is plan-level with
  **278 references**. Add a *derived per-term phase* instead. That is what the
  audit split, the co-op rules (#63–#66) and the full-time minimum (#59) all
  actually need, and it keeps a plan's identity single.

---

## 11. What changed from the first draft

- **The equivalence-index route is gone.** Pairs there are symmetric; PlusOne is
  directional. Use the plan's `substitutions`. (Credit: this was Matthew's catch,
  and it was a real defect, not a preference.)
- **Linked plans are gone**, replaced by one plan with two graduations.
- **"A set of requirements" is now the MS tree**, explicitly split before/after
  graduation, rather than a fifth peer audit that would read as permanent failure.
- **The timeline objection is withdrawn** — measured as one parameter.
- **The QR/size argument is withdrawn** — 17.7% of capacity; deriving is right for
  state-hygiene reasons, not byte reasons.
- **A flat `shares[]` array is gone**, replaced by a rule engine, because §2 found
  73 rules and ECE alone breaks five of the old model's assumptions.

---

## 12. Assumptions, stress-tested

**"The rule inventory is complete."** False, and the design assumes it is false —
that is what the registry buys. Every college added so far introduced a kind the
previous ones didn't: ECE brought sub-budgets and per-concentration eligibility,
Accounting brought co-op-as-prerequisite and two GPA scopes at different
thresholds, CE→MSCS brought conditional mandatory shares and choose-k. **Assume
phase 4 finds more.**

**"Khoury's tables are course-for-course."** Mostly — but three rows of the
Cybersecurity table have "Cybersecurity Elective" on the left, not a course. Even
the cleanest college needs rule #16. A model that only did course→course would
have broken on the first pathway.

**"One pathway per (UG, MS) pair."** False. Bouvé's BSN → MPH has **five course
maps** by cohort and co-op schedule (#26); D'Amore-McKim's share list depends on
Audit vs Tax track (#25). The schema needs variant selection; §6 does not fully
model this yet and it is the largest known schema gap.

**"The MS program is one program."** False — Khoury's CS pathways span four
campuses (#71), and we hold separate files per campus. `msPrograms` is a list.

**"16 SH is the cap."** False, and the most quoted error. It is
`4 courses OR 16 SH, whichever is greater`; Bouvé ships 5 courses, CoS ships 17 SH.

**"We can verify a student is in PlusOne."** No. Unresolved (#2 below), and until
it is, everything is the student's assertion. The tri-state contract is what makes
that safe rather than dishonest.

## 13. Remaining gaps

1. **Variant selection** (#25, #26) is not modelled in §6. Bouvé BSN is the
   worst case at five maps. Needs a `variants[]` with a selector before Bouvé
   ships — a phase-4 blocker, not a phase-1 one.
2. **Is a PlusOne share visible in Banner?** Unchecked. If not, this is
   advisor-and-paperwork only and the UI must never imply verification.
3. **Registrar mechanics** — `KB000020031` is READ (via the ServiceNow API; see
   plusone-research.md §8a). It adds a 14 SH floor on post-bachelor's work that
   `shareCap` does not model. Still unanswered by it:
   Registration overrides (#53) and billing (#70, only sourced from
   D'Amore-McKim) are thinly evidenced.
4. **How many pathways are wildcard** ("all majors", per CPS and Bouvé)? If most,
   the discovery rule needs rethinking — a pathway offered to everyone is noise.
5. **The `chooseK` / `mandatory` interaction** is under-specified where a pathway
   states both (CE→MSCS: `CS 5010` mandatory, `CS 5800` conditional, "choose two"
   — is the total 4, or 2 + 2 mandatory?). The source is ambiguous; ask an
   advisor rather than guess, and until then represent it as `unknown`.
