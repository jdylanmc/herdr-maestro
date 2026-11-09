import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the mod ships its named icon font with every private-use glyph it renders", () => {
  const source = readFileSync(new URL("../mods/maestro/main.js", import.meta.url), "utf8");
  const family = /const NERD = "([^"]+)"/.exec(source)[1];
  const glyphs = [...source.matchAll(/\\u(?:\{([0-9a-f]+)\}|([0-9a-f]{4}))/gi)]
    .map((match) => parseInt(match[1] ?? match[2], 16))
    .filter((cp) => (cp >= 0xe000 && cp <= 0xf8ff) || cp >= 0xf0000);
  assert.ok(glyphs.length > 0, "exercise the icons used by the mod");
  const font = readFileSync(new URL("../mods/maestro/fonts/JetBrainsMonoNerdFontMono-Regular.ttf", import.meta.url));
  const tables = new Map();
  for (let i = 0; i < font.readUInt16BE(4); i++) {
    const offset = 12 + i * 16;
    tables.set(font.toString("ascii", offset, offset + 4), font.readUInt32BE(offset + 8));
  }
  const names = tables.get("name");
  let familyFound = false;
  for (let i = 0; i < font.readUInt16BE(names + 2); i++) {
    const offset = names + 6 + i * 12;
    if (![1, 16].includes(font.readUInt16BE(offset + 6)) || font.readUInt16BE(offset) !== 3) continue;
    const start = names + font.readUInt16BE(names + 4) + font.readUInt16BE(offset + 10);
    const text = Buffer.from(font.subarray(start, start + font.readUInt16BE(offset + 8))).swap16().toString("utf16le");
    if (text === family) familyFound = true;
  }
  assert.ok(familyFound, `the installed font must resolve as ${family}`);
  const cmap = tables.get("cmap");
  let coverage = null;
  for (let i = 0; i < font.readUInt16BE(cmap + 2); i++) {
    const offset = cmap + font.readUInt32BE(cmap + 4 + i * 8 + 4);
    if (font.readUInt16BE(offset) === 12) { coverage = offset; break; }
  }
  assert.notEqual(coverage, null, "full Unicode cmap covers BMP and supplementary icons");
  for (const cp of new Set(glyphs)) {
    let found = false;
    for (let i = 0; i < font.readUInt32BE(coverage + 12); i++) {
      const offset = coverage + 16 + i * 12;
      const start = font.readUInt32BE(offset);
      if (cp >= start && cp <= font.readUInt32BE(offset + 4) && font.readUInt32BE(offset + 8) + cp - start !== 0) {
        found = true; break;
      }
    }
    assert.ok(found, `missing icon U+${cp.toString(16).toUpperCase()}`);
  }
});
