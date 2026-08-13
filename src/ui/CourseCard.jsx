// ═══════════════════════════════════════════════════════════════════
// COURSE CARD  — individual draggable course tile
// ═══════════════════════════════════════════════════════════════════
import { useState } from "react";
import { usePlanner }     from "../context/PlannerContext.jsx";
import { useRelevance }   from "../context/RelevanceContext.jsx";
import { usePort }        from "../context/InstitutionContext.jsx";
import { ICreditSystem }  from "../ports/ICreditSystem.js";
import { ICalendar }      from "../ports/ICalendar.js";
import { ICourseOffering } from "../ports/ICourseOffering.js";
import { REL_STYLE } from "../core/constants.js";
import { baseId, takesUsed } from "../core/repeatInstances.js";
import CourseReviewPopover from "./CourseReviewPopover.jsx";
import { takeConsumesSlot } from "../core/gradeSystem.js";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useTheme }    from "../context/ThemeContext.jsx";
import { useTranslatedText, scaleLatinRuns } from "../context/TranslationContext.jsx";

// Vibrance-preserving relevance fade, hue-pure in both themes and
// gentler than the nominal k in both (fading reads stronger than the
// numbers suggest):
//  - dark: scale the RGB channels toward black at 60% strength — a pure
//    shade of the same hue. (Don't pin HSL saturation while darkening:
//    chroma peaks at mid-lightness, so that makes colours MORE intense.)
//  - light: raise HSL lightness toward a 0.92 ceiling at 80% strength
//    with saturation pinned, so tints stay candy-bright instead of
//    washing toward grey the way a plain white mix would.
function fadeSubjectColor(hex, k, isDark) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  if (isDark) {
    const sc = v => Math.round(v * 255 * (1 - k * 0.6));
    return `rgb(${sc(r)},${sc(g)},${sc(b)})`;
  }
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    h = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  }
  l = l + (0.92 - l) * k * 0.8;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [rr, gg, bb] =
    h < 60  ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `rgb(${Math.round((rr + m) * 255)},${Math.round((gg + m) * 255)},${Math.round((bb + m) * 255)})`;
}

// Optional grade entry — a badge chip that opens the course review popover
// (the schedule-popover shape) on click. Rendered only on courses in
// COMPLETED semesters: grades are facts about the past. The rect is
// captured eagerly at click time — reading it inside a state updater from
// a pooled event was a real crash in the verification pill.
//
// `pop`/`setPop` live in the CARD, not here: the empty chip renders on
// hover, and if the popover's lifetime were tied to the chip's render,
// hover-state and open-state fight — the chip lingered after dismissing,
// and a mouse-out could kill an open popover. The card keeps the chip
// mounted exactly while (hovered || graded || open).
// The chip opens grade AND rating together: they are the same question
// ("you took this — how did it go?") and splitting them across two
// surfaces would leave the second one undiscovered. `pid` carries the
// grade (per placement, so a retake keeps its own); `courseId` carries the
// rating (per catalog course + term, so a retake in another term is a
// separate report rather than an average of two different experiences).
function GradeChip({ pid, courseId, semId, grade, setGrade, t, pop, setPop, compact = false }) {
  return (
    <>
      <span
        draggable={false}
        title={t("course.grade.tooltip")}
        aria-label={t("course.grade.tooltip")}
        onPointerDown={e => e.stopPropagation()}
        onClick={e => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          setPop(p => (p ? null : r));
        }}
        style={{
          fontSize: compact ? 7 : 9, fontWeight: 700,
          // one grey lighter than the course title (--text-3): present but quiet
          color: grade ? "var(--text-4)" : "var(--text-5)",
          background: "var(--badge-bg)",
          border: grade ? "1px solid var(--border-card)" : "1px dashed var(--text-5)",
          borderRadius: 3, padding: compact ? "0 3px" : "1px 4px",
          cursor: "pointer", lineHeight: 1.2, textAlign: "center", flexShrink: 0,
          minWidth: compact ? 8 : 12, display: "inline-block",
        }}
      >
        {grade ?? "–"}
      </span>
      {pop && (
        <CourseReviewPopover pid={pid} courseId={courseId} semId={semId}
                             grade={grade} rect={pop}
                             setGrade={setGrade} onDismiss={() => setPop(null)} />
      )}
    </>
  );
}

