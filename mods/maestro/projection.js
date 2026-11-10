// Sidebar projections (the segmented switch), kept in shared("maestro.projection"). Pure, so node:test can load it.
export const PROJECTIONS = [{ id: "worktrees", label: "Worktrees" }, { id: "agents", label: "Agents" }];

// Values stored by earlier versions; both became the Agents view.
const LEGACY = { subagents: "agents", workspace: "agents" };

// The projection to show for a stored value: legacy ids map over, anything unknown shows Worktrees.
export function projectionOf(stored) {
  const id = LEGACY[stored] ?? stored;
  return PROJECTIONS.some((p) => p.id === id) ? id : "worktrees";
}

// Whether a launched worker nests under its launcher: always in Agents, only within one worktree in Worktrees.
export function nestsUnder(proj, sameTree) {
  return proj === "agents" || Boolean(sameTree);
}
