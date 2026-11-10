import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MOOD_ROWS, MOODS, moodRow, moodGif, parseChoices, setChoice, chosenPet, resolvePet, mergeChoices, petSource, gridMove } from "../mods/maestro/petlib.js";

const nine = { id: "nine", moods: false, rows: [0, 1, 2, 3, 4, 5, 6, 7, 8] };
const atlas = { id: "atlas", moods: true, rows: [...new Set(Object.values(MOOD_ROWS).map(([a]) => a))] };

test("9-row sheets fall back to their shared rows; atlases use their own", () => {
  assert.equal(moodRow(nine, "needs-permission"), 6);
  assert.equal(moodRow(nine, "sleepy"), 0);
  assert.equal(moodRow(atlas, "needs-permission"), 13);
  assert.equal(moodGif(atlas, "celebrating"), "data/maestro/pets/atlas/19.gif");
  for (const m of MOODS) assert.ok(atlas.rows.includes(moodRow(atlas, m)));
});

test("a mood whose row was not rendered shows idle; unknown moods too", () => {
  assert.equal(moodRow({ id: "x", moods: false, rows: [0, 1] }, "working"), 0);
  assert.equal(moodRow(nine, "no-such-mood"), 0);
});

test("parseChoices tolerates junk and drops invalid ids", () => {
  assert.deepEqual(parseChoices("not json"), { default: null, sessions: {} });
  assert.deepEqual(parseChoices(null), { default: null, sessions: {} });
  assert.deepEqual(parseChoices('{"default":"../x","sessions":{"a":"koda","b":7,"c":"a/b"}}'), { default: null, sessions: { a: "koda" } });
});

test("setChoice sets, clears and sets the default without mutating", () => {
  const c = { default: "koda", sessions: { s1: "eve" } };
  assert.deepEqual(setChoice(c, "s2", "atom").sessions, { s1: "eve", s2: "atom" });
  assert.deepEqual(setChoice(c, "s1", null).sessions, {});
  assert.equal(setChoice(c, null, "ghost").default, "ghost");
  assert.deepEqual(c, { default: "koda", sessions: { s1: "eve" } });
});

test("chosenPet: session pick, then default, then Maestro's pet", () => {
  const c = { default: "koda", sessions: { s1: "eve" } };
  assert.equal(chosenPet(c, "s1"), "eve");
  assert.equal(chosenPet(c, "s2"), "koda");
  assert.equal(chosenPet({ sessions: {} }, "s1"), "maestro");
});

test("resolvePet skips failed renders", () => {
  const pets = [{ id: "bad", error: "x" }, { id: "ok" }, { id: "eve" }];
  assert.equal(resolvePet(pets, "eve").id, "eve");
  assert.equal(resolvePet(pets, "bad").id, "ok");
  assert.equal(resolvePet([], "eve"), null);
});

test("mergeChoices: first read lets the file win", () => {
  const m = mergeChoices({ default: "a", sessions: { s1: "x", s2: "y" } }, { default: "b", sessions: { s1: "z" } });
  assert.deepEqual(m, { default: "b", sessions: { s1: "z", s2: "y" } });
});

test("mergeChoices: later reads apply only file changes, keeping cache-only picks", () => {
  const prev = { default: "a", sessions: { s1: "x" } };
  // The footer picked s1 -> q in the cache; the file still says x, so the pick stays.
  assert.equal(mergeChoices({ default: "a", sessions: { s1: "q" } }, prev, prev).sessions.s1, "q");
  // An agent changed s2 and the default in the file; those win.
  const m = mergeChoices({ default: "c", sessions: { s1: "q" } }, { default: "b", sessions: { s1: "x", s2: "w" } }, prev);
  assert.deepEqual(m, { default: "b", sessions: { s1: "q", s2: "w" } });
  // A cleared file entry clears the cache when the cache still held the file's value.
  assert.deepEqual(mergeChoices({ sessions: { s1: "x" } }, { sessions: {} }, prev).sessions, {});
});

test("petSource classifies roots", () => {
  assert.equal(petSource("/h/.codex/pets"), "codex");
  assert.equal(petSource("C:\\Users\\h\\.config\\herdr-app\\data\\maestro\\pet-sources"), "added");
  assert.equal(petSource("/h/Applications/x/maestro-pet.json"), "maestro");
  assert.equal(petSource("/elsewhere"), "other");
});

test("the pokedex mod's petlib.js is an exact copy", () => {
  const a = readFileSync(new URL("../mods/maestro/petlib.js", import.meta.url), "utf8");
  const b = readFileSync(new URL("../mods/maestro-pets/petlib.js", import.meta.url), "utf8");
  assert.equal(b, a, "run: cp mods/maestro/petlib.js mods/maestro-pets/petlib.js");
});

test("gridMove wraps left/right, keeps up/down in the grid and starts at the first cell", () => {
  // 10 cells, 4 per row: rows [0-3] [4-7] [8-9]
  assert.equal(gridMove(null, "down", 10, 4), 0);
  assert.equal(gridMove(9, "right", 10, 4), 0);
  assert.equal(gridMove(0, "left", 10, 4), 9);
  assert.equal(gridMove(1, "up", 10, 4), 1);
  assert.equal(gridMove(5, "up", 10, 4), 1);
  assert.equal(gridMove(1, "down", 10, 4), 5);
  assert.equal(gridMove(7, "down", 10, 4), 9);
  assert.equal(gridMove(9, "down", 10, 4), 9);
  assert.equal(gridMove(3, "enter", 10, 4), 3);
  assert.equal(gridMove(0, "down", 0, 4), null);
});
