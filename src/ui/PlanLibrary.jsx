// PLAN LIBRARY — the Finder-style surface for organizing saved plans.
//
// Selection semantics differ from the header dropdown ON PURPOSE. The dropdown
// is a menu, so one click switches plans. This is a file manager, so one click
// SELECTS and a double-click opens — which is what lets ⌘-click and shift-click
// build a multi-selection without yanking the user into a different plan.
// The "Select" toggle survives only for touch, where there are no modifier keys.
//
// Everything structural (ancestry, cycles, the depth cap, search scope) lives in
// core/planFolders.js. This file owns interaction: selection, keyboard, drag
// targeting, and the confirmations that stand in front of an unrecoverable
// delete.
import { useState, useEffect, useMemo, useRef } from "react";
import { usePlanner }     from "../context/PlannerContext.jsx";
import { useLanguage }    from "../context/LanguageContext.jsx";
import { useInstitution } from "../context/InstitutionContext.jsx";
import PlanTree, { FolderIcon } from "./PlanTree.jsx";
import ContextMenu, { useLongPress } from "./ContextMenu.jsx";
import {
  flattenTree, buildSearchIndex, matchIds, moveTargets, planMove,
  topmostNodes, normalizeSearchText, MAX_DEPTH, SORT_MODES,
} from "../core/planFolders.js";

/** Spring-loaded folders: hover a closed folder mid-drag and it opens. */
const SPRING_MS = 700;
const TYPEAHEAD_MS = 700;

/**
 * Undo / redo, as a curved arrow doubling back on itself. Mirrored for redo so
 * the pair reads as one gesture in two directions.
 */
function TurnIcon({ size = 14, redo = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true"
      style={{ display: "block", transform: redo ? "scaleX(-1)" : "none" }}>
      <g fill="none" stroke="currentColor" strokeWidth="1.7"
        strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.6 6.2h6.6a3.6 3.6 0 0 1 0 7.2H5.4" />
        <path d="M5.8 2.8 2.4 6.2l3.4 3.4" />
      </g>
    </svg>
  );
}

/** "Out to the top level" — the one destination that isn't a folder. */
function UpIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true"
      style={{ display: "block", color: "var(--text-4)" }}>
      <path d="M7 11V4.2M7 3.4 4.1 6.3M7 3.4l2.9 2.9" fill="none" stroke="currentColor"
        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Drag a small badge rather than a snapshot of the whole row.
 *
 * The browser's default ghost is a translucent copy of the source element,
 * which for a plan row is a full-width tab that covers the very thing you are
 * trying to aim at — the gap between two rows. Where the drop will land is
 * already said by the insertion line and the folder highlight, so the ghost
 * only has to say WHAT is moving, and the icon says that in a fraction of the
 * area. Multi-select adds a count, since a bare icon cannot show that three
 * plans are coming along.
 *
 * The node has to be in the document for the browser to rasterise it, and has
 * to survive the current frame, so it is parked offscreen and removed on the
 * next tick rather than immediately.
 */
function setMinimalDragImage(e, row, count) {
  const icon = row.item?.type === "folder" || row.children ? "\u{1F4C1}" : "\u{1F4C4}";
  const el = document.createElement("div");
  el.textContent = count > 1 ? `${icon} ${count}` : icon;
  Object.assign(el.style, {
    position: "fixed", top: "-1000px", left: "-1000px",
    font: "14px system-ui, sans-serif", lineHeight: "20px",
    padding: "2px 6px", borderRadius: "6px",
    background: "var(--bg-2, #fff)", color: "var(--text-1, #1e293b)",
    border: "1px solid var(--border-1, #cbd5e1)",
    boxShadow: "0 2px 6px rgba(0,0,0,.18)", pointerEvents: "none",
  });
  document.body.appendChild(el);
  e.dataTransfer.setDragImage(el, 12, 12);
  setTimeout(() => el.remove(), 0);
}

