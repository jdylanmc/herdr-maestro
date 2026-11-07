// bin/maestro commands that touch only Maestro's own files; nothing here needs hc or Herdr.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { scratch } from "./helpers.js";

const BIN = fileURLToPath(new URL("../bin/maestro", import.meta.url));
const TERM = "term-1";

function setup(t) {
  const home = scratch(t);
  const maestro = (args, env = { HC_TERMINAL_ID: TERM }) => {
    const r = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", env: { PATH: process.env.PATH, HERDR_APP_HOME: home, ...env } });
    return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr };
  };
  const record = () => JSON.parse(readFileSync(join(home, "data", "maestro", "agents", `${TERM}.json`), "utf8"));
  return { home, maestro, record };
}

test("commands that need a terminal refuse outside Herdr", (t) => {
  const { maestro } = setup(t);
  const r = maestro(["mood", "happy"], {});
  assert.equal(r.code, 1);
  assert.match(r.err, /HC_TERMINAL_ID is unset/);
});

test("unknown commands and invalid arguments exit non-zero without writing", (t) => {
  const { home, maestro } = setup(t);
  for (const [args, msg] of [
    [["nope"], /unknown command nope/],
    [["icon", "nope"], /icon must be one of/],
    [["icon", "robot", "red"], /color must be a theme color/],
    [["mood", "grumpy"], /mood must be one of/],
    [["tag", "toggle", "x"], /usage: maestro tag/],
    [["notify"], /usage: maestro notify/],
  ]) {
    const r = maestro(args);
    assert.equal(r.code, 1, args.join(" "));
    assert.match(r.err, msg);
  }
  assert.deepEqual(readdirSync(home), []);
});

test("icon, mood, tag, and name update this terminal's record", (t) => {
  const { maestro, record } = setup(t);
  assert.deepEqual(maestro(["icon", "rocket", "#AA00ff"]).out, { icon: "rocket", color: "#AA00ff" });
  assert.deepEqual(maestro(["mood", "focused"]).out, { mood: "focused" });
  assert.deepEqual(maestro(["tag", "add", "CI", "Docs"]).out, ["ci", "docs"]);
  assert.deepEqual(maestro(["tag", "rm", "docs"]).out, ["ci"]);
  assert.deepEqual(maestro(["name", "builder"]).out, { name: "builder" });
  assert.deepEqual(maestro(["icon", "clear"]).out, { icon: null });
  const r = record();
  assert.deepEqual({ icon: r.icon, color: r.color, mood: r.mood, tags: r.tags, name: r.name }, { icon: null, color: null, mood: "focused", tags: ["ci"], name: "builder" });
});

test("notify queues a toast for the mod", (t) => {
  const { home, maestro } = setup(t);
  const r = maestro(["notify", "Build", "is", "green"]);
  assert.equal(r.code, 0);
  const dir = join(home, "data", "maestro", "notify");
  const [file] = readdirSync(dir);
  assert.equal(file, `${r.out.queued}.json`);
  assert.deepEqual((({ from, title, body }) => ({ from, title, body }))(JSON.parse(readFileSync(join(dir, file), "utf8"))), { from: TERM, title: "Build", body: "is green" });
});

test("tag normalizes tags saved before slugs were enforced", (t) => {
  const { home, maestro, record } = setup(t);
  const dir = join(home, "data", "maestro", "agents");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${TERM}.json`), JSON.stringify({ tags: ["foo_bar", "release/2026"] }));
  assert.deepEqual(maestro(["tag", "rm", "foo_bar"]).out, ["release-2026"]);
  assert.deepEqual(maestro(["tag", "add", "release/2026"]).out, ["release-2026"]);
  assert.deepEqual(record().tags, ["release-2026"]);
});
