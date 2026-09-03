// ═══════════════════════════════════════════════════════════════════
// INFO PANEL  — bottom drawer for selected course details
// ═══════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import HoverCard from "./HoverCard.jsx";
import SubjectTip from "./SubjectTip.jsx";
import { createPortal } from "react-dom";
import { usePlanner } from "../context/PlannerContext.jsx";
import { usePort }                  from "../context/InstitutionContext.jsx";
import { IAttributeSystem }         from "../ports/IAttributeSystem.js";
import { ICreditSystem }            from "../ports/ICreditSystem.js";
import { ICalendar }                from "../ports/ICalendar.js";
import { ICourseOffering }          from "../ports/ICourseOffering.js";
import { ICourseCatalog }           from "../ports/ICourseCatalog.js";
import { ISpecialTerms }            from "../ports/ISpecialTerms.js";
import { REL_STYLE } from "../core/constants.js";
import { getConnections } from "../core/planModel.js";
import { unlockedCourses, coreqPartnersOf } from "../core/courseModel.js";
import { groupRestrictions, displayValues } from "../core/restrictionView.js";
import { conditionStatus } from "../core/prereqConditions.js";
// Pure core, like prereqConditions beside it — the codes and their ordering, never
// the display names: those are localized and come from `t`.
import { STANDING_NAMES } from "../core/classStanding.js";
import { baseId } from "../core/repeatInstances.js";
import { useCourseInk } from "./useSubjectInk.js";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useTranslation, useCourseTranslation, TText, scaleLatinRuns } from "../context/TranslationContext.jsx";
import { SemLabel } from "./SemLabel.jsx";
import CourseReviewButton from "./CourseReviewButton.jsx";