export default function PlanLibrary() {
  const {
    showPlanLibrary, setShowPlanLibrary,
    plans, planTree, openFolders, toggleFolder, setFolderOpen,
    folderSort, setFolderSort, reorderNodes, orderedSiblings,
    activePlanId, switchPlan, renamePlan, setPlanStudent, duplicatePlan,
    exportLibraryJSON, exportLibraryZip, exportPlansFlat, importLibraryFiles,
    createFolder, renameFolder, createFolderWithNodes,
    moveNodesTo, deleteNodes, previewDelete,
    pushFolderHistory, undoFolders, redoFolders, folderCanUndo, folderCanRedo,
    setShowNewPlanModal, setNewPlanFolderId,
    isPhone,
  } = usePlanner();
  const { t, locale } = useLanguage();
  const { institution, majorRequirements } = useInstitution();

  const [query, setQuery]           = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [focusId, setFocusId]       = useState(null);
  const [editingId, setEditingId]   = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [menu, setMenu]             = useState(null);   // { x, y, row }
  const [moveMenu, setMoveMenu]     = useState(null);   // footer "Move to…"
  const [sortMenu, setSortMenu]     = useState(null);   // "Sort by" dropdown
  const [exportMenu, setExportMenu] = useState(null);   // { x, y, ids }
  const [assigning, setAssigning]   = useState(null);   // { ids, value } assign student
  const [pending, setPending]       = useState(null);   // delete confirmation
  const [notice, setNoticeRaw]      = useState("");
  const [noticeBad, setNoticeBad]   = useState(true);
  /**
   * Say something in the notice strip. Defaults to the ERROR tone, because
   * all but a handful of these are failures and a wrong default should be the
   * loud one, not the silent one.
   */
  const setNotice = (msg, bad = true) => { setNoticeRaw(msg); setNoticeBad(bad); };
  const [drag, setDrag]             = useState(null);   // { ids }
  // Reordering is only offered under manual sort: name and recency derive
  // position from the records, so a stored order would be invisible there.
  const manualOrder = folderSort === "manual";
  const [dropTargetId, setDropTargetId] = useState(null);
  const [dropVerdict, setDropVerdict]   = useState("ok");
  // Manual-order insertion point while dragging: { beforeId, afterId, parentId }.
  const [insertAt, setInsertAt] = useState(null);

  const cardRef     = useRef(null);
  const searchRef   = useRef(null);
  const fileRef     = useRef(null);
  const anchorIdx   = useRef(-1);
  const typeAhead   = useRef({ str: "", at: 0 });
  const spring      = useRef({ id: null, timer: null });

  // ── Derived data ────────────────────────────────────────────────
  // One localStorage read per plan per change — NOT per row per render, and
  // certainly not per keystroke, which is what the old header search did.
  // Gated on the panel being open because switchPlan stamps lastOpened, so an
  // ungated memo would re-read every slot on every plan switch.
  const labels = useMemo(() => {
    const out = new Map();
    if (!showPlanLibrary) return out;
    for (const p of plans) {
      try {
        const raw = localStorage.getItem(`${institution.storagePrefix}-plan-data-${p.id}`);
        const parts = (JSON.parse(raw || "{}").major || "").split("/");
        const folder = parts[parts.length - 2] || "";
        out.set(p.id, folder ? majorRequirements.fmtProgramLabel(folder) : "");
      } catch { out.set(p.id, ""); }
    }
    return out;
  }, [plans, showPlanLibrary, institution.storagePrefix, majorRequirements]);

  // Every advisor affordance is gated on this — the student column, the "Sort
  // by student" option, the roster. Nothing about advisees exists until a plan
  // actually carries one, exactly as the folder tree stays hidden until the
  // first folder exists. A student with three plans never meets the concept.
  const hasStudents = useMemo(() => plans.some(p => p.student), [plans]);

  // The distinct advisees already in use, with how many plans each holds.
  // Picking an existing name off the list is what stops one advisee turning
  // into "Jane Doe", "jane doe" and "Jane  Doe" — three groups that look like
  // one. Compared case/space-insensitively, but the FIRST spelling entered is
  // the one offered back, so the advisor's own capitalisation is preserved.
  const roster = useMemo(() => {
    const seen = new Map();
    for (const p of plans) {
      const s = (p.student ?? "").trim();
      if (!s) continue;
      const k = s.toLowerCase().replace(/\s+/g, " ");
      const hit = seen.get(k);
      if (hit) hit.count++;
      else seen.set(k, { name: s, count: 1 });
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, locale));
  }, [plans, locale]);

  // The roster filtered by what has been typed. Uses the SAME normalizer the
  // library search uses, so "jose" finds "José" here exactly as it does there
  // — an advisor should not have to reproduce an accent to find their advisee.
  const assignMatches = useMemo(() => {
    if (!assigning) return [];
    const q = normalizeSearchText(assigning.value);
    if (!q) return roster;
    return roster.filter(r => normalizeSearchText(r.name).includes(q));
  }, [assigning, roster]);

  // Is what has been typed already an advisee, or would committing invent a
  // new one? Drives the "new student" hint, so an advisor can SEE that a near
  // miss ("Jane Doe " vs "Jane Doe") is about to create a second group.
  const assignIsNew = useMemo(() => {
    const v = normalizeSearchText(assigning?.value ?? "");
    return !!v && !roster.some(r => normalizeSearchText(r.name) === v);
  }, [assigning, roster]);

  const searchIndex = useMemo(
    () => buildSearchIndex(planTree, { slotLabel: id => labels.get(id) ?? "" }),
    [planTree, labels]
  );
  const matches = useMemo(() => matchIds(searchIndex, query), [searchIndex, query]);
  const rows = useMemo(
    () => flattenTree(planTree, { open: openFolders, sortMode: folderSort, matches, locale }),
    [planTree, openFolders, folderSort, matches, locale]
  );
  const rowIdx = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);
  const folderCount = planTree.folders.length;

  // ── Lifecycle ───────────────────────────────────────────────────
  useEffect(() => {
    if (showPlanLibrary) {
      setTimeout(() => cardRef.current?.focus(), 0);
      return;
    }
    setQuery(""); setSelectedIds(new Set()); setFocusId(null); setEditingId(null);
    setMenu(null); setMoveMenu(null); setSortMenu(null); setExportMenu(null); setAssigning(null);
    setPending(null); setNotice(""); setSelectMode(false);
    clearDrag();
    anchorIdx.current = -1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPlanLibrary]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 3200);
    return () => clearTimeout(id);
  }, [notice]);

  // Drop anything that vanished (deleted elsewhere, or filtered out).
  useEffect(() => {
    setSelectedIds(prev => {
      const next = new Set([...prev].filter(id => planTree.byId.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [planTree]);

  // ── Actions ─────────────────────────────────────────────────────
  const close = () => setShowPlanLibrary(false);

  const openRow = (row) => {
    if (row.kind === "folder") { toggleFolder(row.id); return; }
    switchPlan(row.id);
    close();
  };

  const parentFor = (row) =>
    row.kind === "folder" ? row.id : (planTree.parentOf.get(row.id) ?? null);

  /**
   * Which third of a row the cursor is in, as an insertion point.
   *
   * Top/bottom quarter → between rows; the middle half stays "into this
   * folder". Plans get a wider band (top/bottom half) because they have no
   * "into" meaning at all, so every pixel of a plan row is an insertion.
   *
   * Returns null when the cursor means "into", or when the drag would place a
   * node relative to itself (a no-op that should show no line).
   */
  const edgeZone = (row, e) => {
    const box = e.currentTarget?.getBoundingClientRect?.();
    if (!box || !box.height) return null;
    if (drag?.ids?.includes(row.id)) return null;
    const frac = (e.clientY - box.top) / box.height;
    const band = row.kind === "folder" ? 0.25 : 0.5;
    const parentId = row.item.parentId ?? null;
    if (frac <= band) return { beforeId: row.id, afterId: null, parentId };
    if (frac >= 1 - band) {
      // "After this row" is "before its next sibling", or the end of the list.
      const sibs = orderedSiblings(parentId, row.kind);
      const i = sibs.findIndex((r) => r.id === row.id);
      const next = i === -1 ? null : sibs[i + 1];
      return { beforeId: next?.id ?? null, afterId: row.id, parentId };
    }
    return null;
  };

  const commitReorder = (ids, at) => {
    const res = reorderNodes(ids, at.parentId, at.beforeId);
    clearDrag();
    if (!res.ok && res.reason !== "noop") {
      setNotice(t(`folders.move.err.${res.reason}`, { max: MAX_DEPTH }));
    }
    return res;
  };

  const commitMove = (ids, targetId) => {
    const res = moveNodesTo(ids, targetId);
    clearDrag();
    if (!res.ok && res.reason !== "noop") {
      setNotice(t(`folders.move.err.${res.reason}`, { max: MAX_DEPTH }));
    }
    return res;
  };

  const newFolder = (parentId = null) => {
    const id = createFolder(t("folders.newName"), parentId);
    if (!id) { setNotice(t("folders.move.err.depth", { max: MAX_DEPTH })); return; }
    // Straight into rename with the name selected, the way Finder does.
    setSelectedIds(new Set([id]));
    setFocusId(id);
    setEditingId(id);
  };

  /**
   * The one rule every "new folder" entry point uses: several rows selected
   * means "put these inside a new folder", anything else means "make an empty
   * folder here". Shared so the ⇧⌘N shortcut, the header + button and the
   * context menu cannot disagree about it.
   */
  const newFolderSmart = (parentId = null) => {
    if (selectedIds.size > 1) { newFolderWith([...selectedIds]); return; }
    newFolder(parentId);
  };

  const newFolderWith = (ids) => {
    const res = createFolderWithNodes(ids, t("folders.newName"));
    if (!res.ok) { setNotice(t(`folders.move.err.${res.reason}`, { max: MAX_DEPTH })); return; }
    setSelectedIds(new Set([res.id]));
    setFocusId(res.id);
    setEditingId(res.id);
  };

  const newPlanIn = (parentId) => {
    setNewPlanFolderId(parentId ?? null);
    setShowNewPlanModal(true);
    close();
  };

  /**
   * Open the assign-student field for a set of plans.
   *
   * Folders are dropped rather than rejected: a folder has no advisee of its
   * own, and a selection that mixes the two is ordinary (⌘-click down a list).
   * Seeded with the common current value so re-assigning shows what is there
   * now, and blank when the selection disagrees — which is the honest reading,
   * since committing would overwrite all of them.
   */
  const requestAssign = (ids) => {
    const planIds = ids.filter(id => !planTree.folderIds.has(id) && planTree.byId.has(id));
    if (!planIds.length) return;
    const values = new Set(planIds.map(id => planTree.byId.get(id).student ?? ""));
    setAssigning({ ids: planIds, value: values.size === 1 ? [...values][0] : "", hi: -1 });
  };

  /**
   * @param {string} [explicit] name to assign, when it comes from clicking a
   *   roster row rather than from the field. Picking an existing advisee is
   *   ONE click — the whole point of the list — so it commits directly instead
   *   of filling the field and waiting for the button.
   */
  const commitAssign = (explicit) => {
    if (!assigning) return;
    const value = explicit !== undefined ? explicit : assigning.value;
    pushFolderHistory();          // one ⌘Z undoes the whole batch
    for (const id of assigning.ids) setPlanStudent(id, value);
    setAssigning(null);
  };

  /**
   * Export the selection, or the whole library when `ids` is null. Folders
   * come out with everything inside them — the selection's closure, the same
   * set a delete would take.
   *
   * Two shapes, because they answer different questions. The document is
   * EXACT: it round-trips names a file system cannot spell. The archive is
   * BROWSABLE: folders become directories and every entry opens with the
   * ordinary Load, at the cost of names being bent into filenames.
   */
  /**
   * `shape` is 'files' (default), 'zip', or 'bundle'.
   *
   * 'files' writes one ordinary plan file per plan, which is the inverse of
   * how they come back in — select them all in the file dialog and Import
   * loads the lot. The other two exist for the one thing flat files cannot
   * do, which is carry the folder tree.
   */
  /**
   * SYNCHRONOUS on purpose — see `exportPlansFlat`. Any `await` before the
   * downloads spends the click's user activation and the browser then drops
   * them, which is the bug that made exporting several plans fail while Save
   * JSON always worked.
   */
  const doExport = (ids, shape = "files") => {
    setExportMenu(null);
    if (shape === "zip")    { setNotice(t("folders.io.exported", { n: exportLibraryZip(ids).plans }), false); return; }
    if (shape === "bundle") { setNotice(t("folders.io.exported", { n: exportLibraryJSON(ids).plans }), false); return; }

    const res = exportPlansFlat(ids);
    if (!res.ok) {
      setNotice(t(res.reason === "empty" ? "folders.io.err.noplans" : "folders.io.err.write"));
      return;
    }
    setNotice(t(res.plans === 1 ? "folders.io.exportedOne" : "folders.io.exportedFiles",
      { n: res.plans }), false);
  };

  const exportMenuItems = (ids) => [
    { key: "files",  label: t("folders.io.asFiles"),  onSelect: () => doExport(ids, "files") },
    { key: "zip",    label: t("folders.io.asZip"),    onSelect: () => doExport(ids, "zip") },
    { key: "bundle", label: t("folders.io.asJson"),   onSelect: () => doExport(ids, "bundle") },
  ];

  const doImport = async (files) => {
    if (!files?.length) return;
    const res = await importLibraryFiles(files, t("folders.io.importedFolder", {
      date: new Date().toISOString().slice(0, 10),
    }));
    if (!res.ok) { setNotice(t(`folders.io.err.${res.reason}`)); return; }
    // A partial import is reported rather than passed off as a clean one: with
    // forty files selected, two unreadable ones would otherwise vanish.
    const base = res.atRoot
      ? t("folders.io.importedRoot", { n: res.plans })
      : t("folders.io.imported", { n: res.plans });
    setNotice(res.failed ? `${base} ${t("folders.io.someFailed", { n: res.failed })}` : base,
      !!res.failed);
  };

  /**
   * Copy every plan in the selection. Folders are skipped rather than
   * refused — a mixed selection is ordinary, and duplicating a whole folder
   * tree is a different act with different questions (does it copy the
   * folder too? where does it go?) that this menu item should not silently
   * decide.
   */
  const doDuplicate = (ids) => {
    const planIds = ids.filter(id => !planTree.folderIds.has(id) && planTree.byId.has(id));
    if (!planIds.length) return;
    const made = [];
    for (const id of planIds) {
      const res = duplicatePlan(id);
      if (!res.ok) { setNotice(t(`folders.io.err.${res.reason}`)); break; }
      made.push(res.id);
    }
    if (!made.length) return;
    // Land on the copies, so the next act (rename, drag, open) needs no
    // hunting for where they went.
    setSelectedIds(new Set(made));
    setFocusId(made[0]);
    if (made.length === 1) setEditingId(made[0]);
  };

  const requestDelete = (ids) => {
    if (!ids.length) return;
    const pv = previewDelete(ids);
    if (pv.blocked) { setNotice(t("folders.delete.err.last")); return; }
    const single = pv.targets.length === 1 ? planTree.byId.get(pv.targets[0]) : null;
    setPending({ ids, ...pv, name: single?.name ?? "" });
  };

  // Plural-correct count phrases, composed rather than interpolated: "1 plans"
  // is wrong in en/es/fr, and the single-plan delete is the common case.
  const nPlans   = n => t(n === 1 ? "folders.n.plan"   : "folders.n.plans",   { n });
  const nFolders = n => t(n === 1 ? "folders.n.folder" : "folders.n.folders", { n });
  const joinCounts = (planN, folderN) => {
    const parts = [];
    if (planN > 0) parts.push(nPlans(planN));
    if (folderN > 0) parts.push(nFolders(folderN));
    if (parts.length === 0) return "";
    return parts.length === 1 ? parts[0] : t("folders.and", { a: parts[0], b: parts[1] });
  };

  const confirmDelete = () => {
    if (!pending) return;
    const res = deleteNodes(pending.ids);
    setPending(null);
    if (!res.ok) { setNotice(t("folders.delete.err.last")); return; }
    setSelectedIds(new Set());
    setFocusId(null);
  };

  const commitName = (id, name) => {
    const clean = (name ?? "").trim();
    setEditingId(null);
    if (!clean || clean === planTree.byId.get(id)?.name) return;
    if (planTree.folderIds.has(id)) {
      renameFolder(id, clean);          // snapshots itself
    } else {
      pushFolderHistory();              // renamePlan is shared with the header
      renamePlan(id, clean);
    }
  };

  // ── Selection ───────────────────────────────────────────────────
  const selectRange = (fromIdx, toIdx, additive) => {
    const from = Math.min(fromIdx, toIdx);
    const to   = Math.max(fromIdx, toIdx);
    const next = new Set(additive ? selectedIds : []);
    for (let i = from; i <= to; i++) if (rows[i]) next.add(rows[i].id);
    setSelectedIds(next);
  };

  const onRowClick = (row, e) => {
    const idx = rowIdx.get(row.id) ?? 0;
    // On touch there are no modifier keys, so Select mode stands in for ⌘.
    const additive = e.metaKey || e.ctrlKey || selectMode;
    if (e.shiftKey && anchorIdx.current >= 0) {
      // Ranges run over the FLATTENED rows, so a range legitimately spans
      // folder boundaries — same as Finder's list view.
      selectRange(anchorIdx.current, idx, additive);
    } else if (additive) {
      const next = new Set(selectedIds);
      next.has(row.id) ? next.delete(row.id) : next.add(row.id);
      setSelectedIds(next);
      anchorIdx.current = idx;
    } else {
      setSelectedIds(new Set([row.id]));
      anchorIdx.current = idx;
    }
    setFocusId(row.id);
  };

  // ── Keyboard ────────────────────────────────────────────────────
  const moveFocus = (delta, extend) => {
    if (!rows.length) return;
    const cur = focusId != null ? (rowIdx.get(focusId) ?? -1) : -1;
    const next = Math.max(0, Math.min(rows.length - 1, cur + delta));
    const row = rows[next];
    if (!row) return;
    setFocusId(row.id);
    if (extend && anchorIdx.current >= 0) selectRange(anchorIdx.current, next, false);
    else { setSelectedIds(new Set([row.id])); anchorIdx.current = next; }
  };

  const handleEnter = () => {
    // With a query live, Enter is the fast path: type three letters, Enter,
    // you're in the plan. That beats rename, which is Enter's Finder meaning.
    if (query) {
      const target = selectedIds.size === 1
        ? rows.find(r => r.id === [...selectedIds][0])
        : rows.find(r => r.kind === "plan");
      if (target) openRow(target);
      return;
    }
    if (selectedIds.size !== 1) return;
    const id = [...selectedIds][0];
    if (planTree.byId.has(id)) setEditingId(id);
  };

  const typeAheadJump = (ch) => {
    const now = Date.now();
    const ref = typeAhead.current;
    ref.str = now - ref.at > TYPEAHEAD_MS ? ch : ref.str + ch;
    ref.at = now;
    const needle = ref.str.toLowerCase();
    const hit = rows.find(r => (r.item.name ?? "").toLowerCase().startsWith(needle));
    if (!hit) return;
    setSelectedIds(new Set([hit.id]));
    setFocusId(hit.id);
    anchorIdx.current = rowIdx.get(hit.id) ?? -1;
  };

  useEffect(() => {
    if (!showPlanLibrary) return;
    const onKey = (e) => {
      if (editingId) return;              // the rename field owns the keyboard
      if (assigning) return;              // ditto the assign-student field
      // A context menu owns Escape while it is open, or dismissing the menu
      // would close the whole panel out from under it.
      if (menu || moveMenu || sortMenu || exportMenu) return;
      if (pending) {
        if (e.key === "Escape") { e.preventDefault(); setPending(null); }
        if (e.key === "Enter")  { e.preventDefault(); confirmDelete(); }
        return;
      }
      const inSearch = e.target === searchRef.current;

      // ⌘Z / ⇧⌘Z belong to the LIBRARY while it is open, never to the course
      // timeline underneath — undoing a folder move must not silently unplace a
      // course. stopImmediatePropagation is what takes the key away from the
      // global handler in PlannerContext; same technique InfoPanel uses to
      // claim ⌘Z while it owns the keyboard. Only these keys are claimed, so
      // ordinary typing still reaches the fields.
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key.toLowerCase() === "z" || e.key.toLowerCase() === "y")) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        const redo = e.key.toLowerCase() === "y" || e.shiftKey;
        const moved = redo ? redoFolders() : undoFolders();
        if (!moved) setNotice(t(redo ? "folders.redo.none" : "folders.undo.none"));
        else { setEditingId(null); setSelectedIds(new Set()); setFocusId(null); }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault(); e.stopPropagation();
        if (query) { setQuery(""); return; }   // clear the filter before closing
        close();
        return;
      }
      // Select all — the only way to act on the whole library now that Export
      // is scoped to a selection. Takes the VISIBLE rows, so with a search
      // live it selects the matches, which is what "all" means on a filtered
      // list and makes "export everyone named Chen" two keystrokes.
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIds(new Set(rows.map(r => r.id)));
        anchorIdx.current = 0;
        return;
      }
      if (e.key === "Enter")      { e.preventDefault(); handleEnter(); return; }
      // F2 is rename everywhere outside macOS, and unlike Enter it means only
      // that — Enter has to double as "open the search hit", so on a filtered
      // list it is not available for renaming at all.
      if (e.key === "F2") {
        e.preventDefault();
        const id = selectedIds.size === 1 ? [...selectedIds][0] : focusId;
        if (id && planTree.byId.has(id)) { setSelectedIds(new Set([id])); setEditingId(id); }
        return;
      }
      if (e.key === "ArrowDown")  { e.preventDefault(); moveFocus(1, e.shiftKey); return; }
      if (e.key === "ArrowUp")    { e.preventDefault(); moveFocus(-1, e.shiftKey); return; }
      if (e.key.toLowerCase() === "n" && e.shiftKey && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const sel = focusId ? rows.find(r => r.id === focusId) : null;
        newFolderSmart(sel ? parentFor(sel) : null);
        return;
      }
      if (inSearch) return;               // every remaining key is typing

      const row = focusId ? rows.find(r => r.id === focusId) : null;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (row?.kind === "folder" && row.hasChildren && !row.open) setFolderOpen(row.id, true);
        else moveFocus(1, false);
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (row?.kind === "folder" && row.open) { setFolderOpen(row.id, false); return; }
        // Finder: ← on a leaf jumps to the enclosing folder.
        const parent = row ? planTree.parentOf.get(row.id) ?? null : null;
        if (parent && rowIdx.has(parent)) {
          setFocusId(parent);
          setSelectedIds(new Set([parent]));
          anchorIdx.current = rowIdx.get(parent);
        }
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        requestDelete([...selectedIds]);
        return;
      }
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) typeAheadJump(e.key);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPlanLibrary, editingId, pending, menu, moveMenu, sortMenu, exportMenu, assigning, query, rows, focusId,
      selectedIds, openFolders, folderCanUndo, folderCanRedo]);

  // ── Drag and drop ───────────────────────────────────────────────
  function clearDrag() {
    setInsertAt(null);
    setDrag(null); setDropTargetId(null); setDropVerdict("ok");
    if (spring.current.timer) clearTimeout(spring.current.timer);
    spring.current = { id: null, timer: null };
  }

  const armSpring = (id) => {
    if (spring.current.id === id) return;
    if (spring.current.timer) clearTimeout(spring.current.timer);
    spring.current = { id, timer: setTimeout(() => setFolderOpen(id, true), SPRING_MS) };
  };

  const dnd = {
    onDragStart: (row, e) => {
      // Dragging an unselected row replaces the selection, as Finder does.
      const ids = selectedIds.has(row.id) ? [...selectedIds] : [row.id];
      try {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", row.item.name ?? "");
        setMinimalDragImage(e, row, ids.length);
      } catch {}
      // Deferred for the same reason PlannerContext's course onDragStart defers
      // its own setState: a synchronous state set inside `dragstart` re-renders
      // the source node and the browser aborts the drag.
      requestAnimationFrame(() => {
        if (!selectedIds.has(row.id)) {
          setSelectedIds(new Set([row.id]));
          anchorIdx.current = rowIdx.get(row.id) ?? -1;
        }
        setDrag({ ids });
      });
    },
    onDragOver: (row, e) => {
      if (!drag) return;
      e.stopPropagation();               // the root zone must not also claim it

      // Under manual order the row's EDGES mean "put it between these two" and
      // only a folder's middle still means "put it inside". Without the edge
      // band there would be no gesture for reordering at all, since a plan is
      // not a container; with it, the two intents stay distinguishable because
      // the insertion line and the folder highlight never appear together.
      const zone = manualOrder ? edgeZone(row, e) : null;
      if (zone) {
        e.preventDefault();
        try { e.dataTransfer.dropEffect = "move"; } catch {}
        setDropTargetId(null);
        setInsertAt(zone);
        return;
      }
      setInsertAt(null);

      if (row.kind !== "folder") {
        // A plan is not a container. Refusing here beats quietly rerouting the
        // drop to its parent, which would land things the user didn't aim at.
        setDropTargetId(null);
        try { e.dataTransfer.dropEffect = "none"; } catch {}
        return;
      }
      e.preventDefault();
      const v = planMove(planTree, drag.ids, row.id);
      try { e.dataTransfer.dropEffect = v.ok ? "move" : "none"; } catch {}
      setDropTargetId(row.id);
      setDropVerdict(v.ok ? "ok" : v.reason);
      if (v.ok && !row.open && row.hasChildren) armSpring(row.id);
    },
    onDragLeave: (row) => {
      if (dropTargetId === row.id) setDropTargetId(null);
    },
    onDrop: (row, e) => {
      e.preventDefault(); e.stopPropagation();
      if (!drag) { clearDrag(); return; }
      if (insertAt) { commitReorder(drag.ids, insertAt); return; }
      if (row.kind !== "folder") { clearDrag(); return; }
      commitMove(drag.ids, row.id);
    },
  };

  // A drag released outside any target fires no drop, so hover state and the
  // root strip would linger. Mirrors the global dragend cleanup in
  // PlannerContext for course cards.
  useEffect(() => {
    if (!drag) return;
    const onEnd = () => clearDrag();
    window.addEventListener("dragend", onEnd);
    window.addEventListener("drop", onEnd);
    return () => {
      window.removeEventListener("dragend", onEnd);
      window.removeEventListener("drop", onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag]);

  const longPress = useLongPress(({ x, y }) => {
    const el = document.elementFromPoint(x, y)?.closest?.("[data-tree-id]");
    const id = el?.getAttribute("data-tree-id");
    const row = id ? rows.find(r => r.id === id) : null;
    if (row) { setFocusId(row.id); setMenu({ x, y, row }); }
  });

  // ── Menus ───────────────────────────────────────────────────────
  const menuItemsFor = (row) => {
    const ids = selectedIds.has(row.id) && selectedIds.size > 1 ? [...selectedIds] : [row.id];
    const n = ids.length;
    const targets = moveTargets(planTree, ids, { locale });
    const rootBlocked = !planMove(planTree, ids, null).ok;
    return [
      {
        key: "open",
        label: row.kind === "folder"
          ? t(row.open ? "folders.collapse" : "folders.expand")
          : t("folders.menu.open"),
        onSelect: () => openRow(row),
      },
      { key: "rename", label: t("folders.menu.rename"), hint: "↵ / F2", disabled: n > 1,
        onSelect: () => setEditingId(row.id) },
      // Only where there is a plan to copy — a folder has no duplicate verb
      // here, so on a pure-folder selection this would be a dead item.
      ...(ids.some(id => !planTree.folderIds.has(id)) ? [{
        key: "duplicate",
        label: t("folders.menu.duplicate"),
        onSelect: () => doDuplicate(ids),
      }] : []),
      // Only where there is a plan to assign — a folder has no advisee of its
      // own, so offering it on a pure-folder selection would be a dead item.
      ...(ids.some(id => !planTree.folderIds.has(id)) ? [{
        key: "assign",
        label: t("folders.menu.assignStudent"),
        onSelect: () => requestAssign(ids),
      }] : []),
      { divider: true },
      // ONE item, not two. "New folder" and "New folder with selection" sat
      // next to each other and the difference was invisible: with something
      // selected, the first silently made an EMPTY folder beside it, which is
      // never what was meant. So the selection decides — with rows selected it
      // wraps them, and the hint says which, so nothing is hidden.
      // `ids` always holds at least the right-clicked row, so the test is
      // whether it is a real MULTI-selection — one row is "put a folder here",
      // several is "put these in a folder".
      { key: "newFolder",
        label: t("folders.menu.newFolder"),
        hint: ids.length > 1
          ? joinCounts(
              ids.filter(id => !planTree.folderIds.has(id)).length,
              ids.filter(id => planTree.folderIds.has(id)).length)
          : "⇧⌘N",
        onSelect: () => (ids.length > 1 ? newFolderWith(ids) : newFolder(parentFor(row))) },
      { key: "newPlan", label: t("folders.menu.newPlanHere"),
        onSelect: () => newPlanIn(parentFor(row)) },
      { divider: true },
      // A folder exports everything inside it; a plan exports itself. Both go
      // through the same closure, so the menu needs no separate wording.
      { key: "export", label: t("folders.io.export"),
        submenu: exportMenuItems(ids).map(i => ({ ...i, depth: 0 })) },
      {
        key: "move", label: t("folders.menu.moveTo"),
        emptyLabel: t("folders.menu.noFolders"),
        submenu: [
          { key: "__root", label: t("folders.root"), icon: <UpIcon />, depth: 0,
            disabled: rootBlocked, onSelect: () => commitMove(ids, null) },
          ...targets.map(tg => ({
            key: tg.id, label: tg.name, depth: tg.depth + 1, icon: <FolderIcon size={12} />,
            disabled: tg.disabled, onSelect: () => commitMove(ids, tg.id),
          })),
        ],
      },
      { divider: true },
      // The count is the NORMALIZED one, so the menu can't promise "5 items"
      // and then hand the confirmation dialog 3 — a selection holding a folder
      // and its contents deletes as the folder alone.
      { key: "delete", danger: true, hint: "⌫",
        label: (() => {
          const top = topmostNodes(planTree, ids).length;
          return top > 1 ? t("folders.menu.deleteN", { n: top }) : t("folders.menu.delete");
        })(),
        onSelect: () => requestDelete(ids) },
    ];
  };

  // "By student" appears only once some plan HAS a student — an ordinary
  // student never sees a sort mode that would do nothing for them.
  const sortMenuItems = () =>
    // Derived from core's SORT_MODES rather than relisted here: a mode this
    // menu offers but PlannerContext won't persist is chosen, used, and then
    // silently lost on reload, which is exactly what happened to 'student'.
    SORT_MODES
      .filter(mode => mode !== "student" || hasStudents)
      .map(mode => ({
        key: mode,
        label: t(`folders.sort.${mode}`),
        hint: folderSort === mode ? "✓" : undefined,
        onSelect: () => setFolderSort(mode),
      }));

  const footerMoveItems = () => {
    const ids = [...selectedIds];
    const targets = moveTargets(planTree, ids, { locale });
    return [
      { key: "__root", label: t("folders.root"), indent: 0,
        disabled: !planMove(planTree, ids, null).ok, onSelect: () => commitMove(ids, null) },
      ...targets.map(tg => ({
        key: tg.id, label: tg.name, indent: tg.depth + 1,
        disabled: tg.disabled, onSelect: () => commitMove(ids, tg.id),
      })),
    ];
  };

  if (!showPlanLibrary) return null;

  // ── Render ──────────────────────────────────────────────────────
  const metaOf = (row) => {
    if (row.kind === "folder") {
      if (matches) return t("folders.meta.matched", { n: row.matched ?? 0, total: row.counts.plans });
      return row.counts.plans > 0 ? String(row.counts.plans) : "";
    }
    // Plan rows carry their major and student as COLUMNS (see `planCells`),
    // so nothing is left for the single meta slot.
    return "";
  };

  /**
   * The two trailing columns on a plan row: major, then student.
   *
   * They used to be one run of text — "Jane Doe · Computer Science" — appended
   * after a name column that took whatever width was left, so both values
   * started at a different x on every row and neither could be read DOWN the
   * list. Scanning a caseload for one advisee is the thing an advisor does
   * most, and a ragged column is the one layout that makes it impossible.
   *
   * The student is the stronger of the two because it answers "whose plan is
   * this", which outranks "what do they study" the moment a plan has an
   * advisee at all. Both columns disappear when no plan has a student, so a
   * lone student never meets a half-empty roster layout.
   */
  const planCells = (row) => [
    // Student first, then major on the far right. The major is the column
    // that is ALWAYS populated, so putting it at the edge gives the row a
    // straight right margin down the whole list; the student, which is often
    // blank, sits inboard where a gap does not leave a ragged edge. Reversing
    // these two put the ragged column on the outside, which is what makes a
    // list look broken.
    { text: row.item.student ?? "", share: "22%", strong: true },
    { text: labels.get(row.id) ?? "", share: "24%" },
  ];

  // Does any plan being assigned currently HAVE a student? An empty field means
  // "clear" only if there is something to clear; on a plan with no student yet
  // it means nothing at all, and a button reading "Clear" there looks
  // destructive while in fact doing nothing.
  const assignHadValue = !!assigning &&
    assigning.ids.some(id => (planTree.byId.get(id)?.student ?? "") !== "");

  const iconBtn = {
    background: "var(--bg-surface-2)", border: "1px solid var(--border-2)",
    borderRadius: 6, cursor: "pointer", color: "var(--text-3)",
    fontSize: 11, padding: isPhone ? "5px 7px" : "6px 10px", fontFamily: "inherit",
    display: "inline-flex", alignItems: "center", gap: isPhone ? 3 : 5,
    lineHeight: 1, flexShrink: 0,
  };

  return (
    <div
      onClick={() => {
        // Portalled menus propagate through the REACT tree, so a click meant to
        // dismiss a menu would otherwise close the whole panel behind it.
        if (menu || moveMenu || sortMenu || exportMenu) { setMenu(null); setMoveMenu(null); setSortMenu(null); setExportMenu(null); return; }
        close();
      }}
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background: "rgba(0,0,0,0.55)", display: "flex",
        alignItems: "center", justifyContent: "center",
        // A file manager is a working surface, not a dialog — it wants height.
        padding: isPhone ? 0 : "22px 20px",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-library-title"
        onClick={e => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 720, background: "var(--bg-app)",
          border: "1px solid var(--border-2)", borderRadius: isPhone ? 0 : 14,
          boxShadow: "var(--shadow-modal)",
          // Fixed tall height rather than fit-to-content: the tree grows and
          // shrinks as folders open, and a panel that resizes under the cursor
          // mid-organize is disorienting.
          height: isPhone ? "100dvh" : "min(760px, calc(100dvh - 44px))",
          maxHeight: isPhone ? "100dvh" : "calc(100dvh - 44px)",
          display: "flex", flexDirection: "column",
          color: "var(--text-1)", outline: "none",
        }}
      >
        {/* ── Header ── */}
        <div style={{
          borderBottom: "1px solid var(--border-1)",
          padding: isPhone ? "11px 11px 10px" : "14px 15px 12px",
          display: "flex", alignItems: "center", gap: isPhone ? 4 : 8, flexShrink: 0,
        }}>
          <span id="plan-library-title" style={{
            fontSize: isPhone ? 13 : 16, fontWeight: 800, letterSpacing: "-0.01em",
            display: "inline-flex", alignItems: "center", gap: isPhone ? 5 : 7,
            flex: 1, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap",
          }}>
            <FolderIcon size={isPhone ? 14 : 17} />
            {t("folders.title")}
            {/* Dropped on phone: four icon buttons plus the title already fill a
                360px header, and the count is the least load-bearing of them. */}
            {!isPhone && (
              <span style={{ fontSize: 9, fontWeight: 400, color: "var(--text-5)" }}>
                {joinCounts(plans.length, folderCount)}
              </span>
            )}
          </span>

          {isPhone && plans.length > 1 && (
            <button onClick={() => { setSelectMode(v => !v); setSelectedIds(new Set()); }}
              style={{ ...iconBtn, color: selectMode ? "var(--active)" : "var(--text-4)",
                borderColor: selectMode ? "var(--active)" : "var(--border-2)" }}>
              {selectMode ? t("folders.selectDone") : t("folders.select")}
            </button>
          )}
          {/* Undo/redo are discoverable here as well as on ⌘Z, because the
              keyboard shortcut is scoped to this panel and nothing else in the
              app would hint at that. */}
          <button onClick={() => { if (undoFolders()) { setSelectedIds(new Set()); setFocusId(null); } }}
            disabled={!folderCanUndo}
            style={{ ...iconBtn, padding: "6px 7px", opacity: folderCanUndo ? 1 : 0.3,
              cursor: folderCanUndo ? "pointer" : "default" }}
            title={`${t("folders.undo")} (⌘Z)`} aria-label={t("folders.undo")}>
            <TurnIcon size={13} />
          </button>
          <button onClick={() => { if (redoFolders()) { setSelectedIds(new Set()); setFocusId(null); } }}
            disabled={!folderCanRedo}
            style={{ ...iconBtn, padding: "6px 7px", opacity: folderCanRedo ? 1 : 0.3,
              cursor: folderCanRedo ? "pointer" : "default" }}
            title={`${t("folders.redo")} (⇧⌘Z)`} aria-label={t("folders.redo")}>
            <TurnIcon size={13} redo />
          </button>
          {/* Import / export the whole library. Icon-only next to the others,
              because the verbs that matter here are on the SELECTION footer —
              these two are the "everything" case. */}
          {/* `multiple` is the point: an unzipped export comes back as a pile
              of single-plan files, and selecting them all should be one act. */}
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="application/json,.json,application/zip,.zip"
            style={{ display: "none" }}
            onChange={e => {
              const files = [...(e.target.files ?? [])];
              // Cleared so choosing the SAME file twice fires change again.
              e.target.value = "";
              doImport(files);
            }}
          />
          {/* Named, not ↓/↑. The arrows were unreadable in both directions —
              nothing says whether ↑ means "send my plans out" or "the file
              goes up into the app" — and this is the one pair of controls an
              advisor reaches for by name. The title beside them is the flex
              item that shrinks, so the labels survive on a narrow phone. */}
          <button onClick={() => fileRef.current?.click()} style={iconBtn}
            title={t("folders.io.importTitle")}>
            {t("folders.io.import")}
          </button>
          {/* No Export button up here. Import belongs in the header because
              there is nothing to select before importing; Export always acts
              on something, so it lives on the selection footer where the
              thing it acts on is named. Two Exports meaning different scopes,
              one of them permanently visible, is the redundancy. Exporting
              everything is ⌘A then Export — the footer then says "N selected",
              so the scope is stated rather than assumed. */}
          <button onClick={() => newFolderSmart(null)} style={iconBtn} title={t("folders.newFolder")}>
            <FolderIcon size={13} />
            <span aria-hidden="true" style={{ fontWeight: 700 }}>+</span>
          </button>
          <button onClick={close} title={t("folders.close")} style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--text-4)", fontSize: 16, lineHeight: 1, padding: 3,
          }}>✕</button>
        </div>

        {/* ── Search + sort ── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 6, padding: "9px 15px",
          borderBottom: "1px solid var(--border-1)", flexShrink: 0,
        }}>
          <input
            ref={searchRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t("folders.search.placeholder")}
            aria-label={t("folders.search.placeholder")}
            style={{
              flex: 1, minWidth: 0, boxSizing: "border-box",
              fontSize: 12, padding: "6px 9px", borderRadius: 6,
              border: "1px solid var(--border-2)", background: "var(--bg-surface-2)",
              color: "var(--text-2)", outline: "none", fontFamily: "inherit",
            }}
          />
          {/* A named dropdown rather than three unlabelled segments. The
              segmented control could not say what it CONTROLLED — "Custom /
              Name / Recent" is only a sort order if you already knew — and it
              has no room to grow: "by student" is a fourth mode, and a fifth
              would not fit at all. The current mode stays visible on the
              button, so naming the control costs no legibility. */}
          <button
            onClick={e => {
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              setSortMenu({ x: Math.max(6, r.right - 150), y: r.bottom + 4 });
            }}
            aria-haspopup="menu"
            title={t("folders.sort.label")}
            style={{ ...iconBtn, fontSize: 10, gap: 4 }}
          >
            <span style={{ color: "var(--text-5)" }}>{t("folders.sort.label")}</span>
            <span style={{ fontWeight: 700, color: "var(--text-3)" }}>
              {t(`folders.sort.${folderSort}`)}
            </span>
            <span aria-hidden="true" style={{ color: "var(--text-5)", fontSize: 7 }}>▼</span>
          </button>
        </div>

        {notice && (
          // Every notice used to render RED — including "Exported 4 plans",
          // which made a success indistinguishable from a failure and is why
          // a working export read as a broken one. Errors stay red; anything
          // that went fine is quiet.
          <div role="status" style={{
            padding: "5px 13px", fontSize: 10,
            color: noticeBad ? "var(--error)" : "var(--text-3)",
            background: noticeBad ? "var(--error-bg, rgba(239,68,68,0.1))" : "var(--bg-surface-2)",
            borderBottom: "1px solid var(--border-1)", flexShrink: 0,
          }}>{notice}</div>
        )}

        {/* ── Tree ── */}
        <div
          {...longPress}
          onDragOver={e => { if (drag) { e.preventDefault(); setDropTargetId(""); setDropVerdict("ok"); } }}
          onDrop={e => { if (!drag) return; e.preventDefault(); commitMove(drag.ids, null); }}
          onClick={e => {
            // Clicking empty space clears the selection, as Finder does.
            if (e.target === e.currentTarget) { setSelectedIds(new Set()); setFocusId(null); }
          }}
          style={{ flex: 1, overflowY: "auto", padding: "8px 9px 14px", minHeight: 120 }}
        >
          {rows.length === 0 ? (
            <div style={{ padding: "44px 22px", textAlign: "center", color: "var(--text-5)", fontSize: 12, lineHeight: "calc(1.7 * var(--lh-scale, 1))" }}>
              {query
                ? t("folders.search.empty", { q: query, plans: plans.length, folders: folderCount })
                : t("folders.empty")}
            </div>
          ) : (
            <PlanTree
              rows={rows}
              density="comfortable"
              activePlanId={activePlanId}
              selectedIds={selectedIds}
              editingId={editingId}
              focusId={focusId}
              dropTargetId={dropTargetId}
              dropVerdict={dropVerdict}
              insertAt={insertAt}
              selectMode={selectMode}
              onRowClick={onRowClick}
              onRowDoubleClick={openRow}
              onRowContextMenu={(row, e) => {
                e.preventDefault();
                e.stopPropagation();   // must not reach the menu's own dismiss listener
                setFocusId(row.id);
                setMenu({ x: e.clientX, y: e.clientY, row });
              }}
              onToggle={toggleFolder}
              onCommitName={commitName}
              onCancelEdit={() => setEditingId(null)}
              dnd={dnd}
              metaOf={metaOf}
              cells={planCells}
              t={t}
            />
          )}

          {/* An explicit root target: with a long list there may be no empty
              space left to aim at, and "move it back out" must stay reachable. */}
          {drag && (
            <div
              onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropTargetId(""); setDropVerdict("ok"); }}
              onDrop={e => { e.preventDefault(); e.stopPropagation(); commitMove(drag.ids, null); }}
              style={{
                margin: "8px 4px 0", padding: "8px 10px", borderRadius: 6,
                border: `1px dashed ${dropTargetId === "" ? "var(--active)" : "var(--border-2)"}`,
                background: dropTargetId === "" ? "var(--active-bg)" : "transparent",
                fontSize: 10, color: dropTargetId === "" ? "var(--active)" : "var(--text-5)",
                textAlign: "center",
              }}
            >{t("folders.dropRoot")}</div>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{
          borderTop: "1px solid var(--border-1)", padding: "9px 15px",
          display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
        }}>
          {selectedIds.size > 0 ? (
            <>
              <span style={{ fontSize: 11, color: "var(--text-4)", flex: 1, minWidth: 0 }}>
                {t("folders.selected", { n: selectedIds.size })}
              </span>
              {/* Bulk assign is the advisor's other repeated verb — filing six
                  of one advisee's plans at once. Hidden when the selection is
                  all folders, which have no advisee. */}
              {[...selectedIds].some(id => !planTree.folderIds.has(id)) && (
                <button onClick={() => requestAssign([...selectedIds])} style={iconBtn}>
                  {t("folders.assign.short")}
                </button>
              )}
              <button
                onClick={e => { e.stopPropagation(); doExport([...selectedIds], "files"); }}
                onContextMenu={e => {
                  e.preventDefault(); e.stopPropagation();
                  const r = e.currentTarget.getBoundingClientRect();
                  setExportMenu({ x: r.left, y: r.bottom + 4, ids: [...selectedIds] });
                }}
                style={iconBtn}>{t("folders.io.export")}</button>
              <button onClick={e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMoveMenu({ x: r.left, y: r.bottom + 4 }); }}
                style={iconBtn}>{t("folders.moveTo")}</button>
              <button onClick={() => requestDelete([...selectedIds])}
                style={{ ...iconBtn, color: "var(--error)", borderColor: "var(--error-border, var(--border-2))" }}>
                {t("folders.menu.delete")}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => newPlanIn(null)} style={{ ...iconBtn, color: "var(--accent)", flex: 1, justifyContent: "center" }}>
                {t("header.plan.new")}
              </button>
              <span style={{ fontSize: 9, color: "var(--text-6)", flexShrink: 0 }}>
                {/* There is no right-click on a phone — the same menu is a
                    long-press there, so the hint has to say so. */}
                {t(isPhone ? "folders.hint.touch" : "folders.hint")}
              </span>
            </>
          )}
        </div>
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItemsFor(menu.row)} onClose={() => setMenu(null)} />
      )}
      {moveMenu && (
        <ContextMenu x={moveMenu.x} y={moveMenu.y} items={footerMoveItems()} onClose={() => setMoveMenu(null)} />
      )}
      {sortMenu && (
        <ContextMenu x={sortMenu.x} y={sortMenu.y} items={sortMenuItems()} onClose={() => setSortMenu(null)} />
      )}
      {exportMenu && (
        <ContextMenu x={exportMenu.x} y={exportMenu.y} items={exportMenuItems(exportMenu.ids)}
          onClose={() => setExportMenu(null)} />
      )}

      {/* ── Assign student ──
          A free-text field backed by a datalist of advisees already in use.
          Free text because a roster cannot be fetched from anywhere — there is
          no student directory in this app — and a fixed list would make the
          first assignment impossible. The datalist is what keeps the free text
          from fragmenting one advisee across three spellings. */}
      {assigning && (
        <div
          onClick={e => { e.stopPropagation(); setAssigning(null); }}
          style={{
            position: "fixed", inset: 0, zIndex: 10100, background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
          }}
        >
          <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" style={{
            background: "var(--bg-surface)", border: "1px solid var(--border-2)",
            borderRadius: 12, maxWidth: 330, width: "100%", padding: "15px 16px 13px",
            boxShadow: "var(--shadow-modal)",
          }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text-1)", marginBottom: 7 }}>
              {assigning.ids.length === 1
                ? t("folders.assign.title", { name: planTree.byId.get(assigning.ids[0])?.name ?? "" })
                : t("folders.assign.titleN", { n: assigning.ids.length })}
            </div>
            <input
              autoFocus
              value={assigning.value}
              role="combobox"
              aria-expanded={assignMatches.length > 0}
              aria-controls="plan-library-roster"
              autoComplete="off"
              onChange={e => setAssigning(a => ({ ...a, value: e.target.value, hi: -1 }))}
              onKeyDown={e => {
                e.stopPropagation();
                if (e.key === "Escape") { e.preventDefault(); setAssigning(null); return; }
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  if (!assignMatches.length) return;
                  const d = e.key === "ArrowDown" ? 1 : -1;
                  // -1 is "use what I typed"; the list wraps around through it,
                  // so arrowing off either end returns to the typed text rather
                  // than trapping the cursor in the list.
                  const next = assigning.hi + d;
                  setAssigning(a => ({
                    ...a,
                    hi: next < -1 ? assignMatches.length - 1 : next >= assignMatches.length ? -1 : next,
                  }));
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  const pick = assignMatches[assigning.hi];
                  commitAssign(pick ? pick.name : undefined);
                }
              }}
              placeholder={t("folders.assign.placeholder")}
              aria-label={t("folders.assign.placeholder")}
              style={{
                width: "100%", boxSizing: "border-box", fontSize: 12,
                padding: "6px 9px", borderRadius: 6, marginBottom: 7,
                border: "1px solid var(--border-2)", background: "var(--bg-surface-2)",
                color: "var(--text-2)", outline: "none", fontFamily: "inherit",
              }}
            />

            {/* The advisees already on file, filtered as you type. A datalist
                stood here and was the wrong control: it stays invisible until
                the field is touched, renders differently in every browser (and
                barely at all in Safari), and can never show how many plans a
                student already has. An advisor's common act is re-filing onto
                an EXISTING advisee, so that list has to be visible and one
                click deep, not hidden behind an autocomplete. */}
            {roster.length > 0 && (
              <div style={{ marginBottom: 9 }}>
                <div style={{ fontSize: 9, color: "var(--text-5)", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {t("folders.assign.existing")}
                </div>
                <div id="plan-library-roster" role="listbox" style={{
                  maxHeight: 148, overflowY: "auto",
                  border: "1px solid var(--border-1)", borderRadius: 6,
                  background: "var(--bg-surface-2)",
                }}>
                  {assignMatches.length === 0 ? (
                    <div style={{ padding: "8px 9px", fontSize: 10.5, color: "var(--text-5)" }}>
                      {t("folders.assign.noMatch")}
                    </div>
                  ) : assignMatches.map((r, i) => {
                    const on = i === assigning.hi;
                    const current = normalizeSearchText(r.name) === normalizeSearchText(assigning.value);
                    return (
                      <div
                        key={r.name}
                        role="option"
                        aria-selected={on}
                        onMouseEnter={() => setAssigning(a => ({ ...a, hi: i }))}
                        onClick={() => commitAssign(r.name)}
                        style={{
                          display: "flex", alignItems: "center", gap: 6,
                          padding: "5px 9px", cursor: "pointer", fontSize: 11.5,
                          background: on ? "var(--active-bg)" : "transparent",
                          color: on ? "var(--active)" : "var(--text-2)",
                        }}
                      >
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: current ? 700 : 400 }}>
                          {r.name}
                        </span>
                        <span style={{ flexShrink: 0, fontSize: 9, color: "var(--text-5)", fontVariantNumeric: "tabular-nums" }}>
                          {nPlans(r.count)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div style={{ fontSize: 10, color: "var(--text-5)", lineHeight: "calc(1.6 * var(--lh-scale, 1))", marginBottom: 11 }}>
              {/* Said only when the roster is non-empty: with no advisees yet
                  EVERY name is new, and announcing that would be noise. */}
              {assignIsNew && roster.length > 0 && (
                <div style={{ color: "var(--text-4)", marginBottom: 3 }}>
                  {t("folders.assign.isNew", { name: assigning.value.trim() })}
                </div>
              )}
              {t("folders.assign.note")}
            </div>
            <div style={{ display: "flex", gap: 7 }}>
              <button onClick={() => setAssigning(null)} style={{
                flex: 1, fontSize: 11, padding: "6px 10px", borderRadius: 6, cursor: "pointer",
                background: "var(--bg-surface-2)", border: "1px solid var(--border-2)",
                color: "var(--text-3)", fontFamily: "inherit",
              }}>{t("folders.delete.cancel")}</button>
              {/* Wrapped, not passed directly: an onClick handler receives the
                  EVENT, which commitAssign would have taken as the name. */}
              {(() => {
                // Empty field + nothing to clear = no act to perform, so the
                // button is disabled rather than offering a no-op.
                const clearing = !assigning.value.trim();
                const dead = clearing && !assignHadValue;
                return (
                  <button onClick={() => commitAssign()} disabled={dead} style={{
                    flex: 1, fontSize: 11, fontWeight: 700, padding: "6px 10px", borderRadius: 6,
                    cursor: dead ? "default" : "pointer", opacity: dead ? 0.4 : 1,
                    background: "var(--active-bg)",
                    border: "1px solid var(--active)", color: "var(--active)", fontFamily: "inherit",
                  }}>
                    {/* Clearing is the same commit with an empty field, so the
                        button says which one it is rather than hiding a second
                        destructive-looking control next to it. */}
                    {clearing && assignHadValue ? t("folders.assign.clear") : t("folders.assign.confirm")}
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirmation ── */}
      {pending && (
        <div
          onClick={e => { e.stopPropagation(); setPending(null); }}
          style={{
            position: "fixed", inset: 0, zIndex: 10100, background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            background: "var(--bg-surface)", border: "1px solid var(--border-2)",
            borderRadius: 12, maxWidth: 330, width: "100%", padding: "15px 16px 13px",
            boxShadow: "var(--shadow-modal)",
          }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text-1)", marginBottom: 7 }}>
              {pending.name
                ? t("folders.delete.question", { name: pending.name })
                : t("folders.delete.questionN", { n: pending.targets.length })}
            </div>
            <div style={{ fontSize: 10.5, color: "var(--text-4)", lineHeight: "calc(1.6 * var(--lh-scale, 1))", marginBottom: 12 }}>
              {(() => {
                const inside = joinCounts(pending.contained.plans, pending.contained.folders);
                return inside ? `${t("folders.delete.alsoRemoves", { items: inside })} ` : "";
              })()}
              {/* Reassurance, not a warning: the plan data survives a delete and
                  ⌘Z puts it back, so this line is no longer red. */}
              <span style={{ color: "var(--text-5)" }}>{t("folders.delete.undo")}</span>
            </div>
            <div style={{ display: "flex", gap: 7 }}>
              <button onClick={() => setPending(null)} style={{
                flex: 1, fontSize: 11, padding: "6px 10px", borderRadius: 6, cursor: "pointer",
                background: "var(--bg-surface-2)", border: "1px solid var(--border-2)",
                color: "var(--text-3)", fontFamily: "inherit",
              }}>{t("folders.delete.cancel")}</button>
              <button autoFocus onClick={confirmDelete} style={{
                flex: 1, fontSize: 11, fontWeight: 700, padding: "6px 10px", borderRadius: 6,
                cursor: "pointer", background: "var(--error-bg, rgba(239,68,68,0.12))",
                border: "1px solid var(--error)", color: "var(--error)", fontFamily: "inherit",
              }}>{t("folders.delete.confirm")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
