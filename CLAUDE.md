# NU Map — notes for Claude

## Data pipeline: current vs legacy

Read this before touching anything under `.github/workflows/` or `scripts/` that
updates course data. Two workflows are legacy and easy to mistake for the live path.

| Workflow | Cadence | Role |
|---|---|---|
| `update-courses.yml` | Monthly (1st, 06:00 UTC) | **The main pipeline.** Full catalog scrape of all ~130 subjects — titles, descriptions, credits, prereqs/coreqs — plus **NUPath from Tableau** (`fetch-nupath --tableau` → `merge-nupath`), Banner availability, **primary instructors** (`--prof`), **class-standing restrictions** (`--restrictions`) — each one newest completed term per run, cached forever after, one Banner call per section — offering summary, **term windows** (`derive-term-windows`), and manual patches. Pushes directly to main. |
| `update-majors.yml` | Bimonthly (odd months) | Undergrad program requirements. Scrape → `check-major-integrity` → `verify-majors --report --write` → ratchet → push. |
| `update-grad-majors.yml` | Bimonthly (odd months) | Graduate program requirements, same four steps. |
| `catalog-rotate.yml` | **LEGACY — manual only** | Superseded by the monthly full scrape above. Old design: one subject every 3 days via PR review; its schedule was disabled because GitHub Actions here cannot open PRs. Do not re-enable. |
| `update-nupath.yml` | **LEGACY — manual only** | Superseded by the Tableau step now inside `update-courses.yml`. Its one remaining use: it installs Playwright, so it is the manual escalation path if Tableau's REST and direct-CSV routes both break. Do not schedule it — it would double-write the same data. |

Merged summer terms (AY2026+): NEU retired the 40/60 summer codes; a single
`…50` code carries both sessions, split back into synthetic 40/60 codes by
`partOfTerm` in `scrape-availability.js` (full-summer sections count toward
both and carry a `fullSummer` tag). ⚠ The instructor fetch for a synthetic
summer term (via its merged Banner code) first runs for real in the
September 2026 monthly job — verify that run's log.

Facts that follow from this:

- NUPath designations, descriptions, and prereqs all refresh **monthly** — do not
  describe them as static, manual, or annually updated.
