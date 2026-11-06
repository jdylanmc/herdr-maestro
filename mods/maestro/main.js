// Maestro: Copilot sessions in Herdr, with their subagent trees, metrics and attention.
// Bindings come from the status-line bridge (bin/maestro-statusline), else from the
// session lock's process ancestry. Trees and attention come from each session's events.jsonl.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, run, theme, shared, setShared, exec, hc, home, appHome, watchFolder, setAgentOrder } from "herdr";
import * as fs from "fs/promises";
import { emptySession, applyLines, treeRows, attention } from "./log.js";

const MAX_TAIL = 8_000_000;
const KEEP_FINISHED_MS = 10 * 60_000;
const GROUPS = [
  { id: "space", label: "Space" },
  { id: "repo", label: "Repo" },
  { id: "org", label: "Org" },
];
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const GLYPH = { done: "✓", failed: "✗", cancelled: "⊘" };
const SPIN = ["◐", "◓", "◑", "◒"];

const snapDir = () => `${appHome()}/data/maestro/terminals`;
const sessionRoot = () => `${home()}/.copilot/session-state`;

// ~/git/<org>/<repo>/… or ~/git/_opensource/<org>/<repo>/…; else the folder's own name.
function place(cwd) {
  if (!cwd) return { org: "other", repo: "unknown" };
  const rel = cwd.startsWith(home()) ? cwd.slice(home().length).replace(/^\/+/, "") : cwd;
  const parts = rel.split("/").filter(Boolean);
  if (parts[0] === "git") {
    const rest = parts[1] === "_opensource" ? parts.slice(2) : parts.slice(1);
    if (rest.length >= 2) return { org: rest[0], repo: rest[1] };
    if (rest.length === 1) return { org: rest[0], repo: null };
    return { org: "~/git", repo: null };
  }
  return { org: parts.length ? parts[parts.length - 1] : "~", repo: null };
}

