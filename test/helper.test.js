import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { scratch } from "./helpers.js";

const HELPER = fileURLToPath(new URL("../mods/maestro/helper.mjs", import.meta.url));
const helper = (...args) => execFileSync(process.execPath, [HELPER, ...args.map(String)], { encoding: "utf8" });
const events = (file, offset) => {
  const [next, ...lines] = helper("events", file, offset).split("\n");
  return { next: Number(next), events: lines.filter(Boolean).map((l) => JSON.parse(l)) };
};

test("events projects only folded types, drops payloads, and stops before a partial line", (t) => {
  const file = join(scratch(t), "events.jsonl");
  const lines = [
    { type: "user.message", timestamp: "2026-01-01T00:00:00Z", data: { content: "secret prompt", source: "schedule-1" } },
    { type: "assistant.message", timestamp: "2026-01-01T00:00:01Z", data: { content: "ignored" } },
    { type: "subagent.started", agentId: "a1", timestamp: "2026-01-01T00:00:02Z", data: { agentDisplayName: "scout", agentName: "explore", prompt: "do it" } },
    { type: "tool.execution_complete", timestamp: "2026-01-01T00:00:03Z", data: { toolCallId: "c1", result: { content: "big output" } } },
  ].map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(file, lines + '{"type":"abort"');
  const first = events(file, 0);
  assert.equal(first.next, Buffer.byteLength(lines), "the partial last line is left for next time");
  assert.deepEqual(first.events.map((e) => e.type), ["user.message", "subagent.started", "tool.execution_complete"]);
  assert.deepEqual(first.events[0].data, { source: "schedule-1" });
  assert.deepEqual(first.events[1], { type: "subagent.started", timestamp: "2026-01-01T00:00:02Z", agentId: "a1", data: { agentDisplayName: "scout", agentName: "explore" } });
  assert.deepEqual(first.events[2].data, { toolCallId: "c1" });
  writeFileSync(file, lines + '{"type":"abort","timestamp":"2026-01-01T00:00:04Z"}\n');
  assert.deepEqual(events(file, first.next).events.map((e) => e.type), ["abort"]);
  assert.equal(events(file, 10 ** 9).next, statSync(file).size, "an offset past the end restarts from the start");
});

test("events keeps only a subagent's lifecycle from system notifications, never their content", (t) => {
  const file = join(scratch(t), "events.jsonl");
  const lines = [
    { type: "system.notification", timestamp: "2026-01-01T00:00:00Z", data: { content: "secret summary", kind: { type: "shell_completed", shellId: "1" } } },
    { type: "system.notification", timestamp: "2026-01-01T00:00:01Z", data: { content: "secret summary", kind: { type: "agent_idle", agentId: "a1", displayName: "bg", description: "secret task" } } },
  ].map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(file, lines);
  const { events: out } = events(file, 0);
  assert.deepEqual(out, [{ type: "system.notification", timestamp: "2026-01-01T00:00:01Z", data: { kind: { type: "agent_idle", agentId: "a1" } } }]);
});

test("locks lists inuse.<pid>.lock files per session folder", (t) => {
  const dir = scratch(t);
  for (const [id, files] of [["s1", ["inuse.42.lock", "events.jsonl"]], ["s2", ["inuse.x.lock"]]]) {
    mkdirSync(join(dir, id));
    for (const f of files) writeFileSync(join(dir, id, f), "");
  }
  writeFileSync(join(dir, "stray.txt"), "");
  assert.deepEqual(JSON.parse(helper("locks", dir)), [{ id: "s1", pid: 42 }]);
});
