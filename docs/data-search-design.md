# Data-surface search — design

**Status: built and shipping.** `src/core/nameMatch.js`,
`src/core/rankRecords.js`, `src/core/entitySearch.js`,
`src/adapters/northeastern/dataEntities.js`,
`src/adapters/datasurface/searchBox.js`, emission and rails in
`scripts/build-ai-data.js`, instrument at `scripts/data-search-probe.js`,
verified by `test/unit/{name-match,rank-records}.test.js`,
`test/contract/data-search.test.js` and
`test/browser/data-search.browser.test.js`.

As built, against the design below:

| | designed | built |
|---|---|---|
| Index | 116 KB gzip est. | **703 KB raw / 148 KB gzip / 103 KB brotli** |
| Scan per keystroke | ~1.1 ms | **2.84 ms median, 4.96 ms worst** |
| Parse + prepare, once | ~13 ms | **20 ms** |
| Widget bundle | — | **6.0 KB minified** |
| Prefix monotonicity | the metric | **1 drop in 18,306 (0.005%)** |
| Absent at own full name | must be 0 | **0** (was 434) |

Three things in the design were deleted during the build because the data made
them pointless — a `qualifierWords` role, a separate `codes` list, and the
`pool` column. Each is recorded where it would otherwise be reinvented.

One omnibox on every `/data` page that resolves **any entity on the public data
surface** to its page: a course, a professor, a program, a NUpath code, a
subject. Type a name, get the page.

What it is deliberately *not*: prose search and question answering. Course
descriptions and the 7,637 verbatim catalog notes are ~1.1 MB gzipped and would
need a server tier; every question measured below is about *reaching a page*,
not about extracting a fact from one. If that changes, it changes as a second
tier, not by widening this one.

## The inventory

Measured on the 2026-08 build:

| Type | Records | Match keys |
|---|---|---|
| Courses | 7,966 | code (`CHEM 2311`), title, subject |
| Professors | 3,741 | name, either token order |
| Programs | 1,071 | name, degree acronym (`BSCS`), initial-runs (`ie and cs`), kind, college |
| Subjects | 231 | code + name |
| NUpath | 13 | code (`ND`) + label (`Natural/Designed World`) |

13,022 records against the **13,083 pages** the build now emits, and the gap is
fully accounted for: 61 navigation pages — 26 first-letter professor indexes, 26
under `professors/last/`, the 7 section hubs, the hub itself and `/data/search`.
The build asserts exactly that number. Reconciled by
running the bijection rail early, which also settled that programs are exact
(1,071 pages, 1,071 records, zero orphans) and that the 29 concentration pages
are already inside the programs kind rather than a sixth kind. So the schema is
five kinds, and navigation pages need a *declared* exemption in the rail — an
allowlist that is itself asserted, never a silent skip.

## Speed: there is no performance problem

Measured by building the real merged index and timing a real scan:

| | prototype | as shipped |
|---|---|---|
| Index payload, columnar | 534 KB raw / 116 KB gzip / 88 KB brotli | **703 KB / 148 KB / 103 KB** |
| Parse + prepare, once | ~13 ms | **20 ms** |
| **Scan of every record, per keystroke** | 1.1 ms median | **2.84 ms median, 4.96 ms worst** |

So: **no trie, no inverted index, no prefix map, no WASM.** A linear scan over
the whole corpus costs a few milliseconds against a 16 ms frame. The entire cost
of the feature is a ~100 KB fetch and 20 ms of setup, once, lazily on first
focus. An inverted index would be more code, more build surface and more ways to
be subtly wrong, bought with latency we do not need.

The shipped figures are higher than the prototype's for honest reasons: the real
index carries paths and aliases the prototype did not, and the real scorer runs
the full tier ladder rather than a simplified one. The first integration measured
**13.9 ms median**, because the memoised initials search ran on all 13,022
records; the fix was not a data structure but an exact precondition — a query
token can only reach the four middle tiers if some matchable word begins with its
first character, so one `Set` lookup skips the expensive tiers entirely. It is a
necessary condition, so it cannot change a score, and
`test/unit/rank-records.test.js` asserts that equivalence over 3,000 random
records rather than trusting the argument.

