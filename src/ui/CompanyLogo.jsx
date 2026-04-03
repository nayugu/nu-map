// Renders a company logo using Google's favicon service (no API key, always cross-origin).
// Uses visibility:hidden until loaded to avoid display:none suppressing onLoad.
// Parent must supply key={domain} so the component remounts when domain changes.
import { useState } from "react";

const faviconUrl = domain => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;

export default function CompanyLogo({ domain, size = 36 }) {
  const [visible, setVisible] = useState(false);

  if (!domain) return null;

  return (
    <img
      src={faviconUrl(domain)}
      alt=""
      style={{
        width: size, height: size,
        objectFit: "contain", flexShrink: 0,
        visibility: visible ? "visible" : "hidden",
      }}
      onLoad={() => setVisible(true)}
      onError={() => setVisible(false)}
    />
  );
}
