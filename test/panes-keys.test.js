import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { spacePlace } from "../mods/maestro/wtlib.js";

function loadMod(name, { initialToken, modProps = {}, paneList = [], spaceList = [], focus = null } = {}) {
  let token = initialToken;
  const tasks = [];
  const commands = [];
  const elements = new Map();
  const element = () => {
    const events = {};
    let proxy;
    proxy = new Proxy({ events }, {
      get(target, key) {
        if (key in target) return target[key];
        return (...args) => {
          if (key === "id") elements.set(args[0], proxy);
          else if (key === "on_mouse_down") events.down = args[1];
          else if (key === "on_click") events.click = args[0];
          else if (key === "when" && args[0]) args[1](proxy);
          return proxy;
        };
      },
    });
    return proxy;
  };
  const context = vm.createContext({
    View: class {},
    div: element, v_flex: element, h_flex: element, svg: element,
    props: () => modProps,
    shared: () => token,
    focused: () => focus,
    panes: () => paneList,
    spaces: () => spaceList,
    spacePlace,
    layout: () => null,
    setAgentOrder() {},
    agents: () => [],
    theme: () => ({}),
    run: (command, args) => commands.push({ command, args: { ...args } }),
    localStorage: { getItem: () => null },
  });
  const source = readFileSync(new URL(`../mods/${name}/main.js`, import.meta.url), "utf8")
    .replace(/^import .*;\n/gm, "")
    .replace("export default class", "globalThis.Mod = class");
  vm.runInContext(source, context);
  const mod = new context.Mod();
  const handle = { focus() {}, is_focused: () => false };
  const cx = {
    focus_handle: () => handle,
    spawn: (task) => tasks.push(task),
    timer: { every() {}, after() {} },
    notify() {},
  };
  mod.init(modProps, cx);
  tasks.length = 0;
  return {
    mod, tasks, commands, elements, cx,
    setToken(value) { token = value; },
    click(id, hostingPane) {
      let stopped = false;
      const events = elements.get(id).events;
      events.down?.({}, { stop_propagation() { stopped = true; } });
      if (!stopped) focus = { pane: hostingPane, tab: paneList.find((p) => p.pane === hostingPane).tab };
      events.click({}, cx);
    },
  };
}

test("keyboard navigation preserves nested worktree rows and refreshes empty spaces", () => {
  const sp = { id: "worktree", folder: "/repo/worktree" };
  const { mod, cx } = loadMod("maestro", { spaceList: [sp] });
  let refreshed;
  let rowTree;
  mod.sessions = () => [];
  mod.watchBlocked = () => {};
  mod.refreshGit = (list) => { refreshed = list; };
  mod.nestedSpaces = () => [{ sp, tree: "nested" }];
  mod.spaceRow = (_t, _sp, _mine, _kids, tree) => { rowTree = tree; return null; };
  mod.attentionStrip = () => null;
  mod.render(cx);
  assert.equal(rowTree, "nested");
  assert.equal(refreshed.length, 1);
  assert.equal(refreshed[0].cwd, sp.folder);
  assert.equal(mod.nav[0].key, "sp:worktree");
});

for (const initialToken of [undefined, 100]) {
  test(`first new footer handoff focuses the list (baseline ${initialToken})`, async () => {
    const { mod, tasks, cx, setToken } = loadMod("maestro", { initialToken });
    let handoffs = 0;
    mod.keyboard = async () => { handoffs++; };
    mod.keyboardState();
    assert.equal(tasks.length, 0, "must not replay the initial token");
    setToken(200);
    mod.keyboardState();
    assert.equal(tasks.length, 1);
    await tasks.pop()(cx);
    assert.equal(handoffs, 1);
    mod.keyboardState();
    assert.equal(tasks.length, 0, "must consume each handoff once");
    setToken(300);
    mod.keyboardState();
    await tasks.pop()(cx);
    assert.equal(handoffs, 2);
  });
}

for (const name of ["maestro", "maestro-pets"]) {
  const closeId = name === "maestro" ? "board-close" : "pets-close";
  const render = (mod) => name === "maestro" ? mod.renderBoard({}, [], 0) : mod.render();
  for (const focusedPane of ["terminal", "copy-a"]) {
    test(`${name}: closing copy B while ${focusedPane} is focused`, () => {
      const paneList = [
        { pane: "terminal", tab: "tab", terminal: "t0" },
        { pane: "copy-a", tab: "tab", terminal: null, mod: name },
        { pane: "copy-b", tab: "tab", terminal: null, mod: name },
      ];
      const harness = loadMod(name, {
        modProps: { place: "pane", view: "board" },
        paneList,
        focus: { pane: focusedPane, tab: "tab" },
      });
      render(harness.mod);
      harness.click(closeId, "copy-b");
      assert.deepEqual(harness.commands, [{ command: "pane.close", args: { pane: "copy-b" } }]);
    });
  }
  test(`${name}: closing a sole pane closes its own tab`, () => {
    const harness = loadMod(name, {
      modProps: { place: "pane", view: "board" },
      paneList: [
        { pane: "copy-a", tab: "other-tab", terminal: null, mod: name },
        { pane: "copy-b", tab: "own-tab", terminal: null, mod: name },
      ],
      focus: { pane: "copy-a", tab: "other-tab" },
    });
    render(harness.mod);
    harness.click(closeId, "copy-b");
    assert.deepEqual(harness.commands, [{ command: "tab.close", args: { id: "own-tab" } }]);
  });
  test(`${name}: window close controls still stop native dragging`, () => {
    const harness = loadMod(name, { modProps: { view: "board" } });
    render(harness.mod);
    let stopped = false;
    harness.elements.get(closeId).events.down({}, { stop_propagation() { stopped = true; } });
    assert.equal(stopped, true);
  });
}

test("pet pane teardown does not close another pane", () => {
  const { mod, commands } = loadMod("maestro-pets", { modProps: { place: "pane" } });
  mod.close();
  assert.deepEqual(commands, []);
});
