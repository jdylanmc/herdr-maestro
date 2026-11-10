// Agent icons. Precedence: the human's pick > the agent's own > its program's icon > one by key.
// - Human: shared("maestro.icons") = { [tagKey]: { icon, color } }, set in the maestro-icon popup;
//   keyed like tags and pets (session id, else terminal address), so it outlives the terminal.
// - Agent: its record's `icon`/`color` (`maestro icon`), gone with its terminal.
// - Program: other coding agents' icon from Herdr (main.js draws it).
// - Else a preset and a palette color picked by hashing the key.
// An icon is a preset name (ICONS) or one Nerd Font glyph; a color a theme color name or "#rrggbb".
// mods/maestro-icon/agenticon.js is an exact copy (test/agenticon.test.js checks).

export const ICON_KEY = "maestro.icons";
export const ICONS = {
  robot: "\u{F06A9}", code: "\u{F121}", bug: "\u{F188}", eye: "\u{F06E}", shield: "\u{F132}", compass: "\u{F14E}",
  brush: "\u{F1FC}", flask: "\u{F0C3}", rocket: "\u{F135}", cogs: "\u{F085}", search: "\u{F002}", book: "\u{F02D}",
  terminal: "\u{F120}", wrench: "\u{F0AD}", lightbulb: "\u{F0EB}", heart: "\u{F004}", star: "\u{F005}", bolt: "\u{F0E7}",
};
// The picker's colors: the six ANSI hues and the accent, then the bright hues.
export const COLORS = ["ansi1", "ansi2", "ansi3", "ansi4", "ansi5", "ansi6", "accent", "ansi9", "ansi10", "ansi11", "ansi12", "ansi13", "ansi14"];
// Theme names `maestro icon` also accepts.
const NAMES = new Set([...COLORS, "working", "blocked", "done"]);

export const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619); return h >>> 0; };

// A preset name, or one glyph (a trailing emoji/text variation selector is dropped); else null.
export function parseGlyph(s) {
  const v = String(s ?? "").trim();
  if (Object.prototype.hasOwnProperty.call(ICONS, v)) return v;
  const g = v.replace(/[\uFE0E\uFE0F]$/, "");
  return [...g].length === 1 && /\S/.test(g) ? g : null;
}

// A theme color name, or "#rrggbb" (lowercase) from "#RRGGBB" or "rrggbb"; else null.
export function parseColor(s) {
  const v = String(s ?? "").trim();
  if (NAMES.has(v)) return v;
  const m = /^#?([0-9a-f]{6})$/i.exec(v);
  return m ? `#${m[1].toLowerCase()}` : null;
}

// A stored choice with only valid fields; null when nothing valid remains.
export function cleanChoice(v) {
  if (!v || typeof v !== "object") return null;
  const icon = v.icon == null ? null : parseGlyph(v.icon);
  const color = v.color == null ? null : parseColor(v.color);
  return icon || color ? { icon, color } : null;
}

// The icon to draw: { source, glyph } or { source: "program", program }, with `color` (a theme name or
// hex, null for the caller's hashed palette pick). A human color alone recolors the agent's or auto icon.
export function resolveIcon({ human, agent, program, key }) {
  const h = cleanChoice(human);
  const icon = h?.icon ?? agent?.icon ?? null;
  const color = h?.color ?? agent?.color ?? null;
  const source = h?.icon ? "human" : agent?.icon ? "agent" : program?.icon ? "program" : "auto";
  if (source === "program") return { source, program, color };
  const glyph = icon ? (ICONS[icon] ?? icon) : Object.values(ICONS)[hash(key) % Object.keys(ICONS).length];
  return { source, glyph, color };
}

// maestro.icons with the key's choice set (null or nothing valid: removed, so the agent's or auto shows).
export function withIcon(icons, key, value) {
  const next = { ...(icons ?? {}) };
  const v = cleanChoice(value);
  if (v) next[key] = v;
  else delete next[key];
  return next;
}

// The picker's keyboard items: the presets in rows of 6, then the theme's colors in rows of 7. Each item's
// `at` is its index in the flat list, the one keyboard focus (pickerStep) and the rendered rings share.
export const ICON_COLS = 6;
export const COLOR_COLS = 7;
export function pickerItems(colors) {
  const items = [...Object.keys(ICONS).map((icon) => ({ icon })), ...colors.map((color) => ({ color }))].map((it, at) => ({ ...it, at }));
  const rows = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, k) => list.slice(k * n, (k + 1) * n));
  return { items, icons: rows(items.filter((it) => it.icon), ICON_COLS), colors: rows(items.filter((it) => it.color), COLOR_COLS) };
}

// Focus after an arrow key: left/right step (wrapping), up/down move a row of icons or of colors.
export function pickerStep(at, key, n, isColor) {
  const row = isColor ? COLOR_COLS : ICON_COLS;
  if (key === "right") return at == null ? 0 : (at + 1) % n;
  if (key === "left") return at == null ? n - 1 : (at + n - 1) % n;
  if (key === "down") return at == null ? 0 : Math.min(n - 1, at + row);
  if (key === "up") return at == null ? n - 1 : Math.max(0, at - row);
  return at;
}

// The popup's size. Herdr sizes a popup to its content (`height` is only the most it grows to), so the
// picker sets its own height from this too.
export const PICKER = { width: 300, height: 384 };
