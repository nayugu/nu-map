// PLAN TREE — the indented folder/plan list, shared by the header dropdown
// (compact, click-to-switch) and the Plan Library panel (Finder semantics).
//
// One renderer for both surfaces on purpose: two implementations of the same
// tree drift, and the row is where every affordance lives — disclosure,
// selection, inline rename, drop targeting.
//
// Rows come from flattenTree(); this file only draws them. Anything that needs
// to know about ancestry, cycles or depth belongs in core/planFolders.js.
import { useState, useEffect, useRef } from "react";

/** Indent per level. Capped so a deep row still leaves room for the name. */
const STEP = 13;
const INDENT_CAP = 6;

export function rowIndent(depth) {
  // Past the cap, extra levels add a hairline instead of a full step — the
  // guide lines and the parent row above still convey position, and a 200px
  // dropdown cannot afford 8 full indents.
  return Math.min(depth, INDENT_CAP) * STEP + Math.max(0, depth - INDENT_CAP) * 4;
}

/** Vertical guide lines, one per ancestor level, so depth reads at a glance. */
function Guides({ depth, density }) {
  if (depth === 0) return null;
  const lines = [];
  for (let d = 0; d < Math.min(depth, INDENT_CAP); d++) {
    lines.push(
      <span key={d} aria-hidden="true" style={{
        position: "absolute", top: 0, bottom: 0, left: rowIndent(d) + (density === "compact" ? 5 : 7),
        width: 1, background: "var(--border-1)",
      }} />
    );
  }
  return <>{lines}</>;
}

function Twisty({ open, hasChildren, onToggle, density, label }) {
  const size = density === "compact" ? 12 : 16;
  if (!hasChildren) return <span style={{ width: size, flexShrink: 0 }} aria-hidden="true" />;
  return (
    <button
      onClick={e => { e.stopPropagation(); onToggle(); }}
      aria-label={label}
      aria-expanded={open}
      style={{
        width: size, height: size, flexShrink: 0, padding: 0, border: "none",
        background: "none", cursor: "pointer", color: "var(--text-5)",
        fontSize: density === "compact" ? 7 : 9, lineHeight: 1,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        transform: open ? "rotate(90deg)" : "none", transition: "transform 90ms",
      }}
    >▶</button>
  );
}

/**
 * A folder, drawn as a tabbed container so it reads as a container even at
 * 12px — a filled body plus a raised tab, tinted with the accent so folders
 * never get mistaken for plans in a mixed list.
 */
export function FolderIcon({ open, size = 14 }) {
  return (
    <svg width={size} height={size * 0.85} viewBox="0 0 20 17" aria-hidden="true"
      style={{ flexShrink: 0, display: "block" }}>
      {/* tab */}
      <path d="M1 3.2A2.2 2.2 0 0 1 3.2 1h4.1a2 2 0 0 1 1.5.7L10 3.2H1z"
        fill="var(--active)" opacity="0.55" />
      {/* body — skewed open, square closed */}
      {open ? (
        <path d="M1 3.2h16.2a1.6 1.6 0 0 1 1.57 1.93l-1.5 8.4A2 2 0 0 1 15.3 16H3.1a2 2 0 0 1-2-1.7L1 3.2z"
          fill="var(--active)" opacity="0.28" stroke="var(--active)" strokeOpacity="0.5" strokeWidth="0.9" />
      ) : (
        <path d="M1 3.2h16.6A1.4 1.4 0 0 1 19 4.6v9.7a1.4 1.4 0 0 1-1.4 1.4H2.4A1.4 1.4 0 0 1 1 14.3V3.2z"
          fill="var(--active)" opacity="0.2" stroke="var(--active)" strokeOpacity="0.5" strokeWidth="0.9" />
      )}
    </svg>
  );
}

/**
 * A plan, drawn as a rounded tag carrying its academic level — U for
 * undergraduate, G for graduate. The level used to be visible only as a group
 * header in the dropdown, which a folder tree has no room for; putting it on
 * the icon keeps it legible at any nesting depth.
 */
export function PlanIcon({ size = 14, active, studentType }) {
  const isGrad = studentType === "graduate";
  // The accent when this is the plan you're inside — the same one the row's
  // left bar uses, so "where I am" is one colour everywhere instead of green
  // here and something else there.
  const tint = active ? "var(--active)" : isGrad ? "var(--planned)" : "var(--text-4)";
  return (
    <svg width={size * 1.15} height={size} viewBox="0 0 22 18" aria-hidden="true"
      style={{ flexShrink: 0, display: "block" }}>
      <rect x="0.85" y="0.85" width="20.3" height="16.3" rx="4.2"
        fill={tint} fillOpacity={active ? 0.2 : 0.11}
        stroke={tint} strokeOpacity={active ? 0.85 : 0.5} strokeWidth="1.3" />
      <text x="11" y="12.9" textAnchor="middle" fill={tint} fillOpacity="0.95"
        style={{ font: "700 11px 'InterTight', 'Inter', system-ui, sans-serif", letterSpacing: "0.02em" }}>
        {isGrad ? "G" : "U"}
      </text>
    </svg>
  );
}

