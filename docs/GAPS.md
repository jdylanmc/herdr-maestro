# Architecture gaps

What Herdr-Maestro wanted and could not do with the Herdr app's native mod surface,
`herdr-core` (`hc`), or Copilot CLI. Measured on macOS, Herdr app with herdr-core,
Copilot CLI 1.0.107, 2026-11-06.

## Herdr app gaps

### G-01 - Mods cannot read part of a file

**Wanted:** tail a session's `events.jsonl` from the mod.
**Blocked by:** `fs/promises` exposes only `readFile, readdir, exists, mkdir, writeFile, unlink, rmdir` (no `open`, `stat`, ranged read). `readTextFile` rejects files over 1 MiB; `hc file read` rejects files over 64 MB.
**Evidence:** 593 of 899 logs exceed 1 MiB; 49 exceed 64 MB; the largest is 1,032 MB.
**Shipped:** `mods/maestro/helper.mjs events`, run with `exec("node", …)`, scans from a byte offset and returns only a compact projection of the events Maestro folds (a 107 MB log: 0.25 s, 327 KB). An earlier raw 8 MB tail failed silently on busy sessions: `exec` caps output at 8 MiB, so the first read never completed and subagents never appeared.
**Closes with:** `fs.stat` and a ranged read in the mod runtime, or an `hc file read --bytes`.

### G-02 - No process-tree API

**Wanted:** bind sessions started before the status-line bridge to their terminal.
**Blocked by:** Herdr exposes no process ancestry; the Copilot lock PID is 1–2 hops below `hc get`'s `foreground.pid`.
**Shipped:** helper `procs` (`ps`, or `Get-CimInstance Win32_Process` on Windows) plus lock walk; 6/6 sessions bound on macOS.
**Closes with:** process ancestry in `terminals()` or `hc get`.

### G-03 - `hc ls` omits labels

**Wanted:** read Maestro's lineage labels for every terminal in one call.
**Blocked by:** `hc ls --json` returns address/agent/cwd/state/turn/where only; labels come from `hc get` per terminal.
**Shipped:** the CLI calls `hc get` per live terminal; the mod reads labels from `terminals()`.
**Closes with:** labels in `hc ls --json`.

### G-04 - Edits through a symlinked mod folder do not hot-reload

**Wanted:** develop from the repo with `mods/maestro` symlinked into the Herdr home.
**Evidence:** saves in the repo did not reload the running copy; switching layouts away and back did.
**Shipped:** reload by `layout.switch` during development.
**Closes with:** watching symlink targets for mod folders.

### G-05 - Typed `Status` has no `error`

**Blocked by:** herdr-core documents an `error` status; `herdr.d.ts` `Status` is `working | blocked | done | idle`.
**Shipped:** session-log errors drive Maestro's Failed state.

### G-06 - Blocked reason is undocumented

**Evidence:** `terminals()[i].report.kind` was `permission` during a real permission prompt; neither `herdr.d.ts` nor `AGENTS.md` document it.
**Shipped:** used when present, session log otherwise.

### G-10 - Mods cannot share modules

**Wanted:** the pet pokedex (`mods/maestro-pets`) importing Maestro's pure pet helpers.
**Blocked by:** `herdr-app check mods/maestro-pets` with `import … from "../maestro/petlib.js"`: "resolves outside the application directory"; `mod.json` has no entry-file option, and a new view inside `mods/maestro` would mean branching its `render`.
**Shipped:** `mods/maestro-pets/petlib.js` is an exact copy of `mods/maestro/petlib.js`; `test/pets-lib.test.js` fails when they differ.
**Closes with:** a shared module folder mods may import from, or several views per mod folder.

### G-11 - `exec` stops programs after 30 s

**Wanted:** render every pet sprite sheet from the mod without blocking or truncating.
**Evidence:** `herdr.d.ts`: `exec` has a 30 s limit; the first full render of 28 sheets takes about 6 s here and grows with each pet.
**Shipped:** `helper.mjs pets --bg` returns at once and renders in a detached Node process with a lock; Maestro shows the last `index.json` and follows `progress.json` through `watchFolder`.
**Closes with:** a long-running or streaming `exec` for mods.

### G-12 - `HoverCard` reports no open event

**Wanted:** read a terminal's screen only when its hover preview opens.
**Blocked by:** `gpui-kit.d.ts`: `HoverCard` accepts `on_open_change` but "today never calls it".
**Shipped:** the card's trigger reads on `on_hover` (pointer entry), at most every 3 s per terminal; the 400 ms open delay hides the read.
**Closes with:** `on_open_change` firing for hover cards.

### G-13 - Herdr worktrees cannot be made from a script

**Wanted:** `maestro spawn --worktree <b> --herdr-space` handing the checkout to Herdr's own worktree mod.
**Blocked by:** the mod's create path runs only inside its dialog (`openOverlay({mod: "worktree", props: {branch, tab?, argv?}})`), and mods alone can open overlays; `herdr-app commands` has no worktree command, and `mod.open` takes only `name` (no props).
**Shipped:** the CLI follows the mod's convention itself: `git worktree add [-b <b>] ~/.herdr/worktrees/<repo>/<slug> [HEAD]`, then `herdr-app do space.new {folder, argv, tab}` with no name so Herdr's spaces list nests it under the repo's space. Maestro's sidebar opens the real dialogs (New / Open / Remove worktree). If Herdr moves its root (a constant in `mods/worktree/main.js`), `mods/maestro/wtlib.js` must follow.
**Closes with:** a `worktree.new {space | folder, branch, argv?}` command, or overlay props for `mod.open`.

### G-14 - Mod commands are not in the command palette

