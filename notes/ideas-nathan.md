# Nathan's ideas

- Ability to select intended instructor for a semester
- Ability to compare courses side by side

## UI queue (one at a time, in this order)

1. **Search result title says "Plan 1 • NU Map".** The tab title follows the
   active plan name, so a crawler loading the app cold sees the default plan
   and indexes that instead of "Student-Built Northeastern Course Planner —
   NU Map". Want the marketing title for anything that isn't a real session:
   likely keep the static HTML title untouched and only take over the title
   once a plan is actually chosen/renamed (and check og:/twitter: titles and
   any per-page titles in the AI data surface at the same time).
2. **Site-wide logo that links home.** The mark on every NU Map page except
   the dev pages, clicking it goes to numap.app. Open question: mark alone, or
   mark + "NU Map" wordmark.
3. **Colour for a weekly-scheduled class.** The availability section sits right
   above it and teaches green = open / red = closed, so a green or red subject
   colour reading as "weekly" is confusing. Needs a different signal, and the
   popup still has to be designed.
4. **Subject pills should reveal the full subject name on hover** — both the
   course-bank subject rows and the InfoPanel pills, in the same manner and
   style as the availability section's hover today.

## Next phase: run without us (2026-08-08)

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