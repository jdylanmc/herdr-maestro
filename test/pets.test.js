import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodePng, encodeGif, renderPet } from "../mods/maestro/pets.mjs";
import { png, rgba, scratch } from "./helpers.js";

// Image Descriptor blocks (0x2c) that follow a Graphic Control Extension (21 f9 04 ...).
const gifFrames = (gif) => {
  let n = 0;
  for (let i = 0; i + 8 < gif.length; i++) if (gif[i] === 0x21 && gif[i + 1] === 0xf9 && gif[i + 2] === 4 && gif[i + 8] === 0x2c) n++;
  return n;
};

test("encodeGif writes an animated GIF89a with one image per frame", () => {
  const frame = (r) => ({ w: 3, h: 2, px: Buffer.from(Array.from({ length: 6 }, (_, i) => (i === 0 ? [0, 0, 0, 0] : [r, 40, 200, 255])).flat()) });
  const gif = encodeGif([frame(10), frame(250), frame(120)]);
  assert.equal(gif.toString("latin1", 0, 6), "GIF89a");
  assert.equal(gif.readUInt16LE(6), 3);
  assert.equal(gif.readUInt16LE(8), 2);
  assert.ok(gif.includes(Buffer.from("NETSCAPE2.0")), "loops");
  assert.equal(gifFrames(gif), 3);
  assert.equal(gif.at(-1), 0x3b, "trailer");
});

test("decodePng reverses scanline filters and expands palette transparency", () => {
  // 2x2 RGB: row 0 Sub-filtered, row 1 Up-filtered.
  const rgb = decodePng(png(2, 2, 2, [[1, 10, 20, 30, 5, 5, 5], [2, 1, 1, 1, 2, 2, 2]]));
  assert.deepEqual([...rgb.px], [10, 20, 30, 255, 15, 25, 35, 255, 11, 21, 31, 255, 17, 27, 37, 255]);
  const pal = decodePng(png(2, 1, 3, [[0, 0, 1]], [["PLTE", Buffer.from([255, 0, 0, 0, 0, 255])], ["tRNS", Buffer.from([0])]]));
  assert.deepEqual([...pal.px], [255, 0, 0, 0, 0, 0, 255, 255]);
  assert.throws(() => decodePng(Buffer.from("GIF89a-not-a-png")), /not a PNG/);
});

test("renderPet turns a 9-row sheet into per-row GIFs and caches by sheet stamp", (t) => {
  const dir = scratch(t);
  const pet = join(dir, "pet"), out = join(dir, "out");
  mkdirSync(pet);
  // 1/8-scale Codex sheet: 8 columns of 24x26 cells, 9 rows.
  writeFileSync(join(pet, "spritesheet.png"), rgba(192, 234, (x, y) => [x, y, (x * y) & 255, x % 24 < 12 ? 255 : 0]));
  writeFileSync(join(pet, "pet.json"), JSON.stringify({ id: "tiny", displayName: "Tiny", spritesheetPath: "spritesheet.png" }));
  const meta = renderPet(join(pet, "pet.json"), out);
  assert.deepEqual({ ...meta, stamp: undefined }, { id: "tiny", name: "Tiny", moods: false, rows: [0, 1, 2, 3, 4, 5, 6, 7, 8], stamp: undefined });
  const idle = readFileSync(join(out, "tiny", "0.gif"));
  assert.equal(idle.toString("latin1", 0, 6), "GIF89a");
  assert.deepEqual([idle.readUInt16LE(6), idle.readUInt16LE(8)], [96, 104]);
  assert.equal(gifFrames(idle), 6);
  const before = statSync(join(out, "tiny", "0.gif")).mtimeMs;
  const { skipped, ...again } = renderPet(join(pet, "pet.json"), out);
  assert.equal(skipped, true, "a cached render says it skipped");
  assert.deepEqual(again, meta);
  assert.equal(statSync(join(out, "tiny", "0.gif")).mtimeMs, before, "unchanged sheet is not re-rendered");
});
