import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as agentlib from "../mods/maestro/agentlib.js";
import * as wt from "../mods/maestro/wtlib.js";

const source = readFileSync(new URL("../bin/maestro", import.meta.url), "utf8");
const method = source.slice(source.indexOf("  spawn("), source.indexOf("  close("));

for (const kind of ["sibling", "herdr"]) for (const provider of ["copilot", "claude", "codex"]) {
  test(`spawn --agent ${provider} preserves ${kind} worktree launch and task routing`, () => {
    const calls = [];
    let record, saved, result;
    const cli = runInNewContext(`({${method}})`, {
      agentlib, wt, process: { cwd: () => "/repo", env: {} },
      readFileSync: () => "{}", join: (...parts) => parts.join("/"), HOME: "/app",
      HELPER: "/helper.mjs", DEFAULT_ARGV: agentlib.DEFAULT_ARGV,
      sharedConfig: () => ({}), needMe: () => "t1",
      makeWorktree: (from, branch, owner, selectedKind) => {
        calls.push({ from, branch, owner, kind: selectedKind });
        return "/checkout";
      },
      world: () => [{ address: "t1", space: "parent-space" }],
      run: (command, args) => {
        if (command === "herdr-app") {
          calls.push({ verb: args[1], request: JSON.parse(args[2]) });
          return JSON.stringify({ terminal: "t3", space: "new-space", tab: "new-tab" });
        }
        assert.equal(command, "hc");
        return "";
      },
      saveRecord: (_address, value) => { record = value; },
      worktrees: () => ({ "/checkout": { kind } }),
      writeJson: (_path, value) => { saved = value; }, WORKTREES: "/registry",
      out: (value) => { result = value; }, fail: (message) => { throw new Error(message); },
    });
    cli.spawn(["--worktree", "review", kind === "herdr" ? "--herdr-space" : "--sibling",
      "--agent", provider, "--name", "reviewer", "--task", "review changes"]);
    assert.deepEqual(calls[0], { from: "/repo", branch: "review", owner: "t1", kind });
    const { verb, request } = calls[1];
    assert.equal(verb, kind === "herdr" ? "space.new" : "tab.new");
    assert.equal(request.folder, "/checkout");
    assert.equal(request[kind === "herdr" ? "tab" : "name"], "reviewer");
    assert.equal(request.space, kind === "herdr" ? undefined : "parent-space");
    assert.deepEqual(request.argv, ["node", "/helper.mjs", "run",
      ...(provider === "copilot" ? ["copilot", "--yolo", "-i", "review changes"] : [provider])]);
    assert.equal(request.task, provider === "copilot" ? undefined : "review changes");
    assert.equal(record.agent, provider);
    assert.equal(saved["/checkout"].kind, kind);
    assert.equal(saved["/checkout"].terminal, "t3");
    assert.equal(saved["/checkout"].space, kind === "herdr" ? "new-space" : undefined);
    assert.equal(result.kind, kind);
    assert.equal(result.agent, provider);
  });
}
