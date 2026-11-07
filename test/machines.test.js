import { test } from "node:test";
import assert from "node:assert/strict";
import { machineOf, localAddress, remoteNames, spaceEntries, parseProbe, remoteArgv } from "../mods/maestro/machines.js";

const local = [{ id: "s1", machine: null }, { id: "s2", machine: null }];

test("addresses: machine/tN is remote, bare is this computer", () => {
  assert.equal(machineOf("vps/t3"), "vps");
  assert.equal(machineOf("t3"), null);
  assert.equal(machineOf(null), null);
  assert.equal(localAddress("vps/t3"), "t3");
  assert.equal(localAddress("t3"), "t3");
});

test("only this computer: the space list is unchanged, no headers", () => {
  assert.equal(spaceEntries(local, []), local);
  assert.equal(spaceEntries(local, [{ name: "sandbox", temporary: true, state: "connected" }]), local);
});

test("remote machines: headers this computer first, then by name, spaces under each", () => {
  const list = [...local, { id: "b/s1", machine: "box" }, { id: "a/s1", machine: "alpha" }];
  const known = [{ name: "box", state: "connected" }, { name: "zed", state: "asleep" }];
  const e = spaceEntries(list, known);
  assert.deepEqual(e.map((x) => (x.header ? `#${x.name}` : x.id)), ["#null", "s1", "s2", "#alpha", "a/s1", "#box", "b/s1", "#zed"]);
  assert.equal(e[0].state, "connected");
  assert.equal(e[3].state, null);
  assert.equal(e[7].state, "asleep");
  assert.deepEqual(e[7].spaces, []);
  assert.deepEqual(remoteNames(list, known), ["alpha", "box", "zed"]);
});

test("a folded machine keeps its header and spaces but lists none", () => {
  const list = [...local, { id: "b/s1", machine: "box" }];
  const e = spaceEntries(list, [], (m) => m === null);
  assert.deepEqual(e.map((x) => (x.header ? `#${x.name}` : x.id)), ["#null", "#box", "b/s1"]);
  assert.equal(e[0].folded, true);
  assert.equal(e[0].spaces.length, 2);
});

test("parseProbe accepts the probe's answer only", () => {
  assert.deepEqual(parseProbe('{"home":"/h","app":"/h/.config/herdr-app","helper":null}\n'), { home: "/h", app: "/h/.config/herdr-app", helper: null });
  assert.equal(parseProbe('{"home":"/h","app":"/a","helper":"/a/h.mjs"}').helper, "/a/h.mjs");
  assert.equal(parseProbe("node: command not found"), null);
  assert.equal(parseProbe('{"home":""}'), null);
  assert.equal(parseProbe(undefined), null);
});

test("remoteArgv wraps in the machine's helper only when it has one", () => {
  assert.deepEqual(remoteArgv(["copilot", "--yolo"], null), ["copilot", "--yolo"]);
  assert.deepEqual(remoteArgv(["copilot"], "/r/helper.mjs"), ["node", "/r/helper.mjs", "run", "copilot"]);
});
