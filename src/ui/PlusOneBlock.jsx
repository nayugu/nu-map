// ═══════════════════════════════════════════════════════════════════
// PLUSONE BLOCK — the accelerated bachelor's/master's card.
//
// Built on GradPanel's MajorCard so it is seamless by construction: same frame,
// header, caret, progress bar and expand bar as a major or a minor.
//
// ── What the progress bar means here, which is NOT what it means above ──
//
// For a major the bar is progress toward a REQUIREMENT — filling it is the goal.
// Here it is progress toward a CEILING: the university lets a student share at
// most four graduate courses or 16 semester hours, whichever is greater. Filling
// it is still what the student wants (the shared credit is the entire saving),
// so a bar reads correctly — but it can be EXCEEDED, which a requirement bar
// never can. The overflow is reported as a diagnostic rather than by letting the
// bar run past its track, because a 120%-full bar reads as an achievement.
//
// The header's right-hand "N SH" slot carries the MASTER'S total, not the cap.
// That is the number that makes the saving legible: 16 shared out of 32 is half
// the degree.
//
// ── Section order is the order a student needs it ──────────────────
//
//   1. the meter          where am I
//   2. NEEDS ATTENTION    what is wrong (only when something is)
//   3. COURSES YOU CAN SHARE   what do I take — the actionable core
//   4. AFTER YOUR BACHELOR'S   where that leaves me
//   5. BEFORE YOU APPLY        what is being asked of me
//   6. WORTH KNOWING           fine print, collapsed
//
// The earlier layout led with the projection and buried the courses, which
// inverted this: it told the student the consequence before the choice. It also
// ran two lists (candidates were absent entirely, and "SHARING NOW" showed only
// what was already placed), so the most useful question — what should I take? —
// had no answer on the card.
//
// Grouping diagnostics by CERTAINTY is still the load-bearing decision: "this is
// wrong" and "we cannot know this" are different facts, and the second is the
// common case here. GPA, admission, advisor sign-off and registration overrides
// are all things NU Map does not hold and must never pretend to have checked.
// ═══════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect, useContext } from "react";
import { GradCtx, MajorCard } from "./GradPanel.jsx";
import { usePlanner } from "../context/PlannerContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useTranslatedText } from "../context/TranslationContext.jsx";
import { evaluatePathway, summarise } from "../core/pathway/evaluate.js";
import {
  activeShares, shareTotals, resolveCandidates, excludedIds,
  shareCandidates, hasOpenShareDomain,
} from "../core/pathway/shareSet.js";
import { msProgramFor, isStale } from "../core/pathway/select.js";
import { displayCode } from "../core/pathway/ids.js";
import { STATUS } from "../core/pathway/ruleKinds.js";
import { takeConsumesSlot } from "../core/gradeSystem.js";

/** How many candidate rows before the list folds. */
const VISIBLE_CANDIDATES = 5;

/** Status → the theme token that already means that thing elsewhere. */
const STATUS_COLOR = {
  [STATUS.VIOLATED]: "var(--error-text)",
  [STATUS.UNKNOWN]: "var(--warn-bright)",
  [STATUS.INFO]: "var(--text-4)",
  [STATUS.SATISFIED]: "var(--success)",
};

/** A section heading, in the panel's existing label idiom. */
function Section({ title, color = "var(--text-3)", isPhone, children, tail }) {
  return (
    <div style={{ marginTop: 9 }}>
      <div style={{
        display: "flex", alignItems: "baseline", gap: 5,
        fontSize: isPhone ? 7 : 8.5, fontWeight: 700, color,
        letterSpacing: "0.05em", marginBottom: 3,
      }}>
        <span>{title}</span>
        {tail}
      </div>
      {children}
    </div>
  );
}

/** One diagnostic line. */
function DiagRow({ diag, isPhone, t }) {
  const color = STATUS_COLOR[diag.status] ?? "var(--text-4)";
  return (
    <div style={{
      display: "flex", gap: 5, alignItems: "flex-start",
      fontSize: isPhone ? 8 : 9.5, lineHeight: 1.45, marginBottom: 2,
    }}>
      <span style={{ color, flexShrink: 0, marginTop: 1 }}>
        {diag.status === STATUS.VIOLATED ? "!" : diag.status === STATUS.UNKNOWN ? "?" : "·"}
      </span>
      <span style={{ color: diag.status === STATUS.INFO ? "var(--text-4)" : "var(--text-2)" }}>
        {t(diag.messageKey, diag.params ?? {})}
      </span>
    </div>
  );
}

