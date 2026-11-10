// Drag-to-reorder in the Maestro sidebar: pure decisions, no Herdr imports, so node:test can load it.
// A drag item: { kind: "agent" | "space" | "tree", id, group, band, keys } where keys are the
// ids of its group in shown order. Agents keep pinned and unpinned as separate bands.

export const DRAG_THRESHOLD = 4;
export const ORDER_CAP = 500;

// A press becomes a drag once the pointer has moved this far, so clicks stay clicks.
export function pastThreshold(start, pos, px = DRAG_THRESHOLD) {
  if (!start || !pos) return false;
  return Math.hypot(pos.x - start.x, pos.y - start.y) >= px;
}

// Whether `src` may land on `dst`: same kind, same group, same band, another item.
export function canDrop(src, dst) {
  return Boolean(src && dst) && src.kind === dst.kind && src.id !== dst.id
    && src.group === dst.group && (src.band ?? null) === (dst.band ?? null);
}

// keys with `from` moved into `to`'s place (as Herdr's space.move does); unchanged when either is missing.
export function moveKey(keys, from, to) {
  const i = keys.indexOf(from);
  const j = keys.indexOf(to);
  if (i < 0 || j < 0 || i === j) return [...keys];
  const out = keys.filter((k) => k !== from);
  out.splice(j, 0, from);
  return out;
}

// Where the insertion line goes on the hovered row: below it when moving down, above when moving up.
export function lineEdge(keys, from, to) {
  const i = keys.indexOf(from);
  const j = keys.indexOf(to);
  if (i < 0 || j < 0 || i === j) return null;
  return i < j ? "bottom" : "top";
}

// The saved order with one group's new order: its keys move to the end (only relative order
// within a group matters), oldest entries drop past the cap.
export function mergeOrder(order, keys, cap = ORDER_CAP) {
  const set = new Set(keys);
  return [...(Array.isArray(order) ? order : []).filter((k) => !set.has(k)), ...keys].slice(-cap);
}

// Items in their saved order: pinned first, then ranked ones by saved position, then the rest
// in the order given (a stable sort). keyOf may return one key or candidate keys.
export function arrange(items, keyOf, order, pinnedOf = () => false) {
  const rank = new Map((Array.isArray(order) ? order : []).map((k, n) => [k, n]));
  // keyOf may give several keys (current first, then older ones it was saved under).
  const r = (x) => { for (const k of [keyOf(x)].flat()) if (rank.has(k)) return rank.get(k); return Infinity; };
  return [...items].sort((p, q) => {
    const pin = Number(Boolean(pinnedOf(q))) - Number(Boolean(pinnedOf(p)));
    if (pin) return pin;
    const a = r(p);
    const b = r(q);
    return a === b ? 0 : a === Infinity ? 1 : b === Infinity ? -1 : a - b;
  });
}

// Space drop groups from the sidebar's nested order ([{ sp, tree }], tree set on worktree spaces shown
// under the space before them): top-level spaces move among each other per machine, worktree spaces
// only among their parent's. Returns [{ id, group, band, keys }].
export function spaceGroups(entries) {
  const out = [];
  const groups = new Map();
  let parent = null;
  for (const { sp, tree } of entries) {
    if (!sp || sp.header) continue;
    if (!tree) parent = sp.id;
    const group = sp.machine ?? "";
    const band = tree ? parent : null;
    const k = `${group}\n${band ?? ""}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(sp.id);
    out.push({ id: sp.id, group, band, keys: groups.get(k) });
  }
  return out;
}

// The 1-based `space.move` index that puts `from` right above (edge "top") or below ("bottom") `to`
// in Herdr's own order, so nesting shows the order the line promised; null when it can't.
export function spaceMoveIndex(rawIds, from, to, edge) {
  const rest = rawIds.filter((id) => id !== from);
  const j = rest.indexOf(to);
  if (j < 0 || !rawIds.includes(from) || !edge) return null;
  return j + (edge === "bottom" ? 1 : 0) + 1;
}

// Stable start order: each key keeps the slot it had when first seen, new keys append. `mem` is
// { at: Map, next } and updated in place; keys never leave so hidden-then-shown rows keep their slot.
export function startOrder(mem, keys) {
  for (const k of keys) if (!mem.at.has(k)) mem.at.set(k, mem.next++);
  return mem;
}

// Siblings by start order only. Status, focus, activity (Herdr's seq) and time never move a row.
export function byStart(mem, keyOf) {
  const r = (x) => mem.at.get(keyOf(x)) ?? Infinity;
  return (p, q) => { const a = r(p); const b = r(q); return a === b ? 0 : a === Infinity ? 1 : b === Infinity ? -1 : a - b; };
}

// The new keys a drag's mouse-up on `id` commits, or null: only a press that passed the threshold
// and lands on another droppable row reorders; a click or a drop on its own slot changes nothing.
export function dropKeys(drag, id, dst) {
  if (!drag?.moved || drag.over !== id || !canDrop(drag, dst)) return null;
  const keys = moveKey(drag.keys, drag.id, id);
  return keys.every((k, n) => k === drag.keys[n]) ? null : keys;
}
