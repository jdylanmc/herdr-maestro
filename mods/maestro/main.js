// Maestro: Copilot sessions in Herdr, with their subagent trees, metrics and attention.
// Bindings come from the status-line bridge (bin/maestro-statusline), else from the
// session lock's process ancestry. Trees and attention come from each session's events.jsonl.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, spaces, layout, run, theme, shared, setShared, exec, hc, home, appHome, watchFolder, setAgentOrder, readTextFile, focused, notify, openOverlay, closeOverlay, props, nextCommand } from "herdr";
import * as fs from "fs/promises";
import { emptySession, applyLines, treeRows, attention, nextRun, cadence } from "./log.js";

const KEEP_FINISHED_MS = 10 * 60_000;
const keepMs = () => (shared("maestro.showFinished") ? 24 * 3600_000 : KEEP_FINISHED_MS);
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const STATUS_WORD = { working: "Working", blocked: "Waiting on you", done: "Done", idle: "Idle", failed: "Failed" };
const NERD = "JetBrainsMono Nerd Font Mono";
const MONO = "JetBrainsMono Nerd Font Mono";
// Session icons: Nerd Font glyphs an agent picks with `maestro icon <name>`; others get one by name.
const ICONS = {
  robot: "\u{F06A9}", code: "\u{F121}", bug: "\u{F188}", eye: "\u{F06E}", shield: "\u{F132}", compass: "\u{F14E}",
  brush: "\u{F1FC}", flask: "\u{F0C3}", rocket: "\u{F135}", cogs: "\u{F085}", search: "\u{F002}", book: "\u{F02D}",
  terminal: "\u{F120}", wrench: "\u{F0AD}", lightbulb: "\u{F0EB}", heart: "\u{F004}", star: "\u{F005}", bolt: "\u{F0E7}",
};
const IDENTITY = ["#22a99a", "#e3814f", "#5b8def", "#8b7cf6", "#3fae6a", "#d9649a", "#d8b14a", "#4fb3d9"];
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619); return h >>> 0; };
const find = (node, id) => { if (node?.id === id) return node; for (const c of node?.children ?? []) { const f = find(c, id); if (f) return f; } return null; };
// Pet mood rows, as in pets.mjs: [20-row mood atlas, 9-row Codex sheet].
const MOOD_ROWS = {
  idle: [0, 0], thinking: [11, 8], working: [7, 7], delegating: [12, 1], question: [6, 6],
  "needs-permission": [13, 6], confused: [14, 8], content: [3, 3], startled: [9, 4], sad: [5, 5],
  compacting: [15, 2], sleepy: [16, 0], gone: [17, 0], proud: [18, 3], celebrating: [19, 4],
};
// `maestro mood` words to pet moods.
const SELF_MOOD = { happy: "proud", focused: "working", thinking: "thinking", proud: "proud", confused: "confused", stuck: "confused", sleepy: "sleepy", celebrating: "celebrating" };

