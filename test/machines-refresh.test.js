import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { machineOf, spaceEntries } from "../mods/maestro/machines.js";
import { nestSpaces, spacePlace } from "../mods/maestro/wtlib.js";

// Load the real view with host imports removed; these tests exercise only its async jobs.
const source = readFileSync(new URL("../mods/maestro/main.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "")
  .replace("export default class Maestro", "class Maestro");

function view(host = {}) {
  const Maestro = runInNewContext(`${source}\nMaestro`, { View: class {}, machineOf, spaceEntries, nestSpaces, spacePlace, ...host });
  const v = new Maestro();
  v.snaps = new Map();
  v.fallback = new Map();
  v.remoteBusy = new Set();
  v.machineFor = (a) => machineOf(a.address);
  v.git = new Map();
  v.gitBusy = new Set();
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

test("remote tails preserve the space-machine fallback without treating bare addresses as remote hc targets", async () => {
  const v = view();
  const calls = [];
  v.live = () => [{ address: "t1", space: "box/s1" }];
  v.machineFor = () => "box";
  v.snaps.set("t1", { session_id: "remote" });
  v.remoteInfo = () => { throw new Error("bare addresses must not use remote binding or snapshot reads"); };
  v.tail = async (id, on) => { calls.push([id, on]); };
  await v.refreshRemote({ notify() {} });
  assert.deepEqual(calls, [["remote", "box"]]);
});

test("a stalled remote git job neither blocks new local folders nor overlaps on its machine", async () => {
  let release;
  const stalled = new Promise((resolve) => { release = resolve; });
  const v = view({
    exec: async (_command, args, options) => {
      if (options?.on === "slow") await stalled;
      return { code: 0, stdout: `${args[1]}/.git\n${args[1]}\nfeature\n` };
    },
  });
  const jobs = [];
  let notifications = 0;
  v.cx = { spawn: (body) => { jobs.push(body({ notify: () => { notifications++; } })); } };
  v.refreshGit([{ cwd: "/remote", machine: "slow" }]);
  v.refreshGit([{ cwd: "/remote", machine: "slow" }, { cwd: "/local" }]);
  assert.equal(jobs.length, 2);
  await jobs[1];
  assert.equal(v.gitOf("/local").branch, "feature");
  assert.equal(v.gitOf("/remote", "slow"), null);
  assert.ok(v.gitBusy.has("slow"));
  assert.equal(notifications, 1);
  v.refreshGit([{ cwd: "/another-local" }]);
  await jobs[2];
  assert.equal(v.gitOf("/another-local").repo, "another-local");
  release();
  await jobs[0];
  assert.equal(v.gitOf("/remote", "slow").repo, "remote");
  assert.equal(v.gitBusy.size, 0);
});

test("machine headers retain worktree nesting without nesting across machines", () => {
  const list = [
    { id: "s-child", folder: "/local-child", machine: null },
    { id: "s-main", folder: "/repo", machine: null },
    { id: "box/orphan", folder: "/remote-child", machine: "box" },
    { id: "box/child", folder: "/other-child", machine: "box" },
    { id: "box/main", folder: "/other", machine: "box" },
  ];
  const v = view({ spaces: () => list, panes: () => [] });
  v.machineList = [];
  v.folded = new Set();
  for (const [key, main, linked] of [
    ["/local-child", "/repo", true],
    ["/repo", "/repo", false],
    ["box:/remote-child", "/repo", true],
    ["box:/other-child", "/other", true],
    ["box:/other", "/other", false],
  ]) v.git.set(key, { v: { main, linked } });
  const rows = Array.from(v.nestedSpaces(), ({ sp, tree }) => [sp.id, tree]);
  assert.deepEqual(rows, [
    ["mc:local", null], ["s-main", null], ["s-child", "└─"],
    ["mc:box", null], ["box/orphan", null], ["box/main", null], ["box/child", "└─"],
  ]);
  v.folded.add("mc:box");
  assert.deepEqual(Array.from(v.nestedSpaces(), ({ sp }) => sp.id), ["mc:local", "s-main", "s-child", "mc:box"]);
});
