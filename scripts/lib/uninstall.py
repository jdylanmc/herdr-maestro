"""Removes Maestro's statusLine and key bindings; leaves everything else as it was."""
import json
import os
import sys


def edit(path, change):
    real = os.path.realpath(path)
    try:
        with open(real) as f:
            data = json.load(f)
    except FileNotFoundError:
        return
    if change(data):
        with open(real, "w") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
        print("updated", path)


def status_line(d):
    if "maestro-statusline" in d.get("statusLine", {}).get("command", ""):
        del d["statusLine"]
        return True
    return False


def keys(d):
    changed = False
    for section in list(d):
        if section == "layout:maestro":
            del d[section]
            changed = True
            continue
        for key, action in list(d[section].items()):
            if isinstance(action, str) and (action.startswith("maestro.") or action == "layout.switch:maestro"):
                del d[section][key]
                changed = True
    return changed


edit(sys.argv[1], status_line)
edit(sys.argv[2], keys)
