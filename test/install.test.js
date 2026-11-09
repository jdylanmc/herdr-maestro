import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scratch } from "./helpers.js";
import { install } from "../scripts/install.mjs";

test("native install preserves settings, backs up conflicts, and is idempotent", (t) => {
  const home = scratch(t);
  const app = join(home, "herdr");
  const copilot = join(home, "copilot");
  const bin = join(home, "bin with spaces");
  mkdirSync(app, { recursive: true });
  mkdirSync(copilot, { recursive: true });
  writeFileSync(join(app, "keys.json"), JSON.stringify({ global: { f2: "tab.rename" } }));
  writeFileSync(join(copilot, "settings.json"), JSON.stringify({ custom: true }));
  const options = { app, copilot, bin, check: false };
  install(options);
  assert.ok(readdirSync(copilot).some((name) => name.startsWith("settings.json.backup.")));
  const keys = JSON.parse(readFileSync(join(app, "keys.json"), "utf8"));
  const settings = JSON.parse(readFileSync(join(copilot, "settings.json"), "utf8"));
  const modifier = process.platform === "win32" ? "ctrl" : "cmd";
  assert.equal(keys.global.f2, "tab.rename");
  assert.equal(keys.global[`${modifier}-shift-m`], "layout.switch:maestro");
  assert.equal(keys["layout:maestro"][`${modifier}-shift-t`], "maestro.tags");
  assert.equal(settings.custom, true);
  assert.match(settings.statusLine.command, /maestro-statusline/);
  const snapshot = { session_id: "install-test", context_window: { used_percentage: 12 } };
  const status = execSync(settings.statusLine.command, {
    encoding: "utf8", input: JSON.stringify(snapshot),
    env: { ...process.env, HERDR_APP_HOME: app, HC_TERMINAL_ID: "install-test" },
  });
  assert.match(status, /ctx 12%/);
  assert.deepEqual(JSON.parse(readFileSync(join(app, "data", "maestro", "terminals", "install-test.json"), "utf8")), snapshot);
  if (process.platform === "win32") {
    const output = execSync(`"${join(bin, "maestro.cmd")}" pet ls`, {
      encoding: "utf8", env: { ...process.env, HERDR_APP_HOME: app },
    });
    assert.deepEqual(JSON.parse(output), []);
  }
  assert.ok(existsSync(join(app, "layouts", "maestro.json")));
  assert.equal(realpathSync(join(app, "mods", "maestro")), realpathSync(new URL("../mods/maestro", import.meta.url)));
  assert.ok(existsSync(join(app, "mods", "maestro", "fonts", "JetBrainsMonoNerdFontMono-Regular.ttf")));
  install(options);
  assert.deepEqual(JSON.parse(readFileSync(join(app, "keys.json"), "utf8")), keys);
  assert.deepEqual(JSON.parse(readFileSync(join(copilot, "settings.json"), "utf8")), settings);
});

test("native install leaves another status line intact and rejects invalid settings", (t) => {
  const home = scratch(t);
  const app = join(home, "herdr");
  const copilot = join(home, "copilot");
  mkdirSync(copilot, { recursive: true });
  const settings = { statusLine: { type: "command", command: "another-plugin" } };
  writeFileSync(join(copilot, "settings.json"), JSON.stringify(settings));
  install({ app, copilot, bin: join(home, "bin"), check: false });
  assert.deepEqual(JSON.parse(readFileSync(join(copilot, "settings.json"), "utf8")), settings);
  writeFileSync(join(copilot, "settings.json"), "{bad");
  assert.throws(() => install({ app, copilot, bin: join(home, "bin"), check: false }), SyntaxError);
  assert.equal(readFileSync(join(copilot, "settings.json"), "utf8"), "{bad");
});

test("native install refuses a conflicting shortcut before writing settings or mods", (t) => {
  const home = scratch(t);
  const app = join(home, "herdr");
  const copilot = join(home, "copilot");
  mkdirSync(app, { recursive: true });
  const keys = JSON.stringify({ global: { f2: "tab.rename" } });
  writeFileSync(join(app, "keys.json"), keys);
  assert.throws(() => install({ app, copilot, bin: join(home, "bin"), key: "f2", check: false }), /already bound/);
  assert.equal(readFileSync(join(app, "keys.json"), "utf8"), keys);
  assert.equal(existsSync(join(copilot, "settings.json")), false);
  assert.equal(existsSync(join(app, "mods")), false);
});
