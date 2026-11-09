import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { layoutMods, missingMods } from "../scripts/lib/layout-mods.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const layout = JSON.parse(readFileSync(new URL("../layouts/maestro.json", import.meta.url), "utf8"));

test("the Maestro layout only names Herdr-shipped mods or this repo's", () => {
  assert.deepEqual(missingMods(layout, root), []);
  assert.ok(layoutMods(layout).has("tabs"));
});

test("missingMods reports third-party mods, including pane headers", () => {
  const l = { children: [{ content: { mod: "tabs-graph" } }, { content: { mod: "pane", props: { header: { content: { mod: "git-graph" } } } } }, { content: { mod: "maestro" } }] };
  assert.deepEqual(missingMods(l, root).sort(), ["git-graph", "tabs-graph"]);
});
