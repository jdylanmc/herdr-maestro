// Terminal screen text from `hc read --json`, cleaned for previews. Pure; never persisted.

// CSI, OSC (BEL or ST terminated), other ESC sequences, then remaining C0/C1 controls.
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[P^_][^\x1b]*\x1b\\|\x1b[@-Z\\-_]|\x9b[0-?]*[ -/]*[@-~]/g;
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;
// Lines made only of box drawing, block elements and blanks (input frames, rules).
const DECOR = /^[\s\u2500-\u259f\u25cb-\u25cf\u2800-\u28ff]*$/;
const EDGE = /[\s\u2502\u2503\u2551\u258f\u2595]/;

function trimEdges(line) {
  let start = 0, end = line.length;
  while (start < end && EDGE.test(line[start])) start++;
  while (end > start && EDGE.test(line[end - 1])) end--;
  return line.slice(start, end);
}

export function stripControls(s) {
  return String(s ?? "")
    .replace(ANSI, "")
    .split("\n")
    .map((l) => { const r = l.lastIndexOf("\r", l.length - 2); return (r >= 0 ? l.slice(r + 1) : l).replace(CONTROL, ""); })
    .join("\n");
}

// `hc read --json` prints { text, how, complete }; plain output is the text itself.
export function parseRead(stdout) {
  const raw = String(stdout ?? "");
  try { const v = JSON.parse(raw); if (v && typeof v.text === "string") return v.text; } catch {}
  return raw;
}

export const truncate = (s, width) => (s.length > width ? `${s.slice(0, Math.max(0, width - 1))}…` : s);

const meaningful = (text) => stripControls(text).split("\n").map(trimEdges).filter((l) => !DECOR.test(l));

// The last `n` non-empty, non-decorative lines, each at most `width` characters.
export function screenLines(text, n = 8, width = 120) {
  return meaningful(text).slice(-n).map((l) => truncate(l, width));
}

// One line for a blocked agent: the last question on screen, else the last text line.
export function promptLine(text, width = 120) {
  const lines = meaningful(text).slice(-30).map((l) => l.trim());
  const q = [...lines].reverse().find((l) => /\?\s*$/.test(l));
  const line = q ?? lines[lines.length - 1] ?? "";
  return line ? truncate(line, width) : "";
}
