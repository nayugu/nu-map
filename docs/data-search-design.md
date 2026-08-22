# Data-surface search — design

One omnibox on every `/data` page that resolves **any entity on the public data
surface** to its page: a course, a professor, a program, a NUpath code, a
subject, a section hub. Type a name, get the page.

What it is deliberately *not*: prose search and question answering. Course
descriptions and the 7,637 verbatim catalog notes are ~1.1 MB gzipped and would
need a server tier; every measured question below is about *reaching a page*,
not about extracting a fact from one. If that changes, it changes as a second
tier, not by widening this one.

## The inventory

Measured on the 2026-08 build (`dist/data`, 13,081 pages):

| Type | Records | Match keys |
|---|---|---|
| Courses | 7,966 | code (`CHEM 2311`), title, subject |
| Professors | 3,793 | name, either token order |
| Programs | 1,071 | name, degree acronym (`BSCS`), initial-runs (`ie and cs`), kind, college |
| Subjects | ~180 | code + name |
| NUpath | 13 | code (`ND`) + label (`Natural/Designed World`) |
| Section hubs | 7 | Courses, Majors, Minors, Graduate, NUpath, Professors, Equivalences |

≈13,000 records, and every field already exists in what
`scripts/build-ai-data.js` emits today:

| Existing file | Raw | Gzip |
|---|---|---|
| `json/courses/titles.json` | 338 KB | **81 KB** |
| `json/programs/index.json` | 485 KB | **31 KB** |
| `json/professors/*.json` (names only, derived) | ~76 KB | ~25 KB |

## Speed: there is no performance problem

Measured by building the real merged index and timing a real scan
(13,022 records: 7,966 courses / 3,741 professors / 1,071 programs /
231 subjects / 13 NUpath):

| | |
|---|---|
| Index payload, columnar (`{t:[],n:[],e:[]}`) | 534 KB raw → **116 KB gzip / 88 KB brotli** |
| `JSON.parse` of it | **1.5 ms** |
| One-time lowercase + tokenize of all 13,022 | **11.3 ms** |
| **Brute-force scan of every record, per keystroke** | **median 1.1 ms, worst 1.9 ms** |

So the design is: **no trie, no inverted index, no prefix map, no WASM.** A
linear scan over the whole corpus costs about a millisecond, against a 16 ms
frame — in Node here, so assume 2–3× in a browser and it is still nothing. The
entire cost of the feature is an 88 KB fetch and ~13 ms of setup, once, lazily
on first focus. An inverted index would be strictly more code, more build
surface and more ways to be subtly wrong, bought with latency we do not need.

Columnar over an array of objects because it measured smaller on both axes
(534 vs 712 KB raw, 116 vs 132 KB gzip) for the same data — repeated key names
are the difference.

Reaching every page is by construction, not by effort: the index is derived in
the same `buildAiData()` pass, from the same generated JSON that produces the
pages. The existing link rail already fails the build on any internal link that
does not resolve to a generated page; running the index through that same check
means an unreachable entity cannot ship.

## Ranking

