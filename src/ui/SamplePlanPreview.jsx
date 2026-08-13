// ═══════════════════════════════════════════════════════════════════
// SAMPLE PLAN PREVIEW — the plan on the planner, before committing to it.
//
// ── Why a dialog and not a hovercard ───────────────────────────────
//
// Measured over the committed corpus (385 plan files, 678 variants): the
// median variant is 4 years, 14 term blocks and 39 entries; p90 is 48 entries
// and the worst is 83. Nothing that size fits in a tooltip, and a tooltip
// cannot be scrolled — reaching for the scrollbar dismisses it. A hover
// trigger also fires exactly when the pointer is on its way to the button,
// and never fires at all on a touch screen. So: a real dialog, opened on
// click, from beside the variant picker and from inside the replace
// confirmation.
//
// ── Why it looks like the planner ──────────────────────────────────
//
// This draws the ordinary NU Map rows at reduced scale — the same seasonal row
// colours, the same subject-striped cards, summer split into its two halves,
// co-op as a block across the term. A student is being asked what their plan
// will look like, and the only honest answer is a picture of their plan. It is
// STATIC: no drag handles, no click targets, no inputs. Nothing in here can
// change anything, which is what makes it safe to show before the decision.
//
// It is a reduced RE-RENDER, not the live grid. The live rows read the planner
// context — one `placements`, one set of drag handlers — so showing the real
// SemRow here would mean either mutating the student's plan to preview it or
// standing up a second planner provider that writes to the same localStorage.
// The shared pure helpers (`buildSemesterView`, `cardsIn`, `loadIn`) do the
// part that must not diverge: card resolution, ordering and term load are
// computed by the same functions the real grid uses.
//
// ── Why it re-runs the apply instead of reading plan.json ──────────
//
// It renders the OUTPUT of `applySamplePlan`, with the same arguments the
// buttons use, not a second walk of the published grid. The two can disagree —
// the apply merges consecutive co-op cells into one block, adds corequisites
// the department left implicit (218 gaps across the corpus), and drops terms
// past the end of the student's timeline. Both verbs lay out onto an EMPTY
// canvas, so what this draws is exactly what lands.
//
// ── What it warns about, and what it doesn't ───────────────────────
//
// Terms past the end of the timeline: 19.0% of variants against a four-year
// plan (264 terms), 0.3% against five years — frequent enough to earn a line.
// Unknown course codes: 0 of 678 variants, so that note is not rendered at
// all. A warning that has never once fired is furniture.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useMemo } from "react";
import { createPortal }       from "react-dom";
import { usePlanner }         from "../context/PlannerContext.jsx";
import { usePort }            from "../context/InstitutionContext.jsx";
import { useLanguage }        from "../context/LanguageContext.jsx";
import { ICalendar }          from "../ports/ICalendar.js";
import { ICreditSystem }      from "../ports/ICreditSystem.js";
import { ISpecialTerms }      from "../ports/ISpecialTerms.js";
import { TText, useTranslatedText } from "../context/TranslationContext.jsx";
import { SEM_NAME_KEY }       from "./SemLabel.jsx";
import { TYPE_BG }            from "../core/constants.js";
import { buildSemesterView, cardsIn, loadIn } from "../core/semesterView.js";
import { applySamplePlan }    from "../core/applySamplePlan.js";

/**
 * ── Type scale ─────────────────────────────────────────────────────
 *
 * Five steps, and nothing outside them. The first draft of this file grew its
 * sizes by shrinking until things fit — 7.5, 8.5, 9.5 — which is how a reading
 * surface ends up smaller than the working surface it depicts. The planner
 * itself sets course codes at 11 and semester names at 12; a preview meant to
 * be READ has no business going below that.
 *
 * Three rules held here:
 *
 *   1. **A floor of 11px.** Below roughly 11 the x-height of Inter at typical
 *      viewing distance stops carrying lowercase reliably, and CJK glyphs lose
 *      internal strokes outright. Nothing in this dialog is smaller.
 *   2. **Integers only.** Fractional sizes rasterise inconsistently between
 *      the two halves of a split row, so 8.5px text looked blurrier in one
 *      column than the next.
 *   3. **Separation where it carries meaning.** The steps are close at the
 *      bottom (11/12) because those two are also separated by weight and
 *      colour — a bold coloured code against muted regular metadata — and
 *      widen at the top (14, 18) where size is doing the work alone.
 *
 * The dialog is wider than the old one to pay for this; the layout stays
 * compact, the letters do not.
 */