/** Inline rename field — Enter commits, Escape reverts, blur commits. */
function NameEditor({ value, onCommit, onCancel, density }) {
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  return (
    <input
      ref={ref}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      onBlur={() => onCommit(draft)}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); onCommit(draft); }
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      }}
      style={{
        flex: 1, minWidth: 0, font: "inherit",
        fontSize: density === "compact" ? 10 : 11.5,
        padding: "1px 4px", borderRadius: 3,
        border: "1px solid var(--active)", background: "var(--bg-app)",
        color: "var(--text-1)", outline: "none",
      }}
    />
  );
}

/**
 * @param {object}   p
 * @param {Array}    p.rows            from flattenTree()
 * @param {'compact'|'comfortable'} p.density
 * @param {string}   p.activePlanId
 * @param {Set}      [p.selectedIds]   panel only; empty in the dropdown
 * @param {string}   [p.editingId]     row currently being renamed
 * @param {string}   [p.dropTargetId]  folder id (or '' for root) being hovered
 * @param {'ok'|'cycle'|'depth'|'self'|'noop'} [p.dropVerdict]
 * @param {{beforeId: string|null, afterId: string|null}} [p.insertAt]
 *   manual-order insertion point: a line is drawn above `beforeId`, or below
 *   `afterId` when dropping at the end of a list
 * @param {string}   [p.focusId]       keyboard cursor
 * @param {(row, event) => void} p.onRowClick
 * @param {(row) => void}        [p.onRowDoubleClick]
 * @param {(row, event) => void} [p.onRowContextMenu]
 * @param {(id) => void}         p.onToggle
 * @param {(id, name) => void}   [p.onCommitName]
 * @param {object}   [p.dnd]           { onDragStart, onDragOver, onDragLeave, onDrop }
 * @param {(row) => string} [p.metaOf] right-aligned secondary text
 * @param {boolean}  [p.selectMode]    touch: show checkboxes
 */
