// Space colors, shared with Herdr's own Spaces sidebar through shared("space.colors") =
// { [spaceId]: value }. A value is a theme color name (so it follows the theme) or "#rrggbb".
// No entry: Herdr's Spaces sidebar assigns one of AUTO; until then a space shows DEFAULT.
// mods/maestro-color/spacecolor.js is an exact copy (test/spacecolor.test.js checks).

// How Herdr's Spaces sidebar draws its auto names (mods/spaces MARK), so both agree.
export const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
export const AUTO = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
// Theme colors beyond Herdr's six: the accent and the bright ANSI hues.
export const THEMED = ["accent", "ansi9", "ansi10", "ansi11", "ansi12", "ansi13", "ansi14"];
export const DEFAULT = "ansi6";

// "#rrggbb" (lowercase) from "#RRGGBB" or "rrggbb", else null.
export function parseHex(s) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(s ?? "").trim());
  return m ? `#${m[1].toLowerCase()}` : null;
}

export function spaceFill(t, value) {
  const v = value || DEFAULT;
  if (v.startsWith("#")) return v;
  return MARK[v] ?? t?.[v] ?? t?.accent ?? MARK[DEFAULT];
}

// Avatar letter color: dark on light fills, white otherwise (and for anything not hex).
export function inkOn(fill) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(String(fill ?? ""));
  if (!m) return "#ffffff";
  const [r, g, b] = m.slice(1).map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#000000" : "#ffffff";
}

// The picker's swatches: Herdr's six, then the theme's that exist and look different.
export function swatches(t) {
  const seen = new Set();
  const out = [];
  for (const name of [...AUTO, ...THEMED]) {
    const fill = MARK[name] ?? t?.[name];
    if (!fill || seen.has(fill.toLowerCase())) continue;
    seen.add(fill.toLowerCase());
    out.push({ name, fill, group: AUTO.includes(name) ? "herdr" : "theme" });
  }
  return out;
}

// space.colors with the space's color set (null: removed, so Herdr picks again).
export function withColor(colors, id, value) {
  const next = { ...(colors ?? {}) };
  if (value) next[id] = value;
  else delete next[id];
  return next;
}
