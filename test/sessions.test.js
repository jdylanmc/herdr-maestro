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