/**
 * One shareable course.
 *
 * The arrow is the one-wayness made visible: the graduate course covers the
 * undergraduate one, never the reverse. A `blocked` row keeps its explanation
 * rather than disappearing — an option that silently vanishes reads as a bug,
 * and "you already took CS 3650" is the reason.
 */
function CandidateRow({ row, isPhone, t }) {
  const taken = row.state === "taken";
  const blocked = row.state === "blocked";
  const mark = taken ? "✓" : blocked ? "✕" : "·";
  const markColor = taken ? "var(--success)" : blocked ? "var(--text-6)" : "var(--text-5)";

  return (
    <div style={{
      display: "flex", gap: 5, alignItems: "baseline",
      fontSize: isPhone ? 8 : 9.5, lineHeight: 1.45, marginBottom: 2,
      opacity: blocked ? 0.55 : 1,
    }}>
      <span style={{ color: markColor, flexShrink: 0 }}>{mark}</span>
      <span style={{
        color: taken ? "var(--text-1)" : "var(--text-2)",
        fontWeight: taken || row.mandatory ? 600 : 400,
        textDecoration: blocked ? "line-through" : "none",
        flexShrink: 0,
      }}>{displayCode(row.gradId)}</span>

      <span style={{ color: "var(--text-5)", flexShrink: 0 }}>→</span>

      <span style={{ color: "var(--text-3)", flex: 1, minWidth: 0 }}>
        {blocked
          ? t("plusone.cand.blocked", { course: row.blockedBy.map(displayCode).join(", ") })
          : row.targets.length
            ? row.targets.map(displayCode).join(" / ")
            : (row.slotLabel ?? "")}
      </span>

      {/* "CS 4500 / CS 4530" on its own could be read as satisfying BOTH — which
          is precisely the double-count bug this codebase already had once. The
          slash is the alternation; this says so in words. It matters most on a
          TAKEN row, where the student has committed the course and now owes the
          choice. */}
      {row.ambiguous && !blocked && (
        <span style={{ color: "var(--warn-bright)", fontSize: isPhone ? 6.5 : 8, flexShrink: 0 }}>
          {t("plusone.cand.pickone")}
        </span>
      )}
      {row.mandatory && !blocked && (
        <span style={{ color: "var(--warn-bright)", fontSize: isPhone ? 6.5 : 8, flexShrink: 0 }}>
          {t("plusone.cand.required")}
        </span>
      )}
      <span style={{ color: "var(--text-5)", fontSize: isPhone ? 7 : 8.5, flexShrink: 0 }}>
        {row.sh} SH
      </span>
    </div>
  );
}

/**
 * @param {Object}  props
 * @param {Object}  props.pathway    the declared pathway, from the port
 * @param {Function} props.onClear   remove the declaration
 * @param {string}  [props.nameColor] Claude-preview orange when pending
 */
