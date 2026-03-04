// ═══════════════════════════════════════════════════════════════════
// PLAN MODEL  (pure helpers over planner state — no React, no I/O)
// ═══════════════════════════════════════════════════════════════════
import { buildPlacedKeySet, validateMajor } from "./gradRequirements.js";
import { loadMajor } from "../data/majorLoader.js";
import { loadMinor } from "../data/minorLoader.js";

/** Convert a CSS hex colour to "r,g,b" string (for use in rgba()). */
export function hexRgb(hex) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r ? `${parseInt(r[1], 16)},${parseInt(r[2], 16)},${parseInt(r[3], 16)}` : "180,180,180";
}

/** Total semester hours placed in a given semester. */
export function getSemSH(semId, placements, courseMap) {
  return Object.entries(placements)
    .filter(([, s]) => s === semId)
    .reduce((acc, [id]) => acc + (courseMap[id]?.sh ?? 0), 0);
}

/**
 * Return the course IDs in a semester in display order.
 * Respects semOrders overrides; de-duplicates; appends any unordered extras.
 */
export function getOrderedCourses(semId, placements, semOrders, courseMap) {
  const inSem = Object.keys(placements).filter(
    id => placements[id] === semId && courseMap[id]
  );
  const order = semOrders[semId];
  if (!order) return inSem;
  const seen    = new Set();
  const ordered = order.filter(id => {
    if (seen.has(id)) return false;
    seen.add(id);
    return inSem.includes(id);
  });
  const extra = inSem.filter(id => !seen.has(id));
  return [...ordered, ...extra];
}

/** All edges touching a given course id. */
export function getConnections(id, edges) {
  return edges.filter(e => e.from === id || e.to === id);
}

// ── PDF export ───────────────────────────────────────────────────

const NP_LABELS = {
  ND:"Natural/Designed World", EI:"Creative Express/Innov",
  IC:"Interpreting Culture",   FQ:"Formal/Quant Reasoning",
  SI:"Societies/Institutions", AD:"Analyzing/Using Data",
  DD:"Difference/Diversity",   ER:"Ethical Reasoning",
  WF:"1st Yr Writing",         WD:"Adv Writing Disc",
  WI:"Writing Intensive",      EX:"Integration Experience",
  CE:"Capstone Experience",
};
const ALL_NP = Object.keys(NP_LABELS);

// ── Requirement tree → HTML ───────────────────────────────────────

function reqNodeHtml(r, doneKeys, depth = 0) {
  const pl = depth * 12;
  if (r.type === "COURSE") {
    const status = r.sat ? (doneKeys.has(r.key) ? "done" : "planned") : "missing";
    const icon   = status === "done" ? "✓" : status === "planned" ? "○" : "";
    return `<div class="rc rc-${status}" style="padding-left:${pl + 4}px">
      <span class="rc-icon rc-icon-${status}">${icon}</span>
      <span class="rc-lbl">${r.label}</span>
    </div>`;
  }
  if (r.type === "RANGE") {
    const status = r.sat ? "done" : "missing";
    const lbl    = r.sat
      ? r.matched.slice(0, 3).join(", ") + (r.matched.length > 3 ? ` +${r.matched.length - 3}` : "") + ` (${r.subject} range)`
      : r.label;
    return `<div class="rc rc-${status}" style="padding-left:${pl + 4}px">
      <span class="rc-icon rc-icon-${status}">${r.sat ? "✓" : ""}</span>
      <span class="rc-lbl">${lbl}</span>
    </div>`;
  }
  const isSat   = r.sat;
  const heading =
    r.type === "AND" ? `All of (${r.satCount ?? 0}/${r.total ?? 0})` :
    r.type === "OR"  ? "One of" :
    r.type === "XOM" ? `${r.satSh ?? 0}/${r.reqSh ?? 0} SH from elective pool` :
    r.title ?? r.label ?? "";
  const childrenHtml = (r.children ?? []).map(c => reqNodeHtml(c, doneKeys, depth + 1)).join("");
  return `<div class="rg" style="padding-left:${pl}px">
    <div class="rg-head rg-${isSat ? "sat" : "unsat"}">
      <span class="rg-icon">${isSat ? "✓" : ""}</span>
      <span class="rg-lbl">${heading}</span>
    </div>
    ${childrenHtml}
  </div>`;
}