const dataDir = () => `${appHome()}/data/maestro`;
const snapDir = () => `${dataDir()}/terminals`;
const agentDir = () => `${dataDir()}/agents`;
const notifyDir = () => `${dataDir()}/notify`;
const MOOD = { happy: "😊", focused: "🎯", thinking: "🤔", proud: "😎", confused: "😕", stuck: "🧱", sleepy: "😴", celebrating: "🎉" };
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
const clean = (argv) => ["node", HELPER(), "run", ...argv];
const copilotArgv = (...extra) => clean([...(shared("maestro.argv") ?? ["copilot", "--yolo"]), ...extra]);

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
    this.logs = new Map();      // session id -> { s, offset, path, busy }
    this.collapsed = new Set(); // terminal addresses whose subagent tree is folded
    this.records = new Map();   // terminal address -> agent-written record (parent, tags, mood, name)
    this.view = props()?.view ?? "list"; // list (sidebar), footer (focused agent), board (window)
    this.board = this.view === "board";
    this.primary = this.view === "list";
    this.cx = cx;
    this.folded = new Set(JSON.parse(localStorage.getItem("folded") ?? "[]"));
    this.git = new Map();       // folder -> { v: { repo, top, branch, tree }, at }
    this.pets = [];             // rendered pets (data/maestro/pets/index.json)
    cx.spawn(async (cx) => { await this.loadPets(); cx.notify(); });
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
    if (this.primary) cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "board") this.openBoard();
        else if (c === "tags") this.openTags();
        cx.notify();
      }
    });
    cx.timer.every(3000, (cx) => cx.spawn(async (cx) => { await this.tailAll(); cx.notify(); }));
    cx.timer.every(15000, (cx) => cx.spawn(async (cx) => { await this.bindByAncestry(); await this.tailAll(); cx.notify(); }));
  }

  // Codex pets (~/.codex/pets) and cmux Maestro's own, rendered once to per-mood GIFs.
  async loadPets() {
    const out = `${dataDir()}/pets`;
    const roots = [`${home()}/.codex/pets`, `${home()}/Applications/CMUX Maestro Preview.app/Contents/Extensions/CMUX Maestro Preview Extension.appex/Contents/Resources/maestro-pet.json`, `${dataDir()}/pet-sources`];
    try { this.pets = JSON.parse(await readTextFile(`${out}/index.json`)); } catch {}
    if (!this.primary) return;
    try { const r = await helper("pets", out, ...roots); if (r.code === 0) this.pets = JSON.parse(r.stdout); } catch {}
  }

  async refresh() {
    await this.loadRecords();
    if (this.primary) await this.pumpNotifications();
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

  sessionFor(addr) {
    return this.snaps.get(addr)?.session_id ?? this.fallback.get(addr) ?? null;
  }

  async tailAll() {
    const ids = new Set(this.live().map((a) => this.sessionFor(a.address)).filter(Boolean));
    await Promise.all([...ids].map((id) => this.tail(id)));
  }

  // Folds what was appended since last time, as the helper's compact projection of the log.
  async tail(id) {
    let L = this.logs.get(id);
    if (!L) {
      L = { s: emptySession(), offset: 0, path: `${sessionRoot()}/${id}/events.jsonl`, busy: false };
      this.logs.set(id, L);
    }
    if (L.busy) return;
    L.busy = true;
    try {
      const r = await helper("events", L.path, L.offset);
      if (r.code !== 0) return;
      const nl = r.stdout.indexOf("\n");
      const next = Number(nl < 0 ? r.stdout : r.stdout.slice(0, nl));
      if (!Number.isFinite(next) || next === L.offset) return;
      if (next < L.offset) L.s = emptySession();
      applyLines(L.s, nl < 0 ? "" : r.stdout.slice(nl + 1));
      L.offset = next;
    } catch {
    } finally {
      L.busy = false;
    }
  }

  // Copilot agents with panes, plus pane-less hc sub-agents shaped like AgentInfo.
  live() {
    const shown = agents().map((a) => ({ ...a }));
    const have = new Set(shown.map((a) => a.address));
    const byAddr = new Map(shown.map((a) => [a.address, a]));
    for (const k of terminals()) {
      if (have.has(k.address) || k.state !== "live") continue;
      if (!(k.report?.app ?? k.agent) || !k.parent) continue;
      const parent = byAddr.get(k.parent);
      const status = k.status === "error" ? "blocked" : ["working", "blocked", "done", "idle"].includes(k.status) ? k.status : "idle";
      shown.push({ address: k.address, pane: null, space: parent?.space ?? null, app: k.report?.app ?? k.agent, space_name: parent?.space_name ?? "", tab_name: k.name ?? k.address, status, title: k.title || k.name || k.address, handle: k.name ?? null, seq: 0, focused: false, parent: k.parent ?? null, cwd: k.cwd });
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
    return this.live().map((a) => {
      const pane = byPane.get(a.pane);
      const snap = this.snaps.get(a.address);
      const id = this.sessionFor(a.address);
      const L = id ? this.logs.get(id) : null;
      const cwd = snap?.cwd ?? pane?.cwd ?? a.cwd ?? null;
      const key = a.space_name || "";
      const s = L?.s ?? null;
      const rec = this.records.get(a.address) ?? {};
      const failed = a.status !== "working" && a.status !== "blocked" && s?.error ? true : false;
      const tagKey = id ?? a.address;
      return { a, pane, snap, id, s, key, cwd, rec, failed, tagKey, userTags: (shared("maestro.tags") ?? {})[tagKey] ?? [], branch: pane?.branch ?? null, kind: a.status === "blocked" ? kinds.get(a.address) ?? null : null };
    });
  }

  // ---- Hierarchy: space -> worktree -> agent -> internal tasks and workers ----
  render(cx) {
    const t = theme();
    const now = Date.now();
    const list = this.sessions();
    if (this.board) return this.renderBoard(t, list, now);
    if (this.view === "footer") return this.footer(t, list, now);
    this.refreshGit(list);
    const byAddr = new Map(list.map((x) => [x.a.address, x]));
    const kidsOf = new Map();
    for (const x of list) {
      const p = x.a.parent;
      if (p && byAddr.has(p) && p !== x.a.address) {
        if (!kidsOf.has(p)) kidsOf.set(p, []);
        kidsOf.get(p).push(x);
      }
    }
    const roots = list.filter((x) => !(x.a.parent && byAddr.has(x.a.parent)));
    const order = [];
    const rows = [];
    const narrow = (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;
    for (const sp of spaces()) {
      const mine = roots.filter((x) => x.a.space === sp.id);
      if (narrow) { for (const x of mine) this.walk(x, kidsOf, (y) => order.push(y.a.address)); rows.push(this.railSpace(t, sp, mine)); continue; }
      rows.push(this.spaceRow(t, sp, mine, kidsOf));
      if (this.folded.has(`sp:${sp.id}`)) {
        if (mine.length) rows.push(this.iconCard(t, `sp:${sp.id}`, this.flat(mine, kidsOf)));
        for (const x of mine) this.walk(x, kidsOf, (y) => order.push(y.a.address));
        continue;
      }
      const trees = new Map();
      for (const x of mine) {
        const g = this.gitOf(x.cwd);
        const k = g?.top ?? x.cwd ?? "?";
        if (!trees.has(k)) trees.set(k, { g, cwd: x.cwd, items: [] });
        trees.get(k).items.push(x);
      }
      for (const [k, tr] of trees) {
        const fid = `wt:${sp.id}:${k}`;
        rows.push(this.treeRow(t, fid, tr, kidsOf));
        const sorted = tr.items.sort((p, q) => RANK[q.a.status] - RANK[p.a.status] || p.a.seq - q.a.seq);
        if (this.folded.has(fid)) { rows.push(this.iconCard(t, fid, this.flat(sorted, kidsOf))); for (const x of sorted) this.walk(x, kidsOf, (y) => order.push(y.a.address)); continue; }
        for (const x of sorted) this.pushAgent(t, rows, order, x, kidsOf, now, 0);
      }
    }
    setAgentOrder(order);
    const counts = { blocked: 0, working: 0 };
    for (const x of list) if (counts[x.a.status] != null) counts[x.a.status]++;
    const icon = (id, name, tip, on) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(t.dim).hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click(on)
      .child(svg(`mods/workspace-chrome/${name}.svg`).size(14));
    return v_flex().id("maestro").size_full().min_h(0).bg(t.chrome).text_size(13).text_color(t.foreground)
      .when(!narrow, (el) => el.child(h_flex().pl(14).pr(8).pt(4).pb(6).gap(2).items_center()
        .child(div().text_size(15).font_semibold().child("Maestro"))
        .child(div().w(8))
        .when(counts.blocked > 0, (e) => e.child(div().px(6).rounded(5).text_size(10.5).font_semibold().bg(t.blocked + "26").text_color(t.blocked).child(`${counts.blocked} need you`)))
        .child(div().flex_1())
        .child(icon("m-new", "folder-plus", "New space", () => run("space.new")))
        .child(icon("m-finished", shared("maestro.showFinished") ? "circle-check" : "clock", shared("maestro.showFinished") ? "Showing finished tasks for 24 h" : "Finished tasks hide after 10 min", () => setShared("maestro.showFinished", !shared("maestro.showFinished"))))
        .child(icon("m-board", "layers", "Board (cmd-shift-b)", () => this.openBoard()))))
      .child(v_flex().id("maestro-list").flex_1().min_h(0).px(narrow ? 0 : 6).pb(8).overflow_y_scrollbar().mode("always")
        .when(spaces().length === 0, (el) => el.child(div().p(12).text_color(t.dim).child("No spaces yet.")))
        .children(rows));
  }

  walk(x, kidsOf, fn) { fn(x); for (const k of kidsOf.get(x.a.address) ?? []) this.walk(k, kidsOf, fn); }
  flat(items, kidsOf) { const out = []; for (const x of items) this.walk(x, kidsOf, (y) => out.push(y)); return out; }
  fold(id, cx) { if (this.folded.has(id)) this.folded.delete(id); else this.folded.add(id); localStorage.setItem("folded", JSON.stringify([...this.folded])); cx.notify(); }

  // Repo, worktree top and branch for a folder, from git, refreshed at most every 20 s.
  gitOf(cwd) { return cwd ? this.git.get(cwd)?.v ?? null : null; }
  refreshGit(list) {
    const now = Date.now();
    const due = [...new Set(list.map((x) => x.cwd).filter(Boolean))].filter((c) => now - (this.git.get(c)?.at ?? 0) > 20000);
    if (!due.length || this.gitBusy) return;
    this.gitBusy = true;
    this.cx?.spawn(async (cx) => {
      for (const c of due) {
        let v = null;
        try {
          const r = await exec("git", ["-C", c, "rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel", "--abbrev-ref", "HEAD"]);
          if (r.code === 0) {
            const [common, top, branch] = r.stdout.trim().split("\n");
            const main = common.replace(/\/\.git\/?$/, "");
            v = { repo: main.split("/").pop(), top, branch, linked: main !== top, tree: main !== top ? top.split("/").pop() : null };
          }
        } catch {}
        this.git.set(c, { v, at: Date.now() });
      }
      this.gitBusy = false;
      cx.notify();
    });
  }

  spaceRow(t, sp, mine, kidsOf) {
    const fid = `sp:${sp.id}`;
    const open = !this.folded.has(fid);
    const all = this.flat(mine, kidsOf);
    const worst = all.reduce((m, x) => (RANK[x.a.status] > RANK[m] ? x.a.status : m), "idle");
    const color = (shared("space.colors") ?? {})[sp.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color] ?? t.accent);
    return h_flex().id(`space-${sp.id}`).mt(6).px(6).h(34).flex_none().gap(8).items_center().rounded(8)
      .when(sp.active, (el) => el.bg(t.selected)).hover((st) => st.bg(sp.active ? t.selected : t.hover))
      .on_click(() => run("space.select", { id: sp.id }))
      .on_mouse_down("right", () => openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: sp.id } } }))
      .child(div().id(`spf-${sp.id}`).size(18).flex_none().flex().items_center().justify_center().rounded(4).border_1().border_color(t.border).text_color(t.dim)
        .hover((st) => st.text_color(t.foreground)).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); this.fold(fid, cx); })
        .child(svg(`mods/workspace-chrome/${open ? "minus" : "plus"}.svg`).size(11)))
      .child(h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...sp.name][0]?.toUpperCase() ?? "?"))
      .child(div().flex_1().min_w(0).truncate().text_size(14).font_semibold().child(sp.name))
      .when(!open && worst !== "idle", (el) => el.child(this.statusDot(t, worst)))
      .when(all.length > 0, (el) => el.child(div().px(6).h(18).rounded(5).bg(t.raised).text_size(11).text_color(t.muted).flex().items_center().child(String(all.length))))
      .child(div().id(`spn-${sp.id}`).size(22).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.dim)
        .hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip("New Copilot here")
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); run("tab.new", { space: sp.id, ...(mine[0]?.cwd ? { folder: mine[0].cwd } : sp.folder ? { folder: sp.folder } : {}), argv: copilotArgv() }); })
        .child(svg("mods/workspace-chrome/plus.svg").size(13)));
  }

  railSpace(t, sp, mine) {
    const worst = mine.reduce((m, x) => (RANK[x.a.status] > RANK[m] ? x.a.status : m), "idle");
    return h_flex().id(`rail-${sp.id}`).h(28).flex_none().justify_center().items_center().gap(4)
      .when(sp.active, (el) => el.bg(t.raised)).hover((st) => st.bg(t.hover))
      .on_click(() => run("space.select", { id: sp.id }))
      .child(div().text_color(sp.active ? t.foreground : t.muted).child([...sp.name][0]?.toUpperCase() ?? "?"))
      .child(this.statusDot(t, worst));
  }

  treeRow(t, fid, tr, kidsOf) {
    const open = !this.folded.has(fid);
    const g = tr.g;
    const where = place(tr.cwd);
    const name = g?.repo ?? where.repo ?? where.org;
    const detail = [g?.branch === "HEAD" ? "detached" : g?.branch, g?.tree].filter(Boolean).join(" · ");
    const n = this.flat(tr.items, kidsOf).length;
    return h_flex().id(fid).mt(4).pl(4).pr(8).py(3).flex_none().gap(8).items_center().rounded(6).hover((st) => st.bg(t.hover))
      .on_click((_e, cx) => this.fold(fid, cx))
      .child(div().w(10).text_size(10).text_color(t.dim).child(open ? "⌄" : "›"))
      .child(svg("mods/workspace-chrome/git-branch.svg").size(15).flex_none().text_color(t.muted))
      .child(v_flex().flex_1().min_w(0)
        .child(div().truncate().text_size(13).font_semibold().child(name))
        .when(Boolean(detail), (el) => el.child(div().truncate().text_size(11).font_family(MONO).text_color(t.dim).child(detail))))
      .child(div().px(6).h(18).rounded(5).bg(t.raised).text_size(11).text_color(t.muted).flex().items_center().child(String(n)));
  }

  // A folded space or worktree: its agents' icons and state cues in one row, each focusing its agent.
  iconCard(t, fid, items) {
    return h_flex().id(`ic-${fid}`).ml(18).mr(4).my(4).px(10).h(40).flex_none().gap(10).items_center().rounded(8).border_1().border_color(t.border)
      .overflow_x_scrollbar()
      .children(items.map((x) => h_flex().id(`ici-${fid}-${x.a.address}`).gap(3).items_center().px(3).rounded(5).hover((st) => st.bg(t.hover))
        .tooltip(this.title(x))
        .on_click(() => this.focus(x))
        .child(this.statusGlyph(t, x, 11))
        .child(this.icon(t, x, 16))))
      .child(div().flex_1())
      .child(div().text_color(t.dim).child("›"));
  }

  pushAgent(t, rows, order, x, kidsOf, now, depth) {
    order.push(x.a.address);
    const tasks = x.s ? treeRows(x.s, now, keepMs()) : [];
    const kids = (kidsOf.get(x.a.address) ?? []).sort((p, q) => RANK[q.a.status] - RANK[p.a.status] || p.a.address.localeCompare(q.a.address, undefined, { numeric: true }));
    rows.push(this.agentCard(t, x, now, depth));
    if (tasks.length) {
      const tid = `tasks:${x.a.address}`;
      const open = !this.folded.has(tid);
      rows.push(h_flex().id(tid).ml(14 + depth * 14).pl(26).py(2).gap(6).items_center().text_size(12).text_color(t.dim).hover((st) => st.text_color(t.foreground))
        .on_click((_e, cx) => this.fold(tid, cx))
        .child(div().w(10).text_size(10).child(open ? "⌄" : "›"))
        .child(`${tasks.length} internal task${tasks.length > 1 ? "s" : ""}`)
        .when(!open, (el) => el.child(h_flex().gap(4).children(tasks.slice(0, 8).map((r) => this.taskGlyph(t, r))))));
      if (open) tasks.forEach((r, i) => rows.push(this.taskRow(t, x, r, now, depth, i === tasks.length - 1)));
    }
    for (const k of kids) this.pushAgent(t, rows, order, k, kidsOf, now, depth + 1);
  }

  focus(x) { run(x.a.pane ? "agent.focus" : "terminal.peek", { terminal: x.a.address }); }
  title(x) { return x.a.handle ?? x.rec.name ?? x.snap?.session_name ?? (x.a.title ?? "").replace(/ - GitHub Copilot$/, "") ?? x.a.address; }
  task(x) {
    const name = x.snap?.session_name || (x.a.title ?? "").replace(/ - GitHub Copilot$/, "");
    return name && name !== this.title(x) ? name : x.a.tab_name ?? "";
  }

  // The session's icon: an agent-chosen Nerd Font glyph and color, else one picked from its name.
  icon(t, x, size = 18) {
    const key = x.rec.icon ?? null;
    const glyph = key ? (ICONS[key] ?? key) : Object.values(ICONS)[hash(x.tagKey) % Object.keys(ICONS).length];
    const color = x.rec.color ?? IDENTITY[hash(x.tagKey + "c") % IDENTITY.length];
    return div().w(size + 4).flex_none().text_center().font_family(NERD).text_size(size).text_color(color).child(glyph);
  }

  statusDot(t, st) { return div().size(7).flex_none().rounded(4).bg(t[st] ?? t.idle); }

  // Working spins; needing you is a ?, failed an ×, done a ✓, idle a ring.
  statusGlyph(t, x, size = 12) {
    const st = x.failed ? "failed" : x.a.status;
    if (st === "working") return svg("mods/workspace-chrome/spinner.svg").size(size).flex_none().text_color(t.working).spin(900);
    if (st === "blocked") return h_flex().size(size + 2).flex_none().rounded(3).bg(t.accent).items_center().justify_center().text_size(size - 2).font_bold().text_color(t.background).child(x.kind === "permission" ? "!" : "?");
    if (st === "failed") return div().flex_none().text_size(size).text_color(t.blocked).child("⊗");
    if (st === "done") return div().flex_none().text_size(size).text_color(t.done).child("✓");
    return div().size(size - 4).mx(2).flex_none().rounded(size).border(1.5).border_color(t.idle ?? t.dim);
  }

  agentCard(t, x, now, depth) {
    const { a, s } = x;
    const failedKids = s ? [...s.agents.values()].filter((g) => g.status === "failed" && now - (g.ended ?? 0) < keepMs()).length : 0;
    const raw = x.kind ?? (s ? attention(s) : null) ?? (failedKids ? `${failedKids} failed` : null);
    const ackKey = `${a.address}:${raw}:${s?.error?.at ?? ""}:${failedKids}`;
    const why = raw && !(shared("maestro.acked") ?? []).includes(ackKey) ? raw : null;
    const tags = [...x.userTags.map((g) => ({ g, mine: true })), ...(x.rec.tags ?? []).map((g) => ({ g, mine: false }))];
    const finished = depth > 0 && (a.status === "done" || a.status === "idle");
    const stop = (_e, cx) => cx.stop_propagation();
    const line = why ? `${why} · ${this.task(x)}` : this.task(x);
    return h_flex().id(`card-${a.address}`).ml(14 + depth * 14).mr(2).my(2).pl(depth ? 8 : 0).flex_none().items_stretch()
      .when(depth > 0, (el) => el.border_l(1).border_color(t.border))
      .child(h_flex().id(`cardb-${a.address}`).flex_1().min_w(0).relative().pl(10).pr(8).py(7).gap(10).items_center().rounded(8).opacity(finished ? 0.6 : 1)
        .bg(a.focused ? t.selected : t.chrome).hover((st) => st.bg(a.focused ? t.selected : t.hover))
        .on_click(() => this.focus(x))
        .when(a.focused, (el) => el.child(div().absolute().left(0).top(6).bottom(6).w(3).rounded(2).bg(t.working)))
        .child(this.icon(t, x, 20))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(h_flex().gap(6).items_center()
            .child(div().flex_1().min_w(0).truncate().text_size(13.5).font_semibold().child(this.title(x)))
            .when(tags.length > 0, (el) => el.child(this.tagChips(t, tags))))
          .child(h_flex().gap(6).items_center()
            .child(this.statusGlyph(t, x, 12))
            .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(why ? t.blocked : t.muted).child(line || "—"))
            .when(Boolean(why), (el) => el.child(div().id(`ack-${a.address}`).px(4).rounded(4).text_size(10.5).text_color(t.dim).hover((st) => st.bg(t.hover).text_color(t.foreground))
              .tooltip("Acknowledge (answers nothing)").on_mouse_down("left", stop)
              .on_click((_e, cx) => { cx.stop_propagation(); setShared("maestro.acked", [...(shared("maestro.acked") ?? []), ackKey].slice(-300)); })
              .child("✓")))))
        .child(this.pet(x, 26)));
  }

  taskGlyph(t, r) {
    if (r.status === "running") return svg("mods/workspace-chrome/spinner.svg").size(11).flex_none().text_color(t.working).spin(900);
    if (r.status === "failed") return div().text_size(12).text_color(t.blocked).child("⊗");
    if (r.status === "cancelled") return div().text_size(12).text_color(t.blocked).child("‖");
    return div().text_size(12).text_color(t.muted).child("✓");
  }

  taskRow(t, x, r, now, depth, last) {
    return h_flex().id(`a-${x.a.address}-${r.id}`).ml(14 + depth * 14).pl(30 + r.depth * 14).pr(10).h(24).flex_none().gap(0).items_center().text_size(12.5)
      .child(div().self_start().w(10).h(last ? 12 : 24).mr(6).flex_none().border_l(1).border_color(t.border)
        .child(div().mt(11).w(8).border_b(1).border_color(t.border)))
      .child(div().flex_1().min_w(0).truncate().text_color(r.status === "running" ? t.foreground : t.muted).child(r.name))
      .child(div().pr(6).text_size(11).text_color(t.dim).child(ago((r.ended ?? now) - r.started)))
      .child(this.taskGlyph(t, r));
  }

  // ---- Pets: Codex-format sprite sheets rendered to one GIF per mood row (pets.mjs) ----
  petMood(x) {
    const preview = (shared("maestro.preview") ?? {})[x.a.address];
    if (preview) return preview;
    if (x.a.status === "blocked") return x.kind === "permission" ? "needs-permission" : "question";
    if (x.failed) return "sad";
    const self = SELF_MOOD[x.rec.mood];
    if (self) return self;
    if (x.a.status === "working") {
      const delegating = x.s ? treeRows(x.s, Date.now(), 0).some((r) => r.status === "running") : false;
      return delegating ? "delegating" : "working";
    }
    if (x.a.status === "done") return "content";
    const since = x.s?.lastPromptAt ?? 0;
    return since && Date.now() - since > 30 * 60_000 ? "sleepy" : "idle";
  }

  petOf(x) {
    const chosen = (shared("maestro.pets") ?? {})[x.tagKey] ?? shared("maestro.pet") ?? "maestro";
    return this.pets.find((p) => p.id === chosen && !p.error) ?? this.pets.find((p) => !p.error) ?? null;
  }

  pet(x, size = 26) {
    const p = this.petOf(x);
    if (!p) return div().w(size).flex_none().text_center().text_size(size * 0.6).child(MOOD[x.rec.mood] ?? "·");
    const rows = MOOD_ROWS[this.petMood(x)] ?? MOOD_ROWS.idle;
    const row = p.moods ? rows[0] : rows[1];
    return image(`data/maestro/pets/${p.id}/${p.rows.includes(row) ? row : 0}.gif`).w(size).h(Math.round(size * 104 / 96)).flex_none();
  }

  tagChips(t, tags) {
    return h_flex().flex_none().gap(4).children(tags.slice(0, 3).map(({ g, mine }) => {
      const c = IDENTITY[hash(g) % IDENTITY.length];
      return div().px(5).h(16).flex().items_center().rounded(3).border_1().border_dashed().border_color(mine ? "#11111b" : c)
        .bg(mine ? c : c + "22").text_size(10.5).font_medium().text_color(mine ? "#11111b" : c).child(g);
    }));
  }

  // Pinned card for the focused agent.
  footer(t, list, now) {
    const f = focused();
    const x = list.find((y) => y.a.address === f?.terminal) ?? list.find((y) => y.a.focused);
    if (!x) return div().size_full().bg(t.chrome);
    const { a, snap, s } = x;
    const sched = s ? [...s.schedules.values()] : [];
    const cost = snap?.cost;
    const model = snap?.model?.display_name ?? s?.model ?? s?.lastModel ?? null;
    const effort = s?.effort ?? null;
    const ctx = snap?.context_window?.used_percentage;
    const up = cost?.total_duration_ms;
    const g = this.gitOf(x.cwd);
    const kv = (k, v, mono = false) => v == null || v === "" ? null : v_flex().gap(0)
      .child(div().text_size(11).text_color(t.dim).child(k))
      .child(div().truncate().text_size(12).text_color(t.foreground).when(mono, (el) => el.font_family(MONO)).child(String(v)));
    const petId = this.petOf(x)?.id;
    const cyclePet = () => {
      const ok = this.pets.filter((p) => !p.error);
      if (!ok.length) return;
      const i = ok.findIndex((p) => p.id === petId);
      setShared("maestro.pets", { ...(shared("maestro.pets") ?? {}), [x.tagKey]: ok[(i + 1) % ok.length].id });
    };
    return v_flex().id("maestro-footer").size_full().min_h(0).overflow_y_scrollbar().px(12).pt(10).pb(10).gap(8).bg(t.chrome)
      .child(h_flex().gap(12).items_center()
        .child(div().id("pet-box").size(64).flex_none().rounded(10).border_1().border_color(t.border).bg(t.surface).flex().items_center().justify_center()
          .tooltip(`${this.petOf(x)?.name ?? "No pet"} · ${this.petMood(x)} — click for another pet`)
          .on_click(cyclePet)
          .child(this.pet(x, 52)))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(div().truncate().text_size(14).font_semibold().child(this.title(x)))
          .child(h_flex().gap(6).items_center().child(this.statusGlyph(t, x, 11))
            .child(div().truncate().text_size(12).text_color(t.muted).child([STATUS_WORD[x.failed ? "failed" : a.status], a.address, a.parent ? `child of ${a.parent}` : null].filter(Boolean).join(" · "))))
          .when(Boolean(model), (el) => el.child(div().truncate().text_size(12).text_color(t.dim).child(effort && !model.includes(" · ") ? `${model} · ${effort}` : model)))))
      .child(h_flex().gap(8).text_size(11.5).text_color(t.muted)
        .child(div().child(ctx != null ? `${ctx}% context` : ""))
        .child(div().flex_1().text_center().child(up != null ? `${ago(up)} elapsed` : ""))
        .when(Boolean(cost), (el) => el.child(h_flex().gap(4)
          .child(div().child(`${snap.ai_used?.formatted ?? "?"} AIC`))
          .child(div().text_color(t.ansi2 ?? t.done).child(`+${cost.total_lines_added ?? 0}`))
          .child(div().text_color(t.ansi1 ?? t.blocked).child(`−${cost.total_lines_removed ?? 0}`)))))
      .child(div().truncate().text_size(11).font_family(MONO).text_color(t.dim)
        .child([g?.branch ?? x.branch, x.cwd ? x.cwd.replace(home(), "~") : null].filter(Boolean).join(" · ")))
      .child(h_flex().gap(4).items_center()
        .child(this.tagChips(t, [...x.userTags.map((g) => ({ g, mine: true })), ...(x.rec.tags ?? []).map((g) => ({ g, mine: false }))]))
        .child(div().id("edit-tags").px(6).rounded(4).text_size(11).text_color(t.dim).hover((st) => st.bg(t.hover).text_color(t.foreground))
          .on_click(() => openOverlay({ kind: "dialog", mod: "maestro-tags", props: { key: x.tagKey, label: snap?.session_name ?? a.address } }))
          .child("Edit tags…"))
        .child(div().flex_1())
        .child(div().id("mood-preview").px(6).rounded(4).text_size(11).text_color(t.dim).hover((st) => st.bg(t.hover).text_color(t.foreground))
          .tooltip("Cosmetic: cycle the pet's moods")
          .on_click(() => {
            const p = { ...(shared("maestro.preview") ?? {}) };
            const moods = Object.keys(MOOD_ROWS);
            const i = moods.indexOf(p[a.address]);
            if (i === moods.length - 1) delete p[a.address]; else p[a.address] = moods[i + 1];
            setShared("maestro.preview", p);
          })
          .child((shared("maestro.preview") ?? {})[a.address] ? `mood: ${(shared("maestro.preview") ?? {})[a.address]}` : "Moods…")))
      .children([kv("Session ID", x.id, true)].filter(Boolean))
      .when(sched.length > 0, (el) => el.child(v_flex().gap(2)
        .child(div().text_size(11).text_color(t.dim).child(`Beats ${sched.length}`))
        .children(sched.map((b) => {
          const n = nextRun(b, now);
          return h_flex().id(`beat-${b.id}`).gap(6).text_size(11)
            .child(div().text_color(t.working).child("⟳"))
            .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(b.prompt))
            .child(div().text_color(t.dim).child([cadence(b), b.runs ? `${b.runs} runs` : null, n ? `next ${n > now ? "in " + ago(n - now) : "due"}` : null].filter(Boolean).join(" · ")));
        }))));
  }

  openBoard() {
    openOverlay({ kind: "window", mod: "maestro", props: { view: "board" }, key: "maestro-board", width: 1180, height: 640 });
  }

  openTags() {
    const f = focused();
    const x = this.sessions().find((y) => y.a.address === f?.terminal);
    if (x) openOverlay({ kind: "dialog", mod: "maestro-tags", props: { key: x.tagKey, label: x.snap?.session_name ?? x.a.address } });
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

}