- **NUPath has 13 codes, not 12.** 11 competencies, but competency 9 ("Writing
  Across Audiences and Genres") is awarded as three: `WF`, `WD`, `WI`.
- **Source authority is per field, not a global ranking** (see README → Source
  hierarchy). For NUPath, Tableau is authoritative and the catalog is a fallback;
  for titles/descriptions/prereqs the catalog is authoritative. Two invariants
  live in `scripts/lib/nupath.js` and must not be weakened:
  1. a source may only *remove* a code it can express — the catalog prints 11 of
     13 and never `WF`/`WD`, so its silence there means nothing;
  2. only the authoritative source may remove at all; fallbacks are additive.
  `fetch-nupath` also refuses to write if a run would clear more than 5% of
  courses, so a broken upstream cannot silently empty the catalog.
- The catalog's `Attribute(s):` line is a plain `<p class="courseblockextra">`
  with **no** nupath/attribute class — find it by its label text
  (`findAttributeText`), never by a class selector. A class-based selector
  matched zero blocks and made the catalog contribute no NUPath at all.
- **Term windows are read where possible, estimated only as a fallback.**
  Which semester is "now" — and therefore which courses count as completed —
  comes from `src/adapters/northeastern/termWindows.js`, regenerated monthly
  by `derive-term-windows.js`. Three tiers, in order:
  1. **`pinned`** — Banner publishes about a term ahead, so the semester the
     planner actually cares about usually has a *published* start date. Used
     verbatim + 1 day. This is what makes a shifted calendar a non-event; no
     fit of ordinary years could ever have predicted Spring 2022's 12-day
     COVID delay, but Banner knew it.
  2. **Fall's Labor Day rule** — the Wednesday after Labor Day, exact in 9/9
     measured years, so no statistical margin, just the same +1 day.
  3. **The fitted fallback** — median + 2·MADN over a **rolling 5-year
     window**, for terms past Banner's horizon. MADN (not σ) because one
     COVID year pulls σ from 1.2d to 6.0d and would push the threshold later
     than the hand-picked guess this replaced. Capped so no term is ever
     recognised more than 7 days late.
  Never re-freeze any of this as constants: NU moved Spring to a Wednesday
  start in 2026, and only the rolling derivation noticed.
  The measured guarantee, over 31 terms 2018–2026: recognition lands strictly
  *after* the first class in **27/27 ordinary terms**, by **1 day** when the
  date is known and ≤7 days (mean 2.9) when fitted. Anomalous years are
  discounted by design, not by excuse — that is exactly what MADN buys, and
  the only 3 misses are the COVID terms, which a pinned date would now catch
  anyway. Don't re-tune the thresholds to cover an outlier year: pinning
  Spring to its 2021 date would cost every ordinary year 12 days of lag.
  `isTermPast` is a *separate*, later threshold (start + 14d) about Banner
  enrolment settling after add/drop — do not re-merge the two.
- **"Now" is the most recent term to have BEGUN**, never the one about to.
  With one pointer the break has to be spent on one term or the other, and
  the deliberate choice is that "in progress" is a fact, not a forecast: a
  finished Fall stays current for the 28–31 days of winter break rather than
  Spring being named before anyone attends it. This is the trade, not a bug —
  don't "fix" the lingering by handing off at the old term's end without
  re-deciding it. The guarantee is bounded, not absolute: a threshold fitted
  to ordinary years fires early in one that runs late (Spring 2022 began
  Jan 18 under COVID, 7 days after the threshold). If the lingering ever
  needs fixing, the cheap route is gating the words "in progress"
  (`planModel.js` prints them literally) on the end dates, which already
  exist — not moving the pointer.
- **Class standing is READ from Banner now, not guessed from the level digit.**
  `getRestrictions` publishes the gate the catalog only ever states in prose
  ("Must be enrolled in one of the following Classes: Junior (JR), Senior(SR)").
  Measured over Fall 2025's 7,430 sections: **21–23% carry one**, over a closed
  five-value vocabulary (FR/SH/JR/SR/GR). It matters because the stand-in was
  wrong in both directions, and which way depends on the GATE rather than the
  level: ENGW 3302 (level 3, gated JR) moves 0.22 → 0.50, about 2.2 terms later;
  EECE 4792 (level 4, gated JR) moves 0.67 → 0.50, about 1.4 terms earlier; but
  MEIE 4702 (level 4, gated **SR**) moves 0.67 → **0.75**, i.e. later — a
  senior-only capstone is held back further by the registrar than by the p10 of
  observed placements, which contradicts the obvious summary of the change. Six modules
  carried comments apologising for the gap (`search.js`, `objective.js` ×3,
  `prereqDepth.js`, `chartCalibration.js`). Rules, all in
  `scripts/lib/class-standing.js`:
  1. The scrape stores the **raw per-section tally** (`std: {"JR|SR": 24}`), like
     `days`; the fold lives in `derive-offering-summary`. Folding at capture time
     costs a 29-minute re-scrape per term to revisit.
  2. A course is gated only when **every** section is — PJM 4850 is gated on 1 of
     2, so a student can just take the other one.
  3. Across sections and across terms, take the **most lenient** standing. A gate
     means "the earliest the student could take this at all", not "every section
     admits this". BIOL 4701 carries two different gates across its 7 sections.
  4. **GR is not a rung** on the undergraduate ladder. A master's student takes
     5000-level courses in their first term; mapping GR onto a floor is how they
     get barred from it.
  5. Disagreement → **no gate**, never a guess. A false gate can refuse a plan;
     a missing one only sequences a course early. Same reason `derive-offering-summary`
     refuses to write if >5% of existing gates vanish (a Banner markup change would
     otherwise silently restore the old wrong behaviour).
- **`false` in term-history means "Banner answered and it wasn't there"; absent
  means "we didn't read it".** These were the same value until Aug 2026. Banner
  intermittently answers the first page of `searchResults` with
  `success:true, totalCount:0` — observed twice consecutively on 202530, which
  really has 6,699 sections — and the empty set was stored, writing `false` for
  every course in the term. On the monthly unattended run that silently replaced a
  semester of real history. Only terms that returned sections may produce a verdict
  (`knownTermCodes` in `scripts/lib/term-history.js`); never reintroduce a default
  of `false` for a term that failed to read.
- The runtime file is `public/northeastern/catalog-courses.json` (browser app,
  Node MCP server, and Cloudflare worker all load it). `all-courses.json` is the
  scrape intermediate; `merge-nupath.js` backfills nuPath from it at build time.
- Data fixes must live in the scrape scripts (both undergrad and grad paths),
  never in one-off migrations — the next scheduled scrape overwrites anything else.
- The legacy `external/` git submodules (graduatenu, nu-courses, searchneu) were
  removed in July 2026 — our scrapers are the sole data source, and the
  `nayugu/*` forks backing them are deleted from GitHub. Never reintroduce a
  submodule data path; `git submodule update` on pre-removal commits cannot work.

## Major/minor requirements

- **There is no Tableau-equivalent for majors.** Verified 2026-08-02 and
  recorded in `scripts/lib/major-verify.js`: Banner has no program/degree
  endpoints (404), Degree Works and CourseLeaf CIM are SSO-gated, the per-page
  PDF is the same render as the HTML, and `sandboxnu/graduatenu` is GPL-3.0
  (incompatible with the Option B commercial licence) with known errors. The
  catalog's Program Requirements pane is the single authority. Don't re-hunt.
- Both scrapers share `scripts/lib/catalog-program-parser.js` for parsing and
  `scripts/lib/program-record.js` for building records — the latter because the
  two scripts used to carry a byte-identical `scrapeProgram`, which is how a
  data fix lands in one path and not the other. Requirement tables live under
  **27 different container ids** including NEU's own typos, 52 pages spread them
  across more than one pane, and the Sample Plan of Study pane is excluded
  deliberately. Match `*textcontainer` + "has tables"; never hard-code
  `programrequirementstextcontainer`.
- **One page can be more than one PROGRAM** — see `docs/program-variants.md`.
  NEU publishes variants either as separate URLs (campus) or as a second
  requirement pane on one page (advanced entry, part-time, exchange). The
  scrapers used to flatten the second kind into the primary program, which cost
  **159 phantom requirement sections across 35 programs**, gave 42 pages the
  wrong credit total (Electrical Engineering PhD is 48 SH by standard entry and
  16 SH by advanced entry, and both shipped as 48), duplicated three whole
  concentration menus, and left ~36 variant programs unreachable. Rules:
  1. Panes are adjudicated by hand in `scripts/lib/program-variants.js`. An
     unadjudicated pane is a **hard scrape failure**, never a default merge —
     that hard stop *is* the fix. Do not add a fallback.
  2. Do not replace the table with a classifier. Both obvious ones were built
     and measured: heading overlap misfiles 8 real advanced-entry variants
     (Cybersecurity PhD scores 0.2), and credit arithmetic disagrees on 16 of 45
     and calls PharmD's sequential phases "alternatives".
  3. The first pane is always primary and **keeps its existing folder**, so the
     change is additive and no saved plan, share link or MCP `programId` moves.
  4. Variants are named with the modality mechanism NEU already uses
     (`MSCS—Align`), so a folder is `public_policy_phdadvancedentry_(boston)`.
     Every modality in the table must be registered in `programNaming.MODALITIES`.
  5. A variant gets **no** sample plan and no plan-of-study witness — the plan
     pane describes the primary curriculum, and a witness pointed at the wrong
     program is worse than no witness.
- **A guard that runs after a repair cannot see what it repaired.**
  `duplicate-concentration-titles` is severity `high` and never once fired,
  because it compared finished titles and `uniquify` had already renamed the
  collision to `… (2)`. Public Policy PhD shipped `verified, 0 issues` while
  carrying two same-named concentrations differing by 8 SH. It now reads
  `metadata.titleCollisions`, recorded at the rename. Likewise
  `tablesConsumed === tablesOnPage` proves only that nothing was *dropped* and
  is blind to double-**counting**; `assertPaneCoverage` is the partition check
  that catches it.
- **The Sample Plan of Study is a witness, not a source.** It is one valid
  path, so it can prove we dropped requirements and can never prove we have
  them all. Never assert parsed ⊆ plan — the plan takes one branch of every
  choice. Its total legitimately exceeds the minimum, so it is info only.
- **A section can state its requirement in prose, and prose is COPIED, never
  interpreted.** Two shapes, both formerly silent:
  1. a group that names no course still emits a SECTION with the registrar's
     `creditsRequired` (580 of 7,983 sections; see the codeless-sections
     contract test). `minRequirementCount: 1` so nothing draws a checked box,
     `requirements: []` so nothing is enumerated wrongly, and
     **`creditsRequired` must never be summed into a total** — 90 of the 580
     restate credit another section already counts;
  2. every prose row survives verbatim, in document order (7,637 notes over
     3,703 of 6,887 sections, median 38 chars; **all 580** of the codeless ones,
     which is what makes them legible rather than merely visible). It reaches the
     panel, the PDF, the MCP tree and the static `/northeastern/ai/**` pages,
     always attributed ("From the catalog") and never paraphrased.
     **Live-translated in the GUI only.** Notes are scraped English carrying a
     condition, exactly like a GPA rule, and `DescribedRuleText` has always
     translated those — an English sentence in a zh/ja panel is the bug, not the
     safeguard. `CatalogNotes` shipped untranslated by arguing "like a course
     title", which refutes itself: course titles ARE translated, and so are
     section titles and `XomGroupHeader`, so a zh reader got a translated
     heading, an English instruction, and translated category headings under it.
     `useTranslatedText` returns `translated || text`, so a failure degrades to
     the registrar's English. The PDF export stays English (English-only by
     design) and the AI pages stay verbatim, because a model reading them should
     get the registrar's own words rather than a machine translation of them.
  Rules that must not be weakened:
  - **Notes are a PARTITION, not a subtraction.** Every prose row reaches one
    place: `node.notes` (the sentence that introduced that node) or
    `section.notes` (prose above the first requirement, which HEADS the section,
    plus anything trailing). There is no `consumed` Set and no `residualNotes`
    — that earlier design computed notes as the complement of what the parser
    marked, and both of its defects were structural: position was lost (an
    instruction belonging to the third menu printed above the first), and
    partial expression was invisible (a row is consumed atomically, so
    "Complete two of the following (excluding HIST 2301 and HIST 2302):" was
    consumed for its COUNT and the exclusion went with it — 325 groups / 172
    distinct conditions).
    A sentence is printed even when the structure beside it says the same thing,
    because "says the same thing" is exactly the judgement that needs an
    instruction grammar. That grammar was built and measured against all **4,213
    instruction rows (1,253 distinct)** and refused: 47.2% leave a tail across
    1,159 distinct tails, and most are boilerplate the pattern happened not to
    cover ("the following", "course list", "range", "two options"). Tightening it
    is unbounded and fails in the expensive direction — a pattern that grows to
    cover boilerplate eventually swallows a real condition, silently.
    Only sentences **displayed VERBATIM elsewhere** are withheld, which is
    decidable by string identity and needs no grammar: GPA prose (copied into a
    `gpaConstraint`), a subheader that became a branch `label`, a subheader that
    became an `XOM.groups` heading, and the two subject-pool rows — that last one
    the sole "already expressed" exception, sound only because
    `SUBJECT_POOL_INSTRUCTION` is anchored and refuses on any residue, so a match
    is a proof. Guarded by `test/contract/catalog-note-partition.test.js`
    (coverage ratchet, no-invention, and inertness).
  - **Notes attach to the NODE, never to an index** into `requirements`. Indices
    do not survive this file: the `creditHint` path wraps the whole array in one
    XOM, `mergeDuplicateSections` concatenates two arrays, and `_CHOOSE`
    post-processing rebuilds nodes. An anchor that is part of the node moves
    through all three for free.
  - **Do not filter notes by shape.** Short label-like lines look like noise
    until you check: Interdisciplinary Studies BS (Oakland) § Minor Requirement
    is 16 SH with zero parsed requirements, and the fifteen bare minor names
    ARE the requirement. A short-line filter deletes the best case in the corpus.
  - **A note never blocks and never resolves.** It states a condition this code
    cannot check ("Research courses may not be used"), so allocation must be
    byte-identical with and without it. Computing the excluded set was measured
    and refused: title matching calls a "synthesis" course research, and
    Banner's `scheduleType` files BIOL 4991 Research as a Lecture.
  - The only sentence suppressed as "already said" is GPA prose, because
    `gpaConstraints` carries the same string verbatim.
