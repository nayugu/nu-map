# Grades & GPA — design of record (2026-08-02)

Optional, per-course grade entry that powers grade-gated prereqs, GPA
requirements, and failure/retake modelling — while leaving the default
experience byte-identical to a plan with no grades entered.

## The one rule everything follows from

**Unentered = assumed to fulfil everything.** For any computation, a course
with no entered grade behaves as the maximum grade (A, 4.000). The
substitution happens inside the evaluators only — the assumed grade is never
stored, displayed, exported, or shared. With zero grades entered, every gate
passes and every constraint is satisfiable, so the app renders exactly as it
does today: not because the feature is off, but because the arithmetic says so.

Corollary: the feature can never produce a false alarm. It only ever *adds*
warnings, and only in response to a grade the user typed.

## Two independent axes (not one "good/bad grade" scale)

Every symbol answers two separate questions. The corners are all inhabited:

|                    | counts in GPA          | excluded from GPA        |
|--------------------|------------------------|--------------------------|
| **yields credit**  | A … D-                 | S (and transfer credit)  |
| **no credit**      | **F — counts at 0.000**| U, W, X                  |
| **pending**        | —                      | I                        |

- `F` is the only symbol in two boxes at once: no credit, yet 0.000 drags the
  average. The single most important test case.
- `S` earns credit with no quality points. Co-op is S/U, so mishandling this
  distorts nearly every undergrad plan.
