// Pins, auto-settled worker tabs and the needs-you chime: pure decisions, no Herdr calls.

// Pinned agents first; a stable sort keeps the existing order otherwise.
export const pinFirst = (p, q) => Number(Boolean(q?.pinned)) - Number(Boolean(p?.pinned));

export const NEEDS_YOU = new Set(["question", "permission"]);

// One step over the live agents. `mem` (Map address -> state) is updated in place.
// Each item: { address, tab, status, needs, herdrChimes, worker, tabSettled }.
// opts: { sounds, settle, debounceMs }. Returns the actions to run, at most one sound.
export function alertStep(mem, items, now, opts) {
  const actions = [];
  const seen = new Set();
  let chime = false;
  for (const it of items) {
    seen.add(it.address);
    let m = mem.get(it.address);
    // First sight records the state without acting: no chime for agents already waiting.
    if (!m) { m = { needs: it.needs, worked: it.status === "working", mine: false, want: null, since: now }; mem.set(it.address, m); continue; }
    if (opts.sounds && it.needs && !m.needs && !it.herdrChimes) chime = true;
    m.needs = it.needs;
    if (it.status === "working") m.worked = true;
    if (!it.worker || !it.tab) continue;
    // Someone else showed the tab again (after Herdr reported our settle): no longer ours to bring back.
    if (m.mine && it.tabSettled) m.confirmed = true;
    else if (m.mine && m.confirmed) m.mine = false;
    const want = it.needs || it.status === "working" || it.status === "blocked" ? "unsettle"
      : (it.status === "done" || it.status === "idle") && m.worked ? "settle" : null;
    if (want !== m.want) { m.want = want; m.since = now; }
    if (!opts.settle || !want || now - m.since < opts.debounceMs) continue;
    if (want === "settle" && !it.tabSettled) {
      actions.push({ type: "settle", tab: it.tab, address: it.address });
      m.mine = true;
      m.confirmed = false;
      m.worked = false;
    } else if (want === "unsettle" && m.mine && it.tabSettled) {
      actions.push({ type: "unsettle", tab: it.tab, address: it.address });
      m.mine = false;
    }
  }
  for (const k of [...mem.keys()]) if (!seen.has(k)) mem.delete(k);
  if (chime) actions.unshift({ type: "sound" });
  return actions;
}