function ago(ms) {
  if (ms == null || Number.isNaN(ms)) return "";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

export default class Maestro extends View {
  init(_props, cx) {
    this.snaps = new Map();     // terminal address -> status-line payload
    this.fallback = new Map();  // terminal address -> session id (process ancestry)
    this.logs = new Map();      // session id -> { s, offset, carry, path, busy }
    this.collapsed = new Set(); // terminal addresses whose subagent tree is folded
    cx.spawn(async (cx) => {
      await fs.mkdir(snapDir(), { recursive: true }).catch(() => {});
      await this.refresh();
      cx.notify();
      for (;;) {
        await watchFolder(snapDir());
        await this.refresh();
        cx.notify();
      }
    });
    cx.timer.every(3000, (cx) => cx.spawn(async (cx) => { await this.tailAll(); cx.notify(); }));
    cx.timer.every(15000, (cx) => cx.spawn(async (cx) => { await this.bindByAncestry(); await this.tailAll(); cx.notify(); }));
  }

  async refresh() {
    await this.loadSnaps();
    await this.bindByAncestry();
    await this.tailAll();
  }

  async loadSnaps() {
    let names = [];
    try { names = await fs.readdir(snapDir()); } catch { return; }
    const live = new Set(this.live().map((a) => a.address));
    for (const n of names) {
      if (!n.endsWith(".json")) continue;
      const addr = n.slice(0, -5);
      if (!live.has(addr)) { this.snaps.delete(addr); continue; }
      try { this.snaps.set(addr, JSON.parse(await fs.readFile(`${snapDir()}/${n}`, "utf8"))); } catch {}
    }
  }

  // Fallback binding: inuse.<pid>.lock owners walked up to each terminal's foreground pid.
  async bindByAncestry() {
    const unbound = this.live().filter((a) => !a.address.includes("/") && !this.snaps.get(a.address)?.session_id && !this.fallback.has(a.address));
    if (!unbound.length) return;
    let locks, procs;
    try {
      locks = await exec("sh", ["-c", 'ls -1 "$1"/*/inuse.*.lock 2>/dev/null; true', "x", sessionRoot()]);
      procs = await exec("ps", ["-axo", "pid=,ppid="]);
    } catch { return; }
    const parent = new Map();
    for (const l of procs.stdout.split("\n")) {
      const [pid, ppid] = l.trim().split(/\s+/).map(Number);
      if (pid) parent.set(pid, ppid);
    }
    const owner = new Map(); // live pid -> session id
    for (const p of locks.stdout.split("\n")) {
      const m = p.match(/session-state\/([^/]+)\/inuse\.(\d+)\.lock$/);
      if (m && parent.has(Number(m[2]))) owner.set(Number(m[2]), m[1]);
    }
    for (const a of unbound) {
      let fg;
      try { fg = JSON.parse((await hc(["get", a.address, "--json"])).stdout)?.foreground?.pid; } catch { continue; }
      if (!fg) continue;
      for (const [pid, sid] of owner) {
        let p = pid;
        for (let hop = 0; hop < 6 && p && p !== fg; hop++) p = parent.get(p);
        if (p === fg) { this.fallback.set(a.address, sid); break; }
      }
    }
  }

  sessionFor(addr) {
    return this.snaps.get(addr)?.session_id ?? this.fallback.get(addr) ?? null;
  }

  async tailAll() {
    const ids = new Set(this.live().map((a) => this.sessionFor(a.address)).filter(Boolean));
    await Promise.all([...ids].map((id) => this.tail(id)));
  }

  // Reads what was appended since last time; the first read keeps only the last MAX_TAIL bytes.
  async tail(id) {
    let L = this.logs.get(id);
    if (!L) {
      L = { s: emptySession(), offset: 0, carry: "", path: `${sessionRoot()}/${id}/events.jsonl`, busy: false };
      this.logs.set(id, L);
    }
    if (L.busy) return;
    L.busy = true;
    try {
      const script = 's=$(wc -c < "$1" | tr -d " ") || exit 1; o=$2; m=$3; echo "$s"; if [ "$s" -lt "$o" ]; then o=0; fi; if [ $((s-o)) -gt "$m" ]; then o=$((s-m)); echo cut; else echo whole; fi; tail -c +$((o+1)) "$1" | head -c $((s-o))';
      const r = await exec("sh", ["-c", script, "x", L.path, String(L.offset), String(MAX_TAIL)]);
      if (r.code !== 0) return;
      const nl1 = r.stdout.indexOf("\n");
      const nl2 = r.stdout.indexOf("\n", nl1 + 1);
      const size = Number(r.stdout.slice(0, nl1));
      if (!Number.isFinite(size) || size === L.offset) return;
      const mode = r.stdout.slice(nl1 + 1, nl2);
      let chunk = r.stdout.slice(nl2 + 1);
      if (size < L.offset) { L.s = emptySession(); L.carry = ""; }
      if (mode === "cut") { chunk = chunk.slice(chunk.indexOf("\n") + 1); L.carry = ""; }
      const text = L.carry + chunk;
      const end = text.lastIndexOf("\n");
      applyLines(L.s, end >= 0 ? text.slice(0, end) : "");
      L.carry = end >= 0 ? text.slice(end + 1) : text;
      L.offset = size;
    } catch {
    } finally {
      L.busy = false;
    }
  }

  group() { return shared("maestro.group") ?? "repo"; }

  // Copilot agents with panes, plus pane-less hc sub-agents shaped like AgentInfo.
  live() {
    const shown = agents().filter((a) => a.app === "copilot");
    const have = new Set(shown.map((a) => a.address));
    const byAddr = new Map(shown.map((a) => [a.address, a]));
    for (const k of terminals()) {
      if (have.has(k.address) || k.state !== "live") continue;
      if ((k.report?.app ?? k.agent) !== "copilot") continue;
      const parent = byAddr.get(k.parent);
      const status = k.status === "error" ? "blocked" : ["working", "blocked", "done", "idle"].includes(k.status) ? k.status : "idle";
      shown.push({ address: k.address, pane: null, space: parent?.space ?? null, space_name: parent?.space_name ?? "", tab_name: k.name ?? k.address, status, app: "copilot", title: k.title || k.name || k.address, handle: k.name ?? null, seq: 0, focused: false, parent: k.parent ?? null, cwd: k.cwd });
    }
    return shown;
  }

  sessions() {
    const byPane = new Map(panes().map((p) => [p.pane, p]));
    const mode = this.group();
    return this.live().map((a) => {
      const pane = byPane.get(a.pane);
      const snap = this.snaps.get(a.address);
      const id = this.sessionFor(a.address);
      const L = id ? this.logs.get(id) : null;
      const cwd = snap?.cwd ?? pane?.cwd ?? a.cwd ?? null;
      const where = place(cwd);
      const key = mode === "space" ? a.space_name || "other" : mode === "org" || !where.repo ? where.org : `${where.org}/${where.repo}`;
      return { a, pane, snap, id, s: L?.s ?? null, key };
    });
  }

  render(cx) {
    const t = theme();
    const now = Date.now();
    const list = this.sessions();
    const byAddr = new Set(list.map((x) => x.a.address));
    const kidsOf = new Map();
    for (const x of list) {
      const p = x.a.parent;
      if (p && byAddr.has(p)) {
        if (!kidsOf.has(p)) kidsOf.set(p, []);
        kidsOf.get(p).push(x);
      }
    }
    const roots = list.filter((x) => !(x.a.parent && byAddr.has(x.a.parent)));
    const groups = new Map();
    for (const x of roots) {
      if (!groups.has(x.key)) groups.set(x.key, []);
      groups.get(x.key).push(x);
    }
    const order = [];
    const rows = [];
    for (const [key, items] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const worst = items.reduce((m, x) => (RANK[x.a.status] > RANK[m] ? x.a.status : m), "idle");
      rows.push(this.groupRow(t, key, items.length, worst));
      for (const x of items.sort((p, q) => RANK[q.a.status] - RANK[p.a.status] || q.a.seq - p.a.seq)) {
        this.pushSession(t, rows, order, x, kidsOf, now, 0);
      }
    }
    setAgentOrder(order);
    const counts = { blocked: 0, working: 0, done: 0 };
    for (const x of list) if (counts[x.a.status] != null) counts[x.a.status]++;

    return v_flex().id("maestro").size_full().bg(t.chrome).text_size(13).text_color(t.foreground)
      .child(h_flex().px(14).pt(12).pb(8).gap(10).items_center()
        .child(div().text_size(16).child("Maestro"))
        .child(div().text_color(t.dim).child(`${list.length} sessions`))
        .child(div().flex_1())
        .when(counts.blocked > 0, (el) => el.child(div().text_color(t.blocked).child(`${counts.blocked} need you`)))
        .when(counts.working > 0, (el) => el.child(div().text_color(t.working).child(`${counts.working} working`)))
        .when(counts.done > 0, (el) => el.child(div().text_color(t.done).child(`${counts.done} done`))))
      .child(h_flex().px(12).pb(8).gap(4).children(GROUPS.map((g) => {
        const on = g.id === this.group();
        return div().id(`g-${g.id}`).px(10).py(3).rounded(6).text_size(12)
          .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
          .hover((st) => st.bg(on ? t.selected : t.hover))
          .on_click(() => setShared("maestro.group", g.id)).child(g.label);
      })))
      .child(v_flex().id("maestro-list").flex_1().min_h(0).px(8).pb(8).overflow_y_scrollbar()
        .when(list.length === 0, (el) => el.child(div().p(12).text_color(t.dim).child("No Copilot sessions running.")))
        .children(rows));
  }

  pushSession(t, rows, order, x, kidsOf, now, depth) {
    order.push(x.a.address);
    rows.push(this.sessionRow(t, x, now, depth, (kidsOf.get(x.a.address) ?? []).length));
    if (this.collapsed.has(x.a.address)) return;
    if (x.s) for (const r of treeRows(x.s, now, KEEP_FINISHED_MS)) rows.push(this.agentRow(t, x, r, now, depth));
    const kids = (kidsOf.get(x.a.address) ?? []).sort((p, q) => RANK[q.a.status] - RANK[p.a.status] || p.a.address.localeCompare(q.a.address, undefined, { numeric: true }));
    for (const k of kids) this.pushSession(t, rows, order, k, kidsOf, now, depth + 1);
  }

  groupRow(t, key, n, worst) {
    return h_flex().id(`grp-${key}`).px(6).pt(10).pb(4).gap(6).items_center()
      .child(div().size(6).rounded(3).bg(t[worst] ?? t.idle))
      .child(div().text_size(11).text_color(t.muted).child(key.toUpperCase()))
      .child(div().text_size(11).text_color(t.dim).child(String(n)));
  }

  sessionRow(t, x, now, depth = 0, workers = 0) {
    const { a, snap, s } = x;
    const finished = depth > 0 && (a.status === "done" || a.status === "idle");
    const why = s ? attention(s) : null;
    const name = snap?.session_name || (a.title ?? "").replace(/ - GitHub Copilot$/, "") || a.tab_name;
    const handle = a.handle && a.handle !== name ? a.handle : null;
    const model = snap?.model?.display_name ?? s?.model ?? s?.lastModel ?? null;
    const effort = s?.effort ?? null;
    const ctx = snap?.context_window?.used_percentage;
    const aic = snap?.ai_used?.formatted;
    const turn = s?.turnStart && a.status === "working" ? ago(now - s.turnStart) : null;
    const up = snap?.cost?.total_duration_ms;
    const meta = [model && (effort && !model.includes(" · ") ? `${model} · ${effort}` : model), ctx != null && `ctx ${ctx}%`, aic && `${aic} AIC`, turn && `turn ${turn}`, up != null && `up ${ago(up)}`].filter(Boolean).join(" · ");
    const kids = (s ? treeRows(s, now, KEEP_FINISHED_MS).length : 0) + workers;
    const open = !this.collapsed.has(a.address);
    const stop = (_e, cx) => cx.stop_propagation();
    return v_flex().id(`s-${a.address}`).ml(depth * 16).px(8).py(depth ? 4 : 6).gap(2).rounded(8).opacity(finished ? 0.55 : 1)
      .bg(a.focused ? t.selected : t.chrome).hover((st) => st.bg(a.focused ? t.selected : t.hover))
      .on_click(() => run(a.pane ? "agent.focus" : "terminal.peek", { terminal: a.address }))
      .child(h_flex().gap(8).items_center()
        .child(div().size(8).rounded(4).bg(t[a.status] ?? t.idle))
        .when(Boolean(handle), (el) => el.child(div().px(5).rounded(4).text_size(11).bg(t.raised).text_color(t.muted).child(handle)))
        .child(div().flex_1().min_w(0).truncate().text_size(depth ? 12 : 13).child(name))
        .when(Boolean(why), (el) => el.child(div().px(6).rounded(4).text_size(11).bg(t.blocked).text_color(t.background).child(why)))
        .when(kids > 0, (el) => el.child(div().id(`tog-${a.address}`).px(4).text_color(t.dim).text_size(11)
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); if (open) this.collapsed.add(a.address); else this.collapsed.delete(a.address); cx.notify(); })
          .child(`${open ? "▾" : "▸"} ${kids}`)))
        .child(div().id(`go-${a.address}`).px(4).text_color(t.dim).hover((st) => st.text_color(t.foreground))
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); if (!a.pane) { run("terminal.peek", { terminal: a.address }); return; } run("layout.switch", { name: shared("maestro.return") ?? "catppuccin" }); run("pane.focus", { pane: a.pane }); })
          .child("↗")))
      .child(div().pl(16).truncate().text_size(11).text_color(t.dim)
        .child(meta || (x.id ? "reading session…" : "not bound yet: restart Copilot to enable the status-line bridge")));
  }

  agentRow(t, x, r, now, depth = 0) {
    const running = r.status === "running";
    const color = running ? t.working : r.status === "failed" ? t.blocked : r.status === "cancelled" ? t.dim : t.done;
    const glyph = running ? div().text_color(color).frames(SPIN, 150) : div().text_color(color).child(GLYPH[r.status] ?? "·");
    return h_flex().id(`a-${x.a.address}-${r.id}`).pl(24 + depth * 16 + r.depth * 14).pr(8).py(1).gap(6).items_center().text_size(12)
      .child(glyph)
      .child(div().min_w(0).truncate().text_color(running ? t.foreground : t.muted).child(r.name))
      .child(div().text_color(t.dim).text_size(11).child(r.kind && r.kind !== r.name ? r.kind : ""))
      .child(div().flex_1())
      .child(div().text_color(t.dim).text_size(11).child(ago((r.ended ?? now) - r.started)));
  }
}