/**
 * @param {object} course   - normalised course object
 * @param {boolean} inSem   - true when rendered inside the timeline
 * @param {string|null} semId - semester id (null when in bank)
 */
export default function CourseCard({ course, inSem, semId, noSubject = false }) {
  const {
    selectedId, setSelectedId, setShowPanel,
    connectedIds, prereqViolations, coreqViolations,
    dragInfo, hoveredCardId, setHoveredCardId,
    getSemStatus, offeredOverrides, SEMESTERS, SEM_INDEX,
    starredIds, toggleStar,
    onDragStart, onDropOnCard, cardRefs,
    isPhone, shOverrides, setShOverride,
    claudePreview,
    placements, placedOut,
    grades, setGrade, enteredGpaStat, privateGrades,
  } = usePlanner();

  // Private mode is READ-ONLY for grades. The chip would otherwise still
  // appear on hover showing "–" (the view is empty), so a click could
  // silently overwrite a real grade with no way to see what you did —
  // editing blind over data you deliberately hid.
  // A reservation has no course, so there is nothing to grade. The chip is
  // also gated on the semester being completed, which is why it only appeared
  // on some of them. Gating here covers both places it renders — and both
  // places it would need remembering.
  const canEditGrades = !privateGrades && !course.isReservation;

  // A GPA gate stated in the course description (3 courses corpus-wide,
  // e.g. BNSC 4971 "Requires a 3.500 GPA"). Flags only when the entered
  // GPA provably misses it — silent with no grades, like every other
  // grade-derived warning.
  const gpaGateMissed = inSem && course.minGPA != null
    && enteredGpaStat != null && enteredGpaStat.gpa < course.minGPA - 1e-9;

  // Claude proposal ghost: this card is added/moved (orange dashed ring),
  // removed (strike-through, faded), or has a credit change in the
  // previewed changeset.
  const isClaudeGhost = inSem && claudePreview != null &&
    (claudePreview.added?.[course.id] !== undefined ||
     claudePreview.moved?.[course.id] !== undefined ||
     claudePreview.shOvChanged?.has?.(course.id));
  const isClaudeRemoved = inSem && claudePreview != null &&
    claudePreview.removed?.has?.(course.id);
  const creditSystem = usePort(ICreditSystem);
  const calendar     = usePort(ICalendar);
  const { t }        = useLanguage();
  const title        = useTranslatedText(course.title);

  const [editingSh, setEditingSh] = useState(false);
  const [gradePop, setGradePop]   = useState(null); // grade popover anchor rect while open
  const [isMouseHov, setIsMouseHov] = useState(false);
  // Closing the popover also drops hover: the pointer may have travelled to
  // the popover (or off the card entirely) while the portal was up, and the
  // card can't observe that. Without this the empty chip lingers on a card
  // the pointer already left.
  const closeGradePop = (v) =>
    setGradePop(prev => {
      const next = typeof v === "function" ? v(prev) : v;
      if (!next) setIsMouseHov(false);
      return next;
    });

  const isSel         = selectedId === course.id;
  // Repeat-take awareness: sibling = another representation of the SELECTED
  // course — its other takes on the grid AND its bank row — ringed quietly so
  // every appearance reads as one course. multiTake = one of several placed
  // takes (gets a ↻ glyph — an intentional duplicate, not a data bug).
  const isSibling  = !isSel && selectedId != null && baseId(selectedId) === baseId(course.id);
  // Counted for nonrepeatable courses too: a retake (unlocked by an entered
  // grade) is also multiple takes and earns the same ↻ marker.
  const takeCount  = inSem ? takesUsed(baseId(course.id), placements, placedOut, SEM_INDEX) : 0;
  const multiTake  = takeCount > 1;
  // More takes than the catalog allows: permitted (trust the user), warned.
  const overTakes  = multiTake && course.repeatMax != null && takeCount > course.repeatMax;
  const relType       = connectedIds[course.id];
  const isConn        = !!relType;
  const isViolated    = prereqViolations.has(course.id);
  const violationType = prereqViolations.get(course.id);
  const coreqViol     = inSem ? coreqViolations.get(course.id) : undefined;
  const isDone        = inSem && semId ? getSemStatus(semId) === "completed" : false;
  const hasSel        = selectedId !== null;
  const isCardHov     = hoveredCardId === course.id && dragInfo?.id !== course.id;

  // Offered-semester warning — probability-based (≤ 50% triggers ⚠).
  // Explicit override in offeredOverrides[course.id][semTypeId] takes precedence:
  //   true  = force-offered (suppress warning)
  //   false = force-not-offered (always warn)
  //   absent = auto: warn only when historical probability ≤ 0.5
  //
  // Only post-birth entries count: termHistory entries before course.birthTermCode are
  // pre-existence Banner noise (the course didn't exist yet, it just wasn't offered).
  // Also requires ≥ 2 post-birth entries for the semType before flagging — one false
  // entry after a course is first offered isn't enough evidence it's never offered there.
  const semMeta    = semId ? SEMESTERS.find(s => s.id === semId) : null;
  const semOffType = inSem ? semMeta?.semTypeId ?? null : null;
  // ── ONE availability rule, reached through a port ────────────────
  //
  // This block restated `effectiveOffered` inline — the post-birth filter, the
  // two-entries-minimum, the 50% bar and the override precedence, all copied. That made
  // FOUR implementations of one judgement: this, `effectiveOffered` itself, a local
  // `semTypeProb` in InfoPanel, and the engine's `offeringProbability !== 0`, which asked a
  // strictly weaker question and therefore disagreed.
  //
  // The disagreement was not hypothetical. `CS 3800` is recorded in Summer B once in four
  // years, so CHART placed it in a Summer B — legal by its rule, `offered?` by this one —
  // and shipped a plan the app itself flagged. There was no port to hold the rule, so the
  // hexagonal boundary made copying it the path of least resistance; `ICourseOffering` is
  // that missing port.
  const offering = usePort(ICourseOffering);
  let notOffered = false;
  if (inSem && semOffType && semMeta?.type !== "special") {
    notOffered = !offering.offered(course, semOffType, offeredOverrides[course.id]);
  }

  let borderColor = isCardHov ? "var(--active)" : "var(--border-card)";
  if (coreqViol)                                                borderColor = "var(--warn-bright)";  // always wins
  else if (notOffered)                                          borderColor = "var(--warn-bright)";
  else if (isConn && relType === "corequisite" && coreqViol)    borderColor = "var(--warn-bright)";
  // Connected (prereq/coreq) rims keep the vibrant relation colour but at reduced
  // opacity so they read as secondary to the glowing selected card. Warning
  // relations (wrong-order red) stay full strength.
  else if (isConn && relType === "corequisite")                 borderColor = REL_STYLE.corequisite.color + "c0";
  else if (isViolated)                                          borderColor = violationType === "order" ? "var(--error)" : "var(--error-border-2)";
  else if (isConn)                                              borderColor = (relType === "prerequisite" || relType === "substitution-prereq") ? REL_STYLE[relType].color + "c0" : (REL_STYLE[relType]?.color ?? "var(--active)");

  // Red background tint for ordering violations (prereq placed after the course)
  const orderViolBg = inSem && violationType === "order";

  // Sibling takes are exempt from selection-dimming — they ARE the selected
  // course, just another take of it.
  const dimmed = hasSel && !isSel && !isConn && !isSibling;

  // Relevance fade — courses allocated to the selected major(s) /
  // concentration keep their full subject colour, minor courses a step
  // below, everything else slightly below that, so the vibrant colours
  // form a hierarchy instead of competing. Only the colour-bearing
  // elements (stripe + code) fade, via alpha over the card background:
  // that yields a lighter tint of the same hue (vibrance-preserving)
  // rather than greying the whole card. Selection focus, connection
  // highlighting and bank cards are exempt.
  // The code text fades half as much as the stripe — it carries the
  // card's identity, so it should stay closer to full strength.
  const { active: relevanceOn, majorKeys, minorKeys } = useRelevance();
  const { themeName } = useTheme();
  let stripeColor = course.color, codeColor = course.color;
  if (inSem && relevanceOn && !isSel && !isConn) {
    const key = `${course.subject}${course.number}`;
    if (!majorKeys.has(key)) {
      const isMinor = minorKeys.has(key);
      const isDark  = themeName === "dark";
      stripeColor = fadeSubjectColor(course.color, isMinor ? 0.2 : 0.35, isDark);
      codeColor   = fadeSubjectColor(course.color, isMinor ? 0.1 : 0.175, isDark);
    }
  }
  // A definitively failed take (F/U/W) is VOID — the slot is spent, the
  // attempt earns nothing. Same fade motif as relevance, at much higher
  // strength: light mode lifts toward white with saturation pinned
  // (lighter AND softer), dark mode scales toward black. Wins over the
  // relevance fade; distinct from opacity-dimming (unrelated-to-selection)
  // and from red (violation).
  const voidTake = inSem && grades[course.id] != null && !takeConsumesSlot(grades[course.id]);
  if (voidTake) {
    const isDark = themeName === "dark";
    stripeColor = fadeSubjectColor(course.color, 0.8, isDark);
    codeColor   = fadeSubjectColor(course.color, 0.65, isDark);
  }

  // Selection glow — tinted with the course's own subject colour. Only the
  // selected card glows; connected (prereq/coreq) cards get a rim change only,
  // so the clicked card stays the sole focal point.
  //
  // Normalise the subject colour in HSL: lift only the *lightness* to a floor so
  // dark/muted subjects (maroon, grey math) still glow lively, while preserving
  // saturation so vivid subjects (e.g. CS green) stay rich instead of washing
  // out to pastel (mixing toward white was the cause of the pastel look).
  // (course.color is a 6-digit hex from SUBJECT_PALETTE.)
  const _rgb = (() => {
    const n = parseInt(course.color.slice(1), 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let l = (max + min) / 2;
    const s = d === 0 ? 0 : (l > 0.5 ? d / (2 - max - min) : d / (max + min));
    let h = 0;
    if (d !== 0) {
      h = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
    }
    l = Math.max(l, 0.6);                                          // bright floor; saturation untouched
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    const [rr, gg, bb] =
      h < 60  ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
      h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return `${Math.round((rr + m) * 255)},${Math.round((gg + m) * 255)},${Math.round((bb + m) * 255)}`;
  })();
  const selGlow  = `0 0 6px 1px rgba(${_rgb},0.6), 0 0 15px 2px rgba(${_rgb},0.36)`;
  // Sibling takes glow softer than the selection itself — same hue, no bloom.
  const sibRing  = `0 0 0 1.5px rgba(${_rgb},0.5)`;

  // ── Mobile: bank card — code + star only ────────────────────
  if (isPhone && !inSem) {
    return (
      <div
        draggable
        data-drag-id={course.id}
        data-drag-type="course"
        onDragStart={e => onDragStart(e, course.id, "course", null)}
        onClick={e => {
          e.stopPropagation();
          if (selectedId === course.id) { setSelectedId(null); setShowPanel(false); }
          else { setSelectedId(course.id); setShowPanel(true); }
        }}
        style={{
          position: "relative",
          background: isCardHov ? "var(--card-bg-hov)" : "var(--card-bg)",
          border: `2px solid ${borderColor}`,
          borderRadius: 6, padding: "2px 5px 2px 8px",
          cursor: "grab", userSelect: "none", touchAction: "manipulation",
          display: "flex", alignItems: "center", minHeight: 18,
          opacity: dimmed ? 0.35 : 1,
          transition: "opacity 0.15s, border-color 0.15s, background 0.1s",
          boxShadow: isSel ? selGlow : isCardHov ? "var(--shadow-card-hov)" : "none",
        }}
      >
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: course.color, borderRadius: "4px 0 0 4px" }} />
        <span style={{ fontSize: 8, fontWeight: 800, color: course.color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {noSubject ? course.code.replace(/^[A-Z]+ /, "") : course.code}
        </span>
      </div>
    );
  }

  // ── Phone: planner card ── code + SH, no title ──────────────
  if (isPhone && inSem) {
    return (
      <div
        ref={el => { cardRefs.current[course.id] = el; }}
        draggable
        data-drag-id={course.id}
        data-drag-type="course"
        data-drag-from={semId}
        onDragStart={e => onDragStart(e, course.id, "course", semId)}
        onDragOver={e => {
          if (!dragInfo || dragInfo.type !== "course" || dragInfo.id === course.id || !inSem) return;
          e.preventDefault(); e.stopPropagation();
          setHoveredCardId(course.id);
        }}
        onDragLeave={() => setHoveredCardId(null)}
        onDrop={e => inSem ? onDropOnCard(e, course.id, semId) : undefined}
        onClick={e => {
          e.stopPropagation();
          if (selectedId === course.id) { setSelectedId(null); setShowPanel(false); }
          else { setSelectedId(course.id); setShowPanel(true); }
        }}
        style={{
          position: "relative",
          background: orderViolBg ? "var(--card-bg-viol)" : isCardHov ? "var(--card-bg-hov)" : "var(--card-bg)",
          border: `2px solid ${borderColor}`,
          borderRadius: 5, padding: "1px 4px 1px 8px",
          cursor: "grab", userSelect: "none", touchAction: "manipulation",
          display: "flex", alignItems: "center", gap: 3,
          minHeight: 17, minWidth: 0, overflow: "hidden",
          opacity: dimmed ? 0.35 : 1,
          transition: "opacity 0.15s, border-color 0.15s, background 0.1s",
          boxShadow: isSel ? selGlow : isSibling ? sibRing : isCardHov ? "var(--shadow-card-hov)" : "none",
        }}
      >
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: stripeColor, borderRadius: "3px 0 0 3px" }} />
        {/* Shrink code + SH when a warning icon is present so code is always readable */}
        <span style={{ fontSize: (isViolated || notOffered || coreqViol) ? 8 : 10, fontWeight: 800, color: codeColor, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {course.code}
        </span>
        <span style={{ fontSize: (isViolated || notOffered || coreqViol) ? 7 : 10, color: "var(--text-4)", background: "var(--badge-bg)", borderRadius: 3, padding: "1px 3px", flexShrink: 0 }}>
          {shOverrides[course.id] ?? course.sh}
        </span>
        {/* Grade entry (phone): completed semesters only, and only once
            selected or already graded — the 17px card row has no room for
            a resting affordance on every card */}
        {canEditGrades && isDone && (isSel || grades[course.id] != null || gradePop) && (
          <GradeChip pid={course.id} courseId={baseId(course.id)} semId={semId}
            grade={grades[course.id]} setGrade={setGrade} t={t}
                     pop={gradePop} setPop={closeGradePop} compact />
        )}
        {(isViolated || notOffered || coreqViol) && (
          isViolated && violationType === "order" ? (
            <span title={t("course.tooltip.prereq.order")}
              style={{ fontSize: 7, fontWeight: 700, color: "var(--error-bg)", background: "var(--error-text)", borderRadius: 3, padding: "1px 3px", lineHeight: 1, flexShrink: 0 }}>
              {t("course.badge.prereq.order")}
            </span>
          ) : (
            <span style={{ fontSize: 11, color: isViolated ? "var(--error-text)" : "var(--warn)", flexShrink: 0 }}>
              {isViolated ? "!" : notOffered ? "⚠" : "⚡"}
            </span>
          )
        )}
      </div>
    );
  }

  return (
    <div
      ref={el => { if (inSem) cardRefs.current[course.id] = el; }}
      draggable
      data-drag-id={course.id}
      data-drag-type="course"
      data-drag-from={inSem ? semId : undefined}
      onDragStart={e => onDragStart(e, course.id, "course", inSem ? semId : null)}
      onMouseEnter={() => setIsMouseHov(true)}
      onMouseLeave={() => setIsMouseHov(false)}
      onDragOver={e => {
        if (!dragInfo || dragInfo.type !== "course" || dragInfo.id === course.id || !inSem) return;
        e.preventDefault(); e.stopPropagation();
        setHoveredCardId(course.id);
      }}
      onDragLeave={() => setHoveredCardId(null)}
      onDrop={e => inSem ? onDropOnCard(e, course.id, semId) : undefined}
      onClick={e => {
        e.stopPropagation();
        if (selectedId === course.id) { setSelectedId(null); setShowPanel(false); }
        else { setSelectedId(course.id); setShowPanel(true); }
      }}
      style={{
        flex: inSem ? "1 1 110px" : "1 1 0%", minWidth: 0, minHeight: 58, flexShrink: 1, overflow: "hidden",
        position: "relative",
        background: orderViolBg ? "var(--card-bg-viol)" : isCardHov ? "var(--card-bg-hov)" : "var(--card-bg)",
        border: (isClaudeGhost || isClaudeRemoved) ? "2px dashed #fb923c" : `2px solid ${borderColor}`,
        borderRadius: 6,
        padding: inSem ? "4px 6px 4px 10px" : "4px 6px 4px 30px",
        cursor: "grab", userSelect: "none",
        touchAction: "manipulation",
        opacity: dimmed ? 0.35 : isClaudeRemoved ? 0.45 : isClaudeGhost ? 0.75 : 1,
        textDecoration: isClaudeRemoved ? "line-through" : "none",
        transition: "opacity 0.15s, border-color 0.15s, background 0.1s",
        boxShadow: isSel          ? selGlow
                 : isSibling      ? sibRing
                 : isCardHov      ? "var(--shadow-card-hov)"
                 : isMouseHov     ? "inset 0 -3px 0 rgba(0,0,0,0.14)"
                 : "none",
      }}
    >
      {/* Subject colour stripe */}
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: 4,
        background: stripeColor, borderRadius: "4px 0 0 4px",
      }} />

      {/* Star toggle — bank cards only */}
      {!inSem && (
        <button
          onClick={e => { e.stopPropagation(); toggleStar(course.id); }}
          title={starredIds.has(course.id) ? t("course.star.remove") : t("course.star.save")}
          style={{
            position: "absolute", left: 4, top: 0, bottom: 0, width: 24,
            background: starredIds.has(course.id) ? "var(--warn-bg)" : "transparent",
            border: "none", padding: 0, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, lineHeight: 1,
            color: starredIds.has(course.id) ? "var(--warn-bright)" : "var(--text-5)",
            transition: "color 0.12s, background 0.12s",
          }}
        >
          {starredIds.has(course.id) ? "★" : "☆"}
        </button>
      )}

      {/* Course code */}
      <div style={{
        fontSize: 11, fontWeight: 800, color: codeColor,
        letterSpacing: "0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        display: "flex", alignItems: "baseline", gap: 3,
      }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{course.code}</span>
        {course.isCps && <span style={{ fontWeight: 500, fontSize: 8, color: "var(--text-4)", flexShrink: 0 }}>· CPS</span>}
        {multiTake && (
          <span
            title={t("bank.repeat.title").replace("{used}", String(takeCount)).replace("{max}", String(course.repeatMax ?? "∞"))}
            style={{ fontWeight: overTakes ? 700 : 500, fontSize: 9, color: overTakes ? "var(--error)" : "var(--text-4)", flexShrink: 0 }}
          >↻{overTakes ? " ⚠" : ""}</span>
        )}
      </div>

      {/* Title */}
      <div style={{
        fontSize: 10, color: "var(--text-3)", lineHeight: "calc(1.25 * var(--lh-scale, 1))",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 2,
      }}>
        {title ? scaleLatinRuns(title)
          /* "No title" means a course whose title we failed to scrape. A
             reservation has no title BY NATURE — it is a decision, not a
             course — so the placeholder is a false report about our data.
             It shows its requirement when the plan named one, and nothing
             when it did not. */
          : course.isReservation ? null
          : <span style={{ color: "var(--text-5)", fontStyle: "italic" }}>{t("course.no.title")}</span>}
      </div>

      {/* Badges */}
      <div style={{ display: "flex", gap: 3, flexWrap: "wrap", alignItems: "center" }}>
        {course.shMax ? (
          editingSh ? (
            <input
              type="number" autoFocus
              defaultValue={shOverrides[course.id] ?? course.sh}
              min={course.shMin ?? course.sh} max={course.shMax} step={1}
              style={{ width: 38, fontSize: 9, padding: "1px 3px", borderRadius: 3,
                border: "1px solid var(--active)", background: "var(--badge-bg)",
                color: "var(--text)", fontWeight: 700 }}
              onClick={e => e.stopPropagation()}
              onKeyDown={e => {
                if (e.key === "Escape") { setEditingSh(false); return; }
                if (e.key === "Enter") {
                  const v = parseInt(e.target.value, 10);
                  const lo = course.shMin ?? course.sh, hi = course.shMax;
                  if (!isNaN(v) && v >= lo && v <= hi) setShOverride(course.id, v);
                  setEditingSh(false);
                }
              }}
              onBlur={e => {
                const v = parseInt(e.target.value, 10);
                const lo = course.shMin ?? course.sh, hi = course.shMax;
                if (!isNaN(v) && v >= lo && v <= hi) setShOverride(course.id, v);
                setEditingSh(false);
              }}
            />
          ) : (
            <span
              onClick={e => { e.stopPropagation(); setEditingSh(true); }}
              title={t("course.tooltip.variable-sh", { min: course.shMin ?? course.sh, max: course.shMax, unit: creditSystem.getUnitName() })}
              style={{ fontSize: 9, color: "var(--active)", background: "var(--badge-bg)",
                borderRadius: 3, padding: "1px 4px", cursor: "text",
                borderBottom: "1px dashed var(--active)", userSelect: "none" }}
            >
              {shOverrides[course.id] ?? course.sh}/{course.shMax} {creditSystem.getUnitName()}
            </span>
          )
        ) : (
          <span style={{ fontSize: 9, color: "var(--text-4)", background: "var(--badge-bg)", borderRadius: 3, padding: "1px 4px" }}>
            {course.sh} {creditSystem.getUnitName()}
          </span>
        )}
        {/* Grade entry (desktop): completed semesters only. Entered grades
            always show; the empty affordance appears on HOVER only (tying
            it to selection left a stray "–" chip after Clear grade), and
            stays mounted while its popover is open so the popover survives
            the pointer leaving the card — and vanishes with the dismiss. */}
        {canEditGrades && inSem && isDone && (grades[course.id] != null || isMouseHov || gradePop) && (
          <GradeChip pid={course.id} courseId={baseId(course.id)} semId={semId}
            grade={grades[course.id]} setGrade={setGrade} t={t}
                     pop={gradePop} setPop={closeGradePop} />
        )}
        {isViolated && violationType === "order" && (
          <span title={t("course.tooltip.prereq.order")}
            style={{ fontSize: 9, fontWeight: 700, color: "var(--error-bg)", background: "var(--error-text)", borderRadius: 3, padding: "1px 3px", lineHeight: 1 }}>
            {t("course.badge.prereq.order")}
          </span>
        )}
        {isViolated && violationType === "missing" && (
          <span title={t("course.tooltip.prereq.missing")}
            style={{ fontSize: 9, fontWeight: 700, color: "var(--error-text)", background: "var(--error-bg)", borderRadius: 3, padding: "1px 3px", lineHeight: 1 }}>
            {t("course.badge.prereq")}
          </span>
        )}
        {isViolated && violationType === "grade" && (
          <span title={t("course.tooltip.prereq.grade")}
            style={{ fontSize: 9, fontWeight: 700, color: "var(--error-text)", background: "var(--error-bg)", borderRadius: 3, padding: "1px 3px", lineHeight: 1 }}>
            {t("course.badge.prereq.grade")}
          </span>
        )}
        {gpaGateMissed && (
          <span title={t("course.tooltip.gpa.gate", { gpa: course.minGPA.toFixed(3) })}
            style={{ fontSize: 9, fontWeight: 700, color: "var(--warn)", background: "var(--warn-bg)", border: "1px solid var(--warn-bright)", borderRadius: 3, padding: "1px 3px", lineHeight: 1 }}>
            {t("course.badge.gpa.gate")}
          </span>
        )}
        {coreqViol === "alone" && (
          <span title={t("course.tooltip.coreq.alone")}
            style={{ fontSize: 9, fontWeight: 700, color: "var(--warn)", background: "var(--warn-bg)", border: "1px solid var(--warn-bright)", borderRadius: 3, padding: "1px 3px", lineHeight: 1 }}>
            {t("course.badge.coreq.alone")}
          </span>
        )}
        {coreqViol === "sep" && (
          <span title={t("course.tooltip.coreq.sep")}
            style={{ fontSize: 9, fontWeight: 700, color: "var(--warn)", background: "var(--warn-bg)", border: "1px solid var(--warn-bright)", borderRadius: 3, padding: "1px 3px", lineHeight: 1 }}>
            {t("course.badge.coreq.sep")}
          </span>
        )}
        {notOffered && (() => {
          // Build a probability hint from termHistory if available
          const hist    = course.termHistory ?? {};
          const entries = Object.entries(hist).filter(([c]) => calendar.decodeTermCode(c) === semOffType);
          const tip = entries.length > 0
            ? `${course.code}: offered in ${entries.filter(([,v]) => v).length}/${entries.length} past ${semOffType} terms (override in panel)`
            : `${course.code} may not be offered in ${semOffType} (override in panel)`;
          return (
            <span title={tip}
              style={{ fontSize: 9, fontWeight: 700, color: "var(--warn)", background: "var(--warn-bg)", borderRadius: 3, padding: "1px 4px" }}>
              {t("course.avail.badge")}
            </span>
          );
        })()}
      </div>
    </div>
  );
}
