# PlusOne — design of record

**Status: design only. No implementation.** Companion to
`docs/plusone-research.md`, which establishes what PlusOne is and where its data
lives (and does not). Measurements here were taken against the committed corpus
on **2026-08-13** and should be re-taken, not assumed, after any scrape that
changes the parsers.

---

## 1. The insight the whole design rests on

**PlusOne's "double count" is never a double count inside any single audit.**

In the bachelor's audit, the graduate course fills exactly one slot, once. In the
master's audit, it fills exactly one slot, once. The sharing is only visible when
you compare two audits side by side. Nobody's credit total is inflated anywhere.

This is worth stating first because the obvious design — "make a course count
twice" — is wrong, and it would require new credit-counting machinery that would
then be wrong everywhere else. Two consequences:

- We need **no new credit arithmetic at all**.
- `applySubstitutions` in `planModel.js` already implements the bachelor's side
  exactly, and needs **zero change**. Its contract, verbatim:

  > A substitution `{ from, to }` means "placing `from` also satisfies `to`": we
  > add a virtual entry placing `to` in the same semester as `from` […] Credits
  > are always taken from the real `placements` only — the virtual entry exists
  > purely for satisfaction and is never counted toward total SH.

  Place `CS 5800`, virtually satisfy `CS 3000`, count 4 SH once. That is
  precisely the PlusOne bachelor's-side semantics, already built and already
  tested.

---

## 2. What the corpus already supports — measured

I checked each of these rather than assuming, because three of them decide
between designs.

| Capability | Result | Why it matters |
|---|---|---|
| Graduate program requirements | **485** files for 2026, verified, already in `programs-bundle.json` (1,017 total: 532 UG + 485 grad) | The master's side is already modelled. We are not building it. |
| MS CS (Boston) shape | `totalCreditsRequired: 32`, `gpaRequirements` min 3.000, 4 sections, 39 course refs | 16 shared SH is *exactly* half of 32 — the "save 50%" claim is arithmetically true, not marketing. |
| Do shareable courses satisfy MS requirements? | **12 / 12** of Khoury's shareable graduate courses land: 10 named directly, and `CS 5340` + `CS 5310` via `RANGE CS 5100–7980` in Electives | A master's-side audit is **feasible today** with the validator we already have. |
| Graduate course offering data | **57.0%** of 4,297 grad courses in `offering-summary.json` vs **59.0%** of 3,669 UG — and **12/12** Khoury targets covered with per-term enrolment/capacity/section counts | Availability for graduate courses is as good as for undergraduate. Seasonality is derivable: `CS 5150` appears only in `…30` (Spring) terms. |
| Substitution primitive | `applySubstitutions({from,to})`, virtual satisfaction, credits counted once | The bachelor's side, already done. |
| Scoped tier upgrade | `resolveTier(pair, mine)` returns tier A when `pair.e.p` intersects the student's programs | The hook for "this swap is real for *you* and nobody else". |
| Plan field registry | `PLAN_FIELDS` in `planSchema.js` wires one field through all four doors (slot, share link, export, MCP) | Adding plan state is cheap and cannot half-land. |

**One correction to an earlier alarm of mine.** I first measured zero graduate
courses with section data and treated it as a blocker. That was wrong: the
`sections` array is empty for *every* course in `catalog-courses.json`, UG and
grad alike (0.0% both), because offering lives in `offering-summary.json`. Grad
and UG coverage there are within two points of each other. No blocker.

**Two constraints that do bind:**

- **Substitutions are deliberately strictly one-to-one** (commit `cfbdf5dd01`,
  "refactor: substitutions are strictly one-to-one"). Bouvé's
  `BIOT 5621 + BIOL 5100 → CHEM 5620` is a real published two-for-one and
  therefore **cannot be expressed** as a substitution.
- **`studentType` is a single field per plan** (`'undergrad' | 'graduate'`), and
  the plan library groups plans by it. A plan is one degree level or the other.
  This is the fact that kills the most tempting design.

---

## 3. Four designs, and why three of them lose

### Design A — one plan, a `plusOne` program slot, timeline extended into the master's year

Add `plusOne` alongside `major`/`major2`, and extend the plan's timeline past
graduation to hold the remaining ~16 SH.

**Why it loses.** The graduate year is *graduate status*, and `studentType` is one
field per plan. Extending the timeline means touching `termWindows`, `semGrid`,
`planStats`, the co-op machinery, `currentSemId` and the "in progress" logic —
each of which assumes a single degree level. That is a very large blast radius
for the *smallest* part of the value: the master's year is planned a year later,
as its own plan. Worse, it would render graduate terms on the canvas of a student
whose admission is explicitly **not guaranteed** — showing a plan for a degree
they may never start.