export default function PlanTree({
  rows, density = "comfortable", activePlanId,
  selectedIds = null, editingId = null, focusId = null,
  dropTargetId = null, dropVerdict = "ok", insertAt = null,
  onRowClick, onRowDoubleClick, onRowContextMenu, onToggle, onCommitName, onCancelEdit,
  dnd = null, metaOf = null, selectMode = false, t,
}) {
  const compact = density === "compact";
  const iconSize = compact ? 12 : 17;
  const fontSize = compact ? 10 : 13;

  return (
    <div role="tree" style={{ position: "relative" }}>
      {rows.map(row => {
        const isFolder = row.kind === "folder";
        const isActive = !isFolder && row.id === activePlanId;
        const isSelected = selectedIds?.has(row.id) ?? false;
        const isFocused = focusId === row.id;
        const isDropTarget = isFolder && dropTargetId === row.id;
        const dropOk = dropVerdict === "ok";
        const meta = metaOf?.(row) ?? "";
        // Manual-order insertion line. Drawn on the row itself rather than as a
        // separate element so it cannot desync from the list it describes.
        // One boundary, ONE line. edgeZone names a gap from both sides —
        // {beforeId: the row under it, afterId: the row over it} — so drawing
        // both put a 2px line at the bottom of one row and another at the top
        // of the next, one pixel apart, which reads as a single fat smudge.
        // The line goes above `beforeId`; `afterId` is only consulted at the
        // end of a list, where there is no next row to sit above.
        const lineAbove = insertAt?.beforeId === row.id;
        const lineBelow = !insertAt?.beforeId && insertAt?.afterId === row.id;

        return (
          <div
            key={row.id}
            className="plan-row"
            role="treeitem"
            aria-level={row.depth + 1}
            aria-selected={isSelected || isActive}
            {...(isFolder ? { "aria-expanded": row.open } : {})}
            data-tree-id={row.id}
            draggable={!!dnd && !editingId}
            onDragStart={dnd ? e => dnd.onDragStart(row, e) : undefined}
            onDragOver={dnd ? e => dnd.onDragOver(row, e) : undefined}
            onDragLeave={dnd ? e => dnd.onDragLeave(row, e) : undefined}
            onDrop={dnd ? e => dnd.onDrop(row, e) : undefined}
            onClick={e => onRowClick(row, e)}
            onDoubleClick={() => onRowDoubleClick?.(row)}
            onContextMenu={e => onRowContextMenu?.(row, e)}
            style={{
              position: "relative",
              display: "flex", alignItems: "center", gap: compact ? 3 : 7,
              padding: compact ? "3px 8px" : "7px 11px",
              paddingLeft: (compact ? 8 : 11) + rowIndent(row.depth),
              fontSize, cursor: "pointer", userSelect: "none",
              // Three states that must never be confusable — told apart by
              // SHAPE, not by hue. Colour was doing the work before: selection
              // was a grey slab and "the plan you're inside" was green, which
              // read as a second kind of selection and left three colours
              // competing in one 12px row. Now there is one accent, and the
              // form says which state it is:
              //
              //   ACTIVE      — a solid bar down the left edge (below). No
              //     fill and no ring, so it never looks picked.
              //   SELECTED    — a BOLD 2px ring around the whole row plus a
              //     faint tint. An edge is the thing you can see at a glance
              //     across a list of forty rows.
              //   drop target — a DASHED ring, matching the dashed-ghost motif
              //     the canvas already uses for "this is where it would land",
              //     so it cannot be mistaken for a selection even when the
              //     folder under the cursor happens to be selected.
              //
              // Only the rejecting drop target introduces a second colour, and
              // it has to: it is the one state that means "this will not work".
              background: isDropTarget
                ? (dropOk ? "var(--active-bg)" : "var(--error-bg)")
                : isSelected ? "var(--active-bg)"
                : "transparent",
              outline: isDropTarget
                ? `2px dashed ${dropOk ? "var(--active)" : "var(--error)"}`
                : isSelected ? "2px solid var(--active)"
                : isFocused  ? "1px solid var(--border-2)"
                : "none",
              // Drawn inside the row's own box so the ring never overlaps the
              // row above; `outline` alone straddles the border edge.
              outlineOffset: -2,
              borderRadius: compact ? 3 : 6,
            }}
          >
            {/* Manual-order insertion line, drawn ON the boundary between two
                rows rather than inside one of them — that gap is what the
                gesture is actually aiming at.

                It was previously a box-shadow in the style object above, which
                never rendered even once: the selection/focus ring sets
                `boxShadow` further down the same object literal, and the later
                key wins, so the line was overwritten by "none" on every single
                render. An absolutely positioned element cannot be clobbered by
                an unrelated style, takes no layout space either (so the rows
                you are aiming between never shift), and is not clipped by the
                row's border radius the way an inset shadow is. */}
            {(lineAbove || lineBelow) && (
              <span aria-hidden="true" style={{
                position: "absolute",
                left: Math.max(1, rowIndent(row.depth) - 1), right: compact ? 4 : 6,
                ...(lineAbove ? { top: -1 } : { bottom: -1 }),
                height: 2, borderRadius: 2, background: "var(--active)",
                pointerEvents: "none", zIndex: 1,
              }} />
            )}

            {/* "The plan you are inside", and the ONLY signal for it. A bar is
                readable next to a selection ring because the two occupy
                different edges — the bar cannot be mistaken for part of a
                rectangle drawn around the whole row. */}
            {isActive && (
              <span aria-hidden="true" style={{
                position: "absolute", left: Math.max(1, rowIndent(row.depth) - 1), top: compact ? 2 : 4,
                bottom: compact ? 2 : 4, width: compact ? 2.5 : 3,
                borderRadius: 2, background: "var(--active)",
              }} />
            )}
            <Guides depth={row.depth} density={density} />

            {selectMode && (
              <input
                type="checkbox" checked={isSelected} onChange={() => {}}
                onClick={e => { e.stopPropagation(); onRowClick(row, { metaKey: true, shiftKey: e.shiftKey }); }}
                style={{ cursor: "pointer", accentColor: "var(--active)", flexShrink: 0, margin: 0 }}
              />
            )}

            {isFolder
              ? <Twisty open={row.open} hasChildren={row.hasChildren} density={density}
                  onToggle={() => onToggle(row.id)}
                  label={t?.(row.open ? "folders.collapse" : "folders.expand") ?? "toggle"} />
              : <span style={{ width: compact ? 12 : 16, flexShrink: 0 }} aria-hidden="true" />}

            {isFolder
              ? <FolderIcon open={row.open} size={iconSize} />
              : <PlanIcon size={iconSize} active={isActive} studentType={row.item.studentType} />}

            {editingId === row.id ? (
              <NameEditor value={row.item.name ?? ""} density={density}
                onCommit={name => onCommitName?.(row.id, name)}
                onCancel={() => onCancelEdit?.()} />
            ) : (
              <span style={{
                flex: 1, minWidth: 0, overflow: "hidden",
                textOverflow: "ellipsis", whiteSpace: "nowrap",
                fontWeight: isActive || isFolder ? 700 : 400,
                // The bar and the bold weight already say "you are here"; a
                // third signal in a fourth colour was the thing making this
                // row hard to read.
                color: isActive ? "var(--text-1)" : isFolder ? "var(--text-2)" : "var(--text-3)",
              }}>
                {row.item.name}
              </span>
            )}

            {meta && (
              <span style={{
                flexShrink: 0, fontSize: compact ? 7.5 : 9, color: "var(--text-5)",
                fontVariantNumeric: "tabular-nums", maxWidth: "40%",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{meta}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
