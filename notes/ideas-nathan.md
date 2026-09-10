# Nathan's ideas

Main

Optional
- Ability to select intended instructor for a semester
- Ability to compare courses side by side





## Next phase big picture: run without us (2026-08-08)

The goal for the next stretch is **autonomy over features**. NU Map should
reach a state where it keeps itself correct with no one watching, and can then
be handed to a club or the school to operate. Accepted cost: less frequent
updates and slower feature rollout. That is the trade, not a regression.

Why now: the build phase is the expensive one, and the resources for it are
not permanent. Time spent hardening is time that never has to be spent again;
time spent on features is time that has to be spent again next semester.

Hand off **operations, not ownership.** `CONTRIBUTING.md` §2–3 already makes
this safe — contributors keep their copyright but grant the Licensor a
sublicensable licence, which is exactly what a commercial licence under
Option B needs. So a club can maintain this indefinitely without collapsing
Option B. Transferring the copyright itself would, so don't.

The work, roughly in order:

1. **Loud failures.** `scrape-rails.js` already makes the scrapers fail *safe*
   — they buffer the whole run and refuse to write on suspected upstream
   breakage. But only `data-changes.yml` handles failure at all;
   `update-courses.yml`, `update-majors.yml`, and `update-grad-majors.yml`
   notify nobody. A safe failure that nobody sees is the worst outcome we
   have: the site keeps serving last month's data and looks perfectly
   healthy, and a student plans a degree against a course that no longer
   exists. Open an issue on failure, with the rails' own diagnosis in the
   body, so it lands somewhere a future maintainer will look.
2. **Staleness as its own alarm.** A run can succeed and still leave the data
   wrong. If `catalog-courses.json` has not moved in ~45 days, something is
   broken even though nothing errored. Check the fact, not the exit code.
3. **A runbook written for a stranger.** What breaks, how you can tell, and
   the shape of the fix — built from the failures that have actually
   happened (merged summer term codes, the `Attribute(s):` selector that
   matched zero blocks, the Tableau escalation path), not from guesses. The
   test of the whole phase is whether someone who did not build this can
   read an issue and act on it.

⚠ Verify against the September 2026 monthly run either way — that is when the
instructor fetch for a synthetic summer term first runs for real.
---

## Ask the registrar: is the minor cap on CREDITS or on COURSES?

The catalog sentence is credits — "a maximum of 50% of the credits required
for a minor" — and `core/minorOverlap.js` implements exactly that, floored to
a whole credit and spent in whole courses.

The simpler rule, and the one a student actually reasons with: **count the
courses of ≥3 SH the minor requires, halve it, round down — that many may
double count.** It is easier to explain, easier to check by hand, and needs no
subset-sum.

It is NOT equivalent, and it is the more generous of the two, which is why it
cannot be adopted on our own authority:

| | credit rule (shipped) | course rule |
|---|---|---|
| CS minor, 23 SH ≈ 6 courses | 11 SH | 3 courses ≈ 12 SH |

So the course rule would let the app permit something the registrar's own
sentence does not. One question settles it — *do you count credits or courses
when you apply the 50% minor rule?* — and if the answer is courses, the
simpler rule wins outright and a good deal of arithmetic comes out.

Worth asking alongside the official-status conversation; see
`docs/` and the § Minors sweep in `scripts/minor-share-probe.js` for the
numbers to put in front of them.


## /data drops every program the edition roll retired (2026-09-09)

Found while fixing the ghost "Data Science" 2027 page. Not caused by that bug,
and deliberately left out of that fix because it is a design decision, not a
defect to repair.

`scripts/build-ai-data.js` emits a `/data` page only for the **newest** catalog
edition (`isNewest`, near the `pageSlugTaken` map). Every other surface —
the picker, the planner, saved plans, the programs bundle — ships all editions.
So at a roll, every program that did not survive it silently loses:

- its `/data/majors/…` (or `/minors/`, `/graduate/`) page,
- its row in the `/data` search index, because `programRecords`
  (`dataEntities.js`) skips any record with no `page`.

Measured on the 2027 roll: **146 programs** are in 2026 and not 2027 — 38
undergraduate, 108 graduate. All 24 undergraduate Data Science programs are in
that number, and a 2026-cohort DS student is exactly the person most likely to
go looking.

It also lets a *worse* page take the slug. `dist/data/majors/data-science.html`
was the department landing page — a wall of course descriptions — while the
real `Data Science, BS (Boston)` had no page at all. Withdrawing the landing
page fixes the theft and not the absence.

The question to settle first, because the work follows from it: **is /data the
current catalog, or is it every edition we ship?** The static surface exists so
a model can fetch facts, and "the program I am enrolled under" is a fact.

Rough shape if the answer is "every edition": keep the unsuffixed slug for the
newest edition (so no URL moves and no redirect is needed), and give older
editions a year-qualified path. The build already refuses to ship an
unsearchable page, so the search index follows for free — but check the cost
first: 1,412 bundle entries against ~750 pages today, so this roughly doubles
the generated surface.
