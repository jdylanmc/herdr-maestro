# Herdr-Maestro

Agent orchestration and observability for the [Herdr app](https://herdr.dev), built
natively as Herdr mods on top of `herdr-core` (`hc`). It shows every coding agent in Herdr
(GitHub Copilot CLI in most depth: its workers and subagents, what each one costs), what
each needs from you, and gives agents a small CLI to coordinate with each other.

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
| `cmd-shift-m` | Toggle the Maestro layout (Herdr's own look plus the Maestro column; no third-party layout or mods) and back to Herdr's `main` (`MAESTRO_RETURN_LAYOUT` overrides) |
| `cmd-shift-b` | Show the board in the main area; again returns to the terminals (Maestro layout) |
| `cmd-shift-t` | Edit tags of the focused session (Maestro layout) |
| `cmd-shift-k` | Open the pet pokedex (Maestro layout; `cmd-shift-p` is Herdr's palette) |
| `cmd-alt-left` (Herdr's `pane.go:left`) | Move the keyboard into the Maestro list (from the footer too) |
| `↑` / `↓` | Move the highlight between spaces, worktrees and agent cards (list has the keyboard) |
| `Enter` | Focus the highlighted agent; on a space, switch to it; on a worktree, fold it |
| `Space` / `→` / `←` | Toggle / unfold / fold the highlighted space, worktree or agent's internal tasks |
| `Esc` | Give the keyboard back to the terminal (`pane.go` right); closes the board or pokedex in the main area |

**Board and pokedex as a tab or split:** their headers have **Open as tab** (`tab.new` with the mod) and
**Split beside** (`pane.split` right of the focused pane). The `cmd-shift-b` / `cmd-shift-k` main-area toggle
is unchanged; × in a tab or split closes that pane (its tab when alone). Maestro's own commands
(`maestro.board`, `maestro.tags`, `maestro.pets`) are keys only: Herdr's palette lists app commands
(see `docs/GAPS.md`).

**Theme picker:** the palette icon in the Maestro header lists every Herdr theme (`themes()`) with swatches,
dark then light. Picking one runs `app.theme`, which sets the shown layout's theme for that appearance
(Herdr keeps it with the layout's clicks, not in the layout file).

**Hierarchy** (replaces Herdr's separate spaces and agents lists in the Maestro layout)
- **Space** → **worktree/repo** → **agent card** → its **running subagents** (Copilot subagents; the
  header's show-finished toggle also lists idle and finished ones) and
  **workers** (`maestro spawn` / `hc run`), indented like an outline. As in Herdr's spaces list,
  a worktree space sits under its repo's space with a branch icon; a space's branch button offers
  New / Open / Remove worktree (Herdr's dialogs; Remove only when clean with no agent in it). Folding a space or worktree
  shows its agents' status and icon inline on its row (click one to focus it) instead of their cards.
- Agent cards: icon (Nerd Font glyph and color an agent picks with `maestro icon`, else one from
  its name), name, status and task, tags (yours filled, the agent's own outlined), and an animated
  pet whose mood follows the session (working, delegating, question, needs permission, sad, …).
  Hovering a card shows actions, each only on click: **interrupt** (working), **peek** and **keep as
  tab** (pane-less workers), **park** (Maestro workers with a pane; they keep running pane-less).
- **Tags** are short slugs (lowercase `a-z0-9-`, ≤ 24 chars, ≤ 8 per session). `cmd-shift-t` opens
  the tag editor: type to add (Enter, comma or space), × or Backspace removes, click a known tag to
  add it, click one of yours to pick its color. A color belongs to the slug everywhere and only the
  human picks it: `shared("maestro.tagColors")` maps slug → Herdr theme color name (`ansi1`…`ansi6`,
  `accent`, `working`, `blocked`, `done`), so it follows the theme; unset slugs hash to an ANSI hue.
- Spaces keep Herdr's behavior: click to switch, right-click for the space menu, `+` starts Copilot there;
  the folder button picks a folder first and starts Copilot in it.
  A worktree's `+` starts Copilot in that worktree. The chevron beside either `+` lists every agent
  Herdr knows (`knownAgents()`: Claude Code, Codex, …, installed ones first) and starts the one you pick there.
- **Any agent:** every terminal Herdr counts as an agent gets a card, status, task, tags, pet (mood from
  its status), focus and a hover preview; without a Maestro icon it shows its program's icon. Model,
  context, AIC, subagents and Beats come from Copilot's status line and session log, so only Copilot shows them.
- **Pins**: hover a card for its pin (Herdr's `terminal.pin`, shared with Herdr's own agent list and
  every client); pinned agents sort first in their group and show a small pin.
- **Alerts** (header, both off by default, kept in `shared("maestro.sounds")` / `shared("maestro.autoSettle")`):
  the bell chimes once when an agent starts needing you and Herdr's own sound doesn't already
  (Herdr chimes for agents in panes that report blocked; right-click the bell for Herdr's Settings > Alerts).
  The archive button settles the tab of a Maestro-launched worker once it finishes after working
  (`tab.next`/`tab.prev` skip it) and brings it back when it works again; Herdr itself brings a settled tab
  back when its agent needs you.
- **Other machines** (`hc machine ls`): once one is known, spaces group under machine headers like
  Herdr's Spaces sidebar (This computer first, then by name; connection dot, `+` new space there,
  fold remembered). Nothing changes while only this computer exists.

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
  Agents choose their own with `maestro pet use <id>`; clicking the footer pet opens the pokedex; **Moods…**
  previews each mood.
- **Pokedex** (`cmd-shift-k`, the `maestro-pets` mod): every pet with its idle animation, source and
  render errors; select one for its description, all 15 moods (9-row sheets reuse rows for moods
  they lack), the sessions using it, **Use for focused session** and **Make default**. **Rescan**
  renders new or changed sheets in the background; **Re-render all** forces every sheet.
- **Adding:** `maestro pet add <folder | pet.json>` copies the manifest and sheet into
  `data/maestro/pet-sources/<id>` (`--link` links the folder instead) and renders it.
  `maestro pet render [--force]` re-renders from the shell.

**Live screen text**: hovering a card shows the last 8 lines of its terminal (`hc read`, read on
hover, cached 3 s); a card waiting on you shows the latest question or line under its cause, read when
it becomes blocked and at most every 30 s after. Control sequences are stripped and lines truncated.
Screen text stays in memory and in the local UI only; Maestro never writes it to disk.

**Footer** for the focused session: large pet, name, status, terminal and parent, model and
effort, context, elapsed time, AIC and lines changed, branch and folder, tags, session id, and
Beats (scheduled prompts) with cadence, run count and next run.

**Board**: one card per session in Waiting on you, Working, Failed, Finished and Idle.

**Theming**: every color comes from the active Herdr theme (`theme()`): surfaces, status, tags and
agent icons (theme color names such as `ansi4`, never fixed hex unless an agent asks for one), so
any Herdr or layout theme, light or dark, applies. Space avatars use Herdr's own space colors.

## Agent CLI

Copilot agents learn these from the bundled `herdr-maestro` skill.

```text
maestro whoami | peers [--all]
maestro send <t> <message>
maestro spawn [--name n] [--cwd d] [--worktree <branch> [--herdr-space|--sibling]] [--bg] [--agent a] [--task text | -- argv...]
                                        # --agent claude|codex|…: any agent Herdr knows; default Copilot
maestro close <t>                       # only workers this agent (or its workers) launched
maestro wait [<t>...] [--any|--all]     # this agent's workers by default; replaces sleeping/polling
maestro interrupt <t>                   # stop a worker's turn (own workers only)
maestro peek <t> | keep <t> [--place tab|right|down] | park <t>   # keep/park: own workers only
maestro put <t> <file>                  # send a file beside a terminal
maestro worktree ls | rm <path|branch> [--force]
maestro notify <title> [body]           # Herdr toast that focuses the agent when clicked
maestro tag add|rm|set|ls [tags]        # ls shows each tag's human-picked color
maestro mood <happy|focused|thinking|proud|confused|stuck|sleepy|celebrating|clear>
maestro name <short>
maestro pin [on|off]                    # pin this agent to the top of Herdr's and Maestro's lists
maestro icon <preset|glyph> [color]     # robot, code, bug, eye, shield, compass, brush, …
maestro pet ls | use <id|clear> | default <id>
maestro pet add <folder|pet.json> [--link] [--force] | render [--force]
maestro readiness                       # why this session is or is not fully visible
```

Workers are interactive tabs, or pane-less sub-agents with `--bg`. Worktrees are sibling checkouts
`<repo>-<branch>` by default; `--herdr-space` (or `MAESTRO_WORKTREE=herdr`, or
`shared("maestro.worktreeKind") = "herdr"`) makes one the way Herdr's worktree mod does,
`~/.herdr/worktrees/<repo>/<branch>` in its own space nested under the repo's, unless `--bg`
keeps the worker pane-less in its parent's space. `worktree ls` shows
each one's kind; `rm` refuses while its worker or any live terminal is in it, or the tree is dirty.
Background `--task` routing supports Copilot; other agents need explicit provider argv
(`-- argv...`) or a visible launch so Herdr can deliver the task.

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
- Agents on another machine: Maestro probes it with Node (`exec(..., { on })`); where Maestro is
  installed there too, binding, log tails, git and status-line snapshots run on that machine.
  Otherwise those agents show Herdr's status and title only (see `docs/GAPS.md` G-17).
- Sessions Maestro launches start through `helper.mjs run`, which drops `CMUX_*` variables a
  cmux-launched herdr-core would otherwise pass on.

## Layout

- `mods/maestro/`, `mods/maestro-tags/`, `mods/maestro-pets/`, `mods/maestro-launch/` (agent menu), `mods/maestro-menu/`
  (terminal right-click menu: Copy, Paste, then Herdr's items): Herdr app mods
  (`mods/maestro-pets/petlib.js` is a copy of `mods/maestro/petlib.js`; mods cannot import across folders).
- `layouts/maestro.json`: the Maestro layout.
- `bin/`: `maestro` CLI and the status-line bridge.
- `skills/herdr-maestro/`: Copilot skill for the CLI.
- `docs/GAPS.md`: platform limits found while building, with evidence.
- `test/`: `node:test` unit tests; `scripts/check.mjs`: syntax and JSON checks.

## Contributing

Requires Node 22.13+ (22.x), 24.x, or 26+.

```sh
npm ci
npm test          # unit tests (node --test)
npm run check     # every script parses as an ES module; every JSON file loads
npx changeset     # describe the change: patch, minor, or major
```

- Every pull request that changes behavior includes a changeset (`.changeset/*.md`).
  Docs-only and CI-only pull requests use `npx changeset --empty`.
- CI runs the changeset check, `npm run check`, `npm test`, shellcheck, and
  `scripts/check-public.sh` on every pull request.
- `npm run version` turns pending changesets into `CHANGELOG.md` and a version bump.

## License

MIT
