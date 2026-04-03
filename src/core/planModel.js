// ═══════════════════════════════════════════════════════════════════
// PLAN MODEL  (pure helpers over planner state — no React, no I/O)
// ═══════════════════════════════════════════════════════════════════
import { WORK_TERMS, INTERNSHIP_TERMS } from "./constants.js";
import { buildPlacedKeySet, allocateMajor } from "./gradRequirements.js";
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

const pdfFaviconUrl = domain => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;

const NP_LABELS = {
  ND:"Natural/Designed World", EI:"Creative Express/Innov",
  IC:"Interpreting Culture",   FQ:"Formal/Quant Reasoning",
  SI:"Societies/Institutions", AD:"Analyzing/Using Data",
  DD:"Difference/Diversity",   ER:"Ethical Reasoning",
  WF:"1st Yr Writing",         WD:"Adv Writing Disc",
  WI:"Writing Intensive",      EX:"Integration Experience",
  CE:"Capstone Experience",
};
const ALL_NP = Object.keys(NP_LABELS).filter(k => k !== "WF");

// ── Requirement tree → HTML ───────────────────────────────────────

function reqNodeHtml(r, doneKeys, depth = 0, dimmed = false) {
  const pl = depth * 12;
  if (r.type === "COURSE") {
    const isDimmed = dimmed && !r.sat;
    const status = r.sat ? (doneKeys.has(r.key) ? "done" : "planned") : isDimmed ? "dimmed" : "missing";
    const icon   = status === "done" ? "✓" : status === "planned" ? "○" : status === "dimmed" ? "╱" : "";
    return `<div class="rc rc-${status}" style="padding-left:${pl + 4}px${isDimmed ? ";opacity:0.4" : ""}">
      <span class="rc-icon rc-icon-${status}">${icon}</span>
      <span class="rc-lbl">${r.label}</span>
    </div>`;
  }
  if (r.type === "RANGE") {
    const isDimmed = dimmed && !r.sat;
    const status = r.sat ? "done" : isDimmed ? "dimmed" : "missing";
    const lbl    = r.sat
      ? r.matched.slice(0, 3).join(", ") + (r.matched.length > 3 ? ` +${r.matched.length - 3}` : "") + ` (${r.subject} range)`
      : r.label;
    return `<div class="rc rc-${status}" style="padding-left:${pl + 4}px${isDimmed ? ";opacity:0.4" : ""}">
      <span class="rc-icon rc-icon-${status}">${r.sat ? "✓" : isDimmed ? "╱" : ""}</span>
      <span class="rc-lbl">${lbl}</span>
    </div>`;
  }
  const isSat   = r.sat;
  const heading =
    r.type === "AND" ? `All of (${r.satCount ?? 0}/${r.total ?? 0})` :
    r.type === "OR"  ? `One of (${r.satCount ?? 0}/${r.total ?? 0})` :
    r.type === "XOM" ? `${r.satSh ?? 0}/${r.reqSh ?? 0} SH from elective pool` :
    r.title ?? r.label ?? "";
  // XOM and OR: dim unsatisfied children once parent is satisfied (same as app)
  const dimChildren = (r.type === "XOM" || r.type === "OR") && isSat;
  const childrenHtml = (r.children ?? []).map(c =>
    reqNodeHtml(c, doneKeys, depth + 1, dimChildren && !c.sat)
  ).join("");
  const groupDimmed = dimmed && !isSat;
  return `<div class="rg" style="padding-left:${pl}px${groupDimmed ? ";opacity:0.4" : ""}">
    <div class="rg-head rg-${isSat ? "sat" : "unsat"}">
      <span class="rg-icon">${isSat ? "✓" : groupDimmed ? "╱" : ""}</span>
      <span class="rg-lbl">${heading}</span>
    </div>
    ${childrenHtml}
  </div>`;
}

function sectionHtml(sec, doneKeys) {
  // Mirror SectionBlock's pool-structure logic exactly
  const isPoolStructure = sec.minRequired !== undefined && sec.minRequired < sec.total;
  const displaySatCount = isPoolStructure ? Math.min(sec.satCount, sec.minRequired) : sec.satCount;
  const displayTotal    = isPoolStructure ? sec.minRequired : sec.total;
  const pct             = displayTotal > 0 ? Math.round(displaySatCount / displayTotal * 100) : 0;
  const warnHtml  = (sec.warnings ?? []).map(w =>
    `<div class="sec-warn">⚠ ${w}</div>`).join("");
  const noteHtml  = isPoolStructure && sec.minRequired > 0
    ? `<div class="sec-note">Requires ${sec.minRequired} of ${sec.total}</div>` : "";
  return `<div class="sec${sec.sat ? " sec-sat" : ""}">
    <div class="sec-head">
      <span class="sec-icon">${sec.sat ? "✓" : ""}</span>
      <span class="sec-title">${sec.title}</span>
      <span class="sec-prog">${displaySatCount}/${displayTotal}</span>
    </div>
    <div class="sec-bar"><div class="sec-bar-fill${sec.sat ? " sec-bar-sat" : ""}" style="width:${pct}%"></div></div>
    ${warnHtml}
    <div class="sec-body">
      ${sec.children.map(r => reqNodeHtml(r, doneKeys, 0, isPoolStructure && !r.sat && sec.satCount >= sec.minRequired)).join("")}
      ${noteHtml}
    </div>
  </div>`;
}

