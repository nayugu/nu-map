// ═══════════════════════════════════════════════════════════════════
// SUMMER ROW  — renders sumA + sumB as a single combined visual block
// ═══════════════════════════════════════════════════════════════════
import { usePlanner } from "../context/PlannerContext.jsx";
import { useRelevance } from "../context/RelevanceContext.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { useState, useEffect, useMemo } from "react";
import { TYPE_BG } from "../core/constants.js";
import { getSemStudySH, getOrderedCourses } from "../core/planModel.js";
import { resolveTermByDuration } from "../core/specialTermUtils.js";
import { usePort }        from "../context/InstitutionContext.jsx";
import { ISpecialTerms }  from "../ports/ISpecialTerms.js";
import { useLanguage }    from "../context/LanguageContext.jsx";
import { TText, scaleLatinRuns } from "../context/TranslationContext.jsx";
import { semName } from "../core/semGrid.js";
import CourseCard from "./CourseCard.jsx";
import CompanySearch from "./CompanySearch.jsx";
import CoopCourseSearch from "./CoopCourseSearch.jsx";
import CompanyLogo from "./CompanyLogo.jsx";
import { FadeInput } from "./FadeText.jsx";

// One card slot, in a summer column. Course cards, the empty dashed slots and
// the co-op / internship cards all stand on this: a co-op sitting beside a
// course in the same summer has to be the SAME height as it, or the two
// sessions read as different kinds of thing. The special-term cards used to
// carry their own 58, which was 8px short of a course on desktop and 23px
// tall on a phone.
const SLOT_H = isPhone => (isPhone ? 35 : 66);