- **A prose section's credit is free credit RENAMED, never credit added.**
  CHART gives these sections a cell (titled after the section, `spec: null` so
  nothing auto-fills it, `levelTarget: 1` so it defers — with no course named
  there is no prerequisite chain, and a slot filled later than it needed to be
  costs nothing while one scheduled before its unrecorded prereqs pushes the
  degree out). The cell is taken **out of the general-elective residual**
  (`proseLabels` in `demand.js`), capped by it. Emitting cells from
  `cellsForSection` instead was built and measured wrong twice: Data Science
  MSAlign prints "Electives1: 12 SH" and then six sections named after
  *colleges* which ARE that elective's menu, so the extra 12 SH tripped
  `poolExcess` and collapsed a legible menu into one anonymous slot — the change
  destroyed information; and Interdisciplinary Studies BS (Oakland) prints
  159 SH of prose sections against a 128 SH degree because its focus areas are
  alternatives nothing marks as such. Spending from the residual makes both
  harmless by arithmetic: `structuralSH` never moves, a program whose prose
  figures are pure restatement gets no labels at all (the correct reading of a
  page that counted the same credit twice), and `prose-credit-restated` reports
  how much. Measured on the sampled sweep: refusals 33 → 22, `mostly-unlabelled`
  13 → 3, terms with 3+ general electives 3.4% → 1.7%, and one course moved
  (a plan-of-study witness lost its anonymous slot in PharmD).
