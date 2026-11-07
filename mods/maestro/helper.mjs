#!/usr/bin/env node
// Portable filesystem and process queries for the Maestro mod, which can only read whole
// files and run programs. Runs on any machine with Node, which Copilot CLI requires.
//
//   helper.mjs tail <file> <offset> <max>   -> "<size>\n<cut|whole>\n<bytes from offset>"
//   helper.mjs recent <dir> <limit> <sinceMs> -> JSON [{ id, mtime }] newest first
//   helper.mjs locks <dir>                   -> JSON [{ id, pid }] for inuse.<pid>.lock files
//   helper.mjs procs                         -> JSON [[pid, ppid], ...]
//   helper.mjs run <argv...>                 -> runs argv without inherited CMUX_* variables

import { openSync, readSync, closeSync, fstatSync, readdirSync, statSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { join } from "node:path";

const [cmd, ...args] = process.argv.slice(2);

function tail(file, offset, max) {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    let from = Number(offset) || 0;
    if (size < from) from = 0;
    const cut = size - from > Number(max);
    if (cut) from = size - Number(max);
    const buf = Buffer.alloc(size - from);
    let got = 0;
    while (got < buf.length) {
      const n = readSync(fd, buf, got, buf.length - got, from + got);
      if (n <= 0) break;
      got += n;
    }
    process.stdout.write(`${size}\n${cut ? "cut" : "whole"}\n`);
    process.stdout.write(buf.subarray(0, got));
  } finally {
    closeSync(fd);
  }
}

function recent(dir, limit, since) {
  const out = [];
  for (const id of readdirSync(dir)) {
    try {
      const m = statSync(join(dir, id)).mtimeMs;
      if (m >= Number(since)) out.push({ id, mtime: m });
    } catch {}
  }
  out.sort((a, b) => b.mtime - a.mtime);
  process.stdout.write(JSON.stringify(out.slice(0, Number(limit))));
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

if (cmd === "run") runClean(args);
else try {
  if (cmd === "tail") tail(args[0], args[1], args[2]);
  else if (cmd === "recent") recent(args[0], args[1] ?? 60, args[2] ?? 0);
  else if (cmd === "locks") locks(args[0]);
  else if (cmd === "procs") procs();
  else { process.stderr.write(`unknown ${cmd}\n`); process.exit(2); }
} catch (e) {
  process.stderr.write(String(e?.message ?? e) + "\n");
  process.exit(1);
}
