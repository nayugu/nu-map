# PlusOne — what it is, how it works, and where its data lives


> **This document is the reasoning behind a decision, not the reference.**
> For what PlusOne *is* — the rules, the sources, the measurements and the
> known gaps — see **[`plusone.md`](plusone.md)**, which is the single source
> of truth. This file is kept for the argument it records.

Research notes, **2026-08-13**. No implementation. No design decisions yet.

This document exists because PlusOne breaks two assumptions the repo currently
rests on: that the catalog is the authority for program requirements, and that an
undergraduate course and a graduate course are never interchangeable. Both are
false for PlusOne, and the second one is enforced in our code today.

Measurements against the committed corpus (7,966 courses, 3,749 equivalence
pairs, `generatedAt: 2026-08-03`) are marked **measured**. Everything else is
sourced to a page and dated, because most of these pages are marketing pages that
change without notice — one of them says so itself.

---

## 1. The mechanism, in one paragraph

A PlusOne student takes graduate courses **while still an undergraduate**, and
each of those courses is counted **twice**: once against a bachelor's
requirement, once against a master's requirement. Nothing is skipped and no
course is taken faster — the saving comes entirely from the double count. Because
a master's is typically 32 SH and the share cap is ~16 SH, the student arrives at
graduation with about **half the master's already done**, which is why the
marketing line is "one extra year" and "save 50%".

The degrees are still **sequential**: the bachelor's is conferred first, then the
student enrols as a graduate student the following semester. From the catalog,
verbatim:

> Degrees are earned sequentially, with the bachelor's degree attainment followed
> by coursework to complete the graduate degree.

So PlusOne is *not* a combined or dual degree. It is a **credit-sharing
arrangement plus an admissions pathway**, bolted onto two degrees that otherwise
remain exactly what they were.

---

## 2. The single hard university-wide rule

