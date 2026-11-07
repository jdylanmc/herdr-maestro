import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { machineOf } from "../mods/maestro/machines.js";

// Load the real view with host imports removed; these tests exercise only its async jobs.
const source = readFileSync(new URL("../mods/maestro/main.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "")
  .replace("export default class Maestro", "class Maestro");

function view(host = {}) {
  const Maestro = runInNewContext(`${source}\nMaestro`, { View: class {}, machineOf, ...host });
  const v = new Maestro();
  v.snaps = new Map();
  v.fallback = new Map();
  v.remoteBusy = new Set();
  v.machineFor = (a) => machineOf(a.address);
  return v;
}

test("local refresh binds and tails without waiting for remote work", async () => {
  const calls = [];
  const v = view({
    appHome: () => "/app",
    home: () => "/home",
    exec: async (_command, args) => ({ stdout: JSON.stringify(args[1] === "locks" ? [{ pid: 2, id: "local" }] : [[2, 1]]) }),
    hc: async () => ({ stdout: '{"foreground":{"pid":1}}' }),
  });
  v.live = () => [{ address: "t1" }, { address: "offline/t2" }];
  v.machineFor = (a) => machineOf(a.address);
  v.loadRecords = v.loadSnaps = async () => {};
  v.bindRemote = async () => { throw new Error("local refresh must not bind remotes"); };
  v.tail = async (id, on) => { calls.push([id, on]); };
  v.snaps.set("offline/t2", { session_id: "remote" });

  await v.refresh();
  assert.equal(v.fallback.get("t1"), "local");
  assert.deepEqual(calls, [["local", null]]);
});

test("a stalled machine cannot overlap passes or delay another machine's binding and tails", async () => {
  const v = view();
  const calls = [];
  let release;
  const stalled = new Promise((resolve) => { release = resolve; });
  let completed;
  const fastDone = new Promise((resolve) => { completed = resolve; });
  v.live = () => [{ address: "slow/t1" }, { address: "fast/t2" }];
  v.loadRemoteSnaps = async (on) => { calls.push(`snaps:${on}`); if (on === "slow") await stalled; };
  v.bindRemote = async (on) => { calls.push(`bind:${on}`); };
  v.tailAll = async (on) => { calls.push(`tail:${on}`); };
  const cx = { notify: () => { calls.push("notify"); completed(); } };
  const first = v.refreshRemote(cx);
  await fastDone;
  await v.refreshRemote(cx);
  assert.equal(calls.filter((c) => c === "snaps:slow").length, 1);
  assert.ok(calls.includes("bind:fast"));
  assert.ok(calls.includes("tail:fast"));
  assert.ok(calls.includes("notify"));
  assert.ok(v.remoteBusy.has("slow"));
  release();
  await first;
  assert.equal(v.remoteBusy.size, 0);
  assert.ok(calls.includes("tail:slow"));
});

test("failed remote work releases its guard and reports the failure for retry", async () => {
  const v = view();
  let attempts = 0;
  let notifications = 0;
  v.live = () => [{ address: "box/t1" }];
  v.loadRemoteSnaps = async () => {};
  v.bindRemote = async () => { if (++attempts === 1) throw new Error("unreachable"); };
  v.tailAll = async () => {};
  const cx = { notify: () => { notifications++; } };
  await assert.rejects(v.refreshRemote(cx), /unreachable/);
  assert.equal(v.remoteBusy.size, 0);
  await v.refreshRemote(cx);
  assert.equal(attempts, 2);
  assert.equal(notifications, 2);
});

test("remote passes also cover agents identified by their space's machine", async () => {
  const v = view();
  const calls = [];
  v.live = () => [{ address: "t1", space: "box/s1" }];
  v.machineFor = () => "box";
  v.loadRemoteSnaps = async (on) => { calls.push(`snaps:${on}`); };
  v.bindRemote = async (on) => { calls.push(`bind:${on}`); };
  v.tailAll = async (on) => { calls.push(`tail:${on}`); };
  await v.refreshRemote({ notify() {} });
  assert.deepEqual(calls, ["snaps:box", "bind:box", "tail:box"]);
});