**Wanted:** `maestro.board`, `maestro.tags`, `maestro.pets` (and projection switches) listed with titles in Herdr's palette.
**Blocked by:** `herdr.d.ts` `commands()`: "Mods' own `<mod>.<command>`s aren't listed"; `app.palette` shows "every command by name, with its key" from that list. `mod.json` documents only `place`, `size`, `title`, `overlay` and `focusable`; it has no command declarations.
**Shipped:** keys in `keys.json` (`layout:maestro`) and header buttons; README lists them.
**Closes with:** a `commands` map (name → title) in `mod.json` that the palette shows.

### G-15 - No scroll-into-view for a plain scrolling list

**Wanted:** keep the keyboard-highlighted card visible while arrowing through a long Maestro list.
**Blocked by:** `gpui-kit.d.ts` offers `scroll_to_item` only on a `VirtualListScrollHandle` (virtual lists of same-shaped items); the sidebar is a nested `overflow_y_scrollbar` tree of mixed rows.
**Shipped:** highlight without auto-scroll; the mouse wheel still scrolls.
**Closes with:** a scroll handle (or `scroll_into_view`) for ordinary scrolling elements.

### G-16 - Mod pane bodies lack a documented host-pane ID

**Wanted:** close the board or pet pane whose own × was clicked, regardless of prior focus.
**Evidence:** installed `herdr.d.ts` documents `props().pane` for pane-header mods only; `PaneInfo` exposes pane IDs but not the content copy's props. With two copies in one tab, the old focus/uniqueness lookup either selected the other copy or found no target.
**Shipped:** pane × controls let their press propagate to Herdr's native pane focus handler before the click resolves the focused mod pane. Window controls still stop presses to avoid dragging. Regression tests cover a terminal or another copy initially focused, both mods, and sole-pane tab closure.
**Closes with:** a documented host-pane ID for every mod pane body.

### G-17 - Another machine's Maestro state is not visible from here

**Wanted:** the same subagent trees, metrics, tags, moods and notifications for agents in spaces on other machines (`hc machine ls`).
**Blocked by:** `watchFolder`, `fs/promises` (`readdir`) and `writeTextFile` act on this machine only; with `{ on }` a mod can only `exec` and `readTextFile`. The status-line bridge and the `maestro` CLI on that machine write under its own Herdr home, and a mod cannot put Maestro's helper there without writing remote files.
**Shipped:** per machine, `exec("node", ["-e", probe], { on })` finds its home, Herdr home and whether `mods/maestro/helper.mjs` exists there (again after 5 min, 1 min after a failure). With the helper: lock/process binding (`hc get <machine>/tN` foreground pid), `events.jsonl` tails, git (`exec("git", …, { on })`) and status-line snapshots (`readTextFile(…, { on })`, polled every 15 s, not watched). Snapshot/binding/tail passes run independently of local refresh and other machines, with one in-flight pass per machine; slow passes skip timer ticks rather than overlap. Without Node or the helper: Herdr's status and title only, no subagents or metrics. Agent records (`maestro tag/mood/name/icon`) and `maestro notify` from remote agents are not read.
**Evidence:** a temporary loopback machine (`hc machine add --via 'sh -c' --temp --session <scratch>`): `hc exec --on` ran the probe and `helper.mjs procs`/`locks`; `hc get <machine>/t1 --json` returned `foreground.pid`. Not measured: real ssh latency, Windows remotes, the sidebar with a real remote space (temporary machines get no spaces).
**Closes with:** `watchFolder`/`readdir` with `{ on }`, or a mod-shipped helper Herdr installs on each machine.

### G-17 - No CLI route to Herdr's known agents

**Wanted:** `maestro spawn --agent <name>` resolving names against the same agent table as Herdr's menus.
**Blocked by:** `knownAgents()` is mod-only; `herdr-app --help`, `herdr-app commands` and `hc --help` list no agent or program table (`hc templates` is empty), and the built-in 120-program table is not on disk (`programs.json` holds only overrides).
**Shipped:** the Maestro mod and its launch menu cache `knownAgents()` (key, name, run, installed) in `shared("maestro.knownAgents")`; the CLI reads it from `shared.json`, else a fallback table (`copilot`, `claude`, `codex`, `cursor-agent`, `gemini`, `opencode`, `pi`, `amp`) and errors with the known names.
**Closes with:** `herdr-app agents --json` (or `knownAgents` over `herdr-app do`).

### G-13 - Long app-home paths exceed the macOS socket limit

**Wanted:** validate a mod in an isolated Herdr window under a session artifact directory.
**Evidence:** a 105-byte `<app-home>/herdr-app.sock` path made `herdr-app status`, `do` and `shot` fail with "path must be shorter than SUN_LEN".
**Shipped:** rendering validation uses a short temporary app home instead.
**Closes with:** placing the control socket under a short runtime directory independently of `HERDR_APP_HOME`.

## Copilot CLI gaps

### G-07 - Waiting at the folder-trust prompt reports `idle`

**Evidence:** a fresh Copilot at "Do you trust the files in this folder?" reported `idle`, not `blocked`.
**Shipped:** nothing; Maestro cannot tell this from an idle session.

### G-08 - No session id or metrics over OSC 7501

**Shipped:** `statusLine.command` bridge. Its JSON payload is undocumented and lacks reasoning effort (read from root `session.usage_record` and `session.model_change` instead; `model.model_call_success` only logs side models).
**Closes with:** documented session id and usage fields in the status report.

### G-09 - Schedules: no persisted next run or run count

**Evidence:** `session.schedule_created` stores cadence and prompt; only self-paced schedules get `schedule_rearmed.nextRunAt`.
**Shipped:** runs counted from `user.message.source == "schedule-<id>"`; next run estimated from interval; cron shows no next run.
**Closes with:** a persisted next-run event, or an attachable `session.schedule.list`.
