#!/usr/bin/env bash
# Links Herdr-Maestro into the Herdr app and Copilot CLI on this machine. Idempotent.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
HERDR="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
COPILOT="${COPILOT_HOME:-$HOME/.copilot}"
KEY="${MAESTRO_KEY:-cmd-shift-m}"
RETURN_LAYOUT="${MAESTRO_RETURN_LAYOUT:-catppuccin}"

if [[ "${1:-}" == "--uninstall" ]]; then
  for p in "$HERDR/mods/maestro" "$HERDR/mods/maestro-tags" "$HERDR/mods/maestro-pets" "$HERDR/mods/maestro-launch" "$HERDR/mods/maestro-menu" "$HERDR/layouts/maestro.json" "$HOME/.local/bin/maestro" "$COPILOT/skills/herdr-maestro"; do
    if [[ -L "$p" && "$(readlink "$p")" == "$ROOT"* ]]; then rm "$p"; echo "removed $p"; fi
  done
  python3 "$ROOT/scripts/lib/uninstall.py" "$COPILOT/settings.json" "$HERDR/keys.json"
  echo "Maestro uninstalled. Runtime data stays in $HERDR/data/maestro."
  exit 0
fi

link() {
  if [[ -L "$2" && "$(readlink "$2")" == "$1" ]]; then return; fi
  if [[ -e "$2" || -L "$2" ]]; then mv "$2" "$2.backup.$(date +%Y%m%d%H%M%S)"; fi
  ln -s "$1" "$2"
}

link "$ROOT/mods/maestro" "$HERDR/mods/maestro"
link "$ROOT/mods/maestro-tags" "$HERDR/mods/maestro-tags"
link "$ROOT/mods/maestro-pets" "$HERDR/mods/maestro-pets"
link "$ROOT/mods/maestro-launch" "$HERDR/mods/maestro-launch"
link "$ROOT/mods/maestro-menu" "$HERDR/mods/maestro-menu"
mkdir -p "$HOME/.local/bin" "$COPILOT/skills"
link "$ROOT/bin/maestro" "$HOME/.local/bin/maestro"
link "$ROOT/skills/herdr-maestro" "$COPILOT/skills/herdr-maestro"
link "$ROOT/layouts/maestro.json" "$HERDR/layouts/maestro.json"

python3 - "$COPILOT/settings.json" "$ROOT/bin/maestro-statusline" "$HERDR/keys.json" "$KEY" "$RETURN_LAYOUT" <<'PY'
import json, os, shutil, sys, time
settings, script, keys, key, back = sys.argv[1:]

def edit(path, change):
    with open(path) as f:
        data = json.load(f)
    before = json.dumps(data, sort_keys=True)
    change(data)
    if json.dumps(data, sort_keys=True) == before:
        return False
    shutil.copy2(os.path.realpath(path), os.path.realpath(path) + ".backup." + time.strftime("%Y%m%d%H%M%S"))
    with open(os.path.realpath(path), "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    return True

def status_line(d):
    want = f'node "{script}"'
    current = d.get("statusLine", {}).get("command")
    if current and current != want and "maestro-statusline" not in current:
        print(f"statusLine already set to {current}; leaving it", file=sys.stderr)
        return
    d["statusLine"] = {"type": "command", "command": want}

def bindings(d):
    d.setdefault("global", {})[key] = f"layout.switch:maestro"
    d.setdefault("layout:maestro", {})[key] = f"layout.switch:{back}"
    d["layout:maestro"].setdefault("cmd-shift-b", "maestro.board")
    d["layout:maestro"].setdefault("cmd-shift-t", "maestro.tags")
    d["layout:maestro"].setdefault("cmd-shift-k", "maestro.pets")

print("copilot statusLine:", "updated" if edit(settings, status_line) else "unchanged")
print("herdr keys:", "updated" if edit(keys, bindings) else "unchanged")
PY

herdr-app check "$ROOT/mods/maestro"
herdr-app check "$ROOT/mods/maestro-tags"
herdr-app check "$ROOT/mods/maestro-pets"
herdr-app check "$ROOT/mods/maestro-menu"
echo "Maestro installed. $KEY toggles the maestro layout. Restart Copilot sessions to enable the status-line bridge."