- **A pick-N block takes the registrar's credit, never `N × 4`.** A "Complete N
  of the following" block is emitted as a credit threshold, and `N × 4` is an
  assumption about course size, not a reading. Applied AI MPS states "Complete
  two of the following **[6]**" over 3 SH graduate courses, so 2 × 4 = 8 demanded
  a third course: the student who took exactly the two named read as UNSATISFIED
  and the phantom 2 SH inflated `structuralSH`. The instruction row's own
  hourscol wins when the sentence states no figure of its own (an explicit
  "12 semester hours" still beats the cell), and `N × 4` remains the fallback for
  the pages that state nothing. Measured over 657 count blocks that state a
  figure: 597 agree, 57 lower, **3 higher** — both directions were real, so this
  was never safety-side rounding.
  - **A CONDITIONAL count is excluded**, and that came from attacking the change,
    not from reasoning: an A/B of both parsers in ONE process over the whole cache
    moved 59 thresholds and exactly one became satisfiable by a single course
    where two were needed — International Business § Electives, "Complete two of
    the following courses (**one if both courses above selected**). [4]". The 4 is
    right for the one-course branch, so neither figure is the block total. Keeping
    `N × 4` over-requires in one branch (recoverable); trusting the 4
    under-requires in the other (not). 58 plain against 2 conditional, so the
    guard costs the fix nothing.
  - A range cell (`9-12`, `9–12`) reads as its **minimum**, and an unparseable
    cell falls back rather than becoming a 0 threshold satisfied by nothing.
- **The free-elective allowance is the RESIDUAL, in one place.** It was computed
  three ways: the panel used `generalElectiveSH ?? 0`, so the 976 of 1,071
  programs that state no figure showed a General Electives section requiring
  0 SH; `obligationsOf` used `stated ?? residual`; `deriveCells` used the
  residual always, having measured the stated figure wrong in both directions.
  All callers now go through `generalElectiveSHOf` / `generalElectiveAllowance`
  in `core/requirementBinding.js`, and the stated figure survives only as a
  signal (`general-elective-disagreement`). CHART still takes its residual
  against its own CELL total — not a fourth rule: a co-requisite pair is one
  cell and two courses, and mixing the two accountings is what left Industrial
  Engineering 8 credits short. `demandOf` reads a childless section's
  `statedSH`; before that it answered a flat 4 SH for all 580 of them, so
  4,305 of 6,625 SH leaked into free electives.
