// Pure pet helpers shared by the Maestro mods (QuickJS), pets.mjs, the CLI and tests (Node).
// mods/maestro-pets/petlib.js is an exact copy (Herdr mods cannot import across mod folders);
// test/pets-lib.test.js fails when they drift.
// No imports: every runtime loads this file as is.

// cmux Maestro's mood rows: [20-row mood atlas, 9-row Codex sheet fallback].
export const MOOD_ROWS = {
  idle: [0, 0], thinking: [11, 8], working: [7, 7], delegating: [12, 1], question: [6, 6],
  "needs-permission": [13, 6], confused: [14, 8], content: [3, 3], startled: [9, 4], sad: [5, 5],
  compacting: [15, 2], sleepy: [16, 0], gone: [17, 0], proud: [18, 3], celebrating: [19, 4],
};
export const MOODS = Object.keys(MOOD_ROWS);
export const DEFAULT_PET = "maestro";
export const ID_RE = /^[A-Za-z0-9._-]+$/;

// The rendered row a pet shows for a mood: its atlas or fallback row, else idle (0).
export function moodRow(pet, mood) {
  const [atlas, fallback] = MOOD_ROWS[mood] ?? MOOD_ROWS.idle;
  const row = pet?.moods ? atlas : fallback;
  return pet?.rows?.includes(row) ? row : 0;
}

// Path for image(), relative to the Herdr app home.
export const moodGif = (pet, mood) => `data/maestro/pets/${pet.id}/${moodRow(pet, mood)}.gif`;

// Where pets come from, in priority order (first id wins).
export function petRoots(home, dataDir) {
  return [
    `${home}/.codex/pets`,
    `${home}/Applications/CMUX Maestro Preview.app/Contents/Extensions/CMUX Maestro Preview Extension.appex/Contents/Resources/maestro-pet.json`,
    `${dataDir}/pet-sources`,
  ];
}

export function petSource(path) {
  const p = String(path).replace(/\\/g, "/");
  if (p.includes("/.codex/pets")) return "codex";
  if (p.includes("/pet-sources")) return "added";
  if (p.includes("CMUX Maestro") || p.endsWith("maestro-pet.json")) return "maestro";
  return "other";
}

// choices.json: { default: id|null, sessions: { [sessionId]: id } }. Tolerates junk.
export function parseChoices(text) {
  let v = null;
  try { v = typeof text === "string" ? JSON.parse(text) : text; } catch {}
  const sessions = {};
  if (v && typeof v.sessions === "object" && v.sessions) {
    for (const [k, id] of Object.entries(v.sessions)) if (typeof id === "string" && ID_RE.test(id)) sessions[k] = id;
  }
  return { default: typeof v?.default === "string" && ID_RE.test(v.default) ? v.default : null, sessions };
}

// A copy with one choice changed. key null sets the default; id null clears.
export function setChoice(choices, key, id) {
  const c = parseChoices(choices);
  if (key == null) c.default = id ?? null;
  else if (id == null) delete c.sessions[key];
  else c.sessions[key] = id;
  return c;
}

// The pet id a session asked for: its own, else the default, else Maestro's pet.
export const chosenPet = (choices, key) => (key != null ? choices?.sessions?.[key] : null) ?? choices?.default ?? DEFAULT_PET;

// The rendered pet to show for an id: that one if it rendered, else the first that did.
export const resolvePet = (pets, id) => (pets ?? []).find((p) => p.id === id && !p.error) ?? (pets ?? []).find((p) => !p.error) ?? null;

// The live cache after reading choices.json: file entries that changed since the previous
// read (all of them on the first) win; picks made only in the cache meanwhile stay.
export function mergeChoices(cache, file, previous = null) {
  const c = parseChoices(cache), f = parseChoices(file), p = previous ? parseChoices(previous) : null;
  const sessions = { ...c.sessions };
  for (const [k, id] of Object.entries(f.sessions)) if (!p || p.sessions[k] !== id) sessions[k] = id;
  if (p) for (const k of Object.keys(p.sessions)) if (!(k in f.sessions) && sessions[k] === p.sessions[k]) delete sessions[k];
  const changed = !p || p.default !== f.default;
  return { default: changed && f.default ? f.default : c.default, sessions };
}

// The cell an arrow key moves to in a picker grid of n cells, cols per row. Left and right wrap;
// up and down stay in the grid (down from a short last row's column lands on its last cell).
export function gridMove(at, key, n, cols) {
  if (n <= 0) return null;
  if (at == null || at < 0 || at >= n) return 0;
  if (key === "right") return (at + 1) % n;
  if (key === "left") return (at + n - 1) % n;
  if (key === "up") return at >= cols ? at - cols : at;
  if (key === "down") return Math.floor(at / cols) < Math.floor((n - 1) / cols) ? Math.min(at + cols, n - 1) : at;
  return at;
}