/**
 * Async: opens a print-ready HTML page and triggers Save-as-PDF.
 * gradInfo: { majorPath, concLabel, minor1Path, minor2Path,
 *             npCovered (Set<string>), doneKeys (Set<string>), totalSHRequired }
 */
export async function exportReport(placements, courseMap, currentSemId, dynSems, dynSemIdx, gradInfo = {}, workPl = {}, internPl = {}) {
  const curIdx = dynSemIdx[currentSemId] ?? 0;
  const date   = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const {
    majorPath = "", concLabel = "", minor1Path = "", minor2Path = "",
    npCovered = new Set(), doneKeys = new Set(), totalSHRequired = 0,
    placedOut = new Set(), substitutions = [],
  } = gradInfo;

  // effectivePlacements: add virtual entries for substitution targets
  const effectivePlacements = substitutions.length === 0 ? placements : (() => {
    const ep = { ...placements };
    for (const { from, to } of substitutions) {
      if (placements[from]) ep[to] = placements[from];
    }
    return ep;
  })();

  // ── Load major + minors (async) ───────────────────────────────
  const [major, minor1, minor2] = await Promise.all([
    majorPath  ? loadMajor(majorPath).catch(() => null)  : null,
    minor1Path ? loadMinor(minor1Path).catch(() => null) : null,
    minor2Path ? loadMinor(minor2Path).catch(() => null) : null,
  ]);

  // Use major's totalCreditsRequired if caller didn't supply one
  const effectiveTotalSHRequired = totalSHRequired || (major?.totalCreditsRequired ?? 0);

  // ── Compute totals ────────────────────────────────────────────
  // ── Co-op maps ──────────────────────────────────────────────────
  const semNextMap = {};
  for (let i = 0; i < dynSems.length - 1; i++) {
    semNextMap[dynSems[i].id] = dynSems[i + 1].id;
  }
  const workStartMap = {};
  const workContMap  = {};
  Object.entries(workPl).forEach(([wid, data]) => {
    const { semId, duration } = data || {};
    if (!semId) return;
    workStartMap[semId] = wid;
    if (duration === 6) {
      const nxt = semNextMap[semId];
      if (nxt) workContMap[nxt] = wid;
    } else if (duration === 4) {
      // Only spans if placed on summer
      const sem = dynSems.find(s => s.id === semId);
      if (sem?.type === "summer") {
        const nxt = semNextMap[semId];
        if (nxt) workContMap[nxt] = wid;
      }
    }
  });
  const internStartMap = {};
  const internContMap  = {};
  Object.entries(internPl).forEach(([iid, { semId, duration }]) => {
    internStartMap[semId] = iid;
    if (duration === 4) {
      const sem = dynSems.find(s => s.id === semId);
      if (sem?.type === "summer") {
        const nxt = semNextMap[semId];
        if (nxt) internContMap[nxt] = iid;
      }
    }
  });
  let doneSH = 0, plannedSH = 0;
  const semRows = [];
  dynSems.forEach(sem => {
    const ids = Object.keys(placements).filter(id => placements[id] === sem.id && courseMap[id]);
    const hasWork      = !!workStartMap[sem.id];
    const hasCont      = !!workContMap[sem.id];
    const hasIntern    = !!internStartMap[sem.id];
    const hasInternCont = !!internContMap[sem.id];
    if (ids.length === 0 && !hasWork && !hasCont && !hasIntern && !hasInternCont) return;
    const isDone = (dynSemIdx[sem.id] ?? 99) < curIdx;
    const isCur  = sem.id === currentSemId;
    ids.forEach(id => {
      const sh = courseMap[id]?.sh ?? 0;
      if (isDone) doneSH += sh; else plannedSH += sh;
    });
    semRows.push({ sem, ids, isDone, isCur, hasWork, hasCont, hasIntern, hasInternCont });
  });

  // ── Requirements sections HTML ────────────────────────────────
  const placedSet = buildPlacedKeySet(effectivePlacements, placedOut, courseMap);

  function renderProgram(prog, doneKeysSet, headerLabel, name, showGeneralElectives = true) {
    if (!prog) return "";
    let sections = allocateMajor(prog, placedSet, courseMap);
    if (!showGeneralElectives) {
      sections = sections.filter(s => s.title !== "General Electives");
    }
    const sectionsHtml = sections.map(s => sectionHtml(s, doneKeysSet)).join("");
    return `<div class="section-title">${headerLabel}<span class="prog-name">${name}</span></div>
      ${sectionsHtml}`;
  }

  const reqHtml = [
    renderProgram(major,  doneKeys, "Major Requirements — ",   major?.name ?? "",  true),
    renderProgram(minor1, doneKeys, "Minor 1 Requirements — ", minor1?.name ?? "", false),
    renderProgram(minor2, doneKeys, "Minor 2 Requirements — ", minor2?.name ?? "", false),
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
  const semHtml = semRows.map(({ sem, ids, isDone, isCur, hasWork, hasCont, hasIntern, hasInternCont }) => {
    const semSH = ids.reduce((s, id) => s + (courseMap[id]?.sh ?? 0), 0);
    const tag   = isDone ? " done" : isCur ? " current" : "";

    // Co-op continuation row
    if (hasCont && !hasWork) {
      const contWorkId   = workContMap[sem.id];
      const contWorkData = workPl[contWorkId];
      const contItem     = contWorkData ? (WORK_TERMS.find(w => w.duration === contWorkData.duration) ?? WORK_TERMS[0]) : null;
      if (contItem) {
        const contCompany = contWorkData.company || "";
        const contRole    = contWorkData.subline  || "";
        return `<div class="sem-block${tag}">
          <div class="sem-head">
            <span class="sem-label">${sem.label}</span>
            <span class="sem-sh">${isDone ? "completed" : isCur ? "in progress" : ""}</span>
          </div>
          <div class="coop-row" style="border-color:#e0e0e0">
            <div class="coop-icon">${contWorkData.companyDomain ? `<img class="coop-logo" src="${pdfFaviconUrl(contWorkData.companyDomain)}" onerror="this.style.display='none'" />` : `<div class="coop-bar"></div>`}</div>
            <div style="flex:1">
              <div class="coop-title">${contItem.label} CONTINUES${contCompany ? `<span style="text-transform:none"> \u00b7 ${contCompany}</span>` : ""}</div>
              ${contRole ? `<div class="coop-role">${contRole}</div>` : ""}
              <div class="coop-sub">6-month block</div>
            </div>
          </div>
        </div>`;
      }
    }

    // Co-op start row
    if (hasWork) {
      const workId   = workStartMap[sem.id];
      const workData2 = workPl[workId];
      const workItem = workData2 ? (WORK_TERMS.find(w => w.duration === workData2.duration) ?? WORK_TERMS[0]) : null;
      if (workItem) {
        const nextSem  = dynSems.find(s => s.id === semNextMap[sem.id]);
        const company  = workData2.company  || "";
        const role     = workData2.subline  || "";
        return `<div class="sem-block${tag}">
          <div class="sem-head">
            <span class="sem-label">${sem.label}</span>
            <span class="sem-sh">${isDone ? "completed" : isCur ? "in progress" : ""}</span>
          </div>
          <div class="coop-row" style="border-color:#e0e0e0">
            <div class="coop-icon">${workData2.companyDomain ? `<img class="coop-logo" src="${pdfFaviconUrl(workData2.companyDomain)}" onerror="this.style.display='none'" />` : `<div class="coop-bar"></div>`}</div>
            <div style="flex:1">
              <div class="coop-title">${workItem.label}${company ? `<span style="text-transform:none"> \u00b7 ${company}</span>` : ""}</div>
              ${role ? `<div class="coop-role">${role}</div>` : ""}
              <div class="coop-sub">${nextSem ? `Spans into ${nextSem.label} \u00b7 6-month block` : "6-month block"}</div>
            </div>
          </div>
        </div>`;
      }
    }

    // Internship continuation row
    if (hasInternCont && !hasIntern) {
      const contInternId   = internContMap[sem.id];
      const contInternData = internPl[contInternId];
      const contInternTerm = contInternData ? (INTERNSHIP_TERMS.find(t => t.duration === contInternData.duration) ?? INTERNSHIP_TERMS[0]) : null;
      if (contInternTerm) {
        const contInternCompany = contInternData.company || "";
        const contInternRole    = contInternData.subline  || "";
        return `<div class="sem-block${tag}">
          <div class="sem-head">
            <span class="sem-label">${sem.label}</span>
            <span class="sem-sh">${isDone ? "completed" : isCur ? "in progress" : ""}</span>
          </div>
          <div class="coop-row" style="border-color:#e0e0e0">
            <div class="coop-icon">${contInternData.companyDomain ? `<img class="coop-logo" src="${pdfFaviconUrl(contInternData.companyDomain)}" onerror="this.style.display='none'" />` : `<div class="coop-bar"></div>`}</div>
            <div style="flex:1">
              <div class="coop-title" style="text-transform:none;letter-spacing:0.03em">Internship Continues${contInternCompany ? ` \u00b7 ${contInternCompany}` : ""}</div>
              ${contInternRole ? `<div class="coop-role">${contInternRole}</div>` : ""}
              <div class="coop-sub">4-month block</div>
            </div>
          </div>
        </div>`;
      }
    }

    // Internship start row
    if (hasIntern) {
      const internId   = internStartMap[sem.id];
      const internData = internPl[internId];
      const internTerm = internData ? (INTERNSHIP_TERMS.find(t => t.duration === internData.duration) ?? INTERNSHIP_TERMS[0]) : null;
      if (internTerm) {
        const nextSem = dynSems.find(s => s.id === semNextMap[sem.id]);
        const spansNext = internData.duration === 4 && nextSem && dynSems.find(s => s.id === sem.id)?.type === "summer";
        return `<div class="sem-block${tag}">
          <div class="sem-head">
            <span class="sem-label">${sem.label}</span>
            <span class="sem-sh">${isDone ? "completed" : isCur ? "in progress" : ""}</span>
          </div>
          <div class="coop-row" style="border-color:#e0e0e0">
            <div class="coop-icon">${internData.companyDomain ? `<img class="coop-logo" src="${pdfFaviconUrl(internData.companyDomain)}" onerror="this.style.display='none'" />` : `<div class="coop-bar"></div>`}</div>
            <div style="flex:1">
              <div class="coop-title" style="text-transform:none;letter-spacing:0.03em">Full-Time Internship${internData.company ? ` \u00b7 ${internData.company}` : ""}</div>
              ${internData.subline ? `<div class="coop-role">${internData.subline}</div>` : ""}
              <div class="coop-sub">${spansNext ? `Spans into ${nextSem.label} \u00b7 4-month block` : `${internData.duration}-month internship`}</div>
            </div>
          </div>
        </div>`;
      }
    }

    // Normal course semester
    const rows = ids.map(id => {
      const c = courseMap[id];
      if (!c) return "";
      const pill     = `<span class="pill" style="background:${c.color}">${c.subject ?? c.id}</span>`;
      const nuBadges = (c.nuPath ?? []).map(np => `<span class="np-badge">${np}</span>`).join("");
      return `<div class="course-row">
        ${pill}
        <span class="ccode">${c.code ?? c.id}</span>
        <span class="ctitle">${c.title ?? ""}</span>
        <span class="csh">${c.shMax ? `${c.sh}\u2013${c.shMax}` : c.sh} SH</span>
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

  // Build appendix of course descriptions
  const appendixHtml = [];
  if (Object.keys(placements).length > 0) {
    appendixHtml.push('<div class="page-break"></div>');
    appendixHtml.push('<div class="appendix-section">');
    appendixHtml.push('<h2>Course Descriptions</h2>');
    for (const id of Object.keys(placements)) {
      const c = courseMap[id];
      if (!c) continue;
      const desc = c.desc?.trim() || c.description?.trim() || 'No description available.';
        appendixHtml.push(`
        <div class="appendix-course">
          <div style="display: grid; grid-template-columns: 45px 85px 1fr auto; align-items: baseline; gap: 10px; margin-bottom: 4px;">
            <span class="pill" style="background:${c.color}; display: inline-block; width: 100%; text-align: center;">${c.subject}</span>
            <span class="ccode">${c.code}</span>
            <span class="ctitle">${c.title}</span>
            <span class="csh">${c.sh} SH</span>
          </div>
          <div class="appendix-course-description">${desc.replace(/\n/g, '<br>')}</div>
        </div>
      `);
    }
    appendixHtml.push('</div>');
  }

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
  .rc-icon-dimmed  { background: #f0f0f0; border-color: #999; color: #333; }
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
  .ccode {
    font-size: 11px;
    font-weight: 700;
    white-space: nowrap;   /* prevent code from wrapping */
  }
  .ctitle { font-size: 11px; flex: 1; color: #333; }
  .csh    { font-size: 10px; color: #888; flex-shrink: 0; }
  .np-badges { display: flex; gap: 2px; flex-shrink: 0; }
  .np-badge  { font-size: 8px; font-weight: 700; background: #f3f4f6;
               border: 1px solid #e0e0e0; border-radius: 3px; padding: 1px 4px; color: #666; }.coop-row  { display: flex; align-items: center; gap: 10px;
               padding: 10px 14px; border: 1.5px solid; border-radius: 6px;
               margin-top: 3px;
               -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .coop-icon  { width: 28px; display: flex; justify-content: center; align-self: stretch; flex-shrink: 0; }
  .coop-bar   { width: 4px; border-radius: 2px; align-self: stretch; min-height: 36px; background: #e0e0e0;
                -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .coop-logo  { width: 28px; height: 28px; object-fit: contain; align-self: center; }
  .coop-title { font-size: 12px; font-weight: 600; letter-spacing: 0.08em; color: #595959;
                text-transform: uppercase; font-family: "Inter", -apple-system, sans-serif; }
  .coop-sub   { font-size: 10px; color: #888; margin-top: 2px; }
  .coop-role  { font-size: 10px; color: #595959; margin-top: 1px; font-style: italic; }
  /* Appendix styles */
  .appendix-section {
    margin-top: 20px;
  }
  .appendix-section h2 {
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 0.05em;
    color: #444;
    border-bottom: 2px solid #e5e5e5;
    padding-bottom: 5px;
    margin-bottom: 15px;
  }
  .appendix-course {
    margin-bottom: 32px;
    page-break-inside: avoid;
  }
  .appendix-course-header {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 4px;
    flex-wrap: wrap;
  }
  .appendix-course-code {
    font-size: 12px;
    font-weight: 700;
    color: #111;
    background: #f0f0f0;
    padding: 2px 8px;
    border-radius: 4px;
  }
  .appendix-course-title {
    font-size: 12px;
    font-weight: 600;
    color: #333;
  }
  .appendix-course-credits {
    font-size: 11px;
    color: #888;
    background: #f5f5f5;
    padding: 2px 8px;
    border-radius: 4px;
  }
  .appendix-course-description {
    font-size: 11px;
    color: #555;
    line-height: 1.6;
    padding-left: 10px;
    border-left: 3px solid #e0e0e0;
  }
  .appendix-section .pill {
    font-size: 10px;
  }
  .appendix-section .ccode {
    font-size: 13px;
  }
  .appendix-section .ctitle {
    font-size: 13px;
  }
  .appendix-section .csh {
    font-size: 12px;
  }
  .appendix-section .appendix-course-description {
    font-size: 12px;
  }

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

${placedOut.size > 0 ? `
<div class="section-title">Placed Out <span class="prog-name">(satisfies prerequisites, no credit)</span></div>
<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">
${[...placedOut].map(id => {
  const c = courseMap[id];
  return c ? `<span style="font-size:10px;font-weight:700;background:#f3f4f6;border:1px solid #e0e0e0;border-radius:4px;padding:2px 7px">${c.code}</span>` : "";
}).filter(Boolean).join("\n")}
</div>` : ""}

${substitutions.length > 0 ? `
<div class="section-title">Substitutions <span class="prog-name">(course A placed, satisfies course B — credits count once)</span></div>
<div style="display:flex;flex-direction:column;gap:3px;margin-bottom:8px">
${substitutions.map(({ from, to }) => {
  const fc = courseMap[from];
  const tc = courseMap[to];
  if (!fc || !tc) return "";
  const placed = !!placements[from];
  return `<div style="display:flex;align-items:center;gap:6px;font-size:10px;${placed ? "" : "opacity:0.5"}">
    <span style="font-weight:700;color:#2563eb">${fc.code}</span>
    <span style="color:#888">→ satisfies</span>
    <span style="font-weight:700">${tc.code}</span>
    ${placed ? "" : '<span style="color:#b45309;font-size:9px">⚠ not placed</span>'}
  </div>`;
}).filter(Boolean).join("\n")}
</div>` : ""}

<div class="page-break"></div>

<!-- ── PAGE 2+: Semester schedule ── -->
<h1>NU Map: Course Schedule</h1>
<div class="date">Generated ${date}</div>
<br>
${semHtml}
${appendixHtml.join('\n')}

</body></html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url  = URL.createObjectURL(blob);
  const w    = window.open(url, "_blank");
  if (!w) { URL.revokeObjectURL(url); alert("Pop-up blocked — please allow pop-ups for this site and try again."); return; }
  w.focus();
  // Close this tab automatically once the print dialog is dismissed.
  w.onafterprint = () => { w.close(); URL.revokeObjectURL(url); };
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
