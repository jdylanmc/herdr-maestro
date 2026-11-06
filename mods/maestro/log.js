// Folds a Copilot session's events.jsonl into what Maestro shows. Pure: no herdr imports.

const WANTED = /"type":"(subagent\.(started|completed|failed)|permission\.(requested|completed)|tool\.execution_(start|complete)|session\.(start|model_change|error)|assistant\.turn_(start|end)|abort)"/;

export function emptySession() {
  return { agents: new Map(), perms: new Set(), asks: new Set(), effort: null, model: null, lastModel: null, started: null, turnStart: null, error: null };
}

export function applyLines(s, text) {
  for (const line of text.split("\n")) {
    if (!line || !WANTED.test(line)) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    applyEvent(s, e);
  }
  return s;
}

export function applyEvent(s, e) {
  const d = e.data ?? {};
  const t = Date.parse(e.timestamp) || null;
  switch (e.type) {
    case "session.start": s.started = Date.parse(d.startTime) || t; break;
    case "session.model_change": s.model = d.newModel ?? s.model; s.effort = d.reasoningEffort ?? s.effort; break;
    case "session.error": s.error = { type: d.errorType ?? "error", at: t }; break;
    case "subagent.started":
      if (!e.agentId) break;
      s.agents.set(e.agentId, { id: e.agentId, name: d.agentDisplayName || d.agentName || "subagent", kind: d.agentName ?? "", parent: d.parentId ?? null, model: d.model ?? null, status: "running", started: t, ended: null });
      break;
    case "subagent.completed":
    case "subagent.failed": {
      const a = s.agents.get(e.agentId);
      if (!a) break;
      a.status = e.type === "subagent.failed" ? "failed" : d.cancelled ? "cancelled" : "done";
      a.ended = t;
      break;
    }
    case "permission.requested": if (d.requestId) s.perms.add(d.requestId); break;
    case "permission.completed": s.perms.delete(d.requestId); break;
    case "tool.execution_start":
      if (d.toolName === "ask_user") s.asks.add(d.toolCallId);
      if (d.model && !e.agentId) s.lastModel = d.model;
      break;
    case "tool.execution_complete": s.asks.delete(d.toolCallId); break;
    case "assistant.turn_start": if (!d.parentToolCallId) { s.turnStart = t; s.error = null; } break;
    case "assistant.turn_end": if (!d.parentToolCallId) s.turnStart = null; break;
    case "abort": s.turnStart = null; s.perms.clear(); s.asks.clear(); break;
  }
  return s;
}

// Subagents as depth-first rows; finished ones stay for `keepMs` after they end.
export function treeRows(s, now, keepMs) {
  const kids = new Map();
  for (const a of s.agents.values()) {
    if (a.status !== "running" && a.ended && now - a.ended > keepMs) continue;
    const p = a.parent && s.agents.has(a.parent) ? a.parent : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(a);
  }
  const rows = [];
  const walk = (p, depth) => {
    for (const a of (kids.get(p) ?? []).sort((x, y) => x.started - y.started)) {
      rows.push({ ...a, depth });
      walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

export function attention(s) {
  if (s.perms.size) return "permission";
  if (s.asks.size) return "question";
  if (s.error) return "error";
  return null;
}
