// Folds a Copilot session's events.jsonl into what Maestro shows. Pure: no herdr imports.

const WANTED = /"type":"(subagent\.(started|configured|completed|failed)|permission\.(requested|completed)|tool\.execution_(start|complete)|session\.(start|resume|shutdown|model_change|error|schedule_created|schedule_cancelled|schedule_rearmed)|user\.message|assistant\.turn_(start|end)|abort)"/;

export function emptySession() {
  return { agents: new Map(), perms: new Set(), asks: new Set(), effort: null, model: null, lastModel: null, schedules: new Map(), lastPromptAt: null, started: null, turnStart: null, error: null };
}

// Model calls are huge lines; read their model and effort without parsing them.
const CALL = /"type":"model\.model_call_success"/;
// Usage records name the main agent's model and effort for each call; side models
// (titles, summaries) appear only in model calls.
const USAGE = /"type":"session\.usage_record"/;
const USE_MODEL = /"model":"([^"]+)"/;
const CALL_EFFORT = /"reasoningEffort":"([^"]+)"/;
const CALL_MODEL = /"modelDisplayName":"([^"]+)"/;

export function applyLines(s, text) {
  for (const line of text.split("\n")) {
    if (!line) continue;
    if (USAGE.test(line)) {
      if (line.includes('"agentId":')) continue;
      s.lastModel = line.match(USE_MODEL)?.[1] ?? s.lastModel;
      s.effort = line.match(CALL_EFFORT)?.[1] ?? s.effort;
      s.effortSet = true;
      continue;
    }
    if (CALL.test(line)) {
      if (line.includes('"agentId":')) continue;
      if (/utility/i.test(line.match(CALL_MODEL)?.[1] ?? "")) continue;
      if (!s.effortSet) s.effort = line.match(CALL_EFFORT)?.[1] ?? s.effort;
      continue;
    }
    if (!WANTED.test(line)) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    applyEvent(s, e);
  }
  return s;
}

