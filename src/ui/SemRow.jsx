// ═══════════════════════════════════════════════════════════════════
// SEM ROW  — renders a single non-summer semester row (fall/spring/special)
// ═══════════════════════════════════════════════════════════════════
import { usePlanner } from "../context/PlannerContext.jsx";
import { useRelevance } from "../context/RelevanceContext.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { useState, useEffect, useMemo } from "react";
import { TYPE_BG } from "../core/constants.js";
import { hexRgb, getSemStudySH, getOrderedCourses } from "../core/planModel.js";
import { loadState, LOAD_OVER, LOAD_UNDER } from "../core/creditLoad.js";
import { resolveTermByDuration } from "../core/specialTermUtils.js";
import { usePort }        from "../context/InstitutionContext.jsx";
import { ISpecialTerms }  from "../ports/ISpecialTerms.js";
import { ICreditSystem }  from "../ports/ICreditSystem.js";
import { ICalendar }      from "../ports/ICalendar.js";
import { useLanguage }    from "../context/LanguageContext.jsx";
import { TText, useTranslatedText, scaleLatinRuns } from "../context/TranslationContext.jsx";
import { SEM_NAME_KEY, useSemName } from "./SemLabel.jsx";
import CourseCard from "./CourseCard.jsx";

// Phone semester label: the label stacks in a 34px column — season name on
// top (bold), year below — matching SummerRow's stacked header. It uses the
// shared SEM_NAME_KEY map (see SemLabel.jsx for why the names are written and
// not machine-translated); unknown semester types fall back to whole-phrase
// engine translation with the calendar's translateAs hint.
function StackedSemLabel({ sem }) {
  const cal   = usePort(ICalendar);
  const { t } = useLanguage();
  const st    = cal.getSemesterTypes().find(s => s.id === sem.semTypeId);
  const year  = sem.label.match(/\d{4}/)?.[0] ?? "";
  const as    = st?.translateAs ? `${st.translateAs} ${year}` : undefined;
  const key   = SEM_NAME_KEY[sem.semTypeId];
  const translated = useTranslatedText(key ? null : sem.label, { as }); // hook must run unconditionally
  // Deliberately NOT `semName`: this label is stacked in a 34px column, so the
  // season and the year are separate lines and `sem.name.format`'s inline order
  // has nothing to arrange. Same written keys, so the two agree on the words.
  const parts = key
    ? [...t(key).split(" "), ...(year ? [year] : [])]
    : (translated ?? sem.label).split(" ");
  return parts.map((part, i) => (
    <span key={i} style={{ fontSize: 7, fontWeight: i === 0 ? 700 : 500, color: i === 0 ? "var(--text-2)" : "var(--text-4)", lineHeight: "calc(1.2 * var(--lh-scale, 1))", textAlign: "center", fontFamily: "'InterTight', 'Inter', system-ui, sans-serif" }}>
      {scaleLatinRuns(part, { tight: true })}
    </span>
  ));
}
import CompanySearch from "./CompanySearch.jsx";
import CoopCourseSearch from "./CoopCourseSearch.jsx";
import CompanyLogo from "./CompanyLogo.jsx";
import { FadeInput } from "./FadeText.jsx";

