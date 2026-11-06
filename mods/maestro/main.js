// Maestro: Copilot sessions in Herdr, with their subagent trees, metrics and attention.
// Bindings come from the status-line bridge (bin/maestro-statusline), else from the
// session lock's process ancestry. Trees and attention come from each session's events.jsonl.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, run, theme, shared, setShared, exec, hc, home, appHome, watchFolder, setAgentOrder, readTextFile, focused, notify, openOverlay, closeOverlay, props, nextCommand } from "herdr";
import * as fs from "fs/promises";
import { emptySession, applyLines, treeRows, attention, nextRun, cadence } from "./log.js";

const MAX_TAIL = 8_000_000;
const RECENT_MS = 24 * 3600_000;
const KEEP_FINISHED_MS = 10 * 60_000;
const keepMs = () => (shared("maestro.showFinished") ? 24 * 3600_000 : KEEP_FINISHED_MS);
const GROUPS = [
  { id: "space", label: "Space" },
  { id: "repo", label: "Repo" },
  { id: "org", label: "Org" },
];
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const GLYPH = { done: "✓", failed: "✗", cancelled: "⊘" };
const SPIN = ["◐", "◓", "◑", "◒"];

const dataDir = () => `${appHome()}/data/maestro`;
const snapDir = () => `${dataDir()}/terminals`;
const agentDir = () => `${dataDir()}/agents`;
const notifyDir = () => `${dataDir()}/notify`;
const MOOD = { happy: "😊", focused: "🎯", thinking: "🤔", proud: "😎", confused: "😕", stuck: "🧱", sleepy: "😴", celebrating: "🎉" };
// Each mood is a short native animation; agents pick moods with `maestro mood`.
const PET = {
  happy: ["😊", "😄"], focused: ["🎯", "🧐"], thinking: ["🤔", "💭"], proud: ["😎", "✨"],
  confused: ["😕", "❓"], stuck: ["🧱", "😣"], sleepy: ["😴", "💤"], celebrating: ["🎉", "🥳"],
};
const DERIVED = { working: "focused", blocked: "stuck", done: "proud", idle: "sleepy" };
const BOARD = [
  { id: "blocked", label: "Waiting on you" },
  { id: "working", label: "Working" },
  { id: "failed", label: "Failed" },
  { id: "done", label: "Finished" },
  { id: "idle", label: "Idle" },
];
const sessionRoot = () => `${home()}/.copilot/session-state`;
const HELPER = () => `${appHome()}/mods/maestro/helper.mjs`;
const helper = (...args) => exec("node", [HELPER(), ...args.map(String)]);

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
    this.recent = [];           // { id, name, cwd, updated } of sessions not running
    this.showRecent = true;
    this.records = new Map();   // terminal address -> agent-written record (parent, tags, mood, name)
    this.board = props()?.view === "board";
    cx.spawn(async (cx) => {
      for (const d of [snapDir(), agentDir(), notifyDir()]) await fs.mkdir(d, { recursive: true }).catch(() => {});
      await this.refresh();
      cx.notify();
      for (;;) {
        await watchFolder(dataDir());
        await this.refresh();
        cx.notify();
      }
    });
    if (!this.board) cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "board") this.openBoard();
        else if (c === "tags") this.openTags();
        cx.notify();
      }
    });
    cx.spawn(async (cx) => { await this.loadRecent(); cx.notify(); });
    cx.timer.every(30000, (cx) => cx.spawn(async (cx) => { await this.loadRecent(); cx.notify(); }));
    cx.timer.every(3000, (cx) => cx.spawn(async (cx) => { await this.tailAll(); cx.notify(); }));
    cx.timer.every(15000, (cx) => cx.spawn(async (cx) => { await this.bindByAncestry(); await this.tailAll(); cx.notify(); }));
  }

  async refresh() {
    await this.loadRecords();
    if (!this.board) await this.pumpNotifications();
    await this.loadSnaps();
    await this.bindByAncestry();
    await this.tailAll();
  }

  async loadRecords() {
    let names = [];
    try { names = await fs.readdir(agentDir()); } catch { return; }
    const live = new Set(terminals().filter((k) => k.state === "live").map((k) => k.address));
    const next = new Map();
    for (const n of names) {
      if (!n.endsWith(".json")) continue;
      const addr = n.slice(0, -5);
      let rec = null;
      try { rec = JSON.parse(await fs.readFile(`${agentDir()}/${n}`, "utf8")); } catch { continue; }
      if (!live.has(addr)) {
        if (Date.now() - (rec.updated ?? 0) > 60_000) await fs.unlink(`${agentDir()}/${n}`).catch(() => {});
        continue;
      }
      next.set(addr, rec);
    }
    this.records = next;
  }

  // Agents ask for the human's attention with `maestro notify`; each request becomes one toast.
  async pumpNotifications() {
    let names = [];
    try { names = await fs.readdir(notifyDir()); } catch { return; }
    for (const n of names.filter((x) => x.endsWith(".json")).sort()) {
      const path = `${notifyDir()}/${n}`;
      try {
        const m = JSON.parse(await fs.readFile(path, "utf8"));
        const who = this.records.get(m.from)?.name ?? m.from;
        notify({ title: `${who}: ${String(m.title).slice(0, 120)}`, body: m.body ? String(m.body).slice(0, 400) : undefined, level: "info", timeout: 8000, action: { name: "agent.focus", args: { terminal: m.from } } });
      } catch {}
      await fs.unlink(path).catch(() => {});
    }
  }

  async loadSnaps() {
    let names = [];
    try { names = await fs.readdir(snapDir()); } catch { return; }
    const live = new Set(this.live().map((a) => a.address));
    for (const n of names) {
      if (!n.endsWith(".json")) continue;
      const addr = n.slice(0, -5);
      if (!live.has(addr)) {
        this.snaps.delete(addr);
        if (!terminals().some((k) => k.address === addr && k.state === "live")) await fs.unlink(`${snapDir()}/${n}`).catch(() => {});
        continue;
      }
      try { this.snaps.set(addr, JSON.parse(await fs.readFile(`${snapDir()}/${n}`, "utf8"))); } catch {}
    }
  }

  // Fallback binding: inuse.<pid>.lock owners walked up to each terminal's foreground pid.
  async bindByAncestry() {
    const unbound = this.live().filter((a) => !a.address.includes("/") && !this.snaps.get(a.address)?.session_id && !this.fallback.has(a.address));
    if (!unbound.length) return;
    let locks, pairs;
    try {
      locks = JSON.parse((await helper("locks", sessionRoot())).stdout);
      pairs = JSON.parse((await helper("procs")).stdout);
    } catch { return; }
    const parent = new Map(pairs);
    const owner = new Map(); // live pid -> session id
    for (const l of locks) if (parent.has(l.pid)) owner.set(l.pid, l.id);
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

  // Session folders touched in the last day, newest first, read from workspace.yaml.
  async loadRecent() {
    let ids;
    try { ids = JSON.parse((await helper("recent", sessionRoot(), 60, Date.now() - RECENT_MS)).stdout).map((x) => x.id); } catch { return; }
    const out = [];
    for (const id of ids) {
      let y = null;
      try { y = await readTextFile(`${sessionRoot()}/${id}/workspace.yaml`); } catch {}
      if (!y) continue;
      const f = (k) => y.match(new RegExp(`^${k}: (.*)$`, "m"))?.[1]?.trim() ?? null;
      const updated = Date.parse(f("updated_at"));
      if (!updated || Date.now() - updated > RECENT_MS) continue;
      out.push({ id, name: f("name") ?? id.slice(0, 8), cwd: f("cwd"), updated });
    }
    this.recent = out.sort((a, b) => b.updated - a.updated);
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
      const r = await helper("tail", L.path, L.offset, MAX_TAIL);
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
    const labels = new Map(terminals().map((k) => [k.address, k.labels ?? {}]));
    for (const a of shown) {
      const r = this.records.get(a.address);
      const l = labels.get(a.address) ?? {};
      const parent = r?.parent ?? l["maestro.parent"];
      const name = r?.name ?? l["maestro.name"];
      if (parent) a.parent = parent;
      if (name) a.handle = name;
    }
    return shown;
  }

  sessions() {
    const byPane = new Map(panes().map((p) => [p.pane, p]));
    const kinds = new Map(terminals().map((k) => [k.address, k.report?.kind ?? null]));
    const mode = this.group();
    return this.live().map((a) => {
      const pane = byPane.get(a.pane);
      const snap = this.snaps.get(a.address);
      const id = this.sessionFor(a.address);
      const L = id ? this.logs.get(id) : null;
      const cwd = snap?.cwd ?? pane?.cwd ?? a.cwd ?? null;
      const where = place(cwd);
      const key = mode === "space" ? a.space_name || "other" : mode === "org" || !where.repo ? where.org : `${where.org}/${where.repo}`;
      const s = L?.s ?? null;
      const rec = this.records.get(a.address) ?? {};
      const failed = a.status !== "working" && a.status !== "blocked" && s?.error ? true : false;
      const tagKey = id ?? a.address;
      return { a, pane, snap, id, s, key, cwd, rec, failed, tagKey, userTags: (shared("maestro.tags") ?? {})[tagKey] ?? [], branch: pane?.branch ?? null, kind: a.status === "blocked" ? kinds.get(a.address) ?? null : null };
    });
  }

  render(cx) {
    const t = theme();
    const now = Date.now();
    const list = this.sessions();
    if (this.board) return this.renderBoard(t, list, now);
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
      rows.push(this.groupRow(t, key, items.length, worst, items[0]));
      const pinned = shared("maestro.order") ?? [];
      const at = (x) => { const i = pinned.indexOf(x.tagKey); return i < 0 ? Infinity : i; };
      items.sort((p, q) => at(p) - at(q) || RANK[q.a.status] - RANK[p.a.status] || q.a.seq - p.a.seq);
      for (const [i, x] of items.entries()) { x.prevKey = items[i - 1]?.tagKey ?? null; x.nextKey = items[i + 1]?.tagKey ?? null; x.siblings = items.map((y) => y.tagKey); }
      for (const x of items) {
        this.pushSession(t, rows, order, x, kidsOf, now, 0);
      }
    }
    setAgentOrder(order);
    const running = new Set(list.map((x) => x.id).filter(Boolean));
    const dismissed = new Set(shared("maestro.dismissed") ?? []);
    const recent = this.recent.filter((r) => !running.has(r.id) && !dismissed.has(r.id));
    if (recent.length) {
      rows.push(h_flex().id("recent-head").px(6).pt(16).pb(4).gap(6).items_center()
        .child(div().id("recent-tog").text_size(11).text_color(t.muted)
          .on_click((_e, cx) => { this.showRecent = !this.showRecent; cx.notify(); })
          .child(`${this.showRecent ? "▾" : "▸"} RECENT`))
        .child(div().text_size(11).text_color(t.dim).child(String(recent.length)))
        .child(div().flex_1())
        .child(div().id("recent-clear").px(6).rounded(4).text_size(11).text_color(t.dim).hover((st) => st.bg(t.hover).text_color(t.foreground))
          .on_click(() => setShared("maestro.dismissed", [...dismissed, ...recent.map((r) => r.id)].slice(-500)))
          .child("clear")));
      if (this.showRecent) for (const r of recent) rows.push(this.recentRow(t, r, dismissed, now));
    }
    const counts = { blocked: 0, working: 0, done: 0 };
    for (const x of list) if (counts[x.a.status] != null) counts[x.a.status]++;

    return v_flex().id("maestro").size_full().bg(t.chrome).text_size(13).text_color(t.foreground)
      .child(h_flex().px(14).pt(12).pb(8).gap(10).items_center()
        .child(div().text_size(16).child("Maestro"))
        .child(div().text_color(t.dim).child(`${list.length} sessions`))
        .child(div().flex_1())
        .when(counts.blocked > 0, (el) => el.child(div().text_color(t.blocked).child(`${counts.blocked} need you`)))
        .when(counts.working > 0, (el) => el.child(div().text_color(t.working).child(`${counts.working} working`)))
        .when(counts.done > 0, (el) => el.child(div().text_color(t.done).child(`${counts.done} done`)))
        .child(div().id("open-board").px(8).py(2).rounded(6).text_size(12).text_color(t.muted).hover((st) => st.bg(t.hover).text_color(t.foreground))
          .on_click(() => this.openBoard())
          .child("Board")))
      .child(h_flex().px(12).pb(8).gap(4).children(GROUPS.map((g) => {
        const on = g.id === this.group();
        return div().id(`g-${g.id}`).px(10).py(3).rounded(6).text_size(12)
          .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
          .hover((st) => st.bg(on ? t.selected : t.hover))
          .on_click(() => setShared("maestro.group", g.id)).child(g.label);
      })).child(div().flex_1())
        .child(div().id("show-finished").px(8).py(3).rounded(6).text_size(12)
          .bg(shared("maestro.showFinished") ? t.selected : t.chrome).text_color(shared("maestro.showFinished") ? t.foreground : t.muted)
          .hover((st) => st.bg(t.hover))
          .on_click(() => setShared("maestro.showFinished", !shared("maestro.showFinished")))
          .child("Show finished")))
      .child(v_flex().id("maestro-list").flex_1().min_h(0).px(8).pb(8).overflow_y_scrollbar()
        .when(list.length === 0, (el) => el.child(div().p(12).text_color(t.dim).child("No Copilot sessions running.")))
        .children(rows))
      .child(this.footer(t, list, now));
  }

  // Maestro's own order: Herdr's tab order is untouched.
  move(x, dir) {
    const list = [...x.siblings];
    const i = list.indexOf(x.tagKey);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const rest = (shared("maestro.order") ?? []).filter((k) => !list.includes(k));
    setShared("maestro.order", [...list, ...rest].slice(0, 400));
  }

  openBoard() {
    openOverlay({ kind: "window", mod: "maestro", props: { view: "board" }, key: "maestro-board", width: 1180, height: 640 });
  }

  openTags() {
    const f = focused();
    const x = this.sessions().find((y) => y.a.address === f?.terminal);
    if (x) openOverlay({ kind: "dialog", mod: "maestro-tags", props: { key: x.tagKey, label: x.snap?.session_name ?? x.a.address } });
  }

  // Pinned details for the focused session.
  footer(t, list, now) {
    const f = focused();
    const x = list.find((y) => y.a.address === f?.terminal) ?? list.find((y) => y.a.focused);
    if (!x) return div();
    const { a, snap, s } = x;
    const line = (k, v) => v == null || v === "" ? null : h_flex().gap(8).text_size(11)
      .child(div().w(64).text_color(t.dim).child(k)).child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(String(v)));
    const sched = s ? [...s.schedules.values()] : [];
    const cost = snap?.cost;
    const tags = [...x.userTags.map((g) => ({ g, mine: true })), ...(x.rec.tags ?? []).map((g) => ({ g, mine: false }))];
    return v_flex().id("maestro-footer").mx(8).mb(8).p(10).gap(3).rounded(8).bg(t.surface).border_1().border_color(t.border)
      .child(h_flex().gap(8).items_center()
        .child(this.pet(x, 18))
        .child(div().flex_1().min_w(0).truncate().text_size(12).child(snap?.session_name || (a.title ?? "").replace(/ - GitHub Copilot$/, "") || a.address))
        .child(div().id("edit-tags").px(6).rounded(4).text_size(11).text_color(t.dim).hover((st) => st.bg(t.hover).text_color(t.foreground))
          .on_click(() => openOverlay({ kind: "dialog", mod: "maestro-tags", props: { key: x.tagKey, label: snap?.session_name ?? a.address } }))
          .child("Edit tags…")))
      .when(tags.length > 0, (el) => el.child(this.tagChips(t, tags)))
      .child(h_flex().gap(2).children(Object.keys(PET).map((m) => div().id(`mood-${m}`).px(2).rounded(4).text_size(12)
        .bg(this.mood(x) === m ? t.selected : t.surface).hover((st) => st.bg(t.hover))
        .on_click(() => {
          const p = { ...(shared("maestro.preview") ?? {}) };
          if (p[a.address] === m) delete p[a.address]; else p[a.address] = m;
          setShared("maestro.preview", p);
        })
        .child(PET[m][0]))))
      .children([
        line("terminal", `${a.address}${a.parent ? ` · child of ${a.parent}` : ""}`),
        line("session", x.id),
        line("folder", x.cwd ? x.cwd.replace(home(), "~") : null),
        line("branch", x.branch),
        line("usage", cost ? `${snap.ai_used?.formatted ?? "?"} AIC · ${cost.total_premium_requests ?? 0} premium · +${cost.total_lines_added ?? 0} −${cost.total_lines_removed ?? 0}` : null),
        line("context", snap?.context_window ? `${snap.context_window.used_percentage}% of ${Math.round((snap.context_window.context_window_size ?? 0) / 1000)}k` : null),
      ].filter(Boolean))
      .when(sched.length > 0, (el) => el.child(v_flex().pt(4).gap(2)
        .child(div().text_size(11).text_color(t.dim).child(`BEATS ${sched.length}`))
        .children(sched.map((b) => {
          const n = nextRun(b, now);
          return h_flex().id(`beat-${b.id}`).gap(6).text_size(11)
            .child(div().text_color(t.working).child("⟳"))
            .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(b.prompt))
            .child(div().text_color(t.dim).child([cadence(b), b.runs ? `${b.runs} runs` : null, n ? `next ${n > now ? "in " + ago(n - now) : "due"}` : null].filter(Boolean).join(" · ")));
        }))));
  }

  mood(x) {
    return (shared("maestro.preview") ?? {})[x.a.address] ?? x.rec.mood ?? DERIVED[x.failed ? "blocked" : x.a.status] ?? "sleepy";
  }

  moodGlyph(x) {
    return MOOD[this.mood(x)] ?? "·";
  }

  pet(x, size = 13) {
    const frames = PET[this.mood(x)] ?? ["·"];
    const lively = x.a.status === "working" || x.a.status === "blocked" || (shared("maestro.preview") ?? {})[x.a.address];
    return lively ? div().text_size(size).frames(frames, 700) : div().text_size(size).child(frames[0]);
  }

  tagChips(t, tags) {
    return h_flex().flex_wrap().gap(4).children(tags.slice(0, 6).map(({ g, mine }) =>
      div().px(5).rounded(4).text_size(10).bg(mine ? t.selected : t.raised).text_color(mine ? t.foreground : t.muted).child(mine ? g : `${g}·agent`)));
  }

  boardColumn(x) {
    if (x.a.status === "blocked") return "blocked";
    if (x.failed) return "failed";
    return x.a.status;
  }

  renderBoard(t, list, now) {
    const cols = BOARD.map((c) => ({ ...c, items: list.filter((x) => this.boardColumn(x) === c.id) }));
    return v_flex().id("maestro-board").size_full().bg(t.canvas).text_color(t.foreground).text_size(13)
      .child(h_flex().px(16).py(12).gap(10).items_center().bg(t.chrome)
        .child(div().text_size(16).child("Maestro board"))
        .child(div().text_color(t.dim).child(`${list.length} sessions`))
        .child(div().flex_1())
        .child(div().id("board-close").px(8).rounded(4).text_color(t.dim).hover((st) => st.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click(() => closeOverlay(props()?.overlay)).child("×")))
      .child(h_flex().id("board-cols").flex_1().min_h(0).p(12).gap(10).items_start().children(cols.map((c) =>
        v_flex().id(`col-${c.id}`).flex_1().min_w(0).h_full().p(8).gap(8).rounded(10).bg(t.chrome).overflow_y_scrollbar()
          .child(h_flex().gap(6).items_center().pb(2)
            .child(div().size(8).rounded(4).bg(c.id === "failed" ? t.blocked : t[c.id] ?? t.idle))
            .child(div().text_size(12).text_color(t.muted).child(c.label))
            .child(div().text_size(11).text_color(t.dim).child(String(c.items.length))))
          .children(c.items.map((x) => this.card(t, x, now))))));
  }

  card(t, x, now) {
    const { a, snap, s } = x;
    const why = x.kind ?? (s ? attention(s) : null);
    const running = s ? treeRows(s, now, keepMs()).filter((r) => r.status === "running").length : 0;
    const tags = [...x.userTags.map((g) => ({ g, mine: true })), ...(x.rec.tags ?? []).map((g) => ({ g, mine: false }))];
    return v_flex().id(`card-${a.address}`).p(8).gap(4).rounded(8).bg(t.surface).border_1().border_color(a.focused ? t.accent : t.border)
      .hover((st) => st.bg(t.hover))
      .on_click(() => run(a.pane ? "agent.focus" : "terminal.peek", { terminal: a.address }))
      .child(h_flex().gap(6).items_center()
        .child(this.pet(x, 13))
        .child(div().flex_1().min_w(0).truncate().text_size(12).child(snap?.session_name || (a.title ?? "").replace(/ - GitHub Copilot$/, "") || a.address)))
      .child(div().truncate().text_size(11).text_color(t.dim).child([x.key, snap?.context_window && `ctx ${snap.context_window.used_percentage}%`, snap?.ai_used && `${snap.ai_used.formatted} AIC`].filter(Boolean).join(" · ")))
      .when(Boolean(why) || running > 0, (el) => el.child(h_flex().gap(6).text_size(11)
        .when(Boolean(why), (e2) => e2.child(div().px(5).rounded(4).bg(t.blocked).text_color(t.background).child(why)))
        .when(running > 0, (e2) => e2.child(div().text_color(t.working).child(`${running} subagent${running > 1 ? "s" : ""} running`)))))
      .when(tags.length > 0, (el) => el.child(this.tagChips(t, tags)));
  }

  pushSession(t, rows, order, x, kidsOf, now, depth) {
    order.push(x.a.address);
    rows.push(this.sessionRow(t, x, now, depth, (kidsOf.get(x.a.address) ?? []).length));
    if (this.collapsed.has(x.a.address)) return;
    if (x.s) for (const r of treeRows(x.s, now, keepMs())) rows.push(this.agentRow(t, x, r, now, depth));
    const kids = (kidsOf.get(x.a.address) ?? []).sort((p, q) => RANK[q.a.status] - RANK[p.a.status] || p.a.address.localeCompare(q.a.address, undefined, { numeric: true }));
    for (const k of kids) this.pushSession(t, rows, order, k, kidsOf, now, depth + 1);
  }

  groupRow(t, key, n, worst, first) {
    const where = first?.cwd ?? null;
    const space = first?.a.space ?? null;
    return h_flex().id(`grp-${key}`).px(6).pt(10).pb(4).gap(6).items_center()
      .child(div().size(6).rounded(3).bg(t[worst] ?? t.idle))
      .child(div().text_size(11).text_color(t.muted).child(key.toUpperCase()))
      .child(div().text_size(11).text_color(t.dim).child(String(n)))
      .child(div().flex_1())
      .child(div().id(`new-${key}`).px(6).rounded(4).text_color(t.dim).hover((st) => st.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("tab.new", { ...(space ? { space } : {}), ...(where ? { folder: where } : {}), argv: shared("maestro.argv") ?? ["copilot", "--yolo"] }))
        .child("+ copilot"));
  }

  sessionRow(t, x, now, depth = 0, workers = 0) {
    const { a, snap, s } = x;
    const finished = depth > 0 && (a.status === "done" || a.status === "idle");
    const failedKids = s ? [...s.agents.values()].filter((g) => g.status === "failed" && now - (g.ended ?? 0) < keepMs()).length : 0;
    const raw = x.kind ?? (s ? attention(s) : null) ?? (failedKids ? `${failedKids} failed` : null);
    const ackKey = `${a.address}:${raw}:${s?.error?.at ?? ""}:${failedKids}`;
    const acked = (shared("maestro.acked") ?? []).includes(ackKey);
    const why = raw && !acked ? raw : null;
    const name = snap?.session_name || (a.title ?? "").replace(/ - GitHub Copilot$/, "") || a.tab_name;
    const handle = a.handle && a.handle !== name ? a.handle : null;
    const model = snap?.model?.display_name ?? s?.model ?? s?.lastModel ?? null;
    const effort = s?.effort ?? null;
    const ctx = snap?.context_window?.used_percentage;
    const aic = snap?.ai_used?.formatted;
    const turn = s?.turnStart && a.status === "working" ? ago(now - s.turnStart) : null;
    const up = snap?.cost?.total_duration_ms;
    const meta = [x.branch && `⎇ ${x.branch}`, model && (effort && !model.includes(" · ") ? `${model} · ${effort}` : model), ctx != null && `ctx ${ctx}%`, aic && `${aic} AIC`, turn && `turn ${turn}`, up != null && `up ${ago(up)}`].filter(Boolean).join(" · ");
    const kids = (s ? treeRows(s, now, keepMs()).length : 0) + workers;
    const open = !this.collapsed.has(a.address);
    const stop = (_e, cx) => cx.stop_propagation();
    return v_flex().id(`s-${a.address}`).ml(depth * 16).px(8).py(depth ? 4 : 6).gap(2).rounded(8).opacity(finished ? 0.55 : 1)
      .bg(a.focused ? t.selected : t.chrome).hover((st) => st.bg(a.focused ? t.selected : t.hover))
      .on_click(() => run(a.pane ? "agent.focus" : "terminal.peek", { terminal: a.address }))
      .child(h_flex().gap(8).items_center()
        .child(div().size(8).rounded(4).bg(x.failed ? t.blocked : t[a.status] ?? t.idle))
        .child(this.pet(x, 12))
        .when(Boolean(handle), (el) => el.child(div().px(5).rounded(4).text_size(11).bg(t.raised).text_color(t.muted).child(handle)))
        .child(div().flex_1().min_w(0).truncate().text_size(depth ? 12 : 13).child(name))
        .when(Boolean(why), (el) => el.child(div().id(`ack-${a.address}`).px(6).rounded(4).text_size(11).bg(t.blocked).text_color(t.background)
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); setShared("maestro.acked", [...(shared("maestro.acked") ?? []), ackKey].slice(-300)); })
          .child(`${why} ✓`)))
        .when(kids > 0, (el) => el.child(div().id(`tog-${a.address}`).px(4).text_color(t.dim).text_size(11)
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); if (open) this.collapsed.add(a.address); else this.collapsed.delete(a.address); cx.notify(); })
          .child(`${open ? "▾" : "▸"} ${kids}`)))
        .when(depth === 0 && Boolean(x.prevKey), (el) => el.child(div().id(`up-${a.address}`).px(2).text_size(11).text_color(t.dim).hover((st) => st.text_color(t.foreground))
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); this.move(x, -1); }).child("↑")))
        .when(depth === 0 && Boolean(x.nextKey), (el) => el.child(div().id(`dn-${a.address}`).px(2).text_size(11).text_color(t.dim).hover((st) => st.text_color(t.foreground))
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); this.move(x, 1); }).child("↓")))
        .child(div().id(`go-${a.address}`).px(4).text_color(t.dim).hover((st) => st.text_color(t.foreground))
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); if (!a.pane) { run("terminal.peek", { terminal: a.address }); return; } run("layout.switch", { name: shared("maestro.return") ?? "catppuccin" }); run("pane.focus", { pane: a.pane }); })
          .child("↗")))
      .when(x.userTags.length > 0 || (x.rec.tags ?? []).length > 0 || (s?.schedules.size ?? 0) > 0, (el) => el.child(h_flex().pl(16).gap(4)
        .child(this.tagChips(t, [...x.userTags.map((g) => ({ g, mine: true })), ...(x.rec.tags ?? []).map((g) => ({ g, mine: false }))]))
        .when((s?.schedules.size ?? 0) > 0, (e2) => e2.child(div().text_size(10).text_color(t.working).child(`⟳ ${s.schedules.size}`)))))
      .child(div().pl(16).truncate().text_size(11).text_color(t.dim)
        .child(meta || (x.id ? "reading session…" : "not bound yet: restart Copilot to enable the status-line bridge")));
  }

  recentRow(t, r, dismissed, now) {
    const where = place(r.cwd);
    const resume = () => run("tab.new", { ...(focused()?.space ? { space: focused().space } : {}), ...(r.cwd ? { folder: r.cwd } : {}), argv: [...(shared("maestro.argv") ?? ["copilot", "--yolo"]), "--resume", r.id] });
    return h_flex().id(`r-${r.id}`).px(8).py(4).gap(8).items_center().rounded(8).text_size(12)
      .hover((st) => st.bg(t.hover))
      .child(div().size(6).rounded(3).bg(t.idle))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(r.name))
      .child(div().text_size(11).text_color(t.dim).child(`${where.repo ?? where.org} · ${ago(now - r.updated)} ago`))
      .child(div().id(`res-${r.id}`).px(6).rounded(4).text_size(11).text_color(t.dim).hover((st) => st.bg(t.raised).text_color(t.foreground))
        .on_click(resume).child("resume"))
      .child(div().id(`dis-${r.id}`).px(4).text_color(t.dim).hover((st) => st.text_color(t.foreground))
        .on_click(() => setShared("maestro.dismissed", [...dismissed, r.id].slice(-500))).child("×"));
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
