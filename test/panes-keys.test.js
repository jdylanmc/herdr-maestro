import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { nestSpaces, spacePlace } from "../mods/maestro/wtlib.js";
import { machineOf, spaceEntries, remoteArgv } from "../mods/maestro/machines.js";
import { spaceFill, inkOn } from "../mods/maestro/spacecolor.js";
import { launchItems, moveSelection, FOLDER } from "../mods/maestro-launch/items.js";

function loadMod(name, { initialToken, modProps = {}, paneList = [], spaceList = [], focus = null, execImpl, pickFolder } = {}) {
  let token = initialToken;
  const tasks = [];
  const commands = [];
  const overlays = [];
  const store = new Map();
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
          else if (key === "tooltip") events.tip = args[0];
          else if (key === "on_key_down") events.key = args[0];
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
    shared: (key) => (store.has(key) ? store.get(key) : token),
    setShared: (key, value) => { store.set(key, value); },
    window: () => ({ platform: "macos" }),
    launchItems, moveSelection, FOLDER, pickFolder,
    focused: () => focus,
    panes: () => paneList,
    spaces: () => spaceList,
    machines: () => [],
    exec: execImpl,
    nestSpaces, spacePlace, machineOf, spaceEntries, remoteArgv, spaceFill, inkOn,
    appHome: () => "/local-herdr",
    openOverlay: (spec) => { overlays.push(spec); },
    closeOverlay() {},
    layout: () => null,
    setAgentOrder() {},
    agents: () => [],
    theme: () => ({}),
    run: (command, args) => commands.push({ command, args: { ...args } }),
    localStorage: { getItem: () => null, setItem() {} },
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
    stop_propagation() {},
  };
  mod.init(modProps, cx);
  tasks.length = 0;
  return {
    mod, tasks, commands, overlays, elements, cx, store,
    setToken(value) { token = value; },
    click(id, hostingPane, modifiers = {}) {
      let stopped = false;
      const events = elements.get(id).events;
      events.down?.({}, { stop_propagation() { stopped = true; } });
      if (!stopped) focus = { pane: hostingPane, tab: paneList.find((p) => p.pane === hostingPane).tab };
      events.click({ modifiers }, cx);
    },
  };
}

for (const [machine, helper] of [[null, null], ["box", "/remote-herdr/mods/maestro/helper.mjs"], ["box", null], ["box", "C:\\Remote Herdr\\mods\\maestro\\helper.mjs"]]) {
  test(`agent menu and worktree launches use the target helper (${machine ?? "local"}, ${helper ?? "none"})`, () => {
    const space = { id: machine ? "box/s1" : "s1", machine };
    const board = loadMod("maestro", { spaceList: [space] });
    board.mod.remoteInfo = (on) => {
      assert.equal(on, machine);
      return helper ? { helper } : null;
    };
    const wrapper = machine
      ? helper ? ["node", helper, "run"] : []
      : ["node", "/local-herdr/mods/maestro/helper.mjs", "run"];
    board.mod.openLaunch(space.id, "/checkout");
    const launcher = loadMod("maestro-launch", {
      spaceList: [space],
      modProps: { ...board.overlays[0].props, overlay: "launcher" },
    });
    for (const agent of [{ key: "copilot", run: ["copilot"] }, { key: "claude", run: ["claude", "--example"] }]) {
      launcher.mod.start(agent);
      const command = launcher.commands.at(-1);
      assert.equal(command.command, "tab.new");
      assert.equal(command.args.space, space.id);
      assert.equal(command.args.folder, "/checkout");
      assert.deepEqual(Array.from(command.args.argv), [...wrapper, ...(agent.key === "copilot" ? ["copilot", "--yolo"] : agent.run)]);
    }
    board.mod.newButton({}, "wtn-worktree", space.id, "/checkout", 20);
    assert.equal(board.elements.get("wtn-worktree").events.tip, "New agent… (⌥-click: Copilot here)");
    board.click("wtn-worktree", null);
    assert.equal(board.overlays.at(-1).mod, "maestro-launch");
    assert.equal(board.commands.length, 0);
    board.click("wtn-worktree", null, { alt: true });
    const command = board.commands.at(-1);
    assert.equal(command.command, "tab.new");
    assert.equal(command.args.space, space.id);
    assert.equal(command.args.folder, "/checkout");
    assert.deepEqual(Array.from(command.args.argv), [...wrapper, "copilot", "--yolo"]);
  });
}

