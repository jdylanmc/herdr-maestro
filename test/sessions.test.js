import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { isCopilot } from "../mods/maestro/agentlib.js";
import { liveAgents } from "../mods/maestro/live.js";
import { machineOf } from "../mods/maestro/machines.js";

const source = readFileSync(new URL("../mods/maestro/main.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "")
  .replace("export default class Maestro", "class Maestro");

function titleView({ tab = { id: "tab1", name: "DATABRICKS", named: true }, agent = {}, snap, rec = {} } = {}) {
  const commands = [];
  const element = () => {
    const node = { nodes: [], styles: {}, events: {} };
    let proxy;
    proxy = new Proxy(node, { get: (target, key) => {
      if (key in target) return target[key];
      return (...args) => {
        if (key === "child" || key === "children" || key === "trigger") node.nodes.push(...args.flat());
        else if (key === "when" && args[0]) args[1](proxy);
        else if (key === "text_size") node.styles.size = args[0];
        else if (key === "font_semibold") node.styles.semibold = true;
        else if (key === "on_click") node.events.click = args[0];
        else if (key === "id") node.idValue = args[0];
        return proxy;
      };
    } });
    return proxy;
  };
  const live = { address: "t2", pane: "p1", space: "s1", tab: "tab1", tab_name: tab?.name,
    status: "idle", app: "copilot", title: "GitHub Copilot", ...agent };
  const space = { id: "s1", tabs: tab ? [tab] : [] };
  const Maestro = runInNewContext(`${source}\nMaestro`, {
    View: class {}, isCopilot, liveAgents, machineOf,
    div: element, v_flex: element, h_flex: element, svg: element,
    HoverCard: { new: element },
    spaces: () => [space],
    agents: () => [live], terminals: () => [], panes: () => [],
    shared: () => undefined, focused: () => ({ terminal: "t2" }), layout: () => null,
    run: (command, args) => commands.push([command, { ...args }]),
  });
  const view = new Maestro();
  view.records = new Map([["t2", rec]]);
  view.snaps = new Map(snap ? [["t2", snap]] : []);
  view.fallback = new Map();
  view.logs = new Map();
  for (const name of ["icon", "pinControl", "statusGlyph", "pet", "tagChips"]) view[name] = element;
  for (const name of ["blockedLine", "preview", "gitOf", "gitDetail", "petOf", "petMood", "refreshGit"]) view[name] = () => null;
  view.draggable = (_t, _kind, _key, body) => body;
  view.observed = () => 0;
  const nodes = (root) => typeof root === "object" && root ? [root, ...root.nodes.flatMap(nodes)] : [];
  const headings = (root, size) => nodes(root).filter((n) => n.styles.semibold && n.styles.size === size).flatMap((n) => n.nodes);
  return { view, live, tab, space, commands, nodes, headings };
}

for (const extra of [
  {},
  { snap: { session_id: "session1", session_name: "Set Up Project Environment" } },
  { rec: { name: "Worker label" }, agent: { handle: "Agent handle" } },
  { agent: { app: "claude-code", title: "Claude Code" } },
]) {
  test(`named tab wins in the session list and selected details (${JSON.stringify(extra)})`, () => {
    const { view, live, commands, nodes, headings } = titleView(extra);
    const [session] = view.sessions();
    const card = view.agentCard({}, session, 0, 0);
    assert.deepEqual({ list: headings(card, 13), details: headings(view.footer({}, [session], 0), 14) },
      { list: ["DATABRICKS"], details: ["DATABRICKS"] });
    assert.equal(view.task(session), extra.snap?.session_name ?? live.title);
    assert.equal(session.tagKey, extra.snap?.session_id ?? "t2");
    nodes(card).find((n) => n.idValue === "cardb-t2").events.click();
    assert.deepEqual(commands, [["agent.focus", { terminal: "t2" }]]);
    assert.equal(live.title, extra.agent?.title ?? "GitHub Copilot");
  });
}

test("tab renames and clearing a rename follow live state without replacing generated titles", () => {
  const { view, tab, live } = titleView({ snap: { session_name: "Set Up Project Environment" } });
  const [session] = view.sessions();
  assert.equal(view.title(session), "DATABRICKS");
  tab.name = "Review deployment";
  assert.equal(view.title(session), "Review deployment");
  tab.named = false;
  tab.name = "1";
  live.tab_name = "1";
  assert.equal(view.title(session), "Set Up Project Environment");
  assert.equal(view.task(view.sessions()[0]), "1");
});

for (const [extra, expected] of [
  [{ snap: { session_name: "Set Up Project Environment" } }, "Set Up Project Environment"],
  [{ rec: { name: "Worker label" }, snap: { session_name: "Generated title" } }, "Worker label"],
  [{ agent: { handle: "Agent handle" } }, "Agent handle"],
  [{ agent: { title: "Fix login - GitHub Copilot" } }, "Fix login"],
  [{ agent: { title: "", program: { name: "GitHub Copilot" } } }, "GitHub Copilot"],
  [{ agent: { title: "" } }, "t2"],
]) {
  test(`unnamed or missing tab preserves title fallback: ${expected}`, () => {
    for (const tab of [{ id: "tab1", name: "1", named: false }, null]) {
      const { view, headings } = titleView({ ...extra, tab });
      const [session] = view.sessions();
      assert.equal(view.title(session), expected);
      assert.deepEqual(headings(view.agentCard({}, session, 0, 0), 13), [expected]);
      assert.deepEqual(headings(view.footer({}, [session], 0), 14), [expected]);
    }
  });
}

for (const binding of ["snapshot", "ancestry"]) for (const pane of ["p3", null]) for (const machine of [null, "remote"]) {
  test(`${binding}, ${pane ? "pane" : "background"}, ${machine ?? "local"}: switching providers in a live terminal isolates Copilot data`, async () => {
    const address = machine ? `${machine}/t3` : "t3";
    const parent = machine ? `${machine}/t1` : "t1";
    const cache = {
      "maestro.tags": { old: ["copilot-tag"], [address]: ["terminal-tag"] },
      "maestro.pets": { old: "old-pet", [address]: "new-pet" },
    };
    const agent = { address, pane, space: "s1", app: "copilot", status: "idle", title: "Current agent" };
    const Maestro = runInNewContext(`${source}\nMaestro`, {
      View: class {}, isCopilot, liveAgents, machineOf,
      spaces: () => [{ id: "s1", machine }],
      agents: () => pane ? [agent] : [{ address: parent, pane: "p1", space: "s1" }],
      terminals: () => [{ address, state: "live", parent, agent: agent.app,
        status: agent.status, cwd: "/current", title: agent.title,
        program: { key: agent.app, name: agent.app } }],
      panes: () => [{ pane: "p3", cwd: "/current" }],
      shared: (key) => cache[key],
      setShared: (key, value) => { cache[key] = value; },
    });
    const view = new Maestro();
    view.primary = true;
    view.records = new Map();
    view.snaps = new Map(binding === "snapshot"
      ? [[address, { session_id: "old", session_name: "Old Copilot", cwd: "/old", model: { display_name: "old-model" } }]]
      : []);
    view.fallback = new Map(binding === "ancestry" ? [[address, "old"]] : []);
    view.logs = new Map([["old", { s: { error: "old failure", tasks: ["old task"] } }]]);
    const tailed = [];
    view.tail = async (id, on) => { tailed.push([id, on]); };
    assert.equal(view.sessionFor(address), "old");
    assert.equal(view.sessions().find((x) => x.a.address === address).failed, true);
    if (machine) {
      await view.tailAll();
      assert.deepEqual(tailed, []);
    }
    await view.tailAll(machine);
    assert.deepEqual(tailed, [["old", machine]]);
    assert.equal(cache["maestro.sessionKeys"][address], "old");

    for (const provider of ["claude", "codex"]) {
      agent.app = provider;
      tailed.length = 0;
      const session = view.sessions().find((x) => x.a.address === address);
      assert.equal(view.sessionFor(address), null);
      assert.equal(session.machine, machine);
      assert.equal(session.snap, null);
      assert.equal(session.id, null);
      assert.equal(session.s, null);
      assert.equal(session.failed, false);
      assert.equal(session.cwd, "/current");
      assert.equal(view.title(session), "Current agent");
      assert.equal(session.tagKey, address);
      assert.deepEqual(session.userTags, ["terminal-tag"]);
      assert.equal(cache["maestro.pets"][session.tagKey], "new-pet");
      await view.tailAll(machine);
      assert.deepEqual(tailed, []);
      assert.equal(cache["maestro.sessionKeys"][address], address);
    }
  });
}
