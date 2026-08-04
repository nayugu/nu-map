// CONTEXT MENU — cursor-anchored menu with one level of submenu.
//
// New primitive: nothing in the app used onContextMenu before folders. Kept
// generic (items in, callbacks out) so other surfaces can adopt it rather than
// growing a second one.
//
// Portalled to <body> because every caller so far lives inside a scrolling,
// clipping container, and a menu must never be cropped by its own list.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const PAD = 8;

/**
 * Long-press → context menu, so touch has the same affordances as right-click.
 * Cancels on movement so it never hijacks a scroll.
 */
export function useLongPress(onLongPress, { ms = 500, moveTolerance = 8 } = {}) {
  const timer = useRef(null);
  const origin = useRef(null);
  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };

  return {
    onTouchStart: e => {
      const touch = e.touches?.[0];
      if (!touch) return;
      origin.current = { x: touch.clientX, y: touch.clientY };
      clear();
      timer.current = setTimeout(() => {
        timer.current = null;
        onLongPress({ x: origin.current.x, y: origin.current.y });
      }, ms);
    },
    onTouchMove: e => {
      const touch = e.touches?.[0];
      if (!touch || !origin.current) return;
      const dx = Math.abs(touch.clientX - origin.current.x);
      const dy = Math.abs(touch.clientY - origin.current.y);
      if (dx > moveTolerance || dy > moveTolerance) clear();
    },
    onTouchEnd: clear,
    onTouchCancel: clear,
  };
}

function MenuItem({ item, onClose, onOpenSub, isSubOpen, compact }) {
  if (item.divider) {
    return <div style={{ height: 1, background: "var(--border-1)", margin: "4px 0" }} />;
  }
  const disabled = !!item.disabled;
  const color = disabled ? "var(--text-6)" : item.danger ? "var(--error)" : "var(--text-2)";
  return (
    <button
      role="menuitem"
      disabled={disabled}
      aria-haspopup={item.submenu ? "menu" : undefined}
      aria-expanded={item.submenu ? isSubOpen : undefined}
      onMouseEnter={() => onOpenSub(item.submenu ? item.key : null)}
      onClick={e => {
        e.stopPropagation();
        if (disabled) return;
        if (item.submenu) { onOpenSub(item.key); return; }
        item.onSelect?.();
        onClose();
      }}
      style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%",
        padding: compact ? "4px 9px" : "5px 11px", border: "none", textAlign: "left",
        // `indent` lets a caller present a folder tree as flat top-level items
        // (the footer's "Move to…" button) without a submenu wrapper.
        paddingLeft: (compact ? 9 : 11) + (item.indent ?? 0) * 11,
        background: isSubOpen ? "var(--bg-surface-2)" : "transparent",
        color, fontSize: compact ? 10 : 11, fontFamily: "inherit",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1, borderRadius: 3,
      }}
      onMouseOver={e => { if (!disabled && !item.submenu) e.currentTarget.style.background = "var(--bg-surface-2)"; }}
      onMouseOut={e => { if (!isSubOpen) e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {item.label}
      </span>
      {item.hint && <span style={{ color: "var(--text-6)", fontSize: compact ? 8.5 : 9.5 }}>{item.hint}</span>}
      {item.submenu && <span aria-hidden="true" style={{ color: "var(--text-5)", fontSize: 8 }}>▶</span>}
    </button>
  );
}

/**
 * @param {object} p
 * @param {number} p.x  viewport coords of the invoking cursor/touch
 * @param {number} p.y
 * @param {Array}  p.items  { key, label, onSelect, disabled, danger, divider, hint, submenu }
 * @param {() => void} p.onClose
 * @param {boolean} [p.compact]
 */
