# Course substitutions and equivalences — design of record

How NU Map decides that two courses are interchangeable, how sure it is, and
what it is allowed to say. Measurements in this document were taken against the
committed corpus on **2026-08-03** (7,966 courses, 1,017 program files, 1,372
cached catalog pages) and should be re-taken, not assumed, after a scrape that
changes the parsers.

Code: `scripts/lib/equivalence.js` (pure, zero-dep) ·
`scripts/build-equivalences.js` (gather + emit) ·
`public/northeastern/course-equivalences.json` (committed output) ·
`test/unit/equivalence.test.js`.

---

## 1. The policy constraint that shapes everything

Every substitution at Northeastern is a **request**, not an entitlement. From
the graduate catalog's course-substitution policy, verbatim:

> Students may request to substitute one course for another to fulfill the
> academic requirements of a program. **If approved**, the substituted course
> will replace the originally designated course to fulfill the program
> requirement. […] Course substitution requests must be reviewed by the
> student's academic advisor in consultation with the director of the student's
> program and the department that offers the original course.

Outside Massachusetts and California it escalates further, to a Request for
Waiver of University-Wide Graduate Requirement filed with the Office of the
Provost. Even the catalog's own program footnotes hedge — the Cornerstone
substitution reads "in approved situations."

Consequences, and they are not negotiable:

- NU Map **never** applies a substitution silently or by default.
- A substitution the student applies is **marked as pending advisor approval**
  unless it is something the catalog already grants outright (tiers A and B).
- Following the project's general principle — the same one used for the co-op
  GPA gate — we **never block** the student. We flag.

## 2. Tiers, not a confidence score

"What can I take instead of PHYS 1151?" has three answers of genuinely different
kinds, and blending them into one number destroys the distinction the student
needs:

| Tier | Evidence | What the UI may say | Offerable | Approval flag |
|---|---|---|---|---|
| **A** | the student's own program publishes the choice (`OR`/`XOM` node), or the catalog states the equivalence outright | "Your program accepts either" | yes | no |
| **B** | cross-listing — same description, same title, small cluster | "Same course, two codes" | yes | no |
| **C** | inference: ≥5 downstream courses accept either as a prerequisite, shared title stem, no veto | "Often interchangeable — confirm with your advisor" | yes | **yes** |
| **D** | weak or vetoed evidence | nothing — excluded | no | — |

The numeric `score` (0–100) orders results **within** a tier. It never decides a
tier. `TIERS` in `equivalence.js` is the machine-readable form of the two right-
hand columns.

### 2.1 The tier is a property of (pair, student), not of the pair

This is the subtlest part of the design and the easiest to get wrong.

Tier A means "a program publishes this choice." Measured: **3,543 pairs are
program-backed, and 2,536 of them — 72% — come from exactly one program.**
`PHYS 1155 ⇄ PHYS 1165` is program-backed solely because the *science writing
minor* lists both. Telling a chemical engineering student "your program accepts
either" on that authority would be false.

So:

- `classifyPair` returns a **program-agnostic** tier: what we can say to a
  student whose program does *not* publish the choice.
- The emitted record carries `e.p`, the list of publishing programs (interned
  slug indices — inline slugs would cost ~300 KB against ~65 KB).
- `resolveTier(pair, mine)` upgrades to tier A **at query time** when the
  student's program is in that list.

`PHYS 1155 ⇄ PHYS 1165` therefore stores as tier C (17 downstream courses, needs
approval) and reads as tier A only for a science-writing-minor student. Both
statements are true; neither is true in general.

## 3. Signals, measured

| # | Signal | Yield | Verdict |
|---|---|---|---|
| 6 | `OR`/`XOM` nodes in program requirements | 3,543 pairs / 1,017 programs | the rule itself; program-scoped |
| 1 | explicit statement in a course description | 7 directed pairs | gold — carries direction *and* scope |
| 3 | cross-listing by identical description | 255 after filtering | good with a cluster cap |
| 7 | bundle propagation from a companion's title | 30 derived pairs | the only route to labs |
| 5 | numbering convention (…01 / …09) | 4 clean pairs | weak prior; **wrong on one case** |
| 4 | prereq-`OR` co-occurrence | 1,926 raw pairs | suggestive; needs vetoes + stem gate |
| 2 | mutual exclusion ("not open to students who…") | 1 pair | effectively absent at NEU |

### 3.1 Signal 1 is small and perfect

Five business courses share one formula:

> ACCT 1209 — "Does not count as credit for business majors. **Counts as
> ACCT 1201 for business minors only.** Requires second-semester-freshman
> standing or above."

`ACCT 1209→1201`, `FINA 2209→2201`, `MKTG 2209→2201`, `ORGB 3209→3201` and
`INTB 1209→**1203**`. That last one matters: the "…09 minus 8" numbering
convention would confidently produce `INTB 1201` and be **wrong**. Statements are
authoritative; numbering is a prior. `parseStatedEquivalences` therefore captures
the target, the direction, the positive scope ("business minors") and the
negative scope ("business majors").

