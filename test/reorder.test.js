import { test } from "node:test";
import assert from "node:assert/strict";
import { pastThreshold, canDrop, moveKey, lineEdge, mergeOrder, arrange, spaceGroups, spaceMoveIndex } from "../mods/maestro/reorder.js";
import { nestSpaces } from "../mods/maestro/wtlib.js";

test("a press only becomes a drag past the threshold", () => {
  assert.equal(pastThreshold({ x: 10, y: 10 }, { x: 12, y: 12 }), false);
  assert.equal(pastThreshold({ x: 10, y: 10 }, { x: 10, y: 14 }), true);
  assert.equal(pastThreshold(null, { x: 0, y: 0 }), false);
});

test("drops stay within one kind, group and band", () => {
  const a = { kind: "agent", id: "a", group: "wt:sp1:~/git", band: false };
  assert.equal(canDrop(a, { ...a, id: "b" }), true);
  assert.equal(canDrop(a, a), false);
  assert.equal(canDrop(a, { ...a, id: "b", group: "wt:sp1:other" }), false);
  assert.equal(canDrop(a, { ...a, id: "b", band: true }), false, "pinned and unpinned are separate bands");
  assert.equal(canDrop(a, { ...a, id: "b", kind: "space" }), false);
  const sp = { kind: "space", id: "s1", group: "", band: null };
  assert.equal(canDrop(sp, { ...sp, id: "s2", group: "vps" }), false, "spaces only move within their machine");
});

test("dragging a card above its sibling swaps them and the line shows where", () => {
  // Human's case: "Build Herdr Color Themes" dragged above "lead" in the same worktree.
  const keys = ["lead", "themes"];
  assert.equal(lineEdge(keys, "themes", "lead"), "top");
  assert.deepEqual(moveKey(keys, "themes", "lead"), ["themes", "lead"]);
  assert.equal(lineEdge(["a", "b", "c"], "a", "c"), "bottom");
  assert.deepEqual(moveKey(["a", "b", "c"], "a", "c"), ["b", "c", "a"]);
  assert.deepEqual(moveKey(["a", "b"], "a", "x"), ["a", "b"]);
  assert.equal(lineEdge(["a", "b"], "a", "a"), null);
});

test("the saved order sticks and pins stay first", () => {
  const items = [{ k: "lead" }, { k: "themes" }, { k: "pin", pinned: true }, { k: "new" }];
  const order = mergeOrder(["other", "lead", "themes"], moveKey(["lead", "themes"], "themes", "lead"));
  assert.deepEqual(order, ["other", "themes", "lead"]);
  const out = arrange(items, (x) => x.k, order, (x) => x.pinned).map((x) => x.k);
  assert.deepEqual(out, ["pin", "themes", "lead", "new"], "unsaved agents follow saved ones in their given order");
  assert.deepEqual(arrange(items, (x) => x.k, null).map((x) => x.k), ["lead", "themes", "pin", "new"]);
});

test("the saved order is capped, oldest first out", () => {
  assert.deepEqual(mergeOrder(["a", "b", "c"], ["d", "e"], 3), ["c", "d", "e"]);
});

// Herdr's space.move: take `id` out, put it back at 1-based `index`.
const herdrMove = (raw, id, index) => { const out = raw.filter((r) => r.id !== id); out.splice(index - 1, 0, raw.find((r) => r.id === id)); return out; };
const repo = (main, linked = false) => ({ main, linked });
const shown = (raw) => nestSpaces(raw).map((r) => r.id);
// One drag as the sidebar does it: groups from the shown order, the line's edge, then space.move.
function drag(raw, from, to) {
  const entries = nestSpaces(raw).map((r) => ({ sp: { id: r.id }, tree: r.tree }));
  const items = new Map(spaceGroups(entries).map((g) => [g.id, { kind: "space", ...g }]));
  if (!canDrop(items.get(from), items.get(to))) return null;
  const index = spaceMoveIndex(raw.map((r) => r.id), from, to, lineEdge(items.get(from).keys, from, to));
  return herdrMove(raw, from, index);
}

test("space drops follow the nesting the sidebar shows", () => {
  // Herdr's order [A, B, W] with W a worktree of A; the sidebar shows [A, W, B].
  const raw = [{ id: "A", g: repo("/a") }, { id: "B", g: repo("/b") }, { id: "W", g: repo("/a", true) }];
  assert.deepEqual(shown(raw), ["A", "W", "B"]);
  assert.equal(drag(raw, "B", "W"), null, "a top-level space can't land among another's worktrees");
  assert.equal(drag(raw, "W", "B"), null, "a worktree space stays under its parent");
  assert.deepEqual(shown(drag(raw, "B", "A")), ["B", "A", "W"]);
  assert.deepEqual(shown(drag(raw, "A", "B")), ["B", "A", "W"], "a parent moves with its worktrees");
  const two = [{ id: "A", g: repo("/a") }, { id: "W1", g: repo("/a", true) }, { id: "B", g: repo("/b") }, { id: "W2", g: repo("/a", true) }];
  assert.deepEqual(shown(drag(two, "W2", "W1")), ["A", "W2", "W1", "B"]);
  assert.deepEqual(shown(drag(two, "W1", "W2")), ["A", "W2", "W1", "B"]);
});

test("space groups keep machines apart", () => {
  const groups = spaceGroups([{ sp: { id: "a" }, tree: null }, { sp: { id: "header", header: true } }, { sp: { id: "box/a", machine: "box" }, tree: null }]);
  assert.deepEqual(groups.map((g) => [g.id, g.group, g.band, [...g.keys]]), [["a", "", null, ["a"]], ["box/a", "box", null, ["box/a"]]]);
  assert.equal(spaceMoveIndex(["a", "b"], "a", "missing", "top"), null);
});
