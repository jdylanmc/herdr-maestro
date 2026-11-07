import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { isCopilot } from "../mods/maestro/agentlib.js";

const source = readFileSync(new URL("../mods/maestro/main.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "")
  .replace("export default class Maestro", "class Maestro");

for (const binding of ["snapshot", "ancestry"]) {
  test(`${binding}: switching providers in a live terminal isolates Copilot data`, async () => {
    const cache = {
      "maestro.tags": { old: ["copilot-tag"], t3: ["terminal-tag"] },
      "maestro.pets": { old: "old-pet", t3: "new-pet" },
    };
    const agent = { address: "t3", pane: "p3", app: "copilot", status: "idle", title: "Current agent" };
    const Maestro = runInNewContext(`${source}\nMaestro`, {
      View: class {}, isCopilot,
      agents: () => [agent],
      terminals: () => [{ address: "t3", state: "live" }],
      panes: () => [{ pane: "p3", cwd: "/current" }],
      shared: (key) => cache[key],
      setShared: (key, value) => { cache[key] = value; },
    });
    const view = new Maestro();
    view.primary = true;
    view.records = new Map();
    view.snaps = new Map(binding === "snapshot"
      ? [["t3", { session_id: "old", session_name: "Old Copilot", cwd: "/old", model: { display_name: "old-model" } }]]
      : []);
    view.fallback = new Map(binding === "ancestry" ? [["t3", "old"]] : []);
    view.logs = new Map([["old", { s: { error: "old failure", tasks: ["old task"] } }]]);
    const tailed = [];
    view.tail = async (id) => { tailed.push(id); };
    assert.equal(view.sessionFor("t3"), "old");
    assert.equal(view.sessions()[0].failed, true);
    await view.tailAll();
    assert.deepEqual(tailed, ["old"]);
    assert.equal(cache["maestro.sessionKeys"].t3, "old");

    for (const provider of ["claude", "codex"]) {
      agent.app = provider;
      tailed.length = 0;
      const session = view.sessions()[0];
      assert.equal(view.sessionFor("t3"), null);
      assert.equal(session.snap, null);
      assert.equal(session.id, null);
      assert.equal(session.s, null);
      assert.equal(session.failed, false);
      assert.equal(session.cwd, "/current");
      assert.equal(view.title(session), "Current agent");
      assert.equal(session.tagKey, "t3");
      assert.deepEqual(session.userTags, ["terminal-tag"]);
      assert.equal(cache["maestro.pets"][session.tagKey], "new-pet");
      await view.tailAll();
      assert.deepEqual(tailed, []);
      assert.equal(cache["maestro.sessionKeys"].t3, "t3");
    }
  });
}
