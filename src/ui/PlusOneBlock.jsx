// ═══════════════════════════════════════════════════════════════════
// PLUSONE BLOCK — the accelerated bachelor's/master's card.
//
// Built on GradPanel's MajorCard so it is seamless by construction: same frame,
// header, caret, progress bar and expand bar as a major or a minor. A hand-rolled
// card would have drifted the moment MajorCard changed.
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
// ── Grouping by certainty is the whole point ───────────────────────
//
// Diagnostics are grouped violated / unknown / info, never blended. "We checked
// and this is wrong" and "we cannot know this" are different facts, and the
// second is the common case here — GPA, admission, advisor sign-off and
// registration overrides are all things NU Map does not hold and must never
// pretend to have checked. Satisfied checks collapse to a count: eight green
// ticks is noise, and the absence of a red one is the signal.
// ═══════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect, useContext } from "react";
import { GradCtx, MajorCard } from "./GradPanel.jsx";
import { usePlanner } from "../context/PlannerContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useTranslatedText } from "../context/TranslationContext.jsx";
import { evaluatePathway, summarise } from "../core/pathway/evaluate.js";
import { activeShares, shareTotals, resolveCandidates, excludedIds } from "../core/pathway/shareSet.js";
import { msProgramFor, isStale } from "../core/pathway/select.js";
import { displayCode } from "../core/pathway/ids.js";
import { STATUS } from "../core/pathway/ruleKinds.js";
import { takeConsumesSlot } from "../core/gradeSystem.js";

/** Status → the theme token that already means that thing elsewhere. */
const STATUS_COLOR = {
  [STATUS.VIOLATED]: "var(--error-text)",
  [STATUS.UNKNOWN]: "var(--warn-bright)",
  [STATUS.INFO]: "var(--text-4)",
  [STATUS.SATISFIED]: "var(--success)",
};