- `I` ≠ unentered: registrar policy says I does **not** fulfil prereqs
  ("Grades of F, U, I, X, or W in prerequisite courses do not normally fulfill
  requirements" — undergrad registration policy). It differs from F in *plan
  shape*: an I resolves in place (no re-registration); an F needs a new slot.
- `W` = course effectively not taken. Never renders as a failure.

## Rule shapes found in the wild (all verified against the catalog)

| | Shape | Source | Example |
|---|---|---|---|
| G1 | per-course grade gate | prereq text, ~95% of prereq clauses; 49% gate above D- | "CS 3500 … minimum grade of C-"; NRSG mostly B/C; some gates are "minimum grade of S" |
| G2 | course-set GPA average | program requirement section (a real table) | "grades in ECON 2315/2316/2350/2560 must average to C (2.000)" |
| G3 | subject-scoped GPA | program prose, no table | "minimum cumulative 2.000 GPA in all CS, CY, DS, IS courses" |
| G4 | degree cumulative GPA | university policy | grad ≥ 3.000 |
| G6 | retake limits | per-college policy | undergrad unlimited; Khoury grad ×2; COE grad ×1 ≤8 SH; grad-wide ≤2 courses/6 SH |

Policy facts the model encodes:
- **Retakes are replacement, not accumulation** (registrar): most recent grade
  counts in the GPA (`I` notation); earlier attempts stay but are excluded
  (`E` notation). Credits count once.
- Retaking is allowed for *any* grade ("to earn a better grade"), not only F.
- S/U courses "can be used only to satisfy open electives" (normally outside
  major/minor/NUPath) — a requirements-audit interaction, surfaced as a note.

### The official grade table (verified 2026-08-02)

Found at undergrad → Academic Policies → **"Grade Table and GPA"**
(`student-records-transcripts-related-policies/`). Settles what was open:

- **A = 4.000 is the ceiling. There is no A+.** Full scale matches
  `GRADE_POINTS` exactly (A- 3.667 … D- 0.667, F 0.000).
- **D+, D, D- are "Undergraduate only"** — graduate students cannot earn Ds.
- `S` = "Satisfactory (counts toward total degree requirements)"; `U`
  Unsatisfactory; `I`/`X` Incomplete; `W` Withdrawal; plus admin symbols we
  don't model (IP, NE, NG, L audit, T transfer, AD/AW) and the Law scale
  (HH/H/P/MP/CR).

### Overall and per-college GPA rules (verified 2026-08-02)

**Graduate, university-wide (G4):** cumulative **3.000** to earn any degree
(policy "Minimum GPA"). Every college restates it — Khoury, COE, COS, Mills,
CAMD, Bouvé, CPS all converge on 3.000 cumulative; they differ only in
probation mechanics (Khoury: one semester to recover; COE: probation after
8 SH below, 8 more to recover; CPS: adds a 66%-of-attempted-credits rule;
Bouvé: per-semester 3.000 while on probation) and retake limits (G6).

**Undergraduate:** there is **no published numeric overall graduation GPA**
in the catalog — graduation requires "good standing", which routes through
progression standards (below 1.000 → dismissal at college discretion;
probation is college-run). The 2.000 figures on the degrees-majors-minors
page govern *change of major*, not graduation. Do not invent a 2.000
cumulative constraint for undergrads; the real undergrad rules are the
program-scoped ones below.

**Program-page census** (1,372 cached catalog pages, all phrasings):

| Shape | Count | Example | GPA_CONSTRAINT scope |
|---|---|---|---|
| Unscoped restatement | 74 | "Minimum 3.000 GPA required" (grad) | `cumulative` |
| Subject-scoped | ~35 | "Minimum cumulative 2.000 GPA required in all CS, CY, DS, and IS courses" (4 phrasing variants!), "2.750 … all AMSL, INTP, and DEAF courses", "all JRNL courses" | `subjects: [...]` |
| Program-scoped | 12 | "Minimum 2.000 GPA required in the minor" / "in all minor courses" / "in all major courses" | `program-courses` |
| Course-set average | 21 | "Grades in the following … must average to a minimum of C (2.000)" + table | `courses: [...]` |
| Fuzzy scope | ~7 | "in all business courses", "in anthropology and philosophy courses" | `described` (display only — no mechanical subject resolution; never guess) |

## Architecture

- `src/core/gradeSystem.js` (pure, dependency-free): the symbol table, the two
  axis predicates, `satisfiesGate`, and the set-constraint feasibility solver
  ("you need ≥ C- average in the remaining N courses" / "impossible").
- `evalPrereqTree` gains an optional `takesOf(baseId) → [{fi, grade}]`
  resolver. Absent → the legacy code path, bit-for-bit. Present → a ref is
  satisfied iff **some take** of it placement-satisfies AND grade-satisfies.
  The enum stays `satisfied|order|missing`; the *classification* "blocked by
  grade" is derived at the call site by comparing the grade-aware result with
  the legacy result (legacy satisfied + graded not = grade violation).
- Grades live in PlannerContext as `{placementInstanceId → symbol}`, persisted
  with the plan in localStorage, **excluded from share links** (planShare's
  `_KEYS` allowlist; enforced by test) and from MCP `get_plan`.
- Retakes reuse `repeatInstances` ids (`CS2500#2`). An entered terminal grade
  (anything but I) on a non-repeatable course unlocks one more take instead of
  relocating. A non-repeatable instance id *is* a retake — no flag needed.
  Credits count once per base for non-repeatable courses; the latest take's
  grade is the one that counts (unentered latest = assumed pass).
- G2/G3 become `GPA_CONSTRAINT` entries on the program (`gpaRequirements`),
  not requirement sections — fixing 24 programs that today render a GPA rule
  as "pick 1 of 4 courses" and count it as a satisfiable requirement.
  The verifier must count their tables as consumed (table parity).

## The counter rule (retakes and duplicates)

A take **consumes its slot** unless it definitively failed (`takeConsumesSlot`):
ungraded (assumed pass), any credit-yielding grade, and `I` (resolves in
place) all occupy; **F/U/W hand the slot back**. Consequences, uniformly:

- Nonrepeatable + passed/ungraded → locked, no duplicate can be dragged in.
- Nonrepeatable + all takes failed → takeable again ("the counter resets").
- Repeatable → failed takes don't count against `repeatMax`.
- NEU technically allows retaking a passed course "to earn a better grade";
  the planner deliberately doesn't offer it — no duplicates of earned credit.

## S/U against major/minor/NUPath (policy, verified)

"Satisfactory/unsatisfactory graded courses are normally restricted to
electives outside the major, outside any minor, or outside NUpath
requirements … can be used only to satisfy open electives." Faculty may adopt
S/U for required courses where "pedagogically sound" (co-op). Whether an S
earned *before switching into* a major counts afterward is **not published**
— petition/advisor territory. Therefore: an S sitting in a requirement slot
renders as a soft "may only count as an open elective — ask your advisor"
note (GradPanel, with the GPA-constraint work), never a hard red and never a
silent pass.

## Never do

- Treat the assumed maximum as a displayable GPA. The derived number is a
  feasibility bound; the honest readout is inverted ("you need ≥ X in …").
- Let a missing grade behave differently from today's app in any way.
- Put grades in a share link, QR code, or MCP payload.
- Render W as a failure, or I as satisfied.

## Credit views (semester-hour totals and requirement audits)

Two pure filters implement the registrar's credit rules, both identity when
no grades are entered:

- `dropVoidTakes` — the PROJECTION: F/U/W/X takes are removed (no credit,
  slot refunded); `I` stays (resolves in place, assumed pass). Drives
  `totalSHPlaced` and requirement satisfaction (`placedSet`) — a failed
  course satisfies nothing until its retake instance restores the key.
- `dropUnearnedTakes` — the EARNED view: F/U/W/X **and I** removed (an
  incomplete has earned nothing yet). Drives `totalSHDone` and `doneSet`.

Verified live: F → done/placed both drop; I → done drops, placed holds;
W → both drop; S → both hold (credit, no GPA effect).

Deliberately grade-blind surfaces: the MCP `audit_requirements` (grades
never leave the browser) and the exported report — both documented as
plan-shape audits, not transcript audits.

## Corequisites

No policy links coreq grades — each registration earns its own grade (the
grade table is per-course; the prerequisite policy names only prereq
grades). So grades are NOT shared between coreq partners: fail the lecture,
the lab keeps its own entry. The coreq *placement* warning is unaffected.

## Audit record (2026-08-03) — found & fixed / accepted gaps

Full adversarial audit of the grade layer against policy research and every
consumer. Found and fixed:

1. **NUPath coverage counted failed courses** — an F still lit its NUPath
   tiles. Coverage now runs over `dropVoidTakes`.
2. **Destructive grade pruning** — moving "Now in" backward DELETED grades
   whose semesters stopped being completed. Restructured: `gradesRaw` is
   storage (persists untouched); the app consumes a derived ACTIVE view
   (completed/placed-out takes only). Reversible: grades go dormant and
   return, and an invisible grade still never steers anything.
3. **Substitutions smuggled failed courses back in** — the virtual target
   of a substitution carries its own ungraded id, so dropping voids AFTER
   `applySubstitutions` couldn't remove it. Order fixed in placedSet and
   doneSet: voids drop first, then substitutions re-apply.
4. **IP hardening** — not offered by the dropdown, but if it enters the
   data it now behaves like I (registrar's exclusion list names both).

Accepted gaps, documented deliberately (revisit only with cause):

- **Export report & MCP audits are grade-blind for requirement
  satisfaction** (grades never leave the browser; the export is a
  plan-shape artifact). Asymmetry: their SH numbers ARE grade-aware,
  because they read effectiveCourseMap.
- **S/U in a requirement slot** doesn't yet render its "may only count as
  an open elective — ask your advisor" note (policy verified, UI pending).
- **College retake limits** (Khoury grad ×2, COE ×1/≤8 SH, grad-wide ≤2
  courses/6 SH) are not enforced or flagged — NU Map trusts the user and
  the limits vary by college.
- **Grad-course access GPA gates** (the "3.0 to take Khoury grad courses"
  folk rule): not published in the catalog anywhere — colleges keep them
  on advising sites / petition forms. Not modeled; do not fake it.
- **Co-op eligibility (cumulative 2.000 to search; grad 3.000 at
  application)** — the one published, computable rule not yet surfaced;
  candidate for a soft note on co-op placements.
- **Course-level GPA gates in description prose** — exactly 3 of 7,966
  courses; the description is already visible on the card.
