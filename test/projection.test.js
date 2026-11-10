import { test } from "node:test";
import assert from "node:assert/strict";
import { PROJECTIONS, projectionOf, nestsUnder } from "../mods/maestro/projection.js";

test("the switch offers Worktrees and Agents", () => {
  assert.deepEqual(PROJECTIONS.map((p) => p.label), ["Worktrees", "Agents"]);
});

test("stored projections map over, legacy ids to Agents", () => {
  assert.equal(projectionOf("worktrees"), "worktrees");
  assert.equal(projectionOf("agents"), "agents");
  assert.equal(projectionOf("subagents"), "agents");
  assert.equal(projectionOf("workspace"), "agents");
  assert.equal(projectionOf(undefined), "worktrees");
  assert.equal(projectionOf("bogus"), "worktrees");
  assert.equal(projectionOf("toString"), "worktrees");
});

test("workers nest under their launcher across worktrees only in Agents", () => {
  assert.equal(nestsUnder("agents", false), true);
  assert.equal(nestsUnder("agents", true), true);
  assert.equal(nestsUnder("worktrees", true), true);
  assert.equal(nestsUnder("worktrees", false), false);
});
