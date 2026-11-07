// The maestro CLI against fake `hc` and `herdr-app` programs that log their argv.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, ".test-tmp", `maestro-cli-${process.pid}`);
const BIN = join(DIR, "bin");
const LOG = join(DIR, "calls.jsonl");
const skip = process.platform === "win32" ? "fake programs are shell scripts" : false;

// t1 (me) -> t2 (bg worker, hc child) -> t3 (its worker); t4 is a tab worker of t1 (label only); t9 is unrelated.
const TERMINALS = [
  { address: "t1", agent: "copilot", state: "live" },
  { address: "t2", agent: "copilot", state: "live", parent: "t1", name: "fixer" },
  { address: "t3", agent: "copilot", state: "live", parent: "t2" },
  { address: "t4", agent: "copilot", state: "live", labels: { "maestro.parent": "t1" } },
  { address: "t9", agent: "copilot", state: "live" },
];

const FAKE = `#!/usr/bin/env node
import * as fs from "node:fs";
import { basename } from "node:path";
const name = basename(process.argv[1]);
const a = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify([name, ...a]) + "\\n");
const T = JSON.parse(process.env.FAKE_TERMINALS);
const say = (v) => process.stdout.write(JSON.stringify(v));
if (name === "herdr-app") say(a[0] === "ls" ? { spaces: [{ id: "s1", name: "Workspace", tabs: [{ id: "tab1", name: "Parent", terminals: [{ terminal: "t1" }] }] }] } : a[1] === "tab.new" ? { terminal: "t7", tab: "tab7", space: "s1" } : { ok: true });
else if (a[0] === "ls") say({ terminals: T.map(({ labels, ...t }) => t) });
else if (a[0] === "get") say(T.find((t) => t.address === a[1]) ?? {});
else if (a[0] === "run") say({ address: "t7", state: "live" });
else if (a[0] === "interrupt") say({ key: "ctrl+c", outcome: "stopped" });
else if (a[0] === "put") say({ bytes: 1, path: "/x/" + a[2] });
else if (a[0] === "wait" && a[1] === "--children") say({ reason: "children", terminal: "t1", children: [{ terminal: "t2", reason: "idle", status: "idle", exit_code: null }] });
else if (a[0] === "wait") setTimeout(() => say({ reason: "idle", terminal: a[1], status: "idle", exit_code: null }), a[1] === "t3" ? 3000 : 10);
`;