function sectionHtml(sec, doneKeys) {
  const pct       = sec.total > 0 ? Math.round(sec.satCount / sec.total * 100) : 0;
  const warnHtml  = (sec.warnings ?? []).map(w =>
    `<div class="sec-warn">⚠ ${w}</div>`).join("");
  const noteHtml  = sec.minRequired < sec.total
    ? `<div class="sec-note">Requires ${sec.minRequired} of ${sec.total}</div>` : "";
  return `<div class="sec${sec.sat ? " sec-sat" : ""}">
    <div class="sec-head">
      <span class="sec-icon">${sec.sat ? "✓" : ""}</span>
      <span class="sec-title">${sec.title}</span>
      <span class="sec-prog">${sec.satCount}/${sec.total}</span>
    </div>
    <div class="sec-bar"><div class="sec-bar-fill${sec.sat ? " sec-bar-sat" : ""}" style="width:${pct}%"></div></div>
    ${warnHtml}
    <div class="sec-body">
      ${sec.children.map(r => reqNodeHtml(r, doneKeys)).join("")}
      ${noteHtml}
    </div>
  </div>`;
}

/**
 * Async: opens a print-ready HTML page and triggers Save-as-PDF.
 * gradInfo: { majorPath, concLabel, minor1Path, minor2Path,
 *             npCovered (Set<string>), doneKeys (Set<string>), totalSHRequired }
 */