export default function SemRow({ sem }) {
  const {
    placements, semOrders, courseMap, effectiveCourseMap,
    semesterCards, semesterLoad, concurrentCap,
    selectedId, setSelectedId, setShowPanel,
    getSemStatus, setCurrentSemId,
    dragInfo, hoveredSem, hoveredZone,
    onDragOver, onDragLeave, onDrop,
    setHoveredZone, setHoveredSem,
    specialTermStartMap, specialTermContMap, specialTermPl, setSpecialTermPl,
    cardRefs, onDragStart,
    SEM_INDEX,
    pushUndo, isPhone,
    bonusSH, setBonusSH,
    semTrackingMode,
    studentType,
    claudePreview,
  } = usePlanner();

  // Work-term instance → the course it registers. From RelevanceContext, which
  // loads the programs app-wide; the Graduation panel is not always mounted.
  const { workTermCourse, coopProgramOptions } = useRelevance();

  const isLive = semTrackingMode === "live";
  const onNowClick = () => { if (!isLive) setCurrentSemId(sem.id); };

  const { themeName } = useTheme();
  const specialTerms = usePort(ISpecialTerms);
  const creditSystem = usePort(ICreditSystem);
  const unitName     = creditSystem.getUnitName();
  const { t } = useLanguage();
  // One composition of "<season> <year>", shared with the phone label, the
  // header toast, the popover and the sample-plan preview.
  const semNameText      = useSemName(sem);
  const companyColor     = themeName === "dark" ? "#b0bbc5" : "var(--text-3)";
  const placeholderColor = themeName === "dark" ? "#3e4856" : "#e4e4e4";

  const semStatus = getSemStatus(sem.id);
  const isDone    = semStatus === "completed";
  const isActive  = semStatus === "inprogress";

  // Generic special term for this semester
  const termStartId   = specialTermStartMap[sem.id];
  const termStartData = termStartId ? specialTermPl[termStartId] : null;
  const termStartType = termStartData ? (specialTerms.getTypes() ?? []).find(t => t.id === termStartData.typeId) : null;
  const termStartDur  = termStartType ? resolveTermByDuration(termStartType.durations, termStartData.duration) : null;

  const termContId   = specialTermContMap[sem.id];
  const termContData = termContId ? specialTermPl[termContId] : null;
  const termContType = termContData ? (specialTerms.getTypes() ?? []).find(t => t.id === termContData.typeId) : null;
  const termContDur  = termContType ? resolveTermByDuration(termContType.durations, termContData.duration) : null;

  // Numbering: 1-based index among placements of the same type, sorted by semester
  const termNum = (typeId, id) => Object.entries(specialTermPl)
    .filter(([, d]) => d?.semId && d.typeId === typeId)
    .sort(([, a], [, b]) => (SEM_INDEX[a.semId] ?? 99) - (SEM_INDEX[b.semId] ?? 99))
    .findIndex(([eid]) => eid === id) + 1;
  // The combined view: placements plus reservations. A reservation occupies a
  // position in the term exactly like a course, so ordering, drag and load all
  // work on it with no cases here.
  const crs        = semesterCards(sem.id);
  const courseIds  = crs.map(c => c.id);
  // A work term whose type declares a `concurrentCap` (NU: one class alongside
  // a full-time co-op) lets courses in the term COUNT. One that declares none —
  // an internship — keeps the old behaviour: parked courses stay in the plan,
  // recoverable, and contribute 0. See core/planModel.getSemStudySH.
  // Combined view: a reservation carries the credit the department printed, so
  // a fourth year that is entirely electives reads as full rather than empty.
  const sh         = semesterLoad(sem.id);
  const workCap    = concurrentCap?.(sem.id) ?? null;
  // Which course this block actually registers — CS 6964 for a Khoury student,
  // COOP 3948 for an abroad co-op in International Business. Resolved app-wide
  // in RelevanceContext so the board and the audit cannot disagree.
  const registers  = workTermCourse?.[termStartId] ?? null;
  // The work-experience courses THIS block could register, the student's own
  // program's options first. Scoped by kind — an internship card must not offer
  // COOP 3945, and a co-op card must not offer COOP 3949 Internship Exchange;
  // the block the student dragged is itself a statement about which they did.
  // Within the kind the list is deliberately NOT restricted to their program:
  // ordering is a hint, choosing is theirs.
  const workTermCourseOptions = useMemo(() => {
    const kind = termStartType?.registersCourse;
    if (!kind) return [];
    const all  = Object.values(courseMap ?? {}).filter(c => c.coop?.kind === kind);
    const mine = coopProgramOptions ?? new Set();
    return all.sort((a, b) =>
      (mine.has(b.id) - mine.has(a.id)) || a.id.localeCompare(b.id));
  }, [courseMap, coopProgramOptions, termStartType]);
  // shVoided takes carry sh 0 (a failed grade earns nothing) but must stay
  // as full cards — vanishing into the low-credit subline would hide the
  // very course whose failure the user just recorded.
  const main4      = crs.filter(c => c.sh >= 3 || c.shVoided);
  const others     = crs.filter(c => c.sh <= 2 && !c.shVoided);
  const isGrad      = studentType === "graduate";
  const isDragging  = dragInfo?.type === "course";
  // Undergrad: fixed slots always visible (4 for fall/spring, 2 for summer).
  // Grad: 2 slots at rest for fall/spring (default load), expand up to 4 while dragging.
  //        1 slot at rest for summer, expand up to 2 while dragging.
  const mainSlots = (sem.type === "fall" || sem.type === "spring")
    ? (isGrad
        ? (isDragging ? Math.min(4, Math.max(2, main4.length < 4 ? main4.length + 1 : 4)) : Math.max(2, main4.length))
        : 4)
    : sem.type === "summer"
      ? (isGrad
          ? (isDragging ? Math.min(2, Math.max(1, main4.length < 2 ? main4.length + 1 : 2)) : Math.max(1, main4.length))
          : 2)
      : null;
  const emptySlots = Math.max(0, (mainSlots ?? 0) - main4.length);
  // Phone wraps the slots into a 2-wide grid (so 4 fall/spring slots become a
  // 2×2 block); desktop keeps every slot on a single row.
  const slotCount = Math.max(1, mainSlots || main4.length || 1);
  const gridCols  = isPhone ? Math.min(2, slotCount) : slotCount;

  // Collapsible other credits
  const { collapseOtherCredits, collapsedSubs, setCollapsedSubs, showContLogo, privateCoop, revealTarget } = usePlanner();
  const [showOther, setShowOther] = useState(!collapseOtherCredits);
  useEffect(() => { if (collapseOtherCredits) setShowOther(false); else setShowOther(true); }, [collapseOtherCredits]);

  // A jump to a 1 SH course lands on a card that is inside this collapsed
  // zone, i.e. not rendered at all. Open it — once, as a plain state change,
  // so the toggle stays the user's: forcing it open for as long as the course
  // is the reveal target would make the ▼ button do nothing.
  useEffect(() => {
    if (revealTarget && others.some(c => c.id === revealTarget.pid)) setShowOther(true);
  }, [revealTarget]); // eslint-disable-line react-hooks/exhaustive-deps

  // Collapsed state for incoming credit section (per-semester)
  const isIncomingCollapsed = collapsedSubs[sem.id] !== false;
  const isHov      = hoveredSem === sem.id;
  const tb         = TYPE_BG[sem.type] || TYPE_BG.special;

  let rowBg, rowBorder, rowOpacity, rowBoxShadow;
  if (isActive) {
    rowBg        = tb.bg;                          // no bg change — outline only
    rowBorder    = "1px solid var(--active-now-border)";
    rowOpacity   = 1;
    rowBoxShadow = "var(--shadow-active-row)";
  } else if (isDone) {
    rowBg        = isHov ? "var(--active-hov-bg)" : tb.bg;
    rowBorder    = `1px solid ${tb.border}`;
    rowOpacity   = 0.9;
    rowBoxShadow = "var(--shadow-done-row)";
  } else {
    rowBg        = isHov ? "var(--active-hov-bg)" : tb.bg;
    rowBorder    = `1px solid ${isHov ? "var(--active)" : tb.border}`;
    rowOpacity   = 1;
    rowBoxShadow = "none";
  }

  const statusDot = isDone ? (
    <span style={{ width: 14, height: 14, borderRadius: 3, background: "var(--bg-surface)", border: "1px solid var(--success-border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <span style={{ fontSize: 9, color: "var(--success)", fontWeight: 900 }}>✓</span>
    </span>
  ) : isActive ? (
    <span style={{ width: 14, height: 14, borderRadius: 3, background: "var(--active-bg)", border: "1px solid var(--active)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <span style={{ fontSize: 9, color: "var(--active)", fontWeight: 900 }}>▶</span>
    </span>
  ) : (
    <span style={{ width: 14, height: 14, borderRadius: 3, border: "1px solid var(--border-2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} />
  );

  const isRegularSem = sem.type === "fall" || sem.type === "spring";
  const shMin = isRegularSem ? creditSystem.getFullTimeMin(studentType) : 0;
  const shMax = creditSystem.getSemesterMax(studentType);
  // The verdict comes from core so the preview, the walkthrough, the summer row and MCP
  // cannot reach a different one about the same term — see `creditLoad.js`. The COLOURS stay
  // here: this row is live and green means "keep going", which is not what a document wants.
  const shState = loadState(sh, { cap: shMax, min: shMin });
  const overCap = shState === LOAD_OVER;
  const shColor = overCap ? "var(--error)"
    : shState === LOAD_UNDER ? "var(--warn-bright)" : "var(--success)";
  const shEl = sh > 0 ? (
    <span style={{ fontSize: 10, fontWeight: 700, marginLeft: 19, color: shColor }}>
      {sh} SH{overCap ? " ⚠" : ""}
    </span>
  ) : null;
  const shElPhone = sh > 0 ? (
    <span style={{ fontSize: 7, fontWeight: 700, color: shColor, lineHeight: "calc(1.2 * var(--lh-scale, 1))", textAlign: "center" }}>
      {sh} SH{overCap ? " ⚠" : ""}
    </span>
  ) : null;

  // Continuation row (any special term spanning from previous semester)
  return (
    <div key={sem.id}
      data-sem-id={sem.id}
      onDragOver={e => onDragOver(e, sem.id)}
      onDragLeave={onDragLeave}
      onDrop={e => onDrop(e, sem.id)}
      style={{
        display: "flex", alignItems: "flex-start", gap: 8,
        background: rowBg, border: rowBorder, borderRadius: 6,
        padding: "6px 8px", marginBottom: 3,
        minHeight: sem.type === "special" ? "auto" : 70,
        opacity: rowOpacity, boxShadow: rowBoxShadow,
        transition: "background 0.12s, border-color 0.12s, opacity 0.15s",
        flexWrap: "nowrap",
      }}
    >
      {/* Semester label */}
      {isPhone ? (
        <div
          onClick={onNowClick}
          style={{ width: 34, flexShrink: 0, cursor: isLive ? "not-allowed" : "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 1, paddingTop: 2 }}
        >
          {statusDot}
          <StackedSemLabel sem={sem} />
          {shElPhone}
        </div>
      ) : (
        <div
          onClick={onNowClick}
          style={{ width: "clamp(100px,13vw,148px)", flexShrink: 0, cursor: isLive ? "not-allowed" : "pointer" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 1 }}>
            {statusDot}
            {/* Row titles use the gentler InterTight scale — a tight, prominent
                block where the full CJK enlargement reads oversized. */}
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)", fontFamily: "'InterTight', 'Inter', system-ui, sans-serif" }}>
              {/* The written season name in the locale's own word order, not the
                  engine's rendering of "Fall 2028" — which came back year-first
                  and disagreed with the phone label and the preview. */}
              {scaleLatinRuns(semNameText, { tight: true })}
            </span>
            {isActive && (
              <span style={{ fontSize: 9, color: "var(--text-4)", background: "var(--bg-surface-2)", border: "1px solid var(--border-2)", borderRadius: 3, padding: "1px 4px", fontWeight: 700 }}>
                NOW
              </span>
            )}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-4)", paddingLeft: 19, marginBottom: 2 }}><TText>{sem.sub}</TText></div>
          {shEl}
          {sem.id === "incoming" && (!isIncomingCollapsed || claudePreview?.changed?.has?.("bonusSH")) && (
            <div style={{ paddingLeft: 19, marginTop: 5 }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 9, color: "var(--text-4)", marginBottom: 2 }}><TText>general {unitName}</TText></div>
              <input
                type="number" min={0} max={999} value={bonusSH || ""}
                placeholder="0"
                onChange={e => {
                  const v = parseInt(e.target.value, 10);
                  setBonusSH(isNaN(v) || v < 0 ? 0 : v);
                }}
                style={{
                  width: 52, fontSize: 11, fontWeight: 700,
                  padding: "2px 5px", borderRadius: 4,
                  border: claudePreview?.changed?.has?.("bonusSH")
                    ? "2px dashed #fb923c" : "1px solid var(--border-2)",
                  background: "var(--bg-surface-2)",
                  color: claudePreview?.changed?.has?.("bonusSH") ? "#fb923c" : "var(--text-1)",
                  outline: "none",
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Course slots */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, flex: 1 }}>
        {/* Claude preview: work terms leaving this semester stay visible as
            ghosts — removed ones struck through, moved ones with an →
            origin marker (mirrors removed-course ghosts). */}
        {(claudePreview?.ghostWorkTerms ?? [])
          .filter(g => g.instance.semId === sem.id)
          .map(g => {
            const gType = (specialTerms.getTypes() ?? []).find(tp => tp.id === g.instance.typeId);
            return (
              <div key={`pv-ghost-${g.id}`} style={{
                width: "100%", minHeight: 42, boxSizing: "border-box",
                border: "2px dashed #fb923c", borderRadius: 6, opacity: 0.45,
                padding: "6px 12px", display: "flex", alignItems: "center", gap: 8,
              }}>
                <span style={{ fontSize: isPhone ? 7 : 13, fontWeight: 600, color: "var(--text-2)",
                  letterSpacing: "0.05em", textTransform: "uppercase",
                  textDecoration: g.moved ? "none" : "line-through" }}>
                  <TText>{gType?.label ?? g.instance.typeId}</TText>{g.moved ? " →" : ""}
                </span>
                {!privateCoop && g.instance.company && (
                  <span style={{ fontSize: isPhone ? 7 : 12, color: "var(--text-4)",
                    textDecoration: g.moved ? "none" : "line-through" }}>
                    {g.instance.company}
                  </span>
                )}
              </div>
            );
          })}
        {termStartId ? (
          // Column so a concurrent-course strip can sit UNDER the block rather
          // than beside it — the parent row is a flex row, and a bare fragment
          // would lay the strip out as a sibling column of the card.
          <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 4 }}>
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
            // CourseCard uses, and for the same reason: a browser does not
            // fire click after a drag, so neither gesture needs a threshold.
            // The controls inside (company, role, course, ✕) stop their own
            // clicks so they keep their own behaviour.
            //
            // Only when the student CHOSE a course. The resolver's default is
            // an inference, and opening a course page off the back of it would
            // present a guess as a fact.
            onClick={termStartData.courseId ? e => {
              e.stopPropagation();
              const id = termStartData.courseId;
              if (selectedId === id) { setSelectedId(null); setShowPanel(false); }
              else { setSelectedId(id); setShowPanel(true); }
            } : undefined}
            style={{
              flex: 1, minHeight: 58, minWidth: 200,
              position: "relative",
              background: "var(--card-bg)",
              border: claudePreview?.workTermsChanged?.has?.(termStartId)
                ? "2px dashed #fb923c" : "1px solid var(--border-card)",
              opacity: claudePreview?.workTermsChanged?.has?.(termStartId) ? 0.8 : 1,
              borderRadius: 6, padding: "8px 12px 8px 14px", cursor: "grab",
              display: "flex", flexDirection: "column", justifyContent: "center",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1, flexShrink: 0 }}>
                <div style={{ fontSize: isPhone ? 7 : 14, fontWeight: 600, color: companyColor, fontFamily: "'Inter', sans-serif", letterSpacing: "0.05em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                  <TText>{termStartType?.label ?? termStartData.typeId}</TText> {termNum(termStartData.typeId, termStartId)}
                </div>
                {/* The course this block registers, as its own target.
                    ── Why not make the whole card clickable ────────────
                    The card is draggable and holds two text inputs and a ✕.
                    A card that is both dragged and clicked everywhere has to
                    guess which gesture happened — timing and movement
                    thresholds that misfire on trackpads and touch. A distinct
                    link needs no guess: drag the card, click the code. It
                    stops its own mousedown so grabbing the text cannot start a
                    card drag, and draggable={false} so it is not a drag handle
                    itself. */}
                {/* The registered course, as a subtitle under CO-OP n —
                    mirroring the company search directly above it. Subtle when
                    empty, which is the normal state: leaving it blank keeps the
                    resolved default. The CODE is what shows; the title is one
                    click away.
                    ── Two targets, not one ──
                    The card is draggable. A card that is also clickable
                    everywhere has to guess which gesture happened, and that
                    guess misfires on trackpads and touch. So the arrow is its
                    own small target and the input is another; drag the card,
                    click the arrow, type in the field. Nothing has to guess. */}
                {/* Gated on the TYPE registering a course at all — not on one
                    having been chosen. Gating on the choice made the field to
                    make the choice appear only after it was made. */}
                {/* NOT gated on privateCoop, unlike the company and role
                    fields below. The registration is not an employer detail —
                    it survives redaction (COOP_PRIVATE_FIELDS), so hiding only
                    the control would mean a student in private mode could not
                    edit a value their own share links still carry. */}
                {termStartType?.registersCourse && (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 1 }}
                       onMouseDown={e => e.stopPropagation()}
                       onClick={e => e.stopPropagation()}>
                    {/* Empty unless the student chose. The resolver's answer is
                        a DEFAULT, and pre-filling it as text would read as
                        their input and invite them to curate something they
                        never set. Clicking the CARD opens whatever is in
                        force. */}
                    <CoopCourseSearch
                      value={termStartData.courseId ?? ""}
                      courses={workTermCourseOptions}
                      color="var(--text-4)"
                      emptyColor={placeholderColor}
                      fontSize={isPhone ? 6 : 9}
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
              {/* Stops the card's click reaching the panel: focusing the
                  company or role field is editing this block, not asking to
                  read the course it registers. */}
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "stretch", gap: 1, paddingLeft: isPhone ? 10 : 20 }}
                   onClick={e => e.stopPropagation()}>
                {privateCoop ? null : (
                  // Company + role are hidden by omitting the inputs entirely,
                  // so a viewer can't read them and edits can't overwrite the
                  // stored values (they return when the toggle is off).
                  <>
                    <CompanySearch
                      name={termStartData.company}
                      color={companyColor}
                      emptyColor={placeholderColor}
                      fontSize={isPhone ? 7 : 14}
                      placeholder={t("sem.work.company.placeholder")}
                      onChange={v => setSpecialTermPl(p => ({ ...p, [termStartId]: { ...p[termStartId], company: v?.name ?? "", companyDomain: v?.domain ?? "" } }))}
                    />
                    <FadeInput
                      value={termStartData.subline ?? ""}
                      onChange={e => setSpecialTermPl(p => ({ ...p, [termStartId]: { ...p[termStartId], subline: e.target.value } }))}
                      onMouseDown={e => e.stopPropagation()}
                      placeholder={t("sem.work.role.placeholder")}
                      className="work-input"
                      style={{ textAlign: "right", width: "100%", fontFamily: "'Inter', sans-serif", fontSize: isPhone ? 5 : 10, fontWeight: 400, color: termStartData.subline ? companyColor : placeholderColor, background: "transparent", border: "none", outline: "none", padding: 0 }}
                    />
                  </>
                )}
              </div>
              <CompanyLogo key={termStartData.companyDomain || ""} domain={termStartData.companyDomain} name={termStartData.company} size={isPhone ? 20 : 40} />
              <button
                onClick={e => { e.stopPropagation(); pushUndo(); setSpecialTermPl(p => { const n = { ...p }; delete n[termStartId]; return n; }); }}
                onMouseDown={e => e.stopPropagation()}
                style={{ background: "none", border: "none", color: "var(--text-4)", cursor: "pointer", fontSize: 12, lineHeight: 1, padding: 0, flexShrink: 0 }}
                title={t("sem.term.remove", { type: (termStartType?.label ?? "term").toLowerCase() })}
              >✕</button>
            </div>
            {/* Warning for internship in fall/spring (requires non-attendance petition at NU) */}
            {termStartData.typeId === "intern" && (sem.type === "fall" || sem.type === "spring") && !isPhone && (
              <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", display: "flex", alignItems: "center", gap: 4, pointerEvents: "none" }}>
                <span style={{ fontSize: 13, color: "#facc15" }}>⚠</span>
                <span style={{ fontSize: 9, color: "#facc15", lineHeight: "calc(1.3 * var(--lh-scale, 1))", whiteSpace: "nowrap" }}>{t("sem.intern.petition")}</span>
              </div>
            )}
            {termStartData.typeId === "intern" && (sem.type === "fall" || sem.type === "spring") && isPhone && (
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6, pointerEvents: "none" }}>
                <span style={{ fontSize: 11, color: "#facc15" }}>⚠</span>
                <span style={{ fontSize: 8, color: "#facc15", lineHeight: "calc(1.3 * var(--lh-scale, 1))" }}>{t("sem.intern.petition")}</span>
              </div>
            )}
          </div>
            {/* Coursework taken DURING the block. Rendered only when the type
                permits it (NU: one class alongside a full-time co-op) — an
                internship declares no cap, so its parked courses stay hidden
                and uncounted exactly as before.
                Shown while dragging too, so there is a visible target: the
                block fills the slot row, and without this there is nowhere for
                a drop indicator to go. The cap is ADVISORY — over it the strip
                warns with the numbers and still accepts the course. */}
            {workCap && (crs.length > 0 || dragInfo?.type === "course") && (
              <div
                onDragOver={e => {
                  if (!dragInfo || dragInfo.type !== "course") return;
                  e.preventDefault(); e.stopPropagation();
                  setHoveredZone({ semId: sem.id, zone: "append" }); setHoveredSem(null);
                }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setHoveredZone(null); }}
                onDrop={e => { e.stopPropagation(); setHoveredZone(null); onDrop(e, sem.id); }}
                style={{
                  display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4,
                  padding: crs.length ? "4px 6px" : "6px",
                  borderRadius: 6,
                  border: `1px dashed ${sh > workCap.sh ? "#facc15" : "var(--border-1)"}`,
                  background: hoveredZone?.semId === sem.id ? "var(--bg-surface-2)" : "transparent",
                }}
              >
                {crs.map(c => <CourseCard key={c.id} course={c} inSem semId={sem.id} />)}
                {sh > workCap.sh && (
                  <span style={{ fontSize: isPhone ? 7 : 9, color: "#facc15", whiteSpace: "nowrap" }}>
                    ⚠ {sh} / {workCap.sh} {unitName}
                  </span>
                )}
              </div>
            )}
          </div>

        ) : termContId ? (
          // A term that CONTINUES into this semester gets the SAME bounded card
          // as the one that starts it, so a co-op reads as one object wherever
          // you meet it. It used to replace the entire row instead: the semester
          // lost its own frame and seasonal tint, the co-op stopped looking like
          // a card at all, and a spring co-op and the fall it ran into looked
          // like two unrelated things.
          <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{
            flex: 1, minHeight: 58, minWidth: 200,
            background: "var(--card-bg)",
            border: "1px solid var(--border-card)",
            borderRadius: 6, padding: "8px 12px 8px 14px",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* 13, one step under the 14 a START card carries: the term that
                  begins here is the object, and the one merely running through
                  is its shadow. Word comes from sem.cont.label, hand-written in
                  every locale — it used to be the bare English "Continues" fed
                  to the translation engine, which is the one thing the
                  localisation rule forbids. */}
              <div style={{ fontSize: isPhone ? 7 : 13, fontWeight: 600, color: companyColor, fontFamily: "'Inter', sans-serif", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                <TText>{termContType?.label ?? "Work"}</TText> {t("sem.cont.label")}
              </div>
              {/* No "· drag to move": only the START card is draggable, so the
                  hint pointed at something this card cannot do. */}
              <div style={{ fontSize: isPhone ? 5 : 10, color: "var(--text-4)", marginTop: 2 }}>
                {termContData?.duration}-month block
              </div>
            </div>
            {showContLogo && <CompanyLogo key={termContData?.companyDomain || ""} domain={termContData?.companyDomain} name={termContData?.company} size={isPhone ? 20 : 40} />}
          </div>
            {/* Coursework taken DURING the block. Rendered only when the type
                permits it (NU: one class alongside a full-time co-op) — an
                internship declares no cap, so its parked courses stay hidden
                and uncounted exactly as before.
                Shown while dragging too, so there is a visible target: the
                block fills the slot row, and without this there is nowhere for
                a drop indicator to go. The cap is ADVISORY — over it the strip
                warns with the numbers and still accepts the course. */}
            {workCap && (crs.length > 0 || dragInfo?.type === "course") && (
              <div
                onDragOver={e => {
                  if (!dragInfo || dragInfo.type !== "course") return;
                  e.preventDefault(); e.stopPropagation();
                  setHoveredZone({ semId: sem.id, zone: "append" }); setHoveredSem(null);
                }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setHoveredZone(null); }}
                onDrop={e => { e.stopPropagation(); setHoveredZone(null); onDrop(e, sem.id); }}
                style={{
                  display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4,
                  padding: crs.length ? "4px 6px" : "6px",
                  borderRadius: 6,
                  border: `1px dashed ${sh > workCap.sh ? "#facc15" : "var(--border-1)"}`,
                  background: hoveredZone?.semId === sem.id ? "var(--bg-surface-2)" : "transparent",
                }}
              >
                {crs.map(c => <CourseCard key={c.id} course={c} inSem semId={sem.id} />)}
                {sh > workCap.sh && (
                  <span style={{ fontSize: isPhone ? 7 : 9, color: "#facc15", whiteSpace: "nowrap" }}>
                    ⚠ {sh} / {workCap.sh} {unitName}
                  </span>
                )}
              </div>
            )}
          </div>

        ) : mainSlots === null ? (
          // Special / incoming — collapsible section
          <div style={{ flex: 1, alignItems: "flex-start", display: "flex", flexDirection: "column", gap: 2 }}>
            <button
              onClick={() => setCollapsedSubs(p => ({ ...p, [sem.id]: !isIncomingCollapsed }))}
              style={{
                fontSize: 10, color: "var(--text-5)", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 2, textAlign: "left", alignSelf: "flex-start"
              }}
              aria-expanded={!isIncomingCollapsed}
              title={isIncomingCollapsed ? t("sem.incoming.title.show") : t("sem.incoming.title.hide")}
            >
              {isIncomingCollapsed
                ? <>► <TText>general {unitName}</TText>: {bonusSH || 0}{crs.length > 0 ? ' | ' : ''}{crs.map(c => c.code || (c.subject + ' ' + c.number)).join(", ")}</>
                : <>▼ {semNameText}</>
              }
            </button>
            {!isIncomingCollapsed && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "flex-start" }}>
                {crs.map(c => <CourseCard key={c.id} course={c} inSem semId={sem.id} />)}
                <div
                  onDragOver={e => {
                    if (!dragInfo || dragInfo.type !== "course") return;
                    e.preventDefault(); e.stopPropagation();
                    setHoveredZone({ semId: sem.id, zone: "append" }); setHoveredSem(null);
                  }}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setHoveredZone(null); }}
                  onDrop={e => { e.stopPropagation(); setHoveredZone(null); onDrop(e, sem.id); }}
                  // No label. Every other empty slot in the planner is a bare dashed
                  // box that only highlights on drag-over — text here was the one
                  // inconsistent spot, and "+ add" read as a button to click rather
                  // than a place to drop a course.
                  style={{
                    height: 70, width: 164, flexShrink: 0,
                    border: hoveredZone?.semId === sem.id && hoveredZone?.zone === "append"
                      ? "1px dashed var(--active)" : "1px dashed var(--border-slot)",
                    borderRadius: 6,
                    background: hoveredZone?.semId === sem.id && hoveredZone?.zone === "append"
                      ? "var(--active-bg)" : "transparent",
                    transition: "border-color 0.1s, background 0.1s",
                  }}
                />
              </div>
            )}
          </div>

        ) : (
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Main ≥4 SH zone */}
            <div
              onDragOver={e => {
                if (!dragInfo || dragInfo.type !== "course") return;
                const c = courseMap[dragInfo.id]; if (!c || c.sh < 3) return;
                e.preventDefault(); e.stopPropagation();
                setHoveredZone({ semId: sem.id, zone: "main" }); setHoveredSem(null);
              }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setHoveredZone(null); }}
              onDrop={e => {
                if (!dragInfo || dragInfo.type !== "course") return;
                const c = courseMap[dragInfo.id]; if (!c || c.sh < 3) return;
                e.stopPropagation(); setHoveredZone(null); onDrop(e, sem.id);
              }}
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
                // Phone wraps to 2 rows — keep them equal height so a partly-filled
                // grid (e.g. 3 courses) doesn't leave one card stretched tall and the
                // others squat. The placeholder's minHeight floor is also dropped on
                // phone so it can't force one row taller than the rest.
                gridAutoRows: isPhone ? "1fr" : undefined,
                gap: 4, overflow: "visible",
                borderRadius: 6, padding: 3,
                minHeight: 76,
                border: hoveredZone?.semId === sem.id && hoveredZone?.zone === "main"
                  ? "1px solid var(--active)" : "1px solid transparent",
                background: hoveredZone?.semId === sem.id && hoveredZone?.zone === "main"
                  ? "var(--active-bg)" : "transparent",
                transition: "border-color 0.1s, background 0.1s",
              }}
            >
              {main4.map(c => <CourseCard key={c.id} course={c} inSem semId={sem.id} />)}
              {/* Claude preview: chips marking where moved courses came FROM */}
              {claudePreview && Object.entries(claudePreview.moved ?? {})
                .filter(([, m]) => m.from === sem.id)
                .map(([id, m]) => (
                  <div key={`mv-${id}`} style={{
                    minHeight: isPhone ? 0 : 70, border: "2px dashed #fb923c", borderRadius: 6,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    opacity: 0.6, fontSize: 10, fontWeight: 700, color: "#fb923c",
                    padding: "0 6px", textAlign: "center",
                  }}>
                    {courseMap[id]?.code ?? id} →
                  </div>
                ))}
              {Array.from({ length: emptySlots }).map((_, i) => (
                <div key={`ms-${i}`} style={{ minHeight: isPhone ? 0 : 70, border: "1px dashed var(--border-slot)", borderRadius: 6, background: tb.bg }} />
              ))}
            </div>

            {/* Override zone — only visible when all main slots full + dragging a ≥3 SH course */}
            {main4.length >= mainSlots && dragInfo?.type === "course" && (courseMap[dragInfo.id]?.sh ?? 0) >= 3 && (
              <div
                onDragOver={e => {
                  if (!dragInfo || dragInfo.type !== "course") return;
                  const c = courseMap[dragInfo.id]; if (!c || c.sh < 3) return;
                  e.preventDefault(); e.stopPropagation();
                  setHoveredZone({ semId: sem.id, zone: "override" }); setHoveredSem(null);
                }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setHoveredZone(null); }}
                onDrop={e => {
                  if (!dragInfo || dragInfo.type !== "course") return;
                  e.stopPropagation(); setHoveredZone(null); onDrop(e, sem.id);
                }}
                style={{
                  marginTop: 3, padding: "3px 6px",
                  borderRadius: 4, cursor: "copy",
                  border: hoveredZone?.semId === sem.id && hoveredZone?.zone === "override"
                    ? "1px dashed var(--active)" : "1px dashed var(--border-slot)",
                  background: hoveredZone?.semId === sem.id && hoveredZone?.zone === "override"
                    ? "var(--active-bg)" : "transparent",
                  opacity: hoveredZone?.semId === sem.id && hoveredZone?.zone === "override" ? 1 : 0.35,
                  transition: "opacity 0.15s, border-color 0.1s, background 0.1s",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <span style={{ fontSize: 9, color: "var(--text-4)", letterSpacing: "0.04em" }}>{t("sem.override.label")}</span>
              </div>
            )}

            {/* Other <3 SH zone (collapsible; forced open while a Claude
                preview touches one of its courses — a removed 1 SH course
                must ghost visibly, not vanish behind a collapsed section) */}
            {(others.length > 0 || (dragInfo?.type === "course" && (courseMap[dragInfo.id]?.sh ?? 3) < 3)) && (() => {
              const previewTouchesOthers = !!claudePreview && others.some(c =>
                claudePreview.added?.[c.id] !== undefined ||
                claudePreview.moved?.[c.id] !== undefined ||
                claudePreview.removed?.has?.(c.id) ||
                claudePreview.shOvChanged?.has?.(c.id));
              const otherOpen = showOther || previewTouchesOthers;
              return (
              <div style={{ marginTop: 5 }}>
                <button
                  onClick={() => setShowOther(v => !v)}
                  style={{
                    fontSize: 9, color: previewTouchesOthers ? "#fb923c" : "var(--text-5)",
                    fontWeight: previewTouchesOthers ? 700 : 400,
                    background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 2, textAlign: "left"
                  }}
                  aria-expanded={otherOpen}
                  title={otherOpen ? t("sem.other.title.hide") : t("sem.other.title.show")}
                >
                  {otherOpen
                    ? t("sem.other.label.open")
                    : (!isPhone && others.length > 0)
                      ? `► ${others.map(c => `${c.subject} ${c.number}`).join(", ")}`
                      : t("sem.other.label.closed")
                  }
                </button>
                {otherOpen && (
                  <div
                    onDragOver={e => {
                      if (!dragInfo || dragInfo.type !== "course") return;
                      const c = courseMap[dragInfo.id]; if (!c || c.sh >= 3) return;
                      e.preventDefault(); e.stopPropagation();
                      setHoveredZone({ semId: sem.id, zone: "other" }); setHoveredSem(null);
                    }}
                    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setHoveredZone(null); }}
                    onDrop={e => {
                      if (!dragInfo || dragInfo.type !== "course") return;
                      const c = courseMap[dragInfo.id]; if (!c || c.sh >= 3) return;
                      e.stopPropagation(); setHoveredZone(null); onDrop(e, sem.id);
                    }}
                    style={{
                      display: "flex", flexWrap: "wrap", gap: 4,
                      padding: "5px 4px 4px",
                      borderTop: "1px solid var(--border-sub)", borderRadius: 4,
                      minHeight: others.length === 0 ? 34 : "auto",
                      background: hoveredZone?.semId === sem.id && hoveredZone?.zone === "other" ? "var(--active-bg)" : "transparent",
                      outline: hoveredZone?.semId === sem.id && hoveredZone?.zone === "other" ? "1px dashed var(--active)" : "none",
                      transition: "background 0.1s",
                    }}
                  >
                    {others.map(c => <CourseCard key={c.id} course={c} inSem semId={sem.id} />)}
                    {others.length === 0 && (
                      <span style={{ fontSize: 9, color: "var(--text-5)", fontStyle: "italic", alignSelf: "center" }}>
                        {t("sem.other.drop", { unit: unitName })}
                      </span>
                    )}
                  </div>
                )}
              </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
