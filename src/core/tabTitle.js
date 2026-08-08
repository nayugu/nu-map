// ═══════════════════════════════════════════════════════════════════
// TAB TITLE — what the browser tab says, and therefore what Google prints
// ═══════════════════════════════════════════════════════════════════
// The app's tab scheme is "✎ <active plan> · <app>": a LEADING PENCIL marks
// the user's own working document (tabs truncate from the right, so it survives
// truncation), the SEPARATOR echoes ownership (· = yours, - = a site page), and
// the SUFFIX encodes scope. index.html ships a static, SEO-focused <title>, and
// the app overrides it at runtime.
//
// The catch is that Google RENDERS the app before indexing it, so the override
// ran for the crawler too and put the synthetic first plan — "✎ Plan 1 · NU
// Map" — in the search result where the page's real title belongs. So the
// override has to be earned. A crawler arrives with empty storage and touches
// nothing; the tab is somebody's document only once one of these is true:
// storage from an earlier visit, a second plan, a renamed plan, or a course
// actually placed. Until then the static title stands.
//
// This is not cloaking: the test is the visitor's own state, and a person who
// has done none of it sees exactly what the crawler sees.

// The plan every visitor starts with, untranslated on purpose — it is a name
// the user is free to change, not UI copy.
export const FIRST_PLAN_NAME = "Plan 1";

/** Is this tab the visitor's own document rather than a cold first render? */
export function ownsDocument({ plans = [], activePlanId, placements = {}, hadStoredPlans = false } = {}) {
  // A missing active plan is not a renamed one: there is no name to show, so
  // it must not count as ownership the way an unnamed lookup miss otherwise
  // would (`undefined !== "Plan 1"`).
  const active = plans.find(p => p.id === activePlanId);
  return hadStoredPlans
    || plans.length > 1
    || (!!active && active.name !== FIRST_PLAN_NAME)
    || Object.keys(placements).length > 0;
}

/** The tab title, or null to leave the document's static title alone. */
export function tabTitle({ plans = [], activePlanId, placements, hadStoredPlans, appName } = {}) {
  if (!ownsDocument({ plans, activePlanId, placements, hadStoredPlans })) return null;
  const name = plans.find(p => p.id === activePlanId)?.name;
  return name ? `✎ ${name} · ${appName}` : appName;
}