function maestro(args, me = "t1", terminals = TERMINALS) {
  writeFileSync(LOG, "");
  const r = spawnSync(process.execPath, [join(ROOT, "bin", "maestro"), ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${BIN}:${process.env.PATH}`, HC_TERMINAL_ID: me, HERDR_APP_HOME: join(DIR, "home"), FAKE_LOG: LOG, FAKE_TERMINALS: JSON.stringify(terminals) },
  });
  const calls = readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr, calls, acts: calls.filter((c) => !["ls", "get"].includes(c[1])) };
}

before(() => {
  mkdirSync(BIN, { recursive: true });
  for (const n of ["hc", "herdr-app"]) { writeFileSync(join(BIN, n), FAKE); chmodSync(join(BIN, n), 0o755); }
  writeFileSync(join(DIR, "file.txt"), "x");
});
after(() => rmSync(DIR, { recursive: true, force: true }));

test("interrupt, keep and park only reach this agent's own workers (exit 3)", { skip }, () => {
  for (const cmd of ["interrupt", "keep", "park"]) {
    const r = maestro([cmd, "t9"]);
    assert.equal(r.code, 3, cmd);
    assert.match(r.err, /denied: t9/);
    assert.deepEqual(r.acts, [], `${cmd} acted on a foreign terminal`);
  }
  assert.deepEqual(maestro(["interrupt", "t3"]).acts, [["hc", "interrupt", "t3", "--json"]]);
  assert.deepEqual(maestro(["park", "fixer"]).acts, [["herdr-app", "do", "terminal.park", '{"terminal":"t2"}']]);
  assert.deepEqual(maestro(["keep", "t2", "--place", "right"]).acts, [["herdr-app", "do", "terminal.keep", '{"terminal":"t2","place":"right"}']]);
  assert.equal(maestro(["keep", "t2", "--place", "up"]).code, 1);
});

test("peek and put work on any live terminal", { skip }, () => {
  assert.deepEqual(maestro(["peek", "t9"]).acts, [["herdr-app", "do", "terminal.peek", '{"terminal":"t9"}']]);
  const put = maestro(["put", "t9", join(DIR, "file.txt")]);
  assert.deepEqual(put.acts, [["hc", "put", "t9", join(DIR, "file.txt"), "--json"]]);
  assert.equal(put.out.terminal, "t9");
  assert.equal(maestro(["put", "t9", join(DIR, "missing.txt")]).code, 1);
  assert.equal(maestro(["peek", "t404"]).code, 1);
});

test("spawn --bg starts a pane-less hc child with Maestro labels and record", { skip }, () => {
  const r = maestro(["spawn", "--bg", "--name", "Code Review!", "--cwd", ROOT, "--task", "review x"]);
  assert.equal(r.code, 0, r.err);
  const run = r.acts.find((c) => c[1] === "run");
  assert.deepEqual(run.slice(0, 10), ["hc", "run", "--bg", "--json", "--name", "code-review", "--cwd", ROOT, "--label", "maestro.parent=t1"]);
  assert.deepEqual(run.slice(10, 12), ["--label", "maestro.name=Code Review!"]);
  assert.deepEqual(run.slice(-5), ["run", "copilot", "--yolo", "-i", "review x"]);
  assert.ok(!r.acts.some((c) => c[0] === "herdr-app"), "no tab for a background worker");
  assert.deepEqual(r.out, { address: "t7", parent: "t1", background: true });
  const rec = JSON.parse(readFileSync(join(DIR, "home", "data", "maestro", "agents", "t7.json"), "utf8"));
  assert.equal(rec.parent, "t1");
  assert.equal(rec.background, true);
});

test("wait: children by default plus tab workers; explicit targets; --any returns the first", { skip }, () => {
  const all = maestro(["wait", "--all"]);
  assert.deepEqual(all.acts.map((c) => c.slice(1)).sort(), [["wait", "--children", "all", "--json"], ["wait", "t4", "--json"]]);
  assert.deepEqual(all.out.finished.map((f) => f.terminal).sort(), ["t2", "t4"]);
  const any = maestro(["wait", "t3", "fixer", "--timeout", "30"]);
  assert.equal(any.out.mode, "any");
  assert.deepEqual(any.out.finished.map((f) => f.terminal), ["t2"]);
  assert.ok(any.acts.some((c) => c.join(" ") === "hc wait t3 --timeout 30 --json"));
  assert.equal(maestro(["wait", "--sometimes"]).code, 1);
  assert.equal(maestro(["wait", "--children", "most"]).code, 1);
  assert.ok(!existsSync(join(DIR, "home", "data", "maestro", "agents", "t1.json")), "wait writes nothing");
});

test("wait validates every explicit target before starting any hc wait", { skip }, () => {
  const r = maestro(["wait", "fixer", "t404"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /no live terminal t404/);
  assert.deepEqual(r.acts, [], "an invalid target must not leave an hc wait running");
});

test("peers includes a parked label-only worker in its parent's space", { skip }, () => {
  const r = maestro(["peers"]);
  assert.equal(r.code, 0, r.err);
  const parked = r.out.find((t) => t.address === "t4");
  assert.equal(parked.parent, "t1");
  assert.equal(parked.space, "Workspace");
  assert.ok(!r.out.some((t) => t.address === "t9"));
});

test("nested background workers share their ancestor's space for peers and tab spawns", { skip }, () => {
  for (const me of ["t1", "t2", "t3"]) {
    const r = maestro(["peers"], me);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.out.map((t) => t.address).sort(), ["t1", "t2", "t3", "t4"].filter((t) => t !== me));
    assert.ok(r.out.every((t) => t.space === "Workspace"));
  }
  const spawned = maestro(["spawn", "--name", "Nested tab"], "t3");
  assert.equal(spawned.code, 0, spawned.err);
  const tab = spawned.acts.find((c) => c[1] === "do" && c[2] === "tab.new");
  assert.equal(JSON.parse(tab[3]).space, "s1");
});

test("space inheritance terminates on a cyclic parent chain", { skip }, () => {
  const terminals = [...TERMINALS, { address: "t5", agent: "copilot", parent: "t6" }, { address: "t6", agent: "copilot", parent: "t5" }];
  const r = maestro(["whoami"], "t5", terminals);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.space, null);
  assert.equal(r.out.parent, "t6");
});
