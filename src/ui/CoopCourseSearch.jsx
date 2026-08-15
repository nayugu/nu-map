// ═══════════════════════════════════════════════════════════════════
// CO-OP COURSE SEARCH — which course this work term registers
//
// Deliberately the same shape as CompanySearch, which sits directly above it
// on the card: a subtle input that reads as a prompt when empty, a portal
// dropdown that escapes the card's overflow, selection by mousedown so the
// blur does not race the click. Two controls one line apart that behaved
// differently would be the odd thing, not the duplication.
//
// ── Why this is a free-text search and not a picker ─────────────────
//
// A co-op is registered under a course, and which one is genuinely the
// student's to say. The resolver's default is right for 147 of 152 requirement
// nodes, but "right nearly always" is a reason to DEFAULT, not a reason to
// forbid — a student may register for a course their program never lists, and
// this app trusts them ("NU Map trusts the user: the repeat limit is never
// enforced, only reported" — core/repeatInstances.js).
//
// Empty is the normal state and means "use the resolved default", so the
// control costs nothing to ignore. What it shows once set is the CODE, not the
// title: the card has room for four characters, and the title is one click
// away in the info panel.
// ═══════════════════════════════════════════════════════════════════
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { FadeInput } from "./FadeText.jsx";

/**
 * @param {object}   props
 * @param {string}   props.value        currently registered course key, or ""
 * @param {object[]} props.courses      selectable work-experience courses
 * @param {Function} props.onChange     (courseId|null) => void
 * @param {string}   props.placeholder  shown when nothing is chosen
 */
export default function CoopCourseSearch({ value, courses, onChange, color, emptyColor, fontSize = 9, placeholder, align = "left" }) {
  const codeOf = (c) => c?.code ?? `${c?.subject ?? ""} ${c?.number ?? ""}`.trim();
  const current = courses.find(c => c.id === value) ?? null;

  const [query,   setQuery]   = useState(current ? codeOf(current) : "");
  const [results, setResults] = useState([]);
  const [open,    setOpen]    = useState(false);
  const [pos,     setPos]     = useState({ top: 0, left: 0 });
  const wrapRef     = useRef(null);
  const dropdownRef = useRef(null);

  // Sync when the parent resets — e.g. the resolver picks a different default
  // because the student changed program, or an undo rolls the choice back.
  useEffect(() => {
    const c = courses.find(x => x.id === value);
    setQuery(c ? codeOf(c) : "");
  }, [value, courses]);

  useEffect(() => {
    const handler = e => {
      if (wrapRef.current?.contains(e.target)) return;
      if (dropdownRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, []);

  const openAt = () => {
    if (!wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 5, left: r.left });
  };

  // Local list, so no debounce and no network: matches on code and title, and
  // tolerates the space a student types in "COOP 3945".
  const search = (q) => {
    const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!toks.length) return [];
    return courses.filter(c => {
      const hay = `${c.subject} ${c.number} ${c.title}`.toLowerCase();
      const flat = `${c.subject}${c.number}`.toLowerCase();
      return toks.every(tk => hay.includes(tk) || flat.includes(tk));
    }).slice(0, 8);
  };

  const select = (c) => {
    setQuery(codeOf(c));
    setResults([]);
    setOpen(false);
    onChange(c.id);
  };

  const dropdown = open && results.length > 0 && createPortal(
    <div ref={dropdownRef} style={{
      position: "fixed", top: pos.top, left: pos.left, zIndex: 99999,
      background: "var(--bg-surface)", border: "1px solid var(--border-2)",
      borderRadius: 8, boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
      minWidth: 260, maxHeight: 280, overflowY: "auto",
      fontFamily: "'Inter', sans-serif",
    }}>
      {results.map(c => (
        <div
          key={c.id}
          onMouseDown={e => { e.preventDefault(); select(c); }}
          onTouchEnd={e => { e.preventDefault(); select(c); }}
          style={{
            display: "flex", alignItems: "center", gap: 9,
            padding: "8px 12px", cursor: "pointer",
            fontSize: 12, color: "var(--text-1)",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "var(--card-bg-hov)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
        >
          <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{codeOf(c)}</span>
          <span style={{
            fontSize: 10, color: "var(--text-4)", marginLeft: "auto",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 170,
          }}>{c.title}</span>
        </div>
      ))}
    </div>,
    document.body
  );

  return (
    <div ref={wrapRef} style={{ position: "relative", minWidth: 0 }}>
      <FadeInput
        value={query}
        onChange={handleChange}
        onFocus={() => { if (results.length) { openAt(); setOpen(true); } }}
        onMouseDown={e => e.stopPropagation()}
        placeholder={placeholder}
        style={{
          width: "100%", textAlign: align,
          fontFamily: "'Inter', sans-serif",
          fontSize, fontWeight: 500, letterSpacing: "0.04em",
          color: query ? color : (emptyColor ?? "var(--text-5)"),
          background: "transparent", border: "none", outline: "none", padding: 0,
        }}
        className="work-input"
      />
      {dropdown}
    </div>
  );

  function handleChange(e) {
    const v = e.target.value;
    setQuery(v);
    // Clearing returns the block to the resolved default rather than to
    // "no course" — the co-op still registers something, we just stop
    // overriding which.
    if (!v.trim()) { setResults([]); setOpen(false); onChange(null); return; }
    const hits = search(v);
    setResults(hits);
    if (hits.length) { openAt(); setOpen(true); } else setOpen(false);
  }
}
