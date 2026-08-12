# Nathan's ideas

Main
- Engine to create sample plans (especially since we have a lot more information and we can use information theory to build really good sample plans)
- Mass import and export (Matthew is already working on this)
- Search function on the data pages

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