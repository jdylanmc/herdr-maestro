#!/usr/bin/env node
// Portable filesystem and process queries for the Maestro mod, which can only read whole
// files and run programs. Runs on any machine with Node, which Copilot CLI requires.
//
//   helper.mjs events <file> <offset>      -> "<next offset>\n" + compact JSON lines Maestro reads
//   helper.mjs locks <dir>                   -> JSON [{ id, pid }] for inuse.<pid>.lock files
//   helper.mjs procs                         -> JSON [[pid, ppid], ...]
//   helper.mjs run <argv...>                 -> runs argv without inherited CMUX_* variables
//   helper.mjs pets [--force] [--bg] <out> <pet roots...>
//                                            -> renders pet sprite sheets to per-mood GIFs (pets.mjs);
//                                               --bg returns at once and renders in a detached process

import { openSync, readSync, closeSync, fstatSync, readdirSync, statSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [cmd, ...args] = process.argv.slice(2);

// Maestro's view of a session log: only the event types it folds, without prompts, tool
// arguments or results, so a log of any size answers within exec's 8 MiB output limit.
const EVENT = /"type":"(subagent\.(started|configured|completed|failed)|permission\.(requested|completed)|tool\.execution_(start|complete)|session\.(start|resume|shutdown|model_change|error|schedule_created|schedule_cancelled|schedule_rearmed|usage_record)|model\.model_call_success|user\.message|assistant\.turn_(start|end)|abort)"/;
const field = (line, k) => line.match(new RegExp(`"${k}":"([^"]*)"`))?.[1];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));
export function project(line) {
  const type = line.match(EVENT)?.[1];
  if (!type) return null;
  const agentId = /"agentId":"/.test(line) ? field(line, "agentId") ?? true : undefined;
  if (type === "session.usage_record" || type === "model.model_call_success") {
    // Huge lines: read three fields without parsing.
    return JSON.stringify({ type, ...(agentId ? { agentId } : {}), model: field(line, "model"), modelDisplayName: field(line, "modelDisplayName"), reasoningEffort: field(line, "reasoningEffort") });
  }
  let e;
  try { e = JSON.parse(line); } catch { return null; }
  const d = e.data ?? {};
  const data = type.startsWith("tool.execution") ? pick(d, ["toolName", "toolCallId", "model"])
    : type === "user.message" ? pick(d, ["source"])
    : type.startsWith("assistant.turn") ? pick(d, ["parentToolCallId"])
    : type === "subagent.started" ? pick(d, ["agentDisplayName", "agentName", "agentDescription", "executionMode", "parentId", "model"])
    : type === "subagent.configured" ? pick(d, ["model", "reasoningEffort", "multiTurn"])
    : type === "session.schedule_created" ? pick(d, ["id", "displayPrompt", "intervalMs", "cron", "at", "recurring", "selfPaced"])
    : type === "session.start" ? pick(d, ["startTime"])
    : type === "session.model_change" ? pick(d, ["newModel", "reasoningEffort"])
    : type === "session.error" ? pick(d, ["errorType"])
    : type.startsWith("subagent.") ? pick(d, ["cancelled", "totalToolCalls", "totalTokens", "durationMs"])
    : pick(d, ["id", "requestId", "nextRunAt"]);
  return JSON.stringify({ type, timestamp: e.timestamp, ...(e.agentId ? { agentId: e.agentId } : {}), data });
}

function events(file, offset) {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    let pos = Number(offset) || 0;
    if (pos > size) pos = 0;
    const out = [];
    let bytes = 0, carry = "";
    const buf = Buffer.alloc(4 << 20);
    while (pos < size) {
      const n = readSync(fd, buf, 0, Math.min(buf.length, size - pos), pos);
      if (n <= 0) break;
      const text = carry + buf.toString("utf8", 0, n);
      const end = text.lastIndexOf("\n");
      const whole = end >= 0 ? text.slice(0, end) : "";
      carry = end >= 0 ? text.slice(end + 1) : text;
      pos += n;
      for (const line of whole.split("\n")) {
        const p = line && project(line);
        if (!p) continue;
        out.push(p);
        bytes += p.length + 1;
        while (bytes > 6_000_000) bytes -= out.shift().length + 1;
      }
    }
    // Stop before a partial last line; it is read whole next time.
    process.stdout.write(`${pos - Buffer.byteLength(carry)}\n${out.join("\n")}`);
  } finally {
    closeSync(fd);
  }
}

function locks(dir) {
  const out = [];
  for (const id of readdirSync(dir)) {
    let names;
    try { names = readdirSync(join(dir, id)); } catch { continue; }
    for (const n of names) {
      const m = /^inuse\.(\d+)\.lock$/.exec(n);
      if (m) out.push({ id, pid: Number(m[1]) });
    }
  }
  process.stdout.write(JSON.stringify(out));
}

function procs() {
  const pairs = [];
  if (process.platform === "win32") {
    const text = execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId)\" }"], { encoding: "utf8" });
    for (const l of text.split(/\r?\n/)) { const [a, b] = l.trim().split(/\s+/).map(Number); if (a) pairs.push([a, b]); }
  } else {
    const text = execFileSync("ps", ["-axo", "pid=,ppid="], { encoding: "utf8" });
    for (const l of text.split("\n")) { const [a, b] = l.trim().split(/\s+/).map(Number); if (a) pairs.push([a, b]); }
  }
  process.stdout.write(JSON.stringify(pairs));
}

// A herdr-core started from a cmux tab hands cmux's environment to every terminal, which
// makes cmux integrations act as if they were inside cmux.
function runClean(argv) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CMUX_")));
  const child = spawn(argv[0], argv.slice(1), { stdio: "inherit", env, shell: process.platform === "win32" });
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => child.kill(sig));
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
  child.on("error", (e) => { process.stderr.write(`${argv[0]}: ${e.message}\n`); process.exit(127); });
}

// Herdr's exec allows 30 s, so the mod asks for --bg: a detached copy renders while Maestro
// shows the last index.json and follows progress.json.
async function pets(args) {
  const force = args.includes("--force"), bg = args.includes("--bg");
  const [out, ...roots] = args.filter((a) => a !== "--force" && a !== "--bg");
  if (!out) throw new Error("usage: helper.mjs pets [--force] [--bg] <out> <roots...>");
  if (bg) {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "pets", ...(force ? ["--force"] : []), out, ...roots], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    process.stdout.write(JSON.stringify({ started: child.pid ?? null }));
    return;
  }
  const { renderAll } = await import("./pets.mjs");
  process.stdout.write(JSON.stringify(renderAll(out, roots, { force })));
}

const main = process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop());
if (!main) {} else if (cmd === "run") runClean(args);
else try {
  if (cmd === "events") events(args[0], args[1]);
  else if (cmd === "locks") locks(args[0]);
  else if (cmd === "procs") procs();
  else if (cmd === "pets") await pets(args);
  else { process.stderr.write(`unknown ${cmd}\n`); process.exit(2); }
} catch (e) {
  process.stderr.write(String(e?.message ?? e) + "\n");
  process.exit(1);
}
