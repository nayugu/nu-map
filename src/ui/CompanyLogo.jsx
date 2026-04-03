// Renders a company logo using Google's favicon service (no API key, always cross-origin).
// Only appears after the image successfully loads — no empty-box flash.
import { useState, useEffect } from "react";

const faviconUrl = domain => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;

export default function CompanyLogo({ domain, size = 36 }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => { setVisible(false); }, [domain]);

  if (!domain) return null;

  const src = faviconUrl(domain);

  return (
    <>
      {/* Hidden preloader — keeps img in DOM so browser fetches and caches it */}
      <img
        key={src}
        src={src}
        alt=""
        style={{ display: "none", position: "absolute", pointerEvents: "none" }}
        onLoad={() => setVisible(true)}
        onError={() => setVisible(false)}
      />
      {visible && (
        <img
          src={src}
          alt=""
          style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }}
        />
      )}
    </>
  );
}