const TYPE = {
  eyebrow: 10,   // uppercase, letterspaced — presence comes from tracking
  meta:    11,   // term sub-label, load, course titles, footnotes
  body:    12,   // course codes, work blocks
  lead:    14,   // semester names, the variant label
  title:   18,   // the program
  action:  13,   // buttons
};

export default function SamplePlanPreview({
  open, onClose, onReplace, plan, programData, programLabel,
}) {
  const {
    SEMESTERS, courseMap, isPhone,
    planEntSem, planEntYear, planGradSem, planGradYear,
  } = usePlanner();
  const { t }   = useLanguage();
  const credit  = usePort(ICreditSystem);
  const special = usePort(ISpecialTerms);

  useEffect(() => {
    if (!open) return;
    // Stopped, not just handled: this can sit on top of the replace
    // confirmation, and one Escape should close one layer.
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const coopDurations = useMemo(
    () => (special.getTypes?.() ?? []).find(x => x.id === "coop")?.durations?.map(d => d.duration) ?? [6],
    [special]);

  const laid = useMemo(() => (plan
    ? applySamplePlan(plan, { semesters: SEMESTERS, courseMap, programData, coopDurations })
    : null), [plan, SEMESTERS, courseMap, programData, coopDurations]);

  // Same view the grid draws from, so ordering and load cannot drift.
  const view = useMemo(() => buildSemesterView({
    placements:   laid?.placements   ?? {},
    reservations: laid?.reservations ?? {},
    courseMap,
  }), [laid, courseMap]);

  // Start / continuation, taken from the run the apply already computed rather
  // than re-deriving it from term weights: `spans` IS the set of semesters the
  // block covers, so the preview cannot disagree with the block it previews.
  const [startMap, contMap] = useMemo(() => {
    const s = {}, c = {};
    for (const run of laid?.coops ?? []) {
      s[run.semId] = run.id;
      for (const semId of run.spans) if (semId !== run.semId) c[semId] = run.id;
    }
    return [s, c];
  }, [laid]);

  const overflow = laid?.notes.filter(n => n.kind === "outside-timeline").length ?? 0;

  // Which co-op cycle this variant actually runs — READ from the blocks the
  // apply produced, not parsed out of the label. The label is the department's
  // English prose ("Two Co-ops in Spring/Summer 1"); the blocks are where they
  // landed. NU sells two cycles, spring+summer A and summer B+fall, so the
  // start term names the cycle. A variant with no co-ops says nothing.
  const cycles = useMemo(() => {
    const out = new Set();
    for (const run of laid?.coops ?? []) {
      const sem = SEMESTERS.find(s => s.id === run.semId);
      if (!sem) continue;
      out.add(sem.semTypeId === "spring" || sem.semTypeId === "sumA" ? "spring" : "fall");
    }
    return [...out];
  }, [laid, SEMESTERS]);

  // Rows, paired exactly as App.jsx pairs them: consecutive sumA + sumB share
  // one row. The Incoming Credit row is dropped — a sample plan never places
  // transfer credit, so it would be a permanently empty row at the top.
  const rows = useMemo(() => {
    const out = [];
    let i = 0;
    while (i < SEMESTERS.length) {
      const sem = SEMESTERS[i], next = SEMESTERS[i + 1];
      if (sem.id === "incoming") { i += 1; continue; }
      if (sem.type === "summer" && next?.type === "summer" &&
          next.id.replace("sumB", "") === sem.id.replace("sumA", "")) {
        out.push({ kind: "summer", sems: [sem, next] }); i += 2;
      } else if (sem.type === "summer") {
        out.push({ kind: "summer", sems: [sem] }); i += 1;
      } else {
        out.push({ kind: "term", sems: [sem] }); i += 1;
      }
    }
    return out;
  }, [SEMESTERS]);

  if (!open || !plan || !laid) return null;

  const unit  = credit.getUnitName();
  const types = special.getTypes?.() ?? [];
  const ctx   = { view, startMap, contMap, laid, types, unit, isPhone, t };

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 310,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 14,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="spp-title"
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--bg-surface)", border: "1px solid var(--border-2)",
          // Wider than it was: the type scale went up, and the alternative to
          // more width is narrower columns, which is where the small sizes
          // came from in the first place.
          borderRadius: 12, maxWidth: 900, width: "100%",
          maxHeight: "calc(100vh - 28px)", display: "flex", flexDirection: "column",
          boxShadow: "var(--shadow-modal)", color: "var(--text-2)",
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        {/* Head — fixed, so the plan scrolls under its own name. */}
        <div style={{
          padding: "16px 18px 12px", borderBottom: "1px solid var(--border-1)", flex: "0 0 auto",
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div id="spp-title" style={{
                fontSize: TYPE.eyebrow, fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-4)",
              }}>{t("grad.plan.preview.title")}</div>
              {/* The program leads. Which degree this is was the one thing the
                  title could not be read without — a variant label alone
                  ("Four Years, Two Co-ops") names no major at all. */}
              {!!programLabel && (
                <div style={{
                  fontSize: TYPE.title, fontWeight: 800, color: "var(--text-1)", marginTop: 3,
                  lineHeight: "calc(1.25 * var(--lh-scale, 1))",
                }}>
                  {programLabel}
                </div>
              )}
              <div style={{
                fontSize: programLabel ? TYPE.lead : TYPE.title,
                fontWeight: programLabel ? 600 : 800,
                color: programLabel ? "var(--text-3)" : "var(--text-1)", marginTop: 3,
                lineHeight: "calc(1.3 * var(--lh-scale, 1))",
              }}>
                <TText>{plan.label ?? ""}</TText>
              </div>
              {/* The facts of the run: when it starts and ends, what arrives,
                  and which co-op cycle it puts you on. */}
              <div style={{
                fontSize: TYPE.meta, color: "var(--text-4)", marginTop: 6,
                lineHeight: "calc(1.5 * var(--lh-scale, 1))",
              }}>
                {[
                  `${cohortName(planEntSem,  planEntYear,  t)} → ${cohortName(planGradSem, planGradYear, t)}`,
                  t("onboard.sampleplan.counts", {
                    courses: laid.placed.length, placeholders: laid.reserved.length }),
                  laid.coops.length ? t("grad.plan.preview.coops", { n: laid.coops.length }) : null,
                  ...cycles.map(c => t(`grad.plan.cycle.${c}`)),
                ].filter(Boolean).join(" · ")}
              </div>
            </div>
            <button onClick={onClose} aria-label={t("grad.plan.preview.close")} style={closeX}>✕</button>
          </div>
        </div>

        {/* The plan, drawn as the planner draws it. Nothing here is a control. */}
        <div style={{ padding: "10px 14px", overflowY: "auto", flex: "1 1 auto", background: "var(--bg-app)" }}>
          {rows.map(row => row.kind === "summer"
            ? <MiniSummerRow key={row.sems[0].id} sems={row.sems} {...ctx} />
            : <MiniTermRow   key={row.sems[0].id} sem={row.sems[0]}  {...ctx} />)}
        </div>

        {/* Foot — the one warning the corpus says actually happens. */}
        <div style={{
          padding: "10px 18px 14px", borderTop: "1px solid var(--border-1)", flex: "0 0 auto",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          {overflow > 0 && (
            <div style={{
              fontSize: TYPE.meta, color: "var(--warn-badge-text)", flex: 1,
              lineHeight: "calc(1.4 * var(--lh-scale, 1))",
            }}>
              ⚠ {t("grad.plan.overflow", { n: overflow })}
            </div>
          )}
          <div style={{ flex: overflow > 0 ? "0 0 auto" : 1 }} />
          <button onClick={onClose} style={{
            fontSize: TYPE.action, fontWeight: 600, padding: "7px 16px", borderRadius: 6, cursor: "pointer",
            background: "var(--bg-2)", color: "var(--text-2)", border: "1px solid var(--border-1)",
          }}>{t("grad.plan.preview.close")}</button>
          {/* Acting from here goes through the SAME confirmation as the button
              in the panel. Having just read the plan is the best-informed
              anyone gets, but it is still not the moment to skip being told
              what it costs. */}
          {onReplace && (
            <button onClick={onReplace} style={{
              fontSize: TYPE.action, fontWeight: 700, padding: "7px 16px", borderRadius: 6, cursor: "pointer",
              background: "var(--error-bg)", color: "var(--error-text)", border: "1px solid var(--error)",
            }}>{t("grad.plan.replace")}</button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

/** A fall/spring row: label column, then the term's cards. */
function MiniTermRow({ sem, view, startMap, contMap, laid, types, unit, isPhone, t }) {
  const tb    = TYPE_BG[sem.type] ?? TYPE_BG.special;
  const cards = cardsIn(sem.id, view);
  const run   = runFor(sem.id, laid, startMap, contMap);

  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 8,
      background: tb.bg, border: `1px solid ${tb.border}`, borderRadius: 6,
      padding: "7px 8px", marginBottom: 4, minHeight: 58,
    }}>
      <SemLabelCol sem={sem} sh={loadIn(sem.id, view, startMap, contMap)} unit={unit} isPhone={isPhone} t={t} />
      <TermBody cards={cards} sem={sem} tb={tb} run={run} types={types} t={t} />
    </div>
  );
}

/**
 * What sits in a term: the work block if one covers it, then the term's cards
 * on two lines, then the empty slots the planner leaves dashed.
 *
 * ── The two lines ──────────────────────────────────────────────────
 *
 * The same split the grid uses, by the same rule (`sh >= 3 || shVoided`):
 * substantial courses on the main line, everything one or two credits — labs,
 * recitations, seminars — on a quieter line beneath. Without it a zero-credit
 * recitation took a full slot next to a four-credit course and the term read
 * as fuller than it is. The rule is copied deliberately rather than
 * approximated: a preview that grouped cards differently from the board would
 * be a different picture of the same plan.
 *
 * The block does not REPLACE the cards. A term can legitimately hold both — a
 * plan that writes "Co-op or vacation" alongside a course puts one of each in
 * the same term — and an earlier draft of this rendered only the block, which
 * would have hidden a course the apply really does place.
 */
function TermBody({ cards, sem, tb, run, types, t }) {
  const main   = cards.filter(c => c.sh >= 3 || c.shVoided);
  const others = cards.filter(c => c.sh <= 2 && !c.shVoided);
  const empties = run ? 0 : Math.max(0, (sem.maxSlots ?? 4) - main.length);

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {run && <WorkBlock run={run} types={types} t={t} />}
        {main.map(c => <MiniCard key={c.id} card={c} />)}
        {Array.from({ length: Math.min(empties, 4) }, (_, i) => (
          <div key={`e${i}`} style={{
            flex: "1 1 104px", minWidth: 0, minHeight: 44, borderRadius: 6,
            border: "1px dashed var(--border-slot)", background: tb.bg, opacity: 0.6,
          }} />
        ))}
      </div>
      {!!others.length && (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4, paddingTop: 4,
          borderTop: "1px solid var(--border-sub)",
        }}>
          {others.map(c => <MiniCard key={c.id} card={c} small />)}
        </div>
      )}
    </div>
  );
}

/** A summer row: the two halves side by side, as the planner splits them. */
function MiniSummerRow({ sems, view, startMap, contMap, laid, types, unit, isPhone, t }) {
  const tb = TYPE_BG.summer;
  return (
    <div style={{
      display: "flex", alignItems: "stretch", gap: 6,
      background: tb.bg, border: `1px solid ${tb.border}`, borderRadius: 6,
      padding: "7px 8px", marginBottom: 4, minHeight: 58,
    }}>
      {sems.map(sem => {
        const cards = cardsIn(sem.id, view);
        const run   = runFor(sem.id, laid, startMap, contMap);
        return (
          <div key={sem.id} style={{
            flex: 1, minWidth: 0, border: "1px solid var(--border-slot)", borderRadius: 4,
            padding: "5px 6px", background: "var(--card-bg)",
          }}>
            <SemLabelCol sem={sem} sh={loadIn(sem.id, view, startMap, contMap)}
                         unit={unit} isPhone={isPhone} t={t} inline />
            <div style={{ marginTop: 3 }}>
              <TermBody cards={cards} sem={sem} tb={tb} run={run} types={types} t={t} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The semester's name and load.
 *
 * The season comes from the hand-written `claude.sem.*` keys for the same
 * reason SemRow uses them: per-word engine translation turns "Fall" into
 * "falling". A calendar term type we have no key for falls back to
 * whole-phrase translation, hint included — hence the hook, which must run
 * whether or not that branch is taken.
 */
function SemLabelCol({ sem, sh, unit, isPhone, t, inline = false }) {
  const cal  = usePort(ICalendar);
  const st   = cal.getSemesterTypes().find(s => s.id === sem.semTypeId);
  const year = sem.label.match(/\d{4}/)?.[0] ?? "";
  const key  = SEM_NAME_KEY[sem.semTypeId];
  const translated = useTranslatedText(key ? null : sem.label,
    { as: st?.translateAs ? `${st.translateAs} ${year}` : undefined });
  const name = key ? `${t(key)}${year ? ` ${year}` : ""}` : (translated ?? sem.label);

  if (inline) {
    return (
      <div style={{ display: "flex", alignItems: "baseline", gap: 5, minWidth: 0 }}>
        <span style={{
          fontSize: TYPE.body, fontWeight: 700, color: "var(--text-3)",
          fontFamily: "'InterTight', 'Inter', system-ui, sans-serif",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{name}</span>
        <span style={{ flex: 1 }} />
        {!!sh && <span style={{ fontSize: TYPE.meta, color: "var(--text-5)" }}>{sh} {unit}</span>}
      </div>
    );
  }
  return (
    <div style={{ width: isPhone ? 76 : 116, flexShrink: 0, minWidth: 0 }}>
      <div style={{
        fontSize: TYPE.lead, fontWeight: 700, color: "var(--text-2)",
        fontFamily: "'InterTight', 'Inter', system-ui, sans-serif",
        lineHeight: "calc(1.2 * var(--lh-scale, 1))",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{name}</div>
      <div style={{
        fontSize: TYPE.meta, color: "var(--text-5)", marginTop: 2,
        lineHeight: "calc(1.35 * var(--lh-scale, 1))",
      }}>
        <TText>{sem.sub}</TText>{!!sh && <> · {sh} {unit}</>}
      </div>
    </div>
  );
}

/**
 * One card. The reservation shape comes from `occupantCards`, so a placeholder
 * arrives here already looking like a card — grey, its label as the code, its
 * requirement as the title. The only thing this adds is the dashed border: on
 * the real grid a placeholder is a card you can drop onto, and here it is a
 * decision still to make, which is worth saying at a glance.
 */
function MiniCard({ card, small = false }) {
  const held = !card.isReservation;
  return (
    <div style={{
      // The second line is for one- and two-credit cards, so they take the
      // room they are worth rather than a full slot each.
      flex: small ? "0 1 auto" : "1 1 104px",
      minWidth: 0, minHeight: small ? 0 : 44, position: "relative", overflow: "hidden",
      background: "var(--card-bg)", borderRadius: 6,
      border: held ? "1px solid var(--border-card)" : "1px dashed var(--border-slot)",
      padding: small ? "4px 7px 4px 10px" : "4px 6px 4px 10px",
    }}>
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: 4,
        background: card.color, borderRadius: "5px 0 0 5px", opacity: held ? 1 : 0.5,
      }} />
      <div style={{
        fontSize: TYPE.body, fontWeight: 800, color: held ? card.color : "var(--text-4)",
        letterSpacing: "0.02em", lineHeight: "calc(1.3 * var(--lh-scale, 1))",
        overflow: "hidden", textOverflow: "ellipsis",
        whiteSpace: held ? "nowrap" : "normal",
        fontStyle: held ? "normal" : "italic",
      }}>{held ? card.code : <TText>{card.code}</TText>}</div>
      {/* Titles only on the main line: the second line is a strip of small
          cards, and a wrapped title there costs more height than the courses
          on it are worth. */}
      {!!card.title && !small && (
        <div style={{
          fontSize: TYPE.meta, color: "var(--text-5)", marginTop: 1,
          lineHeight: "calc(1.3 * var(--lh-scale, 1))",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>{card.title}</div>
      )}
    </div>
  );
}

/** A co-op across the term — a block, never a card, as on the real grid. */
function WorkBlock({ run, types, t }) {
  const type = types.find(x => x.id === run.typeId) ?? types.find(x => x.id === "coop");
  return (
    <div style={{
      // A full line of its own: a co-op is the term, not one card in it, and
      // anything the plan places alongside wraps underneath.
      flex: "1 1 100%", minWidth: 0, minHeight: 44, borderRadius: 6,
      border: "1px solid var(--border-card)", background: "var(--card-bg)",
      padding: "6px 12px", display: "flex", alignItems: "center", gap: 8,
    }}>
      <span style={{
        fontSize: TYPE.lead, fontWeight: 600, color: "var(--text-2)",
        letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap",
      }}>
        <TText>{type?.label ?? "Co-op"}</TText>{run.cont ? <> {t("sem.cont.label")}</> : null}
      </span>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: TYPE.meta, color: "var(--text-5)", whiteSpace: "nowrap" }}>
        {t("grad.plan.preview.duration", { n: run.duration })}
      </span>
    </div>
  );
}

/**
 * The work-term run covering a semester, and whether it merely passes through.
 *
 * The type id is read back out of the instance the apply wrote, not assumed to
 * be "coop": `applySamplePlan` takes `coopTypeId` as a parameter, so an
 * institution whose plans describe a different kind of work term would have
 * had this label lie about it.
 */
function runFor(semId, laid, startMap, contMap) {
  const id = startMap[semId] ?? contMap[semId];
  if (!id) return null;
  const run = (laid?.coops ?? []).find(c => c.id === id);
  if (!run) return null;
  return { ...run, typeId: laid?.specialTermPl?.[id]?.typeId ?? "coop", cont: !startMap[semId] };
}

/**
 * "Fall 2026" for a cohort endpoint.
 *
 * The written season keys again, not the engine: this sits beside the row
 * labels, and the two reading differently in the same dialog would be worse
 * than either reading oddly.
 */
function cohortName(sem, year, t) {
  const key = SEM_NAME_KEY[sem];
  return `${key ? t(key) : sem}${year ? ` ${year}` : ""}`;
}

const closeX = {
  // A glyph, not text — sized to be a comfortable 44px-ish target rather than
  // to sit on the type scale.
  fontSize: 16, lineHeight: 1, background: "transparent", border: "none",
  color: "var(--text-5)", cursor: "pointer", padding: "2px 0 6px 8px", flex: "0 0 auto",
};
