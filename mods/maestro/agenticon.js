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

// The popup's size. Herdr sizes a popup to its content (`height` is only the most it grows to), so the
// picker sets its own height from this too.
export const PICKER = { width: 300, height: 384 };
