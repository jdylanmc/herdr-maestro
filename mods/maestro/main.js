// Maestro: Copilot sessions in Herdr, with their subagent trees, metrics and attention.
// Bindings come from the status-line bridge (bin/maestro-statusline), else from the
// session lock's process ancestry. Trees and attention come from each session's events.jsonl.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, HoverCard } from "gpui-base";
import { agents, terminals, panes, spaces, layout, run, theme, shared, setShared, exec, hc, home, appHome, watchFolder, setAgentOrder, readTextFile, writeTextFile, focused, notify, openOverlay, closeOverlay, props, nextCommand, themes, playSound, pickFolder, settings } from "herdr";
import * as fs from "fs/promises";
import { emptySession, applyLines, treeRows, attention, nextRun, cadence } from "./log.js";
import { parseRead, screenLines, promptLine } from "./screen.js";
import { liveAgents } from "./live.js";
import { pinFirst, alertStep, NEEDS_YOU } from "./alerts.js";
import { MOOD_ROWS, petRoots, parseChoices, setChoice, mergeChoices, chosenPet, resolvePet } from "./petlib.js";
import { nestSpaces, spacePlace } from "./wtlib.js";

const KEEP_FINISHED_MS = 10 * 60_000;
const keepMs = () => (shared("maestro.showFinished") ? 24 * 3600_000 : KEEP_FINISHED_MS);
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const PROJECTIONS = [{ id: "worktrees", label: "Worktrees" }, { id: "subagents", label: "Sub-agents" }, { id: "workspace", label: "Workspace" }];
const STATUS_WORD = { working: "Working", blocked: "Waiting on you", done: "Done", idle: "Idle", failed: "Failed" };
const NERD = "JetBrainsMono Nerd Font Mono";
const MONO = "JetBrainsMono Nerd Font Mono";
// Session icons: Nerd Font glyphs an agent picks with `maestro icon <name>`; others get one by name.
const ICONS = {
  robot: "\u{F06A9}", code: "\u{F121}", bug: "\u{F188}", eye: "\u{F06E}", shield: "\u{F132}", compass: "\u{F14E}",
  brush: "\u{F1FC}", flask: "\u{F0C3}", rocket: "\u{F135}", cogs: "\u{F085}", search: "\u{F002}", book: "\u{F02D}",
  terminal: "\u{F120}", wrench: "\u{F0AD}", lightbulb: "\u{F0EB}", heart: "\u{F004}", star: "\u{F005}", bolt: "\u{F0E7}",
};
// Identity colors come from the active Herdr theme, so icons and tags follow theme changes.
const palette = (t) => [t.ansi6, t.ansi3, t.ansi4, t.ansi5, t.ansi2, t.ansi1].filter(Boolean);
const themed = (t, c) => (c && !c.startsWith("#") ? t[c] : c);
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619); return h >>> 0; };
const find = (node, id) => { if (node?.id === id) return node; for (const c of node?.children ?? []) { const f = find(c, id); if (f) return f; } return null; };
// `maestro mood` words to pet moods.
const SELF_MOOD = { happy: "proud", focused: "working", thinking: "thinking", proud: "proud", confused: "confused", stuck: "confused", sleepy: "sleepy", celebrating: "celebrating" };

const dataDir = () => `${appHome()}/data/maestro`;
const snapDir = () => `${dataDir()}/terminals`;
const agentDir = () => `${dataDir()}/agents`;
const notifyDir = () => `${dataDir()}/notify`;
const petDir = () => `${dataDir()}/pets`;
const choicesPath = () => `${petDir()}/choices.json`;
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

const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

