// Small colour helpers so every page, whatever palette it is given, keeps readable text.
function parse(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const isHex = h => parse(h) !== null;
function luminance(hex) {
  const c = parse(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
const mix = (a, b, t) => { const A = parse(a), B = parse(b); return toHex(A.map((v, i) => v + (B[i] - v) * t)); };
// Nudge `fg` toward black (or white on dark backgrounds) until it reaches `min` contrast against `bg`.
function ensureContrast(fg, bg, min = 4.5) {
  const target = luminance(bg) > 0.4 ? '#000000' : '#ffffff';
  let c = fg;
  for (let i = 0; i < 40 && contrast(c, bg) < min; i++) c = mix(c, target, 0.06);
  return c;
}
// Text colour to sit on top of `bg`.
function onColor(bg, light = '#ffffff', dark = '#14200f') {
  return contrast(bg, light) >= contrast(bg, dark) ? light : dark;
}
module.exports = { parse, toHex, isHex, luminance, contrast, mix, ensureContrast, onColor };