/** One diagnostic line. */
function DiagRow({ diag, isPhone, t }) {
  const color = STATUS_COLOR[diag.status] ?? "var(--text-4)";
  return (
    <div style={{
      display: "flex", gap: 5, alignItems: "flex-start",
      fontSize: isPhone ? 8 : 9.5, lineHeight: 1.45, marginBottom: 3,
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

/** A titled group of diagnostics; renders nothing when empty. */
function DiagGroup({ title, color, diags, isPhone, t }) {
  if (!diags.length) return null;
  return (
    <div style={{ marginTop: 7 }}>
      <div style={{
        fontSize: isPhone ? 7 : 8.5, fontWeight: 700, color,
        letterSpacing: "0.05em", marginBottom: 3,
      }}>{title}</div>
      {diags.map((d, i) => <DiagRow key={`${d.kind}-${i}`} diag={d} isPhone={isPhone} t={t} />)}
    </div>
  );
}

/**
 * The share list: what is actually double counting right now.
 *
 * The arrow is the one-wayness made visible. `CS 5800 → CS 3000` says the
 * graduate course covers the undergraduate one; it never reads in reverse,
 * which matters because the reverse is exactly the thing that would be wrong.
 */
function ShareList({ shares, isPhone, t }) {
  if (!shares.length) {
    return (
      <div style={{ fontSize: isPhone ? 8 : 9.5, color: "var(--text-5)", marginTop: 4, lineHeight: 1.45 }}>
        {t("plusone.shares.none")}
      </div>
    );
  }
  return (
    <div style={{ marginTop: 4 }}>
      {shares.map((s, i) => {
        const dim = s.withdrawn;
        return (
          <div key={`${s.gradId}-${i}`} style={{
            display: "flex", alignItems: "baseline", gap: 4, flexWrap: "wrap",
            fontSize: isPhone ? 8 : 9.5, marginBottom: 2,
            opacity: dim ? 0.5 : 1,
          }}>
            <span style={{
              color: "var(--text-2)", fontWeight: 600,
              textDecoration: dim ? "line-through" : "none",
            }}>{displayCode(s.gradId)}</span>
            <span style={{ color: "var(--text-5)" }}>→</span>
            <span style={{ color: "var(--text-3)" }}>
              {s.targetId
                ? displayCode(s.targetId)
                : t("plusone.shares.fills", { label: s.share?.target?.label ?? "" })}
            </span>
            <span style={{ color: "var(--text-5)", fontSize: isPhone ? 7 : 8.5 }}>
              {s.sh} SH{dim ? ` · ${t("plusone.shares.withdrawn")}` : ""}
            </span>
          </div>
        );
      })}
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
  const {
    placements, placedOut, grades, SEM_INDEX, getSemStatus,
  } = usePlannerBits();

  const [expanded, setExpanded] = useState(true);
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

  // ── The evaluation context ──────────────────────────────────────
  const ctx = useMemo(() => {
    const shares = activeShares({
      pathway, placements, courseMap, grades, placedOut,
      // A take whose grade voids it (W/F/U) is "withdrawn" for our purposes.
      // Reuses the grade layer's own rule rather than re-listing the letters.
      isVoid: g => g != null && !takeConsumesSlot(g),
    });
    const counting = pathway?.counting ?? {};
    return {
      pathway,
      shares,
      candidates: resolveCandidates(pathway, { excluded: excludedIds(pathway) }),
      placements, placedOut, courseMap,
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

  // ── The cap meter ───────────────────────────────────────────────
  const cap = useMemo(
    () => (pathway?.rules ?? []).find(r => r.kind === "shareCap") ?? {},
    [pathway]
  );
  const capSH = Number.isFinite(cap.semesterHours) ? cap.semesterHours : 16;
  const capCourses = Number.isFinite(cap.courses) ? cap.courses : 4;

  // Split shared hours into done vs planned, the same distinction the rest of
  // the panel draws — a share sitting in a completed term is banked, one in a
  // future term is an intention.
  const { doneSH, plannedSH } = useMemo(() => {
    let done = 0, planned = 0;
    for (const s of ctx.shares) {
      if (s.withdrawn) continue;
      const completed = s.semId && getSemStatus?.(s.semId) === "completed";
      if (completed) done += s.sh; else planned += s.sh;
    }
    return { doneSH: done, plannedSH: planned };
  }, [ctx.shares, getSemStatus]);

  const msTotal = Number(msData?.totalCreditsRequired) || 0;
  const stale = isStale(pathway);

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
      {/* What the bar above is measuring. Without this line a ceiling reads as
          a requirement. */}
      <div style={{
        fontSize: isPhone ? 7.5 : 9, color: "var(--text-5)",
        letterSpacing: 0, marginBottom: 2,
      }}>
        {ctx.totals.courses}/{capCourses} · {t("plusone.meter")}
      </div>

      {/* The master's-side projection. Only shown when we actually know the
          master's total, and always beside the caveat: a projection reads as a
          promise unless the promise is explicitly withheld. */}
      {msTotal > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: isPhone ? 8 : 9.5, color: "var(--text-2)", lineHeight: 1.45 }}>
            {t("plusone.projection", { sh: doneSH + plannedSH, total: msTotal })}
          </div>
          <div style={{ fontSize: isPhone ? 7 : 8.5, color: "var(--text-5)", lineHeight: 1.4, marginTop: 1 }}>
            {t("plusone.projection.caveat")}
          </div>
        </div>
      )}

      {/* Shares in use */}
      <div style={{ marginTop: 8 }}>
        <div style={{
          fontSize: isPhone ? 7 : 8.5, fontWeight: 700, color: "var(--text-3)",
          letterSpacing: "0.05em",
        }}>{t("plusone.shares.label")}</div>
        <ShareList shares={ctx.shares} isPhone={isPhone} t={t} />
      </div>

      {/* Diagnostics, grouped by what we can actually claim */}
      <DiagGroup title={t("plusone.group.violated")} color="var(--error-text)"
                 diags={byStatus.violated} isPhone={isPhone} t={t} />
      <DiagGroup title={t("plusone.group.unknown")} color="var(--warn-bright)"
                 diags={byStatus.unknown} isPhone={isPhone} t={t} />
      <DiagGroup title={t("plusone.group.info")} color="var(--text-4)"
                 diags={byStatus.info} isPhone={isPhone} t={t} />

      {/* Satisfied collapses to a count — see the header comment. */}
      {roll.satisfied > 0 && (
        <div style={{
          fontSize: isPhone ? 7 : 8.5, color: "var(--success)", marginTop: 7,
        }}>
          ✓ {t("plusone.group.satisfied", { n: roll.satisfied })}
        </div>
      )}

      {/* Provenance. Non-negotiable for this feature: the academic catalog
          publishes no PlusOne course data, so every pathway is a transcription
          from a college page and the reader is entitled to know which one and
          when it was last checked. */}
      {pathway.source?.url && (
        <div style={{ marginTop: 8, fontSize: isPhone ? 6.5 : 8, lineHeight: 1.4 }}>
          <a href={pathway.source.url} target="_blank" rel="noopener noreferrer"
             onClick={e => e.stopPropagation()}
             style={{ color: stale ? "var(--warn-bright)" : "var(--text-5)", textDecoration: "none" }}>
            {stale
              ? t("plusone.source.stale", { date: pathway.source.retrievedAt })
              : t("plusone.source", { date: pathway.source.retrievedAt })}
          </a>
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