There is exactly one piece of binding, university-wide, catalog-published PlusOne
policy, and it is not on the PlusOne page. It is in
[Course Credit Sharing](https://catalog.northeastern.edu/graduate/academic-policies-procedures/course-credit-sharing/),
verbatim:

> Not more than four graduate courses or 16 semester hours, whichever is greater,
> taken while a student is in undergraduate status and participating in an
> accelerated master's (PlusOne) program at Northeastern, may be used to fulfill
> the requirements for both the undergraduate and graduate degrees. Exceptions to
> this credit sharing limit (due to significantly higher credit requirements for
> the graduate degree or other special provisions) must be approved through
> governance processes.

Three things follow, and the third is the one that matters:

- **"whichever is greater" is not a typo, and the cap is not 16.** Read
  literally, a student may share 4 courses *even if they exceed 16 SH*, or 16 SH
  *even if that takes more than 4 courses*. Both readings are load-bearing in
  practice:
  - Bouvé says explicitly "many courses are 3 credits each so students may take
    up to **five** courses (15 credits) and still double-count them" — the SH
    limb, 5 courses.
  - College of Science advertises "count up to **17** eligible undergraduate
    credits toward a master's degree" — the course-count limb, 4 courses
    totalling 17 SH.
  
  So **"16 credits" is the marketing number, not the rule.** Anything that
  encodes a flat 16 SH ceiling will be wrong for at least two colleges. The real
  constraint is `min` of neither — it is `4 courses OR 16 SH`, satisfied if
  *either* holds.
- **Shared credits may not serve more than two degrees**, and PlusOne-shared
  graduate courses **may not also count toward a graduate certificate**.
- **Transfer credit may not be applied** to a master's earned via PlusOne.

The page the catalog actually titles
[Regulations and Requirements for PlusOne Degree Combinations](https://catalog.northeastern.edu/graduate/academic-policies-procedures/regulations-plusone-degree-combinations/)
contains one sentence of definition and a pointer to the above. That is the whole
of it:

> PlusOne program refers to any program in which students accelerate the
> attainment of the postbaccalaureate degree by applying graduate credits taken
> as an undergraduate toward both the undergraduate and graduate degrees.

---

## 3. Everything else varies by college — including things that look universal

This is the trap. The numbers that get quoted as "the PlusOne rules" are
college-level, and they genuinely conflict. Sourced, and dated where the page
says so:

| Rule | Khoury | COE | Bouvé | CoS | CSSH (History) | CSSH (SCCJ) |
|---|---|---|---|---|---|---|
| Min GPA | 3.0 cum **and in major** | 3.0 overall | 3.0, several prefer 3.5; MPH 3.2–3.7 | 3.0 cum | **3.25** for direct entry | not stated |
| Share cap | 4 courses / 16 SH | "two or four courses", ≤16 SH | ≤16 SH, up to **5** courses | up to **17** SH | 16 SH | 16 SH |
| Grad courses per UG semester | **1** | **2** (per the ChE sheet) | not stated | not stated | **2** | not stated |
| When to apply | advisor by 3rd semester | during the year grad courses begin; **not** in final UG semester | from sophomore year | no earlier than **5th** semester; ≥2 semesters left | before junior year | before junior year, **64 SH** done |
| Extra gate | must pass a grad course *first* | prerequisites complete | advisor-signed Course Review Form | plan of study | — | — |

Notes on the conflicts, because they are the interesting part:

- **"One graduate course per semester" is Khoury-only.** History states two, and
  the COE Chemical Engineering plan-of-study sheet *shows* two graduate courses
  in a single term column. Encoding 1/semester globally would produce false
  errors for most of the university.
- **GPA 3.0 is a floor, not the rule.** History's direct-entry threshold is 3.25;
  Bouvé's MPH runs to 3.7 depending on the undergraduate major.
- **Khoury adds a rule nobody else states**, and it is the most consequential one
  for a planner: *"A student may not take the graduate-level version of a course
  if they have already completed the undergraduate version."* The substitution is
  **mutually exclusive**, not additive.
- **Admission to PlusOne ≠ admission to the master's.** Khoury, verbatim:
  "Admission into the PlusOne program does not guarantee admission into the
  master's program." Several colleges also forbid deferral — you enrol the
  semester after the BS or you lose it.
- **Scholarship interactions are real and negative.** COE auto-applies a 25%
  tuition scholarship; Khoury, CoS and COE all state PlusOne students are
  **ineligible for the Double Husky Scholarship**. CoS also warns undergraduate
  financial aid stops at the transition to graduate status.

---

## 4. The three shapes a double-count takes

This is the core modelling insight, and the reason a single data shape will not
fit. All three are in active use.

**Pattern 1 — course-for-course replacement.** The graduate course *is* the
undergraduate course, one level up. Khoury publishes this as an explicit table;
this is the MS in Computer Science set, verbatim:

| Undergraduate | Graduate replacement |
|---|---|
| CS 2484 | CS 5340 |
| CS 3000 | CS 5800 |
| CS 3200 | CS 5200 |
| CS 3650 | CS 5600 |
| CS 4700 | CS 5700 |
| CS 4100 | CS 5100 |
| CS 4150 | CS 5150 |
| CS 4300 | CS 5310 |
| CS 4400 | CS 5400 |
| CS 4500 / CS 4530 | CS 5500 |
| CS 4520 | CS 5520 |
| CS 4550 | CS 5610 |

The MS in Cybersecurity set adds `CY 4740→CY 6740`, `CY 4770→CY 5120`,
`CS 3700→CS 5700`, `CY 4760→CY 6760`, `CY 4170→CY 5240`, and — note the shape
change — three entries whose left side is not a course at all but *"Cybersecurity
Elective"*, satisfied by `CY 5010`, `CY 5200` or `CY 5210`. So even inside one
table, pattern 1 degrades into pattern 2.

**Pattern 2 — a named graduate course fills a named or *typed* undergraduate
slot.** Bouvé and the College of Science work this way, and the slot is often not
a course:

- `BINF 6200` (4 SH) **replaces the Physics requirement** for BS Behavioral
  Neuroscience;
- `CAEP 6327` (3 SH) "counts for BNS Breadth course (substitute for PHYS 1
  requirement)";
- `BINF 6310` "serves as the biology integrative course";
- `BIOT 5621` + `BIOL 5100` together **replace `CHEM 5620`** — two-for-one, which
  breaks any strict one-to-one substitution model;
- and very often, simply "replaces a general elective".

Note `docs/substitutions-design.md` records that substitutions were deliberately
made **strictly one-to-one** (commit `cfbdf5dd01`). The `BIOT 5621 + BIOL 5100 →
CHEM 5620` case is a real counterexample from a published source, so that
decision would have to be revisited or explicitly scoped out.

**Pattern 3 — anonymous graduate slots.** COE does not name the courses at all.
The Chemical Engineering PlusOne curriculum sheet lays out the plan of study with
four literal placeholders — `Graduate Course #1` … `#4`, 4 SH each — occupying
what were **General Elective 3** and **Advanced Science Elective** slots in the
standard BSChE plan. The actual course is chosen later with the department:
"Graduate electives outside the department curriculum may be applied to the
degree requirements by petitioning the department's graduate committee."

A planner can place pattern 3 without knowing any course id. It cannot check
prerequisites for it, and it should not pretend to.

---

## 5. Inventory — what exists, and how confident I am

**Verified lists.** Bouvé publishes 11 master's targets; College of Science
publishes 8; Khoury publishes 7 pairings; D'Amore-McKim 3 (MS Accounting, MS
Finance, MS International Management — the MBA is *not* a PlusOne). COE and CPS
both publish long lists organised by department rather than as one table. CSSH
publishes per-department pages (Economics, History, SCCJ confirmed) with no
college-level index.