export default function SummerRow({ semA, semB }) {
  const {
    placements, semOrders, effectiveCourseMap,
    semesterCards, semesterLoad,
    getSemStatus, setCurrentSemId,
    dragInfo, hoveredSem, hoveredZone,
    onDragOver, onDragLeave, onDrop,
    setHoveredZone, setHoveredSem,
    specialTermStartMap, specialTermContMap, specialTermPl, setSpecialTermPl,
    cardRefs, onDragStart,
    SEM_INDEX,
    pushUndo, isPhone,
    collapseOtherCredits, showContLogo, revealTarget,
    semTrackingMode,
    studentType,
    privateCoop,
    courseMap, selectedId, setSelectedId, setShowPanel,
  } = usePlanner();
  // Which course each work term registers — resolved app-wide, same source the
  // fall/spring card and the audit read.
  const { workTermCourse, coopProgramOptions } = useRelevance();
  // Work-experience courses grouped by which BLOCK registers them, so a co-op
  // card offers co-op registrations and an internship card offers internship
  // ones. Keyed rather than filtered inline because this row renders two
  // half-slots and `termStartType` is per-slot, below.
  const workTermCoursesByKind = useMemo(
    () => {
      const mine = coopProgramOptions ?? new Set();
      const by = {};
      for (const c of Object.values(courseMap ?? {})) {
        if (!c.coop) continue;
        (by[c.coop.kind ?? "coop"] ??= []).push(c);
      }
      for (const list of Object.values(by)) {
        list.sort((a, b) => (mine.has(b.id) - mine.has(a.id)) || a.id.localeCompare(b.id));
      }
      return by;
    },
    [courseMap, coopProgramOptions]
  );

  const isLive = semTrackingMode === "live";
  const onNowClick = () => { if (!isLive) setCurrentSemId(semA.id); };

  const { themeName } = useTheme();
  const specialTerms = usePort(ISpecialTerms);
  const { t } = useLanguage();
  const companyColor = themeName === "dark" ? "#b0bbc5" : "var(--text-3)";
  const placeholderColor = themeName === "dark" ? "#3e4856" : "#e4e4e4";

  // Collapsible state for other credits
  const [showOther, setShowOther] = useState(!collapseOtherCredits);
  useEffect(() => { if (collapseOtherCredits) setShowOther(false); else setShowOther(true); }, [collapseOtherCredits]);

  const year     = semA.id.replace("sumA", "");
  const sems     = [semA, semB].filter(Boolean);

  // Open the low-credit zone when a reveal lands in it — see the same effect
  // in SemRow. One `showOther` covers BOTH halves here, so both are checked;
  // a jump to a 1 SH course in Summer B must not depend on Summer A.
  useEffect(() => {
    if (!revealTarget) return;
    const inOthers = sems.some(s => semesterCards(s.id)
      .some(c => c.id === revealTarget.pid && c.sh <= 2 && !c.shVoided));
    if (inOthers) setShowOther(true);
  }, [revealTarget]); // eslint-disable-line react-hooks/exhaustive-deps
  const combinedDone   = sems.every(s => getSemStatus(s.id) === "completed");
  const combinedActive = sems.some(s => getSemStatus(s.id) === "inprogress");
  // Per-half: a co-op occupying Summer A/B excludes that half's courses from the
  // combined load (they stay in the plan, recoverable) — see getSemStudySH.
  // The combined view, like SemRow. Summers render through a DIFFERENT
  // component than fall/spring, which is how the previous attempt taught one
  // and had reservations silently vanish from the other.
  const combinedSH     = sems.reduce((sum, s) => sum + semesterLoad(s.id), 0);
  const tb         = TYPE_BG.summer;
  const rowBg      = tb.bg;
  const rowBorder  = combinedActive ? "1px solid var(--active-now-border)" : `1px solid ${tb.border}`;
  const rowOpacity = combinedDone ? 0.9 : 1;

  const removeTerm = id => { pushUndo(); setSpecialTermPl(p => { const n = { ...p }; delete n[id]; return n; }); };

  const termNum = (typeId, id) => Object.entries(specialTermPl)
    .filter(([, d]) => d?.semId && d.typeId === typeId)
    .sort(([, a], [, b]) => (SEM_INDEX[a.semId] ?? 99) - (SEM_INDEX[b.semId] ?? 99))
    .findIndex(([eid]) => eid === id) + 1;

  const renderSession = sem => {
    if (!sem) return null;
    const semStatus  = getSemStatus(sem.id);
    const semIsDone  = semStatus === "completed";
    const isSessionA = sem.id.startsWith("sumA");
    const sessionLabel = isSessionA ? "Summer A" : "Summer B";
    // Translation rephrasing — "Session" alone reads as "meeting" in many
    // languages; rephrase as a summer half-term so the translation engine
    // picks the academic sense.  Displayed source-locale text stays as-is.
    const sessionAs = isSessionA ? "Summer half-term A" : "Summer half-term B";

    // ── Special term start card ───────────────────────────────────
    const termStartId   = specialTermStartMap[sem.id];
    const termStartData = termStartId ? specialTermPl[termStartId] : null;
    const termStartType = termStartData ? (specialTerms?.getTypes() ?? []).find(t => t.id === termStartData.typeId) : null;
    const termStartDur  = termStartType ? resolveTermByDuration(termStartType.durations, termStartData.duration) : null;
    if (termStartDur) {
      const displayLabel = termStartType.label;
      const registers = workTermCourse?.[termStartId] ?? null;
      return (
        <div key={sem.id} data-sem-id={sem.id} style={{
          flex: 1, minWidth: 0, overflow: "hidden",
          border: `1px solid ${hoveredSem === sem.id ? "var(--active)" : "var(--border-slot)"}`, borderRadius: 4, padding: "4px 5px",
          background: hoveredSem === sem.id ? "var(--active-bg)" : "var(--card-bg)",
          transition: "background 0.1s, border-color 0.1s",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 5 }}>
            <span style={{ fontSize: isPhone ? 5 : 9, fontWeight: 600, color: companyColor, fontFamily: "'InterTight', 'Inter', sans-serif" }}><TText as={sessionAs} tight>{sessionLabel}</TText></span>
            <span style={{ fontSize: isPhone ? 5 : 9, color: "var(--text-5)" }}><TText>{sem.sub}</TText></span>
          </div>
          <div
            ref={el => { cardRefs.current[termStartId] = el; }}
            draggable
            data-drag-id={termStartId}
            data-drag-type="specialTerm"
            data-drag-typeid={termStartData.typeId}
            data-drag-duration={termStartData.duration}
            data-drag-from={sem.id}
            onDragStart={e => onDragStart(e, termStartId, "specialTerm", sem.id, { duration: termStartData.duration, typeId: termStartData.typeId })}
            // Click opens the course, drag moves the block — the same pair
            // CourseCard uses. Only when the student CHOSE one: opening a
            // course page off the resolver's inference would present a guess
            // as a fact.
            onClick={termStartData.courseId ? e => {
              e.stopPropagation();
              const id = termStartData.courseId;
              if (selectedId === id) { setSelectedId(null); setShowPanel(false); }
              else { setSelectedId(id); setShowPanel(true); }
            } : undefined}
            style={{
              width: "100%", minHeight: SLOT_H(isPhone),
              background: "var(--card-bg)",
              border: "1px solid var(--border-card)",
              borderRadius: 6, padding: "8px 10px 8px 12px",
              cursor: "grab", display: "flex", flexDirection: "column", justifyContent: "center",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              {/* 14 — the same size a fall/spring START card uses, and now one
                  step ABOVE the continuation. The two were the wrong way round:
                  the term merely passing through a semester was set larger than
                  the term that begins in one. */}
              {/* Same stack as SemRow's card: the label, and under it the
                  course this work term registers. NU's two default co-op
                  patterns both put a co-op in summer, so a field that exists
                  only on the fall/spring card is invisible to most students —
                  which is exactly how it shipped the first time. */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1, flexShrink: 0, minWidth: 0 }}>
                <div style={{ fontSize: isPhone ? 7 : 14, fontWeight: 600, color: companyColor, fontFamily: "'Inter', sans-serif", letterSpacing: termStartData.typeId === "coop" ? "0.08em" : "0.03em", textTransform: termStartData.typeId === "coop" ? "uppercase" : "none", whiteSpace: "nowrap" }}>
                  <TText>{displayLabel}</TText> {termNum(termStartData.typeId, termStartId)}
                </div>
                {/* The TYPE registering a course, not a course having been
                    chosen — otherwise the field appears only once used. */}
                {termStartType?.registersCourse && !privateCoop && (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, maxWidth: isPhone ? 62 : 108 }}
                       onMouseDown={e => e.stopPropagation()}
                       onClick={e => e.stopPropagation()}>
                    <CoopCourseSearch
                      value={termStartData.courseId ?? ""}
                      courses={workTermCoursesByKind[termStartType.registersCourse] ?? []}
                      color="var(--text-4)"
                      emptyColor={placeholderColor}
                      fontSize={isPhone ? 5 : 9}
                      placeholder={t("sem.work.course.placeholder")}
                      onChange={id => {
                        pushUndo();
                        setSpecialTermPl(p => ({ ...p, [termStartId]: id
                          ? { ...p[termStartId], courseId: id }
                          : (({ courseId, ...rest }) => rest)(p[termStartId]) }));
                      }}
                    />
                  </div>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "stretch", gap: 1, paddingLeft: isPhone ? 8 : 17 }}>
                {privateCoop ? null : (
                  <>
                    <CompanySearch name={termStartData.company} color={companyColor} emptyColor={placeholderColor} fontSize={isPhone ? 7 : 13} placeholder={t("sem.work.company.placeholder")} onChange={v => setSpecialTermPl(p => ({ ...p, [termStartId]: { ...p[termStartId], company: v?.name ?? "", companyDomain: v?.domain ?? "" } }))} />
                    <FadeInput value={termStartData.subline ?? ""} onChange={e => setSpecialTermPl(p => ({ ...p, [termStartId]: { ...p[termStartId], subline: e.target.value } }))} onMouseDown={e => e.stopPropagation()} placeholder={t("sem.work.role.placeholder")} className="work-input" style={{ textAlign: "right", width: "100%", fontFamily: "'Inter', sans-serif", fontSize: isPhone ? 5 : 9, fontWeight: 400, color: termStartData.subline ? companyColor : placeholderColor, background: "transparent", border: "none", outline: "none", padding: 0 }} />
                  </>
                )}
              </div>
              <CompanyLogo key={termStartData.companyDomain || ""} domain={termStartData.companyDomain} name={termStartData.company} size={isPhone ? 17 : 34} />
              <button onClick={e => { e.stopPropagation(); removeTerm(termStartId); }} onMouseDown={e => e.stopPropagation()} style={{ background: "none", border: "none", color: "var(--text-4)", cursor: "pointer", fontSize: 11, lineHeight: 1, padding: 0, flexShrink: 0 }} title={t("sem.term.remove", { type: termStartType.label.toLowerCase() })}>✕</button>
            </div>
          </div>
        </div>
      );
    }

    // ── Special term continuation block ──────────────────────────
    const termContId   = specialTermContMap[sem.id];
    const termContData = termContId ? specialTermPl[termContId] : null;
    const termContType = termContData ? (specialTerms?.getTypes() ?? []).find(t => t.id === termContData.typeId) : null;
    const termContDur  = termContType ? resolveTermByDuration(termContType.durations, termContData.duration) : null;
    if (termContDur && !termStartId) {
      return (
        <div key={sem.id} data-sem-id={sem.id} style={{
          flex: 1, minWidth: 0, overflow: "hidden",
          border: "1px solid var(--border-slot)", borderRadius: 4, padding: "4px 5px",
          background: "var(--card-bg)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 5 }}>
            <span style={{ fontSize: isPhone ? 5 : 9, fontWeight: 700, color: "var(--text-3)", fontFamily: "'InterTight', 'Inter', system-ui, sans-serif" }}><TText as={sessionAs} tight>{sessionLabel}</TText></span>
            <span style={{ fontSize: isPhone ? 5 : 9, color: "var(--text-5)" }}><TText>{sem.sub}</TText></span>
          </div>
          <div style={{
            width: "100%", minHeight: SLOT_H(isPhone),
            border: "1px solid var(--border-card)",
            borderRadius: 6, padding: "8px 14px",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
          }}>
            <div>
              {/* Reads exactly as the fall/spring continuation does — same word
                  from sem.cont.label, same 13, same subline — so a co-op that
                  runs from summer into fall says one thing in both halves. */}
              <div style={{ fontSize: isPhone ? 7 : 13, fontWeight: 600, color: companyColor, fontFamily: "'Inter', sans-serif", letterSpacing: termContData.typeId === "coop" ? "0.08em" : "0.03em", textTransform: termContData.typeId === "coop" ? "uppercase" : "none" }}><TText>{termContType?.label}</TText> {t("sem.cont.label")}</div>
              <div style={{ fontSize: isPhone ? 5 : 10, color: "var(--text-4)", marginTop: 2 }}>{termContData.duration}-month block</div>
            </div>
            {showContLogo && <CompanyLogo key={termContData.companyDomain || ""} domain={termContData.companyDomain} name={termContData.company} size={isPhone ? 17 : 34} />}
          </div>
        </div>
      );
    }

    // ── Normal course session ─────────────────────────────────────
    const crs        = semesterCards(sem.id);
    const courseIds  = crs.map(c => c.id);
    // shVoided: failed takes keep their card despite sh 0 — see SemRow.
    const main4      = crs.filter(c => c.sh >= 3 || c.shVoided);
    const others     = crs.filter(c => c.sh <= 2 && !c.shVoided);
    const isGrad     = studentType === "graduate";
    const isDragging = dragInfo?.type === "course";
    // Grad: 1 slot at rest (default summer load), expand to 2 while dragging.
    // Undergrad: always 2 slots.
    const slotCount  = isGrad
      ? (isDragging ? Math.min(2, Math.max(1, main4.length < 2 ? main4.length + 1 : 2)) : Math.max(1, main4.length))
      : 2;
    const emptySlots = Math.max(0, slotCount - main4.length);

    return (
      <div key={sem.id}
        data-sem-id={sem.id}
        onDragOver={e => onDragOver(e, sem.id)}
        onDragLeave={onDragLeave}
        onDrop={e => onDrop(e, sem.id)}
        style={{
          flex: 1, minWidth: 0, overflow: "visible",
          padding: "4px 5px",
          border: `1px solid ${hoveredSem === sem.id ? "var(--active)" : "var(--border-slot)"}`,
          borderRadius: 4,
          background: hoveredSem === sem.id ? "var(--active-bg)" : "transparent",
          transition: "background 0.1s, border-color 0.1s",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 5 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: semIsDone ? "var(--success)" : "var(--text-4)", fontFamily: "'InterTight', 'Inter', system-ui, sans-serif" }}>
            <TText as={sessionAs} tight>{sessionLabel}</TText>
          </span>
          <span style={{ fontSize: 9, color: "var(--text-5)" }}><TText>{sem.sub}</TText></span>
          {semIsDone && <span style={{ fontSize: 8, color: "var(--success)" }}>✓</span>}
        </div>

        {/* Main ≥3 SH slots */}
        <div style={{
          display: "grid", gridTemplateColumns: `repeat(${Math.max(1, slotCount || 1)}, 1fr)`, gap: 4,
          minHeight: SLOT_H(isPhone),
          overflow: "visible",
          borderRadius: 4, padding: 2,
          border: hoveredZone?.semId === sem.id && hoveredZone?.zone === "main"
            ? "1px solid var(--active)" : "1px solid transparent",
          background: hoveredZone?.semId === sem.id && hoveredZone?.zone === "main"
            ? "var(--active-bg)" : "transparent",
        }}
          onDragOver={e => {
            if (!dragInfo || dragInfo.type !== "course") return;
            const c = effectiveCourseMap[dragInfo.id]; if (!c || c.sh < 3) return;
            e.preventDefault(); e.stopPropagation();
            setHoveredZone({ semId: sem.id, zone: "main" }); setHoveredSem(null);
          }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setHoveredZone(null); }}
          onDrop={e => {
            if (!dragInfo || dragInfo.type !== "course") return;
            const c = effectiveCourseMap[dragInfo.id]; if (!c || c.sh < 3) return;
            e.stopPropagation(); setHoveredZone(null); onDrop(e, sem.id);
          }}
        >
          {main4.map(c => <CourseCard key={c.id} course={c} inSem semId={sem.id} />)}
          {Array.from({ length: emptySlots }).map((_, i) => (
            <div key={`ms-${i}`} style={{
              height: SLOT_H(isPhone),
              border: "1px dashed var(--border-slot)", borderRadius: 6, background: tb.bg,
            }} />
          ))}
        </div>

        {/* Other <4 SH (collapsible) */}
        {(others.length > 0 || (dragInfo?.type === "course" && (effectiveCourseMap[dragInfo.id]?.sh ?? 3) <= 2)) && (
          <div style={{ marginTop: 4 }}>
            <button
              onClick={() => setShowOther(v => !v)}
              style={{
                fontSize: 9, color: "var(--text-5)", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 2, textAlign: "left"
              }}
              aria-expanded={showOther}
              title={showOther ? t("sem.other.title.hide") : t("sem.other.title.show")}
            >
              {showOther
                ? t("sem.other.label.open")
                : (!isPhone && others.length > 0)
                  ? `► ${others.map(c => `${c.subject} ${c.number}`).join(", ")}`
                  : t("sem.other.label.closed")
              }
            </button>
            {showOther && (
              <div style={{
                display: "flex", flexWrap: "wrap", gap: 4, padding: "4px 2px 2px",
                borderTop: "1px solid var(--border-sub)", borderRadius: 4,
                background: hoveredZone?.semId === sem.id && hoveredZone?.zone === "other" ? "var(--active-bg)" : "transparent",
                outline: hoveredZone?.semId === sem.id && hoveredZone?.zone === "other" ? "1px dashed var(--active)" : "none",
              }}
                onDragOver={e => {
                  if (!dragInfo || dragInfo.type !== "course") return;
                  const c = effectiveCourseMap[dragInfo.id]; if (!c || c.sh > 2) return;
                  e.preventDefault(); e.stopPropagation();
                  setHoveredZone({ semId: sem.id, zone: "other" }); setHoveredSem(null);
                }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setHoveredZone(null); }}
                onDrop={e => {
                  if (!dragInfo || dragInfo.type !== "course") return;
                  const c = effectiveCourseMap[dragInfo.id]; if (!c || c.sh > 2) return;
                  e.stopPropagation(); setHoveredZone(null); onDrop(e, sem.id);
                }}
              >
                {others.map(c => <CourseCard key={c.id} course={c} inSem semId={sem.id} />)}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div key={`summer-${year}`} style={{
      display: "flex", alignItems: "flex-start", gap: 8,
      background: rowBg, border: rowBorder, borderRadius: 6,
      padding: "6px 8px", marginBottom: 3,
      opacity: rowOpacity,
      transition: "background 0.12s, border-color 0.12s, opacity 0.15s",
    }}>
      {/* Shared label column */}
      {isPhone ? (
        <div onClick={onNowClick} style={{ width: 34, flexShrink: 0, cursor: isLive ? "not-allowed" : "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 1, paddingTop: 2 }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, background: combinedDone ? "var(--bg-surface)" : combinedActive ? "var(--active-bg)" : "transparent", border: combinedDone ? "1px solid var(--success-border)" : combinedActive ? "1px solid var(--active-now-border)" : "1px solid var(--border-2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {combinedDone   && <span style={{ fontSize: 9, color: "var(--success)", fontWeight: 900 }}>✓</span>}
            {combinedActive && <span style={{ fontSize: 9, color: "var(--active)",  fontWeight: 900 }}>▶</span>}
          </span>
          {/* Hand-written per-locale abbreviation ("Sm" / 夏季 / 夏 / …) — a lone
              engine-translated "Summer" is as ambiguous as the "Fall"→落下 bug. */}
          <span style={{ fontSize: 7, fontWeight: 700, color: "var(--text-2)", lineHeight: "calc(1.2 * var(--lh-scale, 1))", textAlign: "center", fontFamily: "'InterTight', 'Inter', system-ui, sans-serif" }}>{scaleLatinRuns(t("sem.summer.abbr"), { tight: true })}</span>
          <span style={{ fontSize: 7, fontWeight: 500, color: "var(--text-4)", lineHeight: "calc(1.2 * var(--lh-scale, 1))" }}>{year}</span>
          {combinedSH > 0 && <span style={{ fontSize: 7, fontWeight: 700, color: "var(--success)", lineHeight: "calc(1.2 * var(--lh-scale, 1))", textAlign: "center" }}>{combinedSH} SH</span>}
        </div>
      ) : (
        <div onClick={onNowClick} style={{ width: "clamp(100px,13vw,148px)", flexShrink: 0, cursor: isLive ? "not-allowed" : "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 1 }}>
            <span style={{ width: 14, height: 14, borderRadius: 3, background: combinedDone ? "var(--bg-surface)" : combinedActive ? "var(--active-bg)" : "transparent", border: combinedDone ? "1px solid var(--success-border)" : combinedActive ? "1px solid var(--active-now-border)" : "1px solid var(--border-2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {combinedDone   && <span style={{ fontSize: 9, color: "var(--success)", fontWeight: 900 }}>✓</span>}
              {combinedActive && <span style={{ fontSize: 9, color: "var(--active)",  fontWeight: 900 }}>▶</span>}
            </span>
            {/* The written summer name in the locale's word order — the engine's
                "Summer 2029" came back year-first in CJK and season-first in the
                preview's copy of this row, for the same term. */}
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)", fontFamily: "'InterTight', 'Inter', system-ui, sans-serif" }}>{scaleLatinRuns(semName(t, "claude.sem.summer", year), { tight: true })}</span>
            {combinedActive && (
              <span style={{ fontSize: 9, color: "var(--text-4)", background: "var(--bg-surface-2)", border: "1px solid var(--border-2)", borderRadius: 3, padding: "1px 4px", fontWeight: 700, marginLeft: 3 }}>NOW</span>
            )}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-4)", paddingLeft: 19, marginBottom: 2 }}><TText>May – Aug</TText></div>
          {combinedSH > 0 && <span style={{ fontSize: 10, fontWeight: 700, marginLeft: 19, color: "var(--success)" }}>{combinedSH} SH</span>}
        </div>
      )}

      {/* Two session sub-columns — stacked on phone, side by side on desktop */}
      <div style={{ display: "flex", flexDirection: isPhone ? "column" : "row", gap: 4, flex: 1, minWidth: 0 }}>
        {renderSession(semA)}
        {renderSession(semB)}
      </div>
    </div>
  );
}