export async function exportReport(placements, courseMap, currentSemId, dynSems, dynSemIdx, gradInfo = {}) {
  const curIdx = dynSemIdx[currentSemId] ?? 0;
  const date   = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const {
    majorPath = "", concLabel = "", minor1Path = "", minor2Path = "",
    npCovered = new Set(), doneKeys = new Set(), totalSHRequired = 0,
  } = gradInfo;

  // ── Load major + minors (async) ───────────────────────────────
  const [major, minor1, minor2] = await Promise.all([
    majorPath  ? loadMajor(majorPath).catch(() => null)  : null,
    minor1Path ? loadMinor(minor1Path).catch(() => null) : null,
    minor2Path ? loadMinor(minor2Path).catch(() => null) : null,
  ]);

  // Use major's totalCreditsRequired if caller didn't supply one
  const effectiveTotalSHRequired = totalSHRequired || (major?.totalCreditsRequired ?? 0);

  // ── Compute totals ────────────────────────────────────────────
  let doneSH = 0, plannedSH = 0;
  const semRows = [];
  dynSems.forEach(sem => {
    const ids = Object.keys(placements).filter(id => placements[id] === sem.id && courseMap[id]);
    if (ids.length === 0) return;
    const isDone = (dynSemIdx[sem.id] ?? 99) < curIdx;
    const isCur  = sem.id === currentSemId;
    ids.forEach(id => {
      const sh = courseMap[id]?.sh ?? 0;
      if (isDone) doneSH += sh; else plannedSH += sh;
    });
    semRows.push({ sem, ids, isDone, isCur });
  });

  // ── Requirements sections HTML ────────────────────────────────
  const placedSet = buildPlacedKeySet(placements, courseMap);

  function renderProgram(prog, doneKeysSet, headerLabel, name) {
    if (!prog) return "";
    const sections = validateMajor(prog, placedSet, courseMap);
    const sectionsHtml = sections.map(s => sectionHtml(s, doneKeysSet)).join("");
    return `<div class="section-title">${headerLabel}<span class="prog-name">${name}</span></div>
      ${sectionsHtml}`;
  }

  const reqHtml = [
    renderProgram(major,  doneKeys, "Major Requirements — ",   major?.name ?? ""),
    renderProgram(minor1, doneKeys, "Minor 1 Requirements — ", minor1?.name ?? ""),
    renderProgram(minor2, doneKeys, "Minor 2 Requirements — ", minor2?.name ?? ""),
  ].join("");

  // ── NUPath grid HTML ──────────────────────────────────────────
  const npHtml = ALL_NP.map(key => {
    const sat = npCovered.has(key);
    return `<div class="np-cell${sat ? " sat" : ""}">
      <span class="np-check">${sat ? "✓" : "·"}</span>
      <span class="np-key">${key}</span>
      <span class="np-lbl">${NP_LABELS[key]}</span>
    </div>`;
  }).join("\n");

  // ── Semester blocks HTML ──────────────────────────────────────
  const semHtml = semRows.map(({ sem, ids, isDone, isCur }) => {
    const semSH = ids.reduce((s, id) => s + (courseMap[id]?.sh ?? 0), 0);
    const tag   = isDone ? " done" : isCur ? " current" : "";
    const rows  = ids.map(id => {
      const c = courseMap[id];
      if (!c) return "";
      const pill     = `<span class="pill" style="background:${c.color}">${c.subject ?? c.id}</span>`;
      const nuBadges = (c.nuPath ?? []).map(np => `<span class="np-badge">${np}</span>`).join("");
      return `<div class="course-row">
        ${pill}
        <span class="ccode">${c.code ?? c.id}</span>
        <span class="ctitle">${c.title ?? ""}</span>
        <span class="csh">${c.sh} SH</span>
        ${nuBadges ? `<span class="np-badges">${nuBadges}</span>` : ""}
      </div>`;
    }).join("\n");
    return `<div class="sem-block${tag}">
      <div class="sem-head">
        <span class="sem-label">${sem.label}</span>
        <span class="sem-sh">${semSH} SH${isDone ? " · completed" : isCur ? " · in progress" : ""}</span>
      </div>
      ${rows}
    </div>`;
  }).join("\n");

  // ── Meta lines ───────────────────────────────────────────────
  const majorLabel  = major?.name  ?? "";
  const minor1Label = minor1?.name ?? "";
  const minor2Label = minor2?.name ?? "";
  const metaLines = [
    majorLabel  && `<div class="meta-row"><span class="meta-lbl">Major</span><span class="meta-val">${majorLabel}</span></div>`,
    concLabel   && `<div class="meta-row"><span class="meta-lbl">Concentration</span><span class="meta-val">${concLabel}</span></div>`,
    minor1Label && `<div class="meta-row"><span class="meta-lbl">Minor 1</span><span class="meta-val">${minor1Label}</span></div>`,
    minor2Label && `<div class="meta-row"><span class="meta-lbl">Minor 2</span><span class="meta-val">${minor2Label}</span></div>`,
  ].filter(Boolean).join("\n");

  // ── Credit summary ────────────────────────────────────────────
  const reqPct = effectiveTotalSHRequired > 0 ? Math.min(100, (doneSH / effectiveTotalSHRequired) * 100).toFixed(0) : null;
  const creditHtml = `<div class="credit-row">
    <div class="credit-num">${doneSH}<span class="credit-unit"> SH completed</span></div>
    <div class="credit-sep">+</div>
    <div class="credit-num">${plannedSH}<span class="credit-unit"> SH planned</span></div>
    ${effectiveTotalSHRequired > 0 ? `<div class="credit-sep">/</div><div class="credit-num">${effectiveTotalSHRequired}<span class="credit-unit"> SH required</span></div>` : ""}
    ${reqPct !== null ? `<div class="credit-pct">${reqPct}%</div>` : ""}
  </div>`;

  // ── Full HTML ─────────────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<title>NU Map</title>
<style>
  @page { margin: 18mm 15mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
         font-size: 11px; color: #111; background: #fff; margin: 0; padding: 0; }
  h1   { font-size: 20px; margin: 0 0 2px; font-weight: 800; letter-spacing: -0.01em; }
  .date { font-size: 10px; color: #888; margin-bottom: 14px; }
  .section-title { font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
                   text-transform: uppercase; color: #666; margin: 16px 0 7px;
                   border-bottom: 1px solid #e5e5e5; padding-bottom: 4px;
                   display: flex; align-items: baseline; gap: 6px; }
  .prog-name { text-transform: none; letter-spacing: 0; font-weight: 600; color: #111; font-size: 11px; }

  /* Meta */
  .meta-row { display: flex; gap: 10px; font-size: 10px; margin-bottom: 3px; }
  .meta-lbl { color: #888; width: 100px; flex-shrink: 0; }
  .meta-val { color: #111; font-weight: 600; }

  /* Credits */
  .credit-row { display: flex; align-items: baseline; gap: 8px; margin: 8px 0 12px; flex-wrap: wrap; }
  .credit-num  { font-size: 15px; font-weight: 800; }
  .credit-unit { font-size: 10px; font-weight: 400; color: #666; }
  .credit-sep  { font-size: 13px; color: #bbb; }
  .credit-pct  { font-size: 11px; font-weight: 700; color: #16a34a;
                 background: #dcfce7; border: 1px solid #86efac;
                 border-radius: 99px; padding: 1px 8px; margin-left: 4px; }

  /* NUPath grid */
  .np-grid  { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; margin-bottom: 6px; }
  .np-cell  { display: flex; align-items: center; gap: 5px; padding: 3px 6px;
              border: 1px solid #e0e0e0; border-radius: 4px; font-size: 9.5px; color: #999; }
  .np-cell.sat { border-color: #86efac; color: #4a8f63; }
  .np-check { font-size: 10px; width: 12px; flex-shrink: 0; color: #bbb; }
  .np-cell.sat .np-check { color: #4a8f63; }
  .np-key   { font-weight: 800; width: 22px; flex-shrink: 0; }
  .np-lbl   { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* Requirements */
  .sec         { margin-bottom: 5px; border: 1px solid #e8e8e8; border-radius: 5px; overflow: hidden; page-break-inside: avoid; }
  .sec-sat     { border-color: #bbf7d0; }
  .sec-head    { display: flex; align-items: center; gap: 6px; padding: 4px 8px;
                 background: #f8f8f8; }
  .sec-sat .sec-head { background: #f0faf4; }
  .sec-icon    { width: 13px; height: 13px; border-radius: 3px; display: inline-flex;
                 align-items: center; justify-content: center; font-size: 8px; font-weight: 900;
                 flex-shrink: 0; border: 1px solid #d0d0d0; color: #bbb; background: #fff; }
  .sec-sat .sec-icon { background: #dcfce7; border-color: #86efac; color: #16a34a; }
  .sec-title   { flex: 1; font-size: 10px; font-weight: 700; color: #444;
                 overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sec-sat .sec-title { color: #111; }
  .sec-prog    { font-size: 9px; color: #999; flex-shrink: 0; }
  .sec-bar     { height: 3px; background: #e5e5e5; }
  .sec-bar-fill { height: 100%; background: #f59e0b; border-radius: 0; }
  .sec-bar-sat  { background: #22c55e; }
  .sec-warn    { font-size: 9px; color: #b45309; padding: 3px 8px;
                 border-left: 2px solid #f59e0b; margin: 2px 0; }
  .sec-body    { padding: 5px 4px 4px; }
  .sec-note    { font-size: 9px; color: #999; font-style: italic; padding: 2px 4px; }

  /* Req course rows */
  .rc        { display: flex; align-items: center; gap: 5px; margin-bottom: 2px; }
  .rc-icon   { width: 12px; height: 12px; border-radius: 2px; display: inline-flex;
               align-items: center; justify-content: center; font-size: 8px; font-weight: 900;
               flex-shrink: 0; border: 1px solid #d8d8d8; color: #ccc; background: #fff; }
  .rc-icon-done    { background: #dcfce7; border-color: #86efac; color: #16a34a; }
  .rc-icon-planned { background: #dbeafe; border-color: #93c5fd; color: #2563eb; font-size: 9px; }
  .rc-icon-missing { background: #fff; border-color: #d8d8d8; color: #ccc; }
  .rc-lbl    { font-size: 10px; }
  .rc-done    .rc-lbl { color: #15803d; }
  .rc-planned .rc-lbl { color: #1d4ed8; }
  .rc-missing .rc-lbl { color: #999; }

  /* Req group rows */
  .rg        { margin-bottom: 3px; }
  .rg-head   { display: flex; align-items: center; gap: 5px; margin-bottom: 2px; }
  .rg-icon   { width: 12px; height: 12px; border-radius: 2px; display: inline-flex;
               align-items: center; justify-content: center; font-size: 8px; font-weight: 900;
               flex-shrink: 0; border: 1px solid #d8d8d8; color: #ccc; background: #fff; }
  .rg-sat .rg-icon   { background: #dcfce7; border-color: #86efac; color: #16a34a; }
  .rg-unsat .rg-icon { background: #fff; border-color: #d8d8d8; color: #ccc; }
  .rg-lbl    { font-size: 10px; font-weight: 600; color: #444; }
  .rg-sat   .rg-lbl   { color: #111; }
  .rg-unsat .rg-lbl   { color: #888; }

  /* Page break */
  .page-break { page-break-after: always; }

  /* Semester blocks */
  .sem-block  { margin-bottom: 16px; page-break-inside: avoid; }
  .sem-head   { display: flex; align-items: baseline; gap: 8px; margin-bottom: 5px; }
  .sem-label  { font-size: 13px; font-weight: 700; }
  .sem-sh     { font-size: 10px; color: #888; }
  .sem-block.done    .sem-label { color: #16a34a; }
  .sem-block.current .sem-label { color: #2563eb; }

  /* Course rows */
  .course-row { display: flex; align-items: center; gap: 8px;
                padding: 5px 8px; border: 1px solid #ececec;
                border-radius: 5px; margin-bottom: 3px; }
  .sem-block.done .course-row { background: #f9fffe; border-color: #d1fae5; }
  .pill  { font-size: 8.5px; font-weight: 800; border-radius: 3px; padding: 2px 6px;
           color: #fff; flex-shrink: 0;
           -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .ccode  { font-size: 11px; font-weight: 700; flex-shrink: 0; min-width: 72px; }
  .ctitle { font-size: 11px; flex: 1; color: #333; }
  .csh    { font-size: 10px; color: #888; flex-shrink: 0; }
  .np-badges { display: flex; gap: 2px; flex-shrink: 0; }
  .np-badge  { font-size: 8px; font-weight: 700; background: #f3f4f6;
               border: 1px solid #e0e0e0; border-radius: 3px; padding: 1px 4px; color: #666; }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head><body>

<!-- ── PAGE 1: Graduation summary ── -->
<h1>NU Map</h1>
<div class="date">Generated ${date}</div>

${metaLines ? `<div class="section-title">Program</div>${metaLines}` : ""}

<div class="section-title">Credits</div>
${creditHtml}

<div class="section-title">NUPath <span class="prog-name">(${npCovered.size}/${ALL_NP.length} fulfilled)</span></div>
<div class="np-grid">${npHtml}</div>

${reqHtml}

<div class="page-break"></div>

<!-- ── PAGE 2+: Semester schedule ── -->
<h1>NU Map: Course Schedule</h1>
<div class="date">Generated ${date}</div>
<br>
${semHtml}

</body></html>`;

  const w = window.open("", "_blank");
  if (!w) { alert("Pop-up blocked — please allow pop-ups for this site and try again."); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  // Close this tab automatically once the print dialog is dismissed.
  w.onafterprint = () => w.close();
  setTimeout(() => { w.print(); }, 400);
}

// ── Prereq display formatter ─────────────────────────────────────

/**
 * Turn a ninest prereq token array into a readable string.
 * Substitutes {subject,number} refs with their course codes.
 */
export function formatPrereqSummary(prereqs, courseMap) {
  if (!Array.isArray(prereqs) || prereqs.length === 0) return "—";
  try {
    const parts = prereqs.map(item => {
      if (typeof item === "string") return item;
      if (typeof item === "object" && item.subject && item.number) {
        const id = `${item.subject.toUpperCase()}${item.number}`;
        const c  = courseMap[id];
        return c ? c.code : `${item.subject} ${item.number}`;
      }
      if (Array.isArray(item)) return formatPrereqSummary(item, courseMap);
      return "";
    }).filter(Boolean);
    return parts.join(" ") || "—";
  } catch {
    return "—";
  }
}