function ago(ms) {
  if (ms == null || Number.isNaN(ms)) return "";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

// Board or pokedex as a mod pane: its own tab, or split beside the focused pane. props.place marks it.
function openModPane(mod, name, extra, how) {
  const props = { ...extra, place: "pane" };
  if (how === "tab") { run("tab.new", { name, mod, props }); return; }
  const f = focused();
  const pane = f?.pane ?? panes().find((p) => p.tab === f?.tab && p.focused)?.pane ?? panes().find((p) => p.tab === f?.tab)?.pane;
  run("pane.split", { direction: "right", mod, props, ...(pane ? { pane } : {}) });
}

// Pane controls let the native press focus their host before the click closes it.
function closeModPane(mod) {
  const all = panes();
  const p = all.find((q) => q.pane === focused()?.pane && q.mod === mod && q.terminal == null);
  if (!p) return;
  if (all.filter((q) => q.tab === p.tab).length === 1) run("tab.close", { id: p.tab });
  else run("pane.close", { pane: p.pane });
}

export default class Maestro extends View {
  init(_props, cx) {
    this.snaps = new Map();     // terminal address -> status-line payload
    this.fallback = new Map();  // terminal address -> session id (process ancestry)
    this.logs = new Map();      // session id -> { s, offset, path, busy }
    this.collapsed = new Set(); // terminal addresses whose subagent tree is folded
    this.records = new Map();   // terminal address -> agent-written record (parent, tags, mood, name)
    this.view = props()?.view ?? "list"; // list (sidebar), footer (focused agent), board (window), themes (popup)
    this.board = this.view === "board";
    this.primary = this.view === "list";
    this.kbToken = shared("maestro.kbFocus");
    this.cx = cx;
    this.handle = cx.focus_handle();
    if (this.view === "themes") { this.handle.focus(); cx.timer.after(400, () => this.handle.focus()); return; }
    this.folded = new Set(JSON.parse(localStorage.getItem("folded") ?? "[]"));
    this.git = new Map();       // folder -> { v: { repo, top, branch, tree }, at }
    this.pets = [];             // rendered pets (data/maestro/pets/index.json)
    this.choices = null;        // data/maestro/pets/choices.json, once read
    this.screens = new Map();   // terminal address -> { lines, prompt, at, busy }; memory only, never written
    cx.spawn(async (cx) => { await this.loadPets(); cx.notify(); });
    cx.spawn(async (cx) => {
      for (const d of [snapDir(), agentDir(), notifyDir()]) await fs.mkdir(d, { recursive: true }).catch(() => {});
      await this.refresh();
      cx.notify();
      for (;;) {
        const changed = await watchFolder(dataDir());
        if (changed.some((p) => p === dataDir() || p.startsWith(petDir()))) await this.readPets();
        await this.refresh();
        cx.notify();
      }
    });
    if (this.primary) cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "board") this.openBoard();
        else if (c === "tags") this.openTags();
        else if (c === "pets") this.openPets();
        else if (c === "focus") await this.keyboard(cx);
        cx.notify();
      }
    });
    else cx.spawn(async (cx) => {
      // Only "focus" (pane.go onto this copy, mod.json "focusable"); the list owns key commands.
      for (;;) {
        if ((await nextCommand()) !== "focus") continue;
        if (this.view === "footer") setShared("maestro.kbFocus", Date.now());
        else this.handle.focus();
        cx.notify();
      }
    });
    cx.timer.every(3000, (cx) => cx.spawn(async (cx) => { await this.tailAll(); cx.notify(); }));
    if (this.primary) { this.alertMem = new Map(); cx.timer.every(1000, () => this.alertTick()); }
    cx.timer.every(15000, (cx) => cx.spawn(async (cx) => { await this.bindByAncestry(); await this.tailAll(); cx.notify(); }));
  }

  // Codex pets (~/.codex/pets), cmux Maestro's own and added ones (data/maestro/pet-sources),
  // rendered to per-mood GIFs by a detached helper; the last index.json shows meanwhile.
  async loadPets() {
    await this.readPets();
    if (!this.primary) return;
    try { await helper("pets", "--bg", petDir(), ...petRoots(home(), dataDir())); } catch {}
  }

  async readPets() {
    try { const v = JSON.parse(await readTextFile(`${petDir()}/index.json`)); if (Array.isArray(v)) this.pets = v; } catch {}
    await this.loadChoices();
  }

  // choices.json is the durable record (agents write it with `maestro pet use`); shared()
  // is the live cache every copy and the footer read. File entries win when they change.
  async loadChoices() {
    let text = null;
    try { text = await readTextFile(choicesPath()); } catch {}
    const previous = this.choices;
    this.choices = parseChoices(text);
    const cache = { default: shared("maestro.pet") ?? null, sessions: shared("maestro.pets") ?? {} };
    const next = mergeChoices(cache, this.choices, previous);
    if (JSON.stringify(next.sessions) !== JSON.stringify(parseChoices(cache).sessions)) setShared("maestro.pets", next.sessions);
    if (next.default && next.default !== cache.default) setShared("maestro.pet", next.default);
  }

  // Records one choice (key null: the default) in choices.json and the live cache.
  async saveChoice(key, id) {
    if (key == null) setShared("maestro.pet", id);
    else { const s = { ...(shared("maestro.pets") ?? {}) }; if (id == null) delete s[key]; else s[key] = id; setShared("maestro.pets", s); }
    for (let i = 0; i < 3; i++) {
      let before = null;
      try { before = await readTextFile(choicesPath()); } catch {}
      const next = setChoice(parseChoices(before), key, id);
      try { await fs.mkdir(petDir(), { recursive: true }); await writeTextFile(choicesPath(), JSON.stringify(next, null, 1), before); this.choices = next; return; } catch {}
    }
  }

  // Board and pets replace the terminals in the main area (layout stack "work-stack");
  // again shows the terminals. Layouts without the stack open them as windows.
  showView(child, overlay) {
    const stack = find(layout(), "work-stack");
    if (!stack) { openOverlay(overlay); return; }
    run("layout.select", { stack: "work-stack", child: stack.active === child ? "main" : child });
  }

  openPets() {
    this.showView("maestro-pets", { kind: "window", mod: "maestro-pets", key: "maestro-pets", width: 980, height: 680 });
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
    // Other views (the pet pokedex) key sessions the same way: session id, else terminal.
    if (this.primary) {
      const keys = Object.fromEntries(this.live().map((a) => [a.address, this.sessionFor(a.address) ?? a.address]));
      if (JSON.stringify(keys) !== JSON.stringify(shared("maestro.sessionKeys") ?? {})) setShared("maestro.sessionKeys", keys);
    }
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

  // Agents with panes, plus pane-less workers shaped like AgentInfo.
  live() {
    return liveAgents(agents(), terminals(), this.records);
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
    if (this.view === "themes") return this.renderThemes(t);
    const now = Date.now();
    const list = this.sessions();
    if (this.view !== "footer") this.watchBlocked(list);
    if (this.board) return this.renderBoard(t, list, now);
    if (this.view === "footer") return this.footer(t, list, now);
    this.refreshGit([...list, ...spaces().map((sp) => ({ cwd: spacePlace(sp, panes()) }))]);
    this.keyboardState();
    this.nav = [];
    const proj = PROJECTIONS.some((p) => p.id === shared("maestro.projection")) ? shared("maestro.projection") : "worktrees";
    const hide = shared("maestro.hideFinished") ?? {};
    const every = new Map(list.map((x) => [x.a.address, x]));
    // Hiding finished agents in a space hides its idle or done workers (agents with a live parent); failures stay.
    const shown = list.filter((x) => !(hide[x.a.space] && x.a.parent && x.a.parent !== x.a.address && every.has(x.a.parent)
      && (x.a.status === "idle" || x.a.status === "done") && !x.failed));
    const byAddr = new Map(shown.map((x) => [x.a.address, x]));
    const wt = (x) => this.gitOf(x.cwd)?.top ?? x.cwd ?? "?";
    const kidsOf = new Map();
    const nested = new Set();
    for (const x of shown) {
      const p = byAddr.get(x.a.parent);
      if (!p || p === x || proj === "workspace" || (proj === "worktrees" && wt(p) !== wt(x))) continue;
      if (!kidsOf.has(p.a.address)) kidsOf.set(p.a.address, []);
      kidsOf.get(p.a.address).push(x);
      nested.add(x.a.address);
    }
    const roots = shown.filter((x) => !nested.has(x.a.address));
    const urgent = (p, q) => pinFirst(p.a, q.a) || RANK[q.a.status] - RANK[p.a.status] || p.a.seq - q.a.seq;
    const order = [];
    const rows = [];
    const narrow = (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;
    for (const { sp, tree } of this.nestedSpaces()) {
      const mine = roots.filter((x) => x.a.space === sp.id);
      this.nav.push({ key: `sp:${sp.id}`, space: sp });
      if (narrow) { for (const x of mine) this.walk(x, kidsOf, (y) => order.push(y.a.address)); rows.push(this.navRow(t, `sp:${sp.id}`, this.railSpace(t, sp, mine))); continue; }
      rows.push(this.navRow(t, `sp:${sp.id}`, this.spaceRow(t, sp, mine, kidsOf, tree), { top: 6, bottom: 5 }));
      if (this.folded.has(`sp:${sp.id}`)) {
        if (mine.length) rows.push(this.iconCard(t, `sp:${sp.id}`, this.flat(mine, kidsOf)));
        for (const x of mine) this.walk(x, kidsOf, (y) => order.push(y.a.address));
        continue;
      }
      if (proj !== "worktrees") {
        const group = [];
        for (const x of mine.sort(urgent)) this.pushAgent(t, group, order, x, kidsOf, now, 0);
        if (group.length) rows.push(this.guide(t, `g-${sp.id}`, 15, group));
        continue;
      }
      const trees = new Map();
      for (const x of mine) {
        const k = wt(x);
        if (!trees.has(k)) trees.set(k, { g: this.gitOf(x.cwd), cwd: x.cwd, items: [] });
        trees.get(k).items.push(x);
      }
      for (const [k, tr] of trees) {
        const fid = `wt:${sp.id}:${k}`;
        const sorted = tr.items.sort(urgent);
        const group = [];
        const at = this.nav.length;
        if (this.folded.has(fid)) { group.push(this.iconCard(t, fid, this.flat(sorted, kidsOf))); for (const x of sorted) this.walk(x, kidsOf, (y) => order.push(y.a.address)); }
        else for (const x of sorted) this.pushAgent(t, group, order, x, kidsOf, now, 0);
        this.nav.splice(at, 0, { key: fid });
        rows.push(this.navRow(t, fid, this.treeRow(t, fid, tr, kidsOf), { top: 4 }));
        rows.push(this.guide(t, `g-${fid}`, 9, group));
      }
    }
    setAgentOrder(order);
    if (this.kb && !this.nav.some((n) => n.key === this.cursor)) this.cursor = this.nav[0]?.key ?? null;
    const counts = { blocked: 0, working: 0 };
    for (const x of list) if (counts[x.a.status] != null) counts[x.a.status]++;
    const icon = (id, name, tip, on) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(t.dim).hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click(on)
      .child(svg(name.includes("/") ? name : `mods/workspace-chrome/${name}.svg`).size(14));
    return v_flex().id("maestro").when(this.kb, (el) => el.track_focus(this.handle).on_key_down((e, cx) => this.navKey(e, cx))).size_full().min_h(0).bg(t.chrome).text_size(13).text_color(t.foreground)
      .when(!narrow, (el) => el.child(h_flex().pl(14).pr(8).pt(4).pb(6).gap(2).items_center()
        .child(div().text_size(15).font_semibold().child("Maestro"))
        .child(div().w(8))
        .when(counts.blocked > 0, (e) => e.child(div().px(6).rounded(5).text_size(10.5).font_semibold().bg(t.blocked + "26").text_color(t.blocked).child(`${counts.blocked} need you`)))
        .child(div().flex_1())
        .child(icon("m-new", "folder-plus", "New space", () => run("space.new")))
        .child(this.alertToggles(t))
        .child(icon("m-finished", shared("maestro.showFinished") ? "circle-check" : "clock", shared("maestro.showFinished") ? "Showing finished tasks for 24 h" : "Finished tasks hide after 10 min", () => setShared("maestro.showFinished", !shared("maestro.showFinished"))))
        .child(icon("m-theme", "mods/maestro/palette.svg", "Theme", () => this.openThemes()))
        .child(icon("m-board", "layers", "Board (cmd-shift-b)", () => this.openBoard()))))
      .when(!narrow, (el) => el.child(this.segments(t, proj)))
      .child(v_flex().id("maestro-list").flex_1().min_h(0).px(narrow ? 0 : 6).pb(8).overflow_y_scrollbar().mode("always")
        .when(spaces().length === 0, (el) => el.child(div().p(12).text_color(t.dim).child("No spaces yet.")))
        .children(rows))
      .when(!narrow, (el) => el.child(this.attentionStrip(t, list)));
  }

  // Projection switch: Worktrees | Sub-agents | Workspace, shared across views.
  segments(t, proj) {
    return h_flex().id("m-proj").mx(10).mb(6).p(2).h(28).flex_none().gap(2).rounded(7).bg(t.surface).border_1().border_color(t.border)
      .children(PROJECTIONS.map((p) => div().id(`proj-${p.id}`).flex_1().h_full().flex().items_center().justify_center().rounded(5)
        .text_size(12).font_medium().cursor_pointer()
        .when(p.id === proj, (el) => el.bg(t.raised).text_color(t.foreground))
        .when(p.id !== proj, (el) => el.text_color(t.dim).hover((st) => st.text_color(t.foreground)))
        .on_click(() => setShared("maestro.projection", p.id))
        .child(p.label)));
  }

  // Opt-in chime and worker-tab settling; right-click the bell for Herdr's own alert settings.
  alertToggles(t) {
    const sounds = Boolean(shared("maestro.sounds"));
    const settle = Boolean(shared("maestro.autoSettle"));
    const toggle = (id, on, tip, child, click, right) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(on ? t.accent : t.dim).hover((st) => st.bg(t.hover).text_color(on ? t.accent : t.foreground)).tooltip(tip).on_click(click)
      .when(Boolean(right), (el) => el.on_mouse_down("right", right)).child(child);
    return h_flex().flex_none().gap(2)
      .child(toggle("m-sounds", sounds, `${sounds ? "Chiming" : "Chime"} when an agent starts needing you and Herdr's own sound doesn't (right-click: Herdr's alert settings)`,
        div().font_family(NERD).text_size(14).child(sounds ? "\u{F0F3}" : "\u{F1F6}"),
        () => setShared("maestro.sounds", !sounds), () => run("app.settings", { section: "alerts" })))
      .child(toggle("m-settle", settle, settle ? "Settling finished workers' tabs (tab.next/prev skip them)" : "Settle a Maestro worker's tab when it finishes",
        svg("mods/workspace-chrome/archive.svg").size(14), () => setShared("maestro.autoSettle", !settle)));
  }

  // Primary view only: chime once per transition into needing you, settle or unsettle workers' tabs.
  alertTick() {
    const sounds = Boolean(shared("maestro.sounds"));
    const settle = Boolean(shared("maestro.autoSettle"));
    if (!sounds && !settle) { this.alertMem.clear(); return; }
    const tabs = new Map(spaces().flatMap((sp) => sp.tabs ?? []).map((tb) => [tb.id, tb]));
    const labels = new Map(terminals().map((k) => [k.address, k.labels ?? {}]));
    const herdrSounds = settings()?.sounds?.enabled !== false;
    const items = this.sessions().map((x) => ({
      address: x.a.address,
      tab: x.a.pane ? x.a.tab ?? null : null,
      status: x.a.status,
      needs: x.a.status === "blocked" || NEEDS_YOU.has(x.s ? attention(x.s) : null),
      herdrChimes: herdrSounds && Boolean(x.a.pane) && x.a.status === "blocked",
      worker: Boolean(x.rec.launcher ?? labels.get(x.a.address)?.["maestro.parent"]),
      tabSettled: Boolean(tabs.get(x.a.tab)?.settled),
    }));
    for (const act of alertStep(this.alertMem, items, Date.now(), { sounds, settle, debounceMs: 2500 })) {
      try {
        if (act.type === "sound") playSound("blocked");
        else run(act.type === "settle" ? "tab.settle" : "tab.unsettle", { id: act.tab });
      } catch {}
    }
  }

  newInFolder(sp) {
    this.cx?.spawn(async () => {
      let folder = null;
      try { folder = await pickFolder({ prompt: "Start Copilot" }); } catch {}
      if (folder) run("tab.new", { space: sp.id, folder, argv: copilotArgv() });
    });
  }

  // Pin toggle while the card is hovered (Herdr's terminal.pin, shared with its agent list); a pin glyph otherwise.
  pinControl(t, x) {
    const pinned = Boolean(x.a.pinned);
    if (this.hovered !== x.a.address) return pinned ? svg("mods/workspace-chrome/pin.svg").size(11).flex_none().text_color(t.dim) : div();
    return div().id(`pin-${x.a.address}`).flex_none().p(2).rounded(4).text_color(t.dim).cursor_pointer()
      .hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip(pinned ? "Unpin" : "Pin to the top")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); run("terminal.pin", { terminal: x.a.address, pinned: !pinned }); this.hovered = null; cx.notify(); })
      .child(svg(`mods/workspace-chrome/${pinned ? "pin-off" : "pin"}.svg`).size(13));
  }

  // Cards of one group hang off a vertical outline line.
  guide(t, id, ml, rows) {
    return v_flex().id(id).ml(ml).flex_none().border_l(1).border_color(t.border).children(rows);
  }

  // Agents waiting on the human, pinned under the list; click focuses.
  attentionStrip(t, list) {
    const waiting = list.filter((x) => x.a.status === "blocked").map((x) => ({ x, why: x.kind ?? (x.s ? attention(x.s) : null) }));
    if (!waiting.length) return div();
    const title = waiting.every((w) => w.why === "question") ? "Quick question" : "Waiting on you";
    return v_flex().id("m-attn").flex_none().max_h(180).overflow_y_scrollbar().px(8).pt(6).pb(6).gap(2).border_t(1).border_color(t.border)
      .child(h_flex().px(4).pb(2).gap(6).items_center()
        .child(div().size(7).rounded(4).bg(t.blocked))
        .child(div().text_size(12).font_semibold().text_color(t.blocked).child(title))
        .child(div().text_size(11).text_color(t.dim).child(String(waiting.length))))
      .children(waiting.map(({ x, why }) => h_flex().id(`attn-${x.a.address}`).px(4).py(3).gap(8).items_center().rounded(6)
        .hover((st) => st.bg(t.hover)).on_click(() => this.focus(x)).tooltip(this.task(x) || this.title(x))
        .child(this.icon(t, x, 15))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_medium().child(this.title(x)))
        .child(div().flex_none().px(5).rounded(4).text_size(10.5).bg(t.blocked + "26").text_color(t.blocked).child(why ?? "input"))));
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
            v = { repo: main.split("/").pop(), main, top, branch, linked: main !== top, tree: main !== top ? top.split("/").pop() : null };
          }
        } catch {}
        this.git.set(c, { v, at: Date.now() });
      }
      this.gitBusy = false;
      cx.notify();
    });
  }

  // Spaces in Herdr's order, worktree spaces under their repo's main-checkout space (as Herdr's spaces list).
  nestedSpaces() {
    const ps = panes();
    return nestSpaces(spaces().map((sp) => ({ id: sp.id, sp, g: this.gitOf(spacePlace(sp, ps)) })));
  }

  spaceRow(t, sp, mine, kidsOf, tree = null) {
    const fid = `sp:${sp.id}`;
    const open = !this.folded.has(fid);
    const all = this.flat(mine, kidsOf);
    const worst = all.reduce((m, x) => (RANK[x.a.status] > RANK[m] ? x.a.status : m), "idle");
    const color = (shared("space.colors") ?? {})[sp.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color] ?? t.accent);
    const hidden = Boolean((shared("maestro.hideFinished") ?? {})[sp.id]);
    const stop = (_e, cx) => cx.stop_propagation();
    const btn = (id, tip, on, child) => div().id(`${id}-${sp.id}`).size(22).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.dim)
      .hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_mouse_down("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); on(); }).child(child);
    const menu = () => openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: sp.id } } });
    const g = this.gitOf(spacePlace(sp, panes()));
    return v_flex().mt(tree ? 2 : 6).flex_none().when(Boolean(tree), (el) => el.ml(14)).child(h_flex().id(`space-${sp.id}`).px(6).h(34).flex_none().gap(8).items_center().rounded(8)
      .when(sp.active, (el) => el.bg(t.selected)).hover((st) => st.bg(sp.active ? t.selected : t.hover))
      .on_click(() => run("space.select", { id: sp.id }))
      .on_mouse_down("right", menu)
      .child(div().id(`spf-${sp.id}`).size(18).flex_none().flex().items_center().justify_center().rounded(4).border_1().border_color(t.border).text_color(t.dim)
        .hover((st) => st.text_color(t.foreground)).on_mouse_down("left", stop)
        .on_click((_e, cx) => { cx.stop_propagation(); this.fold(fid, cx); })
        .child(svg(`mods/workspace-chrome/${open ? "minus" : "plus"}.svg`).size(11)))
      .when(Boolean(tree), (el) => el.child(svg("mods/workspace-chrome/branch.svg").size(14).flex_none().text_color(t.dim)))
      .when(!tree, (el) => el.child(h_flex().size(16).flex_none().rounded(4).bg(fill).items_center().justify_center().text_size(10).font_bold().text_color("#ffffff").child([...sp.name][0]?.toUpperCase() ?? "?")))
      .child(div().flex_1().min_w(0).truncate().text_size(tree ? 14 : 15).font_bold().child(sp.name))
      .when(!open && worst !== "idle", (el) => el.child(this.statusDot(t, worst)))
      .when(all.length > 0, (el) => el.child(div().px(6).h(18).rounded(5).bg(t.raised).text_size(11).text_color(t.muted).flex().items_center().child(String(all.length))))
      .child(btn("sph", hidden ? "Show finished agents" : "Hide finished agents", () => setShared("maestro.hideFinished", { ...(shared("maestro.hideFinished") ?? {}), [sp.id]: !hidden }),
        svg("mods/maestro/eye-off.svg").size(13).when(hidden, (el) => el.text_color(t.accent))))
      .child(btn("sps", "Go to space", () => run("space.select", { id: sp.id }), div().text_size(13).child("↗")))
      .when(Boolean(g), (el) => el.child(btn("spw", "Worktrees", () => this.toggleWorktreeMenu(sp, g), svg("mods/workspace-chrome/git-branch.svg").size(13)
        .when(this.wtMenu?.id === sp.id, (e) => e.text_color(t.accent)))))
      .child(btn("spm", "Space menu", menu, div().text_size(13).font_bold().child("…")))
      .child(btn("spn", "New Copilot here", () => run("tab.new", { space: sp.id, ...(mine[0]?.cwd ? { folder: mine[0].cwd } : sp.folder ? { folder: sp.folder } : {}), argv: copilotArgv() }),
        svg("mods/workspace-chrome/plus.svg").size(13)))
      .when(!sp.machine, (el) => el.child(btn("spf", "New Copilot in folder…", () => this.newInFolder(sp), svg("mods/workspace-chrome/folder.svg").size(13)))))
      .when(Boolean(g) && this.wtMenu?.id === sp.id, (el) => el.child(this.worktreeMenu(t, sp, g)))
      .child(div().mx(6).mt(4).h(1).flex_none().bg(t.border));
  }

  // The space's worktree actions, as Herdr's space menu: each opens Herdr's worktree dialog.
  toggleWorktreeMenu(sp, g) {
    if (this.wtMenu?.id === sp.id) { this.wtMenu = null; this.cx?.notify(); return; }
    const m = { id: sp.id, dirty: null };
    this.wtMenu = m;
    const at = spacePlace(sp, panes());
    if (g.linked && at) this.cx?.spawn(async (cx) => {
      try { const r = await exec("git", ["-C", at, "--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"]); m.dirty = r.code === 0 ? r.stdout.trim() !== "" : true; } catch { m.dirty = true; }
      cx.notify();
    });
    this.cx?.notify();
  }

  openWorktree(sp, action) {
    this.wtMenu = null;
    openOverlay({ mod: "worktree", kind: "dialog", ...(action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }),
      props: { space: sp.id, folder: spacePlace(sp, panes()) ?? undefined, action } });
  }

  // Remove only a linked checkout that is clean and has no agent in its space.
  worktreeMenu(t, sp, g) {
    const m = this.wtMenu;
    const agents = this.sessions().filter((x) => x.a.space === sp.id).length;
    const why = !g.linked ? null : agents ? `${agents} agent${agents > 1 ? "s" : ""} still in it` : m.dirty == null ? "checking…" : m.dirty ? "uncommitted changes" : null;
    const item = (id, label, on, off) => h_flex().id(`spw-${id}-${sp.id}`).px(8).h(26).gap(8).items_center().rounded(6).text_size(12.5)
      .when(!off, (el) => el.cursor_pointer().text_color(t.foreground).hover((st) => st.bg(t.hover)).on_click((_e, cx) => { cx.stop_propagation(); on(); }))
      .when(Boolean(off), (el) => el.text_color(t.dim).tooltip(`Can't remove: ${off}`))
      .child(svg("mods/workspace-chrome/git-branch.svg").size(12).flex_none().text_color(t.dim))
      .child(div().flex_1().child(label))
      .when(Boolean(off), (el) => el.child(div().text_size(11).text_color(t.dim).child(off)));
    return v_flex().id(`spw-menu-${sp.id}`).mx(6).mt(2).p(3).flex_none().rounded(7).border_1().border_color(t.border).bg(t.surface)
      .child(item("new", "New worktree", () => this.openWorktree(sp, "new")))
      .child(item("open", "Open worktree", () => this.openWorktree(sp, "open")))
      .when(g.linked, (el) => el.child(item("rm", "Remove worktree", () => this.openWorktree(sp, "remove"), why)));
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
    const kids = (kidsOf.get(x.a.address) ?? []).sort((p, q) => pinFirst(p.a, q.a) || RANK[q.a.status] - RANK[p.a.status] || p.a.address.localeCompare(q.a.address, undefined, { numeric: true }));
    this.nav?.push({ key: `ag:${x.a.address}`, x, tasks: tasks.length ? `tasks:${x.a.address}` : null });
    rows.push(this.navRow(t, `ag:${x.a.address}`, this.agentCard(t, x, now, depth), { left: 14 + depth * 14, right: 2, top: 2, bottom: 2 }));
    if (tasks.length) {
      const tid = `tasks:${x.a.address}`;
      const open = !this.folded.has(tid);
      rows.push(h_flex().id(tid).ml(14 + depth * 14).pl(26).py(2).gap(6).items_center().text_size(12).text_color(t.dim).hover((st) => st.text_color(t.foreground))
        .on_click((_e, cx) => this.fold(tid, cx))
        .child(div().w(10).text_size(10).child(open ? "⌄" : "›"))
        .child(`${tasks.length} subagent${tasks.length > 1 ? "s" : ""}`)
        .children(["running", "idle", "failed"].map((st) => [st, tasks.filter((r) => r.status === st).length]).filter(([, n]) => n)
          .map(([st, n]) => div().text_color(st === "running" ? t.working : st === "failed" ? t.blocked : t.dim).child(`· ${n} ${st}`)))
        .when(!open, (el) => el.child(h_flex().gap(4).children(tasks.slice(0, 8).map((r) => this.taskGlyph(t, r))))));
      if (open) tasks.forEach((r, i) => rows.push(this.taskRow(t, x, r, now, depth, i === tasks.length - 1)));
    }
    for (const k of kids) this.pushAgent(t, rows, order, k, kidsOf, now, depth + 1);
  }

  focus(x) { const st = find(layout(), "work-stack"); if (st && st.active && st.active !== "main") run("layout.select", { stack: "work-stack", child: "main" }); run(x.a.pane ? "agent.focus" : "terminal.peek", { terminal: x.a.address }); }
  title(x) { return x.a.handle ?? x.rec.name ?? x.snap?.session_name ?? (x.a.title ?? "").replace(/ - GitHub Copilot$/, "") ?? x.a.address; }
  task(x) {
    const name = x.snap?.session_name || (x.a.title ?? "").replace(/ - GitHub Copilot$/, "");
    return name && name !== this.title(x) ? name : x.a.tab_name ?? "";
  }

  // The session's icon: an agent-chosen Nerd Font glyph and color, else one picked from its name.
  icon(t, x, size = 18) {
    const key = x.rec.icon ?? null;
    const glyph = key ? (ICONS[key] ?? key) : Object.values(ICONS)[hash(x.tagKey) % Object.keys(ICONS).length];
    const color = themed(t, x.rec.color) ?? palette(t)[hash(x.tagKey + "c") % palette(t).length];
    return div().w(size + 4).flex_none().text_center().font_family(NERD).text_size(size).text_color(color).child(glyph);
  }

  statusDot(t, st) { return div().size(7).flex_none().rounded(4).bg(t[st] ?? t.idle); }

  // Working spins; needing you is a ?, failed an ×, done a ✓, idle a ring.
  statusGlyph(t, x, size = 12) {
    const st = x.failed ? "failed" : x.a.status;
    if (st === "working") return svg("mods/workspace-chrome/spinner.svg").size(size).flex_none().text_color(t.working).spin(900);
    if (st === "blocked") return h_flex().size(size + 2).flex_none().rounded(3).bg(t.ansi4 ?? t.accent).items_center().justify_center().text_size(size - 2).font_bold().text_color(t.background).child(x.kind === "permission" ? "!" : "?");
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
    const asks = why && a.status === "blocked";
    const line = asks ? why : why ? `${why} · ${this.task(x)}` : this.task(x);
    const body = h_flex().id(`cardb-${a.address}`).w_full().min_w(0).relative().pl(10).pr(8).py(7).gap(10).items_center().rounded(8).opacity(finished ? 0.6 : 1)
      .when(a.focused, (el) => el.bg(t.selected)).hover((st) => st.bg(a.focused ? t.selected : t.hover))
      .on_click(() => this.focus(x))
      .on_hover((on, cx) => { if (on) this.readScreen(a.address); this.hoverCard(a.address, on, cx); })
      .when(a.focused, (el) => el.child(div().absolute().left(0).top(6).bottom(6).w(3).rounded(2).bg(t.working)))
      .child(this.icon(t, x, 22))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(h_flex().gap(6).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(14).font_semibold().child(this.title(x)))
          .when(tags.length > 0, (el) => el.child(this.tagChips(t, tags)))
          .child(this.pinControl(t, x)))
        .child(h_flex().gap(6).items_center()
          .child(this.statusGlyph(t, x, 12))
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(asks ? t.foreground : why ? t.blocked : t.muted).child(line || "—"))
          .when(Boolean(why), (el) => el.child(div().id(`ack-${a.address}`).px(4).rounded(4).text_size(10.5).text_color(t.dim).hover((st) => st.bg(t.hover).text_color(t.foreground))
            .tooltip("Acknowledge (answers nothing)").on_mouse_down("left", stop)
            .on_click((_e, cx) => { cx.stop_propagation(); setShared("maestro.acked", [...(shared("maestro.acked") ?? []), ackKey].slice(-300)); })
            .child("✓"))))
        .when(Boolean(this.blockedLine(x)), (el) => el.child(this.promptRow(t, this.blockedLine(x), 11))))
      .when(this.hovered === a.address, (el) => el.child(this.cardActions(t, x)))
      .child(this.pet(x, 26));
    return h_flex().id(`card-${a.address}`).ml(14 + depth * 14).mr(2).my(2).pl(depth ? 8 : 0).flex_none().items_stretch()
      .on_hover((on, cx) => { if (on) this.hovered = a.address; else if (this.hovered === a.address) this.hovered = null; cx.notify(); })
      .when(depth > 0, (el) => el.border_l(1).border_color(t.border))
      .child(div().flex_1().min_w(0)
        .child(HoverCard.new(`hover-${a.address}`).open_delay(400).close_delay(120).anchor("left_center")
          .trigger(body)
          .content(this.preview(t, x, now, why, tags))));
  }

  hoverCard(address, on, cx) {
    if (on) this.hovered = address;
    else if (this.hovered === address) this.hovered = null;
    cx.notify();
  }

  // Lifecycle actions shown while a card is hovered; each acts only on its own click.
  cardActions(t, x) {
    const { a } = x;
    const acts = [];
    if (a.status === "working") acts.push(["int", "\uf04d", "Interrupt its turn", () => hc(["interrupt", a.address])]);
    if (!a.pane) acts.push(["peek", "\uf06e", "Peek", () => run("terminal.peek", { terminal: a.address })]);
    if (!a.pane) acts.push(["keep", "\uf2d0", "Keep as tab", () => run("terminal.keep", { terminal: a.address })]);
    if (a.pane && x.rec.launcher) acts.push(["park", "\uf187", "Park (keeps running without a pane)", () => run("terminal.park", { terminal: a.address })]);
    return h_flex().id(`acts-${a.address}`).flex_none().gap(2).items_center()
      .children(acts.map(([k, glyph, tip, act]) => div().id(`act-${k}-${a.address}`).size(20).flex().items_center().justify_center().rounded(4)
        .font_family(NERD).text_size(11).text_color(t.dim).hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip(tip)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); act(); })
        .child(glyph)));
  }

  // Passive hover preview: read-only facts, no handlers.
  preview(t, x, now, why, tags) {
    const { a, snap, s } = x;
    const cost = snap?.cost;
    const model = snap?.model?.display_name ?? s?.model ?? s?.lastModel ?? null;
    const effort = s?.effort ?? null;
    const ctx = snap?.context_window?.used_percentage;
    const g = this.gitOf(x.cwd);
    const rows = s ? treeRows(s, now, keepMs()) : [];
    const running = rows.filter((r) => r.status === "running").length;
    const kv = (k, v) => v == null || v === "" ? null : h_flex().gap(8).text_size(12)
      .child(div().w(64).flex_none().text_color(t.dim).child(k))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(String(v)));
    const lines = cost ? `+${cost.total_lines_added ?? 0} / −${cost.total_lines_removed ?? 0}` : null;
    return v_flex().w(300).p(12).gap(6).rounded(10).bg(t.popover ?? t.raised).border_1().border_color(t.border).shadow_lg().text_color(t.foreground)
      .child(h_flex().gap(10).items_center()
        .child(this.pet(x, 48))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().truncate().text_size(14).font_semibold().child(this.title(x)))
          .child(h_flex().gap(6).items_center().child(this.statusGlyph(t, x, 11))
            .child(div().truncate().text_size(12).text_color(t.muted).child(`${STATUS_WORD[x.failed ? "failed" : a.status] ?? a.status} · ${a.address}`)))))
      .when(Boolean(why), (el) => el.child(div().px(8).py(4).rounded(6).bg(t.blocked + "22").text_size(12).text_color(t.blocked).child(why)))
      .children([
        kv("Model", model ? (effort && !model.includes(" · ") ? `${model} · ${effort}` : model) : null),
        kv("Context", ctx != null ? `${ctx}%` : null),
        kv("AIC", snap?.ai_used?.formatted ?? null),
        kv("Elapsed", cost?.total_duration_ms != null ? ago(cost.total_duration_ms) : null),
        kv("Lines", lines),
        kv("Branch", [g?.branch ?? x.branch, g?.tree].filter(Boolean).join(" · ") || null),
        kv("Tasks", rows.length ? (() => { const idle = rows.filter((r) => r.status === "idle").length; return [`${running} running`, idle ? `${idle} idle` : null, `${rows.length - running - idle} finished`].filter(Boolean).join(" · "); })() : null),
      ].filter(Boolean))
      .when(tags.length > 0, (el) => el.child(this.tagChips(t, tags)))
      .when(Boolean(this.screens.get(a.address)?.lines?.length), (el) => el.child(this.screenBox(t, this.screens.get(a.address).lines)));
  }

  // ---- Live screen text (hc read): memory only, fetched lazily, never written to disk ----
  // Reads the terminal's screen at most every 3 s; render never waits on it.
  readScreen(addr, minAge = 3000) {
    const e = this.screens.get(addr) ?? { lines: [], prompt: "", at: 0, busy: false };
    if (e.busy || Date.now() - e.at < minAge || !this.cx) return;
    e.busy = true;
    this.screens.set(addr, e);
    this.cx.spawn(async (cx) => {
      try {
        const r = await hc(["read", addr, "--lines", "10", "--json"]);
        const text = parseRead(r.stdout);
        e.lines = screenLines(text, 8, 160);
        e.prompt = promptLine(text, 160);
      } catch {} finally { e.at = Date.now(); e.busy = false; }
      cx.notify();
    });
  }

  // Blocked agents: re-read when they become blocked, then at most every 30 s while they stay blocked.
  watchBlocked(list) {
    const blocked = new Set(list.filter((x) => x.a.status === "blocked").map((x) => x.a.address));
    for (const addr of blocked) this.readScreen(addr, this.wasBlocked?.has(addr) ? 30000 : 0);
    for (const addr of this.screens.keys()) if (!list.some((x) => x.a.address === addr)) this.screens.delete(addr);
    this.wasBlocked = blocked;
  }

  blockedLine(x) { return x.a.status === "blocked" ? this.screens.get(x.a.address)?.prompt || null : null; }

  promptRow(t, text, size) {
    return div().w_full().min_w(0).truncate().font_family(MONO).text_size(size).text_color(t.dim).child(text);
  }

  screenBox(t, lines) {
    return v_flex().w_full().max_h(140).overflow_hidden().px(6).py(4).rounded(6).bg(t.background).border_1().border_color(t.border)
      .font_family(MONO).text_size(10.5).text_color(t.dim)
      .children(lines.map((l) => div().w_full().min_w(0).truncate().child(l)));
  }

  taskGlyph(t, r) {
    if (r.status === "running") return svg("mods/workspace-chrome/spinner.svg").size(11).flex_none().text_color(t.working).spin(900);
    if (r.status === "idle") return div().size(8).mx(2).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    if (r.status === "failed") return div().text_size(12).text_color(t.blocked).child("⊗");
    if (r.status === "cancelled") return div().text_size(12).text_color(t.blocked).child("‖");
    return div().text_size(12).text_color(t.muted).child("✓");
  }

  taskRow(t, x, r, now, depth, last) {
    const live = r.status === "running";
    const sub = [r.activity && live ? r.activity : null, r.description].filter(Boolean).join(" · ");
    const age = r.status === "idle" ? `idle ${ago(now - (r.lastAt ?? r.ended ?? now))}` : ago((r.status === "running" ? now : r.ended ?? now) - r.started);
    const stats = [r.tools ? `${r.tools} tools` : null, age].filter(Boolean).join(" · ");
    const tip = [r.name, r.description, r.status === "idle" ? "Idle: can still be messaged" : null, r.kind && r.kind !== r.name ? r.kind : null, [r.model, r.effort].filter(Boolean).join(" · "), r.mode, r.turns > 1 ? `${r.turns} turns` : null, r.tokens ? `${compact(r.tokens)} tokens` : null, stats].filter(Boolean).join("\n");
    return h_flex().id(`a-${x.a.address}-${r.id}`).ml(14 + depth * 14).pl(30 + r.depth * 14).pr(10).h(sub ? 36 : 24).flex_none().gap(0).items_center().text_size(12.5)
      .tooltip(tip)
      .child(div().self_start().w(10).h(last ? 12 : sub ? 36 : 24).mr(6).flex_none().border_l(1).border_color(t.border)
        .child(div().mt(11).w(8).border_b(1).border_color(t.border)))
      .child(v_flex().flex_1().min_w(0)
        .child(div().truncate().text_color(live ? t.foreground : t.muted).child(r.name))
        .when(Boolean(sub), (el) => el.child(div().truncate().text_size(11).text_color(t.dim).child(sub))))
      .child(div().pr(6).text_size(11).text_color(t.dim).child(stats))
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
    const live = { default: shared("maestro.pet") ?? null, sessions: shared("maestro.pets") ?? {} };
    // A pick made only in the live cache (the footer's click) is written through to choices.json.
    const picked = live.sessions[x.tagKey];
    if (this.primary && this.choices && picked && this.choices.sessions[x.tagKey] !== picked && !this.saving) {
      this.saving = true;
      this.cx.spawn(async () => { try { await this.saveChoice(x.tagKey, picked); } finally { this.saving = false; } });
    }
    return resolvePet(this.pets, chosenPet(live, x.tagKey));
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
      const c = this.tagColor(t, g);
      return div().px(6).h(18).flex().items_center().rounded(4).border_1().border_dashed().border_color(mine ? t.background : c)
        .bg(mine ? c : c + "22").text_size(11).font_medium().text_color(mine ? t.background : c).child(g);
    }));
  }

  // Worktree detail for the footer: changed files, diff size, short sha and main repo root (20 s cache).
  gitDetail(cwd) {
    if (!cwd) return null;
    this.detail ??= new Map();
    const d = this.detail.get(cwd);
    if (!d?.busy && Date.now() - (d?.at ?? 0) > 20000) {
      this.detail.set(cwd, { v: d?.v ?? null, at: d?.at ?? 0, busy: true });
      this.cx?.spawn(async (cx) => {
        let v = null;
        try {
          const git = (...args) => exec("git", ["-C", cwd, ...args]).then((r) => (r.code === 0 ? r.stdout : null)).catch(() => null);
          const [roots, sha, stat, status] = await Promise.all([
            git("rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"),
            git("rev-parse", "--short", "HEAD"),
            git("diff", "--shortstat", "HEAD"),
            git("status", "--porcelain", "--untracked-files=all"),
          ]);
          if (roots != null) {
            const [common, top] = roots.trim().split("\n");
            const num = (re) => Number(re.exec(stat ?? "")?.[1] ?? 0);
            v = {
              project: common.replace(/[\\/]\.git[\\/]?$/, ""), top,
              sha: sha?.trim() || null,
              files: status == null ? null : status.split("\n").filter(Boolean).length,
              added: num(/(\d+) insertion/), removed: num(/(\d+) deletion/),
            };
          }
        } catch {}
        this.detail.set(cwd, { v, at: Date.now(), busy: false });
        cx.notify();
      });
    }
    return d?.v ?? null;
  }

  // When Maestro last saw the session change: event times on first sight, then whenever its log or status line moves.
  observed(x) {
    this.seen ??= new Map();
    const key = x.id ?? x.a.address;
    const sig = `${x.id ? this.logs.get(x.id)?.offset ?? 0 : 0}|${x.snap?.cost?.total_duration_ms ?? ""}|${x.a.status}`;
    const prev = this.seen.get(key);
    if (prev?.sig === sig) return prev.at;
    let at = Date.now();
    if (!prev) {
      const s = x.s;
      const times = s ? [s.started, s.lastPromptAt, s.turnStart, s.error?.at, ...[...s.agents.values()].flatMap((g) => [g.started, g.ended]), ...[...s.schedules.values()].map((b) => b.lastRun)] : [];
      const last = Math.max(0, ...times.filter(Number.isFinite));
      if (last) at = last;
    }
    this.seen.set(key, { sig, at });
    return at;
  }

  copy(cx, label, text) {
    cx.write_to_clipboard(String(text));
    notify({ title: "Copied", body: label, level: "success", timeout: 1500 });
  }

  // Pinned card for the focused agent.
  footer(t, list, now) {
    const f = focused();
    const x = list.find((y) => y.a.address === f?.terminal) ?? list.find((y) => y.a.focused);
    if (!x) return div().size_full().bg(t.chrome);
    this.refreshGit([x]);
    const { a, snap, s } = x;
    const sched = s ? [...s.schedules.values()] : [];
    const cost = snap?.cost;
    const model = snap?.model?.display_name ?? s?.model ?? s?.lastModel ?? null;
    const effort = s?.effort ?? null;
    const ctx = snap?.context_window?.used_percentage;
    const up = cost?.total_duration_ms;
    const g = this.gitOf(x.cwd);
    const gd = this.gitDetail(x.cwd);
    const tilde = (p) => (p ? p.replace(home(), "~") : null);
    const branch = g?.branch ?? x.branch;
    const added = gd ? gd.added : cost?.total_lines_added;
    const removed = gd ? gd.removed : cost?.total_lines_removed;
    const seen = new Date(this.observed(x));
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${seen.getFullYear()}-${pad(seen.getMonth() + 1)}-${pad(seen.getDate())} ${pad(seen.getHours())}:${pad(seen.getMinutes())}:${pad(seen.getSeconds())}`;
    const field = (k, v, copyText = v, mono = true) => v == null || v === "" ? null : v_flex().gap(1)
      .child(h_flex().gap(4).items_center()
        .child(div().text_size(11).text_color(t.dim).child(k))
        .child(div().id(`copy-${k}`).size(16).flex_none().flex().items_center().justify_center().rounded(4).text_color(t.dim)
          .hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip(`Copy ${k.toLowerCase()}`)
          .on_click((_e, cx) => this.copy(cx, k, copyText))
          .child(svg("mods/maestro/copy.svg").size(11))))
      .child(div().truncate().text_size(12).text_color(t.foreground).when(mono, (el) => el.font_family(MONO)).child(String(v)));
    const metric = (v) => div().flex_1().min_w(0).truncate().child(v);
    return v_flex().id("maestro-footer").size_full().min_h(0).overflow_y_scrollbar().px(12).pt(10).pb(10).gap(8).bg(t.chrome)
      .child(h_flex().gap(12).items_center()
        .child(div().id("pet-box").size(64).flex_none().rounded(10).border_1().border_color(t.border).bg(t.surface).flex().items_center().justify_center()
          .tooltip(`${this.petOf(x)?.name ?? "No pet"} · ${this.petMood(x)} — click to open the pet pokedex`)
          .on_click(() => this.openPets())
          .child(this.pet(x, 52)))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(div().truncate().text_size(14).font_semibold().child(this.title(x)))
          .child(h_flex().gap(6).items_center().child(this.statusGlyph(t, x, 11))
            .child(div().truncate().text_size(12).text_color(t.muted).child(`${STATUS_WORD[x.failed ? "failed" : a.status]} · ${a.address}`)))
          .when(Boolean(model), (el) => el.child(div().truncate().text_size(12).text_color(t.dim).child(effort && !model.includes(" · ") ? `${model} · ${effort}` : model)))))
      .child(h_flex().gap(8).items_center().text_size(11.5).text_color(t.muted)
        .child(metric(ctx != null ? `${ctx}% context${snap?.ai_used?.formatted ? ` · ${snap.ai_used.formatted} AIC` : ""}` : snap?.ai_used?.formatted ? `${snap.ai_used.formatted} AIC` : "—"))
        .child(metric(up != null ? `${ago(up)} elapsed` : "—").text_center())
        .child(h_flex().flex_1().min_w(0).justify_end().gap(4)
          .when(gd?.files != null, (el) => el.child(div().child(`${gd.files} file${gd.files === 1 ? "" : "s"}`)))
          .when(added != null, (el) => el.child(div().text_color(t.ansi2 ?? t.done).child(`+${added}`)))
          .when(removed != null, (el) => el.child(div().text_color(t.ansi1 ?? t.blocked).child(`−${removed}`)))))
      .child(div().truncate().text_size(11).font_family(MONO).text_color(t.dim)
        .child([branch === "HEAD" ? "Detached HEAD" : branch, gd?.sha, tilde(x.cwd)].filter(Boolean).join(" · ")))
      .child(h_flex().gap(4).items_center()
        .child(this.tagChips(t, [...x.userTags.map((g) => ({ g, mine: true })), ...(x.rec.tags ?? []).map((g) => ({ g, mine: false }))]))
        .child(div().id("edit-tags").px(6).rounded(4).text_size(11).text_color(t.dim).hover((st) => st.bg(t.hover).text_color(t.foreground))
          .on_click(() => openOverlay({ kind: "dialog", mod: "maestro-tags", props: { key: x.tagKey, label: snap?.session_name ?? a.address, terminal: a.address } }))
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
      .children([
        field("Session ID", x.id),
        field("Observed", `${stamp} · ${ago(now - seen.getTime())} ago`, stamp, false),
        field("Workspace path", tilde(x.cwd), x.cwd),
        field("Project path", tilde(gd?.project ?? g?.top), gd?.project ?? g?.top),
        field("Terminal", a.parent ? `${a.address} · child of ${a.parent}` : a.address, a.address),
      ].filter(Boolean))
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
    this.showView("maestro-board", { kind: "window", mod: "maestro", props: { view: "board" }, key: "maestro-board", width: 1180, height: 640 });
  }

  openTags() {
    const f = focused();
    const x = this.sessions().find((y) => y.a.address === f?.terminal);
    if (x) openOverlay({ kind: "dialog", mod: "maestro-tags", props: { key: x.tagKey, label: x.snap?.session_name ?? x.a.address, terminal: x.a.address } });
  }

  // A tag's color belongs to its slug: the human's pick in shared("maestro.tagColors")
  // (a theme color name), else a hash over the ANSI hues (same as mods/maestro-tags).
  tagColor(t, slug) {
    const name = (shared("maestro.tagColors") ?? {})[slug];
    if (name && t[name]) return t[name];
    const hues = [t.ansi6, t.ansi3, t.ansi4, t.ansi5, t.ansi2, t.ansi1];
    return hues[hash(slug) % hues.length];
  }

  boardColumn(x) {
    if (x.a.status === "blocked") return "blocked";
    if (x.failed) return "failed";
    return x.a.status;
  }

  renderBoard(t, list, now) {
    const cols = BOARD.map((c) => ({ ...c, items: list.filter((x) => this.boardColumn(x) === c.id) }));
    return v_flex().id("maestro-board").track_focus(this.handle).on_key_down((e, cx) => { if (e.key === "escape" && props()?.place !== "pane") { this.dismissBoard(); cx.stop_propagation(); } }).size_full().bg(t.canvas).text_color(t.foreground).text_size(13)
      .child(h_flex().px(16).py(12).gap(10).items_center().bg(t.chrome)
        .child(div().text_size(16).child("Maestro board"))
        .child(div().text_color(t.dim).child(`${list.length} sessions`))
        .child(div().flex_1())
        .child(this.paneButtons(t, "board", "maestro", "Maestro board", { view: "board" }))
        .child(div().id("board-close").px(8).rounded(4).text_color(t.dim).hover((st) => st.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", (_e, cx) => { if (props()?.place !== "pane") cx.stop_propagation(); })
          .on_click(() => this.dismissBoard()).child("×")))
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
      .on_click(() => this.focus(x))
      .child(h_flex().gap(6).items_center()
        .child(this.pet(x, 13))
        .child(div().flex_1().min_w(0).truncate().text_size(12).child(snap?.session_name || (a.title ?? "").replace(/ - GitHub Copilot$/, "") || a.address)))
      .child(div().truncate().text_size(11).text_color(t.dim).child([x.key, snap?.context_window && `ctx ${snap.context_window.used_percentage}%`, snap?.ai_used && `${snap.ai_used.formatted} AIC`].filter(Boolean).join(" · ")))
      .when(Boolean(why) || running > 0, (el) => el.child(h_flex().gap(6).text_size(11)
        .when(Boolean(why), (e2) => e2.child(div().px(5).rounded(4).bg(t.blocked).text_color(t.background).child(why)))
        .when(running > 0, (e2) => e2.child(div().text_color(t.working).child(`${running} subagent${running > 1 ? "s" : ""} running`)))))
      .when(Boolean(this.blockedLine(x)), (el) => el.child(this.promptRow(t, this.blockedLine(x), 10.5)))
      .when(tags.length > 0, (el) => el.child(this.tagChips(t, tags)));
  }

  // ---- Board as a tab or split (mod panes) ----
  paneButtons(t, id, mod, name, extra) {
    const btn = (bid, label, tip, how) => div().id(`${id}-${bid}`).px(8).py(2).rounded(5).text_size(12).text_color(t.dim)
      .hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(() => { openModPane(mod, name, extra, how); this.leaveShownView(); })
      .child(label);
    return h_flex().gap(2).items_center()
      .child(btn("tab", "Open as tab", "Open in a new tab of this space", "tab"))
      .child(btn("split", "Split beside", "Open in a pane beside the focused one", "split"));
  }

  // The stack or window this view came from gives the main area back after opening it as a pane.
  leaveShownView() {
    if (props()?.overlay) closeOverlay(props().overlay);
    else if (props()?.place !== "pane" && find(layout(), "work-stack")?.active !== "main") run("layout.select", { stack: "work-stack", child: "main" });
  }

  dismissBoard() {
    if (props()?.overlay) closeOverlay(props().overlay);
    else if (props()?.place === "pane") closeModPane("maestro");
    else run("layout.select", { stack: "work-stack", child: "main" });
  }

  // ---- Keyboard navigation in the sidebar (mod.json "focusable": pane.go, or the footer's hand-off) ----
  // The list tracks keyboard focus only while navigating, so mouse clicks keep their old behavior.
  async keyboard(cx) {
    this.kb = true;
    this.kbSeen = false;
    const f = focused();
    if (!this.nav?.some((n) => n.key === this.cursor)) this.cursor = f?.terminal && this.nav?.some((n) => n.key === `ag:${f.terminal}`) ? `ag:${f.terminal}` : this.nav?.[0]?.key ?? null;
    this.handle.focus();
    cx.notify();
    await cx.sleep(60);
    this.handle.focus();
    await cx.sleep(400);
    if (!this.handle.is_focused() && !this.kbSeen) this.kb = false;
  }

  keyboardState() {
    const token = shared("maestro.kbFocus");
    if (this.primary && token !== this.kbToken) {
      this.kbToken = token;
      if (token) this.cx?.spawn(async (cx) => { await this.keyboard(cx); cx.notify(); });
    }
    if (!this.kb) return;
    if (this.handle.is_focused()) this.kbSeen = true;
    else if (this.kbSeen) this.kb = false;
  }

  navRow(t, key, el, at = {}) {
    if (!this.kb) return el;
    return v_flex().flex_none().relative().child(el)
      .when(this.cursor === key, (w) => w.child(div().absolute().left(at.left ?? 0).right(at.right ?? 0).top(at.top ?? 0).bottom(at.bottom ?? 0)
        .rounded(8).border_1().border_color(t.accent)));
  }

  navKey(e, cx) {
    const nav = this.nav ?? [];
    let i = nav.findIndex((n) => n.key === this.cursor);
    const cur = nav[i];
    const k = e.key;
    if (k === "escape") { this.kb = false; run("pane.go", { direction: "right" }); }
    else if (k === "down" || k === "up") {
      if (!nav.length) return;
      i = i < 0 ? 0 : (i + (k === "down" ? 1 : nav.length - 1)) % nav.length;
      this.cursor = nav[i].key;
    } else if (k === "enter") {
      if (!cur) return;
      if (cur.x) { this.kb = false; this.focus(cur.x); }
      else if (cur.space) run("space.select", { id: cur.space.id });
      else this.fold(cur.key, cx);
    } else if (k === "space" || k === "left" || k === "right") {
      const id = cur?.x ? cur.tasks : cur?.key;
      if (!id) return;
      if (k === "space" || (k === "left") !== this.folded.has(id)) this.fold(id, cx);
    } else return;
    cx.stop_propagation();
    cx.notify();
  }

  // ---- Theme picker: a popup over themes(); app.theme sets the shown layout's theme for that lightness ----
  openThemes() {
    openOverlay({ kind: "popup", mod: "maestro", props: { view: "themes" }, width: 320, height: 460, at: "pointer" });
  }

  pickTheme(name) {
    run("app.theme", { name });
    if (props()?.overlay) closeOverlay(props().overlay);
  }

  renderThemes(t) {
    const all = themes();
    const list = [...all.filter((th) => !th.light), ...all.filter((th) => th.light)];
    const now = list.find((th) => th.colors?.background === t.background && th.colors?.foreground === t.foreground)?.name ?? null;
    if (this.themeAt == null) this.themeAt = Math.max(0, list.findIndex((th) => th.name === now));
    this.themeAt = Math.min(this.themeAt, list.length - 1);
    const swatch = (c) => div().size(12).flex_none().rounded(3).border_1().border_color(t.border).bg(c ?? t.surface);
    const row = (th, i) => {
      const c = th.colors ?? {};
      return h_flex().id(`theme-${th.name}`).px(8).py(5).gap(8).items_center().rounded(6).flex_none()
        .when(i === this.themeAt, (el) => el.bg(t.selected))
        .hover((st) => st.bg(i === this.themeAt ? t.selected : t.hover))
        .on_click(() => this.pickTheme(th.name))
        .child(h_flex().gap(2).flex_none().children(["background", "foreground", "accent", "ansi1", "ansi2", "ansi4", "ansi5"].map((k) => swatch(c[k]))))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).child(th.name))
        .when(th.name === now, (el) => el.child(div().text_size(11).text_color(t.accent).child("✓")));
    };
    const head = (label) => div().px(8).pt(6).pb(2).text_size(11).text_color(t.dim).child(label);
    const dark = list.filter((th) => !th.light);
    return v_flex().id("maestro-themes").track_focus(this.handle).size_full().min_h(0).p(8).gap(2).bg(t.popover ?? t.raised).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(props().overlay);
        else if (e.key === "down") this.themeAt = (this.themeAt + 1) % list.length;
        else if (e.key === "up") this.themeAt = (this.themeAt + list.length - 1) % list.length;
        else if (e.key === "enter") { if (list[this.themeAt]) this.pickTheme(list[this.themeAt].name); }
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(div().px(8).pb(4).text_size(11).text_color(t.muted).whitespace_normal().child("Sets this layout's theme for that appearance (dark or light)."))
      .child(v_flex().id("themes-list").flex_1().min_h(0).overflow_y_scrollbar().gap(1)
        .when(dark.length > 0, (el) => el.child(head("Dark")))
        .children(dark.map((th, i) => row(th, i)))
        .when(list.length > dark.length, (el) => el.child(head("Light")))
        .children(list.slice(dark.length).map((th, i) => row(th, dark.length + i))));
  }
}