test("launch menu: Enter starts Copilot; In another folder hands the selected agent to the sidebar's picker", async () => {
  const space = { id: "s1", machine: null };
  const agents = [{ key: "claude", name: "Claude", run: ["claude"] }, { key: "copilot", name: "Copilot", run: ["copilot"] }];
  const open = () => {
    const menu = loadMod("maestro-launch", { spaceList: [space], modProps: { space: "s1", folder: "/here", overlay: "o" } });
    menu.mod.agents = agents;
    let onKey;
    const key = (k) => { onKey = menu.mod.render().events.key; onKey({ key: k, modifiers: {} }, menu.cx); };
    return { menu, key };
  };
  const a = open();
  a.key("enter");
  assert.deepEqual(Array.from(a.menu.commands.at(-1).args.argv), ["node", "/local-herdr/mods/maestro/helper.mjs", "run", "copilot", "--yolo"]);
  assert.equal(a.menu.commands.at(-1).args.folder, "/here");

  const b = open();
  b.key("down"); // Claude
  b.key("down"); // In another folder…
  b.key("enter");
  assert.equal(b.menu.commands.length, 0);
  const req = b.menu.store.get("maestro.launchInFolder");
  assert.deepEqual(Array.from(req.argv), ["node", "/local-herdr/mods/maestro/helper.mjs", "run", "claude"]);

  const late = open();
  late.menu.mod.agents = [];
  late.key("down"); // [Copilot, In another folder…]: the folder row
  late.menu.mod.agents = agents; // discovery resolves: Claude now sits where the folder row was
  late.key("enter");
  assert.equal(late.menu.commands.length, 0, "Enter still means the folder row");
  assert.deepEqual(Array.from(late.menu.store.get("maestro.launchInFolder").argv), ["node", "/local-herdr/mods/maestro/helper.mjs", "run", "copilot", "--yolo"]);

  const gone = open();
  gone.key("down"); // Claude, installed per the cache
  gone.key("down"); // the folder row
  gone.menu.mod.agents = [{ ...agents[0], installed: false }, agents[1]]; // discovery: Claude is not installed
  gone.key("enter");
  assert.deepEqual(Array.from(gone.menu.store.get("maestro.launchInFolder").argv), ["node", "/local-herdr/mods/maestro/helper.mjs", "run", "copilot", "--yolo"]);

  const board = loadMod("maestro", { spaceList: [space], pickFolder: async () => "/picked" });
  board.mod.launchInFolderState();
  assert.equal(board.tasks.length, 0, "a request from before the sidebar started is not replayed");
  board.store.set("maestro.launchInFolder", req);
  board.mod.launchInFolderState();
  board.mod.launchInFolderState();
  assert.equal(board.tasks.length, 1);
  await board.tasks[0](board.cx);
  assert.deepEqual(board.commands.at(-1), { command: "tab.new", args: { space: "s1", folder: "/picked", argv: req.argv } });
});

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

test("render refreshes a remote shell-only space with remote Git and no local lookup", async () => {
  const calls = [];
  const sp = { id: "box/s1", folder: "/remote/repo", machine: "box" };
  const { mod, cx, tasks } = loadMod("maestro", {
    spaceList: [sp],
    execImpl: async (command, args, options) => {
      calls.push([command, args[1], options?.on ?? null]);
      return { code: 0, stdout: "/remote/repo/.git\n/remote/repo\nfeature\n" };
    },
  });
  mod.sessions = () => [];
  mod.watchBlocked = () => {};
  mod.nestedSpaces = () => [];
  mod.attentionStrip = () => null;
  mod.render(cx);
  assert.equal(tasks.length, 1);
  await tasks.pop()(cx);
  assert.deepEqual(calls, [["git", sp.folder, "box"]]);
  assert.equal(mod.gitOf(sp.folder, "box").branch, "feature");
  assert.equal(mod.gitOf(sp.folder), null);
});

test("clicking a space's avatar opens its color picker instead of selecting the space", () => {
  const sp = { id: "s1", name: "herdr" };
  const board = loadMod("maestro", { spaceList: [sp] });
  board.mod.spaceRow({}, sp, [], new Map());
  board.click("spc-s1", null);
  assert.deepEqual(board.overlays.map((o) => [o.mod, o.props.space]), [["maestro-color", "s1"]]);
  assert.equal(board.commands.some((c) => c.command === "space.select"), false);
});

test("a worktree space nested under its checkout opens the picker from its branch icon", () => {
  const sp = { id: "s2", name: "feature" };
  const board = loadMod("maestro", { spaceList: [sp] });
  board.mod.spaceRow({}, sp, [], new Map(), { id: "s1" });
  board.click("spc-s2", null);
  assert.deepEqual(board.overlays.map((o) => [o.mod, o.props.space]), [["maestro-color", "s2"]]);
});

test("keyboard navigation can reopen a machine when every machine is folded", async () => {
  const sp = { id: "box/s1", name: "Remote", folder: "/remote/repo", machine: "box" };
  const { mod, cx } = loadMod("maestro", { spaceList: [sp] });
  mod.sessions = () => [];
  mod.watchBlocked = () => {};
  mod.refreshGit = () => {};
  mod.attentionStrip = () => null;
  mod.machineList = [{ name: "box", state: "connected" }];
  mod.folded = new Set(["mc:local", "mc:box"]);
  mod.handle = { focus() {}, is_focused: () => true };
  const keyboardCx = { ...cx, sleep: async () => {}, stop_propagation() {} };
  mod.render(cx);
  assert.deepEqual(Array.from(mod.nav, (n) => n.key), ["mc:local", "mc:box"]);
  await mod.keyboard(keyboardCx);
  mod.render(cx);
  mod.navKey({ key: "down" }, keyboardCx);
  assert.equal(mod.cursor, "mc:box");
  mod.navKey({ key: "enter" }, keyboardCx);
  assert.equal(mod.folded.has("mc:box"), false);
  mod.render(cx);
  assert.ok(mod.nav.some((n) => n.key === "sp:box/s1"));
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
