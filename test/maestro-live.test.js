import { test } from "node:test";
import assert from "node:assert/strict";
import { liveAgents } from "../mods/maestro/live.js";

const root = { address: "t1", pane: "p1", space: "s1", space_name: "Workspace" };
const worker = (address, extra = {}) => ({ address, state: "live", agent: "copilot", ...extra });

test("parked tab workers retain their cards and inherit the Maestro parent's space", () => {
  const records = new Map([["t2", { parent: "t1", name: "Record worker" }]]);
  const core = [
    worker("t2", { parent: "t9", labels: { "maestro.parent": "t9", "maestro.name": "Other" } }),
    worker("t3", { labels: { "maestro.parent": "t1", "maestro.name": "Label worker" } }),
    worker("t4", { parent: "t1" }),
    worker("t9"),
    worker("t5", { parent: "t1", state: "exited" }),
  ];
  const shown = liveAgents([root], core, records);
  assert.deepEqual(shown.map((a) => a.address), ["t1", "t2", "t3", "t4"]);
  for (const a of shown.slice(1)) {
    assert.equal(a.pane, null);
    assert.equal(a.parent, "t1");
    assert.equal(a.space, "s1");
    assert.equal(a.space_name, "Workspace");
  }
  assert.equal(shown[1].handle, "Record worker");
  assert.equal(shown[2].handle, "Label worker");
  assert.deepEqual(root, { address: "t1", pane: "p1", space: "s1", space_name: "Workspace" });
});

test("nested parked workers inherit space regardless of terminal order; lineage cycles terminate", () => {
  const core = [
    worker("t3", { parent: "t2", status: "working" }),
    worker("t2", { labels: { "maestro.parent": "t1" } }),
    worker("t4", { parent: "t5" }),
    worker("t5", { parent: "t4" }),
  ];
  const shown = liveAgents([root], core, new Map());
  assert.equal(shown.find((a) => a.address === "t3").space, "s1");
  assert.equal(shown.find((a) => a.address === "t3").status, "working");
  assert.equal(shown.find((a) => a.address === "t4").space, null);
});

test("pin labels cover parked workers and missing agent flags without overriding live flags", () => {
  const core = [
    worker("t1", { labels: { "herdr.pinned": true } }),
    worker("t2", { parent: "t1", labels: { "herdr.pinned": true } }),
    worker("t3", { labels: { "herdr.pinned": true } }),
  ];
  const shown = liveAgents([root, { ...root, address: "t3", pinned: false }], core, new Map());
  assert.equal(shown.find((a) => a.address === "t1").pinned, true);
  assert.equal(shown.find((a) => a.address === "t2").pinned, true);
  assert.equal(shown.find((a) => a.address === "t3").pinned, false);
  assert.equal(root.pinned, undefined);
});
