// ═══════════════════════════════════════════════════════════════════
// COMPANY SEARCH  — autocomplete input backed by Clearbit suggest API
// ═══════════════════════════════════════════════════════════════════
import { useState, useRef, useEffect } from "react";

export default function CompanySearch({ name, domain, onChange, placeholder = "Company...", inputStyle }) {
  const [query,   setQuery]   = useState(name ?? "");
  const [results, setResults] = useState([]);
  const [open,    setOpen]    = useState(false);
  const timerRef = useRef(null);
  const wrapRef  = useRef(null);

  // Keep input in sync if parent resets the value externally
  useEffect(() => { setQuery(name ?? ""); }, [name]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const fetchSuggestions = q => {
    clearTimeout(timerRef.current);
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    timerRef.current = setTimeout(async () => {
      try {
        const res  = await fetch(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(q)}`);
        const data = await res.json();
        setResults(Array.isArray(data) ? data.slice(0, 7) : []);
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

  const handleChange = e => {
    const v = e.target.value;
    setQuery(v);
    if (!v) onChange(null);
    else fetchSuggestions(v);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", flex: 1, minWidth: 0 }}>
      {/* Input row — logo (if selected) + text field */}
      <div style={{
        display: "flex", alignItems: "center", gap: 4,
        borderBottom: "1px solid var(--border-sub)", paddingBottom: 1,
      }}>
        {domain && (
          <img
            key={domain}
            src={`https://logo.clearbit.com/${domain}`}
            alt=""
            style={{ width: 13, height: 13, borderRadius: 2, objectFit: "contain", flexShrink: 0 }}
            onError={e => { e.target.style.display = "none"; }}
          />
        )}
        <input
          value={query}
          onChange={handleChange}
          onFocus={() => { if (results.length) setOpen(true); }}
          onMouseDown={e => e.stopPropagation()}
          placeholder={placeholder}
          style={{
            fontSize: 11, fontWeight: domain ? 600 : 400,
            color: "var(--text-1)", background: "transparent",
            border: "none", outline: "none", width: "100%", padding: 0,
            ...inputStyle,
          }}
        />
      </div>

      {/* Dropdown */}
      {open && results.length > 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 5px)", left: 0, zIndex: 9999,
          background: "var(--bg-surface)", border: "1px solid var(--border-2)",
          borderRadius: 7, boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
          minWidth: 190, overflow: "hidden",
        }}>
          {results.map(c => (
            <div
              key={c.domain}
              onMouseDown={e => { e.preventDefault(); select(c); }}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "5px 10px", cursor: "pointer",
                fontSize: 12, color: "var(--text-1)",
                transition: "background 0.08s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--card-bg-hov)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
            >
              <img
                src={c.logo}
                alt=""
                style={{ width: 16, height: 16, borderRadius: 3, objectFit: "contain", flexShrink: 0 }}
                onError={e => { e.target.style.display = "none"; e.target.nextSibling.style.paddingLeft = 0; }}
              />
              <span>{c.name}</span>
              <span style={{ fontSize: 10, color: "var(--text-4)", marginLeft: "auto" }}>{c.domain}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
