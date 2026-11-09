// Static checks that run without the Herdr app: every script parses as an ES module (mods
// import Herdr-only virtual modules, so they are parsed, never run) and every JSON file loads.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { missingMods } from "./lib/layout-mods.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const walk = (dir) => readdirSync(join(root, dir)).flatMap((n) => {
  const p = join(dir, n);
  return statSync(join(root, p)).isDirectory() ? walk(p) : [p];
});

const scripts = [...walk("bin"), ...walk("mods"), ...walk("scripts"), ...walk("test")]
  .filter((p) => p.startsWith(`bin${sep}`) || /\.(m?js)$/.test(p));
const json = [...walk("layouts"), ...walk("mods"), ".changeset/config.json", "package.json"]
  .filter((p) => p.endsWith(".json"));

let failed = 0;
for (const p of scripts) {
  const r = spawnSync(process.execPath, ["--input-type=module", "--check"], { input: readFileSync(join(root, p)), encoding: "utf8" });
  if (r.status !== 0) { failed++; process.stderr.write(`${p}: ${r.stderr.replace(/\n\s+at [\s\S]*$/, "")}\n`); }
}
for (const p of json) {
  try { JSON.parse(readFileSync(join(root, p), "utf8")); }
  catch (e) { failed++; process.stderr.write(`${p}: ${e.message}\n`); }
}
for (const p of walk("layouts").filter((p) => p.endsWith(".json"))) {
  let missing = [];
  try { missing = missingMods(JSON.parse(readFileSync(join(root, p), "utf8")), root); } catch { continue; }
  if (missing.length) { failed++; process.stderr.write(`${p}: mods neither shipped with Herdr nor in mods/: ${missing.join(", ")}\n`); }
}
if (failed) process.exit(1);
console.log(`syntax ok: ${scripts.length} scripts; json ok: ${json.length} files`);