**What to steal from it:** the audit reuse. Running the existing validator over a
graduate program tree is the good idea here. It does not require the timeline
surgery, and §5 takes it without it.

### Design B — two linked plans (BS ↔ MS) with a shared-course contract

Keep one undergraduate plan and one graduate plan; link them; the MS plan treats
the shared courses as already satisfied.

**Why it loses *as a starting point*.** It is the most faithful model — two
degrees, sequential, separately conferred, which is exactly what the catalog says
— and it is probably where this ends up. But cross-plan pointers are a known scar
in this repo (`planFolders.js` carries a comment about "exactly the failure the
pointer model was chosen to avoid"), a dangling reference appears the moment
someone deletes the bachelor's plan, and it is a lot of machinery to build before
any value ships. Correct destination, wrong first move. Kept as phase 4.

### Design C — bachelor's side only: pathway-scoped substitutions, cap accounting, rule disclosure

No new audit, no timeline change. Ship the pathway data; when a student's major
has a pathway, offer the graduate-for-undergraduate swaps; count them against the
cap; state the rules.

**Why it wins the first slice.** Smallest change, no schema or timeline surgery,
reuses `applySubstitutions` and the tier system wholesale, and degrades honestly —
it never claims master's progress it cannot verify. Its weakness is that it
doesn't answer "what's left for my MS?", which §5 then adds cheaply.

### Design D — joint BS+MS generation in CHART

**Why it loses.** CHART is design-only and unimplemented (`docs/plan-engine-design.md`
says so in its second paragraph). Building PlusOne on top of it makes this feature
depend on vapor. Rejected outright.

### Landing

**C first, then A's audit as a read-only projection, then B only if wanted.** The
phases are independently shippable and each is useful alone — which is the
property that matters most, because phase 1 is the one that can fail.

---

## 4. The data, which is the whole risk

Everything above is cheap. This is the part that can fail, so it goes first and it
gets the most scrutiny.

### 4.1 Curated, not scraped — and why that is not a violation

CLAUDE.md says data fixes must live in the scrape scripts, "never in one-off
migrations — the next scheduled scrape overwrites anything else." That rule exists
because a scrape overwrites manual edits. **There is no scrape here to overwrite
anything** — the research established that the catalog carries zero PlusOne data
(7 stub pages, ~450 chars of prose, zero tables), so no existing pipeline touches
it and none could.

Scraping the real sources instead would mean eight colleges' marketing sites plus
PDFs, where the research already found: a PDF that states its own expiry ("valid
as of October 2024"), a policy page reachable only via a **staging host**, a
canonical domain (`plusone.northeastern.edu`) that **no longer resolves**, and
internal contradictions inside a single official PDF (Bouvé's "All others" block
is a copy-paste still naming BNS requirements; `CAEP 6328` and `CAEP 6329` each
carry two different titles). A scraper over that would be high-effort, fragile,
and would rot silently — the worst failure mode this project has.

So: **a hand-curated, versioned dataset with a drift detector.** ~100 pathways
changing annually is curation-scale. The drift detector is what makes it safe: it
inverts the failure mode from *silently wrong* to *loudly stale*.

- Every pathway carries `source: { url, kind, retrievedAt, contentHash }`.
- A CI job re-fetches each source and compares the hash. A change **fails loudly**
  and opens work; it never edits data.
- A pathway past a staleness horizon renders with a visible "last verified"
  marker rather than being silently trusted.

If curation proves unsustainable, the honest response is to **narrow coverage, not
lower confidence** — see §7.

### 4.2 Pathway schema

The three `replaces.kind` values map one-to-one onto the three shapes the
research found in the wild.

```jsonc
{
  "id": "khoury/bscs-to-mscs",
  "college": "khoury",
  "ugPrograms": ["2026/computer-information-science/computer_science_bscs_(boston)"],
  "msProgram": "grad/2026/computer-information-science/computer_science_mscs_(boston)",

  // The university-wide rule is a DISJUNCTION, not a number. See §4.3.
  "shareCap": { "courses": 4, "semesterHours": 16 },

  "gpa": { "min": 3.0, "scope": "cumulative", "alsoInMajor": true, "preferred": null },
  "perSemesterMax": 1,                     // Khoury 1, History 2, null = unstated
  "applyWindow": { "earliestSemester": 3, "notInFinalSemester": true },
  "rules": ["noGradIfUgCompleted", "noDeferral", "admissionNotGuaranteed", "notDoubleHusky"],

  "shares": [
    // Pattern 1 — course-for-course. The only shape applySubstitutions fits exactly.
    { "grad": "CS 5800", "replaces": { "kind": "course", "ref": "CS 3000" } },

    // Pattern 2 — a named graduate course fills a named or typed UG slot.
    { "grad": "CY 5010", "replaces": { "kind": "requirement", "label": "Cybersecurity Elective" } },

    // Pattern 3 — anonymous slot. Placeable; NOT prereq-checkable. UI must say so.
    { "grad": null, "gradDomain": { "subject": "CS", "min": 5000 }, "count": 4,
      "replaces": { "kind": "slot", "label": "General Elective" } }
  ],

  "notes": [],                             // advisories that are not substitutions
  "source": { "url": "…", "kind": "html", "retrievedAt": "2026-08-13", "contentHash": "…" },
  "confidence": "published"                // "published" | "derived"
}
```

**Two-for-one is out of scope, explicitly.** Bouvé's
`BIOT 5621 + BIOL 5100 → CHEM 5620` goes in `notes` as an advisory, not in
`shares`. Reason: substitutions are one-to-one by a deliberate decision
(`cfbdf5dd01`), and reopening that to serve one published case would weaken a
model that currently holds everywhere. Degrade to less information, not to wrong
information.

### 4.3 The cap is a predicate, not a ceiling

The research's headline correction, restated as code, because this is the single
easiest thing to get wrong:

```js
// "not more than four graduate courses OR 16 semester hours, WHICHEVER IS GREATER"
const withinCap = (shares, cap) =>
  shares.length <= cap.courses || totalSH(shares) <= cap.semesterHours;
```

It is `||`, not `&&`, and not `Math.min`. Both limbs are load-bearing in
published practice: Bouvé advertises **5 courses** (15 SH → passes the SH limb),
College of Science advertises **17 SH** (4 courses → passes the course limb). A
flat 16 SH ceiling is wrong for two colleges.

---

## 5. Behaviour, phase by phase

### Phase 0 — fix the derived-row tier bug (prerequisite, not PlusOne)

`build-equivalences.js:361`'s ternary fallback covers `D` as well as `C`, so a
tier-D-but-program-backed parent's derived row is emitted at tier C with
`offer: true`. Documented in `plusone-research.md` §7.1, proven by score
arithmetic (48.6 − 0.1 = 48.5 for `ARCH 3211 ⇄ ARCH 5211`).

This is pre-existing and **not PlusOne's bug**, but it sits in the exact code
path phase 2 extends, and doing tier work on top of a known tier defect would
make both harder to reason about. Fix and regenerate first, on its own commit,
with the `RAILS` tier-count checks.

### Phase 1 — data, schema, verifier, drift check

The gate. Deliverables: the dataset, a schema validator, and the CI drift job.
Verifier checks that must pass before any UI is built:

- every `ugPrograms` / `msProgram` id resolves in `programs-bundle.json`;
- every named `grad` and `replaces.ref` course exists in `catalog-courses.json`;
- every `grad` course is ≥5000 and every `replaces.ref` is <5000;
- every pathway satisfies its own `shareCap` predicate;
- **each pathway's shares actually satisfy something in the MS tree** — reuse the
  `validateMajor` walk. This is the check that would have caught a wrong course
  number, and it is already known to pass 12/12 for Khoury's set.

### Phase 2 — the bachelor's side

1. **Declare.** New plan field `plusOne` (the MS program id), added to
   `PLAN_FIELDS` with share key `p1`. The registry then wires it through the
   slot, the share link, the export file and the MCP snapshot — which is exactly
   what the registry exists for, and why this is a one-line schema change rather
   than four hand-edits that history says one of us would forget.
2. **Derive the share set; do not store it twice.**
   `shares = substitutions.filter(s => isGradLevel(s.from))` when `plusOne` is
   set. The shared courses *are* substitutions; a second list would be a second
   source of truth and a new way for the two to disagree.
3. **Place and substitute.** Student places `CS 5800`; we record
   `{ from: "CS 5800", to: "CS 3000" }`. The BS audit sees `CS 3000` satisfied;
   4 SH counted once. No new code.
4. **Cap meter.** "3 of 4 courses · 12 of 16 SH shared", using §4.3's predicate.
5. **Mutual exclusion.** Khoury's rule — *"may not take the graduate-level
   version of a course if they have already completed the undergraduate
   version"* — is a **conflict check, not a substitution**. Surface it on the
   existing violations surface. Per project principle: **flag, never block**.
6. **Rule disclosure.** `perSemesterMax`, `applyWindow`, `admissionNotGuaranteed`,
   `noDeferral`, `notDoubleHusky`, and the GPA threshold, shown with the pathway
   and its `retrievedAt`.
7. **GPA: state, never evaluate.** We hold no student GPA. Follow the co-op gate
   precedent exactly — print the threshold, never compute against it, never gate.

**Tier integration — scoped, and the veto stays.** Do **not** weaken or exempt
`grad-boundary`. Instead, emit pathway pairs into the equivalence index with
`e.p` containing the **MS program's** index. Then `resolveTier(pair, mine)`
upgrades them to tier A exactly for a student who has declared that PlusOne, and
leaves them tier D for everyone else — which is the correct answer for everyone
else. This reuses the mechanism `equivalence.js` already documents:

> Tiering on `ev.programs` directly was the first design and it was wrong.
> Measured: 2,536 of 3,525 program-backed pairs are published by exactly ONE
> program, so a global tier A would tell a chemical engineering student "your
> program accepts either" […] on the authority of the science writing minor.

A global tier A for PlusOne pairs would repeat precisely that mistake. Scoping is
not a nicety here; it is the difference between a true statement and a false one.

### Phase 3 — the master's projection (read-only)

Run `validateMajor` over the MS program tree with **only the shared courses** as
placed input. Render: *"You would enter the MS with 16 of 32 SH complete —
Algorithms satisfied, Breadth 8 of 12, Electives 4 of 12."*

No timeline, no graduate terms, no second plan. Measured feasible: 12/12 of
Khoury's shareable courses land in the MS CS tree. This is the bulk of design A's
value at none of its cost.

Two caveats that must appear in the UI, not just here: the projection **assumes
admission**, which is explicitly not guaranteed; and it is computed against
*today's* MS requirements, which are re-scraped bimonthly and can change before
the student gets there.

### Phase 4 — the linked graduate plan (optional)

Design B, once phases 1–3 are real: create a graduate plan seeded with the shared
courses, linked back to the bachelor's plan. Only worth doing if students actually
want to plan the master's year in NU Map, which we have not measured. Do not build
it on speculation.

---

## 6. What this design deliberately does not do

Named so that a later reader inherits the decision rather than re-litigating it:

- **No timeline extension** into graduate terms (§3, design A).
- **No weakening of `grad-boundary`** — pathway pairs get *scoped* standing
  instead (§5, phase 2).
- **No two-for-one substitutions** (§4.2).
- **No GPA evaluation** — we do not hold the input (§5, phase 2.7).
- **No global tier A** for PlusOne pairs (§5, phase 2).
- **No scraper** across eight marketing sites, initially (§4.1).
- **No PlusJD and no professional-doctorate sharing.** Different credit-sharing
  limbs entirely — the professional doctorate allows **40%**, not 4 courses/16 SH.
  Out of scope, and not to be quietly folded in because the URLs look similar.
- **No "accelerated" name matching.** All three programs in our corpus containing
  "Accelerated" are false positives, including the One-Year Accelerated MPH, whose
  catalog page does not contain the string "PlusOne" at all.

---

## 7. The claim I am least sure of, and the honest fallback

Everything above is downstream of one assumption: **that we can keep ~100
hand-curated pathways correct.** That is the weakest load-bearing claim in this
document, and I want to be hardest on it rather than on the easy parts.

The sources are marketing pages and PDFs with expiry dates, one already dead and
one already only on a staging host. Drift detection catches *changes*; it does not
catch a pathway that was transcribed wrong on day one, and it does not create the
time to fix what it flags.

**So the fallback is to narrow coverage, never to lower confidence.** If curation
cannot be sustained, ship **Khoury only**, and say so in the UI. Khoury is the
right vertical slice on the measurements already taken:

- it publishes explicit **course-for-course** tables — pattern 1, the only shape
  `applySubstitutions` fits exactly, with no `notes` escape hatch needed;
- **12/12** of its shareable courses land in the MS CS requirement tree;
- **12/12** carry full per-term offering data;
- **18/18** pairs exist in the corpus at 4 SH on both sides, so `credit-mismatch`
  never fires and the pairs are structurally clean.

By contrast Bouvé — the richest source — is pattern 2/3-heavy, needs the `notes`
escape hatch for its two-for-one, and has **known internal contradictions**. It
is the right *second* target, not the first.

One pathway, fully correct, with its source and date on screen, is worth more here
than eight colleges at "probably". A student planning a degree on a wrong course
number is the expensive failure this project is organised around.

## 8. Open questions that should be answered before phase 2 ships

1. **How many pathways are wildcard** ("all majors", per CPS and Bouvé)? If it is
   most of them, the discovery rule in phase 2.1 needs rethinking — a wildcard
   pathway offered to every student is noise. **Not measured.**
2. **Is a PlusOne share visible in Banner at all?** If not, this is
   advisor-and-paperwork only and NU Map can never verify a student's status, only
   record their claim. Changes how confidently the UI may speak. **Not checked.**
3. **The registrar's mechanics** — `KB000020031` is still unread (client-rendered).
   Registration overrides and billing are unresolved; billing in particular
   affects whether we should say anything about cost at all.
4. **Does anyone want to plan the master's year here?** Gates phase 4. Unmeasured,
   and the project has a track record of ideas that read well and died on contact
   with a measurement — a first-run sample-plan toggle (62% of programs publish
   none), candidate-set intersection (empty 86.7% of the time).
