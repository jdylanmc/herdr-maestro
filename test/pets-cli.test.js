import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const mockCore = `import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const original = cp.execFileSync;
cp.execFileSync = (command, args, options) => {
  if (command === "hc") {
    if (JSON.stringify(args) !== JSON.stringify(["get", "t3", "--json"])) throw new Error("unexpected hc call");
    return JSON.stringify({ address: "t3", status: { app: process.env.TEST_PROVIDER } });
  }
  return original(command, args, options);
};
syncBuiltinESMExports();`;

for (const provider of ["claude", "codex", "copilot"]) {
  test(`pet CLI uses ${provider === "copilot" ? "session" : "terminal"} identity for ${provider} with a stale snapshot`, (t) => {
    const home = mkdtempSync(join(tmpdir(), "maestro-pets-cli-"));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const data = join(home, "data", "maestro");
    mkdirSync(join(data, "terminals"), { recursive: true });
    mkdirSync(join(data, "pets"));
    writeFileSync(join(data, "terminals", "t3.json"), JSON.stringify({ session_id: "old" }));
    const choices = join(data, "pets", "choices.json");
    writeFileSync(choices, JSON.stringify({ sessions: { old: "old-pet", t3: "terminal-pet" } }));
    writeFileSync(join(data, "pets", "index.json"), JSON.stringify([
      { id: "old-pet" }, { id: "terminal-pet" }, { id: "new-pet" },
    ]));
    const cli = (...args) => {
      const result = spawnSync(process.execPath, [
        "--import", `data:text/javascript,${encodeURIComponent(mockCore)}`,
        fileURLToPath(new URL("../bin/maestro", import.meta.url)), "pet", ...args,
      ], {
        encoding: "utf8", env: { ...process.env, HERDR_APP_HOME: home, HC_TERMINAL_ID: "t3", TEST_PROVIDER: provider },
      });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const key = provider === "copilot" ? "old" : "t3";
    const initial = provider === "copilot" ? "old-pet" : "terminal-pet";
    assert.equal(cli("use").session, key);
    assert.equal(cli("use").pet, initial);
    assert.equal(cli("ls").find((pet) => pet.mine).id, initial);
    assert.equal(cli("use", "new-pet").session, key);
    assert.equal(cli("use").pet, "new-pet");
    assert.equal(cli("ls").find((pet) => pet.mine).id, "new-pet");
    const saved = JSON.parse(readFileSync(choices, "utf8")).sessions;
    assert.equal(saved[key], "new-pet");
    assert.equal(saved[provider === "copilot" ? "t3" : "old"], provider === "copilot" ? "terminal-pet" : "old-pet");
    cli("use", "clear");
    assert.equal(JSON.parse(readFileSync(choices, "utf8")).sessions[key], undefined);
  });
}
