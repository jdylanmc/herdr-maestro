# Herdr-Maestro

Agent orchestration and observability for the [Herdr app](https://herdr.dev), built
natively as Herdr mods on top of `herdr-core` (`hc`). It shows every GitHub Copilot CLI
session in Herdr, its workers and subagents, what each one costs, and what it needs
from you, and gives agents a small CLI to coordinate with each other.

> Status: alpha, used daily on macOS. Linux and Windows paths are written but untested.

## Install

Requires the Herdr app (`curl -fsSL https://releases.herdr.dev/app/install.sh | sh`),
Node (which Copilot CLI already needs) and Copilot CLI.

```sh
git config core.hooksPath .githooks
./scripts/install.sh            # links mods, layout, CLI and skill; sets Copilot's statusLine
./scripts/install.sh --uninstall
```

Restart Copilot sessions after installing so they pick up the status-line bridge.

## Using it

| Key | Action |
|---|---|
| `cmd-shift-m` | Toggle the Maestro layout (Catppuccin with the Maestro column) |
| `cmd-shift-b` | Open the board window (Maestro layout) |
| `cmd-shift-t` | Edit tags of the focused session (Maestro layout) |
| `cmd-shift-k` | Open the pet pokedex (Maestro layout; `cmd-shift-p` is Herdr's palette) |

**Hierarchy** (replaces Herdr's separate spaces and agents lists in the Maestro layout)
- **Space** → **worktree/repo** → **agent card** → its **internal tasks** (Copilot subagents) and
  **workers** (`maestro spawn` / `hc run`), indented like an outline. Folding a space or worktree
  leaves an icon card of its agents.
- Agent cards: icon (Nerd Font glyph and color an agent picks with `maestro icon`, else one from
  its name), name, status and task, tags (yours filled, the agent's own outlined), and an animated
  pet whose mood follows the session (working, delegating, question, needs permission, sad, …).
- Spaces keep Herdr's behavior: click to switch, right-click for the space menu, `+` starts Copilot there.

**Pets** are Codex-format sprite sheets (8 columns of 192×208 cells; 9-row sheets or 20-row mood
atlases) from [Codex pets](https://codexpets.org/gallery) (`~/.codex/pets`), cmux Maestro's own pet,
and pets you add (`data/maestro/pet-sources/`). The first id found wins, in that order.
- **Rendering:** `mods/maestro/pets.mjs` turns each mood row into an animated GIF under
  `data/maestro/pets/<id>/` (Herdr plays GIFs natively). Maestro shows the last `index.json` at once
  and renders in a detached background process (`helper.mjs pets --bg`); unchanged sheets are
  skipped, a sheet that fails is listed with its error instead of stopping the rest, and
  `progress.json` reports how far it got. PNG sheets decode in pure JavaScript; WebP and other
  formats convert with `sips` on macOS and ImageMagick (`magick` on `PATH`) on Linux and Windows.
- **Choosing:** each session keeps its pet in `data/maestro/pets/choices.json`
  (`{ "default": id, "sessions": { "<copilot session id>": id } }`, written atomically), so it
  survives app restarts and `copilot --resume`. Herdr's `shared("maestro.pets")` mirrors it live.
  Agents choose their own with `maestro pet use <id>`; the footer pet cycles pets; **Moods…**
  previews each mood.
- **Pokedex** (`cmd-shift-k`, the `maestro-pets` mod): every pet with its idle animation, source and
  render errors; select one for its description, all 15 moods (9-row sheets reuse rows for moods
  they lack), the sessions using it, **Use for focused session** and **Make default**. **Rescan**
  renders new or changed sheets in the background; **Re-render all** forces every sheet.
- **Adding:** `maestro pet add <folder | pet.json>` copies the manifest and sheet into
  `data/maestro/pet-sources/<id>` (`--link` links the folder instead) and renders it.
  `maestro pet render [--force]` re-renders from the shell.

**Footer** for the focused session: large pet, name, status, terminal and parent, model and
effort, context, elapsed time, AIC and lines changed, branch and folder, tags, session id, and
Beats (scheduled prompts) with cadence, run count and next run.

**Board**: one card per session in Waiting on you, Working, Failed, Finished and Idle.

## Agent CLI

Copilot agents learn these from the bundled `herdr-maestro` skill.

```text
maestro whoami | peers [--all]
maestro send <t> <message>
maestro spawn [--name n] [--cwd d] [--worktree <branch>] [--task text | -- argv...]
maestro close <t>                       # only workers this agent (or its workers) launched
maestro worktree ls | rm <path|branch> [--force]
maestro notify <title> [body]           # Herdr toast that focuses the agent when clicked
maestro tag add|rm|set|ls [tags]
maestro mood <happy|focused|thinking|proud|confused|stuck|sleepy|celebrating|clear>
maestro name <short>
maestro icon <preset|glyph> [#rrggbb]   # robot, code, bug, eye, shield, compass, brush, …
maestro pet ls | use <id|clear> | default <id>
maestro pet add <folder|pet.json> [--link] [--force] | render [--force]
maestro readiness                       # why this session is or is not fully visible
```

Workers are always visible interactive tabs. Worktrees are sibling checkouts
`<repo>-<branch>`; `rm` refuses while the worker runs or the tree is dirty.

## How it works

- `bin/maestro-statusline` is Copilot's `statusLine.command`. Copilot passes it the session
  snapshot (session id, model, context, AIC, durations); it stores it under
  `~/.config/herdr-app/data/maestro/terminals/<HC_TERMINAL_ID>.json`, which binds the
  session to its Herdr terminal exactly.
- Sessions started before the bridge are bound by walking `inuse.<pid>.lock` owners up to
  the terminal's foreground process.
- `mods/maestro/helper.mjs` tails each bound session's `events.jsonl` by byte offset for
  subagents, attention causes, model/effort and schedules.
- Lineage and names are herdr-core labels (`maestro.parent`, `maestro.name`).
- Sessions Maestro launches start through `helper.mjs run`, which drops `CMUX_*` variables a
  cmux-launched herdr-core would otherwise pass on.

## Layout

- `mods/maestro/`, `mods/maestro-tags/`, `mods/maestro-pets/`: Herdr app mods
  (`mods/maestro-pets/petlib.js` is a copy of `mods/maestro/petlib.js`; mods cannot import across folders).
- `layouts/maestro.json`: the Maestro layout.
- `bin/`: `maestro` CLI and the status-line bridge.
- `skills/herdr-maestro/`: Copilot skill for the CLI.
- `docs/GAPS.md`: platform limits found while building, with evidence.

## License

MIT