**I did not establish a complete university-wide count**, and I want to be
explicit that I could not: there is no page that lists them all. The obvious
candidate, `plusone.northeastern.edu`, **does not resolve** (DNS failure,
verified) despite being the top search result and being linked from several live
pages. `www.northeastern.edu/plusone` 302s to a ServiceNow registrar KB article
(`KB000020031`) that is **client-rendered and returns no article body** to an
ordinary fetch. Recorded here as the largest hole in this research, it was later
closed from a different direction: the ServiceNow Knowledge API serves the same
article as JSON, and §8a records what it says. The lesson is worth keeping — a
page that renders empty is not the same as a page with nothing in it, and the
first three attempts stopped at the shell.

**Adjacent family members, not to be conflated with PlusOne:**

- **PlusJD** — School of Law, undergraduate → JD, same credit-sharing idea, its
  own catalog page.
- **Professional doctorate sharing** — undergraduate coursework may serve both
  degrees "up to a limit of **40%** of the credits required for the professional
  doctorate", a much larger share than PlusOne's.
- **Bachelor's → PhD sharing**, with a fallback to a master's if the student
  leaves before candidacy.
- **"Accelerated" ≠ PlusOne — all three corpus matches are false positives.**
  The programs in our corpus whose names contain "Accelerated" are
  `nursing_bsn…accelerated_program_for_second-degree_students` (Boston,
  Charlotte), which are second-degree programs, and
  `public_health_mph…accelerated_(boston)`, which I checked directly: it is the
  "MPH—One-Year Accelerated" pathway, *"a full-time, asynchronous"* format that
  *"allows students to complete all degree components in 12 months"*. Its catalog
  page does not contain the string "PlusOne" at all. It is a **delivery-format
  variant, not a credit-sharing arrangement**. So name-matching on "accelerated"
  finds three programs and none of them is PlusOne.

---

## 6. The catalog has no PlusOne data at all — measured

I checked this rather than assuming it, because if the catalog *did* carry it,
the existing major scrapers would already be most of the way there.

The sitemap (1,781 URLs) contains **13** URLs matching `accelerated|plusone`.
Seven are the per-college `accelerated-bachelor-graduate-degree-programs` pages —
one each for CAMD, business, Khoury, COE, Bouvé, CoS, CSSH. I fetched all seven
and measured the `#textcontainer` body:

| College page | body text | tables |
|---|---|---|
| arts-media-design | 1,273 chars | **0** |
| business | 1,417 chars | **0** |
| computer-information-science | 1,271 chars | **0** |
| engineering | 1,262 chars | **0** |
| health-sciences | 1,267 chars | **0** |
| science | 1,258 chars | **0** |
| social-sciences-humanities | 1,281 chars | **0** |