An earlier version of this regex found **zero** statements, because it lacked a
case-insensitive flag and every real statement begins a sentence. The phrase
match is now case-insensitive while the course code must still be uppercase in
the source, so prose like "counts as chemistry 1211" is not read as a reference.

### 3.2 Reaching the labs

NEU registers a science course as separate components, encoding the part in the
units digit with the tens digit selecting the variant:

```
PHYS 115x "for Engineering"        PHYS 116x standard
  1151 lecture  1152 lab            1161 lecture  1162 lab
  1153 seminar                      1163 recitation
```

Labs and recitations essentially never appear in prereq `OR` groups or program
choice tables, so no direct signal reaches them. `companionParent` reads the
parent off the companion's own title ("Lab for PHYS 1151") and a proven lecture
pair propagates to each component, matched by **slot** rather than exact role —
`PHYS 1163` is a *Recitation* where its engineering counterpart `PHYS 1153` is an
*Interactive Learning Seminar*.

### 3.3 Substitutions are strictly one-to-one

Propagation *generates* the lab and recitation pairs; it does not couple them.
Every emitted pair stands alone.

An earlier design grouped them — a lecture swap carried its lab, and a footnote
set rule ("substitute GE 1110 **and** GE 1111 for GE 1501 **and** GE 1502")
applied as a unit. That required head resolution, side orientation, and a
walk-up path for component lookups, and produced a bug at every step: a
cross-product offering "PHYS 1153 as part of PHYS 1161 → PHYS 1171", labs
oriented backwards, one rule rendered as two rows, a click that was a correct
no-op on an already-applied sibling, and a header counting 2 beside a single
visible row. Measured, it covered **31 of 3,749 pairs**.

It is also confusing in use: adding one swap made two appear, and removing one
removed both.

**The cost, and how it is covered.** A set rule can be half-applied — a student
may add `GE 1110 → GE 1501` without `GE 1111 → GE 1502`, and the plan would
count GE 1501 on GE 1110 alone, which the catalog does not grant.

Rather than re-couple the pairs, each one **carries the set it came from** as
metadata (`e.set`). Nothing links behaviourally: adding, removing or applying one
pair still does nothing to the other. But `unmetSetRequirement` can report which
named courses are still unplaced, so the applied row carries a warning and the
suggestion popover names the rest of the rule before it is applied. The plan is
never silently optimistic, and the model stays one that a student can predict:
never block, always flag.

## 4. Rejected signal: "they satisfy the same prerequisites"

The intuitive test — A and B unlock the same downstream courses — was implemented
and **measured to not discriminate**:

```
gate-set Jaccard, true equivalents:  0.67 0.85 0.70 0.79 1.00 0.92 0.90 1.00  → mean 0.85
gate-set Jaccard, NOT equivalent:    1.00 0.82 0.82 0.73 0.86 0.69            → mean 0.82
```

The ranges overlap almost entirely. The **worst** false positive scores a perfect
1.00: `LS 6101` / `LS 6102` are Introduction to Legal Studies **1** and **2** — a
sequence. `PHYS 1151` / `PHYS 1161`, genuinely interchangeable, scores only 0.67.

The failure is structural, so no threshold fixes it: gate-set identity measures
"these two are always listed together," which is equally true of a fixed choice
pool, a course sequence, and real alternatives. Two courses always offered as a
pair have identical gate sets *by construction*. The signal survives only as a
weak positive term (weight 10 of 118) and never decides anything.

## 5. The vetoes, and why tier C depends on them

Positive signals cannot separate an equivalence from a menu. Six cheap negative
checks do (`findVetoes`):

| Veto | Catches |
|---|---|
| `sequence-prereq` | one is a prerequisite of the other → a sequence (`SPNS 2102` / `SPNS 3101`) |
| `sequence-number` | titles advertise different positions (`LS 6101` / `LS 6102`) |
| `role-mismatch` | lecture against lab; **lab-against-lab is allowed** |
| `credit-mismatch` | credit ratio ≤ ½, compared over the **bundle** |
| `generic-shell` | "Topics", "Research", "Project", "Co-op Work Experience" — one boilerplate per subject |
| `grad-boundary` | crossing 5000 (`COP 3945` / `COP 6945`) |

Two details worth keeping:

- **Bundle-aware credits.** `PHYS 1151` is 3 SH against `PHYS 1161`'s 4 SH, which
  reads as a mismatch until the components are counted: 3+1+1 = 5 against
  4+1+0 = 5. Comparing bare lecture credits penalised a genuine pair for a
  packaging artefact.
- **Vetoes apply by tier.** An *inference* veto has no standing against tier A or
  B, which rest on the catalog rather than on us. The two structural vetoes
  (`generic-shell`, `grad-boundary`) do demote tier B, because tier B is itself
  inferred from identical description text and those two describe exactly how
  that inference fails.

### 5.1 The stem gate — the fix for choice pools

Prereq-`OR` evidence alone cannot tell an equivalence from a **menu**. NEU gates
many courses on "any one social science", parsed as
`ANTH 1101 Or SOCL 1101 Or POLS 1160 Or WMNS 1103 Or CRIM 1100 Or HUSV 1101` —
eight subjects, 20–32 downstream courses each, comfortably clearing any evidence
threshold. Same for "any intro statistics"
(`MGSC 2301 / PSYC 2320 / ENVR 2500 / MATH 3081`).

