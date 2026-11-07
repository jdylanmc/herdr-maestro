import { test } from "node:test";
import assert from "node:assert/strict";
import { pinFirst, alertStep } from "../mods/maestro/alerts.js";

const on = { sounds: true, settle: true, debounceMs: 1000 };
const w = (status, extra = {}) => ({ address: "t2", tab: "tab2", status, needs: status === "blocked", herdrChimes: false, worker: true, tabSettled: false, ...extra });

test("pinned agents sort first and the rest keep their order", () => {
  const list = [{ n: 1 }, { n: 2, pinned: true }, { n: 3 }, { n: 4, pinned: true }];
  assert.deepEqual([...list].sort(pinFirst).map((a) => a.n), [2, 4, 1, 3]);
});

test("chimes once per transition into needing you, never on first sight", () => {
  const mem = new Map();
  assert.deepEqual(alertStep(mem, [w("blocked")], 0, on), []);
  assert.deepEqual(alertStep(mem, [w("working")], 1, on), []);
  assert.deepEqual(alertStep(mem, [w("blocked")], 2, on).map((a) => a.type), ["sound"]);
  assert.deepEqual(alertStep(mem, [w("blocked")], 3, on), []);
});

test("no chime when Herdr's own sound covers it, or when sounds are off", () => {
  const mem = new Map();
  alertStep(mem, [w("working")], 0, on);
  assert.deepEqual(alertStep(mem, [w("blocked", { herdrChimes: true })], 1, on), []);
  alertStep(mem, [w("working")], 2, on);
  assert.deepEqual(alertStep(mem, [w("blocked")], 3, { ...on, sounds: false, settle: false }), []);
});

test("settles a worker's tab after it worked and finished, debounced, then unsettles when it works again", () => {
  const mem = new Map();
  alertStep(mem, [w("idle")], 0, on);
  assert.deepEqual(alertStep(mem, [w("idle")], 5000, on), [], "never worked: left alone");
  alertStep(mem, [w("working")], 6000, on);
  assert.deepEqual(alertStep(mem, [w("done")], 7000, on), [], "debounced");
  assert.deepEqual(alertStep(mem, [w("done")], 8000, on), [{ type: "settle", tab: "tab2", address: "t2" }]);
  assert.deepEqual(alertStep(mem, [w("done")], 9000, on), [], "not twice before Herdr reports it");
  assert.deepEqual(alertStep(mem, [w("idle", { tabSettled: true })], 10000, on), []);
  alertStep(mem, [w("working", { tabSettled: true })], 11000, on);
  assert.deepEqual(alertStep(mem, [w("working", { tabSettled: true })], 12000, on), [{ type: "unsettle", tab: "tab2", address: "t2" }]);
});

test("never settles failed workers, including errors arriving during the finish debounce", () => {
  for (const status of ["idle", "done"]) {
    for (const delayed of [false, true]) {
      const mem = new Map();
      alertStep(mem, [w("working")], 0, on);
      alertStep(mem, [w(status, { failed: !delayed })], 1, on);
      assert.deepEqual(alertStep(mem, [w(status, { failed: true })], 1001, on), []);
      assert.deepEqual(alertStep(mem, [w(status, { failed: true })], 5000, on), []);
    }
  }
});

test("brings a failed worker's tab back only if Maestro settled it", () => {
  for (const ours of [false, true]) {
    const mem = new Map();
    alertStep(mem, [w("working")], 0, on);
    if (ours) {
      alertStep(mem, [w("done")], 1, on);
      alertStep(mem, [w("done")], 1001, on);
    }
    alertStep(mem, [w("idle", { failed: true, tabSettled: true })], 2000, on);
    assert.deepEqual(alertStep(mem, [w("idle", { failed: true, tabSettled: true })], 3000, on),
      ours ? [{ type: "unsettle", tab: "tab2", address: "t2" }] : []);
  }
});

test("leaves non-workers and tabs someone else showed again alone", () => {
  const mem = new Map();
  alertStep(mem, [w("working", { worker: false })], 0, on);
  alertStep(mem, [w("done", { worker: false })], 1, on);
  assert.deepEqual(alertStep(mem, [w("done", { worker: false })], 5000, on), []);
  const m2 = new Map();
  alertStep(m2, [w("working")], 0, on);
  alertStep(m2, [w("done")], 1, on);
  alertStep(m2, [w("done")], 2000, on);
  alertStep(m2, [w("idle", { tabSettled: true })], 2500, on);
  alertStep(m2, [w("idle")], 3000, on); // the person showed it
  alertStep(m2, [w("idle", { tabSettled: true })], 3500, on); // and settled it themselves
  alertStep(m2, [w("working", { tabSettled: true })], 4000, on);
  assert.deepEqual(alertStep(m2, [w("working", { tabSettled: true })], 6000, on), [], "not ours to unsettle");
});
