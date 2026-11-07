import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadMod(name, { initialToken, modProps = {}, paneList = [], focus = null } = {}) {
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
    div: element, v_flex: element, h_flex: element,
    props: () => modProps,
    shared: () => token,
    focused: () => focus,
    panes: () => paneList,
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