- **`areasubheader` is a sub-run boundary, and it does THREE jobs.** CourseLeaf
  marks a sub-run inside an areaheader group with
  `<span class="courselistcomment areasubheader">` — 1,663 groups on 466 cached
  pages. Neither of `parseTable`'s boundary tests matches it (distinct class
  token; `"even areasubheader undefined subheader".includes("areaheader")` is
  false), so it used to do nothing and a choose block ran straight through it.
  Data Science BS's choice between two three-course pathways shipped as "pick
  one of six", so one course satisfied a 12 SH requirement. Before changing
  anything here, know that such a row:
  1. **may open a credit pool from its own hourscol** — Environmental and
     Sustainability Sciences says "Complete one course from each category:" over
     `Skills 4` / `Earth, Oceans… 4` / `Conservation… 4`. It must fall THROUGH
     to the instruction branch; swallowing it collapsed four separate 4 SH
     requirements into one OR (12 SH of a degree gone);
  2. **is prose no node expresses** → a verbatim note ("For students pursuing
     emergency elementary teaching licenses");
  3. **bounds a run**, which is what makes a run readable as one option.
  A run of indented options becomes an `AND`; armed only for "complete ONE of
  the following" adjacent to the first subheader. A **credit** instruction is
  excluded (a 12 SH pool legitimately spans areas) and so is **any count above
  one** — there the subheaders are thematic categories, and reading a run as a
  conjunction demanded all ~25 courses of a theme in 4 programs, which
  `check-major-integrity` caught as newly over-consuming pools.
  Those categories are not discarded: the count-above-one case fills
  **`XOM.groups`** (`[{title, courses}]`), which `XomGroupHeader` already
  renders above each category's own courses, so the tree is untouched and only
  the display gains. Public Health BA (Oakland) printed its five area names as a
  flat list of notes at the top of the section; they now head their own
  28/8/9/16/8 courses. 106 pools, 397 headings. Two rules here:
  - **The PARSED shape is `{title, courses}`; the ALLOCATED shape is
    `{title, children}`.** `allocateNode` reads `g.courses.length` to re-slice
    the allocated children, so emitting `children` from the parser threw on 40
    pages and the scrape rails refused the whole run. Verifying against the
    renderer proves nothing about the producer — check both ends.
  - Headings are emitted only when the boundaries **partition** the pool; a
    course outside every category would otherwise be invisible inside a pool it
    belongs to. When they do not partition, the titles come back as notes on the
    pool, keyed on the node actually pushed (only the pool shapes carry
    `groups`, so keying on "did buildGroups succeed" dropped 39 sentences).
  Left alone on purpose: an instruction BEFORE the first subheader whose options
  are flush (Elementary Education MAT), because the run holding the last
  alternative also holds two genuinely required courses and nothing separates
  them. Over-requiring is recoverable; under-requiring is not.
- **`AND` is a conjunction; a GROUP is an `AND` with no `AND` children.** A group
  is one registration slot, so it cannot hold a prerequisite chain — Public
  Health BA's Biology option is two co-requisite pairs and General Biology 2
  needs General Biology 1, so `andGroup` flattening them into one group forced
  all four into one term and refused the plan with `named-prereq`. Zero nested
  `AND`s existed in the corpus before subheadered branches began parsing, so
  this distinction is new; every consumer was audited against it (`checkAnd`,
  `allocateNode`, `normalizePooledSection`, `programEligibility` all recurse and
  are indifferent to nesting; `witnessedSharedNodes` degrades to "not
  witnessable"). **Enumerate the consumers of a node shape before introducing a
  new one** — not doing that cost three iterations and two sweeps here.
- Concentrations are found through the page's **anchor graph**, not heading
  text — wording varies far too much. A concentration's title is its only
  identity across saved plans, share links and MCP `SET_CONCENTRATION`, so
  every lookup goes through `src/core/concentrationResolve.js`.
- `verify-majors.js` must run **after** the scrape: the scraper deliberately
  drops `metadata.verification` rather than carry a stale verdict forward.
- Both scrapers buffer their whole run and refuse to write if it looks like
  upstream breakage (`scripts/lib/scrape-rails.js`) — same principle as
  `fetch-nupath`'s 5% rule. They push straight to main unattended.
- Program discovery uses the **sitemap**; `/azindex/` is `Disallow`ed in
  robots.txt and both scrapers used to violate it.

## /data search

One omnibox on every `/data` page resolves any entity the surface publishes.
Design of record: `docs/data-search-design.md`. Instrument:
`node scripts/data-search-probe.js [--mono] [--fixture] ["a query"]`.

- **One scorer, not two.** `core/nameMatch.js` (primitives) and
  `core/rankRecords.js` (the tier order) are shared with the planner's program
  search, so "cs" cannot come to mean different things in two boxes. The split
  out of `searchRank.js` was proved behaviour-neutral over 7,548 queries and
  `test/unit/search-rank.test.js` is unmodified from before it — keep it that
  way when touching either file.
- **The index carries the institution, not the client.**
  `adapters/northeastern/dataEntities.js` declares the kinds, URL grammar,
  acronyms and nicknames; all of it is baked into the emitted index as DATA, so
  `adapters/datasurface/searchBox.js` imports core only. Adding a kind is one
  `KINDS` entry plus one `…Records` function — which is all the `section` kind
  (the seven directory pages) took.
- **"Navigation" is how pages go missing.** The directory pages — Courses,
  Majors, Minors, Graduate, NUpath, Professors, Equivalences — were exempted
  from the index under that word, so `equivalences` and `nupath` returned
  nothing at all. Only three things are exempt now: the hub, `/data/search`, and
  the 52 alphabet indexes, and that last one is a judgement worth keeping — a
  record named "A" would EXACT-match a bare "a" and top the list ahead of every
  real entity, 52 times over.
- **The build refuses to ship an unsearchable page.** A generated page with no
  index record fails the build, with navigation pages exempt by a *declared and
  asserted* list (61 of them). Two records sharing a URL, a record pointing at
  no page, or an index that will not round-trip through its own codec all fail
  too. Never widen the exemption to make a build pass.
- **Prefix monotonicity is the metric, not recall@1.** Recall@1 on an entity's
  exact name is 99.8% before any work; monotonicity ("once it appears, one more
  character must not drop it") found the real defect — matching course codes by
  equality left 3.39% of prefix queries non-monotonic and 434 entities
  unreachable by their own full name. Now 0.005% and 0.
- **A per-kind quota is not the answer; representation is.** The best hit of
  every kind that matched gets a slot — one rule, no tuned constants. And a
  popularity prior over coverage was measured and refused: it puts Calculus 3
  above Calculus 1 and Organic Chemistry 2 above Organic Chemistry 1.
- Don't put a campus or college into `poolWords`: a bare pool word matches at
  the ANY tier, which is harmless over 1,071 programs and noise over 13,022
  records. Program names already contain their campus.
- Verify in a browser (`test/browser/data-search.browser.test.js`) — nothing in
  Node evaluates the widget's DOM code.

## Claude/MCP integration

- Node dev server: `mcp-server/` (port 27182). Production: `cloudflare/mcp-server/`
  (Durable Objects + OAuth), deployed with `npx wrangler deploy`, live at
  mcp.numap.app. Both compose the same shared adapters in `src/adapters/mcp/` —
  changes to action semantics or tool docs need a worker redeploy to reach prod.
- Hexagonal rules: UI imports ports only (`src/ports/`), adapters import core only.
  The Claude UI motif is orange `#fb923c`; previews are dashed-orange ghosts.

## Team workflow (two humans + pipeline bots)

- Start by syncing with `origin/main`: `git pull` (or at least `git fetch` +
  `git diff HEAD origin/main` to see what changed). Pull again before editing
  shared docs (TODO.md, IDEAS.md). With `pull.rebase` set, pull refuses while
  you have uncommitted changes — commit or stash first.
- **Default flow: branch → commit → rebase onto origin/main → `git merge
  --ff-only` → delete the branch.** Pairing is the normal mode here, so
  **no PRs** — do not open one unless explicitly asked. The branch is just
  somewhere to commit work that is not a coherent unit yet; every commit
  lands in main by its own SHA, so deleting the label afterwards loses
  nothing.
- **Stay mergeable at all times**: rebased on `origin/main`, tests green, no
  half-finished commit at the tip. Merging should never be a project — if it
  is, the branch drifted too long.
- **Committing needs no permission; pushing does.** Always ask before
  `git push`. Commits are local and easy to amend or reset; a push is
  outward-facing and may carry someone else's commits with it.
- **A branch does not isolate a shared checkout.** Branches are per-repo, not
  per-agent: one `HEAD`, one working tree. When two sessions run at once,
  `git switch` moves both, and uncommitted edits follow across the switch —
  this is how one session's edits to majorLoader.js/minorLoader.js ended up
  inside the other's commit on Aug 2, 2026. So stage your own files
  explicitly, never `git add -A`, and leave the partner's uncommitted work
  and unpushed commits alone. For real isolation use `git worktree` (its own
  directory, `HEAD` and branch) — it needs a separate `npm install`, so it
  is worth it only when both sessions are live in the same files.
- If a PR is explicitly requested, it merges as a **merge commit**. Never
  squash-merge — squashing collapses the branch's commits into one, so the
  individual history is lost the moment the branch ref is deleted. A merge
  commit keeps every commit AND marks which branch they came from, so
  deleting the branch afterwards is safe (GitHub: Settings → General →
  Pull Requests).
- No long-lived or personal branches — they drift fast here (the monthly
  scrape commits straight to main; one March branch died 469 commits behind).
- Never enable required-PR branch protection on main: the scheduled data
  workflows push to it directly and would break.
- Ideas and tasks live in per-person lists under `notes/` (`ideas-nathan.md`,
  `ideas-matthew.md`) — only edit your own, so they never conflict. The repo
  is public: keep notes whiteboard-safe.

## Working method

Every input here is scraped, the workflows push to main unattended, and a wrong
number reaches a student planning their degree. Confident-and-wrong is the
expensive failure, so the loop is:

- **Measure before designing.** Argue from the corpus, not from intuition —
  most good calls in this repo were made by a script that took two minutes.
  Ideas that read well and died on contact: candidate-set intersection (empty
  **86.7%** of the time), a first-run "load a sample plan" toggle (**62%** of
  programs publish none), per-section pending marks (a median of **2 sections
  out of 11**). A measurement that kills your idea has done you a favour.
- **Attack your own work.** Tests that confirm are close to worthless here. The
  ones that pay are hostile: malformed specs, stale ids, junk locale shapes,
  hundreds of random gestures. Do not stop at first green — stop when you have
  tried everything you can think of and it still holds.
- **Verify, never assume.** `subjects` is an array at runtime and an object in
  the scraper. `CS 3500` does not exist. Four core modules were imported by
  nothing at all. Each was found by *checking*, and each would have shipped in
  silence.
- **A green Node suite says nothing about whether the app RENDERS.** On
  2026-08-20 a `const` read before its initializer in `PlannerContext` threw on
  every render; every visitor got the recovery screen. `npm run build` succeeded
  and 2,018 unit + 93 contract + 254 invariant tests passed, plus `verify-chart`
  at 794 plans — because nothing that runs in Node evaluates a React component
  body. HTTP status was no help either: `/`, the bundle and every JSON asset
  returned 200 while the app was unusable. So **before pushing a change under
  `src/ui/` or `src/context/`, render it** — `npm run test:boot` builds and mounts
  the app in headless Chromium and takes ~5 s, or use the `/run` skill. The older
  `test/browser/*` files `skip` unless a dev server is already listening and CI
  never starts one, so they were a no-op in CI; `test:boot` fails instead of
  skipping, which is the whole point.
- **Declare a memo above its consumer.** The same outage, stated as the rule that
  would have prevented it: `standingViolations` read `supersededTakes` in its body
  AND its dependency array while `const supersededTakes = useMemo(...)` sat 126
  lines below, in one scope. `PlannerContext` is ~5,000 lines of hooks in a single
  function, so nothing about proximity is obvious — check the declaration line of
  every identifier a new memo touches.
- **Be hardest on your most confident claim.** "Two plans need 262 SH" was
  rhetoric — a second major consumes the free electives, so the real gap is
  three courses, not double. "Provenance proves replacing is safe" was false; it
  proves the canvas *started* as a template. Re-derive the number you are most
  sure of.
- **Fix the cause, and check whether the guard is the bug.** A persistence
  invariant stripped `//` comments *after* splitting on commas, so a comma
  inside a comment invented a field and reported it lost on reload. A test that
  punishes commas in comments teaches people to write worse comments.
- **Conservative beats clever.** Ambiguity is cheap; false confidence is not.
  Degrade to less information, never to wrong information — and do not ship what
  the measurement says is not worth it.
- **Say plainly when you were wrong.** Correct it in place, in the document or
  the comment that carries the claim, so the next reader inherits the correction
  rather than the mistake.
- **Edit code with the editing tools, never through the shell.** `sed`, `node -e`
  rewrites and heredocs are not code editing — they skip the read-before-write
  the editors enforce, they are invisible in review, and a bad regex silently
  mangles a file nobody re-reads. Shell is for *running* things: tests, builds,
  git, throwaway measurement scripts. It is not for changing source, and that
  includes locale files.
- **Never idle on a long command.** `verify-chart` is 4–10 minutes and the suites
  are minutes more. Background them and keep editing, reading or writing the next
  thing while they run; collect the result when it lands. Waiting for a number
  before doing anything else turns a ten-minute run into ten wasted minutes, and
  it happens a dozen times in a session.
  - The only reason to block is when the very next edit depends on the answer and
    getting it wrong would be expensive to unwind — landing a change on main,
    or a measurement that decides whether to keep or revert work already built.
    That is rare. Default to carrying on.
  - **A poll loop is idling, and it is the loophole this rule keeps losing to.**
    `until [ -s out.txt ]; do sleep 20; done` backgrounds the job and then spends a
    whole turn waiting for it, at 20-second granularity. That satisfies the letter of
    "background it" and defeats the point. There is no correct version of this: launch
    the run, make the next edit, and collect the result when the completion
    notification arrives. Measured on 2026-08-20, an audit of *this very rule* burned
    ~25 minutes of session time on poll loops against scripts that cost 10.
  - **Never run two heavy things at once.** Two concurrent full sweeps on this machine
    (10 cores) had not finished at 13 minutes when either alone is 4–10, and worse, the
    engine's clock can turn an answer into a refusal by design
    (`search.js`, `search-budget-exhausted`) — so a contended run produces DIFFERENT
    refusals. Both numbers were unusable. One heavy run at a time, or the result is not
    evidence.
  - **Derive before you measure.** The cheapest measurement is arithmetic on numbers
    already written down. "Refusals cost 23 minutes" was asserted in that same audit
    and was wrong by 3–8×, and the thing that disproved it was already in the repo:
    `chart-probe.js` says the sweep is 4–10 minutes, so refusals cannot average the
    full 5,000 ms budget. That took no run at all. Reach for a script when the
    arithmetic genuinely runs out, not before.
  - **Never write a corpus loop inline. Ask `corpus-ask.js`.** This is the rule that
    addresses the actual complaint: the expensive verifications here were never the
    committed ones, they were scripts written in a chat to answer one question and
    deleted afterwards. `verify-attr` for the designation change cost minutes and did not
    survive, so the next designation question pays again.
    - Those scripts were not slow because they were ad-hoc. The question is five lines;
      the minutes were spent rebuilding 1,078 plans to have something to ask it of, and
      that rebuild is identical every time. The sweep was *already* building those plans
      and discarding them — `--fingerprint` even wrote a readable copy of every one and
      nothing ever read it.
    - **Course/requirement questions need no plans at all**: `node scripts/corpus-ask.js
      --js '…'` is ~0.5 s. Measured: three questions in a row at 0.59 / 0.45 / 0.45 s,
      one of which was wrong and corrected by looking at the real field names — that
      guess-look-retry loop used to cost a run per try.
    - **Plan questions** read a file written once by `verify-chart --snapshot`. A
      before/after that used to be two full sweeps is `corpus-ask.js --diff a.json b.json`,
      and it separates "different courses" from "same courses, rearranged" — which one
      number never could.
    - If the question cannot be expressed, add the accessor to `corpus-snapshot.js`. That
      is what makes the NEXT question cheaper instead of equally expensive, and it is the
      missing half of the rule below: six `*probe*` scripts exist because there was
      nowhere to put the extension.
    - A saved file that answers for code you have since edited is worse than no file,
      because it sounds right. The snapshot records a hash of `src/engine` + `src/core`
      and the data and shouts on read if either moved. It still answers — an old file is
      exactly what a before/after wants — but it cannot pass as current.
    - What this does NOT fix: "did my engine change alter the output" requires
      regenerating. The floor there is the sample (~4 min), not a second.
  - Prefer ONE reusable instrument over a stream of throwaway scripts.
    `scripts/chart-probe.js` answers the same questions over a named list of plans in
    ~13 seconds where the corpus sweep takes ten minutes. Extend the instrument, do not
    write another script — and when a question needs a new one, COMMIT it. `verify-attr`
    was written inline to check the designation change, cost minutes, and was thrown
    away; commit `c69758aa22` kept its 257-line unit test and none of the instrument, so
    the next designation question pays full price again. Six `*probe*` scripts have
    already accreted this way.
    - The reason is reuse, **not** load time. This bullet used to claim a `node -e`
      heredoc "reloads the 8,000-course catalog from scratch" as if that were the cost.
      Measured: `loadCatalog` is **364 ms** for 7,966 courses. It is nothing, and citing
      it sent readers to the wrong file. The cost is `refusals × budget` and the missing
      parallelism — the sweep runs at 94% of ONE core with nine idle.
- **Sample by default; the full corpus is opt-in and needs a reason.**
  `node scripts/verify-chart.js` runs a covering sample of 120 of 1,078 shapes and
  exits **3**, never 0. `--all` is the corpus verdict and is what
  `update-courses.yml` passes. Do not run `--all` in a chat without saying why —
  it is a verdict, and a question does not need one.
  - **Sampling alone is only a 2x win, and that is measured.** 120 shapes took
    **3:47**, because a covering sample costs 1.9 s/shape against the corpus mean of
    0.56 s/shape: it selects for rare strata, rare strata are the hard programs, and a
    hard program spends its whole 5,000 ms budget before refusing. Selecting for
    "unusual" selects for "expensive". The rest is paid by `--jobs`, not by shrinking the
    sample — cutting the quota trades away exactly the detection power stratification was
    built for (see `chart-sample.js` for the 1-0.75^q arithmetic).
  - **With sharding on, the sampled run is 35.8 s.** Proved equal to serial before being
    enabled — `moved 0` both serial-vs-serial and serial-vs-sharded, the latter under
    deliberate contention. `--jobs 1` restores the serial run for a future A/B.
- **Check `git log` timestamps against your RUN timestamps before trusting a
  before/after.** This checkout is shared and the partner session commits while your
  measurements are in flight, so a baseline taken minutes ago may be a different engine.
  Measured cost of skipping this: two wrong conclusions in one session — "sharding is
  unsafe", then "a residual non-determinism exists" — both from A/Bs that straddled
  someone else's uncommitted edits. When a tree cannot be pinned, A/B inside ONE process
  with an env hatch (`CHART_NO_DEPARTMENT`, `chart-probe --no-witness`) rather than across
  two runs. That is what settled the clock-guard question in
  docs/chart-open-defects.md §21 — and note the hatch there was deleted with the change it
  measured, which is correct: a hatch is scaffolding for one decision, not a setting.
  - The sample is **stratified, not uniform**, and that is the whole design
    (`scripts/lib/chart-sample.js`). The properties a regression hides behind are rare:
    concentration disjunctions are 112 of 1,078 shapes (10.4%), shared sections 134
    (12.4%), 15+ requirement sections 65 (6.0%), 40–79 SH 80 (7.4%). A uniform 120
    carries ~7 of the third, and a guard that fires half the time is a coin. Quotas per
    stratum, filled greedily because the strata overlap, then a uniform draw for
    ordinary-case power.
  - A clean sample **cannot** exit 0, for the same reason `--limit` cannot: it is
    designed to look like a real verification, so it is the run most likely to be quoted
    as "verify-chart is green". It proves the absence of a regression in what it covered
    and nothing about the corpus.
  - Strata are earned by measurement. Two candidates were dropped rather than shipped:
    `nested requirement sections` matched 0 shapes (a stratum that is always empty is a
    check that always passes) and `plan-of-study witness` matched 1,078 of 1,078 (a
    stratum every sample hits for free discriminates nothing).
- **Re-anchor these rules as a session runs long.** Drift is the default, not
  the exception — the shell creeps back in, tests get gentler, claims get
  confident again. Re-read this section periodically and after any long stretch
  of implementation. An explicit instruction from the user overrides any of it;
  absent that, return to it rather than to whatever the last hour settled into.

## Conventions

- Conventional commits (`type: description`), no Co-Authored-By trailers.
  Keep the subject concise; for features/fixes add a body of bullet points
  explaining how the change works — what was added or fixed and the
  mechanism behind it — detailed enough to follow the design without
  reading the diff.
- Localization: every user-facing string exists in all 8 locales
  (`src/locales/`), hand-written translations. "CLAUDE" stays untranslated.
  Summer terms are "Summer A" / "Summer B", never "Summer 1/2".
