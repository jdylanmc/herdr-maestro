---
"herdr-maestro": patch
---

The Maestro layout no longer depends on the third-party Catppuccin layout: no pinned theme (it follows Herdr's theme setting and theme picker), Herdr's shipped `tabs` mod instead of `tabs-graph`, no `git-graph` panel, and `cmd-shift-m` toggles back to Herdr's `main`. `install.sh` and `npm run check` now fail if the layout names a mod that is neither shipped with Herdr nor in `mods/`.
