# PlusOne — the complete reference

**The single source of truth for what PlusOne is, what its rules are, where its
data lives, and what NU Map does with it.** Everything here is either sourced to
a page or measured against the committed corpus, and marked accordingly.

Companion documents, all still current and none duplicated here:

| Document | What it is for |
|---|---|
| `plusone-design.md` | why the engine is shaped the way it is — the four designs considered, the architecture, SOLID/hexagonal reasoning |
| `plusone-intake-design.md` | the five-stage intake pipeline and why extraction stops where it does |
| `plusone-research.md` | the original investigation, kept as the record of how each fact was found |

Measurements taken **2026-08-13** against 7,966 courses and 1,017 programs
(360 undergraduate majors, 485 graduate). Anything unverified says so.

---

# PART I — WHAT PLUSONE IS

## 1. The mechanism

A student takes graduate courses **while still an undergraduate**, and each
counts **twice**: once against a bachelor's requirement, once against a master's.
Nothing is skipped and nothing is taken faster — the entire saving is the double
count. A master's is typically 32 SH and roughly 16 can be shared, so a student
graduates with about half of it already done. That is where "one extra year" and
"save 50%" come from; both are arithmetically true.

The degrees remain **sequential**. From the catalog, verbatim:

> Degrees are earned sequentially, with the bachelor's degree attainment followed
> by coursework to complete the graduate degree.

So PlusOne is **not** a combined or dual degree. It is a *credit-sharing
arrangement plus an admissions pathway*, bolted onto two degrees that otherwise
stay exactly what they were.

The registrar describes the handover precisely:

> There is a clear transition point in the PlusOne program (generally when the
> student has completed the undergraduate curriculum), beyond which the student
> will be considered a graduate student and will then officially transition into
> graduate status. At this point, students will have a graduate transcript for
> the remainder of their program.

## 2. The one idea everything else follows from

**The "double count" is never a double count inside any single audit.**

In the bachelor's audit the graduate course fills one slot, once. In the master's
audit it fills one slot, once. The sharing is only visible when the two audits
are compared. Nobody's credit total is inflated anywhere.

D'Amore-McKim states it as policy, including the precedence:

> Credits counted once, applied to undergraduate degree first.

Consequences: **no new credit arithmetic is needed anywhere**, and any design
that tries to make one audit count a course twice is wrong.

## 3. The substitution is one-way

`CS 5800` satisfies `CS 3000`. `CS 3000` **never** satisfies `CS 5800`.

Khoury sharpens it further — taking the undergraduate version does not merely
fail to substitute, it **forecloses** the graduate one:

> A student may not take the graduate-level version of a course if they have
> already completed the undergraduate version.

---

# PART II — THE RULES

## 4. University-wide, and binding

### 4.1 The sharing cap is a disjunction

From the catalog's **Course Credit Sharing** policy — the only binding,
catalog-published PlusOne rule:

> Not more than four graduate courses **or** 16 semester hours, **whichever is
> greater**, taken while a student is in undergraduate status and participating
> in an accelerated master's (PlusOne) program at Northeastern, may be used to
> fulfill the requirements for both the undergraduate and graduate degrees.
> Exceptions […] must be approved through governance processes.

**"16 credits" is the marketing number, not the rule.** It is
`courses ≤ 4 OR semesterHours ≤ 16` — not `&&`, not `min`. Both limbs are
load-bearing in published practice:

- **Bouvé**: "many courses are 3 credits each so students may take up to **five**
  courses (15 credits) and still double-count them" — passes on the SH limb.
- **College of Science**: "count up to **17** eligible undergraduate credits" —
  passes on the course limb.

A flat 16 SH ceiling is wrong for both.

### 4.2 The registrar's rules, which no college page states

From ServiceNow `KB000020031` — the most authoritative PlusOne text found
anywhere, and readable as JSON (§9.2):

- **A floor on post-bachelor's work.** "A minimum of **14 semester hours at the
  graduate level (after completion of the undergraduate requirements)** are
  required for the master's degree." Sharing is bounded from *both* ends; for a
  smaller master's the floor binds before the ceiling does.
