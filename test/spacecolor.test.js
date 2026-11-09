import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHex, spaceFill, inkOn, swatches, withColor, MARK } from "../mods/maestro/spacecolor.js";

const t = { accent: "#7aa2f7", ansi9: "#ff0000", ansi10: "#3fae6a", ansi11: "#ffff00", ansi12: "#7aa2f7", ansi4: "#0000ff" };

test("custom colors must be #rrggbb; case and a missing # are forgiven", () => {
  assert.equal(parseHex("#3FAE6A"), "#3fae6a");
  assert.equal(parseHex(" 3fae6a "), "#3fae6a");
  for (const bad of ["#fff", "#3fae6", "#3fae6ag", "red", "", null, undefined, "#3fae6a80"]) assert.equal(parseHex(bad), null, String(bad));
});

test("a space's fill: hex as is, Herdr's six as its Spaces sidebar draws them, other names from the theme", () => {
  assert.equal(spaceFill(t, "#123456"), "#123456");
  assert.equal(spaceFill(t, "ansi4"), MARK.ansi4);
  assert.equal(spaceFill(t, "ansi9"), "#ff0000");
  assert.equal(spaceFill(t, "accent"), "#7aa2f7");
  assert.equal(spaceFill(t, undefined), MARK.ansi6);
  assert.equal(spaceFill(t, "ansi99"), "#7aa2f7");
  assert.equal(spaceFill({}, "ansi99"), MARK.ansi6);
});

test("avatar letters stay readable on light fills", () => {
  assert.equal(inkOn("#ffff00"), "#000000");
  assert.equal(inkOn("#22a99a"), "#ffffff");
  assert.equal(inkOn("#000000ff"), "#ffffff");
  assert.equal(inkOn("rgb(1,2,3)"), "#ffffff");
});

test("swatches: Herdr's six first, then theme colors that exist, without repeats", () => {
  const names = swatches(t).map((s) => s.name);
  assert.deepEqual(names.slice(0, 6), ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"]);
  assert.deepEqual(names.slice(6), ["accent", "ansi9", "ansi11"]);
  assert.ok(swatches(t).every((s) => s.group === (names.indexOf(s.name) < 6 ? "herdr" : "theme")));
});

test("setting and resetting a space's color leaves the others alone", () => {
  const colors = { a: "ansi3", b: "#123456" };
  assert.deepEqual(withColor(colors, "a", "accent"), { a: "accent", b: "#123456" });
  assert.deepEqual(withColor(colors, "a", null), { b: "#123456" });
  assert.deepEqual(withColor(undefined, "c", "ansi2"), { c: "ansi2" });
  assert.deepEqual(colors, { a: "ansi3", b: "#123456" });
});

test("the color mod's spacecolor.js is an exact copy", () => {
  const a = readFileSync(new URL("../mods/maestro/spacecolor.js", import.meta.url), "utf8");
  const b = readFileSync(new URL("../mods/maestro-color/spacecolor.js", import.meta.url), "utf8");
  assert.equal(b, a, "run: cp mods/maestro/spacecolor.js mods/maestro-color/spacecolor.js");
});