export default function InfoPanel() {
  const {
    showPanel, setShowPanel, selectedId, setSelectedId,
    courseMap, allEdges, offeredOverrides, setOfferedOverrides,
    panelHeight, panelHeightManual, panelResizing, isPhone, isMobile,
    showUnlocks, bankWidth, showPalette, wideCatalog, wideWidth,
  } = usePlanner();
  const { t } = useLanguage();

  // ── InfoPanel nav history (back = Cmd+Z, fwd = Cmd+Shift+Z) ──────
  const navHistory = useRef([]);
  const navFuture  = useRef([]);
  // The id we ourselves just requested via navTo/goBack/goForward. Lets the
  // effect below tell "the user drilled in" apart from "selectedId changed
  // for some unrelated reason" (closing the panel, clicking a different card
  // on the board, a search result) — those are a fresh trail, not a next
  // step, so the stack resets instead of quietly keeping an unrelated course.
  const lastNavTarget = useRef(null);
  const [, forceRender] = useState(0);
  const [backHover, setBackHover] = useState(null); // rect while hovering the back button
  // The panel's content scrolls independently of the board, so swapping to a
  // different course (via navTo/goBack/goForward, or an external reselect)
  // must not leave the reader scrolled to wherever the PREVIOUS course's
  // content happened to be.
  const contentRef = useRef(null);

  const navTo = useCallback((newId) => {
    navHistory.current = [...navHistory.current, selectedId];
    navFuture.current  = [];
    lastNavTarget.current = newId;
    forceRender(n => n + 1);
    setSelectedId(newId);
  }, [selectedId, setSelectedId]);

  const goBack = useCallback(() => {
    if (navHistory.current.length === 0) return;
    const prev = navHistory.current[navHistory.current.length - 1];
    navFuture.current  = [...navFuture.current, selectedId];
    navHistory.current = navHistory.current.slice(0, -1);
    lastNavTarget.current = prev;
    forceRender(n => n + 1);
    setSelectedId(prev);
  }, [selectedId, setSelectedId]);

  const goForward = useCallback(() => {
    if (navFuture.current.length === 0) return;
    const next = navFuture.current[navFuture.current.length - 1];
    navHistory.current = [...navHistory.current, selectedId];
    navFuture.current  = navFuture.current.slice(0, -1);
    lastNavTarget.current = next;
    forceRender(n => n + 1);
    setSelectedId(next);
  }, [selectedId, setSelectedId]);

  // selectedId changed to something other than what navTo/goBack/goForward
  // just requested — an external reselect. Reset the trail rather than let
  // an unrelated course inherit someone else's history.
  useLayoutEffect(() => {
    if (selectedId !== lastNavTarget.current && (navHistory.current.length || navFuture.current.length)) {
      navHistory.current = [];
      navFuture.current  = [];
      forceRender(n => n + 1);
    }
  }, [selectedId]);

  useEffect(() => {
    const handler = (e) => {
      if (!showPanel) return;
      const isUndo = (e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey;
      const isRedo = (e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey;
      if (isUndo && navHistory.current.length > 0) {
        e.preventDefault(); e.stopImmediatePropagation();
        goBack();
      } else if (isRedo && navFuture.current.length > 0) {
        e.preventDefault(); e.stopImmediatePropagation();
        goForward();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [showPanel, goBack, goForward]);

  // The RAW course map, deliberately — not the combined view that includes
  // reservations. A reservation selected here therefore yields no panel at all,
  // and that is the correct behaviour rather than a gap:
  //
  // This panel is a course DESCRIPTION surface. A reservation has no course, so
  // its title and description are empty by nature — rendering the panel's
  // chrome around them would frame that emptiness as "this card's description",
  // which is a claim about a course that does not exist yet. A blank panel
  // reads worse than no panel.
  //
  // Closing an already-open panel follows from the same rule: the selection has
  // moved to something with no description, and leaving the previous course's
  // panel up would describe a card the student is no longer looking at.
  //
  // What a reservation needs instead is its own surface (the picker), not this
  // one wearing a course's frame.
  const selCourse = selectedId ? courseMap[selectedId] : null;
  const selEdges  = selectedId ? getConnections(selectedId, allEdges) : [];
  // Before the early return — it is a hook.
  const selColor  = useCourseInk(selCourse);

  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [selectedId]);

  if (!showPanel || !selCourse) return null;

  const prevId     = navHistory.current[navHistory.current.length - 1] ?? null;
  const prevCourse = prevId ? courseMap[prevId] : null;

  return (
    <div
      onClick={e => e.stopPropagation()}
      /* Tagged so a reveal-scroll can measure how much of the timeline this
         covers — see ui/smoothScroll.js. Its height is content-driven, so it
         has to be read off the DOM rather than taken from panelHeight. */
      data-info-panel=""
      style={{
        position: "fixed", bottom: 0,
        left: isPhone ? 0 : (showPalette ? 100 : 18),
        right: isPhone ? 0 : (wideCatalog ? (wideWidth ?? Math.min(340, Math.max(240, window.innerWidth * 0.24))) : bankWidth),
        background: "var(--bg-surface)",
        borderTop: `2px solid ${selColor}50`,
        // Default: maxHeight so the panel hugs its content (short content
        // leaves no dead space). Once the user drags the handle, the height
        // becomes explicit and may stretch past the content.
        zIndex: 50, display: "flex", flexDirection: "column",
        ...(panelHeightManual ? { height: panelHeight } : { maxHeight: panelHeight }),
      }}
    >
      {/* Drag-resize handle. Start from the panel's RENDERED height, not the
          stored cap — content-hugging means they differ, and starting from
          the stale cap left a dead zone where dragging appeared broken. */}
      <div
        onMouseDown={e => {
          panelResizing.current = { startY: e.clientY, startH: e.currentTarget.parentElement?.offsetHeight ?? panelHeight };
          e.preventDefault();
        }}
        onTouchStart={e => {
          panelResizing.current = { startY: e.touches[0].clientY, startH: e.currentTarget.parentElement?.offsetHeight ?? panelHeight };
          e.stopPropagation();
        }}
        style={{
          height: 10, flexShrink: 0, cursor: "ns-resize",
          display: "flex", alignItems: "center", justifyContent: "center",
          borderBottom: "1px solid var(--border-1)",
        }}
      >
        <div style={{ width: 32, height: 3, borderRadius: 99, background: "var(--border-2)" }} />
      </div>

      <div ref={contentRef} style={{ flex: "0 1 auto", overflowY: "auto", padding: "8px 14px 12px" }}>
        <div style={{ display: "flex", flexDirection: isPhone ? "column" : "row", alignItems: "flex-start", gap: isPhone ? 8 : 14 }}>
          {/* Top row: course info + right column + close */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14, width: "100%" }}>
            <CourseInfo selCourse={selCourse} navTo={navTo} />

            {/* Desktop only: separate columns — instructors, availability, unlocks */}
            {!isMobile && <CourseInstructors selCourse={selCourse} />}
            {!isMobile && (
              <CourseOfferingHistory
                selCourse={selCourse}
                offeredOverrides={offeredOverrides}
                setOfferedOverrides={setOfferedOverrides}
              />
            )}
            {!isMobile && showUnlocks && selEdges.length > 0 && (
              <RelationshipList selCourse={selCourse} selEdges={selEdges} courseMap={courseMap} navTo={navTo} />
            )}

            {/* Tablet: single narrow right column — Instructors, then Offered, then Relationships */}
            {isMobile && !isPhone && (
              <div style={{ width: 175, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                <CourseInstructors selCourse={selCourse} compact />
                <CourseOfferingHistory
                  selCourse={selCourse}
                  offeredOverrides={offeredOverrides}
                  setOfferedOverrides={setOfferedOverrides}
                  compact
                />
                {showUnlocks && selEdges.length > 0 && (
                  <RelationshipList selCourse={selCourse} selEdges={selEdges} courseMap={courseMap} navTo={navTo} compact />
                )}
              </div>
            )}

            {/* Back — only rendered once there's somewhere to go back to */}
            {prevCourse && (
              <button
                onClick={goBack}
                onMouseEnter={e => setBackHover(e.currentTarget.getBoundingClientRect())}
                onMouseLeave={() => setBackHover(null)}
                aria-label={t("info.back.title").replace("{code}", prevCourse.code)}
                style={{
                  width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, fontWeight: 500, lineHeight: 1, cursor: "pointer",
                  border: `1px solid ${backHover ? "var(--text-4)" : "var(--border-2)"}`,
                  color: backHover ? "var(--text-2)" : "var(--text-5)",
                  background: backHover ? "var(--badge-bg)" : "transparent",
                  transition: "background 120ms ease, color 120ms ease, border-color 120ms ease",
                }}
              >←</button>
            )}
            {backHover && prevCourse && (
              <HoverCard rect={backHover}>
                {t("info.back.title").replace("{code}", prevCourse.code)}
              </HoverCard>
            )}

            {/* Close */}
            <button
              onClick={() => { setShowPanel(false); setSelectedId(null); }}
              style={{ background: "transparent", border: "none", color: "var(--text-4)", fontSize: 16, cursor: "pointer", lineHeight: 1, padding: "0 2px", flexShrink: 0 }}
            >✕</button>
          </div>

          {/* Phone: instructors + offered + unlocks beneath main info */}
          {isPhone && (
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", width: "100%" }}>
              <CourseInstructors selCourse={selCourse} compact />
              <CourseOfferingHistory
                selCourse={selCourse}
                offeredOverrides={offeredOverrides}
                setOfferedOverrides={setOfferedOverrides}
              />
              {showUnlocks && selEdges.length > 0 && (
                <RelationshipList selCourse={selCourse} selEdges={selEdges} courseMap={courseMap} navTo={navTo} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CourseInfo({ selCourse, navTo }) {
  const { courseMap, onDragStart, placements, SEMESTERS, SEM_INDEX, specialTermPl, revealCourse, allEdges } = usePlanner();
  const specialTerms = usePort(ISpecialTerms);
  // Where the ↻ cycle is, when the panel's own `selCourse.id` cannot say.
  // A work-term take is not a course id, so cycling onto one leaves selCourse
  // unchanged and the next click would otherwise start over from the same
  // place. Keyed by course so opening a different one resets it.
  const cycleRef = useRef({ courseId: null, pid: null });
  const subjColor = useCourseInk(selCourse);
  const attributeSystem = usePort(IAttributeSystem);
  const creditSystem    = usePort(ICreditSystem);
  const calendar        = usePort(ICalendar);
  const courseCatalog   = usePort(ICourseCatalog);
  const { t, locale, locales } = useLanguage();
  const { modelProgress, engineTier, catalogLocale, courseTranslationEnabled, setCourseTranslationEnabled, cancelDownload } = useTranslation();
  const { title, desc, isTranslating } = useCourseTranslation(selCourse);

  const catalogUrl = courseCatalog?.courseUrl?.(selCourse) ?? null;
  // null when RateMyHusky has no page for this course (the adapter checks its
  // verified course-code set), so the link is shown only where it leads to real
  // reviews rather than an empty page.
  const ratingsUrl = courseCatalog?.courseRatingsUrl?.(selCourse) ?? null;
  const [codeHover, setCodeHover] = useState(false);
  // Hovered header badges (desktop only — hover never fires on touch). Each
  // holds the badge's on-screen rect so its hover card can anchor to it.
  const [npHover, setNpHover]   = useState(null); // NUPath: { code, rect }
  const [repHover, setRepHover] = useState(null); // ↻ repeat badge: rect

  const dir     = locales.find(l => l.code === locale)?.dir ?? "ltr";
  const isNonEn = locale !== catalogLocale;

  // All takes of this course, in board order. Rendered as one line each when
  // there's more than one.
  //
  // TWO sources, because a course can be taken two ways. Most are placements.
  // A work-experience course is never placed — it is REGISTERED by a co-op or
  // internship block naming it on its card — and those takes are just as real:
  // COOP 3945 says "may be repeated up to five times" and three co-ops are
  // three of those five. Counting only placements meant the panel for a
  // student with three co-ops read "can be taken up to 5 times" and 0 used,
  // which is the one number they opened it for.
  const semOrder = Object.fromEntries(SEMESTERS.map((s, i) => [s.id, i]));
  const base = baseId(selCourse.id);

  // Corequisites, from the EDGE GRAPH rather than from `selCourse.coreqs`.
  // The relation is symmetric and the catalog states it on one side only in 19
  // pairs (ARCH 1310 names ARCH 1311; ARCH 1311 names nothing), so reading the
  // course's own field would show the partner on one card and nothing on the
  // other. `coreqPartnersOf` walks the whole connected component, which is also
  // what makes a lecture/lab/seminar triple show all of itself — PHYS 1151 must
  // name 1152 and 1153 even though it only ever names one of them itself.
  //
  // Memoised because CourseInfo re-renders on hover state and the walk indexes
  // every edge in the catalog.
  const coreqRefs = useMemo(() => coreqPartnersOf(allEdges, base).map(id => {
    const c = courseMap[id];
    if (c) return { subject: c.subject, number: c.number };
    // A partner missing from the catalog still gets a chip, from its own id.
    const m = /^([A-Z]{2,6})(\d{3,4}[A-Z]?)$/.exec(id);
    return m ? { subject: m[1], number: m[2] } : null;
  }).filter(Boolean), [allEdges, base, courseMap]);
  const placedTakes = Object.entries(placements)
    // timeline only — takes parked outside the cohort range don't list
    .filter(([pid, sid]) => baseId(pid) === base && SEM_INDEX[sid] !== undefined)
    .map(([pid, sid]) => ({ pid, sem: SEMESTERS.find(s => s.id === sid) }));
  const workTakes = Object.entries(specialTermPl ?? {})
    .filter(([, d]) => d?.courseId === base && d.semId && SEM_INDEX[d.semId] !== undefined)
    .map(([pid, d]) => ({
      pid,
      sem: SEMESTERS.find(s => s.id === d.semId),
      // Names the block, so the line reads "Spring 2027 · Co-op" rather than
      // looking like a placement the student cannot find on the board.
      via: (specialTerms?.getTypes() ?? []).find(ty => ty.id === d.typeId)?.label ?? null,
    }));
  const takes = [...placedTakes, ...workTakes]
    .sort((a, b) => (semOrder[a.sem?.id] ?? 99) - (semOrder[b.sem?.id] ?? 99));

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
        {/* The pill has room for the code only, so hovering it names the subject
            in full — the same card chrome as the availability popovers. */}
        <SubjectTip subject={selCourse.subject} color={subjColor}
                    name={courseCatalog?.subjectName?.(selCourse.subject) ?? null}>
          <span style={{ fontSize: 10, background: subjColor, color: "var(--badge-bg)", borderRadius: 3, padding: "2px 8px", fontWeight: 800, letterSpacing: "0.04em" }}>
            {selCourse.isCps ? `${selCourse.subject} · CPS` : selCourse.subject}
          </span>
        </SubjectTip>
        <span
          draggable
          data-drag-id={selCourse.id}
          data-drag-type="course"
          onDragStart={e => onDragStart(e, selCourse.id, "course", null)}
          onMouseEnter={() => setCodeHover(true)}
          onMouseLeave={() => setCodeHover(false)}
          title={t("info.drag.title")}
          style={{
            fontSize: 14, fontWeight: 800, cursor: "grab", userSelect: "none",
            textDecoration: codeHover ? "underline" : "none",
            textDecorationStyle: "dotted",
            textDecorationColor: "var(--text-6)",
            textUnderlineOffset: 3,
          }}
        >{selCourse.code}</span>
        <span
          dir={isNonEn ? dir : undefined}
          style={{
            fontSize: 12, color: "var(--text-3)",
            opacity: isTranslating ? 0.45 : 1,
            transition: "opacity 0.2s",
          }}
        >{scaleLatinRuns(title)}</span>
        <span style={{ fontSize: 10, color: "var(--text-4)", background: "var(--badge-bg)", border: "1px solid var(--border-1)", borderRadius: 3, padding: "1px 6px" }}>
          {selCourse.sh} {creditSystem.getUnitName()}
        </span>
        {selCourse.scheduleType && (
          <span style={{ fontSize: 9, color: "var(--text-3)", background: "var(--bg-surface)", border: "1px solid var(--border-2)", borderRadius: 3, padding: "1px 6px" }}>
            <TText>{selCourse.scheduleType}</TText>
          </span>
        )}
        {/* Hidden for now: its only purpose is opening the hours/difficulty/
            instructor half of CourseReviewPopover, which is itself hidden
            pending the read/aggregate side (see courseRatings.js) — without
            that half it would just be a second "edit grade" affordance
            duplicating the card's own grade chip. Drop the `false &&` (and
            restore CourseReviewPopover in CourseCard's GradeChip) to bring
            both back together. */}
        {false && <CourseReviewButton courseId={selCourse.id} />}
        {selCourse.repeatable && (() => {
          const overTakes = selCourse.repeatMax != null && takes.length > selCourse.repeatMax;
          return (
            <span
              onMouseEnter={e => setRepHover(e.currentTarget.getBoundingClientRect())}
              onMouseLeave={() => setRepHover(null)}
              onClick={takes.length > 1 ? (e) => {
                // Cycle to the next take.
                //
                // For a PLACEMENT, selecting it is all this needs to do —
                // bringing the card into view follows from selection everywhere
                // in the app (PlannerContext → revealCourse), and doing it again
                // here would race that scroll.
                //
                // A WORK-TERM take has no course id of its own to select: the
                // block registers this same course, so there is nothing for the
                // panel to navigate to. It is still a card on the board, so it
                // is revealed directly by its instance id. Without this branch
                // the cycle called navTo("wt_…") and landed on nothing — which
                // is what counting work terms as takes would otherwise have
                // introduced.
                e.stopPropagation();
                const from = cycleRef.current.courseId === selCourse.id ? cycleRef.current.pid : selCourse.id;
                const i    = takes.findIndex(tk => tk.pid === from);
                const next = takes[(i + 1) % takes.length];
                cycleRef.current = { courseId: selCourse.id, pid: next.pid };
                if (next.via) revealCourse(next.pid);
                else navTo(next.pid);
              } : undefined}
              style={{
                fontSize: 9,
                color: overTakes ? "var(--error)" : "var(--text-3)",
                background: "var(--bg-surface)",
                border: `1px solid ${overTakes ? "var(--error)" : "var(--border-2)"}`,
                borderRadius: 3, padding: "1px 6px",
                cursor: takes.length > 1 ? "pointer" : "help",
              }}
            >
              ↻ {selCourse.repeatMax ? `×${selCourse.repeatMax}` : "∞"}{overTakes ? " ⚠" : ""}
            </span>
          );
        })()}
        {repHover && (() => {
          const max = selCourse.repeatMax;
          const overTakes = max != null && takes.length > max;
          return (
            <HoverCard rect={repHover}>
              <bdi>
                {/* scaleLatinRuns: digits inside CJK text need the same
                    size-adjust the course title gets (fonts-cjk.css). */}
                {scaleLatinRuns(
                  (max
                    ? t("info.repeat.limited").replace("{n}", String(max))
                    : t("info.repeat.unlimited"))
                  + (selCourse.repeatMaxSH ? ` · ≤ ${selCourse.repeatMaxSH} ${creditSystem.getUnitName()}` : "")
                )}
              </bdi>
              {takes.length > 1 && (
                <>
                  <div style={{ marginTop: 11, fontSize: 8.5, fontWeight: 700, letterSpacing: "0.05em", color: "var(--text-5)" }}>
                    {t("info.repeat.planned")}
                  </div>
                  {/* One take per line — scales to many takes;                       catalog limit render in error red (allowed, flagged). */}
                  <div style={{ marginTop: 3, display: "flex", flexDirection: "column", gap: 2, fontSize: 10.5 }}>
                    {takes.map(({ pid, sem, via }, i) => {
                      const active = pid === selCourse.id;
                      const over   = max != null && i >= max;
                      return (
                        <div key={pid} style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                          <span style={{ fontSize: 8.5, color: "var(--text-6)", fontVariantNumeric: "tabular-nums", minWidth: 10, textAlign: "right" }}>{i + 1}</span>
                          <span style={{
                            fontWeight: active ? 700 : 400,
                            color: over ? "var(--error)" : active ? "var(--text-2)" : "var(--text-4)",
                          }}>
                            {sem
                              ? (sem.type === "special"
                                  ? <TText>{sem.label}</TText>
                                  : <SemLabel typeId={sem.semTypeId} year={(sem.id.match(/\d{4}/) ?? [""])[0]} />)
                              : pid}
                            {over ? " ⚠" : ""}
                          </span>
                          {/* Which co-op or internship registered this take.
                              Without it the line points at a semester holding
                              no card with this code, and reads as a bug. */}
                          {via && (
                            <span style={{ fontSize: 8.5, color: "var(--text-6)" }}>
                              · <TText>{via}</TText>
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {overTakes && (
                    <div style={{ marginTop: 4, fontSize: 9.5, fontWeight: 700, color: "var(--error)" }}>
                      {scaleLatinRuns(t("bank.repeat.title").replace("{used}", String(takes.length)).replace("{max}", String(max)))}
                    </div>
                  )}
                  <div style={{ marginTop: 10, fontSize: 9, fontStyle: "italic", color: "var(--text-5)" }}>
                    {t("info.repeat.cycle")}
                  </div>
                </>
              )}
            </HoverCard>
          );
        })()}
        {selCourse.attributes?.map(np => (
          <span key={np}
            onMouseEnter={e => setNpHover({ code: np, rect: e.currentTarget.getBoundingClientRect() })}
            onMouseLeave={() => setNpHover(null)}
            style={{ fontSize: 9, color: "var(--nupath-text)", background: "var(--nupath-bg)", border: "1px solid var(--nupath-border)", borderRadius: 3, padding: "1px 5px", cursor: "help" }}>
            {np}
          </span>
        ))}
        {npHover && (
          <HoverCard rect={npHover.rect}><bdi>{attributeSystem.getLabel(npHover.code)}</bdi></HoverCard>
        )}
        {catalogUrl && (
          <a href={catalogUrl} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 9, color: "var(--text-5)", textDecoration: "none", marginLeft: 2 }}
            onMouseEnter={e => { e.currentTarget.style.color = "var(--text-3)"; e.currentTarget.style.textDecoration = "underline"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "var(--text-5)"; e.currentTarget.style.textDecoration = "none"; }}>
            {t("info.catalog.link")}
          </a>
        )}
        {/* Course ratings/reviews (TRACE + RateMyProfessor) — sits directly to
            the right of the catalog link. Reliable by construction, so always shown. */}
        {ratingsUrl && (
          <a href={ratingsUrl} target="_blank" rel="noopener noreferrer"
            title={t("info.ratemyhusky.title")}
            style={{ fontSize: 9, color: "var(--text-5)", textDecoration: "none", marginLeft: 2 }}
            onMouseEnter={e => { e.currentTarget.style.color = "var(--text-3)"; e.currentTarget.style.textDecoration = "underline"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "var(--text-5)"; e.currentTarget.style.textDecoration = "none"; }}>
            {t("info.ratemyhusky.link")}
          </a>
        )}
      </div>


      {/* Non-English: nudge to enable translation, or show download progress */}
      {isNonEn && !courseTranslationEnabled && (
        <div style={{ marginBottom: 5, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, color: "var(--text-5)" }}>{t("translation.english.note")}</span>
          <button
            onClick={() => setCourseTranslationEnabled(true)}
            style={{
              fontSize: 9, padding: "1px 7px", borderRadius: 3, cursor: "pointer",
              background: "var(--bg-surface-2)", border: "1px solid var(--border-2)",
              color: "var(--text-3)",
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "var(--active)"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border-2)"}
          >{t("translation.enable")}</button>
        </div>
      )}
      {isNonEn && courseTranslationEnabled && engineTier === "wasm" && modelProgress && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <span style={{ fontSize: 9, color: "var(--text-4)", flex: 1 }}>
              {t("translation.downloading")}
              {modelProgress.total > 0 && (
                <span style={{ marginLeft: 4, color: "var(--text-5)" }}>
                  {Math.round((modelProgress.loaded / modelProgress.total) * 100)}%{" "}
                  {t("translation.progress.of")} ~890 MB
                </span>
              )}
            </span>
            <button
              onClick={cancelDownload}
              title={t("translation.cancel.title")}
              style={{
                fontSize: 9, padding: "1px 6px", borderRadius: 3, cursor: "pointer",
                background: "transparent", border: "1px solid var(--border-2)",
                color: "var(--text-4)", lineHeight: "calc(1.4 * var(--lh-scale, 1))", flexShrink: 0,
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--error)"; e.currentTarget.style.color = "var(--error)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border-2)"; e.currentTarget.style.color = "var(--text-4)"; }}
            >{t("translation.cancel")}</button>
          </div>
          <div style={{ height: 2, borderRadius: 99, background: "var(--border-1)", overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 99, background: "var(--active)",
              width: modelProgress.total > 0
                ? `${Math.round((modelProgress.loaded / modelProgress.total) * 100)}%`
                : "30%",
              transition: "width 0.3s ease",
            }} />
          </div>
        </div>
      )}

      {selCourse.desc && (
        <div
          dir={isNonEn ? dir : undefined}
          style={{
            fontSize: 11, color: "var(--text-3)", lineHeight: "calc(1.55 * var(--lh-scale, 1))", marginBottom: 4,
            opacity: isTranslating ? 0.45 : 1,
            transition: "opacity 0.2s",
          }}
        >
          <DescriptionWithLinks
            text={desc}
            courseMap={courseMap}
            placements={placements}
            navTo={navTo}
            onDragStart={onDragStart}
          />
        </div>
      )}
      {selCourse.prereqs?.length > 0 && (
        <div style={{ fontSize: 10, color: "var(--text-4)", background: "var(--badge-bg)", border: "1px solid var(--border-1)", borderRadius: 4, padding: "4px 8px", marginTop: 4, lineHeight: "calc(1.9 * var(--lh-scale, 1))" }}>
          <span style={{ color: "var(--error)", fontWeight: 700 }}>{t("info.prereqs")} </span>
          <PrereqChips nodes={selCourse.prereqs} courseMap={courseMap} navTo={navTo} onDragStart={onDragStart} />
        </div>
      )}
      {/* Corequisites, directly beneath the prerequisites and in the same frame,
          because they are the same KIND of fact — what else has to be true for
          this course to be registrable. They used to appear only in the UNLOCKS
          column at the far right of the panel, which is where courses that
          DEPEND on this one live: a lecture's mandatory lab read as an optional
          onward path, and on a phone it sat below the fold. The label carries
          the coreq blue the lines and the legend already use. */}
      {coreqRefs.length > 0 && (
        <div title={t("course.tooltip.coreq.sep")}
             style={{ fontSize: 10, color: "var(--text-4)", background: "var(--badge-bg)", border: "1px solid var(--border-1)", borderRadius: 4, padding: "4px 8px", marginTop: 4, lineHeight: "calc(1.9 * var(--lh-scale, 1))" }}>
          <span style={{ color: REL_STYLE.corequisite.color, fontWeight: 700 }}>{t("info.coreqs")} </span>
          <PrereqChips nodes={coreqRefs} courseMap={courseMap} navTo={navTo} onDragStart={onDragStart} />
        </div>
      )}
      {/* Class standing — beside the prereqs because that is what it IS: the real
          entry condition for a capstone or Advanced Writing, which the catalog
          states only in prose and Banner states properly. Shown as information, not
          as a violation: standing is earned by credits and we do not know the
          student's, so a warning colour here would accuse people we cannot assess. */}
      {STANDING_NAMES[selCourse.offering?.std] && (
        <div title={t("info.standing.note")}
             style={{ fontSize: 10, color: "var(--text-4)", background: "var(--badge-bg)", border: "1px solid var(--border-1)", borderRadius: 4, padding: "4px 8px", marginTop: 4, lineHeight: "calc(1.9 * var(--lh-scale, 1))" }}>
          <span style={{ color: "var(--text-3)", fontWeight: 700 }}>{t("info.standing.title")} </span>
          {t("info.standing.min", { standing: t(`standing.${selCourse.offering.std}`) })}
        </div>
      )}
      {/* Co-op prep. Nothing upstream states this rule — COOP 3945 carries empty
          prereqs and empty coreqs — so the only evidence is that every department
          publishing a plan with this course puts it before the work term. That is
          quoted as a COUNT rather than asserted as a requirement, and it is
          deliberately not a warning colour: a student whose program does not
          require it has done nothing wrong. See stampCoopPrep in courseNorm.js. */}
      {/* Banner's Restrictions pane, per season, each naming the term it was
          read from. Information, not a violation — we do not know the student's
          major, college or campus, so a warning colour here would accuse people
          we cannot assess, exactly as the standing box above reasons. Coverage
          is printed whenever a restriction is on SOME sections and not all,
          because "3 of 21" (there is a way in) and "21 of 21" (there is not)
          are opposite advice. See scripts/derive-restrictions.js. */}
      {selCourse.restrictions && (
        <RestrictionBlock restrictions={selCourse.restrictions} t={t}
                          standingShown={!!STANDING_NAMES[selCourse.offering?.std]} />
      )}
      {Number.isFinite(selCourse.coopPrep?.observations) && (
        <div title={t("info.coopPrep.note")}
             style={{ fontSize: 10, color: "var(--text-4)", background: "var(--badge-bg)", border: "1px solid var(--border-1)", borderRadius: 4, padding: "4px 8px", marginTop: 4, lineHeight: "calc(1.9 * var(--lh-scale, 1))" }}>
          <span style={{ color: "var(--text-3)", fontWeight: 700 }}>{t("info.coopPrep.title")} </span>
          {t("info.coopPrep.body", { count: selCourse.coopPrep.observations })}
        </div>
      )}
    </div>
  );
}

// The season labels the rest of the app already uses (ClaudePanel L185,
// ChartExplainer L34). Reused rather than adding `sem.*` keys, so a summer
// cannot read "Summer 2" here and "Summer B" three panels over — CLAUDE.md
// fixes that wording repo-wide.
const SEASON_KEY = {
  fall: "claude.sem.fall", spring: "claude.sem.spring",
  sumA: "claude.sem.sum1", sumB: "claude.sem.sum2",
};

/**
 * Banner term code → calendar year.
 *
 * YYYY is the ACADEMIC year's end, so Fall belongs to the previous calendar
 * year and everything else to YYYY. Checked against Banner's own descriptions:
 * 202510 is "Fall 2024", 202530 is "Spring 2025", 202460 is "Summer 2 2024".
 * Getting this backwards would date every Fall restriction a year late.
 */
function termYear(termCode) {
  const y = Number(String(termCode ?? "").slice(0, 4));
  if (!Number.isFinite(y)) return null;
  return String(termCode).slice(4) === "10" ? y - 1 : y;
}

/**
 * The years a season's restriction was observed in, newest first.
 *
 * Falls back to `latestTerm` when `termCodes` is absent, so an older cached
 * asset still renders a year rather than an empty heading — the season alone
 * would read as a standing rule, which is the one thing a single observation
 * cannot claim.
 */
function seasonYears(s) {
  const codes = Array.isArray(s?.termCodes) && s.termCodes.length
    ? s.termCodes
    : [s?.latestTerm];
  const years = [...new Set(codes.map(termYear).filter(y => y !== null))]
    .sort((a, b) => b - a);
  return years.join(", ");
}

/**
 * One restriction group's values.
 *
 * ── Why a LIST rather than one `·`-joined run ──────────────────────
 *
 * MEIE 4701's Summer B group is five near-identical combined majors — "Mechanical
 * Engr/Bioengineering · Mechanical Engineering · Mechanical Engineering/Design ·
 * Mechanical Engineering/History · Mechanical Engineering/Physics". Joined into
 * one run at 10px in a narrow drawer those wrap mid-name, and the reader cannot
 * see where one major ends and the next begins — which is the one thing the row
 * exists to tell them.
 *
 * ── Why EVERY group is bulleted, including single-value ones ────────
 *
 * The first attempt listed only the LONG groups and left short ones inline, on
 * the measurement that 558 of 941 groups hold exactly one value and a one-item
 * bullet is noise. That was wrong, and only looking at it rendered showed why:
 * two layouts inside one block put the inline group's text at a shallower
 * indent than the listed group's values, so "Industrial Engineering" and
 * "· Mechanical Engineering" began at different depths under the same kind.
 * Uniform bulleting costs one line on a single-value group and buys an indent
 * the eye can follow. Consistency beat the saved line.
 *
 * ── Why the tail is DEFERRED, not truncated ────────────────────────
 *
 * The distribution has a hard tail: 45 groups carry more than 8 values, and one
 * carries 57 at 1,337 characters. Fifty-seven bullets is a wall, not a
 * restriction. But every one of them is a value the registrar published, so the
 * overflow goes behind a toggle rather than being dropped — less information on
 * screen, never wrong information. Collapsing to "Mechanical Engineering +4
 * variants" was considered and refused for the same reason: a student needs to
 * know *which* variants, and that summary is the one thing it cannot say.
 */
function RestrictionValues({ values, t }) {
  const CAP = 8;
  const [open, setOpen] = useState(false);
  const vals   = values ?? [];
  const shown  = open ? vals : vals.slice(0, CAP);
  const hidden = vals.length - shown.length;

  return (
    <div style={{ paddingLeft: 18 }}>
      {shown.map((v, i) => (
        // Hanging indent, so a value that still wraps stays visually inside
        // its own bullet rather than aligning with the next one.
        <div key={i} style={{ paddingLeft: 7, textIndent: -7 }}>
          <span style={{ opacity: 0.45 }}>·{" "}</span>{v}
        </div>
      ))}
      {(hidden > 0 || open) && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          style={{ background: "none", border: "none", padding: 0, marginTop: 1,
                   font: "inherit", color: "var(--text-3)", cursor: "pointer",
                   textDecoration: "underline", textUnderlineOffset: 2 }}
        >
          {open ? t("info.restrictions.less") : t("info.restrictions.more", { n: hidden })}
        </button>
      )}
    </div>
  );
}

/**
 * Banner's Restrictions pane for one course.
 *
 * ── Grouped by RESTRICTION, not by term ────────────────────────────
 *
 * `groupRestrictions` does the inversion and the reasoning lives there. What it
 * buys visually: a course restricted identically every term reads as one line
 * instead of eleven, and a course whose restriction actually MOVES gets a
 * second line — so difference is loud rather than buried in repetition.
 *
 * Section groups are never unioned. Measured: 45 of 344 courses have a kind
 * whose sections disagree, and ARCH 5115 has three distinct program groups in
 * one term. Merging them would tell a BS-ARCH student that any of five
 * programmes may register, and never that exactly one section is open to them.
 *
 * ── Falling back to Banner's own words ─────────────────────────────
 *
 * `t()` returns the KEY when a translation is missing, which would print
 * `info.restrictions.name.Majors` on screen. An unrecognised kind therefore
 * falls back to Banner's own English noun — worse than a translation, far
 * better than a raw key or a dropped restriction.
 */
function RestrictionBlock({ restrictions, t, standingShown = false }) {
  const { labels = {}, terms } = restrictions ?? {};
  const view = groupRestrictions(terms);

  // The standing box directly above already says "Junior standing or above",
  // so repeating `Class standing: Junior · Senior` here is the same fact twice
  // in adjacent boxes. Dropped ONLY when this row adds nothing to it: one
  // group, on every section, in every season observed. If standing varies by
  // section or by season — ARCH 5115 is JR|SR on 2 of 5 sections and GR on 1 —
  // this row carries strictly more than the folded floor and stays.
  const kinds = view.kinds.filter(k => {
    if (!standingShown || k.key !== "must:Classes") return true;
    return k.variesBySection
        || k.groups.length > 1
        || k.groups[0].seasons.some(s => !s.everySection);
  });
  if (!kinds.length) return null;

  /** Translate, or fall back to the registrar's own word. */
  const orRaw = (key, raw) => { const s = t(key); return s === key ? raw : s; };

  return (
    <div style={{ fontSize: 10, color: "var(--text-4)", background: "var(--badge-bg)", border: "1px solid var(--border-1)", borderRadius: 4, padding: "4px 8px", marginTop: 4, lineHeight: "calc(1.9 * var(--lh-scale, 1))" }}>
      <div title={t("info.restrictions.note")}>
        <span style={{ color: "var(--text-3)", fontWeight: 700 }}>{t("info.restrictions.title")}</span>
      </div>

      {kinds.map(k => (
        <div key={k.key} style={{ marginTop: 2 }}>
          <span style={{ fontWeight: 600, color: k.polarity === "not" ? "var(--error)" : "var(--text-3)" }}>
            {t(`info.restrictions.kind.${k.polarity}`, {
              kind: orRaw(`info.restrictions.name.${k.kind}`, k.kind),
            })}
          </span>
          {k.variesBySection && (
            <span style={{ opacity: 0.7 }}> {t("info.restrictions.variesBySection")}</span>
          )}
          {k.groups.map((g, gi) => (
            <div key={gi} style={{ marginTop: gi ? 3 : 1 }}>
              {/* The TERM heads its own group, rather than sitting to the right
                  of the first value.
                  Right-aligned beside a five-value list, one coverage figure
                  reads as belonging to the first bullet only — measured the
                  hard way, on MEIE 4701, whose Summer B group is five majors
                  and whose Fall group is one. Leading with the term also
                  answers the reader's actual question in the order they ask it:
                  *when* does this bite, then *on whom*.

                  Coverage is per SEASON, pooled across that season's years —
                  see seasonCoverage. "every section" is the gate; a fraction is
                  the reserved case, 24.6% of observations, and the difference
                  between "you cannot take this" and "one section is closed to
                  you". */}
              {g.seasons.map((s, si) => (
                <div key={si} style={{ paddingLeft: 8, opacity: 0.75 }}>
                  {t(SEASON_KEY[s.season] ?? s.season ?? "")}
                  {/* Every year this season was observed in, NAMED.
                      It used to read "Fall (3 years)" once a season had more
                      than one observation, which aggregates correctly and then
                      throws away the one thing a reader needs — WHICH years,
                      and therefore whether the newest one is last year or
                      three years ago. The recency window is what makes naming
                      them affordable: at most three, so the longest string is
                      "2024, 2025, 2026", no wider than the count it replaces.
                      Deduped in seasonCoverage because SUFFIX_TYPE maps both
                      "40" and "50" to sumA, so a merged and a real summer code
                      in one year would otherwise print the year twice. */}
                  {` ${seasonYears(s)}`}
                  {" · "}
                  {s.everySection
                    ? t("info.restrictions.everySection")
                    : t("info.restrictions.someSections", { n: s.sections, total: s.of })}
                </div>
              ))}
              <RestrictionValues values={displayValues(g.codes, labels, k.key)} t={t} />
            </div>
          ))}
        </div>
      ))}

      <div style={{ opacity: 0.7, marginTop: 2 }}>{t("info.restrictions.source")}</div>
    </div>
  );
}

function DescriptionWithLinks({ text, courseMap, placements, navTo, onDragStart }) {
  if (!text) return null;
  const COURSE_RE = /\b([A-Z]{2,5})\s+(\d{4}[A-Z0-9]*)\b/g;
  const parts = [];
  let last = 0, m;
  while ((m = COURSE_RE.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: "text", val: text.slice(last, m.index) });
    const id = m[1] + m[2];
    const c  = courseMap[id];
    const placed = c && placements[id] !== undefined;
    parts.push({ type: "course", id, raw: m[0], c, placed });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: "text", val: text.slice(last) });

  return (
    <>
      {parts.map((p, i) => {
        if (p.type === "text") return <span key={i}>{scaleLatinRuns(p.val)}</span>;
        if (!p.c) return <span key={i}>{p.raw}</span>;
        const isPlaced = p.placed;
        return (
          <span
            key={i}
            draggable={!isPlaced}
            data-drag-id={!isPlaced ? p.id : undefined}
            data-drag-type={!isPlaced ? "course" : undefined}
            onDragStart={!isPlaced ? (e => onDragStart(e, p.id, "course", null)) : undefined}
            onClick={e => { e.stopPropagation(); navTo(p.id); }}
            title={isPlaced ? `${p.c.title} (already placed). Click to view.` : `${p.c.title}. Drag to place or click to view.`}
            style={{
              cursor: isPlaced ? "pointer" : "grab",
              color: "var(--text-2)", fontWeight: 600,
              textDecoration: "underline",
              textDecorationStyle: "dotted",
              textDecorationColor: isPlaced ? "var(--text-6)" : "var(--text-5)",
              textUnderlineOffset: 2,
            }}
          >{p.raw}</span>
        );
      })}
    </>
  );
}

// Display-time cleanup for scraped prereq token arrays. A dropped non-course
// phrase historically left an empty "( )" group (sometimes with a dangling
// And/Or) that rendered as a stray "(". The scraper now keeps such phrases as
// { note } leaves, making this a no-op there — but shipped data still carries
// the empty groups until the next scrape, so we prune them here: remove any
// parenthetical group with no operand, then drop operators left hanging at an
// end or against a paren / another operator.
function cleanPrereqNodes(nodes) {
  if (!Array.isArray(nodes)) return nodes;
  const isOp = t => t === "And" || t === "Or";
  const isOperand = t => t && typeof t === "object"; // course ref, { note }, nested array
  const arr = nodes.slice();
  let changed = true;
  while (changed) {
    changed = false;
    // 1) remove a group whose interior holds no operand
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] !== "(") continue;
      let depth = 1, hasOperand = false, j = i + 1;
      for (; j < arr.length; j++) {
        if (arr[j] === "(") depth++;
        else if (arr[j] === ")") { if (--depth === 0) break; }
        else if (isOperand(arr[j])) hasOperand = true;
      }
      if (depth === 0 && !hasOperand) { arr.splice(i, j - i + 1); changed = true; break; }
    }
    if (changed) continue;
    // 2) trim leading / trailing operators
    while (arr.length && isOp(arr[0]))               { arr.shift(); changed = true; }
    while (arr.length && isOp(arr[arr.length - 1]))   { arr.pop();   changed = true; }
    if (changed) continue;
    // 3) drop an operator missing an operand on one side
    for (let i = 0; i < arr.length; i++) {
      if (!isOp(arr[i])) continue;
      const prev = arr[i - 1], next = arr[i + 1];
      if (prev === undefined || prev === "(" || isOp(prev) ||
          next === undefined || next === ")" || isOp(next)) {
        arr.splice(i, 1); changed = true; break;
      }
    }
  }
  return arr;
}

function PrereqChips({ nodes, courseMap, navTo, onDragStart }) {
  const { prereqConditions } = usePlanner();
  const clean = cleanPrereqNodes(nodes);
  if (!Array.isArray(clean) || clean.length === 0) return <span>—</span>;
  return (
    <span>
      {clean.map((item, i) => (
        <PrereqNode key={i} item={item} courseMap={courseMap} navTo={navTo} onDragStart={onDragStart} conditions={prereqConditions} />
      ))}
    </span>
  );
}

function PrereqNode({ item, courseMap, navTo, onDragStart, conditions }) {
  const { t } = useLanguage();
  const [hov, setHov] = useState(false);
  if (typeof item === "string") {
    return <span style={{ color: "var(--text-5)", padding: "0 2px" }}>{item}</span>;
  }
  if (Array.isArray(item)) {
    return (
      <span>
        {item.map((sub, i) => (
          <PrereqNode key={i} item={sub} courseMap={courseMap} navTo={navTo} onDragStart={onDragStart} conditions={conditions} />
        ))}
      </span>
    );
  }
  // Informational, non-course condition (e.g. "permission of instructor",
  // "graduate program admission") — plain italic text, not a draggable chip.
  // One the plan already satisfies (grad admission in a graduate plan) turns
  // prereq-green with a tick, so the OR branch that clears the course's
  // undergraduate chain is visible rather than mysterious.
  if (item && typeof item === "object" && item.note) {
    const met = conditionStatus(item.note, conditions) === "satisfied";
    return (
      <span
        title={met ? t("info.prereq.condition.met") : undefined}
        style={{
          color: met ? REL_STYLE.prerequisite.color : "var(--text-4)",
          fontStyle: "italic", padding: "0 3px",
          ...(met && { fontWeight: 600 }),
        }}
      >
        {met ? `✓ ${item.note}` : item.note}
      </span>
    );
  }
  if (item && item.subject && item.number) {
    const id = `${item.subject.toUpperCase()}${item.number}`;
    const c  = courseMap[id];
    return (
      <span
        draggable
        onDragStart={e => { e.stopPropagation(); onDragStart(e, id, "course", null); }}
        onClick={e => { e.stopPropagation(); navTo(id); }}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        title={c ? `${c.title}${item.concurrent ? " (may be taken concurrently)" : ""}. Click to view, drag to place.` : id}
        style={{
          display: "inline-block", fontSize: 9, fontWeight: 600,
          color: "var(--text-2)", background: "var(--bg-surface-2)",
          border: `1px solid ${hov ? "var(--text-4)" : "var(--border-2)"}`,
          borderRadius: 5, padding: "1px 6px", cursor: "pointer",
          userSelect: "none", margin: "0 1px",
          transition: "border-color 0.1s",
        }}
      >
        {c ? c.code : `${item.subject} ${item.number}`}
      </span>
    );
  }
  return null;
}

function RelationshipList({ selCourse, selEdges, courseMap, navTo, compact = false }) {
  const { t } = useLanguage();

  // Only the courses this one unlocks. Incoming prereqs are on the "Prereqs:"
  // line and corequisites now have their own line directly beneath it — they
  // were listed here until they turned out to print twice (a coreq declared on
  // both sides is two edges), and "unlocks" was never what a coreq means.
  const unlocks = unlockedCourses(selCourse.id, selEdges);

  if (unlocks.length === 0) return null;

  return (
    <div style={{ width: compact ? "100%" : "fit-content", flexShrink: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.06em", marginBottom: 5 }}>
        {t("info.relationships.title")}
      </div>
      {/* Right padding only wide enough to clear the scrollbar when the list overflows —
          not an extra spacer before the back/close buttons, which already get their gap
          from the parent flex row like every other column (CourseInstructors, etc). An
          outer paddingRight here used to stack on top of that gap, pushing this column's
          content noticeably farther from the back button than any other column's. */}
      <div style={{ overflowY: "auto", maxHeight: 220, paddingRight: compact ? 0 : 6 }}>
        {unlocks.map(otherId => {
          const other = courseMap[otherId];
          return (
            <div key={otherId} style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
              <span title={other ? `${other.title}. Click to view.` : undefined}
                onClick={other ? (e => { e.stopPropagation(); navTo(otherId); }) : undefined}
                onMouseEnter={other ? (e => { e.currentTarget.style.textDecoration = "underline"; }) : undefined}
                onMouseLeave={other ? (e => { e.currentTarget.style.textDecoration = "none"; }) : undefined}
                style={{ fontSize: 10, fontWeight: 700, color: other?.color || "var(--text-3)",
                  cursor: other ? "pointer" : "default", textUnderlineOffset: 2, userSelect: "none" }}>
                {other?.code || otherId}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const YR_CELL = 22; // px per year column (framed enrollment gauges)
const ROW_H   = 18; // px height of a gauge row (year labelled in the header above)

// Weekday boxes for the typical meeting pattern. `dow` = [Mon..Fri] % of enrolment meeting that
// day — prominence is BY DAY (F dark because ~75% of enrolment meets Friday), which is honest for
// spread courses where no single pattern dominates (the popover shows the by-pattern breakdown).
// Shading is scaled relative to the busiest day through a steep (gamma) curve, so the dominant
// day(s) clearly dominate and secondary days recede rather than all lighting up like a daily
// course. The real percentage stays in the tooltip. Day letters are localised.
//
// THE LETTER CARRIES IT — no fill, no hue. The availability gauges sit directly above
// this strip and teach a traffic-light scale (coral = competitive, mint = room), so
// painting these boxes in the course's SUBJECT colour meant a red or green subject read
// as "full on Fridays" — two unrelated meanings in one palette, a few pixels apart. The
// override control beside the gauges already refuses that palette. Filling the boxes
// with neutral ink instead fixed the meaning but kept the weight of a chart for what is
// really one line of text, so the day itself now shows the frequency: a busy day is
// black and heavy, a rare one light grey and thin, an unused one barely there.
const dayInk    = frac => 0.3 + 0.7 * Math.pow(frac, 1.5);          // darkness, steep so peaks lead
const dayWeight = frac => (frac >= 0.75 ? 800 : frac >= 0.4 ? 700 : 500);

function WeekdayStrip({ dow }) {
  const { t } = useLanguage();
  const labels = (t("info.offered.weekdays") || "M,T,W,Th,F").split(",");
  const peak = Math.max(1, ...(dow ?? []));           // busiest day → full emphasis
  return (
    <div style={{ display: "flex", gap: 3 }}>
      {labels.map((label, i) => {
        const pct  = dow?.[i] ?? 0;                      // real value, shown in tooltip
        const on   = pct > 0;
        const frac = pct / peak;                         // 0..1 relative to the busiest day
        return (
          <span key={i} title={`${label}: ${pct}%`}
            style={{
              minWidth: 19, height: 19, padding: "0 3px",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11,
              fontWeight: on ? dayWeight(frac) : 400,
              color: on ? "var(--text-1)" : "var(--text-5)",
              opacity: on ? dayInk(frac) : 0.4,
            }}>
            {label}
          </span>
        );
      })}
    </div>
  );
}

// Hand-written semester-name translations shared with the Claude proposal
// cards — every locale already has these exactly right.
const SEM_NAME_KEY = { fall: "claude.sem.fall", spring: "claude.sem.spring", sumA: "claude.sem.sum1", sumB: "claude.sem.sum2" };

// Primary instructors — its own column beside the availability history, one
// row per SEMESTER TYPE (Spring / Summer A / Summer B / Fall, matching the
// grid's chronological order). Each name carries the professor's average
// share of enrolment across every recorded term of that type, so "who
// usually teaches the fall run?" has a direct, honest answer.
function CourseInstructors({ selCourse, compact = false }) {
  const cal   = usePort(ICalendar);
  const courseCatalog = usePort(ICourseCatalog);
  const { t } = useLanguage();
  const subjColor = useCourseInk(selCourse);
  const prof = selCourse.offering?.prof ?? {};
  const monthKey = s => (s.months?.length ? Math.min(...s.months.map(Number)) : 99);
  const rows = [...cal.getSemesterTypes()]
    .sort((a, b) => monthKey(a) - monthKey(b))
    .filter(st => prof[st.id]?.length)
    .map(st => ({ st, entries: prof[st.id] }));
  if (rows.length === 0) return null;

  return (
    <div style={{ flexShrink: 0 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.06em", marginBottom: 6 }}>
        {t("info.prof.title")}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {rows.map(({ st, entries }) => {
          // The TEXT is the indicator: the usual instructor reads big and
          // fully opaque; one-off substitutes recede to small and faint.
          // Scaled to the row's biggest share through a steep curve (same
          // emphasis philosophy as the weekday strip, without chip chrome).
          const peak = Math.max(1, ...entries.map(([, p]) => p));
          return (
            <div key={st.id}>
              <div style={{ fontSize: 8.5, fontWeight: 700, color: subjColor || "var(--text-5)", letterSpacing: "0.03em", marginBottom: 1 }}>
                {/* Reuse the hand-written semester-name translations (claude.sem.*)
                    rather than the auto-translation engine. */}
                {SEM_NAME_KEY[st.id]
                  ? t(SEM_NAME_KEY[st.id])
                  : <TText as={st.translateAs}>{st.altLabel ?? st.label}</TText>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 1, paddingLeft: 6 }}>
                {entries.map(([name, pct]) => {
                  const frac = pct / peak;
                  const rmhUrl = courseCatalog?.profRatingsUrl?.(name) ?? null;
                  return (
                    <div key={name} title={`${name}: ${pct}%`} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8,
                      fontSize: 9.5 + 1 * frac,
                      fontWeight: 400,
                      color: "var(--text-3)",
                      opacity: 0.40 + 0.60 * Math.pow(frac, 1.4),
                      lineHeight: "calc(1.35 * var(--lh-scale, 1))",
                    }}>
                      {/* When RateMyHusky has a reviewed page, the name opens it
                          (TRACE + RateMyProfessor) in a new tab with the same
                          dotted-underline hover cue as the draggable code; colour
                          is inherited so it reads as text, not a blue link.
                          Otherwise the name is plain text — no dead-end link. */}
                      {rmhUrl ? (
                        <a
                          href={rmhUrl}
                          target="_blank" rel="noopener noreferrer"
                          title={t("info.prof.ratemyhusky").replace("{name}", name)}
                          onClick={e => e.stopPropagation()}
                          onMouseEnter={e => { e.currentTarget.style.textDecorationLine = "underline"; }}
                          onMouseLeave={e => { e.currentTarget.style.textDecorationLine = "none"; }}
                          style={{
                            cursor: "pointer", color: "inherit",
                            textDecorationLine: "none", textDecorationStyle: "dotted",
                            textDecorationColor: "var(--text-6)", textUnderlineOffset: 3,
                          }}
                        >{name}</a>
                      ) : (
                        <span>{name}</span>
                      )}
                      <span style={{ fontSize: 8, fontWeight: 600, color: "var(--text-3)", flexShrink: 0 }}>{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 8.5, color: "var(--text-5)", fontStyle: "italic", marginTop: 12, lineHeight: "calc(1.4 * var(--lh-scale, 1))" }}>
        {t("info.prof.share")}
      </div>
    </div>
  );
}

function CourseOfferingHistory({ selCourse, offeredOverrides, setOfferedOverrides, compact = false }) {
  const cal         = usePort(ICalendar);
  // `offeringPort`, not `offering`: this component already binds `offering` to the course's
  // own per-term enrollment detail a few lines down, and shadowing it silently swapped the
  // meaning of the name halfway through the function.
  const offeringPort = usePort(ICourseOffering);
  const { t }       = useLanguage();
  // Order rows so each calendar-year column reads top-to-bottom in chronological order. Sort by
  // the earliest calendar month each term covers (Spring=Jan → Summer=May/Jul → Fall=Sep), via the
  // SemesterType.months contract — no hardcoded "fall", so it generalises to any calendar.
  const monthKey    = s => (s.months?.length ? Math.min(...s.months.map(Number)) : 99);
  const semTypes    = [...cal.getSemesterTypes()].sort((a, b) => monthKey(a) - monthKey(b));
  const termHistory = selCourse.termHistory ?? {};
  const hasHistory  = Object.keys(termHistory).length > 0;
  const birth       = selCourse.birthTermCode ?? null;

  // Per-term enrollment detail (completed terms only): { e:{enrolled}, c:{capacity}, s:{sections}, fmt[], cmp[], dow[], lab, prof{} }
  const offering = selCourse.offering ?? null;
  const enrMap = offering?.e ?? {};   // enrolled count  → fill% (height) = enr/cap
  const capMap = offering?.c ?? {};   // capacity        → open = max(0, cap - enr)
  const secMap = offering?.s ?? {};   // section count   → colour uses open ÷ sections


  // Hover popover state: which gauge cell the pointer is over (desktop only — hover never
  // fires on touch, so phones simply keep the plain gauges). Holds the cell's numbers plus
  // its on-screen rect so the popover can anchor to it.
  const [hoverCell, setHoverCell] = useState(null);

  // Build lookup: { semTypeId → { calYear → offered:boolean } }
  // Pre-birth terms are excluded — they represent the course not yet existing, not a "not offered" signal.
  const byType = {};
  for (const [code, offered] of Object.entries(termHistory)) {
    if (birth !== null && Number(code) < birth) continue;
    const semType = cal.decodeTermCode(code);
    const yr      = cal.getTermCodeYear?.(code);
    if (semType && yr != null) {
      (byType[semType] ??= {})[yr] = offered;
    }
  }

  // Parallel lookups per (semType, year): enrolled, capacity, section count. Everything the
  // gauges and popover need (open, fill%, open-per-section) is derived from these three.
  const enrByType = {};
  const capByType = {};
  const secByType = {};
  for (const [code, cap] of Object.entries(capMap)) {
    if (birth !== null && Number(code) < birth) continue;
    const semType = cal.decodeTermCode(code);
    const yr      = cal.getTermCodeYear?.(code);
    if (semType && yr != null) {
      (capByType[semType] ??= {})[yr] = cap;
      (enrByType[semType] ??= {})[yr] = enrMap[code] ?? 0;
      (secByType[semType] ??= {})[yr] = secMap[code] ?? 1;
    }
  }
  // Colour by OPEN SEATS PER SECTION — the real "can I get a seat (in a section I can take)?"
  // signal. Captures class size (1 of 2 = full) AND how thinly open seats spread (5 sections
  // with 5 open ≈ 1 each = a scramble). A diverging ramp built from the app's own subject
  // colours, which are already max-saturation, so each extreme IS the given colour and the
  // near-threshold ends are lighter tints of it:
  //   wide-open → ENVR green #34d399   (light mint #a7f3d0 near the 6-seat threshold)
  //   jammed    → #e31f2b = ECON #f87171 ⊗ ENLR #e94560 (the two reds multiplied = darkest)
  //               (light coral #fca5a5 near the threshold)
  // No yellow. Height still shows fill %, so height = how-full, colour = can-I-get-in.
  const SEATS_ROOM = 6;    // ≥ this open/section = "room" (green side)
  const ROOM_OPEN  = 15;   // ≥ this = wide open (fully-saturated ENVR green)
  const lerpRGB = (A, B, t) => { const c = A.map((x, i) => Math.round(x + (B[i] - x) * t)); return `rgb(${c[0]},${c[1]},${c[2]})`; };
  const seatColor = (v) => {
    if (v == null) return "#34d399";
    if (v >= SEATS_ROOM) {
      // room: pale mint (near threshold) → saturated ENVR green (wide open)
      const t = Math.min(1, (v - SEATS_ROOM) / (ROOM_OPEN - SEATS_ROOM));  // 6→0 (pale) .. 15+→1 (saturated)
      return lerpRGB([216, 250, 209], [52, 211, 141], t);                 // #d8fad1 → #34d38d (pale end has a faint warm/yellow tint)
    }
    // competitive: pale coral (near threshold) → darkest combined red, leaning coral (jammed)
    const t = (SEATS_ROOM - 1 - Math.max(0, v)) / (SEATS_ROOM - 1);       // 5→0 (pale) .. 0→1 (darkest)
    return lerpRGB([254, 207, 204], [238, 72, 78], t);                    // #fecfcc → #ee484e (pale end: only a whisper of warmth — coral+yellow muddies fast)
  };
  // Diverging legend: the two sides get EQUAL halves of the bar with the pale transition dead
  // centre — competitive (coral) fills the left 50%, roomy (green) the right 50% — instead of a
  // raw 0→ROOM_OPEN domain that would shove the transition off to ~40% and leave the sides
  // visibly lopsided. `seatsToPos` maps an open-per-section value to its 0..1 spot on the bar;
  // the gradient and the hover pointer both use it, so the bar stays an exact key to the colours.
  const seatsToPos = (v) => v <= SEATS_ROOM
    ? (Math.max(0, v) / SEATS_ROOM) * 0.5                                    // 0→0 … 6→0.5
    : 0.5 + Math.min(1, (v - SEATS_ROOM) / (ROOM_OPEN - SEATS_ROOM)) * 0.5;  // 6→0.5 … 15+→1
  const posToSeats = (p) => p <= 0.5
    ? (p / 0.5) * SEATS_ROOM
    : SEATS_ROOM + ((p - 0.5) / 0.5) * (ROOM_OPEN - SEATS_ROOM);
  const seatGradient = Array.from({ length: 25 }, (_, i) => {
    const p = i / 24;
    return `${seatColor(posToSeats(p))} ${Math.round(p * 100)}%`;
  }).join(", ");

  // Latest year with data per semType — simply the max key in each byType row.
  const latestPastYearByType = {};
  for (const [semType, yrMap] of Object.entries(byType)) {
    const yrs = Object.keys(yrMap).map(Number);
    if (yrs.length) latestPastYearByType[semType] = Math.max(...yrs);
  }

  // Global year range — defines shared fixed columns across all semType rows.
  const allYearNums   = Object.values(byType).flatMap(m => Object.keys(m).map(Number));
  const globalMinYear = allYearNums.length ? Math.min(...allYearNums) : 0;
  const globalMaxYear = allYearNums.length ? Math.max(...allYearNums) : 0;
  const totalCols     = allYearNums.length ? globalMaxYear - globalMinYear + 1 : 0;
  const histWidth     = totalCols * YR_CELL;

  // Explicit overrides: { semTypeId: true | false }.
  // Old array format (pre-refactor saves) is ignored gracefully → treated as no override.
  const rawOvr     = offeredOverrides[selCourse.id];
  const ovrMap     = (rawOvr && !Array.isArray(rawOvr)) ? rawOvr : {};
  const hasOverride = Object.keys(ovrMap).length > 0;

  // Historical offering probability for a given semTypeId — through the port, not restated.
  //
  // This was a fourth private copy of one rule: the post-birth filter and the
  // two-entries-minimum, duplicating `effectiveOffered` in the adapter, an inline block in
  // CourseCard, and a weaker test in CHART. Four copies of "is this offered" is how the
  // engine came to place `CS 3800` in a Summer B that the card next to it marked `offered?`.
  //
  // Null still means "not enough evidence" and is not a zero; the popover renders the two
  // differently, which is the whole reason it wants the number rather than the verdict.
  const semTypeProb = (semTypeId) =>
    offeringPort.probability(selCourse, semTypeId, ovrMap);

  // Write an explicit override (true/false) or clear it (undefined → delete key).
  function setOverride(semTypeId, value) {
    setOfferedOverrides(prev => {
      const cur    = prev[selCourse.id];
      const curMap = (!cur || Array.isArray(cur)) ? {} : { ...cur };
      if (value === undefined) { delete curMap[semTypeId]; }
      else { curMap[semTypeId] = value; }
      const next = { ...prev };
      if (Object.keys(curMap).length === 0) delete next[selCourse.id];
      else next[selCourse.id] = curMap;
      return next;
    });
  }

  // Click cycle: auto → forced-on → forced-off → auto
  function cycleOverride(semTypeId) {
    const cur = ovrMap[semTypeId];
    if (cur === undefined)    setOverride(semTypeId, true);
    else if (cur === true)    setOverride(semTypeId, false);
    else                      setOverride(semTypeId, undefined);
  }

  function resetAllOverrides(e) {
    e.stopPropagation();
    setOfferedOverrides(prev => { const n = { ...prev }; delete n[selCourse.id]; return n; });
  }

  // Typical meeting days as a per-weekday frequency gradient. Competitiveness is intentionally
  // NOT summarized in words — the per-term fill shading on the cells above shows it directly.
  const dow    = offering?.dow ?? null;                 // [M,T,W,Th,F] % of sections
  const anyDay = dow?.some(v => v > 0) ?? false;
  const pat    = offering?.pat ?? null;                 // [[pattern, %], …] most common first
  // Hover state for the meeting-pattern breakdown chart (desktop only; same as the gauge popover).
  const [schedHover, setSchedHover] = useState(null);

  return (
    <div style={{ flexShrink: 0, width: compact ? "100%" : "fit-content", display: "flex", flexDirection: "column", padding: compact ? 0 : "0 12px 0 6px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.06em" }}>
          {t("info.offered.title")}
        </span>
        {hasOverride && (
          <button onClick={resetAllOverrides}
            style={{ fontSize: 8, color: "var(--text-5)", background: "none", border: "1px solid var(--border-card)", borderRadius: 3, cursor: "pointer", padding: "0 4px", lineHeight: "14px" }}>
            reset
          </button>
        )}
      </div>

      {/* Legend intentionally omitted — the year header + shaded gauges are self-explanatory. */}

      {/* Year header — labels the columns once, above the gauges */}
      {histWidth > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <span style={{ width: 24, flexShrink: 0 }} />
          <div style={{ width: histWidth, position: "relative", flexShrink: 0, height: 11 }}>
            {Array.from({ length: totalCols }, (_, i) => globalMinYear + i).map(yr => (
              <span key={yr} style={{
                position: "absolute", right: (globalMaxYear - yr) * YR_CELL + 2,
                width: YR_CELL - 4, textAlign: "center",
                fontSize: 8.5, fontWeight: 700, color: "var(--text-4)",
                fontVariantNumeric: "tabular-nums",
              }}>{String(yr).slice(-2)}</span>
            ))}
          </div>
          <span style={{ width: 14, flexShrink: 0 }} />
        </div>
      )}

      {semTypes.map(({ id, label, shortLabel }) => {
        const yrMap  = byType[id] ?? {};
        const prob   = semTypeProb(id);              // null | 0..1
        const ovr    = ovrMap[id];                   // true | false | undefined

        const probPct       = prob === null ? 0 : prob;
        const labelDim      = ovr === false || (ovr === undefined && prob !== null && prob <= 0.5);
        const latestPastYr  = latestPastYearByType[id] ?? null;
        const probHint      = prob === null ? "No history" : `${Math.round(probPct * 100)}% historically`;
        const ovrHint       = ovr === true ? " (forced on)" : ovr === false ? " (forced off)" : "";
        const ctrlTip       = `${label}: ${probHint}${ovrHint}. Click to cycle override.`;

        return (
          <div key={id}
            style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, userSelect: "none" }}>

            {/* Semtype label */}
            <span title={label}
              style={{ fontSize: 10, color: labelDim ? "var(--text-5)" : "var(--text-2)", width: 24, flexShrink: 0 }}>
              {shortLabel}
            </span>

            {/* Year history — one framed enrollment gauge per calendar year */}
            {histWidth > 0 && (
              <div style={{ width: histWidth, position: "relative", flexShrink: 0, height: ROW_H }}>
                {Object.entries(yrMap).map(([yrStr, offered]) => {
                  if (!offered) return null;                        // not offered that year → blank slot
                  const yr    = Number(yrStr);
                  const right = (globalMaxYear - yr) * YR_CELL;
                  const cap   = capByType[id]?.[yr] ?? null;        // capacity
                  const hasData = cap != null && cap > 0;
                  const enr   = hasData ? (enrByType[id]?.[yr] ?? 0) : null;
                  const sec   = secByType[id]?.[yr] ?? 1;           // section count
                  const open  = hasData ? Math.max(0, cap - enr) : null;   // seats remaining
                  const fill  = hasData ? Math.round((enr / cap) * 100) : null; // fill %  → height
                  const perSec = open != null ? open / sec : null;  // seats per section  → colour
                  const cell = { id, label, yr, enr, cap, open, sec, fill, perSec };
                  return (
                    <span key={yr}
                      onMouseEnter={hasData ? e => setHoverCell({ ...cell, rect: e.currentTarget.getBoundingClientRect() }) : undefined}
                      onMouseLeave={hasData ? () => setHoverCell(c => (c && c.yr === yr && c.label === label) ? null : c) : undefined}
                      // Offered but no seat data (term not yet ended — details are
                      // completed-terms-only, and merged summers finish in late Aug):
                      // dashed frame (the app's "not final" motif) + a plain tooltip,
                      // so the cell doesn't read as broken or as "0% full".
                      title={hasData ? undefined : t("info.offered.pending")}
                      style={{
                        position: "absolute", right: right + 2, bottom: 0,
                        width: YR_CELL - 4,
                        height: ROW_H,
                        borderRadius: 3, overflow: "hidden",
                        cursor: "help",
                        // Thick but subtle frame = the 100% reference so the fill reads as a
                        // clear fraction; the year is labelled once in the header above.
                        border: hasData ? "2px solid var(--border-2)" : "2px dashed var(--border-2)",
                      }}>
                      {fill != null && (
                        <span style={{
                          position: "absolute", left: 0, right: 0, bottom: 0,
                          height: `${Math.max(4, Math.min(100, fill))}%`,
                          background: seatColor(perSec),
                          opacity: 0.85,
                          pointerEvents: "none",
                        }} />
                      )}
                    </span>
                  );
                })}
              </div>
            )}

            {/* 3-state control: auto (gradient fill) → forced-on (✓) → forced-off (✕) */}
            <button
              title={ctrlTip}
              onClick={e => { e.stopPropagation(); cycleOverride(id); }}
              style={{
                flexShrink: 0,
                position: "relative",
                width: 14, height: 14,
                // Neutral / monochrome on purpose: the traffic-light palette is reserved for
                // the enrollment-fill cells, so this override control never competes with it.
                border: `1.5px solid ${ovr === true ? "var(--text-3)" : "var(--border-1)"}`,
                borderRadius: 3,
                background: "transparent",
                cursor: "pointer",
                padding: 0,
                overflow: "hidden",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
              {ovr === true && (
                <span style={{ fontSize: 9, lineHeight: 1, fontWeight: 800, color: "var(--text-1)" }}>✓</span>
              )}
              {ovr === false && (
                <span style={{ fontSize: 8, lineHeight: 1, fontWeight: 800, color: "var(--text-4)" }}>✕</span>
              )}
            </button>
          </div>
        );
      })}

      <div style={{ fontSize: 8.5, color: "var(--text-5)", fontStyle: "italic", marginTop: 9, lineHeight: "calc(1.4 * var(--lh-scale, 1))", width: 0, minWidth: "100%" }}>
        {hasHistory ? t("info.offered.hint") : t("info.offered.nodata")}
      </div>

      {dow && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.06em", marginBottom: 5 }}>
            {t("info.offered.schedule")}
          </div>
          {anyDay
            ? <div
                style={{ width: "fit-content", cursor: pat ? "help" : "default" }}
                onMouseEnter={pat ? e => setSchedHover(e.currentTarget.getBoundingClientRect()) : undefined}
                onMouseLeave={pat ? () => setSchedHover(null) : undefined}>
                <WeekdayStrip dow={dow} />
              </div>
            : <span style={{ fontSize: 10, color: "var(--text-3)", fontStyle: "italic" }}>{t("info.offered.async")}</span>}
        </div>
      )}

      {schedHover && pat && (
        <SchedulePopover pat={pat} rect={schedHover} />
      )}

      {hoverCell && (
        <OfferingPopover
          cell={hoverCell}
          gradient={seatGradient}
          markerPos={seatsToPos(hoverCell.perSec ?? 0) * 100}
          color={seatColor(hoverCell.perSec)}
        />
      )}
    </div>
  );
}

// Rich hover card for a single availability gauge (desktop only). Anchors to the hovered cell's
// on-screen rect (position: fixed) and explains the colour: the exact numbers behind the cell,
// the open-seats-per-section value that drives the shade, and the full colour scale with a
// pointer marking where this term lands on it.
function OfferingPopover({ cell, gradient, markerPos, color }) {
  const { t, locale, locales } = useLanguage();
  const dir = locales.find(l => l.code === locale)?.dir ?? "ltr";   // popover follows locale direction
  const { id, yr, enr, cap, open, sec, fill, perSec, rect } = cell;

  // Header = "<semester> <year>", rendered by the shared <SemLabel> so it's translated identically
  // to the planner rows (see SemLabel.jsx for the naming/translation rules).
  const header = <SemLabel typeId={id} year={yr} />;

  const WIDTH = 246;
  const GAP   = 22;   // horizontal clearance between the cell and the popover
  const EDGE  = 8;    // min clearance from any viewport edge

  // Anchor to the hovered CELL, off to its right, with the "open ÷ sections = …" equation line
  // level with the cell's vertical centre. Flip to the left of the cell if there's no room, and
  // clamp inside the viewport so it can never be cut off. Rendered through a portal to
  // document.body so it escapes the app container's transform:scale (which would otherwise throw
  // fixed-positioning coordinates completely off).
  const ref     = useRef(null);
  const lineRef = useRef(null);   // the per-section equation line, aligned to the cell centre
  const [placed, setPlaced] = useState(null);   // {top, left} once measured
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const lineMid = lineRef.current
      ? lineRef.current.offsetTop + lineRef.current.offsetHeight / 2
      : h / 2;
    let left = rect.right + GAP;                                    // to the right of the cell…
    if (left + WIDTH > window.innerWidth - EDGE) left = rect.left - GAP - WIDTH;  // …or left if tight
    left = Math.min(Math.max(EDGE, left), window.innerWidth - WIDTH - EDGE);
    let top = (rect.top + rect.bottom) / 2 - lineMid;              // line level with cell centre
    top = Math.min(Math.max(EDGE, top), window.innerHeight - h - EDGE);
    setPlaced({ top: Math.round(top), left: Math.round(left) });
  }, [rect]);

  const style = {
    position: "fixed",
    left: placed ? placed.left : Math.round(rect.right + GAP),
    top:  placed ? placed.top  : Math.round(rect.top),
    zIndex: 9000,
    width: WIDTH,
    padding: "13px 15px 14px",
    background: "var(--bg-surface)",
    border: "1px solid var(--border-card)",
    borderRadius: 8,
    boxShadow: "var(--shadow-modal)",
    pointerEvents: "none",
    fontVariantNumeric: "tabular-nums",
    fontFamily: "'Inter', system-ui, sans-serif",
    direction: dir,                               // RTL locales (Arabic) flip the layout…
    visibility: placed ? "visible" : "hidden",   // avoid a first-frame flash at the pre-measure spot
  };

  const pos = Math.max(0, Math.min(100, markerPos));                   // marker along the diverging ramp
  const sectionWord = sec === 1 ? t("info.offered.pop.section") : t("info.offered.pop.sections");

  return createPortal(
    <div ref={ref} style={style}>
      {/* Header — rendered with the planner's exact label patterns (see `header` above) so the
          popover title always matches the corresponding planner row's translation. */}
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-1)", marginBottom: 12 }}>
        {header}
      </div>

      {/* Two derivations, each an explicit division ending in the value that drives one visual
          channel: enrolled ÷ seats = fill% (gauge HEIGHT), open ÷ sections = per-section (gauge
          COLOUR). The per-section result is tinted with the gauge's own colour so the number and
          the shade are visibly the same thing; labelled operands + ÷ keep them from reading as
          products, and each derived value sits with its own equation (no split-off header %). */}
      {/* Result-forward stats: the derived number leads (big), its plain-language meaning sits
          beside it, and the derivation is a muted line beneath. The derivation is dir="ltr" (maths
          reads left-to-right even in RTL) with every translated word <bdi>-isolated so an Arabic
          label can't reorder the numbers. 90% needs no word-label (percent is self-evident); the
          per-section figure gets one because a bare 3.20 is easy to misread. */}
      {/* Fullness → gauge height */}
      <div style={{ marginBottom: 14 }}>
        <b style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)", lineHeight: "calc(1.1 * var(--lh-scale, 1))" }}>{fill}%</b>
        <div dir="ltr" style={{ fontSize: 10, color: "var(--text-4)", fontVariantNumeric: "tabular-nums", marginTop: 3, textAlign: dir === "rtl" ? "right" : "left" }}>
          <span style={{ color: "var(--text-3)" }}>{enr}</span> <bdi>{t("info.offered.pop.enrolled")}</bdi>
          <span> ÷ </span>
          <span style={{ color: "var(--text-3)" }}>{cap}</span> <bdi>{t("info.offered.pop.seats")}</bdi>
        </div>
      </div>

      {/* Open per section → gauge colour (result tinted with that colour) */}
      <div ref={lineRef} style={{ marginBottom: 15 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          <b style={{ fontSize: 16, fontWeight: 700, color, lineHeight: "calc(1.1 * var(--lh-scale, 1))" }}>{(perSec ?? 0).toFixed(2)}</b>
          <span style={{ fontSize: 9.5, color: "var(--text-4)" }}>{t("info.offered.pop.avgDesc")}</span>
        </div>
        <div dir="ltr" style={{ fontSize: 10, color: "var(--text-4)", fontVariantNumeric: "tabular-nums", marginTop: 3, textAlign: dir === "rtl" ? "right" : "left" }}>
          <span style={{ color: "var(--text-3)" }}>{open}</span> <bdi>{t("info.offered.pop.open")}</bdi>
          <span> ÷ </span>
          <span style={{ color: "var(--text-3)" }}>{sec}</span> <bdi>{sectionWord}</bdi>
        </div>
      </div>

      {/* The colour scale, with a pointer where this term lands */}
      <div style={{ position: "relative", height: 9, borderRadius: 5, background: `linear-gradient(to right, ${gradient})`, marginTop: 2 }}>
        <span style={{
          position: "absolute", top: -3, bottom: -3, left: `${pos}%`,
          width: 2, transform: "translateX(-1px)",
          background: "var(--text-1)", borderRadius: 1,
          boxShadow: "0 0 0 1.5px var(--bg-surface)",
        }} />
      </div>
      {/* dir="ltr" so the labels stay physically aligned with the bar (which is always drawn
          left→red … right→green): packed under the red end, wide-open under the green end. */}
      <div dir="ltr" style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 8, color: "var(--text-4)", fontWeight: 500 }}>
        <bdi>{t("info.offered.pop.packed")}</bdi>
        <bdi>{t("info.offered.pop.open2")}</bdi>
      </div>
    </div>,
    document.body
  );
}

// One row's mini day strip: a cell per relevant weekday with the pattern's days filled in the
// subject colour (mirrors the WeekdayStrip look), deciphering the Banner codes (R=Thu, S=Sat,
// U=Sun) into visible, localised day letters. `days`/`labels` are parallel arrays.
function PatternStrip({ pattern, days, labels }) {
  return (
    <span style={{ display: "flex", gap: 3, flexShrink: 0 }}>
      {days.map((d, i) => {
        // A pattern day is binary — on or off — so it reads at the strip's
        // busiest-day weight, or recedes entirely. Same letters-only language.
        const on = pattern.includes(d);
        return (
          <span key={i} style={{
            minWidth: 18, height: 18,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 10.5,
            fontWeight: on ? 800 : 400,
            color: on ? "var(--text-1)" : "var(--text-5)",
            opacity: on ? 1 : 0.4,
          }}>{labels[i]}</span>
        );
      })}
    </span>
  );
}

// Hover chart for the meeting-pattern breakdown (desktop only). Anchored to the weekday strip,
// portaled to document.body (escapes the app's transform:scale). Horizontal bars, most common on
// top; day-patterns get a mini strip, async/other a text label. Laid out LTR as a chart.
function SchedulePopover({ pat, rect }) {
  const { t } = useLanguage();
  // Weekday columns M–F always; add Saturday/Sunday columns only when this course actually has
  // weekend sections, so the rare weekend patterns (S/U) render visibly instead of as raw codes.
  const wd = (t("info.offered.weekdays") || "M,T,W,Th,F").split(",");   // [M,T,W,Th,F]
  const we = (t("info.offered.weekend")  || "Sa,Su").split(",");        // [Sat, Sun]
  const hasSat = pat.some(([p]) => p.includes("S"));
  const hasSun = pat.some(([p]) => p.includes("U"));
  const days   = ["M", "T", "W", "R", "F", ...(hasSat ? ["S"] : []), ...(hasSun ? ["U"] : [])];
  const labels = [...wd, ...(hasSat ? [we[0]] : []), ...(hasSun ? [we[1] ?? we[0]] : [])];
  const LABEL_W = days.length * 21;   // fixed label column so every bar starts at the same x

  const WIDTH = LABEL_W + 158;
  const GAP   = 12;
  const EDGE  = 8;
  const ref = useRef(null);
  const [placed, setPlaced] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    let left = rect.left + rect.width / 2 - WIDTH / 2;               // centred over the strip
    left = Math.min(Math.max(EDGE, left), window.innerWidth - WIDTH - EDGE);
    let top = rect.top - GAP - h;                                    // above the strip…
    if (top < EDGE) top = rect.bottom + GAP;                         // …or below if it'd clip the top
    top = Math.min(Math.max(EDGE, top), window.innerHeight - h - EDGE);
    setPlaced({ top: Math.round(top), left: Math.round(left) });
  }, [rect]);

  // Long tail beyond the stored top patterns → an "other" row.
  const shown = pat.reduce((s, [, p]) => s + p, 0);
  const other = Math.max(0, 100 - shown);
  const rows  = other >= 1 ? [...pat, ["__other", other]] : pat;

  const style = {
    position: "fixed",
    left: placed ? placed.left : Math.round(rect.left + rect.width / 2 - WIDTH / 2),
    top:  placed ? placed.top  : Math.round(rect.top - GAP),
    zIndex: 9000, width: WIDTH, padding: "15px 17px",
    background: "var(--bg-surface)", border: "1px solid var(--border-card)",
    borderRadius: 9, boxShadow: "var(--shadow-modal)", pointerEvents: "none",
    fontFamily: "'Inter', system-ui, sans-serif",
    visibility: placed ? "visible" : "hidden",
  };

  return createPortal(
    <div ref={ref} style={style}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.06em", marginBottom: 13 }}>
        <bdi>{t("info.offered.schedule")}</bdi>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map(([pattern, pct], i) => {
          const isOther = pattern === "__other";
          const isAsync = pattern === "async";
          const isStrip = !isOther && !isAsync;   // every real pattern is now covered by the day columns
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: LABEL_W, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {isStrip
                  ? <PatternStrip pattern={pattern} days={days} labels={labels} />
                  : isAsync
                    ? <bdi style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)" }}>{t("info.offered.pop.online")}</bdi>
                    : <bdi style={{ fontSize: 10.5, color: "var(--text-4)", fontStyle: "italic" }}>
                        {isOther ? t("info.offered.pop.other") : pattern}
                      </bdi>}
              </span>
              <div style={{ flex: 1, height: 9, borderRadius: 5, background: "var(--bg-surface-2)", overflow: "hidden" }}>
                <div style={{ width: `${Math.max(2, pct)}%`, height: "100%", borderRadius: 5, background: isOther ? "var(--text-5)" : "var(--text-2)", opacity: isOther ? 0.55 : 0.85 }} />
              </div>
              <span style={{ minWidth: 30, textAlign: "right", fontSize: 11, color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>{pct}%</span>
            </div>
          );
        })}
      </div>
      {/* What the percentages are OF — the one thing the bars cannot say. They are
          shares of ENROLMENT (a 400-seat MWF lecture outweighs a 20-seat TF section),
          pooled over every term on record rather than a recent window, which is why
          "62%" is not the same as "62% of sections". */}
      <div style={{ fontSize: 8.5, color: "var(--text-5)", fontStyle: "italic", marginTop: 13, lineHeight: "calc(1.4 * var(--lh-scale, 1))" }}>
        <bdi>{t("info.offered.pop.basis")}</bdi>
      </div>
    </div>,
    document.body
  );
}

