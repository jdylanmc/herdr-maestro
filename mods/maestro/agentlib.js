// Which coding agent `maestro spawn --agent <name>` starts, and how. Pure; shared by the CLI and tests.

export const DEFAULT_ARGV = ["copilot", "--yolo"];

// Used only until Maestro has cached Herdr's knownAgents() in shared.json ("maestro.knownAgents").
export const FALLBACK_AGENTS = [
  { key: "copilot", name: "GitHub Copilot", run: ["copilot"] },
  { key: "claude", name: "Claude Code", run: ["claude"] },
  { key: "codex", name: "Codex", run: ["codex"] },
  { key: "cursor-agent", name: "Cursor Agent", run: ["cursor-agent"] },
  { key: "gemini", name: "Gemini CLI", run: ["gemini"] },
  { key: "opencode", name: "opencode", run: ["opencode"] },
  { key: "pi", name: "pi", run: ["pi"] },
  { key: "amp", name: "Amp", run: ["amp"] },
];

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export const isCopilot = (agent) => norm(agent?.key) === "copilot";

// The agents Maestro last read from Herdr (shared.json), else the fallback table.
export function knownAgentsFrom(sharedJson) {
  const list = sharedJson?.["maestro.knownAgents"]?.agents;
  const ok = Array.isArray(list) ? list.filter((a) => a?.key && Array.isArray(a.run) && a.run.length) : [];
  return ok.length ? { agents: ok, cached: true } : { agents: FALLBACK_AGENTS, cached: false };
}

// Exact key first, then key or display name ignoring case and punctuation, then a unique prefix.
export function findAgent(name, known) {
  const want = norm(name);
  if (!want) return null;
  return known.find((a) => a.key === name)
    ?? known.find((a) => norm(a.key) === want || norm(a.name) === want)
    ?? (() => { const hits = known.filter((a) => norm(a.key).startsWith(want) || norm(a.name).startsWith(want)); return hits.length === 1 ? hits[0] : null; })();
}

// Copilot keeps Maestro's argv and takes its task with -i; other agents get Herdr's tab.new task.
export function spawnPlan({ agent = null, task = null, copilotArgv = DEFAULT_ARGV } = {}) {
  if (!agent || isCopilot(agent)) return { argv: [...copilotArgv, ...(task ? ["-i", task] : [])], task: null };
  return { argv: [...agent.run], task: task || null };
}