`src/core/searchRank.js` already solved the hard half, against 7,146 measured
queries: coverage-of-the-name scoring (so "computer science" beats "Computer
Science and Biology"), acronym tiers ranked by provenance, and initial-runs
("ie" ⇒ Industrial Engineering). It is pure, and today it is program-only. This
work **generalizes it to typed records** rather than adding a second ranker —
two rankers is how "cs" comes out different in two boxes.

Two stages:

1. **Router.** An unambiguous shape wins outright and never gets scored.
   `src/core/courseCodeParse.js` already turns `chem2311`, `chem 2311`,
   `CHEM 2311` into a code; a bare NUpath code and a bare subject code are
   equally decidable. These are exact answers, so scoring them can only make
   them worse.
2. **Coverage ranking across all types**, one comparable score, results
   **grouped by type** with the best of each labelled.

The grouping is the conservative call and the reason it can't be a single row:
`Chemistry` is legitimately a subject, a BS, a minor and an MS. Collapsing that
to one confident answer is the expensive failure. Ambiguity is presented as a
choice; it is never presented as a wrong single answer.

### Why a blended score cannot work, measured

Courses outnumber every other type **6:1**, so a single score lets them flood
the list. A naive coverage-only ranker over the real index returned:

```
"cs"                → CS 2963 Topics, CS 5963 Topics, CS 7990 Thesis…
                      (the CS subject page and the BSCS major: nowhere)
"computer science"  → CS subject, then CS 4973 Topics, CS 6983 Topics…
                      (Computer Science, BSCS: absent from the top 5)
"chemistry"         → "Chemistry - CPS", CHEM 5610 Polymer Chemistry…
                      (Chemistry BS / minor: absent)
```

Adding a **coarse tier** (code > exact > name-prefix > ordered-word-prefix >
any-word > initials), with coverage breaking ties only *inside* a tier, plus a
**fixed display quota per type**, fixes all three without a single tuned weight:

```
"cs"                → CS (subject) ▸ CSYE ▸ CS 1101 Lab…
"computer science"  → CS (subject) ▸ CS Minor ▸ MSCS ▸ PhD ▸ BACS ▸ CS 4950…
"chemistry"         → CHEM ▸ CHM ▸ Chemistry Minor ▸ BS ▸ MS ▸ PhD ▸ CHEM 2117
"machine learning"  → CS 6140 Machine Learning ▸ DADS 7305 ▸ FINA 4390…
"phil 1101"         → PHIL 1101 Introduction to Philosophy   (router, sole answer)
"nd"                → ND Natural/Designed World              (router, sole answer)
"ranganathan"       → Aanjhan Ranganathan                    (only hit)
```

The quota is what makes this robust rather than lucky: the best program, the
best professor and the best subject are *always* visible, whatever 7,966 course
titles happen to say. Latency with tiering and quotas included: median 1.13 ms,
worst 1.85 ms.

`machine learning` also settles the open question about titles-only coverage —
topical queries land, because course titles carry the topic.

### Two gaps the same run exposed, and what they argue

- `cs` did not reach **Computer Science, BSCS**; a hand-rolled word-initials
  rule returned *Clara Shim* instead.
- `ece` returned nothing useful, where it should be Electrical and Computer
  Engineering.

Both are already correct in `searchRank.js` — acronyms drawn from NU's own
degree codes and ranked above derived initials, and initial-runs that skip
connectors so `ece` spans "Electrical **and** Computer Engineering". A 40-line
reimplementation produced worse answers than the module measured over 7,146
queries, which is the case for generalizing that file rather than writing a
second ranker, stated as evidence instead of as taste.

`orgo` is a third kind of miss: a real nickname with nothing to derive it from.
That needs a small hand-written alias list, and nothing else will produce it.

### Decided

- **Enter jumps to the top hit.** The dropdown is for when you want to pick.
- **Typo tolerance is deferred to a measurement**, not assumed. Ship prefix and
  coverage matching first, then run the self-retrieval harness with injected
  typos and read what fraction actually fails. Edit distance buys recall and
  costs precision; the number decides, not the intuition that it "feels
  necessary".

## How we learn whether it is actually good

"Type anything and the right thing pops up" is testable with no usage logs at
all: **self-retrieval over all ~13,000 entities.** Every record generates
queries from its own identity — full name, code, degree acronym, last name
alone — and must return *itself* at rank 1. That yields recall@1 per type and
enumerates every collision by name instead of by anecdote.

Then the hostile pass, which is the one that matters:

- truncated prefixes at every length (does one more letter ever make a match
  *vanish*, the defect `searchRank` found in "ie and c");
- reversed and partial person names;
- cross-type collision names (`Chemistry`, `Business Administration`, `Physics`);
- pure junk, which must return nothing rather than something;
- injected typos, to settle the deferred decision above.

Ratcheted in `test/contract/` so recall@1 cannot silently regress. Runtime is
seconds — it is arithmetic over an index, not a corpus sweep.

First run of it, against the tier+quota prototype: **recall@1 99.8%,
recall@3 100%** over all 13,022 entities. The 0.8‰ are not wrong answers — they
are name-identical records (the subject "Biochemistry" and a course titled
"Biochemistry"; "First-Year Seminar" and "First Year Seminar"), where the
harness demanded a specific index and got its twin. So the harness must score a
tie as a tie; a headline number that counts duplicates as failures is a number
that will get "fixed" by breaking something real.

## Two edges specific to this repo

- **A missing index file is not a 404.** `/* /index.html 200` in
  `public/_redirects` answers any unknown path with the SPA shell at status 200.
  Same trap the recovery screens document: the loader must require
  `JSON.parse` to succeed and must not trust `r.ok`.
- **The index and the script ship under `/assets/`**, content-hashed. That path
  already carries `immutable, max-age=1y` (`public/_headers`) and is already
  exempted from the zone's Human-Verification rule. A new `/data/*.js` path is a
  fresh path against that rule, and a zone rule matching an asset path is
  exactly what made the catalog 500 before. Not worth re-learning.

## Architecture

The framing that makes this fit: **the data surface is a third driving adapter
onto the same pure core**, alongside the React app and the MCP server. It is not
a feature of the app, so it does not belong in `src/ui/`; and it is not
institution-neutral either, so it does not all belong in `src/core/`. Five
modules, each with one job:

```
src/core/nameMatch.js         pure matching primitives            (new, extracted)
src/core/searchRank.js        program ranking, API unchanged       (existing)
src/core/entitySearch.js      tiers, router, quotas, wire format   (new)
src/adapters/northeastern/dataEntities.js
                              which kinds exist, URL grammar,
                              quotas, aliases                      (new)
scripts/build-ai-data.js      emits the index + bundles the client (existing)
build/data-search/client.js   plain-DOM widget                     (new)
```

### `src/core/nameMatch.js` — extraction, not rewrite

`searchRank.js` already contains exactly the primitives this needs: `words`,
`coverage`, `orderedPrefixes`, `anyPrefixes`, `orderedInitials`, `anyInitials`,
`isSubsequence`, the `CONNECTORS` set, the tier table and `COV_MAX`. They move
out **verbatim**. `searchRank` keeps `rankOptions` and the parts that are
genuinely about programs — `fieldsOf`, `campusRank`, `credentialRank`,
`degreePref`, `nameLen` — and imports the rest.

The public API does not change, so `src/data/majorLoader.js` and the program
search UI are untouched, and `test/unit/search-rank.test.js` runs **unmodified**
as the proof that the extraction changed no behavior. That test file is the
whole reason this is safe: a rewrite would have thrown away the 7,146-query
result, an extraction inherits it.

Inherited for free, and worth knowing before writing anything new: `rankOptions`
already carries a typo fallback — in-order subsequence matching, ranked below
every strict tier, armed only when strict matches number fewer than five. So
typo tolerance is not a thing to add; it is a thing to *measure*, and the
harness will say whether the inherited version suffices.

### `src/core/entitySearch.js` — pure, generic, institution-blind

Operates on a record shape that says nothing about Northeastern:

```js
{ kind, name, code?, aliases?, extra? }
```

Exports `rankEntities(index, query)`, `bucketize(hits, quotas)`, and —
importantly — `encodeIndex` / `decodeIndex` for the columnar wire format. The
codec lives here, in **one** place, because the producer is a build script and
the consumer is a browser bundle: the two-ended failure this repo already paid
for once is a parser emitting `courses` while the renderer read `children`
(see the `areasubheader` notes). One definition plus a round-trip contract test
makes that drift unrepresentable.

It knows nothing about NUpath, professors, URLs, `fetch`, or the DOM. Everything
it does is a pure function of (index, query).

### `src/adapters/northeastern/dataEntities.js` — the institution's part

The descriptor: which kinds exist, how each record is derived from the generated
data, the URL grammar per kind, the display quota per kind, the router
predicates (delegating course codes to `core/courseCodeParse.js`), and the alias
table — `orgo`, and whatever else measurement turns up. Data and thin functions,
no ranking logic.

This is the seam that makes the whole thing extensible, and it is worth stating
as a check rather than a hope:

- **A new entity kind** — co-op employers, equivalence pairs, concentrations —
  is one descriptor entry. `entitySearch` is untouched.
- **A second institution** is `adapters/<school>/dataEntities.js`. Core untouched.
- **The app's own boxes** (`CompanySearch`, `CoopCourseSearch`, program search)
  can converge on the same ranker, because it is pure core.
- **An MCP `find` tool** that resolves any name to a URL is the same two imports.
  This is the strongest reason the ranker must not live inside the build script.

### No new port, deliberately

A port abstracts *behavior the app calls, with swappable implementations*.
Here the varying part is a declarative descriptor, the consumers are a build
script and a static page rather than the app, and there is exactly one
institution. An `IDataSearch` today would be a port with one implementation and
no caller inside the hexagon — ceremony that has to be maintained without
paying for itself. The descriptor shape is designed so that promoting it later
is mechanical: when the React app's boxes route through it *and* a second
institution exists, it becomes a port then.

Note that `scripts/build-ai-data.js` already imports
`adapters/northeastern/descriptionPrereq.js` directly. Build scripts sit outside
the hexagon, so importing an adapter plus core is the established precedent, not
a new exception.

### `build/data-search/client.js` — why not `src/ui/`

The rule is that `src/ui/` imports ports only. This widget is plain DOM, ships
in no app bundle, and belongs to a build artifact — so putting it in `src/ui/`
would mean either bending that rule or inventing a port to satisfy it. `build/`
already holds `aiDataDevPlugin.js`, and this is the same category of thing. It
imports `core/entitySearch.js`, does the `fetch`, guards the `JSON.parse`,
debounces, and renders. That is all it does; anything rankable that ends up in
here is in the wrong file.

### Testing, by layer

| Layer | What it proves |
|---|---|
| `test/unit/search-rank.test.js`, **unchanged** | the extraction changed no behavior |
| `test/unit/name-match.test.js` | the primitives, directly |
| `test/unit/entity-search.test.js` | tiers, router, quota arithmetic |
| `test/contract/data-search-index.test.js` | `encodeIndex`/`decodeIndex` round-trip; every record's URL resolves to a generated page; self-retrieval ratchet, tie-aware |
| headless boot check | the script actually runs on a built page — a green Node suite says nothing about that |

## Placement of the artifacts

`buildAiData()` esbuild-bundles the client to `/assets/data-search-<hash>.js`
and emits `/assets/data-index-<hash>.json`, both referenced from the page chrome
in `writePage`.

The `/data` pages currently ship **zero JavaScript**, and that property is worth
keeping as a floor: the box is a real `<form>` whose target is a generated
`/data/search` page, so with JS off the form still resolves to a page and the
nav rail still works. `/data/search?q=…` is also what makes a result set
shareable as a URL.

## Open, and cheap to answer

Titles-only means "machine learning" hits only courses whose *title* says so.
Before deciding that's a gap, count how many subject-word queries have a title
match at all — the answer is probably "most", and it costs one pass over
`titles.json` to know.
