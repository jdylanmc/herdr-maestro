import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadMenu({ target, paneList = [], terminalList = [], keyList = [] }) {
  const commands = [];
  const element = () => {
    let proxy;
    proxy = new Proxy({}, {
      get: (_t, key) => (...args) => {
        if (key === "when" && args[0]) args[1](proxy);
        return proxy;
      },
    });
    return proxy;
  };
  const overlay = { tab: "pane", target, overlay: "menu-1" };
  const context = vm.createContext({
    View: class {},
    div: element, v_flex: element, h_flex: element, svg: element,
    props: () => overlay,
    run: (command, args) => commands.push([command, { ...args }]),
    closeOverlay() {},
    theme: () => ({}),
    keys: () => keyList,
    terminals: () => terminalList,
    panes: () => paneList,
  });
  const source = readFileSync(new URL("../mods/maestro-menu/main.js", import.meta.url), "utf8")
    .replace(/^import .*;\n/gm, "")
    .replace("export default class", "globalThis.Mod = class");
  vm.runInContext(source, context);
  const menu = new context.Mod();
  menu.init(overlay, { focus_handle: () => ({ focus() {} }) });
  return { menu, commands, labels: () => context.items(overlay).map((it) => it[0]), hint: (i) => { const it = context.items(overlay)[i]; return context.shortcut(it[1], it[2]); } };
}

const keyList = [
  { section: "terminal", keys: "cmd-c", action: "terminal.copy" },
  { section: "terminal", keys: "cmd-v", action: "terminal.paste" },
  { section: "global", keys: "cmd-d", action: "pane.split:right" },
];

test("terminal menu puts Copy and Paste before Herdr's pane items", () => {
  const { labels, hint } = loadMenu({
    target: { pane: "p1", terminal: "t1" },
    paneList: [{ pane: "p1" }],
    terminalList: [{ address: "t1" }],
    keyList,
  });
  assert.deepEqual(Array.from(labels()), ["Copy", "Paste", "Split right", "Split down", "Zoom", "Send right-clicks to pane", "Close pane"]);
  assert.equal(hint(0), "cmd-c");
  assert.equal(hint(1), "cmd-v");
  assert.equal(hint(2), "cmd-d");
});

test("Copy and Paste focus the clicked pane, or the clicked block's terminal, first", () => {
  const inTab = loadMenu({ target: { pane: "p1", terminal: "t1" }, paneList: [{ pane: "p1" }], terminalList: [{ address: "t1" }] });
  inTab.menu.choose(1);
  assert.deepEqual(inTab.commands, [["pane.focus", { pane: "p1" }], ["terminal.paste", {}]]);

  const block = loadMenu({ target: { pane: "block-7", terminal: "t2" }, terminalList: [{ address: "t2", labels: { "herdr.right-click": "program" } }] });
  assert.deepEqual(Array.from(block.labels()), ["Copy", "Paste", "Use Herdr right-click menu"]);
  block.menu.choose(0);
  assert.deepEqual(block.commands, [["pane.focus", { terminal: "t2" }], ["terminal.copy", {}]]);
  block.menu.choose(2);
  assert.deepEqual(block.commands.at(-1), ["terminal.right_click", { terminal: "t2", to: "menu" }]);
});
