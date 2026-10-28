// Selection glow colour, shared by the board card and the scratch pad chip so
// a selected course reads the same wherever it is drawn.
//
// Normalise the subject colour in HSL: lift only the *lightness* to a floor so
// dark/muted subjects (maroon, grey math) still glow lively, while preserving
// saturation so vivid subjects (e.g. CS green) stay rich instead of washing
// out to pastel (mixing toward white was the cause of the pastel look).
// (hex is a 6-digit hex — a SUBJECT_PALETTE slot, or the theme's ink.
// Ink is achromatic, so the lightness floor alone carries it: white glows
// white, black glows the neutral grey the floor lifts it to.)
//
// Returns "r,g,b" for use inside rgba().
export function glowRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let l = (max + min) / 2;
  const s = d === 0 ? 0 : (l > 0.5 ? d / (2 - max - min) : d / (max + min));
  let h = 0;
  if (d !== 0) {
    h = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  }
  l = Math.max(l, 0.6);                                          // bright floor; saturation untouched
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [rr, gg, bb] =
    h < 60  ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `${Math.round((rr + m) * 255)},${Math.round((gg + m) * 255)},${Math.round((bb + m) * 255)}`;
}
