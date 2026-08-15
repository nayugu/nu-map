// ═══════════════════════════════════════════════════════════════════
// useCourseInk — the current theme's colour for a course
//
// Subject colours are baked into each course record at load time
// (`course.color`), which is right for the 25 palette hues: they are
// theme-independent. A work term is not — it is drawn in the theme's ink,
// white on dark and black on light (see core/courseModel.js → courseInk),
// so it has to be resolved at RENDER time, when the theme is known and can
// change under a mounted card.
//
// Which courses those are is `course.coop`, not anything computed here.
// ═══════════════════════════════════════════════════════════════════
import { useTheme } from "../context/ThemeContext.jsx";
import { courseInk, isInkGroup, INK } from "../core/courseModel.js";

/** True when the dark theme is showing. */
export function useIsDark() {
  const { themeName } = useTheme();
  return themeName === "dark";
}

/** Resolver: `course => colour`, for mapping over a list. */
export function useCourseInkFn() {
  const isDark = useIsDark();
  return course => courseInk(course, isDark);
}

/** The current theme's colour for one course. */
export function useCourseInk(course) {
  return useCourseInkFn()(course);
}

/**
 * A group header's colour: ink only when every course under it is a work
 * term, otherwise the group's own hue. `fallback` is what the header used
 * before — a subject colour, usually.
 */
export function useGroupInk(courses, fallback) {
  const isDark = useIsDark();
  return isInkGroup(courses) ? INK(isDark) : fallback;
}
