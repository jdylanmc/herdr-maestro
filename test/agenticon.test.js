import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ICONS, parseGlyph, parseColor, cleanChoice, resolveIcon, withIcon, pickerItems, pickerStep } from "../mods/maestro/agenticon.js";

test("an icon is a preset or one glyph", () => {
  assert.equal(parseGlyph("rocket"), "rocket");
  assert.equal(parseGlyph(" \u{F121} "), "\u{F121}");
  assert.equal(parseGlyph("🦊"), "🦊");
  assert.equal(parseGlyph("❤️"), "❤");
  for (const bad of ["", "  ", "ab", "rockets", null, undefined, "\u{F121}\u{F121}"]) assert.equal(parseGlyph(bad), null, String(bad));
});

test("a color is a theme name or #rrggbb", () => {
  assert.equal(parseColor("ansi4"), "ansi4");
  assert.equal(parseColor("accent"), "accent");
  assert.equal(parseColor("ansi12"), "ansi12");
  assert.equal(parseColor("#3FAE6A"), "#3fae6a");
  assert.equal(parseColor("3fae6a"), "#3fae6a");
  for (const bad of ["red", "#fff", "ansi99", "", null]) assert.equal(parseColor(bad), null, String(bad));
});

test("stored choices keep only valid fields", () => {
  assert.deepEqual(cleanChoice({ icon: "bug", color: "nope" }), { icon: "bug", color: null });
  assert.deepEqual(cleanChoice({ color: "#ABCDEF" }), { icon: null, color: "#abcdef" });
  for (const bad of [null, "bug", {}, { icon: "two words", color: "red" }]) assert.equal(cleanChoice(bad), null);
});

test("precedence: human > agent > program > auto", () => {
  const program = { icon: "agents/claude.svg", tint: true };
  const agent = { icon: "bug", color: "ansi2" };
  const human = { icon: "rocket", color: "#123456" };
  assert.deepEqual(resolveIcon({ human, agent, program, key: "k" }), { source: "human", glyph: ICONS.rocket, color: "#123456" });
  assert.deepEqual(resolveIcon({ agent, program, key: "k" }), { source: "agent", glyph: ICONS.bug, color: "ansi2" });
  assert.deepEqual(resolveIcon({ agent: {}, program, key: "k" }), { source: "program", program, color: null });
  const auto = resolveIcon({ key: "k" });
  assert.equal(auto.source, "auto");
  assert.ok(Object.values(ICONS).includes(auto.glyph));
  assert.deepEqual(resolveIcon({ key: "k" }), auto, "auto is stable per key");
  assert.equal(resolveIcon({ agent: { icon: "" }, key: "k" }).color, null);
});

test("a human color alone recolors the agent's icon; an invalid human pick falls through", () => {
  assert.deepEqual(resolveIcon({ human: { color: "accent" }, agent: { icon: "bug", color: "ansi2" }, key: "k" }), { source: "agent", glyph: ICONS.bug, color: "accent" });
  assert.deepEqual(resolveIcon({ human: { icon: "xx" }, agent: { icon: "\u{F121}" }, key: "k" }), { source: "agent", glyph: "\u{F121}", color: null });
});

test("setting and resetting one agent's icon leaves the others alone", () => {
  const icons = { a: { icon: "bug", color: null }, b: { icon: "star", color: "ansi3" } };
  assert.deepEqual(withIcon(icons, "a", { icon: "rocket", color: "ansi1" }), { a: { icon: "rocket", color: "ansi1" }, b: icons.b });
  assert.deepEqual(withIcon(icons, "a", null), { b: icons.b });
  assert.deepEqual(withIcon(icons, "a", { icon: null, color: null }), { b: icons.b });
  assert.deepEqual(withIcon(undefined, "c", { icon: "eye" }), { c: { icon: "eye", color: null } });
  assert.deepEqual(icons.a, { icon: "bug", color: null });
});

test("arrowing from the last preset focuses the first, then second, color: the swatch Enter applies", () => {
  const { items, icons, colors } = pickerItems(["ansi1", "ansi2", "ansi3"]);
  const n = Object.keys(ICONS).length;
  const ring = (at) => [...icons.flat(), ...colors.flat()].filter((it) => it.at === at);
  let at = pickerStep(n - 2, "right", items.length);
  assert.equal(at, n - 1);
  at = pickerStep(at, "right", items.length);
  assert.deepEqual(ring(at), [{ color: "ansi1", at }]);
  assert.equal(items[at].color, "ansi1");
  at = pickerStep(at, "right", items.length);
  assert.deepEqual(ring(at), [{ color: "ansi2", at }]);
  assert.equal(items[at].color, "ansi2");
  assert.deepEqual(icons.map((r) => r.length), [6, 6, 6]);
  assert.equal(pickerStep(null, "left", items.length), items.length - 1);
});

test("up and down keep the column across the 6-wide icon grid and the 7-wide color grid", () => {
  const n = Object.keys(ICONS).length + 13;
  assert.equal(pickerStep(12, "down", n), 18);
  assert.equal(pickerStep(18, "up", n), 12);
  assert.equal(pickerStep(17, "down", n), 23);
  assert.equal(pickerStep(23, "up", n), 17);
  assert.equal(pickerStep(24, "up", n), 17, "a color right of the icons' last column clamps to it");
  assert.equal(pickerStep(3, "down", n), 9);
  assert.equal(pickerStep(20, "down", n), 27);
  assert.equal(pickerStep(24, "down", n), 30, "a shorter last row clamps");
  assert.equal(pickerStep(30, "down", n), 30);
  assert.equal(pickerStep(2, "up", n), 2);
  assert.equal(pickerStep(15, "down", 18), 15, "no colors: stay");
});

test("the icon mod's agenticon.js is an exact copy", () => {
  const a = readFileSync(new URL("../mods/maestro/agenticon.js", import.meta.url), "utf8");
  const b = readFileSync(new URL("../mods/maestro-icon/agenticon.js", import.meta.url), "utf8");
  assert.equal(b, a, "run: cp mods/maestro/agenticon.js mods/maestro-icon/agenticon.js");
});
