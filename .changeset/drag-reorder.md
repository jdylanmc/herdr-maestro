---
"herdr-maestro": minor
---

Drag to reorder in the Maestro sidebar: spaces move with Herdr's own `space.move` (within their machine, so Herdr's order changes too), worktree groups and agent cards move among their siblings and the order is kept in `shared("maestro.treeOrder")` / `shared("maestro.order")`. Pinned agents stay first; a 4 px threshold keeps clicks as clicks; an accent line shows where it lands; works on folded rows too, even from their inline agent icons (a plain click still focuses that agent); Escape or leaving the list cancels.
