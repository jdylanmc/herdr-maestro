import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { scratch } from "./helpers.js";

const HELPER = fileURLToPath(new URL("../mods/maestro/helper.mjs", import.meta.url));
const helper = (...args) => execFileSync(process.execPath, [HELPER, ...args.map(String)], { encoding: "utf8" });
const tail = (file, offset, max) => {
  const [size, mode, ...rest] = helper("tail", file, offset, max).split("\n");
  return { size: Number(size), mode, text: rest.join("\n") };
};

test("tail reads from a byte offset, caps at max, and restarts after truncation", (t) => {
  const file = join(scratch(t), "events.jsonl");
  writeFileSync(file, "0123456789abcdef");
  assert.deepEqual(tail(file, 0, 100), { size: 16, mode: "whole", text: "0123456789abcdef" });
  assert.deepEqual(tail(file, 10, 100), { size: 16, mode: "whole", text: "abcdef" });
  assert.deepEqual(tail(file, 16, 100), { size: 16, mode: "whole", text: "" });
  assert.deepEqual(tail(file, 0, 4), { size: 16, mode: "cut", text: "cdef" });
  writeFileSync(file, "new");
  assert.deepEqual(tail(file, 16, 100), { size: 3, mode: "whole", text: "new" }, "a shrunk file is read from the start");
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
