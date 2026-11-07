import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { herdrSlug, herdrPath, siblingPath, repoOf, chooseKind, kindOf, removalBlocker, spacePlace, nestSpaces } from "../mods/maestro/wtlib.js";

test("Herdr worktree paths follow its mod: ~/.herdr/worktrees/<repo>/<slug>", () => {
  assert.equal(herdrSlug("feat/x y"), "feat-x-y");
  assert.equal(herdrSlug("/-lead/"), "lead");
  assert.equal(herdrPath("/home/me", "app", "feat/login"), "/home/me/.herdr/worktrees/app/feat-login");
  assert.equal(herdrPath("C:\\Users\\me\\", "app", "fix"), "C:/Users/me/.herdr/worktrees/app/fix");
});

test("sibling paths keep the old <repo>-<branch> shape", () => {
  assert.equal(siblingPath("/src/app", "feat/login"), "/src/app-feat-login");
  assert.equal(siblingPath("/src/app/", "x"), "/src/app-x");
  assert.equal(siblingPath("C:\\src\\app", "x"), "C:\\src\\app-x");
});

test("repoOf names the main checkout from the common git dir", () => {
  assert.deepEqual(repoOf("/src/app/.git"), { main: "/src/app", name: "app" });
  assert.deepEqual(repoOf("/srv/app.git"), { main: "/srv/app.git", name: "app" });
  assert.deepEqual(repoOf("C:\\src\\app\\.git\n"), { main: "C:/src/app", name: "app" });
});

test("kind: flag, then env, then shared config, else sibling", () => {
  assert.equal(chooseKind(), "sibling");
  assert.equal(chooseKind(["--herdr-space"]), "herdr");
  assert.equal(chooseKind(["--sibling"], { MAESTRO_WORKTREE: "herdr" }), "sibling");
  assert.equal(chooseKind([], { MAESTRO_WORKTREE: "herdr" }, { "maestro.worktreeKind": "sibling" }), "herdr");
  assert.equal(chooseKind([], {}, { "maestro.worktreeKind": "herdr" }), "herdr");
  assert.equal(chooseKind([], { MAESTRO_WORKTREE: "bogus" }), "sibling");
  assert.equal(kindOf({}), "sibling");
  assert.equal(kindOf({ kind: "herdr" }), "herdr");
  assert.equal(kindOf({ kind: "??" }), "sibling");
});

test("removal refuses a live worker, any live terminal inside, or dirty without --force", () => {
  const path = "/w/app/feat";
  assert.match(removalBlocker({ path, entry: { terminal: "t3" }, live: [{ address: "t3", cwd: "/elsewhere" }] }), /worker t3/);
  assert.match(removalBlocker({ path, live: [{ address: "t9", cwd: "/w/app/feat/src" }] }), /live terminal t9/);
  assert.match(removalBlocker({ path, live: [{ address: "t9", cwd: "/w/app/feat" }], force: true }), /live terminal t9/);
  assert.equal(removalBlocker({ path, live: [{ address: "t9", cwd: "/w/app/feature" }] }), null);
  assert.match(removalBlocker({ path, dirty: true }), /uncommitted/);
  assert.equal(removalBlocker({ path, dirty: true, force: true }), null);
  assert.equal(removalBlocker({ path, entry: { terminal: "t3" }, live: [] }), null);
});