Caveat stated honestly: those are Node numbers on an M-series Mac. Assume 5–10×
on a low-end phone and the scan is still ~15–25 ms behind a debounce, with the
20 ms precompute paid once behind a fetch that costs more.

Columnar over an array of objects because it measured smaller on both axes
(534 vs 712 KB raw, 116 vs 132 KB gzip) — repeated key names are the difference.
Two columns were then deleted for the same reason: `p` (paths) is stored only
when it is not the code with spaces as slashes, and `pl` (pool words) was always
the code split on its space, which together were 311 KB of the payload restating
another column.

Pagefind is the obvious off-the-shelf answer and was considered: it is
full-text-over-pages, cannot express the router, acronym or representation rules
below, and its runtime plus sharded index for 13,000 pages is larger than our
entire ~100 KB. Licence would have been fine (MIT); the fit is not.

## Ranking

`src/core/searchRank.js` already solved most of this, against 7,146 measured
queries: coverage-of-the-name scoring, acronym tiers ranked by provenance
(NU's own degree code beats derived initials), initial-runs that skip connectors
so `ece` spans "Electrical **and** Computer Engineering", and a subsequence
typo fallback armed only when strict matches are sparse. It is pure, and today
it is program-only.

### Two inherited behaviours the descriptor has to respect

Found by writing hostile unit tests against the extracted scorer, both
pre-existing and both unchanged by the split:

- **A bare pool word matches, at the ANY tier.** Searching `boston` returns
  every Boston program rather than nothing, because campus and degree words
  join the ANY pool. Harmless over 1,071 programs; over 13,022 records it would
  mean one word matching a third of the corpus at a mid tier. So the data
  surface must not pour campus or college into `poolWords` — a secondary field
  is only safe there if a bare query for it is a query someone means.
- **The loose sub-tiers overlap `LOOSE` itself.** The penalties (100, 200) are
  smaller than `COV_MAX` (400), so a well-covered slug hit outscores a
  barely-covered mid-word one. Sound only because the whole loose band sits far
  below `ANY`; that bound is what the test asserts, rather than the sub-order,
  which is not actually guaranteed.

Two stages:

1. **Router.** An unambiguous shape wins outright: any record whose unique
   `code` the query states exactly is an answer, not a candidate. As built this
   needs no course-code parser and no vocabulary — the query is canonicalized
   once (`chem2311` → `chem 2311`, because letters and digits already delimit
   each other) and then matched against the code column, so subject codes and
   NUpath codes route by the same line of code. Only the singular `code` routes;
   a degree code is not unique, and routing "ba" would lift several hundred
   programs above every other kind at once.
2. **One scorer over typed records**, then a **representation guarantee**.

### What a blended score does, measured

Courses outnumber every other type **6:1**, so a single score lets them flood.
A coverage-only ranker over the real index returned:

```
"cs"                → CS 2963 Topics, CS 5963 Topics, CS 7990 Thesis…
"computer science"  → CS subject, then CS 4973 Topics, CS 6983 Topics…
"chemistry"         → "Chemistry - CPS", CHEM 5610 Polymer Chemistry…
```

— in each case burying the subject page and the degree program the query
plainly meant.

### Representation guarantee, not per-type quotas

The first version of this design fixed the flood with a per-type display quota
(4 courses, 3 professors, 4 programs, 2 subjects, 2 NUpath). That is five tuned
constants dressed up as a principle — the same thing this repo refuses
elsewhere. The replacement is **one rule**: the best hit of every kind that
matched at all is guaranteed a slot; the remainder of the list is pure tier
order. No per-type numbers, and the guarantee is a *property* — "the major you
meant is visible" — rather than a ration.

Measured side by side on the flood queries, representation alone is as good as
the quota table and needs nothing tuned:

```
"cs"                → CS (subject) ▸ …
"computer science"  → CS (subject) ▸ CS Minor ▸ MSCS ▸ PhD ▸ BACS ▸ CS 4950…
"chemistry"         → CHEM ▸ Chemistry BS ▸ CHEM 1000 ▸ CHM ▸ Chemistry MS
"machine learning"  → CS 6140 Machine Learning ▸ DADS 7305 ▸ FINA 4390…
"phil 1101"         → PHIL 1101 Introduction to Philosophy   (router, sole answer)
"nd"                → ND Natural/Designed World              (router, sole answer)
```

Its one visible cost: for `algorithms`, the guarantee promotes a very long
program name ("…with Concentration in Computer Vision, Machine Learning, and
Algorithms, MSECE") into second place. That is the guarantee working as
specified, and it is labelled by kind, so it reads as "the closest program" and
not as a better answer than CS 3000.

### A prominence prior was tried and refused

The compact subject JSON carries real popularity signals — `unlocks`,
`typicallyOffered`, `instructors`, `campuses` — so the obvious idea is to break
within-tier ties by how much a course actually matters instead of by coverage.
Built it, measured it against coverage on the same queries, and it is **worse**,
in a specific and instructive way:

| query | coverage tiebreak | prominence tiebreak |
|---|---|---|
| `calculus` | MATH 1241 **Calculus 1** | MATH 2321 Calculus 3 for Science and Engineering |
| `organic chemistry` | CHEM 2311 **Organic Chemistry 1** | CHEM 2313 Organic Chemistry 2 |
| `chemistry` | CHM (Chemistry - CPS) | **CHEM** (Chemistry and Chemical Biology) |
| `writing` | INT 6000 Writing Lab | **WI** Writing Intensive |

Prominence loses wherever a name is *numbered* — a sequence's first course is
what a bare query means, and popularity picks whichever entry happens to run in
more terms. It wins only where two records share a name and one is the primary
(`CHEM` over the CPS mirror `CHM`, `Chemistry, BS` over `Chemistry, Minor`).

So prominence is not a replacement for coverage; it is a **late tiebreak for
same-name duplicates**, which is precisely the job `searchRank`'s existing
`campusRank` / `credentialRank` chain already does. Conclusion: keep coverage as
the within-tier tiebreak and add provenance-style tiebreaks below it. The idea
that felt obviously right was wrong, and one probe was enough to show it.

### The defect the harness found immediately

Prefix monotonicity (below) reported 3.39% non-monotonic drops and **434
entities absent even when queried by their full name**. Both collapse to one
cause: the course code was matched only by *equality*, so `aace 6` — a code
prefix mid-typing — matched nothing, and `aace 6120 advocacy and the arts`
failed because `6120` was not a matchable token anywhere.

The fix is not a new tier. It is that **a record's code must be tokenized into
the same matchable pool as its name words**, exactly as `searchRank` already
pools degree, location and acronyms for its `ANY` tier. Worth recording because
the flood queries all looked fine while a third of a percent of every keystroke
sequence was broken, and no amount of eyeballing `"chemistry"` would have
surfaced it.

## How we learn whether it is actually good

**Prefix monotonicity is the primary metric, not recall@1.** Self-retrieval by
full name scores 99.8%/100% and is nearly free — querying an entity by its exact
name is the easiest question that exists, so a ratchet on it mostly measures
nothing. The property that catches real defects is:

> For every entity, over every prefix of how you would actually type it: once
> the entity appears in the top 10, one more character must never remove it.

That is the `"ie and c"` defect from `searchRank`'s own history, generalized into
a law. It found the code-tokenization bug on its first run, at 5% sampling,
in seconds. Reported alongside it: entities absent even at their full name
(must be 0), and ties scored as ties — the 0.8‰ of "misses" in the naive
harness are name-identical twins (the subject "Biochemistry" and a course titled
"Biochemistry"), and a headline number that counts those as failures is a number
someone will later "fix" by breaking something real.

Then the hostile pass: reversed and partial person names, cross-type collision
names (`Chemistry`, `Physics`, `Business Administration`), pure junk (must
return nothing, not something), and injected typos — the last of which measures
whether `searchRank`'s inherited subsequence fallback suffices rather than
assuming a new one is needed.

### The bijection rail

Every generated page must be reachable from exactly one index record, checked
at build time, failing the build on either side of the mismatch. Not just
"no record points at a missing page" (the existing link rail already does that
direction) but **no page lacks a record** — an unsearchable page is the failure
mode this whole feature exists to remove, and it is invisible to any test that
starts from the index. The 3,793-vs-3,741 professor gap above is what an
unreconciled surface looks like.

## Architecture

The framing that makes this fit: **the data surface is a third driving adapter
onto the same pure core**, alongside the React app and the MCP server. Not a
feature of the app, so not `src/ui/`; not institution-neutral either, so not all
in `src/core/`.

```
src/core/nameMatch.js         matching primitives                  (new, extracted)
src/core/rankRecords.js       ONE scorer: tiers, router, guarantee  (new)
src/core/searchRank.js        thin caller; API unchanged            (existing)
src/adapters/northeastern/dataEntities.js
                              record derivation, kind descriptors   (new)
scripts/build-ai-data.js      I/O, emits index, bundles client      (existing)
src/adapters/datasurface/searchBox.js
                              plain-DOM widget, core imports only   (new)
```

### One scorer, not two

The original plan was "extract the primitives, build a second ranker on top."
That is how `cs` comes to mean different things in the app and on `/data`, and
the prominence measurement above removed its last justification: the tiebreak
chain `searchRank` already has is the one this needs. So `rankRecords.js` holds
the single tier table and the single scorer, parameterized per kind by
(a) which fields to match and (b) a comparator chain. `searchRank.rankOptions`
becomes the program kind's field mapping plus its existing comparator —
same public API, so `src/data/majorLoader.js` and the program search UI are
untouched, and `test/unit/search-rank.test.js` runs **unmodified** as the proof
that nothing moved.

That test file is what makes convergence safe rather than brave: it inherits the
7,146-query result instead of discarding it. Sequencing matters — land the
behaviour-neutral extraction and get the test green *before* any new kind is
scored.

### The client is institution-agnostic, by construction

Everything Northeastern-specific — kind labels, URL templates, aliases like
`orgo`, router vocabularies — is **baked into the emitted index as data**, not
compiled into the widget. So the widget imports core only, a second institution
needs zero client changes, and there is no adapter-importing-adapter edge. This
is a better boundary than the earlier draft's, which had the client importing
the Northeastern descriptor directly.

It also settles where the widget lives. `build/` was wrong — that directory
holds build-time code (`aiDataDevPlugin.js`), and this is runtime browser code
that ships. `src/ui/` is React-app-only and its rule is "import ports only". A
plain-DOM widget driving core over a protocol boundary is a driving adapter,
which is what `src/adapters/` is for, so `src/adapters/datasurface/` is the
truthful home.

The widget does exactly four things: lazy `fetch`, `JSON.parse` guard, debounce,
render. Anything rankable that ends up in it is in the wrong file.

### `dataEntities.js` — the institution's part

Pure functions over already-loaded data (I/O stays in the build script): how
each record is derived, the URL grammar per kind, the router vocabularies, and
the alias table. Extensibility as checks rather than hopes:

- **A new entity kind** — co-op employers, equivalence pairs, concentrations —
  is one descriptor entry. `rankRecords` untouched.
- **A second institution** is one new `adapters/<school>/dataEntities.js`.
  Core and client untouched.
- **The app's own boxes** (`CompanySearch`, `CoopCourseSearch`, program search)
  can converge on the same scorer, because it is pure core.
- **An MCP `find` tool** resolving any name to a URL is the same two imports —
  the reason the scorer must not live inside the build script.

### No new port, deliberately

A port abstracts behaviour the app calls with swappable implementations. The
varying part here is a declarative descriptor, the consumers are a build script
and a static page rather than the app, and there is one institution. An
`IDataSearch` today would be a port with one implementation and no caller inside
the hexagon. Promotion later is mechanical: when the app's boxes route through
it *and* a second school exists, it becomes a port then.

`scripts/build-ai-data.js` already imports
`adapters/northeastern/descriptionPrereq.js`, so a build script reaching for an
adapter plus core is precedent, not a new exception.

### Testing, by layer

| Layer | What it proves |
|---|---|
| `test/unit/search-rank.test.js`, **unchanged** | convergence changed no program-search behaviour |
| `test/unit/name-match.test.js` | the primitives, directly |
| `test/unit/rank-records.test.js` | tiers, router, representation guarantee |
| `test/contract/data-search-index.test.js` | index codec round-trip; page↔record bijection; **monotonicity** ratchet; ties scored as ties |
| headless boot check | the script actually runs on a built page — a green Node suite says nothing about that |

The index codec (`encodeIndex` / `decodeIndex`) lives in core, in one place,
because the producer is a build script and the consumer is a browser bundle.
This repo has already paid for a producer emitting `courses` while the consumer
read `children` (the `areasubheader` groups); one definition plus a round-trip
test makes that drift unrepresentable.

## Artifacts and the no-JS floor

`buildAiData()` esbuild-bundles the widget to `/assets/data-search-<hash>.js`
and emits `/assets/data-index-<hash>.json`. Under `/assets/` because that path
already carries `immutable, max-age=1y` (`public/_headers`) and is already
exempted from the zone's Human-Verification rule; a new `/data/*.js` path would
be a fresh path against that rule, which is the class of thing that 500'd the
catalog before.

**A missing index file is not a 404.** `/* /index.html 200` in
`public/_redirects` answers any unknown path with the SPA shell at status 200,
so the loader must require `JSON.parse` to succeed and must never trust `r.ok` —
the same lesson as the recovery screens.

The `/data` pages currently ship **zero JavaScript**, and that is worth keeping
as a floor: the box is a real `<form>` targeting a generated `/data/search`
page, so with JS off the form still reaches a page and the nav rail still works.
`/data/search?q=…` also makes a result set shareable as a URL.

## Known, measured, and left alone

Searching `chemistry` puts **CHM (Chemistry - CPS)** above **CHEM (Chemistry and
Chemical Biology)**, because coverage prefers the shorter name and CPS's mirror
subject is shorter. It is not a bug to be patched: the only rule that would flip
it is a popularity prior over coverage, and that was measured and refused
(it puts Calculus 3 above Calculus 1). A late tiebreak cannot help either, since
the two scores are not tied — 225 against 116. Both rows appear, each labelled
with its kind, which is the honest outcome for a genuinely ambiguous word.

The single monotonicity drop is the same kind of thing: `Bioe` is the derived
acronym of BSBioE, so every Bioengineering program matches at ACRONYM, and
`Bioen` matches no acronym so they all fall to PREFIX where coverage reorders
them. A long qualified name then loses to the plain ones at the ten-row cutoff.
Legitimate re-ranking, not a lost entity — which is why the contract test
ratchets the rate and demands zero only for absent-at-full-name.

## Open questions

- **Enter jumping to the top hit** is decided, but it should be *gated* on the
  top hit being a router answer or a top-tier match. Jumping on a weak best
  guess navigates away from the one screen that could have shown the right
  answer; falling back to `/data/search?q=…` when the top tier is weak costs one
  click and cannot be wrong.
- **Aliases are a guess.** `orgo` is real, but without query logs there is no
  way to know what else belongs, and the honest set is small — most nicknames
  (`psych`, `bio`) already resolve as prefixes. Cloudflare analytics on
  `/data/search?q=` would eventually supply real data; until then, keep the list
  short and label it a guess.
- **Phone precompute** (20 ms here, possibly ~100–200 ms throttled) needs one
  measurement on a throttled CPU before deciding whether the index ships
  pre-normalized. It happens once, on focus, behind a fetch that costs more —
  so this is a nice-to-know, not a blocker.
- **The alias list is three courses.** It will stay a guess until there is real
  query data; `/data/search?q=` page loads are the only place that could ever
  supply it.
