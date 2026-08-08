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
  topmostNodes, MAX_DEPTH,
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
    activePlanId, switchPlan, renamePlan,
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
  const [pending, setPending]       = useState(null);   // delete confirmation
  const [notice, setNotice]         = useState("");
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
    setMenu(null); setPending(null); setNotice(""); setSelectMode(false);
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
      // A context menu owns Escape while it is open, or dismissing the menu
      // would close the whole panel out from under it.
      if (menu || moveMenu) return;
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
      if (e.key === "Enter")      { e.preventDefault(); handleEnter(); return; }
      if (e.key === "ArrowDown")  { e.preventDefault(); moveFocus(1, e.shiftKey); return; }
      if (e.key === "ArrowUp")    { e.preventDefault(); moveFocus(-1, e.shiftKey); return; }
      if (e.key.toLowerCase() === "n" && e.shiftKey && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const sel = focusId ? rows.find(r => r.id === focusId) : null;
        newFolder(sel ? parentFor(sel) : null);
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
  }, [showPlanLibrary, editingId, pending, menu, moveMenu, query, rows, focusId,
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
      { key: "rename", label: t("folders.menu.rename"), hint: "↵", disabled: n > 1,
        onSelect: () => setEditingId(row.id) },
      { divider: true },
      { key: "newFolder", label: t("folders.menu.newFolder"), hint: "⇧⌘N",
        onSelect: () => newFolder(parentFor(row)) },
      { key: "newWith", label: t("folders.menu.newFolderWithSel"), hint: joinCounts(
          ids.filter(id => !planTree.folderIds.has(id)).length,
          ids.filter(id => planTree.folderIds.has(id)).length),
        onSelect: () => newFolderWith(ids) },
      { key: "newPlan", label: t("folders.menu.newPlanHere"),
        onSelect: () => newPlanIn(parentFor(row)) },
      { divider: true },
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
    return labels.get(row.id) ?? "";
  };

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
        if (menu || moveMenu) { setMenu(null); setMoveMenu(null); return; }
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
          <button onClick={() => newFolder(null)} style={iconBtn} title={t("folders.newFolder")}>
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
          <div style={{ display: "flex", border: "1px solid var(--border-2)", borderRadius: 5, overflow: "hidden", flexShrink: 0 }}>
            {/* Custom first: it is the default, and the only mode in which
                dragging a plan somewhere means anything — the other two
                re-sort under you, so the insertion line is not drawn there. */}
            {[["manual", t("folders.sort.manual")], ["name", t("folders.sort.name")],
              ["recent", t("folders.sort.recent")]].map(([mode, label]) => (
              <button key={mode} onClick={() => setFolderSort(mode)}
                title={t("folders.sort.label")}
                style={{
                  border: "none", cursor: "pointer", fontSize: 9, padding: "4px 7px",
                  fontFamily: "inherit", lineHeight: 1,
                  background: folderSort === mode ? "var(--active-bg)" : "transparent",
                  color: folderSort === mode ? "var(--active)" : "var(--text-5)",
                  fontWeight: folderSort === mode ? 700 : 400,
                }}>{label}</button>
            ))}
          </div>
        </div>

        {notice && (
          <div role="status" style={{
            padding: "5px 13px", fontSize: 10, color: "var(--error)",
            background: "var(--error-bg, rgba(239,68,68,0.1))",
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
