// Mods a layout needs. Herdr 0.1.14 refuses a layout that names a missing mod and falls back
// to its default view, so the Maestro layout may only name Herdr-shipped mods or this repo's.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const herdrMods = JSON.parse(readFileSync(new URL("./herdr-mods.json", import.meta.url), "utf8"));

export function layoutMods(node, out = new Set()) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const n of node) layoutMods(n, out); return out; }
  if (typeof node.mod === "string") out.add(node.mod);
  for (const v of Object.values(node)) layoutMods(v, out);
  return out;
}

export function missingMods(layout, root) {
  return [...layoutMods(layout)].filter((m) => !herdrMods.includes(m) && !existsSync(join(root, "mods", m, "main.js")));
}
