# Program variants — when one catalog page is more than one program

**Read this before touching `scripts/lib/program-variants.js`, `partitionPanes`,
or anything that decides what a requirement pane means.**

## The short version

A catalog page can publish more than one curriculum. `scripts/lib/program-variants.js`
holds a hand-written decision, per requirement pane, about whether that pane is
*more of this degree* or *another way through it*. A pane nobody has adjudicated
**fails the scrape**. If a monthly job died pointing you here, skip to
[Adjudicating a new pane](#adjudicating-a-new-pane).

## What went wrong

The scrapers assumed **page = program**. `partitionPanes` collected every
`*textcontainer` pane that had tables, excluded the sample plan, and flattened
the rest into one `requirements.json`.

That assumption is false. Northeastern publishes program *variants* two ways:

| How NEU publishes it | Example | Could we model it? |
|---|---|---|
| Separate URLs | `…_phd_(boston)` and `…_phd_(portland)` | Yes — NEU did the splitting for us |
| Separate **panes** on one page | standard entry vs advanced entry | **No.** So we merged them. |

Merging is not cosmetic. Measured across the 2026 catalog, 1017 program pages:

- **46** pages carry more than one requirement pane.
- **35** shipped **159 phantom requirement sections** — a second curriculum's
  requirements, renamed `Core Requirements (2)` and counted as work the student
  does not owe.
- **42** state a *different* credit total in each pane. Electrical Engineering
  PhD is 48 SH by standard entry and 16 SH by advanced entry. Every one of them
  shipped the standard number for both.
- **3** duplicated an entire concentration menu. International Business, BSIB
  listed all 15 business concentrations twice. Public Policy PhD's twin pairs
  differed by 24 SH vs 16 SH with nothing on screen to tell them apart.
- **~36** variant programs were unreachable. A student on the advanced-entry
  track could not select their own curriculum at all.

Two guards should have caught this and did not, which is worth understanding
because both failures are subtle:

1. **`duplicate-concentration-titles`** (severity `high`, in `major-verify.js`)
   compared *finished* titles. By then `uniquify` had already renamed the second
   one to `… (2)`, so they no longer matched. Public Policy PhD shipped as
   `{"level":"verified","issues":0}`. The renamer laundered the evidence before
   the guard looked. It now reads `metadata.titleCollisions`, recorded by the
   parser *at* the rename.
2. **Table reconciliation** (`tablesConsumed === tablesOnPage`) only ever proved
   nothing was *dropped*. It is structurally incapable of noticing something
   counted *twice* — International Business reported a spotless 8/8 while
   reading every pane twice. It is now paired with `assertPaneCoverage`, which
   proves the per-program parses **partition** the page.

## Why this is a table and not a classifier

Two automatic classifiers were built and measured before the table was written.
Both failed, and knowing *how* is what should stop the next person rebuilding one.

**Heading overlap.** Panes restating the same curriculum should share heading
text. Mostly true — 27 of 46 score above 0.7. But Cybersecurity PhD scores
**0.2**, reading as an unrelated continuation, while its pane is plainly
`advancedentryphdprogramrequirementstextcontainer`. It misfiles 8 real variants.

**Credit arithmetic.** A continuation partitions the degree, so its panes should
sum to the stated total; alternatives should overshoot. Principled, and wrong:
it disagrees with the overlap signal on **16 of 45** and gets the clearest case
backwards, calling PharmD's sequential undergraduate and graduate phases
"alternatives".

There are only **eight** distinct secondary pane ids in the entire catalog. At
that size, guessing is strictly worse than deciding. So we decide, once, in
writing — and make the unknown case loud.

## How it works

```
listRequirementPanes(page)        → [{id, el, tables}]           (parser)
planPanes(panes, url)             → {primary, variants}          (decision table)
  ↳ throws UnadjudicatedPaneError on any non-first pane with no decision
parseRequirements(root, profile, {panes})   ─┐
parseTotalCredits(root, profile, {panes})   ─┴─ scoped to one program
assertPaneCoverage(panes, coveredBy, url)   → every pane read exactly once
```

Three properties make this safe:

- **The first pane is always primary, and keeps the folder it has always had.**
  No saved plan, share link or MCP `programId` changes meaning. Variants are new
  siblings, so the change is purely additive. A full corpus re-scrape confirmed
  it: 484 graduate primaries before, 484 after, none lost, none gained, and
  **zero credit totals changed**.
- **Variants reuse the modality mechanism the catalog already has.** NEU writes
  alternate paths as `MSCS—Align`, `BSN—Transfer`. A variant folder is
  `public_policy_phdadvancedentry_(boston)`, which `programNaming.parseProgram`
  renders as *Public Policy, PhD—Advanced Entry*. No new UI, no new id scheme.
  The modality must be registered in `programNaming.MODALITIES`; a unit test
  asserts every entry in the decision table is.
- **A variant gets no sample plan and no plan-of-study witness.** The plan pane
  describes the primary curriculum. Handing it to the advanced-entry record
  would make the verifier report every standard-only course as dropped. A
  witness pointed at the wrong program is worse than no witness.

## Adjudicating a new pane

The scrape stopped with `unadjudicated requirement pane(s) [...] on <url>`. NEU
added a pane shape nobody has classified. This is working as intended — the
alternative is that it silently becomes a duplicate.

1. **Open the page** and find the pane by its `id`. Read the heading above it
   and the prose under it.
2. **Ask one question: does a student do this pane *as well as* the first pane,
   or *instead of* it?**
   - *As well as* → **continuation** → `{ kind: 'merge', why: '…' }`.
     Prerequisites feeding a core; sequential phases of one long degree.
   - *Instead of* → **variant** → `{ kind: 'split', modality, label }`.
     A different entry route, delivery mode, or student population.
3. **Useful tells, in order of reliability.** None of these decides on its own —
   they are prompts for reading the page, not a rule:
   - Does the pane state its **own credit total**, different from the first
     pane's? Strongly suggests a variant.
   - Does it **repeat the first pane's headings**? Suggests a variant.
   - Does it read as a **continuation of a sequence** ("Prerequisite Courses"
     then "Core Requirements")? Suggests a merge.
   - `node scripts/pane-probe.js` prints all of this for the whole corpus.
4. **For a split, pick the modality token.** Lowercase, no punctuation, welded
   onto the degree code. Add it to `MODALITIES` in
   `src/adapters/northeastern/programNaming.js` with its printed label.
5. **Run the tests.** `node --test test/unit/program-variants.test.js` checks
   that the modality is registered and produces a parseable label.
6. **Dry-run the page**:
   `CATALOG_HTML_CACHE=.cache/catalog node scripts/scrape-grad-majors.js --url <url>`
   and confirm the split reads the way the catalog does.

**When in doubt, merge.** A merge reproduces today's behaviour, which is wrong
in a known and bounded way. A wrong split invents a program that does not exist
and puts it in front of students.

## Things not to do

- **Do not re-derive the decision from pane ids at runtime.** They include two
  of NEU's own typos (`cirriculumtextcontainer`, `progratextcontainer`), and a
  word list over them is the same mistake as classifying concentrations by
  heading text — see CLAUDE.md → Major/minor requirements.
- **Do not make the unknown case default to `merge`.** The hard failure *is* the
  fix. Everything else here is bookkeeping.
- **Do not de-duplicate concentrations by title.** Public Policy PhD's twins
  differed by 8 SH; collapsing them would pick one curriculum's credit rule for
  both. Degrade to less information, never to wrong information.
- **Do not let a variant keep the primary's folder.** Ids appear in saved plans,
  share links and MCP `programId`. The PharmD collision recorded in
  `programRegistry.node.js` is what that costs.

## Where the pieces live

| File | Role |
|---|---|
| `scripts/lib/program-variants.js` | The decision table, `planPanes`, `assertPaneCoverage`, `variantSlug` |
| `scripts/lib/program-record.js` | Builds the record(s) for a page — shared by **both** scrapers |
| `scripts/lib/catalog-program-parser.js` | `listRequirementPanes`, the `panes` scope, `titleCollisions` |
| `src/adapters/northeastern/programNaming.js` | `MODALITIES`, `isDegreeToken` — folder ⇄ label |
| `scripts/pane-probe.js` | Corpus instrument: panes, overlap, per-pane credits |
| `test/unit/program-variants.test.js` | The ratchet, coverage, slug and naming contracts |
| `test/contract/major-parser.test.js` | The real fixtures, parsed one program at a time |

## A note on the shared record builder

`scrape-majors.js` and `scrape-grad-majors.js` used to carry a **byte-identical**
`scrapeProgram`. CLAUDE.md already warns that data fixes must land in both
paths; that rule is much easier to keep when there is only one path, so the
record building moved to `scripts/lib/program-record.js`. The scrapers still own
what genuinely differs — profile, output tree, sitemap shape, rails.
