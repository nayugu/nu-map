# Major2 requirement-satisfaction specification

This document specifies how NU Map decides whether a Major2 requirement is
satisfied by a set of placed courses. It is the specification from which
`checkReq`, `checkSection`, and `validateMajor` in
[`src/core/gradRequirements.js`](../src/core/gradRequirements.js) are
implemented.

## Why this document exists

The Major2 requirement vocabulary originates with
[sandboxnu/graduatenu](https://github.com/sandboxnu/graduatenu), which is
licensed under AGPL-3.0. NU Map is also AGPL-3.0, so distribution has never
been in question — but a commercial license under
[`COMMERCIAL.md`](../COMMERCIAL.md) cannot convey rights in another author's
expression. See [`LICENSING.md` §9.1](../LICENSING.md).

This specification was therefore derived **only** from sources NU Map owns or
that are not protectable:

1. **The requirement vocabulary as it appears in NU Map's own program data**
   (`public/northeastern/programs-bundle.json`), enumerated by machine across
   1,006 programs. A data format is a functional specification, not expression.
2. **NU Map's own test suite**
   ([`test/unit/grad-requirements.test.js`](../test/unit/grad-requirements.test.js),
   15 cases), which asserts the required semantics.
3. **The result-tree contract** required by NU Map's own consumers —
   `src/ui/GradPanel.jsx` and `scripts/lib/major-integrity.js`. This shape is
   NU Map's design and has no counterpart upstream.

It was **not** derived from graduatenu's `major2-validation.ts`, which was not
consulted in writing either this document or the implementation.

## Observed vocabulary

Node counts across the shipped program data, with every field observed on each
type:

| Type | Count | Fields |
|---|---|---|
| `COURSE` | 39,138 | `subject`, `classId` |
| `SECTION` | 6,225 | `title`, `minRequirementCount`, `requirements`, `shared` |
| `OR` | 3,369 | `courses` |
| `AND` | 1,992 | `courses` |
| `XOM` | 1,607 | `courses`, `numCreditsMin`, `groups` |
| `RANGE` | 727 | `subject`, `idRangeStart`, `idRangeEnd`, `exceptions` |

`classId` appears as both a number and a string; keys are formed by
concatenation, so both behave alike. `description` is additionally honoured on
`COURSE` where present.

## Canonical course keys

A course is identified by `subject` concatenated with its number, with no
separator: `CS` + `3500` → `CS3500`. The placed set is a `Set` of such keys.

`RANGE` results are the sole exception: their `matched` array carries a **space**
(`"CS 3500"`), because that array is rendered directly. Credit accounting must
therefore strip whitespace before looking a matched entry up in the course map.

## Satisfaction rules

**`COURSE`** — satisfied iff its canonical key is in the placed set.

**`AND`** — satisfied iff *every* child is satisfied. Reports `satCount` and
`total`. An `AND` with no children is satisfied (0 of 0).

**`OR`** — satisfied iff *at least one* child is satisfied. An `OR` with no
children is not satisfied.

**`XOM`** ("X or more") — a credit-hour threshold over a pool, with two cases:

- *Split credit.* Where the pool is exactly one `COURSE`, the requirement is a
  single course cross-counted into this section for partial credit.
  Satisfaction turns only on whether that course was taken. The credit reported
  is the **allotment** (`numCreditsMin`, or the course's own credits if absent),
  never the course's full credit — otherwise a cross-counted course inflates
  totals in every section that lists it.
- *Pool.* Otherwise, sum the credits of every satisfied leaf in the pool and
  compare against `numCreditsMin`. Summation descends the result tree:
  a satisfied `COURSE` contributes its credits; a satisfied `RANGE` contributes
  the credits of every course in its `matched` array; any other satisfied node
  with children contributes the sum over those children. Unsatisfied nodes
  contribute nothing.

`groups` is **not** interpreted at this layer. It carries named display
groupings for "choose from areas" requirements and is consumed only by the
allocation pass (`allocateNode`).

**`RANGE`** — matches every placed course whose subject equals `subject` and
whose number, parsed as a base-10 integer, lies inclusively within
`idRangeStart`…`idRangeEnd`. Courses listed in `exceptions` are excluded.
Courses absent from the course map, or whose number does not parse, are skipped.
Satisfied iff at least one course matches. **Match order follows iteration order
of the placed set**, not catalog order.

**`SECTION`** — satisfied iff the number of satisfied children is **at least**
`minRequirementCount`. Sections nest: a `SECTION` appearing as a requirement is
evaluated by the same rule. Where `minRequirementCount` is absent the section is
not satisfied.

**Unrecognised types** — yield an unsatisfied result carrying the type through,
or `UNKNOWN` where the type is absent. Validation never throws on an unknown
requirement type; a malformed catalogue must not break the planner.

## Result contract

Every result carries `type`, `sat`, and `label`. Compound results carry
`children`. Additionally:

| Type | Extra fields |
|---|---|
| `COURSE` | `key` |
| `AND` | `satCount`, `total` |
| `XOM` | `satSh` (credits satisfied), `reqSh` (credits required) |
| `RANGE` | `matched` (display keys), `subject`, `start`, `end` |
| `SECTION` | `title`, `warnings`, `satCount`, `minRequired`, `total` |

Default credit hours, where a course carries none, are **4**.

Labels are human-readable and rendered directly: `"CS 3500"`, optionally
`": description"`; `"All of (…)"`; `"One of (…)"`; `"N+ SH from pool"`;
`"Any CS 3000–3999"` (en dash). A split-credit `XOM` adopts its single child's
label.

## Out of scope

Allocation — deciding which requirement each placed course is claimed for,
handling `shared` sections, absorbing corequisites, and computing general
electives — is specified by the implementation from `allocateMajor` downward and
is not part of this document. Those functions are independent of the three
specified here.

Allocation used to assign each placed course to **at most one** requirement.
It no longer does, and the distinction is worth stating because it is easy to
carry the old sentence forward: a course now satisfies **every requirement that
NAMES it**, while its **credit** is still claimed exactly once — so it stays out
of General Electives and no `XOM` credit pool may re-spend it. Naming one course
in two sections is the catalog saying that course answers both (International
Business BSIB requires `COOP 3948` outright and also lists it among the seven
options of "Business Experiential Learning"). A pool accumulating toward
`numCreditsMin` is measuring distinct credit and keeps the exclusive rule.

None of this affects `checkReq` / `checkSection` / `validateMajor`, which never
consulted a used set: they answer "is this requirement satisfied by this placed
set", one requirement at a time.
