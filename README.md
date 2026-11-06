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

**Session list**
- Groups by Space, Repo or Org; `+ copilot` starts a session in that group's folder.
- Each session: status, animated pet (mood), name, branch, model and effort, context %,
  AIC, turn and session time, operator tags and agent tags, Beats count.
- Workers launched with `maestro spawn` or `hc run` nest under their parent; Copilot
  subagents nest under their session, with ✓ / ✗ / ⊘ and duration.
- Attention cues (`permission`, `question`, `error`, `N failed`) come from herdr-core's
  blocked reason and the session log; click a cue to acknowledge it (it answers nothing).
- Up/down arrows reorder sessions in Maestro only; Herdr's own order is untouched.
- **Show finished** keeps finished subagents for 24 h instead of 10 min.
- **Recent**: sessions from the last 24 h that are not running, with resume and dismiss.

**Footer** for the focused session: tags (`Edit tags…`), mood preview, terminal and
parent, session id, folder, branch, AIC / premium requests / lines changed, context,
and Beats (scheduled prompts) with cadence, run count and next run.

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

## Layout

- `mods/maestro/`, `mods/maestro-tags/`: Herdr app mods.
- `layouts/maestro.json`: the Maestro layout.
- `bin/`: `maestro` CLI and the status-line bridge.
- `skills/herdr-maestro/`: Copilot skill for the CLI.
- `docs/GAPS.md`: platform limits found while building, with evidence.

## License

MIT
