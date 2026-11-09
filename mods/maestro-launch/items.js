// The launch menu's rows: Copilot first (always startable, Maestro's default), the other
// installed agents, a few not-installed ones (shown dimmed), then "In another folder…" on a
// local space only (the folder picker is this machine's). Startable agents get keys 1–9.

export const FOLDER = "folder";

export function launchItems(agents = [], { local = true } = {}) {
  const copilot = agents.find((a) => a.key === "copilot") ?? { key: "copilot", name: "Copilot" };
  const rest = agents.filter((a) => a.key !== "copilot");
  const items = [
    { ...copilot, kind: "agent", ok: true },
    ...rest.filter((a) => a.installed !== false).map((a) => ({ ...a, kind: "agent", ok: true })),
    ...rest.filter((a) => a.installed === false).slice(0, 3).map((a) => ({ ...a, kind: "agent", ok: false })),
  ];
  let n = 0;
  for (const it of items) if (it.ok && n < 9) it.hotkey = String(++n);
  if (local) items.push({ key: FOLDER, name: "In another folder…", kind: FOLDER, ok: true });
  return items;
}

// The next selectable row from `at` in direction `step` (wrapping), skipping dimmed ones.
export function moveSelection(items, at, step) {
  const n = items.length;
  for (let i = 1; i <= n; i++) {
    const j = (((at + step * i) % n) + n) % n;
    if (items[j].ok) return j;
  }
  return at;
}
