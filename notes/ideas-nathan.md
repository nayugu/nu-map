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