- **The cap, framed inversely.** "A maximum of 16 **undergraduate** semester
  hours of credit may be **waived** via graduate course sharing. Course credits
  waived via any course-credit sharing will be at the undergraduate level only."
- **Abandonment is permanent.** "If a student decides at some point to pursue
  only the undergraduate portion of the combined program, all regular
  undergraduate program and course requirements will apply. **Credit from the
  undergraduate degree cannot be used toward the graduate degree at a later
  date.**"
- Admission is decided by "the appropriate graduate admissions committee",
  against "the academic standards defined for the specific PlusOne program".

### 4.3 Other university-wide limits

- Shared credits may not fulfil the requirements of **more than two** degrees.
- Shared graduate courses **may not also count toward a graduate certificate**.
- **Transfer credit may not be applied** to a master's earned via PlusOne.
- Per COE, graduate coursework beyond 16 SH "cannot transfer to MS, **even if not
  applied to BS**" — so there are in effect **two** 16 SH limits: how much may be
  *shared*, and how much graduate credit taken as an undergraduate may transfer
  to the master's at all.

## 5. Everything else varies by college

The numbers quoted as "the PlusOne rules" are college-level and genuinely
conflict.

| Rule | Khoury | COE | Bouvé | CoS | CSSH |
|---|---|---|---|---|---|
| Minimum GPA | 3.0 cumulative **and in major** | 3.0 | 3.0; several prefer 3.5; MPH 3.2–3.7 by major | 3.0 | **3.25** (History, direct entry) |
| Sharing cap | 4 courses / 16 SH | ≤16 SH | 5 courses / 15 SH | **17 SH** | 16 SH |
| Graduate courses per term | **1** | **2** | not stated | not stated | **2** (History) |
| When to apply | advisor by 3rd semester; a graduate course passed first | not in the final UG semester | from sophomore year | no earlier than 5th semester; ≥2 semesters left | before junior year; **64 SH** (SCCJ) |

**"One graduate course per semester" is Khoury-only.** History states two, and
COE's Chemical Engineering plan-of-study sheet *shows* two in one term. Encoding
it globally would invent errors for most of the university.

Other cross-cutting facts:

- **Admission to PlusOne ≠ admission to the master's.** Khoury: "Admission into
  the PlusOne program does not guarantee admission into the master's program."
- **No deferral** — enrol the semester after the bachelor's or lose the place.
- **Scholarships**: COE auto-applies a 25% tuition scholarship; Khoury, CoS and
  COE all bar PlusOne students from the **Double Husky Scholarship**; CoS warns
  undergraduate financial aid stops at the transition to graduate status.
- **Full-time graduate study** is 8 SH (Khoury), stated elsewhere as "two courses
  per fall/spring".

## 6. The full rule inventory — 88 published rules

Gathered across Khoury (4 pathways), COE (ECE/MIE/CEE/ChE + policy, FAQ, co-op),
Bouvé (11 programmes), CoS (8), CSSH (3 departments), D'Amore-McKim and CPS.

Classified by **what we can know**, which is what decides whether a rule may ever
report a failure: **51 computable · 8 assertable · 18 unknowable · 11 informational**
(84 from the college pages, plus the 4 catalog-only rules below).

