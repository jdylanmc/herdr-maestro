import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { renderAll } from "../mods/maestro/pets.mjs";

// A synthetic half-size 9-row Codex sheet (768x936 RGBA PNG), one solid color per row.
function sheetPng(w = 768, h = 936) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 4 + 1) + 1 + x * 4, row = Math.floor(y / 104);
    raw[o] = row * 25; raw[o + 1] = 120; raw[o + 2] = 255 - row * 25; raw[o + 3] = x % 96 < 48 ? 255 : 0;
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]); // decoder ignores CRCs
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

let dir, roots, out;
before(() => {
  dir = mkdtempSync(join(fileURLToPath(new URL(".", import.meta.url)), ".pets-test-"));
  roots = join(dir, "pets");
  out = join(dir, "out");
  mkdirSync(join(roots, "blob"), { recursive: true });
  writeFileSync(join(roots, "blob", "pet.json"), JSON.stringify({ id: "blob", displayName: "Blob", description: "A test blob", spritesheetPath: "sheet.png" }));
  writeFileSync(join(roots, "blob", "sheet.png"), sheetPng());
  mkdirSync(join(roots, "nosheet"));
  writeFileSync(join(roots, "nosheet", "pet.json"), JSON.stringify({ id: "nosheet", spritesheetPath: "gone.png" }));
  mkdirSync(join(roots, "junk"));
  writeFileSync(join(roots, "junk", "pet.json"), "{");
});
after(() => rmSync(dir, { recursive: true, force: true }));

test("renders GIFs, records failures per pet and reports progress", () => {
  const index = renderAll(out, [roots]);
  const blob = index.find((p) => p.id === "blob");
  assert.deepEqual({ ...blob, rows: undefined }, { id: "blob", name: "Blob", description: "A test blob", source: "other", moods: false, rows: undefined });
  assert.deepEqual(blob.rows, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(readFileSync(join(out, "blob", "0.gif")).subarray(0, 6).toString(), "GIF89a");
  assert.match(index.find((p) => p.id === "nosheet").error, /missing/);
  assert.ok(index.find((p) => p.id === "junk").error);
  const progress = JSON.parse(readFileSync(join(out, "progress.json"), "utf8"));
  assert.equal(progress.state, "done");
  assert.equal(progress.done, 3);
  assert.equal(progress.errors, 2);
  assert.ok(!existsSync(join(out, ".render.lock")));
});

test("skips unchanged sheets; --force renders again", () => {
  const gif = join(out, "blob", "0.gif");
  writeFileSync(gif, "stale");
  renderAll(out, [roots]);
  assert.equal(readFileSync(gif, "utf8"), "stale");
  renderAll(out, [roots], { force: true });
  assert.equal(readFileSync(gif).subarray(0, 6).toString(), "GIF89a");
});

test("a live renderer's lock makes a second run return the last index", () => {
  const before = readFileSync(join(out, "index.json"), "utf8");
  writeFileSync(join(out, ".render.lock"), String(process.ppid));
  const mtime = statSync(join(out, "index.json")).mtimeMs;
  assert.deepEqual(renderAll(out, [roots], { force: true }), JSON.parse(before));
  assert.equal(statSync(join(out, "index.json")).mtimeMs, mtime);
  rmSync(join(out, ".render.lock"));
});
