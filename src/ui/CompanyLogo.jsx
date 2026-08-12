// Renders a company logo, picked by resolveCompanyLogo as the sharpest of
// several sources. When no source clears MIN_LOGO_PX we render an empty box
// of the same size: the layout holds, and nothing ugly stands in for the
// logo — no globe, no placeholder glyph.
// Parent must supply key={domain} so the component remounts when domain changes.
import { useState, useEffect } from "react";
import { resolveCompanyLogo } from "../core/companyLogo.js";

/**
 * The resolved logo URL for a company, or null while resolving and when it
 * has none worth showing. For surfaces that cannot render the component
 * itself — the load timeline draws logos as SVG <image> — so that they still
 * show the same logo as everywhere else.
 *
 * `name` is passed through because a curated logo can be pinned to a company
 * by name: a work term typed in without a domain still gets its logo.
 */
export function useCompanyLogo(domain, name) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    resolveCompanyLogo(domain, name).then(u => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [domain, name]);
  return url;
}

export default function CompanyLogo({ domain, name, size = 36 }) {
  const [failed, setFailed] = useState(false);
  const resolved = useCompanyLogo(domain, name);
  const url = failed ? null : resolved;

  useEffect(() => { setFailed(false); }, [resolved]);

  if (!domain && !name) return null;

  // The reserved box: rendered whether or not a logo arrives, so a co-op row
  // does not reflow when resolution finishes (or fails).
  const box = { width: size, height: size, flexShrink: 0 };

  if (!url) return <div style={box} aria-hidden="true" />;

  return (
    <img
      src={url}
      alt=""
      style={{ ...box, objectFit: "contain" }}
      onError={() => setFailed(true)}
    />
  );
}
