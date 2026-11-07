import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySession, applyLines, treeRows, attention, nextRun, cadence } from "../mods/maestro/log.js";

const T0 = Date.parse("2026-01-01T00:00:00Z");
const at = (s) => new Date(T0 + s * 1000).toISOString();
const lines = (...events) => events.map((e) => JSON.stringify(e)).join("\n") + "\n";

test("subagents fold into a nested tree with terminal states", () => {
  const s = applyLines(emptySession(), lines(
    { type: "subagent.started", agentId: "a", timestamp: at(1), data: { agentName: "explore", agentDisplayName: "Explore" } },
    { type: "subagent.started", agentId: "b", timestamp: at(2), data: { agentName: "task", parentId: "a" } },
    { type: "subagent.started", agentId: "c", timestamp: at(3), data: { agentName: "task", parentId: "b" } },
    { type: "subagent.started", agentId: "d", timestamp: at(4), data: { parentId: "gone" } },
    { type: "subagent.completed", agentId: "b", timestamp: at(5), data: {} },
    { type: "subagent.completed", agentId: "c", timestamp: at(6), data: { cancelled: true } },
    { type: "subagent.failed", agentId: "d", timestamp: at(7), data: {} },
    { type: "subagent.completed", agentId: "unknown", timestamp: at(8), data: {} },
  ));
  const rows = treeRows(s, T0 + 10_000, 60_000);
  assert.deepEqual(rows.map((r) => [r.id, r.depth, r.status]), [
    ["a", 0, "running"], ["b", 1, "done"], ["c", 2, "cancelled"], ["d", 0, "failed"],
  ]);
  assert.equal(rows[0].name, "Explore");
  assert.equal(rows[3].name, "subagent");
  // Finished agents drop out after keepMs; running ones stay; a kept child whose parent expired moves up.
  assert.deepEqual(treeRows(s, T0 + 10_000, 4_000).map((r) => [r.id, r.depth]), [["a", 0], ["c", 0], ["d", 0]]);
});

test("attention: permission beats question beats error; abort clears", () => {
  const s = emptySession();
  applyLines(s, lines({ type: "session.error", timestamp: at(1), data: { errorType: "rate_limit" } }));
  assert.equal(attention(s), "error");
  applyLines(s, lines({ type: "tool.execution_start", timestamp: at(2), data: { toolName: "ask_user", toolCallId: "q1" } }));
  assert.equal(attention(s), "question");
  applyLines(s, lines({ type: "permission.requested", timestamp: at(3), data: { requestId: "p1" } }));
  assert.equal(attention(s), "permission");
  applyLines(s, lines(
    { type: "permission.completed", timestamp: at(4), data: { requestId: "p1" } },
    { type: "tool.execution_complete", timestamp: at(5), data: { toolCallId: "q1" } },
  ));
  assert.equal(attention(s), "error");
  applyLines(s, lines({ type: "assistant.turn_start", timestamp: at(6), data: {} }));
  assert.equal(attention(s), null, "a new root turn clears the error");
  applyLines(s, lines(
    { type: "permission.requested", timestamp: at(7), data: { requestId: "p2" } },
    { type: "abort", timestamp: at(8), data: {} },
  ));
  assert.equal(attention(s), null);
  assert.equal(s.turnStart, null);
});

test("schedules: runs, rearm, cancel, nextRun and cadence", () => {
  const s = applyLines(emptySession(), lines(
    { type: "session.schedule_created", timestamp: at(0), data: { id: 1, prompt: "check CI", intervalMs: 300_000 } },
    { type: "session.schedule_created", timestamp: at(0), data: { id: 2, prompt: "nightly", cron: "0 9 * * 1-5" } },
    { type: "session.schedule_created", timestamp: at(0), data: { id: 3, prompt: "loop", selfPaced: true } },
    { type: "session.schedule_created", timestamp: at(0), data: { id: 4, prompt: "later", at: T0 + 3_600_000, recurring: false } },
    { type: "user.message", timestamp: at(60), data: { source: "schedule-1" } },
    { type: "user.message", agentId: "sub", timestamp: at(70), data: { source: "schedule-1" } },
    { type: "session.schedule_rearmed", timestamp: at(80), data: { id: 3, nextRunAt: T0 + 900_000 } },
    { type: "session.schedule_cancelled", timestamp: at(90), data: { id: 2 } },
  ));
  assert.deepEqual([...s.schedules.keys()], [1, 3, 4]);
  const [every, self, once] = [s.schedules.get(1), s.schedules.get(3), s.schedules.get(4)];
  assert.equal(every.runs, 1, "subagent messages are not schedule runs");
  assert.equal(s.lastPromptAt, T0 + 60_000);
  assert.equal(nextRun(every, T0 + 100_000), T0 + 360_000);
  assert.equal(nextRun(every, T0 + 1_000_000), T0 + 1_260_000, "skips missed intervals");
  assert.equal(nextRun(self, T0), T0 + 900_000);
  assert.equal(nextRun(once, T0), T0 + 3_600_000);
  assert.equal(nextRun({ cron: "* * * * *" }, T0), null);
  assert.deepEqual([every, self, once].map(cadence), ["every 5m", "self-paced", "once"]);
  assert.equal(cadence({ cron: "0 9 * * 1-5" }), "cron 0 9 * * 1-5");
  assert.equal(cadence({ intervalMs: 7_200_000 }), "every 2h");
  assert.equal(cadence({ intervalMs: 20_000 }), "every 20s");
});

test("model and effort come from root usage records, not subagents or side models", () => {
  const s = emptySession();
  applyLines(s, '{"type":"model.model_call_success","data":{"modelDisplayName":"Big","reasoningEffort":"low"}}\n');
  assert.equal(s.effort, "low", "model calls set effort until a usage record arrives");
  applyLines(s, [
    '{"type":"session.usage_record","data":{"model":"gpt-x","reasoningEffort":"high"}}',
    '{"type":"session.usage_record","agentId":"sub","data":{"model":"tiny","reasoningEffort":"none"}}',
    '{"type":"model.model_call_success","data":{"modelDisplayName":"Big","reasoningEffort":"medium"}}',
    '{"type":"model.model_call_success","data":{"modelDisplayName":"Utility Model","reasoningEffort":"minimal"}}',
    "not json",
  ].join("\n"));
  assert.equal(s.lastModel, "gpt-x");
  assert.equal(s.effort, "high");
  applyLines(s, lines({ type: "session.model_change", timestamp: at(1), data: { newModel: "gpt-y", reasoningEffort: "xhigh" } }));
  applyLines(s, lines({ type: "session.model_change", agentId: "sub", timestamp: at(2), data: { newModel: "tiny" } }));
  assert.equal(s.model, "gpt-y");
  assert.equal(s.effort, "xhigh");
});
