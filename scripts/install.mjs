#!/usr/bin/env node
// Native installer: Windows junctions need neither Developer Mode nor elevation.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, symlinkSync, writeFileSync, lstatSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { missingMods } from "./lib/layout-mods.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const mods = ["maestro", "maestro-tags", "maestro-pets", "maestro-launch", "maestro-menu", "maestro-color"];
const windows = process.platform === "win32";
const quote = (path) => `"${path}"`;
const backup = (path) => renameSync(path, `${path}.backup.${Date.now()}`);

function readJson(path) {
  if (!existsSync(path)) return {};
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`Expected an object in ${path}`);
  return data;
}

function write(path, text) {
  if (existsSync(path) && readFileSync(path, "utf8") === text) return;
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    // Keep an existing settings symlink (for example a dotfiles checkout).
    path = realpathSync(path);
    backupCopy(path);
  }
  writeFileSync(path, text);
}

function backupCopy(path) {
  writeFileSync(`${path}.backup.${Date.now()}`, readFileSync(path));
}

function link(source, target) {
  try {
    if (realpathSync(target) === realpathSync(source)) return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  mkdirSync(dirname(target), { recursive: true });
  try {
    lstatSync(target);
    backup(target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  symlinkSync(source, target, windows ? "junction" : "dir");
}

export function install({
  app = process.env.HERDR_APP_HOME ?? join(homedir(), ".config", "herdr-app"),
  copilot = process.env.COPILOT_HOME ?? join(homedir(), ".copilot"),
  bin = join(homedir(), ".local", "bin"),
  key = process.env.MAESTRO_KEY ?? `${windows ? "ctrl" : "cmd"}-shift-m`,
  returnLayout = process.env.MAESTRO_RETURN_LAYOUT ?? "main",
  check = true,
} = {}) {
  const settingsPath = join(copilot, "settings.json");
  const keysPath = join(app, "keys.json");
  const settings = readJson(settingsPath);
  const keys = readJson(keysPath);
  const layoutText = readFileSync(join(root, "layouts", "maestro.json"), "utf8");
  const missing = missingMods(JSON.parse(layoutText), root);
  if (missing.length) throw new Error(`Layout needs missing mods: ${missing.join(", ")}`);
  if (check) for (const mod of mods) {
    execFileSync("herdr-app", ["check", join(root, "mods", mod)], { stdio: "inherit" });
  }

  const current = settings.statusLine?.command;
  if (current && !current.includes("maestro-statusline")) {
    console.warn(`statusLine already set to ${current}; leaving it`);
  } else {
    settings.statusLine = { type: "command", command: `${quote(process.execPath)} ${quote(join(root, "bin", "maestro-statusline"))}` };
  }
  keys.global ??= {};
  keys["layout:maestro"] ??= {};
  if (keys.global[key] && keys.global[key] !== "layout.switch:maestro") {
    throw new Error(`${key} is already bound to ${keys.global[key]}; choose MAESTRO_KEY`);
  }
  keys.global[key] = "layout.switch:maestro";
  keys["layout:maestro"][key] = `layout.switch:${returnLayout}`;
  for (const [letter, action] of [["b", "board"], ["t", "tags"], ["k", "pets"]]) {
    keys["layout:maestro"][`${windows ? "ctrl" : "cmd"}-shift-${letter}`] ??= `maestro.${action}`;
  }

  for (const mod of mods) link(join(root, "mods", mod), join(app, "mods", mod));
  link(join(root, "skills", "herdr-maestro"), join(copilot, "skills", "herdr-maestro"));
  // File symlinks need elevation on Windows; directory junctions above do not.
  if (windows) {
    write(join(app, "layouts", "maestro.json"), layoutText);
    write(join(bin, "maestro.cmd"), `@echo off\r\n${quote(process.execPath)} ${quote(join(root, "bin", "maestro"))} %*\r\n`);
  } else {
    for (const [source, target] of [
      [join(root, "layouts", "maestro.json"), join(app, "layouts", "maestro.json")],
      [join(root, "bin", "maestro"), join(bin, "maestro")],
    ]) {
      mkdirSync(dirname(target), { recursive: true });
      if (existsSync(target) && realpathSync(target) === realpathSync(source)) continue;
      if (existsSync(target)) backup(target);
      symlinkSync(source, target);
    }
  }
  write(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  write(keysPath, JSON.stringify(keys, null, 2) + "\n");
  return { app, bin, key };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 2) throw new Error("Usage: node scripts/install.mjs");
    const { app, bin, key } = install();
    if (windows) {
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `
        $ErrorActionPreference = 'Stop'
        $path = [Environment]::GetEnvironmentVariable('Path', 'User')
        $parts = @($path -split ';' | Where-Object { $_ })
        if ($parts -notcontains $env:MAESTRO_BIN) {
          [Environment]::SetEnvironmentVariable('Path', (($parts + $env:MAESTRO_BIN) -join ';'), 'User')
        }
      `], { env: { ...process.env, MAESTRO_BIN: bin }, stdio: "inherit" });
    }
    console.log(`Maestro installed in ${app}. ${key} toggles the layout.`);
    console.log(`CLI: ${bin}. Restart Herdr and Copilot sessions to pick up PATH and the status-line bridge.`);
  } catch (error) {
    console.error(`install: ${error.message}`);
    process.exitCode = 1;
  }
}
