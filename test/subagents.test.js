import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySession, applyEvent, treeRows } from "../mods/maestro/log.js";

const at = (m) => `2026-01-01T00:${String(m).padStart(2, "0")}:00Z`;
const ev = (type, m, data = {}, agentId) => ({ type, timestamp: at(m), data, ...(agentId ? { agentId } : {}) });

test("a multi-turn background subagent idles between turns, wakes on new work, and is never hidden", () => {
  const s = emptySession();
  applyEvent(s, ev("subagent.started", 0, { agentDisplayName: "fleet-x", agentName: "general-purpose", agentDescription: "Do x", executionMode: "background" }, "a1"));
  applyEvent(s, ev("subagent.configured", 0, { model: "m1", reasoningEffort: "high", multiTurn: true }, "a1"));
  applyEvent(s, ev("subagent.started", 0, { agentDisplayName: "once" }, "a2"));
  applyEvent(s, ev("tool.execution_start", 1, { toolName: "grep", toolCallId: "c1" }, "a1"));
  assert.equal(s.agents.get("a1").activity, "grep");
  applyEvent(s, ev("assistant.turn_start", 1, {}, "a1"));
  assert.equal(s.turnStart, null, "a subagent's turn is not the session's turn");
  applyEvent(s, ev("subagent.completed", 2, { totalToolCalls: 7, totalTokens: 1234 }, "a1"));
  applyEvent(s, ev("subagent.completed", 2, {}, "a2"));
  const a = s.agents.get("a1");
  assert.deepEqual([a.status, a.tools, a.tokens, a.model, a.effort, a.description, a.mode], ["idle", 7, 1234, "m1", "high", "Do x", "background"]);
  assert.equal(s.agents.get("a2").status, "done");
  const hours = Date.parse(at(2)) + 48 * 3600_000;
  assert.deepEqual(treeRows(s, hours, 600_000).map((r) => r.id), ["a1"], "idle stays, a finished one-shot hides");
  applyEvent(s, ev("user.message", 3, {}, "a1"));
  assert.deepEqual([a.status, a.turns, a.ended], ["running", 2, null]);
});