Of those ~1,270 characters, roughly 800 are the shared campus-list and
quick-links furniture. The real prose is **~450 characters**, and six of the seven
are the *same two sentences* with the college name substituted. Business is the
only one that differs, and it differs only by naming the 16 SH figure and linking
out to `damore-mckim.northeastern.edu`.

**Zero tables. No course lists. No pairings. No GPA. No pathway names.** Every
one of the seven ends by linking off-catalog.

Consequences for the pipeline:

- `catalog-program-parser.js` matches `*textcontainer` **+ "has tables"**. These
  pages have no tables, so they are correctly ignored today and would contribute
  nothing if included.
- **PlusOne is the first requirement-shaped data in this project with no catalog
  authority.** CLAUDE.md records "the catalog's Program Requirements pane is the
  single authority" for majors and "there is no Tableau-equivalent for majors" —
  for PlusOne there is no *catalog* equivalent either. The authoritative sources
  are college marketing pages and PDFs.
- Those sources are worse than the catalog in every way that matters: the Bouvé
  PDF states its own expiry ("valid as of October 2024, but is subject to
  change"), the COE curriculum PDFs carry a year in the filename
  (`Plus-ChE_2024.pdf`), and `plusone.northeastern.edu` is already dead. One COE
  policy page only surfaced via a **staging host** (`dev.nucoe.madebyvital.com`).
- The one encouraging find: COE curricula sit at a guessable, stable-looking path
  — `coe.northeastern.edu/wp-content/uploads/pdfs/curricula/PlusOne/Plus-<prog>_<year>.pdf`
  — and parse cleanly with `pypdf`. The Bouvé eligibility PDF also extracts
  cleanly (12 pages, all 11 programs).

I also found **errors in the sources themselves**, which is worth knowing before
trusting any of them: the Bouvé PDF's "All others" block under MS Applied
Behavioral Analysis is a copy-paste of the BS Behavioral Neuroscience block and
still refers to "BNS Breadth" and "BNS Core" requirements that a non-BNS student
does not have; and the same PDF gives `CAEP 6328` two different titles
("Single-case research design" / "Research and Design Methods") and `CAEP 6329`
two ("Ethics for Behavior Analysts" / "Service Administration") on facing lists.

---

## 7. What this collides with in our code — measured

`scripts/lib/equivalence.js` has a veto named `grad-boundary`:

```js
// 6. Undergraduate ↔ graduate is a different degree level, never a swap.
if (crossesGradBoundary(a, b)) out.push("grad-boundary");
```

PlusOne is the sanctioned counterexample to that comment. `CS 3000 ⇄ CS 5800` is
exactly a swap — for a student admitted to PlusOne, and for nobody else.

I took the 18 distinct pairs published in Khoury's two tables and checked them
against the corpus:

- **18 / 18 exist**, both sides, and **every pair is 4 SH ⇄ 4 SH** — so
  `credit-mismatch` never fires and the pairs are structurally clean.
- **17 / 18 are absent from `course-equivalences.json` entirely.**
- The one present, `CY 4170 ⇄ CY 5240`, is **tier D** — "nothing — excluded",
  `offer: false`.

So **0 of 18 published, department-authored PlusOne substitutions are offerable
today.** That is the veto working as designed, on a claim that is true of the
general case and false of this one.

Across the whole file, 206 of 3,749 pairs cross the 5000 line: 205 tier D, 1
tier C.

**The design already has the right hook, and I should not have needed to invent
one.** `docs/substitutions-design.md` §2.1 states "the tier is a property of
(pair, student), not of the pair", and the code comments confirm the stored tier
is deliberately program-agnostic, with program membership applied as a **runtime
upgrade to tier A** by `resolveTier`. PlusOne enrolment is the same kind of fact
as program membership. That is where it belongs — not in a new veto exemption.

### 7.1 A confirmed bug found on the way: the veto leaks through derived rows

`ARCH 3211 ⇄ ARCH 5211` is stored as **tier C** despite crossing the boundary,
and the tier-C branch in `classifyPair` requires `vetoes.length === 0`, which it
cannot satisfy. My first guess was a stale committed output; that is **wrong** —
the JSON commit (`a1ba493628`, 16:19) is 12 minutes *newer* than the tiering
refactor (`5cf2bb3766`, 16:07). The real cause is in
`scripts/build-equivalences.js`, in the derived-bundle block:

```js
if (row.tier === "D" && !row.programBacked) continue;   // line 339
...
const tier = row.tier === "A" ? "A" : row.tier === "B" ? "B" : "C";   // line 361
...
derived.push({ a: ka, b: kb, ...res, tier, offer: true, ... });        // line 372
```

Line 339 lets a **tier-D but program-backed** parent through. Line 361's final
ternary branch then covers `"C"` *and* `"D"`, so that parent's derived row is
emitted as **tier C**. Line 372 hardcodes `offer: true`. The derived row's own
vetoes are computed (`res`) and then overwritten by `tier`.

The corpus confirms it, and the arithmetic is conclusive:

| pair | role | credits | tier | score |
|---|---|---|---|---|
| `ARCH 3210 ⇄ ARCH 5210` | Environmental Systems (parent) | 4 ⇄ 4 | **D** | 48.6 |
| `ARCH 3211 ⇄ ARCH 5211` | Recitation (derived) | **0 ⇄ 0** | **C** | 48.5 |

48.6 − 0.1 = 48.5 is exactly line 371's `row.score - 0.1`, so the child is
provably derived from the vetoed parent.

The result is an inversion worth stating plainly. Today NU Map will tell a student
that two **0 SH recitations** are "often interchangeable — confirm with your
advisor", offerable, while refusing to say anything at all about the 4 SH lecture
pair they belong to — and while excluding all 18 department-published PlusOne
substitutions. The comment at line 358 says the intent is "never let a derived row
outrank tier B"; it does prevent outranking B, but it also silently *promotes* D
to C, which is the case that matters here.

This is **not** a PlusOne bug and it does not affect the 18-pair result above (17
absent, 1 tier D). It is a pre-existing defect in the same code PlusOne would
touch, so it should be fixed on its own terms rather than folded into PlusOne
work. I have not fixed it — a change here needs a regeneration plus the
`RAILS` tier-count checks, which is its own commit.

---

## 8. What I have not verified

Listed plainly, because several of these change what an implementation would look
like:

1. **The registrar's mechanics — partly resolved, see §8a.** `KB000020031` is no
   longer unread: it is served as JSON by the ServiceNow Knowledge API, and it
   settled the approval process, the 14 SH floor on post-bachelor's work, and
   what happens if the master's is abandoned. What it does **not** say is how the
   share is recorded on the degree audit, how a PlusOne student registers for a
   graduate course as an undergraduate (override? special permission?), or **how
   those courses are billed**. CPS says the credits count "at no additional cost"
   and D'Amore-McKim says "undergraduate tuition rates", but no registrar or SFS
   source confirms either.
2. **Whether any of this is in Banner.** Not checked at all. If a PlusOne share
   is invisible to Banner, then it is advisor-and-paperwork only, and NU Map
   could never verify a student's status — only take their word for it.
3. **A complete pathway count.** No index page exists; CAMD's list in particular
   is unconfirmed beyond "CAMD has PlusOne".
4. **CSSH college-wide rules**, if any. I have three department pages that
   disagree with each other on GPA and timing, and no college-level statement.
5. **Whether the 3.0/3.25 GPA gates are checkable from data we hold.** We do not
   hold student GPA, so like the co-op GPA gate this is something we can only
   flag, never evaluate.
6. **The History page's arithmetic.** It reportedly says 16 credits at 4 SH each
   "equates to approximately five courses"; 16/4 is 4. I read this through a
   summarising fetch and have not confirmed the wording verbatim, so I am not
   asserting it is a source error.

---

## 8a. Is there a central source? Measured, 2026-08-13

**No central list of PlusOne programs exists.** Swept the seven university-level
hosts by sitemap — about 4,300 URLs — and the decisive result is negative:

| Host | URLs | PlusOne pages |
|---|---|---|
| `graduate.northeastern.edu` | 2,005 | **0** |
| `catalog.northeastern.edu` | 1,781 | 13 (1 policy + 7 college stubs + 5 false positives) |
| `admissions` | 216 | 0 |
| `www` | 208 | 0 |
| `registrar` | 99 | **1** (the policy article) |
| `undergraduate`, `service` | — | 0 |

`graduate.northeastern.edu` is the strongest negative: it lists every master's
programme the university runs and mentions PlusOne on **none** of them.

### The two central sources that DO exist are policy, not programmes

1. `catalog…/graduate/academic-policies-procedures/course-credit-sharing/`
2. `registrar…/article/plusone-program-accelerated-bachelorgraduate-degree-programs/`
   — the same article as ServiceNow `KB000020031`.

**KB000020031 is machine-readable after all.** The page is client-rendered, which
is why three fetch attempts returned an empty shell and earlier drafts of this
document listed it as unread. The underlying ServiceNow Knowledge API serves it
as JSON with no authentication:

    https://service.northeastern.edu/api/sn_km_api/knowledge/articles/KB000020031

That is the most authoritative PlusOne text found anywhere, and it states three
things **no college page does**:

- **A floor on post-bachelor's work.** "A minimum of **14 semester hours at the
  graduate level (after completion of the undergraduate requirements)** are
  required for the master's degree." Sharing is bounded from *both* ends — the
  16 SH ceiling is only half the rule, and for a smaller master's the floor is
  what actually binds.
- **The cap, framed the other way round.** "A maximum of 16 **undergraduate**
  semester hours of credit may be **waived** via graduate course sharing. Course
  credits waived via any course-credit sharing will be at the undergraduate level
  only." Not "16 graduate hours shared" — 16 undergraduate hours waived.
- **What happens if the master's is abandoned**, which §8 listed as unanswered:
  "If a student decides at some point to pursue only the undergraduate portion…
  **Credit from the undergraduate degree cannot be used toward the graduate
  degree at a later date.**" Leaving is not merely a pause; it forfeits the
  sharing permanently.

It also confirms the transition model behind two graduations: "There is a clear
transition point… beyond which the student will be considered a graduate student
and will then officially transition into graduate status."

### Per-college index pages: all seven exist, none are standardised

Every college publishes one, and no two agree on anything:

| College | Index path |
|---|---|
| Khoury | `/plusone-accelerated-masters-programs/` |
| COE | `/…/graduate-academic-programs/accelerated-masters/` |
| CoS | `/admissions/undergraduate/plusone-accelerated/` |
| CSSH | `/academics/majors-minors-programs/plusone-programs/` |
| Bouvé | `/academics/plusone-accelerated-masters-programs/` |
| CAMD | `/programs-admissions/plusone/` |
| CPS | `/academics/plusone-programs/` |

D'Amore-McKim is the exception: its list is a **client-side filter**
(`?filters[0]=program|type|plus-one`), which is why fetching it returns "No
programs found". Its three programme pages are static and were found directly.

**The standardisation that is real and usable is one level down, inside
engineering:** 26 pages across six hosts share the identical
`Eligible Undergrad Majors | Additional Prerequisites` table. That is what
`scripts/extract-pathways.js` exploits, and it is the only place a scraper gets
structure rather than prose.

### A weakness this exposed in our own classifier

Checking the seven index pages against `_inventory.json` found **3 of 7
misclassified as `pathway`** — CoS, CSSH and Bouvé — because their indexes list
course codes inline and the classifier treats "≥3 course codes plus eligibility
language" as decisive. Some genuine pathway pages are labelled `index` for the
mirror-image reason (sidebar links to sibling pathways, courses held in a PDF).

So **"44 pathway pages" is soft in both directions**, and the coverage figure
built on it is approximate. The fix is not a threshold tweak: an index and a
pathway page differ in whether the courses belong to *one* programme, which the
current signals do not capture.

## 9. The honest summary

PlusOne is simple as a *policy* — one rule, one cap, two degrees in sequence —
and awkward as *data*. It is the first thing in this project that is
requirement-shaped, student-visible, materially expensive to get wrong, and
**not published in the catalog in any structured form**. The detail that a
planner would need lives in a dozen marketing pages and PDFs with expiry dates on
them, in three mutually incompatible shapes, with per-college rules that conflict
on numbers that look universal.

The one thing I would not want lost from this research: **the "16 credits"
everyone quotes is not the rule.** The rule is "four courses *or* 16 semester
hours, whichever is greater", and two colleges already publish numbers — 5
courses, 17 credits — that only make sense under that reading.

---

## Sources

Catalog (authoritative for policy, empty for pathways):
[Course Credit Sharing](https://catalog.northeastern.edu/graduate/academic-policies-procedures/course-credit-sharing/) ·
[Regulations for PlusOne Degree Combinations](https://catalog.northeastern.edu/graduate/academic-policies-procedures/regulations-plusone-degree-combinations/) ·
[Law / PlusJD](https://catalog.northeastern.edu/graduate/law/accelerated/) ·
the seven `accelerated-bachelor-graduate-degree-programs` pages
([CAMD](https://catalog.northeastern.edu/undergraduate/arts-media-design/accelerated-bachelor-graduate-degree-programs/),
[business](https://catalog.northeastern.edu/undergraduate/business/accelerated-bachelor-graduate-degree-programs/),
[Khoury](https://catalog.northeastern.edu/undergraduate/computer-information-science/accelerated-bachelor-graduate-degree-programs/),
[COE](https://catalog.northeastern.edu/undergraduate/engineering/accelerated-bachelor-graduate-degree-programs/),
[Bouvé](https://catalog.northeastern.edu/undergraduate/health-sciences/accelerated-bachelor-graduate-degree-programs/),
[CoS](https://catalog.northeastern.edu/undergraduate/science/accelerated-bachelor-graduate-degree-programs/),
[CSSH](https://catalog.northeastern.edu/undergraduate/social-sciences-humanities/accelerated-bachelor-graduate-degree-programs/))

Colleges:
[Khoury overview](https://khoury.northeastern.edu/plusone-accelerated-masters-programs) ·
[Khoury MSCS](https://www.khoury.northeastern.edu/programs/plusone-program-with-ms-in-cs/) ·
[Khoury MS Cybersecurity](https://www.khoury.northeastern.edu/plusone-with-ms-in-cybersecurity-program-details/) ·
[COE accelerated master's](https://coe.northeastern.edu/academics-experiential-learning/graduate-school-of-engineering/graduate-academic-programs/accelerated-masters/) ·
[COE details & policies (staging host)](https://dev.nucoe.madebyvital.com/academics-experiential-learning/graduate-school-of-engineering/graduate-academic-programs/accelerated-masters/plusone-details-policies/) ·
[COE ChE curriculum PDF](https://coe.northeastern.edu/wp-content/uploads/pdfs/curricula/PlusOne/Plus-ChE_2024.pdf) ·
[MIE → MS ME](https://mie.northeastern.edu/academics/undergraduate-studies/plusone-mece/) ·
[Bouvé overview](https://bouve.northeastern.edu/academics/plusone-accelerated-masters-programs/) ·
[Bouvé course-eligibility PDF](https://bouve.northeastern.edu/wp-content/uploads/2024/10/PlusOne-Double-Counting-Course-Eligibility-2024-10.pdf) ·
[CoS PlusOne index](https://cos.northeastern.edu/admissions/undergraduate/plusone-accelerated/) ·
[CoS Bioinformatics PDF](https://cos.northeastern.edu/wp-content/uploads/2025/08/Bioinformatics-PlusOne-Program_v3.pdf) ·
[CPS](https://cps.northeastern.edu/academics/plusone-programs/) ·
[CSSH Economics](https://cssh.northeastern.edu/economics/program/plusone-program-economics-bs-ms/) ·
[CSSH History](https://cssh.northeastern.edu/history/academics/undergraduate/plusone/) ·
[CSSH SCCJ](https://cssh.northeastern.edu/sccj/academics/plusone/) ·
[D'Amore-McKim Accounting](https://damore-mckim.northeastern.edu/programs/plusone-accounting/)

Dead: `plusone.northeastern.edu` (DNS failure).
Client-rendered, so empty to an ordinary fetch, but readable as JSON through the
ServiceNow Knowledge API (§8a):
[`KB000020031`](https://service.northeastern.edu/api/sn_km_api/knowledge/articles/KB000020031)
· mirrored at
[registrar.northeastern.edu](https://registrar.northeastern.edu/article/plusone-program-accelerated-bachelorgraduate-degree-programs/).
