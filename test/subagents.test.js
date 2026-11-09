import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySession, applyEvent, treeRows, visibleRows } from "../mods/maestro/log.js";

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

test("a finished tool clears the subagent's activity but it keeps running", () => {
  const s = emptySession();
  applyEvent(s, ev("subagent.started", 0, { agentDisplayName: "x" }, "a1"));
  applyEvent(s, ev("tool.execution_start", 1, { toolName: "grep", toolCallId: "c1" }, "a1"));
  applyEvent(s, ev("tool.execution_complete", 2, { toolCallId: "c1" }, "a1"));
  const a = s.agents.get("a1");
  assert.deepEqual([a.status, a.activity], ["running", null]);
});

test("an idle child stays visible after its finished parent expires", () => {
  const s = emptySession();
  applyEvent(s, ev("subagent.started", 0, { agentDisplayName: "parent" }, "p"));
  applyEvent(s, ev("subagent.started", 0, { agentDisplayName: "child", parentId: "p" }, "c"));
  applyEvent(s, ev("subagent.configured", 0, { multiTurn: true }, "c"));
  applyEvent(s, ev("subagent.completed", 1, {}, "c"));
  applyEvent(s, ev("subagent.completed", 1, {}, "p"));
  const rows = treeRows(s, Date.parse(at(1)) + 3600_000, 600_000);
  assert.deepEqual(rows.map((r) => [r.id, r.status, r.depth]), [["c", "idle", 0]]);
});

test("a session resume or shutdown ends subagents that were running or idle", () => {
  const s = emptySession();
  applyEvent(s, ev("subagent.started", 0, { agentDisplayName: "bg" }, "a1"));
  applyEvent(s, ev("subagent.configured", 0, { multiTurn: true }, "a1"));
  applyEvent(s, ev("subagent.completed", 1, {}, "a1"));
  applyEvent(s, ev("subagent.started", 1, { agentDisplayName: "busy" }, "a2"));
  applyEvent(s, ev("subagent.started", 1, { agentDisplayName: "done" }, "a3"));
  applyEvent(s, ev("subagent.completed", 2, {}, "a3"));
  applyEvent(s, ev("session.resume", 5, {}));
  assert.deepEqual(["a1", "a2", "a3"].map((id) => s.agents.get(id).status), ["ended", "ended", "done"]);
  assert.deepEqual(treeRows(s, Date.parse(at(5)) + 3600_000, 600_000), [], "ended agents expire like finished ones");
  applyEvent(s, ev("subagent.started", 6, { agentDisplayName: "new" }, "a4"));
  assert.equal(s.agents.get("a4").status, "running", "agents started after the resume are live");
});

test("visibleRows lists only running subagents and lifts a running child of a hidden parent", () => {
  const rows = [
    { id: "p", status: "idle", depth: 0 },
    { id: "c", status: "running", depth: 1 },
    { id: "g", status: "running", depth: 2 },
    { id: "q", status: "running", depth: 0 },
    { id: "d", status: "done", depth: 1 },
    { id: "e", status: "running", depth: 2 },
  ];
  assert.equal(visibleRows(rows, true), rows);
  assert.deepEqual(visibleRows(rows, false).map((r) => [r.id, r.depth]), [["c", 0], ["g", 1], ["q", 0], ["e", 1]]);
  assert.deepEqual(visibleRows([{ id: "x", status: "idle", depth: 0 }], false), []);
});