export function applyEvent(s, e) {
  const d = e.data ?? {};
  const t = Date.parse(e.timestamp) || null;
  if (e.agentId && !e.type.startsWith("subagent.") && trackAgent(s, e, d, t)) return s;
  switch (e.type) {
    case "session.start": s.started = Date.parse(d.startTime) || t; break;
    // Subagents live in the Copilot process: a restart (resume) or exit ends every one still
    // running or idle, and the log records nothing else for them.
    case "session.resume":
    case "session.shutdown":
      if (e.agentId) break;
      for (const a of s.agents.values()) {
        if (a.status !== "running" && a.status !== "idle") continue;
        a.status = "ended";
        a.ended = t ?? a.lastAt ?? a.started;
        a.activity = null;
      }
      s.turnStart = null; s.perms.clear(); s.asks.clear();
      break;
    case "session.model_change": if (e.agentId) break; s.model = d.newModel ?? s.model; if (d.reasoningEffort) { s.effort = d.reasoningEffort; s.effortSet = true; } break;
    case "session.schedule_created":
      if (d.id == null) break;
      s.schedules.set(d.id, { id: d.id, prompt: d.displayPrompt || d.prompt || "", intervalMs: d.intervalMs ?? null, cron: d.cron ?? null, at: d.at ?? null, recurring: d.recurring !== false, selfPaced: !!d.selfPaced, nextRunAt: d.at ?? null, runs: 0, created: t });
      break;
    case "session.schedule_cancelled": s.schedules.delete(d.id); break;
    case "session.schedule_rearmed": { const x = s.schedules.get(d.id); if (x) x.nextRunAt = d.nextRunAt ?? x.nextRunAt; break; }
    case "user.message":
      if (e.agentId) break;
      s.lastPromptAt = t;
      { const m = /^schedule-(\d+)$/.exec(String(d.source ?? "")); const x = m && (s.schedules.get(Number(m[1])) ?? s.schedules.get(m[1])); if (x) { x.runs++; x.lastRun = t; } }
      break;
    case "session.error": s.error = { type: d.errorType ?? "error", at: t }; break;
    case "subagent.started":
      if (!e.agentId) break;
      s.agents.set(e.agentId, { id: e.agentId, name: d.agentDisplayName || d.agentName || "subagent", kind: d.agentName ?? "", description: d.agentDescription ?? null, mode: d.executionMode ?? null, multiTurn: false, parent: d.parentId ?? null, model: d.model ?? null, effort: null, status: "running", started: t, ended: null, turns: 1, tools: 0, tokens: null, activity: null, lastAt: t });
      break;
    case "subagent.configured": {
      const a = s.agents.get(e.agentId);
      if (!a) break;
      a.model = d.model ?? a.model;
      a.effort = d.reasoningEffort ?? a.effort;
      a.multiTurn = !!d.multiTurn;
      break;
    }
    case "subagent.completed":
    case "subagent.failed": {
      const a = s.agents.get(e.agentId);
      if (!a) break;
      // A multi-turn (background) agent that finishes a turn stays alive, waiting for messages.
      a.status = e.type === "subagent.failed" ? "failed" : d.cancelled ? "cancelled" : a.multiTurn ? "idle" : "done";
      a.ended = t;
      a.lastAt = t;
      a.activity = null;
      if (d.totalToolCalls != null) a.tools = d.totalToolCalls;
      if (d.totalTokens != null) a.tokens = d.totalTokens;
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

// A subagent's own turns and tools: what it is doing now, and an idle agent waking up.
function trackAgent(s, e, d, t) {
  const a = s.agents.get(e.agentId);
  if (!a) return e.type.startsWith("assistant.turn") || e.type === "user.message";
  if (e.type === "assistant.turn_start" || e.type === "user.message") {
    if (a.status === "idle") { a.status = "running"; a.ended = null; a.turns++; a.activity = null; }
  } else if (e.type === "tool.execution_start") {
    if (a.status === "idle") { a.status = "running"; a.ended = null; a.turns++; }
    a.activity = d.toolName ?? a.activity;
    a.activityCall = d.toolCallId ?? null;
    if (a.status === "running") a.tools++;
  } else if (e.type === "tool.execution_complete" && d.toolCallId && d.toolCallId === a.activityCall) {
    a.activity = null;
    a.activityCall = null;
  }
  a.lastAt = t ?? a.lastAt;
  // Permission and question tracking still applies to the whole session.
  return !(e.type.startsWith("permission.") || e.type.startsWith("tool.execution"));
}

// Subagents as depth-first rows; finished ones stay for `keepMs` after they end.
export function treeRows(s, now, keepMs) {
  // Idle multi-turn agents can still be messaged, so they stay until the session ends.
  const kept = new Set([...s.agents.values()].filter((a) => a.status === "running" || a.status === "idle" || !a.ended || now - a.ended <= keepMs).map((a) => a.id));
  const kids = new Map();
  for (const a of s.agents.values()) {
    if (!kept.has(a.id)) continue;
    // A kept agent whose parent expired moves up to the top level.
    const p = a.parent && kept.has(a.parent) ? a.parent : null;
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

// Best-effort next run: rearm/one-shot time if known, else last run (or creation) plus interval.
export function nextRun(x, now) {
  if (x.nextRunAt) return x.nextRunAt;
  if (x.intervalMs) {
    let n = (x.lastRun ?? x.created ?? now) + x.intervalMs;
    while (n < now) n += x.intervalMs;
    return n;
  }
  return null;
}

export function cadence(x) {
  if (x.cron) return `cron ${x.cron}`;
  if (x.selfPaced) return "self-paced";
  if (x.intervalMs) {
    const m = Math.round(x.intervalMs / 60000);
    return m >= 60 && m % 60 === 0 ? `every ${m / 60}h` : m >= 1 ? `every ${m}m` : `every ${Math.round(x.intervalMs / 1000)}s`;
  }
  if (x.at) return "once";
  return "";
}
