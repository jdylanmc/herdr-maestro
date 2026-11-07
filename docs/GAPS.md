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
