export function liveAgents(agents, terminals, records) {
  const byCore = new Map(terminals.map((k) => [k.address, k]));
  const lineage = (address) => {
    const k = byCore.get(address);
    const r = records.get(address);
    return { parent: r?.parent ?? k?.labels?.["maestro.parent"] ?? k?.parent ?? null, name: r?.name ?? k?.labels?.["maestro.name"] };
  };
  const shown = agents.map((a) => {
    const { parent, name } = lineage(a.address);
    return { ...a, ...(parent ? { parent } : {}), ...(name ? { handle: name } : {}) };
  });
  const byAddr = new Map(shown.map((a) => [a.address, a]));
  for (const k of terminals) {
    if (byAddr.has(k.address) || k.state !== "live") continue;
    const { parent, name } = lineage(k.address);
    if (!(k.report?.app ?? k.agent) || !parent) continue;
    const status = k.status === "error" ? "blocked" : ["working", "blocked", "done", "idle"].includes(k.status) ? k.status : "idle";
    const a = { address: k.address, pane: null, space: null, app: k.report?.app ?? k.agent, program: k.program ?? null, space_name: "", tab_name: k.name ?? k.address, status, title: k.title || k.name || k.address, handle: name ?? k.name ?? null, seq: 0, focused: false, parent, cwd: k.cwd };
    shown.push(a);
    byAddr.set(a.address, a);
  }
  // Resolve after collecting all workers, including children of parked parents.
  for (const a of shown) {
    if (a.pinned == null) a.pinned = Boolean(byCore.get(a.address)?.labels?.["herdr.pinned"]);
    if (a.pane) continue;
    const visited = new Set([a.address]);
    let parent = byAddr.get(a.parent);
    while (parent && !visited.has(parent.address)) {
      visited.add(parent.address);
      if (parent.space != null) {
        a.space = parent.space;
        a.space_name = parent.space_name;
        break;
      }
      parent = byAddr.get(parent.parent);
    }
  }
  return shown;
}