Group **size** is the wrong discriminator: it rejects the ENGW first-year writing
family, six genuine alternatives attested by 224 courses. The right one is
semantic — **a pool is a menu of different things; an equivalence is the same
thing packaged differently**, and that shows in the title. "Peoples and Cultures"
vs "Introduction to Sociology" share nothing; "Physics for Engineering 1" vs
"Physics 1" share their whole stem.

`TIER_C_MIN_STEM = 0.6`, measured: keeps every PHYS/CHEM/ENGW/SCHM pair; drops the
entire social-science and statistics pools, `FINA 3301`/`FINA 3303` (Corporate
Finance vs Investments), and `SPNS 2102`/`SPNS 3102` — a sequence whose matching
"2" suffixes defeat `seqNum`.

Cost: `PHYS 1151 ⇄ PHYS 1171` (8 downstream courses) scores 0.5 because
"engineering" and "bioengineering" are not matched as one token, so it lands in
tier D. Loosening to 0.5 recovers it but readmits four pool pairs. 0.6 is the
better cut; a stemmer that related those two tokens would recover the pair
without the cost.

## 6. Output

`public/northeastern/course-equivalences.json`, ~292 KB, 3,747 pairs, committed
so it is diffable — a new tier-A pair appearing is a review line, not a silent
change.

```jsonc
{
  "generatedAt": "2026-08-03",
  "tierCMinEvidence": 5,
  "counts": { "A": 5, "B": 255, "C": 71, "D": 4387 },
  "programs": ["computer_science_bscs_(boston)", "..."],   // interned slugs
  "pairs": [
    { "a": "PHYS 1151", "b": "PHYS 1161", "t": "C", "s": 61.8,
      "e": { "q": 12, "p": [412] } }
  ]
}
```

Evidence keys: `p` publishing-program indices · `q` prereq-`OR` count ·
`x` cross-list cluster size · `s` statement kind · `d` direction (the "from"
course) · `sc` positive scope · `ex` negative scope.

**Tier D is deliberately not emitted** — except when program-backed, since for a
student in that program it is tier A and dropping it would lose a fact.
Otherwise it is residue like `LS 6101 ⇄ LS 6102`, a sequence; presenting that as
an alternative is worse than showing nothing, and it would roughly double the
payload for negative value.

### 6.1 Write rails

The build runs unattended in three scheduled workflows and pushes straight to
`main`, so it refuses to write when the result looks like upstream breakage
rather than data drift — the same principle as `fetch-nupath`'s 5% mass-clear
rule. Thresholds are in `RAILS`: program-backed pairs ≥ 2,000 (measured 3,543),
tier B ≥ 80 (255), emitted ≥ 2,500 (3,747), program files ≥ 800 (1,017), courses
≥ 5,000 (7,966).

### 6.2 Where it runs

Rebuilt in `update-courses.yml` (after patches, since it reads the finished
catalog) **and** in both `update-majors.yml` / `update-grad-majors.yml`, because
program `OR` nodes are an input and a requirements change can add or remove a
published choice. Missing either would leave the index stale against the data it
cites.

## 7. Deliberately out of scope

- **Inferring equivalences we cannot cite.** Advisors approve the same swaps
  constantly, but that predictability is unsourced, and in the UI an invented
  pair is indistinguishable from a catalog-published one. If we ever want these,
  they need a visibly distinct tier.
- **`reclassify` footnotes** ("Junior/Senior Honors Project 1 will count as a
  4 SH general elective", 22 footnotes / 5 programs). Useful, but a credit-bucket
  feature, not a substitution.
- **`cohort-alt` and `timing-alt` footnotes** (20 footnotes) — entry-cohort
  seminars and co-op scheduling notes, not substitutions.
- **Course descriptions as a source of *substitution prose*.** Searching for
  "substitut" across all courses returns 11 hits, every one chemistry
  ("nucleophilic substitutions") or materials prose. The real description signal
  is "Counts as X" (§3.1), not the word "substitution".

## 8. Known gaps

- `applySubstitutions` in `src/core/planModel.js` is **1:1** (`{from, to}`). The
  Cornerstone rule — `GE 1110` + `GE 1111` → `GE 1501` + `GE 1502` — is 2-for-2
  and cannot be expressed. Needs `{from: [...], to: [...]}` applied atomically,
  with the 1:1 form kept as a degenerate case so saved plans, share links and
  MCP keep working.
- **Program footnotes are not parsed at all.** 384 footnotes across 215 pages,
  ~100 carrying substitution language, 57 unique texts, ~30 programs — including
  the Cornerstone rule. All discarded today. `swap-explicit` (40 footnotes / 14
  programs) is the actionable class.
- The stem gate's `engineering`/`bioengineering` blind spot (§5.1).
- Directional and scoped statements are captured in the data (`d`, `sc`, `ex`)
  but no consumer enforces them yet: `ACCT 1209` counts as `ACCT 1201` **for
  business minors only** and explicitly *not* for business majors.
