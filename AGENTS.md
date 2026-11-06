# Herdr-Maestro repository instructions

Herdr-Maestro makes coding-agent work visible and steerable inside the
[Herdr app](https://herdr.dev). It is built natively on Herdr: app mods and
layouts for presentation, `herdr-core` (`hc`) for terminals and agents.
Requirements start from a clean slate; nothing is inherited from earlier
Maestro implementations unless re-decided here.

- Never add secrets, credentials, tokens, session data, personal identifiers, employer configuration, internal endpoints, or machine-specific runtime state.
- Keep coding-agent integrations optional and provider-neutral.
- Run `./scripts/check-public.sh` before every commit and push. `git config core.hooksPath .githooks` enables it automatically.
- Do not append GitHub `Co-authored-by` trailers to commits.
- Target macOS, Linux, and Windows. Use Herdr's file and process APIs (`readTextFile`, `fs/promises`, `watchFolder`, `home()`, `hc`) instead of shell commands; when a program must run, handle Windows explicitly.

## Building on Herdr

Read `~/.config/herdr-app/AGENTS.md`, `herdr.d.ts`, and `gpui-kit.d.ts` before
changing a mod. The Herdr app rewrites them on every start for the installed
version; they are the authoritative API reference, not memory.

- `mods/<name>/` mirrors the Herdr home layout. Each mod folder is symlinked
  into `~/.config/herdr-app/mods/<name>` for live development; saves hot-reload.
- Run `herdr-app check mods/<name>` after every change. Never call a mod done
  without a passing check, and verify the rendered result with `herdr-app shot`.
- Animate natively (`.frames`, `.spin`, `.loop`, `.transition`), never with timers.
- Prefer live Herdr data (`agents()`, `terminals()`, `spaces()`) over polling.

## Architecture gaps

When Herdr, `hc`, or an agent runtime blocks something we actually wanted,
record it in `docs/GAPS.md` at the moment of impact, with measured evidence,
the workaround shipped, and what would close it.

## Agent skills

### Private instructions

Read and follow the machine-local instructions at `.user/instructions.md` when
present. That path is git-ignored and never committed.

### Issue tracker

Issues, specifications, and Discovery maps are tracked in GitHub Issues for
`jdylanmc/herdr-maestro`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five canonical triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses a single domain context: root `CONTEXT.md` and root
`docs/adr/`, both created lazily. See `docs/agents/domain.md`.
