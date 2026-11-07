import { test } from "node:test";
import assert from "node:assert/strict";
import { findAgent, knownAgentsFrom, spawnPlan, FALLBACK_AGENTS, DEFAULT_ARGV } from "../mods/maestro/agentlib.js";

const known = [
  { key: "copilot", name: "GitHub Copilot", run: ["copilot"], installed: true },
  { key: "claude", name: "Claude Code", run: ["claude"], installed: true },
  { key: "cursor-agent", name: "Cursor Agent", run: ["cursor-agent"], installed: false },
  { key: "codex", name: "Codex", run: ["codex"], installed: true },
];

test("agents match by key, display name or unique prefix, ignoring case and punctuation", () => {
  assert.equal(findAgent("claude", known).key, "claude");
  assert.equal(findAgent("Claude Code", known).key, "claude");
  assert.equal(findAgent("cursoragent", known).key, "cursor-agent");
  assert.equal(findAgent("cod", known).key, "codex");
  assert.equal(findAgent("c", known), null);
  assert.equal(findAgent("gemini", known), null);
});

test("shared.json's cached list wins; without one the fallback table is used", () => {
  assert.deepEqual(knownAgentsFrom({ "maestro.knownAgents": { agents: known } }), { agents: known, cached: true });
  assert.deepEqual(knownAgentsFrom({}), { agents: FALLBACK_AGENTS, cached: false });
  assert.equal(knownAgentsFrom({ "maestro.knownAgents": { agents: [{ key: "x", run: [] }] } }).cached, false);
});

test("Copilot keeps Maestro's argv and -i; other agents send the task through tab.new", () => {
  assert.deepEqual(spawnPlan({ task: "fix it" }), { argv: [...DEFAULT_ARGV, "-i", "fix it"], task: null });
  assert.deepEqual(spawnPlan({ agent: known[0] }), { argv: DEFAULT_ARGV, task: null });
  assert.deepEqual(spawnPlan({ agent: known[1], task: "fix it" }), { argv: ["claude"], task: "fix it" });
  assert.deepEqual(spawnPlan({ agent: known[3] }), { argv: ["codex"], task: null });
});
