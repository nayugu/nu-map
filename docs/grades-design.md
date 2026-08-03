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

Unverified (do not hard-code beyond the constant): whether an A+ above 4.000
exists at NEU (no public grading-scale page; assumed **A = 4.000 max**), and
the exact per-college S/U course inventory.

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

## Never do

- Treat the assumed maximum as a displayable GPA. The derived number is a
  feasibility bound; the honest readout is inverted ("you need ≥ X in …").
- Let a missing grade behave differently from today's app in any way.
- Put grades in a share link, QR code, or MCP payload.
- Render W as a failure, or I as satisfied.
