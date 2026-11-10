import { test } from "node:test";
import assert from "node:assert/strict";
import { launchItems, launchHeight, moveSelection, FOLDER, ROW_H, MAX_H } from "../mods/maestro-launch/items.js";

const agents = [
  { key: "claude", installed: true },
  { key: "aider", installed: false },
  { key: "copilot", installed: true },
  { key: "codex" },
  { key: "a", installed: false }, { key: "b", installed: false }, { key: "c", installed: false },
];

test("Copilot first, installed agents next, at most three not installed, folder last when local", () => {
  const items = launchItems(agents, { local: true });
  assert.deepEqual(items.map((i) => i.key), ["copilot", "claude", "codex", "aider", "a", "b", FOLDER]);
  assert.deepEqual(items.map((i) => i.ok), [true, true, true, false, false, false, true]);
  assert.deepEqual(items.map((i) => i.hotkey ?? null), ["1", "2", "3", null, null, null, null]);
});

test("remote spaces get no folder item; Copilot is offered before agents load", () => {
  assert.deepEqual(launchItems(agents, { local: false }).map((i) => i.key).at(-1), "b");
  assert.deepEqual(launchItems([], { local: true }).map((i) => i.key), ["copilot", FOLDER]);
  assert.deepEqual(launchItems([], { local: false }).map((i) => i.key), ["copilot"]);
});

test("hotkeys stop at 9", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ key: `x${i}`, installed: true }));
  assert.equal(launchItems(many).filter((i) => i.hotkey).length, 9);
});

test("selection wraps and skips agents that are not installed", () => {
  const items = launchItems(agents, { local: true });
  assert.equal(moveSelection(items, 2, 1), 6);
  assert.equal(moveSelection(items, 6, 1), 0);
  assert.equal(moveSelection(items, 0, -1), 6);
  assert.equal(moveSelection(items, 6, -1), 2);
});

test("the menu sets its own height so its rows show in a content-sized popup", () => {
  const one = launchItems([], { local: false });
  assert.ok(launchHeight(one) >= ROW_H + 24, "the Copilot row fits under the heading");
  const local = launchItems([], { local: true });
  assert.ok(launchHeight(local, { loading: true }) > launchHeight(local), "room for the loading note");
  assert.ok(launchHeight(local) >= local.length * ROW_H + 24);
  const many = Array.from({ length: 20 }, (_, i) => ({ key: `x${i}`, installed: true }));
  assert.equal(launchHeight(launchItems(many)), MAX_H, "a long list scrolls inside the cap");
});