export default function PlusOneBlock({ pathway, onClear, nameColor }) {
  const { courseMap, majorRequirements, isPhone, isMobile } = useContext(GradCtx);
  const { t } = useLanguage();
  const { placements, placedOut, grades, SEM_INDEX, getSemStatus } = usePlannerBits();

  const [expanded, setExpanded] = useState(true);
  const [showAllCandidates, setShowAll] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [msData, setMsData] = useState(null);
  const [loading, setLoading] = useState(false);

  const msProgramId = useMemo(() => msProgramFor(pathway), [pathway]);
  const msName = useTranslatedText(msData?.name ?? null);

  // The master's program is a GRADUATE program loaded inside an UNDERGRADUATE
  // plan — the one place GradPanel's per-plan `isGrad` choice of loader does not
  // apply, so this asks for the graduate loader explicitly.
  useEffect(() => {
    if (!msProgramId) { setMsData(null); return; }
    let alive = true;
    setLoading(true);
    majorRequirements.loadGradMajor(msProgramId)
      .then(d => { if (alive) setMsData(d); })
      .catch(() => { if (alive) setMsData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [msProgramId, majorRequirements]);

  const ctx = useMemo(() => {
    const shares = activeShares({
      pathway, placements, courseMap, grades, placedOut,
      // A take whose grade voids it (W/F/U) is "withdrawn" for our purposes.
      // Reuses the grade layer's own rule rather than re-listing the letters.
      isVoid: g => g != null && !takeConsumesSlot(g),
    });
    const counting = pathway?.counting ?? {};
    return {
      pathway, shares, placements, placedOut, courseMap,
      candidates: resolveCandidates(pathway, { excluded: excludedIds(pathway) }),
      semIndex: SEM_INDEX,
      totals: shareTotals(shares, { includeWithdrawn: !!counting.includeWithdrawn }),
    };
  }, [pathway, placements, placedOut, courseMap, grades, SEM_INDEX]);

  const diags = useMemo(() => evaluatePathway(ctx), [ctx]);
  const roll = useMemo(() => summarise(diags), [diags]);
  const byStatus = useMemo(() => ({
    violated: diags.filter(d => d.status === STATUS.VIOLATED),
    unknown: diags.filter(d => d.status === STATUS.UNKNOWN),
    info: diags.filter(d => d.status === STATUS.INFO),
  }), [diags]);

  const candidates = useMemo(
    () => shareCandidates({ pathway, placements, placedOut, courseMap }),
    [pathway, placements, placedOut, courseMap]
  );
  const openDomain = useMemo(() => hasOpenShareDomain(pathway), [pathway]);

  const cap = useMemo(
    () => (pathway?.rules ?? []).find(r => r.kind === "shareCap") ?? {},
    [pathway]
  );
  const capSH = Number.isFinite(cap.semesterHours) ? cap.semesterHours : 16;
  const capCourses = Number.isFinite(cap.courses) ? cap.courses : 4;

  // Split shared hours into done vs planned, the same distinction the rest of
  // the panel draws — a share in a completed term is banked, one in a future
  // term is an intention.
  const { doneSH, plannedSH } = useMemo(() => {
    let done = 0, planned = 0;
    for (const s of ctx.shares) {
      if (s.withdrawn) continue;
      if (s.semId && getSemStatus?.(s.semId) === "completed") done += s.sh;
      else planned += s.sh;
    }
    return { doneSH: done, plannedSH: planned };
  }, [ctx.shares, getSemStatus]);

  const msTotal = Number(msData?.totalCreditsRequired) || 0;
  const stale = isStale(pathway);

  const shown = showAllCandidates ? candidates : candidates.slice(0, VISIBLE_CANDIDATES);
  const hidden = candidates.length - shown.length;

  if (!pathway) return null;

  return (
    <MajorCard
      label={t("plusone.label")}
      name={msName ?? msProgramId}
      subtitle={pathway.label}
      verified={msData?.metadata?.verified}
      verification={msData?.metadata?.verification}
      nameColor={nameColor}
      progress={{
        doneSat: doneSH,
        totalSat: doneSH + plannedSH,
        totalReq: capSH,
        requiredSH: msTotal,
      }}
      expanded={expanded}
      onToggle={() => setExpanded(v => !v)}
      isPhone={isPhone}
      isMobile={isMobile}
      loading={loading}
      loadingLabel={t("plusone.loading")}
    >
      {/* 1 · the meter, in one line. Without it a ceiling reads as a target. */}
      <div style={{ fontSize: isPhone ? 7.5 : 9, color: "var(--text-5)", letterSpacing: 0 }}>
        {t("plusone.meter.line", {
          courses: ctx.totals.courses, maxCourses: capCourses,
          sh: ctx.totals.semesterHours, maxSH: capSH,
        })}
      </div>

      {/* 2 · what is wrong. Only rendered when something actually is. */}
      {byStatus.violated.length > 0 && (
        <Section title={t("plusone.group.violated")} color="var(--error-text)" isPhone={isPhone}>
          {byStatus.violated.map((d, i) => <DiagRow key={i} diag={d} isPhone={isPhone} t={t} />)}
        </Section>
      )}

      {/* 3 · what to take — the actionable core, and the reason the card exists. */}
      {candidates.length > 0 && (
        <Section title={t("plusone.sec.share")} isPhone={isPhone}>
          {shown.map(row => <CandidateRow key={row.gradId} row={row} isPhone={isPhone} t={t} />)}

          {(hidden > 0 || showAllCandidates) && (
            <button
              onClick={e => { e.stopPropagation(); setShowAll(v => !v); }}
              style={{
                background: "transparent", border: "none", padding: "1px 0",
                color: "var(--text-5)", fontSize: isPhone ? 7 : 8.5, cursor: "pointer",
                textDecoration: "underline", textUnderlineOffset: 2,
              }}
            >
              {showAllCandidates ? t("plusone.cand.less") : t("plusone.cand.more", { n: hidden })}
            </button>
          )}

          {/* Some colleges publish an open rule rather than a list. Saying so is
              the difference between a helpful table and a misleading one. */}
          {openDomain && (
            <div style={{
              fontSize: isPhone ? 7 : 8.5, color: "var(--text-5)",
              lineHeight: 1.4, marginTop: 3,
            }}>{t("plusone.cand.open")}</div>
          )}
        </Section>
      )}

      {/* 4 · where that leaves them. Only when the master's total is known, and
             never without the caveat: a projection reads as a promise unless the
             promise is explicitly withheld. */}
      {msTotal > 0 && (
        <Section title={t("plusone.sec.after")} isPhone={isPhone}>
          <div style={{ fontSize: isPhone ? 8 : 9.5, color: "var(--text-2)", lineHeight: 1.45 }}>
            {t("plusone.projection", { sh: doneSH + plannedSH, total: msTotal })}
          </div>
          <div style={{ fontSize: isPhone ? 7 : 8.5, color: "var(--text-5)", lineHeight: 1.4 }}>
            {t("plusone.projection.caveat")}
          </div>
        </Section>
      )}

      {/* 5 · what is being asked of them — everything we cannot check. */}
      {byStatus.unknown.length > 0 && (
        <Section title={t("plusone.sec.before")} color="var(--warn-bright)" isPhone={isPhone}>
          {byStatus.unknown.map((d, i) => <DiagRow key={i} diag={d} isPhone={isPhone} t={t} />)}
        </Section>
      )}

      {/* 6 · fine print, folded. Real but not what anyone opens the card for. */}
      {byStatus.info.length > 0 && (
        <Section
          title={t("plusone.sec.notes")} color="var(--text-4)" isPhone={isPhone}
          tail={
            <button
              onClick={e => { e.stopPropagation(); setShowNotes(v => !v); }}
              style={{
                background: "transparent", border: "none", padding: 0,
                color: "var(--text-5)", fontSize: isPhone ? 7 : 8.5, cursor: "pointer",
              }}
            >{showNotes ? "▼" : `▶ ${byStatus.info.length}`}</button>
          }
        >
          {showNotes && byStatus.info.map((d, i) => <DiagRow key={i} diag={d} isPhone={isPhone} t={t} />)}
        </Section>
      )}

      {/* Provenance. Non-negotiable here: the academic catalog publishes no
          PlusOne course data, so every pathway is a transcription from a college
          page and the reader is entitled to know which, and when it was read. */}
      {pathway.source?.url && (
        <div style={{
          marginTop: 9, display: "flex", gap: 6, alignItems: "baseline",
          fontSize: isPhone ? 6.5 : 8, lineHeight: 1.4,
        }}>
          <a href={pathway.source.url} target="_blank" rel="noopener noreferrer"
             onClick={e => e.stopPropagation()}
             style={{ color: stale ? "var(--warn-bright)" : "var(--text-5)", textDecoration: "none" }}>
            {stale
              ? t("plusone.source.stale", { date: pathway.source.retrievedAt })
              : t("plusone.source", { date: pathway.source.retrievedAt })}
          </a>
          {roll.satisfied > 0 && (
            <span style={{ color: "var(--success)", marginInlineStart: "auto" }}>
              ✓ {t("plusone.group.satisfied", { n: roll.satisfied })}
            </span>
          )}
        </div>
      )}
    </MajorCard>
  );
}

// ── Planner bits ─────────────────────────────────────────────────
// A tiny indirection so the component above reads as one thing. Kept local
// rather than added to GradCtx: GradCtx is shared by the whole requirement
// tree, and widening it for one card would put grades in reach of every node
// that renders a checkbox.
function usePlannerBits() {
  const { placements, placedOut, grades, SEM_INDEX, getSemStatus } = usePlanner();
  return { placements, placedOut, grades, SEM_INDEX, getSemStatus };
}