test("CLI removal canonicalizes symlinks without changing stored paths or bypassing live terminals", (t) => {
  const root = mkdtempSync(join(tmpdir(), "maestro-worktree-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const physical = join(root, "physical");
  const path = join(root, "linked");
  mkdirSync(join(physical, "src"), { recursive: true });
  symlinkSync(physical, path, process.platform === "win32" ? "junction" : "dir");
  const source = readFileSync(new URL("../bin/maestro", import.meta.url), "utf8");
  const method = source.slice(source.indexOf("  worktree("), source.indexOf("  // This agent's icon"));
  let live = [];
  let dirty = "";
  let removed;
  let saved;
  const cli = runInNewContext(`({${method}})`, {
    existsSync, realpathSync, wt: { removalBlocker, kindOf },
    worktrees: () => ({ [path]: { repo: root, branch: "feat", kind: "sibling" } }),
    json: () => ({ terminals: live }),
    git: (cwd, args) => args[0] === "status" ? dirty : (removed = args.at(-1)),
    fail: (message) => { throw new Error(message); },
    writeJson: (_path, value) => { saved = value; },
    WORKTREES: "unused", out: () => {},
  });
  for (const cwd of [realpathSync(join(physical, "src")), join(path, "src")]) {
    live = [{ address: "other", cwd }];
    for (const flags of [[], ["--force"]]) {
      assert.throws(() => cli.worktree(["rm", path, ...flags]), /live terminal other/);
      assert.equal(removed, undefined);
      assert.equal(saved, undefined);
    }
  }
  live = [];
  dirty = "?? file";
  assert.throws(() => cli.worktree(["rm", path]), (e) => e.message.includes(`${path} has uncommitted changes`));
  cli.worktree(["rm", path, "--force"]);
  assert.equal(removed, path);
  assert.deepEqual(Object.keys(saved), []);
});

function menuFor(sessions, space, dirty = false) {
  const elements = new Map();
  const element = () => {
    const state = {};
    const el = new Proxy(state, {
      get: (target, key) => key in target ? target[key] : (...args) => {
        if (key === "id") elements.set(args[0], state);
        else if (key === "when" && args[0]) args[1](el);
        else if (key === "on_click") state.click = args[0];
        else if (key === "tooltip") state.tip = args[0];
        return el;
      },
    });
    return el;
  };
  const source = readFileSync(new URL("../mods/maestro/main.js", import.meta.url), "utf8");
  const method = source.slice(source.indexOf("  worktreeMenu("), source.indexOf("  railSpace("));
  const view = runInNewContext(`({${method}})`, { h_flex: element, v_flex: element, div: element, svg: element });
  view.sessions = () => sessions;
  view.wtMenu = { id: space, dirty };
  view.worktreeMenu({}, { id: space }, { linked: true });
  return elements.get(`spw-rm-${space}`);
}

test("worktree menu blocks agents in their actual space even when hidden or nested elsewhere", () => {
  for (const status of ["working", "blocked", "idle", "done"]) {
    const sessions = [
      { a: { address: "parent", space: "main", status: "working" } },
      { a: { address: "child", parent: "parent", space: "worktree", status } },
    ];
    const remove = menuFor(sessions, "worktree");
    assert.equal(remove.click, undefined, status);
    assert.match(remove.tip, /1 agent still in it/, status);
  }
});

test("worktree menu does not count children in another space and keeps the dirty guard", () => {
  const sessions = [{ a: { address: "child", parent: "gone", space: "other", status: "working" } }];
  assert.equal(typeof menuFor(sessions, "worktree").click, "function");
  assert.match(menuFor(sessions, "worktree", true).tip, /uncommitted changes/);
  assert.match(menuFor(sessions, "worktree", null).tip, /checking/);
});

test("spacePlace prefers the first terminal's folder", () => {
  const sp = { tabs: [{ id: "a" }], folder: "/made" };
  assert.equal(spacePlace(sp, [{ tab: "b", cwd: "/x" }, { tab: "a", cwd: "/now" }]), "/now");
  assert.equal(spacePlace(sp, []), "/made");
  assert.equal(spacePlace(null), null);
});

test("worktree spaces nest under their repo's main space, in order", () => {
  const main = { main: "/r", linked: false };
  const wt = { main: "/r", linked: true };
  const rows = [
    { id: "w1", g: wt },
    { id: "other", g: null },
    { id: "m", g: main },
    { id: "w2", g: wt },
    { id: "orphan", g: { main: "/q", linked: true } },
  ];
  assert.deepEqual(nestSpaces(rows).map((r) => [r.id, r.tree]), [["other", null], ["m", null], ["w1", "├─"], ["w2", "└─"], ["orphan", null]]);
  const twice = nestSpaces([{ id: "m1", g: main }, { id: "m2", g: main }, { id: "w", g: wt }]);
  assert.deepEqual(twice.map((r) => [r.id, r.tree]), [["m1", null], ["w", "└─"], ["m2", null]]);
});