**Budgets** — the disjunctive cap; per-college variants; per-concentration SH
sub-budgets over a course domain (ECE: 8–12 SH of non-EECE across 7
concentrations); elective top-up budgets over a subject set (Bouvé pharmacology,
3/5/8/10 SH); withdrawals consuming the budget (Khoury counts them); an external
total-credit target (D'Amore-McKim, the CPA 150-hour rule).

**Membership** — explicit course→course tables; a graduate course filling a named
course, a named requirement, or a typed slot; anonymous graduate slots; a share
set defined by the MS tree itself; mandatory and *conditionally* mandatory
members; choose-k; per-course exclusions (ECE's `EECE 5698/7398/6400`, Bouvé's
`HINF 7701` capstone); subject-domain restrictions; structural partitions (CSSH
Economics: 4 core as UG + 4 electives as grad); track-conditional lists
(D'Amore-McKim Audit vs Tax); cohort-conditional maps (Bouvé BSN has **five**).

**Exclusivity and sequencing** — no graduate version if the UG version is done;
the UG version's prerequisites still apply; the graduate course's own
prerequisites apply; a named course that must come first (`PHSC 5100`,
`HIST 5101`); per-term maxima; earliest term; not in the final UG semester;
minimum credits completed (64 SH SCCJ, 109 SLPA); minimum semesters remaining
(≥2 CoS, ≥3 Marine Biology); entry-term restrictions; hard deadlines, including
one expressed as a **week of term** ("end of the 7th week"); seasonal
availability; post-BS terms that are **summers** (D'Amore-McKim).

**Gates on facts we do not hold** — GPA minima at several scopes at once
(D'Amore-McKim: cumulative 3.0 *and* accounting 3.25); preferred-vs-required GPA;
GPA by undergraduate major; GPA maintenance in a graduate subset; a completed
**co-op** as a prerequisite; a minimum **grade** in named courses ("a B in
INFO 5001, 5002, 5100"); recommendation letters waived above 3.300.

**Gates a person decides** — registration overrides above 5000 level; permission
for out-of-domain electives; advisor/director sign-off; Standard Petitions;
modality restrictions (V35 sections are part-time-graduate only); international
visa compliance; "placement is not guaranteed".

**Catalog-only rules, found 2026-08-13** — four, none of them modelled, and all
four found on ordinary catalog pages rather than any PlusOne page (§9.1):

| Rule | Source | Class |
|---|---|---|
| **Requirement waiver** — MSBioE drops BIOE 6000 and BIOE 7390 for PlusOne students, holding the 32 SH total | `bioengineering-msbioe` footnote | computable |
| **Substitution granted to PlusOne students only** — ME 5250 for ME 5659 if ME 4555 is done | `…mechatronics-msme` footnote | computable |
| **Minor exclusivity** — a minor's courses must be exclusive of those counted for a PlusOne | ~24 CAMD minors | computable |
| **Enrolment gate** — "apply to the MSCS PlusOne program **before enrolling** in CS or CY courses" | `information-technology-bs` | unknowable |

**Downstream** — no deferral; full-time minimum; transfer-credit bars; the
certificate bar; co-op caps across both degrees (COE: 3 total; 1 graduate co-op
if ≤2 undergraduate); graduate co-op sequencing; scholarship eligibility;
tuition rate; MS campus sets; eligibility scoped by concentration; cross-college
advising ownership.

## 7. The three shapes a share takes

All three are in active use, which is why one data shape does not fit.

1. **Course-for-course.** `CS 3000 → CS 5800`. Khoury publishes explicit tables.
2. **A named graduate course fills a named or typed slot.** `BINF 6200` replaces
   *the Physics requirement*; `CAEP 6327` counts as "BNS Breadth". Sometimes
   two-for-one: `BIOT 5621 + BIOL 5100 → CHEM 5620`.
3. **Anonymous slots.** COE's `Graduate Course #1–#4`; CEE's "any graduate course
   that contributes to the MS degree requirements may be shared".

**A published table may list the same graduate course against several
undergraduate targets.** `CS 5500` covers `CS 4500` *or* `CS 4530`. That is an
**alternation** — a choice — not two independent substitutions. Reading it as two
lets one 4 SH course satisfy two requirements (§13.2).

## 8. Eligibility is a rule, not a list

Khoury MSCS, verbatim:

> Students pursuing a Khoury College undergraduate degree program, **in both core
> and combined majors**, are eligible. Students in combined majors with Khoury
> College are eligible **regardless of their home college affiliation**.

**Measured:** that is 66 programmes in the college and 42 whose label contains
"Computer Science", spread across two colleges — **71 of 360** undergraduate
majors in total.

Engineering writes the same idea as a table cell: `BS in Bioengineering (and all
combined majors)`. It works as a **name match** because NEU names a combined
major after both halves — "Chemical Engineering and Bioengineering, BSChE" — and
such a major may be housed in any college.

Three entry shapes, all observed:

| Shape | Source wording |
|---|---|
| `{ ugProgram }` exact id | a single named programme |
| `{ college }` | "a Khoury College undergraduate degree program" |
| `{ nameIncludes }` | "(and all combined majors)", "a computer science combined major" |

Eligibility can also be scoped by **MS concentration** — ECE admits BS Physics to
its Microsystems/Materials/Devices concentration **only** — and engineering
tables attach **per-major prerequisites** (Bioengineering into MS Mechanical
needs `ME 2355`, `ME 2350`; other majors need different ones).

---

# PART III — WHERE THE DATA LIVES

## 9. There is no central list — but the catalog is not empty

Two separate questions, and conflating them cost this project weeks of assuming
the catalog had nothing (§9.1). **There is no central DIRECTORY of PlusOne
programmes.** There *is* catalog-authoritative PlusOne content, scattered.

**Measured**, sweeping the seven university-level hosts by sitemap:

| Host | URLs | PlusOne pages |
|---|---|---|
| `graduate.northeastern.edu` | 2,005 | **0** |
| `catalog.northeastern.edu` | 1,781 | 13 (1 policy + 7 college stubs + 5 false positives) |
| `admissions` | 216 | 0 |
| `www` | 208 | 0 |
| `registrar` | 99 | 1 (the policy article) |
| `undergraduate`, `service` | — | 0 |

`graduate.northeastern.edu` is the decisive negative: it lists **every master's
the university runs** and mentions PlusOne on none of them.

### 9.1 The catalog's *dedicated* PlusOne pages are stubs — but the catalog is not silent

The seven per-college pages — CAMD, business, Khoury, COE, Bouvé, CoS, CSSH —
are **stubs**: ~450 characters of real prose, **zero tables**, and six of the
seven are the same two sentences with the college name swapped.

**That was the whole story until 2026-08-13, and it was wrong.** Searching the
catalog itself (CourseLeaf `/search/?P=PlusOne`) and verifying every hit by
literal string match found **42 of 42 candidate pages genuinely mention
PlusOne** — on *ordinary* programme and department pages, not the dedicated ones.
Ranked by how much they carry:

**Course-level share tables.** `professional-studies/…/information-technology-bs/`
carries an entire *"Concentration in Computer Science"* requirement table
footnoted **"Graduate courses that may be used toward the Master of Science in
Computer Science when part of the PlusOne program"** — a share list, in a catalog
requirement table. The same page carries an application gate ("students must
apply to the MSCS PlusOne program **before enrolling in CS or CY courses**") and
plan-of-study notes ("CS 5002, 4 semester hours recommended for PlusOne
students"; "PlusOne students consult advisor to reach 120 semester hours").

**Requirement waivers and substitutions, as footnotes on the MS page.**

> `bioengineering-msbioe`: "Principles of Bioengineering (BIOE 6000) and Seminar
> (BIOE 7390) are **not required for students in a PlusOne bioengineering
> pathway**, but students must successfully complete a total of 32 semester
> hours."

> `mechanical-engineering-concentration-mechatronics-msme`: "PlusOne students who
> have already successfully completed ME 4555 **may substitute** ME 5250 for
> ME 5659. In such cases a different course must be taken to satisfy the
> mechanics competency."

**Pathway existence and MS targets on the undergraduate programme page.**
`international-business-bsib`: "the program offers the opportunity to earn a
Master of Science in International Management, a Master of Science in Finance, or
a Master of Science in Accounting **through the PlusOne option**." That is the
eligibility mapping, catalog-authoritative.

**Department-level sections with timing.** Economics, English, History and
Political Science each carry a *"PlusOne Program in …"* block — e.g. English:
"majors at the end of their sophomore year or the beginning of their junior year
may qualify… consult the undergraduate program director by the end of the
sophomore year."

**A minor-exclusivity rule, as boilerplate on ~24 CAMD minors.** "A student
pursuing this minor must complete a minimum of four courses exclusive to this
minor **beyond the courses required for the student's declared major(s),
minor(s), or PlusOne**." Low information per page, but a real constraint we do
not model: minor courses must be exclusive of PlusOne courses.

So the accurate claim is narrower and more useful than the old one: **the
catalog has no central PlusOne *directory*, and its dedicated PlusOne pages are
empty — but PlusOne rules are scattered through ordinary programme and
department pages, where they carry catalog authority and the monthly refresh.**

42 is a **lower bound** from a single search, and most of the 42 are the CAMD
boilerplate. The rich pages number roughly eight.

### 9.1a Two of our own pipelines are losing this data

The catalog data above is largely inside pages **we already scrape monthly**, and
two defects stop it reaching us. Both were verified, not inferred.

**Footnotes are being dropped.** `bioengineering_msbioe_(boston)` has
`class="sc_footnotes"` twice on the live page and **zero** footnotes in
`programs-bundle.json`. Sampling eight programmes across eight colleges found
**two with live footnotes and none parsed**, and corpus-wide only **36 of 1,017**
programmes carry any parsed footnote. The MSME Mechatronics footnote *did* survive
— with its course codes extracted — which proves the parser can do it and makes
the loss elsewhere a bug rather than a missing feature.

This matters beyond PlusOne: a footnote is where the catalog puts conditions, and
we are discarding most of them.

**CPS undergraduate programmes are absent entirely.** The bundle holds **88
professional-studies programmes, all graduate** — zero undergraduate. So
`information-technology-bs`, the page with the richest catalog PlusOne content
found anywhere, is not in our corpus at all.

**Why this is the most consequential finding in this document.** The intake design
assumed hand-curation from marketing pages because "the catalog carries no PlusOne
data". For a real subset of pathways that assumption is false, and the catalog
route is strictly better on every axis that matters: it is authoritative, it
refreshes monthly through a pipeline that already exists, it is already verified
by `verify-majors.js`, and it does not rot the way a college marketing page does.
Fixing the footnote parser and adding CPS undergraduates is likely worth more
than transcribing several colleges by hand.

### 9.2 The two authoritative central sources are policy-only

1. `catalog…/graduate/academic-policies-procedures/course-credit-sharing/`
2. `registrar…/article/plusone-program-accelerated-bachelorgraduate-degree-programs/`
   — the same text as ServiceNow `KB000020031`.

The registrar page is **client-rendered** and returns an empty shell to an
ordinary fetch. The ServiceNow Knowledge API serves it as JSON, unauthenticated:

```
https://service.northeastern.edu/api/sn_km_api/knowledge/articles/KB000020031
```

A page that renders empty is not a page with nothing in it — three fetches
stopped at the shell before anyone tried the API behind it.

### 9.3 Per-college index pages: all seven exist, none standardised

| College | Index path |
|---|---|
| Khoury | `/plusone-accelerated-masters-programs/` |
| COE | `/…/graduate-academic-programs/accelerated-masters/` |
| CoS | `/admissions/undergraduate/plusone-accelerated/` |
| CSSH | `/academics/majors-minors-programs/plusone-programs/` |
| Bouvé | `/academics/plusone-accelerated-masters-programs/` |
| CAMD | `/programs-admissions/plusone/` |
| CPS | `/academics/plusone-programs/` |

D'Amore-McKim is the exception — its list is a **client-side filter**, which is
why fetching it reports "No programs found". Its three programme pages are static.

**The only real standardisation is one level down:** 26 engineering pages across
six hosts share an identical `Eligible Undergrad Majors | Additional
Prerequisites` table. That is the sole place a scraper gets structure rather than
prose.

### 9.4 The inventory

Sitemap sweep of the 13 college hosts: **46,383 URLs → 75 candidates**,
classified **44 pathway · 20 index · 6 policy · 4 noise · 1 unfetchable**.

Approximately **75 pathways** exist across the university. **NU Map ships 4.**

Caveat on that denominator: checking the classifier against the seven known
index pages found **3 of 7 misclassified as `pathway`** (CoS, CSSH, Bouvé, whose
indexes list course codes inline), and some genuine pathway pages labelled
`index` for the mirror reason. So "44" is soft in both directions.

### 9.5 Source fragility

Everything outside the two policy pages is a marketing page:

- `plusone.northeastern.edu` — **DNS failure**, though still linked from live pages
- one COE policy page surfaced only on a **staging host**
- Bouvé's course-eligibility PDF states its own expiry ("valid as of October 2024")
- COE curriculum PDFs carry a year in the filename (`Plus-ChE_2024.pdf`)
- CPS `/academics/accelerated-programs/` returns **301 to itself** — a redirect loop

**Known errors in official sources.** Bouvé's PDF has a copy-pasted "All others"
block still naming BNS requirements a non-BNS student does not have, and gives
`CAEP 6328` and `CAEP 6329` two different titles each on facing lists. A faithful
extractor would faithfully encode the error.

### 9.6 Six hosts serve a broken TLS chain

`coe`, `ece`, `mie`, `cee`, `che`, `bioe` present an intermediate that does not
match the leaf's issuer:

```
leaf   CN=binary.coe.neu.edu   issuer: InCommon RSA OV SSL CA 3
chain  server presents:                InCommon RSA Server CA 2   ← wrong CA
```

The chain is **broken, not incomplete**, so `--use-system-ca` cannot repair it.
`curl` on macOS succeeds only because the keychain has the real intermediate
cached — which makes the problem invisible locally and permanent in CI. Fixed by
committing the AIA-published intermediate and setting `NODE_EXTRA_CA_CERTS`
(`scripts/lib/certs/`).

## 10. What is NOT PlusOne

- **"Accelerated" ≠ PlusOne.** All three programmes in our corpus containing
  "Accelerated" are false positives: two second-degree BSN programmes, and the
  MPH "One-Year Accelerated" pathway, whose catalog page does not contain the
  string "PlusOne" at all. It is a *delivery format*, not credit sharing.
- **PlusJD** — undergraduate → JD, same idea, its own catalog page, different limbs.
- **Professional doctorate sharing** — up to **40%** of the doctorate's credits.
- **Bachelor's → PhD sharing**, with a fallback to a master's if the student
  leaves before candidacy.

---

# PART IV — WHAT NU MAP DOES

## 11. The safety property

Rule kinds are classified in code (never in data) by **what we can know**:

| Class | Meaning | May report a failure? |
|---|---|---|
| `computable` | we hold the data and can decide it | **yes** |
| `assertable` | only the student knows (GPA, co-op count) | never |
| `unknowable` | a person decides (advisor, admission) | never |
| `informational` | nothing to decide; just say it | never |

**Only `computable` may ever fail a student**, and the engine *enforces* it: a
`violated` from any other class is downgraded to `unknown`, and throws in strict
mode. Inherited from `core/prereqConditions.js`, whose invariant was written
anticipating exactly this student:

> an undergrad in a combined BS/MS legitimately takes 5000-level courses on
> permission we cannot see, so a note must not manufacture a red card

Nothing ever **blocks**. The student decides; we warn.

## 12. What is built

**Engine** — `src/core/pathway/`, pure, no React or I/O. **20 rule kinds**
(7 computable, 3 assertable, 3 unknowable, 7 informational), **20 evaluators**
behind a registry the engine never switches on, so a new rule is a file plus a
line.

**Port** — `IAcceleratedPathway`, institution-neutral ("PlusOne" is NEU branding
and appears in neither the port nor the core), with a generic no-op adapter so a
fork needs no implementation. The port is **data-only**: an adapter cannot reach
evaluation, because an adapter that could evaluate could override the safety
classification.

**Plan state** — one field, `plusOne`, on the `PLAN_FIELDS` registry (share key
`p1`) so it rides the slot, share link, export and MCP snapshot. Shares are
**derived**, never stored, so a share can *disappear* when the undergraduate
version is taken.

**UI** — a card built on `MajorCard`, ordered by what a student needs:
meter → problems → **courses you can share** → outcome → gates → fine print.
Blocked options stay visible with their reason. The header carries the master's
total; the bar measures the sharing ceiling.

**Intake** — `discover-pathways.js` (sitemap sweep, classify, cache, drift),
`extract-pathways.js` (reads engineering's tables: 14–18 eligible majors per
page), `verify-pathways.js` (the gate).

**Data** — 4 Khoury pathways, each naming its source URL and check date. None
yet drawn from the catalog, which §9.1 shows is a missed source rather than an
absent one.

**Tests** — 183 pathway-specific (115 engine, 49 intake, 19 extraction) inside a
suite of 1,769.

## 13. Bugs found, and what each taught

### 13.1 A vetoed pair laundered through its own components
`build-equivalences.js` promoted a tier-D parent's derived rows to tier C with
`offer: true`. Two 0 SH recitations were offered while their vetoed 4 SH parent
was withheld. **11 pairs** moved C→D. *Pre-existing, not PlusOne's.*

### 13.2 One graduate course satisfied two undergraduate courses
`CS 5500 → CS 4500 / CS 4530` is an alternation; read row-by-row it satisfied
both and counted as 2 courses / 8 SH. **The pathway file carried a note saying
only one could be shared — the note was there and the guard was not.**

### 13.3 A retake counted twice
`CS5800` + `CS5800#2` read as 2 courses / 8 SH. The cap counts *courses*, so the
key must be the course.

### 13.4 Every share showed 0 SH
`shOf` read `credits`, the raw catalog field; the app's courseMap holds courses
normalised to `sh`. **The tests built fixtures from the raw file, so they passed
while the browser showed 0/16.**

### 13.5 Eligibility matched almost nobody
Exact program ids caught **1 of 71** eligible programmes for Khoury MSCS — and
the selector *gated* on it, so real students saw nothing.

### 13.6 Six colleges silently reported zero pages
A swallowed TLS error printed `coe — 0 urls`, which reads as *this college
publishes nothing*. It publishes twelve. **A host we cannot reach must never look
like a host with nothing.**

### 13.7 A false violation from term ordinals
Summers occupy ordinals, so "fall of year two" is the 5th term, not the 3rd — and
it shifts again for a spring entrant. `earliestTerm` was demoted to
stated-not-evaluated.

### 13.8 A PlusOne you could not remove
The ✕ lived in the selector, which hid when no pathway was eligible.

### 13.9 The extractor merged five concentration tables
MIE repeats one generic heading above all five, so their prerequisites were
unioned with no warning — and when the tables listed the same majors, it kept
only the first group, discarding the rest.

**The recurring lesson:** green tests are not evidence. 13.2, 13.3, 13.4 and 13.5
all passed a full suite; four of them were found only by driving the real app or
probing before a push.

## 14. Known gaps

**Correctness gaps in shipped code**

1. **The two 16 SH limits.** `shareCap` models sharing-with-the-bachelor's, not
   transfer-to-the-master's (§4.3).
2. **The 14 SH floor** on post-bachelor's work is not modelled at all (§4.2).

**Two pipeline defects losing catalog data (§9.1a)** — footnotes are dropped
(36 of 1,017 programmes carry one; 2 of 8 sampled had live footnotes and none
parsed), and CPS undergraduate programmes are absent from the corpus entirely.
Both cost us PlusOne rules the catalog already publishes.

**Coverage** — 4 of ~44 pathway pages, and the denominator is soft (§9.4).
Per-major prerequisites and per-concentration eligibility are extracted but the
schema does not yet consume them.

**Unanswered**

- How the share is recorded on the **degree audit**.
- How a PlusOne undergraduate **registers** for a graduate course (override?).
- How shared courses are **billed** — CPS says "no additional cost",
  D'Amore-McKim says "undergraduate tuition rates"; no registrar or SFS source
  confirms either, and `KB000020031` is silent.
- **Whether a PlusOne share is visible in Banner at all.** If not, everything
  here is the student's assertion, and the UI must keep saying so.
- Bouvé's 11 master's targets have only 4 pages; the rest live in a PDF with
  known errors. PDF intake is undesigned.
- No id convention yet for one master's reached from several undergraduate homes
  (`plusone-robo` exists in three departments).

---

## 15. If you read nothing else

1. **"16 credits" is not the rule.** It is `4 courses OR 16 SH, whichever is
   greater`, and there is also a **14 SH floor** on work after the bachelor's.
2. **There is no central list — but the catalog is not empty.** No directory
   exists, and the dedicated PlusOne catalog pages are stubs; yet 42 ordinary
   programme and department pages carry real PlusOne content, including share
   tables and requirement waivers. We drop most of it in our own parser (§9.1a).
3. **Eligibility is a rule, not a list** — "and all combined majors" means a name
   match, and getting this wrong silently denies students their programme.
4. **A published table can list one graduate course against two undergraduate
   targets.** That is a choice, not two shares.
5. **Only what we can compute may fail a student.** GPA, admission and advisor
   approval are things we do not hold and must never pretend to have checked.
