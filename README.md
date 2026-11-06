# Herdr-Maestro

Agent orchestration and observability for the [Herdr app](https://herdr.dev),
built natively as Herdr mods on top of `herdr-core`.

> Status: requirements in progress. Nothing here is usable yet.

## Develop

Requires the Herdr app (`curl -fsSL https://releases.herdr.dev/app/install.sh | sh`).

```sh
git config core.hooksPath .githooks
ln -s "$PWD/mods/maestro" ~/.config/herdr-app/mods/maestro
herdr-app check mods/maestro
```

Saves hot-reload in the running app. `herdr-app shot` captures the window.

## Layout

- `mods/<name>/`: Herdr app mods, mirroring `~/.config/herdr-app/mods/`.
- `docs/GAPS.md`: what the platform could not do, with evidence.
- `docs/agents/`: tracker, triage, and domain conventions for coding agents.

## License

MIT
