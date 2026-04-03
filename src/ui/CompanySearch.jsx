// ═══════════════════════════════════════════════════════════════════
// COMPANY SEARCH  — autocomplete input backed by Clearbit suggest API
// Dropdown rendered via portal so it escapes any overflow:hidden parent.
// Logos use Google's favicon service (no API key, always works cross-origin).
// ═══════════════════════════════════════════════════════════════════
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

const faviconUrl = domain => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;

export default function CompanySearch({ name, onChange, color, emptyColor, fontSize = 11, placeholder = "Company", phonePadding = false, align = "right" }) {
  const [query,   setQuery]   = useState(name ?? "");
  const [results, setResults] = useState([]);
  const [open,    setOpen]    = useState(false);
  const [pos,     setPos]     = useState({ top: 0, right: 0 });
  const timerRef    = useRef(null);
  const wrapRef     = useRef(null);
  const dropdownRef = useRef(null);

  // Sync when parent resets the value
  useEffect(() => { setQuery(name ?? ""); }, [name]);

  // Close on outside click/tap — must exclude the portal dropdown too
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
    setPos({ top: r.bottom + 5, right: window.innerWidth - r.right });
  };

  const fetchSuggestions = q => {
    clearTimeout(timerRef.current);
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    timerRef.current = setTimeout(async () => {
      try {
        const res  = await fetch(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const data = await res.json();
        setResults(Array.isArray(data) ? data.slice(0, 7) : []);
        openAt();
        setOpen(true);
      } catch {
        setResults([]);
      }
    }, 220);
  };

  const select = company => {
    setQuery(company.name);
    setResults([]);
    setOpen(false);
    onChange({ name: company.name, domain: company.domain });
  };

  const dropdown = open && results.length > 0 && createPortal(
    <div ref={dropdownRef} style={{
      position: "fixed", top: pos.top, right: pos.right, zIndex: 99999,
      background: "var(--bg-surface)", border: "1px solid var(--border-2)",
      borderRadius: 8, boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
      minWidth: 230, maxHeight: 280, overflowY: "auto",
      fontFamily: "'Inter', sans-serif",
    }}>
      {results.map(c => (
        <div
          key={c.domain}
          onMouseDown={e => { e.preventDefault(); select(c); }}
          onTouchEnd={e => { e.preventDefault(); select(c); }}
          style={{
            display: "flex", alignItems: "center", gap: 9,
            padding: "10px 12px", cursor: "pointer",
            fontSize: 12, color: "var(--text-1)",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "var(--card-bg-hov)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
        >
          <img
            src={faviconUrl(c.domain)}
            alt=""
            style={{ width: 20, height: 20, objectFit: "contain", flexShrink: 0 }}
            onError={e => { e.target.style.display = "none"; }}
          />
          <span style={{ fontWeight: 600, fontFamily: "'Inter', sans-serif" }}>{c.name}</span>
          <span style={{ fontSize: 10, color: "var(--text-4)", marginLeft: "auto" }}>{c.domain}</span>
        </div>
      ))}
    </div>,
    document.body
  );

  return (
    <div ref={wrapRef} style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <input
        value={query}
        onChange={handleChange}
        onFocus={() => { if (results.length) { openAt(); setOpen(true); } }}
        onMouseDown={e => e.stopPropagation()}
        placeholder={placeholder}
        style={{
          width: "100%", textAlign: align,
          fontFamily: "'Inter', sans-serif",
          // iOS Safari zooms in on inputs with font-size < 16px; use 16px and
          // visually scale down so the text still appears at the intended size.
          fontSize: phonePadding ? 16 : fontSize,
          transform: phonePadding ? `scale(${fontSize / 16})` : undefined,
          transformOrigin: "right center",
          fontWeight: 600, letterSpacing: "0.01em",
          color: query ? color : (emptyColor ?? "var(--text-5)"),
          background: "transparent", border: "none", outline: "none",
          padding: phonePadding ? "5px 0" : 0,
          touchAction: "manipulation",
        }}
        className="work-input"
      />
      {dropdown}
    </div>
  );

  function handleChange(e) {
    const v = e.target.value;
    setQuery(v);
    if (!v) onChange(null);
    else fetchSuggestions(v);
  }
}