export default function ContextMenu({ x, y, items, onClose, compact = false }) {
  const cardRef = useRef(null);
  const subRef = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [subKey, setSubKey] = useState(null);
  const [subPos, setSubPos] = useState(null);

  // Flip/clamp into the viewport once the real size is known. useLayoutEffect
  // so it never paints in the wrong place first.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = x + r.width + PAD > window.innerWidth ? Math.max(PAD, x - r.width) : x;
    const top = y + r.height + PAD > window.innerHeight ? Math.max(PAD, window.innerHeight - r.height - PAD) : y;
    setPos({ left, top });
  }, [x, y, items.length]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = e => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    // Dismissal listens on the CAPTURE phase, not window's bubble phase.
    //
    // A bubble listener on window never fires when something between the click
    // and window calls stopPropagation — and that is exactly what a modal card
    // does so its own backdrop doesn't close it. React forwards
    // stopPropagation to the native event, so the menu became undismissable
    // for every click inside the panel. Capture runs before any of that.
    //
    // pointerdown (not click) so a press dismisses immediately, and clicks
    // INSIDE the menu are excluded so an item's own handler still runs.
    const onDown = e => {
      const t = e.target;
      if (cardRef.current?.contains(t) || subRef.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    // Scroll closes: the anchor is a cursor position, so once the page moves
    // underneath, the menu points at nothing.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const openSub = (key) => {
    setSubKey(key);
    if (!key) { setSubPos(null); return; }
    const el = cardRef.current?.querySelector(`[data-mi="${key}"]`);
    const card = cardRef.current?.getBoundingClientRect();
    if (!el || !card) return;
    const r = el.getBoundingClientRect();
    setSubPos({ left: card.right - 2, top: r.top, flip: card.right + 190 > window.innerWidth, cardLeft: card.left });
  };

  const activeSub = items.find(i => i.key === subKey && i.submenu)?.submenu ?? null;

  const card = {
    position: "fixed", zIndex: 10050,
    background: "var(--bg-surface)", border: "1px solid var(--border-2)",
    borderRadius: 6, boxShadow: "var(--shadow-modal)", padding: "4px 0",
    minWidth: compact ? 140 : 168, maxWidth: 260,
    fontFamily: "'Inter', system-ui, sans-serif",
  };

  return createPortal(
    <>
      <div
        ref={cardRef}
        role="menu"
        onClick={e => e.stopPropagation()}
        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); }}
        style={{ ...card, left: pos.left, top: pos.top }}
      >
        {items.map((item, i) => (
          <div key={item.key ?? `d${i}`} data-mi={item.key ?? `d${i}`}>
            <MenuItem item={item} onClose={onClose} compact={compact}
              isSubOpen={subKey === item.key} onOpenSub={openSub} />
          </div>
        ))}
      </div>

      {activeSub && subPos && (
        <div
          ref={subRef}
          role="menu"
          onClick={e => e.stopPropagation()}
          style={{
            ...card, minWidth: 170, maxWidth: 280,
            top: Math.min(subPos.top, Math.max(PAD, window.innerHeight - 240)),
            left: subPos.flip ? Math.max(PAD, subPos.cardLeft - 168) : subPos.left,
            maxHeight: 240, overflowY: "auto",
          }}
        >
          {activeSub.length === 0 ? (
            <div style={{ padding: "6px 11px", fontSize: compact ? 9.5 : 10.5, color: "var(--text-6)", fontStyle: "italic" }}>
              {items.find(i => i.key === subKey)?.emptyLabel ?? "—"}
            </div>
          ) : activeSub.map((sub, i) => (
            <button
              key={sub.key ?? i}
              role="menuitem"
              disabled={sub.disabled}
              onClick={e => { e.stopPropagation(); if (sub.disabled) return; sub.onSelect?.(); onClose(); }}
              style={{
                display: "flex", alignItems: "center", gap: 6, width: "100%",
                padding: compact ? "3px 9px" : "4px 11px",
                paddingLeft: (compact ? 9 : 11) + (sub.depth ?? 0) * 11,
                border: "none", background: "transparent", textAlign: "left",
                color: sub.disabled ? "var(--text-6)" : "var(--text-2)",
                fontSize: compact ? 10 : 11, fontFamily: "inherit",
                cursor: sub.disabled ? "default" : "pointer",
                opacity: sub.disabled ? 0.45 : 1, borderRadius: 3,
              }}
              onMouseOver={e => { if (!sub.disabled) e.currentTarget.style.background = "var(--bg-surface-2)"; }}
              onMouseOut={e => { e.currentTarget.style.background = "transparent"; }}
            >
              {sub.icon && (
                <span aria-hidden="true" style={{ display: "inline-flex", flexShrink: 0, width: 14, justifyContent: "center" }}>
                  {sub.icon}
                </span>
              )}
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {sub.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </>,
    document.body
  );
}
