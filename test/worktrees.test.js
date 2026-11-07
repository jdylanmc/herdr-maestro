import { test } from "node:test";
import assert from "node:assert/strict";
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
