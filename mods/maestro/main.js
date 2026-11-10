// Maestro: Copilot sessions in Herdr, with their subagent trees, metrics and attention.
// Bindings come from the status-line bridge (bin/maestro-statusline), else from the
// session lock's process ancestry. Trees and attention come from each session's events.jsonl.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, HoverCard } from "gpui-base";
import { agents, terminals, panes, spaces, machines, layout, run, theme, shared, setShared, exec, hc, home, appHome, watchFolder, setAgentOrder, readTextFile, writeTextFile, focused, notify, openOverlay, closeOverlay, props, nextCommand, themes, playSound, pickFolder, settings, knownAgents, window } from "herdr";
import * as fs from "fs/promises";
import { emptySession, applyLines, treeRows, visibleRows, attention, nextRun, cadence } from "./log.js";
import { parseRead, screenLines, promptLine } from "./screen.js";
import { liveAgents } from "./live.js";
import { pinFirst, alertStep, NEEDS_YOU } from "./alerts.js";
import { isCopilot } from "./agentlib.js";
import { MOOD_ROWS, petRoots, parseChoices, setChoice, mergeChoices, chosenPet, resolvePet } from "./petlib.js";
import { nestSpaces, spacePlace } from "./wtlib.js";
import { machineOf, localAddress, spaceEntries, PROBE, parseProbe, remoteArgv } from "./machines.js";
import { spaceFill, inkOn } from "./spacecolor.js";
import { ICON_KEY, PICKER, resolveIcon } from "./agenticon.js";
import { pastThreshold, canDrop, lineEdge, mergeOrder, arrange, spaceGroups, spaceMoveIndex, startOrder, byStart, dropKeys } from "./reorder.js";
import { PROJECTIONS, projectionOf, nestsUnder } from "./projection.js";

const KEEP_FINISHED_MS = 10 * 60_000;
const keepMs = () => (shared("maestro.showFinished") ? 24 * 3600_000 : KEEP_FINISHED_MS);
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const STATUS_WORD = { working: "Working", blocked: "Waiting on you", done: "Done", idle: "Idle", failed: "Failed" };
const NERD = "JetBrainsMono Nerd Font Mono";
const MONO = "JetBrainsMono Nerd Font Mono";
// Identity colors come from the active Herdr theme, so icons and tags follow theme changes.
const palette = (t) => [t.ansi6, t.ansi3, t.ansi4, t.ansi5, t.ansi2, t.ansi1].filter(Boolean);
const themed = (t, c) => (c && !c.startsWith("#") ? t[c] : c);
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
// Another coding agent (Claude Code, Codex, …): no status-line bridge or events.jsonl, so only Herdr's view of it.
const otherAgent = (a) => { const k = a?.app ?? a?.program?.key; return Boolean(k) && !isCopilot({ key: k }); };

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
    this.folderAt = shared("maestro.launchInFolder")?.at ?? null;
    this.cx = cx;
    this.handle = cx.focus_handle();
    if (this.view === "themes") { this.handle.focus(); cx.timer.after(400, () => this.handle.focus()); return; }
    this.folded = new Set(JSON.parse(localStorage.getItem("folded") ?? "[]"));
    this.git = new Map();       // folder -> { v: { repo, top, branch, tree }, at }
    this.gitBusy = new Set();   // machines with a git refresh in flight (null is local)
    this.pets = [];             // rendered pets (data/maestro/pets/index.json)
    this.choices = null;        // data/maestro/pets/choices.json, once read
    this.screens = new Map();   // terminal address -> { lines, prompt, at, busy }; memory only, never written
    this.machineList = [];      // `hc machine ls` (temporary ones skipped)
    this.remote = new Map();    // machine -> { v: probe answer or null, at, busy }
    this.remoteBusy = new Set(); // machines with a snapshot/binding/tail pass in flight
    cx.spawn(async (cx) => { await this.loadPets(); cx.notify(); });
    // Herdr's startable agents, for the launch menu and `maestro spawn --agent` (reads shared.json).
    if (this.primary) cx.spawn(async () => {
      try { setShared("maestro.knownAgents", { at: Date.now(), agents: (await knownAgents()).map(({ key, name, icon, tint, run, installed }) => ({ key, name, icon, tint, run, installed })) }); } catch {}
    });
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
    cx.spawn(async (cx) => { await this.refreshMachines(); cx.notify(); });
    cx.spawn(async (cx) => { await this.refreshRemote(cx); });
    cx.timer.every(15000, (cx) => {
      cx.spawn(async (cx) => { await this.refreshMachines(); cx.notify(); });
      cx.spawn(async (cx) => { await this.refreshRemote(cx); });
    });
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
    const unbound = this.live().filter((a) => !otherAgent(a) && !a.address.includes("/") && !this.snaps.get(a.address)?.session_id && !this.fallback.has(a.address));
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

  // ---- Other machines (`hc machine ls`): spaces there, their sessions through `on` ----
  async refreshMachines() {
    try {
      const r = await hc(["machine", "ls", "--json"]);
      if (r.code === 0) this.machineList = (JSON.parse(r.stdout).machines ?? []).filter((m) => m && !m.temporary);
    } catch {}
  }

  machineFor(a) { return machineOf(a.address) ?? spaces().find((sp) => sp.id === a.space)?.machine ?? null; }

  // What a machine has (home, Herdr home, Maestro's helper), probed with Node there: again
  // after 5 min, or 1 min when it couldn't answer. Null until known or without Node.
  remoteInfo(on) {
    let R = this.remote.get(on);
    if (!R) { R = { v: null, at: 0, busy: false }; this.remote.set(on, R); }
    if (!R.busy && Date.now() - R.at > (R.v ? 300_000 : 60_000)) {
      R.busy = true;
      this.cx?.spawn(async (cx) => {
        try { const r = await exec("node", ["-e", PROBE], { on }); R.v = r.code === 0 ? parseProbe(r.stdout) : null; } catch { R.v = null; }
        R.at = Date.now();
        R.busy = false;
        cx.notify();
      });
    }
    return R.v;
  }

  helperOn(on, ...args) {
    const p = this.remoteInfo(on)?.helper;
    if (!p) return Promise.reject(new Error(`no Maestro helper on ${on}`));
    return exec("node", [p, ...args.map(String)], { on });
  }

  // New Copilot argv for a space: a remote one runs through that machine's helper, if any.
  argvFor(machine) {
    if (!machine) return copilotArgv();
    return remoteArgv(shared("maestro.argv") ?? ["copilot", "--yolo"], this.remoteInfo(machine)?.helper);
  }

  // Remote status-line snapshots, when the bridge runs there too (keyed by its local address).
  async loadRemoteSnaps(machine) {
    const live = this.live().filter((a) => machineOf(a.address) === machine);
    const keep = new Set(live.map((a) => a.address));
    for (const k of [...this.snaps.keys()]) if (machineOf(k) === machine && !keep.has(k)) this.snaps.delete(k);
    await Promise.all(live.map(async (a) => {
      const on = machineOf(a.address);
      const info = this.remoteInfo(on);
      if (!info) return;
      try {
        const text = await readTextFile(`${info.app}/data/maestro/terminals/${localAddress(a.address)}.json`, { on });
        if (text) this.snaps.set(a.address, JSON.parse(text));
      } catch {}
    }));
  }

  async refreshRemote(cx) {
    const live = this.live();
    const keep = new Set(live.map((a) => a.address));
    for (const k of [...this.snaps.keys()]) if (machineOf(k) && !keep.has(k)) this.snaps.delete(k);
    const names = [...new Set(live.map((a) => this.machineFor(a)).filter(Boolean))];
    await Promise.all(names.map(async (on) => {
      if (this.remoteBusy.has(on)) return;
      this.remoteBusy.add(on);
      try {
        await this.loadRemoteSnaps(on);
        await this.bindRemote(on);
        await this.tailAll(on);
      } finally {
        this.remoteBusy.delete(on);
        cx.notify();
      }
    }));
  }

  // Ancestry binding on other machines: their helper's locks and processes, hc's machine/tN foreground pid.
  async bindRemote(machine) {
    const by = new Map();
    for (const a of this.live()) {
      const on = machineOf(a.address);
      if (!on || on !== machine || this.snaps.get(a.address)?.session_id || this.fallback.has(a.address)) continue;
      if (!by.has(on)) by.set(on, []);
      by.get(on).push(a);
    }
    for (const [on, unbound] of by) {
      const info = this.remoteInfo(on);
      if (!info?.helper) continue;
      let locks, pairs;
      try {
        locks = JSON.parse((await this.helperOn(on, "locks", `${info.home}/.copilot/session-state`)).stdout);
        pairs = JSON.parse((await this.helperOn(on, "procs")).stdout);
      } catch { continue; }
      const parent = new Map(pairs);
      const owner = new Map();
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
  }

  sessionFor(addr, agent = this.live().find((a) => a.address === addr)) {
    if (otherAgent(agent)) return null;
    return this.snaps.get(addr)?.session_id ?? this.fallback.get(addr) ?? null;
  }

  async tailAll(machine = null) {
    // Other views (the pet pokedex) key sessions the same way: session id, else terminal.
    if (this.primary) {
      const keys = Object.fromEntries(this.live().map((a) => [a.address, this.sessionFor(a.address, a) ?? a.address]));
      if (JSON.stringify(keys) !== JSON.stringify(shared("maestro.sessionKeys") ?? {})) setShared("maestro.sessionKeys", keys);
    }
    const ids = new Map();
    for (const a of this.live()) {
      const on = this.machineFor(a);
      if (on !== machine) continue;
      const id = this.sessionFor(a.address, a);
      if (id) ids.set(id, on);
    }
    await Promise.all([...ids].map(([id, on]) => this.tail(id, on)));
  }

  // Folds what was appended since last time, as the helper's compact projection of the log.
  async tail(id, on = null) {
    let L = this.logs.get(id);
    const info = on ? this.remoteInfo(on) : null;
    // Another machine: its helper reads the log there; without one, Herdr's status only.
    if (on && !info?.helper) return;
    if (!L) {
      L = { s: emptySession(), offset: 0, path: `${on ? `${info.home}/.copilot/session-state` : sessionRoot()}/${id}/events.jsonl`, busy: false, on };
      this.logs.set(id, L);
    }
    if (L.busy) return;
    if (on && Date.now() - (L.at ?? 0) < 9000) return;
    L.busy = true;
    L.at = Date.now();
    try {
      const r = on ? await this.helperOn(on, "events", L.path, L.offset) : await helper("events", L.path, L.offset);
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
    const spMachine = new Map(spaces().map((sp) => [sp.id, sp.machine ?? null]));
    return this.live().map((a) => {
      const pane = byPane.get(a.pane);
      const snap = otherAgent(a) ? null : this.snaps.get(a.address);
      const id = this.sessionFor(a.address, a);
      const L = id ? this.logs.get(id) : null;
      const cwd = snap?.cwd ?? pane?.cwd ?? a.cwd ?? null;
      const key = a.space_name || "";
      const s = L?.s ?? null;
      const rec = this.records.get(a.address) ?? {};
      const failed = a.status !== "working" && a.status !== "blocked" && s?.error ? true : false;
      const tagKey = id ?? a.address;
      const machine = machineOf(a.address) ?? spMachine.get(a.space) ?? null;
      return { a, pane, snap, id, s, key, cwd, rec, failed, tagKey, machine, userTags: (shared("maestro.tags") ?? {})[tagKey] ?? [], branch: pane?.branch ?? null, kind: a.status === "blocked" ? kinds.get(a.address) ?? null : null };
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
    this.refreshGit([...list, ...spaces().map((sp) => ({ cwd: spacePlace(sp, panes()), machine: sp.machine ?? null }))]);
    this.keyboardState();
    this.launchInFolderState();
    this.nav = [];
    const proj = projectionOf(shared("maestro.projection"));
    const hide = shared("maestro.hideFinished") ?? {};
    const every = new Map(list.map((x) => [x.a.address, x]));
    // Hiding finished agents in a space hides its idle or done workers (agents with a live parent); failures stay.
    const shown = list.filter((x) => !(hide[x.a.space] && x.a.parent && x.a.parent !== x.a.address && every.has(x.a.parent)
      && (x.a.status === "idle" || x.a.status === "done") && !x.failed));
    const byAddr = new Map(shown.map((x) => [x.a.address, x]));
    const wt = (x) => this.gitOf(x.cwd, x.machine)?.top ?? x.cwd ?? "?";
    const kidsOf = new Map();
    const nested = new Set();
    for (const x of shown) {
      const p = byAddr.get(x.a.parent);
      if (!p || p === x || !nestsUnder(proj, wt(p) === wt(x))) continue;
      if (!kidsOf.has(p.a.address)) kidsOf.set(p.a.address, []);
      kidsOf.get(p.a.address).push(x);
      nested.add(x.a.address);
    }
    // Rows keep their start order (then pins and drags); status, focus and activity never move them.
    const started = byStart(startOrder(this.startSeen ??= { at: new Map(), next: 0 }, list.map((x) => x.a.address)), (x) => x.a.address);
    const roots = shown.filter((x) => !nested.has(x.a.address)).sort(started);
    const stable = (p, q) => pinFirst(p.a, q.a) || started(p, q);
    const order = [];
    const rows = [];
    const narrow = (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;
    const spaceList = this.nestedSpaces();
    this.dragItems = new Map();
    this.registerSpaces(spaceList);
    for (const { sp, tree } of spaceList) {
      if (sp.header) {
        this.nav.push({ key: sp.id });
        rows.push(this.navRow(t, sp.id, this.machineHeader(t, sp, roots, kidsOf, order, narrow), { top: 4 }));
        continue;
      }
      const mine = roots.filter((x) => x.a.space === sp.id);
      this.nav.push({ key: `sp:${sp.id}`, space: sp });
      if (narrow) { for (const x of mine) this.walk(x, kidsOf, (y) => order.push(y.a.address)); rows.push(this.navRow(t, `sp:${sp.id}`, this.railSpace(t, sp, mine))); continue; }
      rows.push(this.navRow(t, `sp:${sp.id}`, this.spaceRow(t, sp, mine, kidsOf, tree), { top: 3, bottom: 3 }));
      if (this.folded.has(`sp:${sp.id}`)) {
        for (const x of mine) this.walk(x, kidsOf, (y) => order.push(y.a.address));
        continue;
      }
      if (proj !== "worktrees") {
        const group = [];
        for (const x of this.arrangeAgents(`sp:${sp.id}`, mine.sort(stable))) this.pushAgent(t, group, order, x, kidsOf, now, 0);
        if (group.length) rows.push(this.guide(t, `g-${sp.id}`, 15, group));
        continue;
      }
      const trees = new Map();
      for (const x of mine) {
        const k = wt(x);
        if (!trees.has(k)) trees.set(k, { g: this.gitOf(x.cwd, x.machine), cwd: x.cwd, items: [] });
        trees.get(k).items.push(x);
      }
      const treeKeys = arrange([...trees.keys()].map((k) => `wt:${sp.id}:${k}`), (f) => f, shared("maestro.treeOrder"));
      this.register("tree", sp.id, treeKeys);
      for (const [k, tr] of arrange([...trees], ([k]) => `wt:${sp.id}:${k}`, shared("maestro.treeOrder"))) {
        const fid = `wt:${sp.id}:${k}`;
        const sorted = this.arrangeAgents(fid, tr.items.sort(stable));
        const group = [];
        const at = this.nav.length;
        if (this.folded.has(fid)) for (const x of sorted) this.walk(x, kidsOf, (y) => order.push(y.a.address));
        else for (const x of sorted) this.pushAgent(t, group, order, x, kidsOf, now, 0);
        this.nav.splice(at, 0, { key: fid });
        rows.push(this.navRow(t, fid, this.treeRow(t, fid, tr, kidsOf), { top: 2 }));
        if (group.length) rows.push(this.guide(t, `g-${fid}`, 9, group));
      }
    }
    setAgentOrder(order);
    if (this.kb && !this.nav.some((n) => n.key === this.cursor)) this.cursor = this.nav[0]?.key ?? null;
    const counts = { blocked: 0, working: 0 };
    for (const x of list) if (counts[x.a.status] != null) counts[x.a.status]++;
    const icon = (id, name, tip, on) => div().id(id).size(24).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(t.dim).hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click(on)
      .child(svg(name.includes("/") ? name : `mods/workspace-chrome/${name}.svg`).size(14));
    return v_flex().id("maestro").when(this.kb, (el) => el.track_focus(this.handle).on_key_down((e, cx) => this.navKey(e, cx)))
      .when(!this.kb && Boolean(this.drag?.moved), (el) => el.track_focus(this.handle).on_key_down((e, cx) => { if (e.key === "escape") { this.endDrag(); cx.stop_propagation(); cx.notify(); } }))
      .size_full().min_h(0).bg(t.chrome).text_size(13).text_color(t.foreground)
      .when(!narrow, (el) => el.child(h_flex().pl(12).pr(6).pt(2).pb(4).gap(2).items_center()
        .child(div().text_size(15).font_semibold().child("Maestro"))
        .child(div().w(6))
        .when(counts.blocked > 0, (e) => e.child(div().px(6).rounded(5).text_size(10.5).font_semibold().bg(t.blocked + "26").text_color(t.blocked).child(`${counts.blocked} need you`)))
        .child(div().flex_1())
        .child(icon("m-new", "folder-plus", "New space", () => run("space.new")))
        .child(this.alertToggles(t))
        .child(icon("m-finished", shared("maestro.showFinished") ? "circle-check" : "clock", shared("maestro.showFinished") ? "Showing idle and finished subagents (finished for 24 h)" : "Showing running subagents only", () => setShared("maestro.showFinished", !shared("maestro.showFinished"))))
        .child(icon("m-theme", "mods/maestro/palette.svg", "Theme", () => this.openThemes()))
        .child(icon("m-board", "layers", "Board (cmd-shift-b)", () => this.openBoard()))))
      .when(!narrow, (el) => el.child(this.segments(t, proj)))
      .child(v_flex().id("maestro-list").flex_1().min_h(0).pl(narrow ? 0 : 4).pr(narrow ? 0 : 14).pb(6).overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => { if (this.drag) { this.endDrag(); cx.notify(); } })
        .on_hover((on, cx) => { if (!on && this.drag) { this.endDrag(); cx.notify(); } })
        .when(spaces().length === 0, (el) => el.child(div().p(12).text_color(t.dim).child("No spaces yet.")))
        .children(rows))
      .when(!narrow, (el) => el.child(this.attentionStrip(t, list)));
  }

  // Projection switch: Worktrees | Agents, shared across views.
  segments(t, proj) {
    return h_flex().id("m-proj").mx(8).mb(4).p(2).h(24).flex_none().gap(2).rounded(7).bg(t.surface).border_1().border_color(t.border)
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
    const toggle = (id, on, tip, child, click, right) => div().id(id).size(24).flex_none().flex().items_center().justify_center().rounded(6)
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
      failed: x.failed,
      needs: x.a.status === "blocked" || NEEDS_YOU.has(x.s ? attention(x.s) : null),
      herdrChimes: herdrSounds && Boolean(x.a.pane) && x.a.status === "blocked",
      worker: Boolean(x.rec.launcher ?? labels.get(x.a.address)?.["maestro.parent"]),
      tabSettled: Boolean(tabs.get(x.a.tab)?.settled),
      tabPanes: tabs.get(x.a.tab)?.panes,
    }));
    for (const act of alertStep(this.alertMem, items, Date.now(), { sounds, settle, debounceMs: 2500 })) {
      try {
        if (act.type === "sound") playSound("blocked");
        else run(act.type === "settle" ? "tab.settle" : "tab.unsettle", { id: act.tab });
      } catch {}
    }
  }

  // The launch menu's "In another folder…" (local spaces only): the folder picker lives here,
  // in the sidebar, since the menu closes first. Starts the argv the menu chose.
  launchInFolderState() {
    const req = shared("maestro.launchInFolder");
    if (!this.primary || !req?.at || req.at === this.folderAt) return;
    this.folderAt = req.at;
    this.cx?.spawn(async () => {
      let folder = null;
      try { folder = await pickFolder({ prompt: `Start ${req.name ?? "agent"}` }); } catch {}
      if (folder && Array.isArray(req.argv)) run("tab.new", { ...(req.space ? { space: req.space } : {}), folder, argv: req.argv });
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
    return v_flex().id("m-attn").flex_none().max_h(180).overflow_y_scrollbar().pl(6).pr(14).pt(4).pb(4).gap(1).border_t(1).border_color(t.border)
      .child(h_flex().px(4).pb(2).gap(6).items_center()
        .child(div().size(7).rounded(4).bg(t.blocked))
        .child(div().text_size(12).font_semibold().text_color(t.blocked).child(title))
        .child(div().text_size(11).text_color(t.dim).child(String(waiting.length))))
      .children(waiting.map(({ x, why }) => h_flex().id(`attn-${x.a.address}`).px(4).py(2).gap(6).items_center().rounded(6)
        .hover((st) => st.bg(t.hover)).on_click(() => this.focus(x)).tooltip(this.task(x) || this.title(x))
        .child(this.icon(t, x, 15))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_medium().child(this.title(x)))
        .child(div().flex_none().px(5).rounded(4).text_size(10.5).bg(t.blocked + "26").text_color(t.blocked).child(why ?? "input"))));
  }

  walk(x, kidsOf, fn) { fn(x); for (const k of kidsOf.get(x.a.address) ?? []) this.walk(k, kidsOf, fn); }
  flat(items, kidsOf) { const out = []; for (const x of items) this.walk(x, kidsOf, (y) => out.push(y)); return out; }
  fold(id, cx) { if (this.folded.has(id)) this.folded.delete(id); else this.folded.add(id); localStorage.setItem("folded", JSON.stringify([...this.folded])); cx.notify(); }

  // Repo, worktree top and branch for a folder, from git, refreshed at most every 20 s.
  // Keyed by machine and folder: another machine's git runs there (`on`).
  gitOf(cwd, on = null) { return cwd ? this.git.get(on ? `${on}:${cwd}` : cwd)?.v ?? null : null; }
  refreshGit(list) {
    const now = Date.now();
    const want = new Map();
    for (const x of list) if (x.cwd) want.set(x.machine ? `${x.machine}:${x.cwd}` : x.cwd, { c: x.cwd, on: x.machine ?? null });
    const due = [...want].filter(([k]) => now - (this.git.get(k)?.at ?? 0) > 20000);
    const by = new Map();
    for (const entry of due) {
      const on = entry[1].on;
      if (!by.has(on)) by.set(on, []);
      by.get(on).push(entry);
    }
    if (!this.cx) return;
    for (const [on, folders] of by) {
      if (this.gitBusy.has(on)) continue;
      this.gitBusy.add(on);
      this.cx.spawn(async (cx) => {
        try {
          for (const [key, { c }] of folders) {
            let v = null;
            try {
              const r = await exec("git", ["-C", c, "rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel", "--abbrev-ref", "HEAD"], on ? { on } : undefined);
              if (r.code === 0) {
                const [common, top, branch] = r.stdout.trim().split("\n");
                const main = common.replace(/\/\.git\/?$/, "");
                v = { repo: main.split("/").pop(), main, top, branch, linked: main !== top, tree: main !== top ? top.split("/").pop() : null };
              }
            } catch {}
            this.git.set(key, { v, at: Date.now() });
          }
        } finally {
          this.gitBusy.delete(on);
          cx.notify();
        }
      });
    }
  }

  // Spaces in Herdr's order, worktree spaces under their repo's main-checkout space (as Herdr's spaces list).
  nestedSpaces() {
    const ps = panes();
    const by = new Map();
    for (const sp of spaces()) {
      const on = sp.machine ?? null;
      if (!by.has(on)) by.set(on, []);
      by.get(on).push({ id: sp.id, sp, g: this.gitOf(spacePlace(sp, ps), on) });
    }
    const nested = [...by.values()].flatMap((rows) => nestSpaces(rows));
    const trees = new Map(nested.map((r) => [r.id, r.tree]));
    return spaceEntries(nested.map((r) => r.sp), this.machineList, (m) => this.folded.has(`mc:${m ?? "local"}`))
      .map((sp) => ({ sp, tree: trees.get(sp.id) ?? null }));
  }

  spaceRow(t, sp, mine, kidsOf, tree = null) {
    const fid = `sp:${sp.id}`;
    const open = !this.folded.has(fid);
    const all = this.flat(mine, kidsOf);
    const hidden = Boolean((shared("maestro.hideFinished") ?? {})[sp.id]);
    const stop = (_e, cx) => cx.stop_propagation();
    const btn = (id, tip, on, child) => div().id(`${id}-${sp.id}`).size(20).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.dim)
      .hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_mouse_down("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); on(); }).child(child);
    const menu = () => openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: sp.id } } });
    const g = this.gitOf(spacePlace(sp, panes()), sp.machine);
    return v_flex().mt(tree ? 1 : 3).flex_none().when(Boolean(tree), (el) => el.ml(14)).child(this.draggable(t, "space", sp.id, h_flex().id(`space-${sp.id}`).px(6).h(28).flex_none().gap(6).items_center().rounded(6)
      .when(sp.active, (el) => el.bg(t.selected)).hover((st) => st.bg(sp.active ? t.selected : t.hover))
      .on_click(() => { if (!this.dragged && !this.fromChild) run("space.select", { id: sp.id }); })
      .on_mouse_down("right", menu)
      .child(div().id(`spf-${sp.id}`).size(18).flex_none().flex().items_center().justify_center().rounded(4).border_1().border_color(t.border).text_color(t.dim)
        .hover((st) => st.text_color(t.foreground)).on_mouse_down("left", stop)
        .on_click((_e, cx) => { cx.stop_propagation(); this.fold(fid, cx); })
        .child(svg(`mods/workspace-chrome/${open ? "minus" : "plus"}.svg`).size(11)))
      .when(Boolean(tree), (el) => el.child(this.spaceAvatar(t, sp, 14, false, true)))
      .when(!tree, (el) => el.child(this.spaceAvatar(t, sp, 16)))
      .child(div().flex_1().min_w(0).truncate().text_size(tree ? 13 : 14).font_bold().child(sp.name))
      .when(!open && all.length > 0, (el) => el.child(this.inlineIcons(t, fid, all, 1)))
      .when(all.length > 0, (el) => el.child(div().px(6).h(18).rounded(5).bg(t.raised).text_size(11).text_color(t.muted).flex().items_center().child(String(all.length))))
      .child(btn("sph", hidden ? "Show finished agents" : "Hide finished agents", () => setShared("maestro.hideFinished", { ...(shared("maestro.hideFinished") ?? {}), [sp.id]: !hidden }),
        svg("mods/maestro/eye-off.svg").size(13).when(hidden, (el) => el.text_color(t.accent))))
      .when(open, (el) => el.child(btn("sps", "Go to space", () => run("space.select", { id: sp.id }), div().text_size(13).child("↗"))))
      .when(Boolean(g), (el) => el.child(btn("spw", "Worktrees", () => this.toggleWorktreeMenu(sp, g), svg("mods/workspace-chrome/git-branch.svg").size(13)
        .when(this.wtMenu?.id === sp.id, (e) => e.text_color(t.accent)))))
      .child(btn("spm", "Space menu", menu, div().text_size(13).font_bold().child("…")))
      .child(this.newButton(t, `spn-${sp.id}`, sp.id, mine[0]?.cwd ?? sp.folder ?? null, 13))))
      .when(Boolean(g) && this.wtMenu?.id === sp.id, (el) => el.child(this.worktreeMenu(t, sp, g)))
      .when(open, (el) => el.child(div().mx(6).mt(2).h(1).flex_none().bg(t.border)));
  }

  // A space's colored initial (shared("space.colors"), as Herdr's Spaces sidebar); a click or
  // right-click opens its color picker without selecting or dragging the space. In the rail
  // (`select`) a click still selects the space; right-click picks the color. A worktree space
  // nested under its checkout (`branch`) shows its branch icon in its color instead.
  spaceAvatar(t, sp, size, select = false, branch = false) {
    const fill = spaceFill(t, (shared("space.colors") ?? {})[sp.id]);
    const stop = (_e, cx) => cx.stop_propagation();
    const pick = (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "maestro-color", kind: "popup", at: "pointer", width: 280, height: 300, props: { space: sp.id } }); };
    if (branch) return div().id(`spc-${sp.id}`).flex_none().cursor_pointer().tooltip("Space color")
      .on_mouse_down("right", pick).on_mouse_down("left", stop).on_click(pick)
      .child(svg("mods/workspace-chrome/branch.svg").size(size).text_color(fill));
    return h_flex().id(`spc-${sp.id}`).size(size).flex_none().rounded(4).bg(fill).items_center().justify_center()
      .text_size(size * 0.625).font_bold().text_color(inkOn(fill)).cursor_pointer().tooltip(select ? sp.name : "Space color")
      .on_mouse_down("right", pick).when(!select, (el) => el.on_mouse_down("left", stop).on_click(pick))
      .child([...sp.name][0]?.toUpperCase() ?? "?");
  }

  // The space's worktree actions, as Herdr's space menu: each opens Herdr's worktree dialog.
  toggleWorktreeMenu(sp, g) {
    if (this.wtMenu?.id === sp.id) { this.wtMenu = null; this.cx?.notify(); return; }
    const m = { id: sp.id, dirty: null };
    this.wtMenu = m;
    const at = spacePlace(sp, panes());
    if (g.linked && at) this.cx?.spawn(async (cx) => {
      try { const r = await exec("git", ["-C", at, "--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], sp.machine ? { on: sp.machine } : undefined); m.dirty = r.code === 0 ? r.stdout.trim() !== "" : true; } catch { m.dirty = true; }
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
    const item = (id, label, on, off) => h_flex().id(`spw-${id}-${sp.id}`).px(8).h(24).gap(6).items_center().rounded(6).text_size(12.5)
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

  // A machine's header once another machine is known (as Herdr's Spaces sidebar): fold,
  // connection dot, + new space there; a folded machine's agents still join agent order.
  machineHeader(t, e, roots, kidsOf, order, narrow) {
    const ids = new Set(e.spaces.map((sp) => sp.id));
    const mine = roots.filter((x) => ids.has(x.a.space));
    if (e.folded) for (const x of mine) this.walk(x, kidsOf, (y) => order.push(y.a.address));
    const all = this.flat(mine, kidsOf);
    const worst = all.reduce((m, x) => (RANK[x.a.status] > RANK[m] ? x.a.status : m), "idle");
    const doc = machines().find((k) => (k.name ?? null) === e.name)?.layout;
    const connected = !e.name || e.state === "connected" || (e.state == null && doc === "ready");
    const tag = e.name ?? "local";
    const add = () => run("space.new", { machine: e.name ?? "" });
    const fold = (_e, cx) => this.fold(e.id, cx);
    const dot = div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 ?? t.done : t.dim);
    const icon = svg(`mods/workspace-chrome/${e.name ? "server" : "monitor"}.svg`).size(13).flex_none();
    if (narrow) return h_flex().id(`machine-${tag}`).h(22).flex_none().justify_center().items_center().gap(3).text_color(t.dim)
      .hover((st) => st.bg(t.hover)).tooltip(e.name ?? "This computer").on_click(fold).child(icon).child(dot);
    const head = h_flex().id(`machine-${tag}`).mt(4).h(24).flex_none().px(8).gap(6).items_center().rounded(6).text_size(11).text_color(t.dim)
      .cursor_pointer().hover((st) => st.bg(t.hover))
      .on_click(fold)
      .child(icon)
      .child(div().flex_1().min_w(0).truncate().child(e.name ?? "This computer"))
      .when(e.folded && worst !== "idle", (el) => el.child(this.statusDot(t, worst)))
      .when(e.folded && all.length > 0, (el) => el.child(div().flex_none().child(String(all.length))))
      .when(!connected, (el) => el.child(div().flex_none().child(String(e.state ?? doc ?? "asleep").replace(/_/g, " "))))
      .when(connected, (el) => el.child(div().id(`machine-add-${tag}`).flex_none().px(4).rounded(4).tooltip("New space there")
        .hover((st) => st.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); add(); }).child("+")))
      .child(dot)
      .child(svg(`mods/workspace-chrome/chevron-${e.folded ? "right" : "down"}.svg`).size(11).flex_none());
    if (e.folded || e.spaces.length) return head;
    const empty = doc === "loading"
      ? div().id(`machine-loading-${tag}`).h(28).flex_none().px(8).flex().items_center().text_size(12).text_color(t.dim).child("Loading…")
      : h_flex().id(`machine-new-${tag}`).h(28).flex_none().px(8).gap(7).items_center().rounded(7).text_size(12).text_color(t.dim)
        .when(connected, (el) => el.hover((st) => st.bg(t.hover).text_color(t.foreground)).on_click(add))
        .child(svg("mods/workspace-chrome/plus.svg").size(12)).child(connected ? "New space there" : "No spaces");
    return v_flex().flex_none().child(head).child(empty);
  }

  railSpace(t, sp, mine) {
    const worst = mine.reduce((m, x) => (RANK[x.a.status] > RANK[m] ? x.a.status : m), "idle");
    return this.draggable(t, "space", sp.id, h_flex().id(`rail-${sp.id}`).h(28).flex_none().justify_center().items_center().gap(4)
      .when(sp.active, (el) => el.bg(t.raised)).hover((st) => st.bg(t.hover))
      .on_click(() => { if (!this.dragged) run("space.select", { id: sp.id }); })
      .child(this.spaceAvatar(t, sp, 16, true))
      .child(this.statusDot(t, worst)));
  }

  treeRow(t, fid, tr, kidsOf) {
    const open = !this.folded.has(fid);
    const g = tr.g;
    const where = place(tr.cwd);
    const name = g?.repo ?? where.repo ?? where.org;
    const detail = [g?.branch === "HEAD" ? "detached" : g?.branch, g?.tree].filter(Boolean).join(" · ");
    const all = this.flat(tr.items, kidsOf);
    const n = all.length;
    return this.draggable(t, "tree", fid, h_flex().id(fid).mt(2).pl(4).pr(6).py(2).flex_none().gap(6).items_center().rounded(6).hover((st) => st.bg(t.hover))
      .on_click((_e, cx) => { if (!this.dragged && !this.fromChild) this.fold(fid, cx); })
      .child(div().w(10).text_size(10).text_color(t.dim).child(open ? "⌄" : "›"))
      .child(svg("mods/workspace-chrome/git-branch.svg").size(15).flex_none().text_color(t.muted))
      .child(h_flex().flex_1().min_w(0).gap(6).items_center()
        .child(div().min_w(0).truncate().text_size(13).font_semibold().child(name))
        .when(Boolean(detail), (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11).font_family(MONO).text_color(t.dim).child(detail))))
      .when(!open && n > 0, (el) => el.child(this.inlineIcons(t, fid, all, 3)))
      .child(div().px(6).h(18).rounded(5).bg(t.raised).text_size(11).text_color(t.muted).flex().items_center().child(String(n)))
      .child(this.newButton(t, `wtn-${fid}`, tr.items[0]?.a.space ?? null, g?.top ?? tr.cwd ?? null, 12)));
  }

  // A space's or worktree's one +: the launch menu (Copilot first, other agents, another folder);
  // Alt-click starts Copilot there at once.
  newButton(t, id, space, folder, icon) {
    const alt = window()?.platform === "macos" ? "⌥" : "Alt";
    return div().id(id).size(20).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.dim)
      .hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip(`New agent… (${alt}-click: Copilot here)`)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((e, cx) => { cx.stop_propagation(); if (e?.modifiers?.alt) this.newCopilot(space, folder); else this.openLaunch(space, folder); })
      .child(svg("mods/workspace-chrome/plus.svg").size(icon));
  }

  newCopilot(space, folder) {
    run("tab.new", { ...(space ? { space } : {}), ...(folder ? { folder } : {}), argv: this.argvFor(spaces().find((sp) => sp.id === space)?.machine) });
  }

  openLaunch(space, folder) {
    const machine = spaces().find((sp) => sp.id === space)?.machine;
    const helper = machine ? this.remoteInfo(machine)?.helper ?? null : null;
    openOverlay({ mod: "maestro-launch", kind: "popup", at: "pointer", width: 240, height: 300, props: { space, folder, helper } });
  }

  // A folded space or worktree: its most urgent agents' status and icon inline on its row, each focusing its agent.
  inlineIcons(t, fid, items, max) {
    const more = items.length - max;
    const urgent = [...items].sort((p, q) => (q.failed - p.failed) || RANK[q.a.status] - RANK[p.a.status]);
    return h_flex().id(`ii-${fid}`).flex_none().gap(2).items_center()
      .children(urgent.slice(0, max).map((x) => h_flex().id(`ii-${fid}-${x.a.address}`).gap(2).items_center().px(2).rounded(4)
        .hover((st) => st.bg(t.hover)).tooltip(this.title(x))
        // The press reaches the row so a drag can start here; a click (no drag) still focuses the agent.
        .on_mouse_down("left", () => { this.childPress = true; })
        .on_click((_e, cx) => { cx.stop_propagation(); if (!this.dragged) this.focus(x); })
        .child(this.statusGlyph(t, x, 10))
        .child(this.icon(t, x, 14))))
      .when(more > 0, (el) => el.child(div().pl(2).text_size(11).text_color(t.dim).child(`+${more}`)));
  }

  pushAgent(t, rows, order, x, kidsOf, now, depth) {
    order.push(x.a.address);
    // Only running subagents by default; "show finished" also lists idle and finished ones.
    const tasks = visibleRows(x.s ? treeRows(x.s, now, keepMs()) : [], Boolean(shared("maestro.showFinished")));
    const started = byStart(this.startSeen ?? { at: new Map(), next: 0 }, (k) => k.a.address);
    const kids = this.arrangeAgents(`kids:${x.a.address}`, (kidsOf.get(x.a.address) ?? []).sort((p, q) => pinFirst(p.a, q.a) || started(p, q)));
    this.nav?.push({ key: `ag:${x.a.address}`, x, tasks: tasks.length ? `tasks:${x.a.address}` : null });
    rows.push(this.navRow(t, `ag:${x.a.address}`, this.agentCard(t, x, now, depth, tasks.length > 0), { left: 14 + depth * 14, right: 2, top: 1, bottom: tasks.length ? 0 : 1 }));
    if (tasks.length) {
      const tid = `tasks:${x.a.address}`;
      const open = !this.folded.has(tid);
      const inset = depth ? 9 : 0;
      const sub = [h_flex().id(tid).pl(26 - inset).py(1).gap(6).items_center().text_size(12).text_color(t.dim).hover((st) => st.text_color(t.foreground))
        .on_click((_e, cx) => this.fold(tid, cx))
        .child(div().w(10).text_size(10).child(open ? "⌄" : "›"))
        .child(shared("maestro.showFinished") ? `${tasks.length} subagent${tasks.length > 1 ? "s" : ""}` : `${tasks.length} running subagent${tasks.length > 1 ? "s" : ""}`)
        .when(Boolean(shared("maestro.showFinished")), (el) => el.children(["running", "idle", "failed"].map((st) => [st, tasks.filter((r) => r.status === st).length]).filter(([, n]) => n)
          .map(([st, n]) => div().text_color(st === "running" ? t.working : st === "failed" ? t.blocked : t.dim).child(`· ${n} ${st}`))))
        .when(!open, (el) => el.child(h_flex().gap(4).children(tasks.slice(0, 8).map((r) => this.taskGlyph(t, r)))))];
      if (open) tasks.forEach((r, i) => sub.push(this.taskRow(t, x, r, now, depth, i === tasks.length - 1, inset)));
      rows.push(this.subagentBlock(t, x, depth, inset, sub));
    }
    for (const k of kids) this.pushAgent(t, rows, order, k, kidsOf, now, depth + 1);
  }

  // An agent's subagent rows share its card's focus/hover highlight: one block under the card body.
  subagentBlock(t, x, depth, inset, rows) {
    const a = x.a;
    const d = this.drag?.moved && this.drag.kind === "agent" ? this.drag : null;
    return v_flex().id(`subs-${a.address}`).ml(14 + depth * 14 + inset).mr(2).pt(1).flex_none().relative().rounded_b(6)
      .when(a.focused, (el) => el.bg(t.selected).child(div().absolute().left(0).top(0).bottom(4).w(3).rounded_b(2).bg(t.working)))
      .when(!a.focused && this.hovered === a.address, (el) => el.bg(t.hover))
      .when(Boolean(d && d.id === x.tagKey && d.over !== x.tagKey), (el) => el.opacity(0.5))
      .children(rows);
  }

  // ---- Drag to reorder: spaces (Herdr's own order, per machine), worktree groups and sibling agents (Maestro-only) ----
  register(kind, group, keys, band = () => null) {
    for (const id of keys) this.dragItems?.set(`${kind}:${id}`, { kind, id, group, band: band(id), keys });
  }

  // entries: nestedSpaces() rows ({ sp, tree }); worktree spaces reorder only under their parent.
  registerSpaces(entries) {
    for (const g of spaceGroups(entries)) this.dragItems?.set(`space:${g.id}`, { kind: "space", ...g });
  }

  // Siblings in their saved order (pinned first); registers them as one drag group.
  arrangeAgents(group, items) {
    // A row saved under its terminal address keeps its place once its session id is known.
    const out = arrange(items, (x) => [x.tagKey, x.a.address], shared("maestro.order"), (x) => x.a.pinned);
    const pinned = new Map(out.map((x) => [x.tagKey, Boolean(x.a.pinned)]));
    this.register("agent", group, out.map((x) => x.tagKey), (k) => pinned.get(k));
    return out;
  }

  // As Herdr's spaces list: a press arms, a move past the threshold drags, an accent line shows where it lands
  // (in the gap beside the row, so it shows between folded rows too).
  draggable(t, kind, id, el) {
    const item = this.dragItems?.get(`${kind}:${id}`);
    if (!item) return el;
    const d = this.drag?.moved && this.drag.kind === kind ? this.drag : null;
    const edge = d && d.over === id ? lineEdge(d.keys, d.id, id) : null;
    return el.relative()
      .when(Boolean(d && d.id === id && d.over !== id), (e) => e.opacity(0.5))
      .when(Boolean(edge), (e) => e.child(div().absolute().left(0).right(0).h(2).rounded(1).bg(t.accent)
        .when(edge === "bottom", (l) => l.bottom(-2)).when(edge === "top", (l) => l.top(-2))))
      .on_mouse_down("left", (e) => {
        this.dragged = false;
        this.fromChild = Boolean(this.childPress);
        this.childPress = false;
        this.drag = { ...item, start: e.position, moved: false, over: id };
      })
      .on_mouse_move((e, cx) => this.dragMove(kind, id, e, cx))
      .on_mouse_up("left", (_e, cx) => this.dragDrop(kind, id, cx));
  }

  dragMove(kind, id, e, cx) {
    const d = this.drag;
    if (!d) return;
    let changed = false;
    if (!d.moved && pastThreshold(d.start, e.position)) {
      d.moved = true;
      this.dragged = true;
      this.kb = false;
      this.dragFocus = focused()?.pane ?? null;
      this.handle.focus();
      changed = true;
    }
    if (!d.moved) return;
    const over = d.kind === kind && d.id === id ? id : canDrop(d, this.dragItems?.get(`${kind}:${id}`)) ? id : null;
    if (over !== d.over) { d.over = over; changed = true; }
    if (changed) cx.notify();
  }

  dragDrop(kind, id, cx) {
    const d = this.drag;
    if (!d) return;
    this.endDrag();
    const keys = dropKeys(d, id, this.dragItems?.get(`${kind}:${id}`));
    if (keys) {
      if (kind === "space") {
        const index = spaceMoveIndex(spaces().map((sp) => sp.id), d.id, id, lineEdge(d.keys, d.id, id));
        if (index != null) run("space.move", { id: d.id, index });
      } else setShared(kind === "tree" ? "maestro.treeOrder" : "maestro.order", mergeOrder(shared(kind === "tree" ? "maestro.treeOrder" : "maestro.order"), keys));
    }
    cx.notify();
  }

  // Cancels or finishes a drag; a drag that took the keyboard (for Escape) gives it back.
  endDrag() {
    const moved = this.drag?.moved;
    this.drag = null;
    if (!moved) return;
    const pane = this.dragFocus;
    this.dragFocus = null;
    if (pane && !this.kb) try { run("pane.focus", { pane }); } catch {}
  }

  focus(x) { const st = find(layout(), "work-stack"); if (st && st.active && st.active !== "main") run("layout.select", { stack: "work-stack", child: "main" }); run(x.a.pane ? "agent.focus" : "terminal.peek", { terminal: x.a.address }); }
  title(x) {
    const tab = spaces().find((sp) => sp.id === x.a.space)?.tabs?.find((tb) => tb.id === x.a.tab);
    return (tab?.named ? tab.name : null) ?? x.a.handle ?? x.rec.name ?? x.snap?.session_name ?? ((x.a.title ?? "").replace(/ - GitHub Copilot$/, "") || x.a.program?.name || x.a.address);
  }
  task(x) {
    const name = x.snap?.session_name || (x.a.title ?? "").replace(/ - GitHub Copilot$/, "");
    return name && name !== this.title(x) ? name : x.a.tab_name ?? "";
  }

  // The session's icon (agenticon.js): the human's pick, else the agent's own Nerd Font glyph and color,
  // else (other agents) its program's icon as Herdr's agent lists show it, else one picked from its key.
  icon(t, x, size = 18) {
    const r = resolveIcon({ human: (shared(ICON_KEY) ?? {})[x.tagKey], agent: x.rec, program: otherAgent(x.a) ? x.a.program : null, key: x.tagKey });
    const color = themed(t, r.color) ?? palette(t)[hash(x.tagKey + "c") % palette(t).length];
    if (r.program) return div().w(size + 4).flex_none().flex().items_center().justify_center()
      .child(r.program.tint ? svg(r.program.icon).size(size).text_color(r.color ? color : t.foreground) : image(r.program.icon).w(size).h(size));
    return div().w(size + 4).flex_none().text_center().font_family(NERD).text_size(size).text_color(color).child(r.glyph);
  }

  // A card's icon opens its icon picker (click or right-click); the press stops here, so it neither
  // focuses the agent nor starts a drag.
  pickableIcon(t, x, size) {
    const pick = (_e, cx) => { cx.stop_propagation(); this.openIcon(x); };
    return div().id(`icon-${x.a.address}`).flex_none().rounded(4).cursor_pointer().hover((st) => st.bg(t.hover)).tooltip("Change icon")
      .on_mouse_down("right", pick).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(pick)
      .child(this.icon(t, x, size));
  }

  openIcon(x) {
    const p = otherAgent(x.a) && x.a.program?.icon ? { icon: x.a.program.icon, tint: Boolean(x.a.program.tint) } : null;
    openOverlay({ mod: "maestro-icon", kind: "popup", at: "pointer", width: PICKER.width, height: PICKER.height,
      props: { key: x.tagKey, label: this.title(x), terminal: x.a.address, agent: { icon: x.rec.icon ?? null, color: x.rec.color ?? null }, program: p } });
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

  agentCard(t, x, now, depth, joined = false) {
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
    const body = h_flex().id(`cardb-${a.address}`).w_full().min_w(0).relative().pl(8).pr(6).py(4).gap(8).items_center().rounded(6).opacity(finished ? 0.6 : 1)
      .when(joined, (el) => el.rounded_b(0))
      .when(a.focused, (el) => el.bg(t.selected)).hover((st) => st.bg(a.focused ? t.selected : t.hover))
      .on_click(() => { if (!this.dragged) this.focus(x); })
      .on_hover((on, cx) => { if (on) this.readScreen(a.address); this.hoverCard(a.address, on, cx); })
      .when(a.focused, (el) => el.child(div().absolute().left(0).top(4).bottom(joined ? 0 : 4).w(3).rounded(2).when(joined, (b) => b.rounded_b(0)).bg(t.working)))
      .child(this.pickableIcon(t, x, 20))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(h_flex().gap(6).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().child(this.title(x)))
          .when(tags.length > 0, (el) => el.child(this.tagChips(t, tags)))
          .child(this.pinControl(t, x)))
        .child(h_flex().gap(6).items_center()
          .child(this.statusGlyph(t, x, 12))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(asks ? t.foreground : why ? t.blocked : t.muted).child(line || "—"))
          .when(Boolean(why), (el) => el.child(div().id(`ack-${a.address}`).px(4).rounded(4).text_size(10.5).text_color(t.dim).hover((st) => st.bg(t.hover).text_color(t.foreground))
            .tooltip("Acknowledge (answers nothing)").on_mouse_down("left", stop)
            .on_click((_e, cx) => { cx.stop_propagation(); setShared("maestro.acked", [...(shared("maestro.acked") ?? []), ackKey].slice(-300)); })
            .child("✓"))))
        .when(Boolean(this.blockedLine(x)), (el) => el.child(this.promptRow(t, this.blockedLine(x), 11))))
      .when(this.hovered === a.address, (el) => el.child(this.cardActions(t, x)))
      .child(this.pet(x, 22));
    return this.draggable(t, "agent", x.tagKey, h_flex().id(`card-${a.address}`).ml(14 + depth * 14).mr(2).mt(1).mb(joined ? 0 : 1).pl(depth ? 8 : 0).flex_none().items_stretch()
      .on_hover((on, cx) => { if (on) this.hovered = a.address; else if (this.hovered === a.address) this.hovered = null; cx.notify(); })
      .when(depth > 0, (el) => el.border_l(1).border_color(t.border))
      .child(div().flex_1().min_w(0)
        .child(HoverCard.new(`hover-${a.address}`).open_delay(400).close_delay(120).anchor("left_center")
          .trigger(body)
          .content(this.preview(t, x, now, why, tags)))));
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
    const g = this.gitOf(x.cwd, x.machine);
    const rows = s ? treeRows(s, now, keepMs()) : [];
    const running = rows.filter((r) => r.status === "running").length;
    const kv = (k, v) => v == null || v === "" ? null : h_flex().gap(8).text_size(12)
      .child(div().w(64).flex_none().text_color(t.dim).child(k))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(String(v)));
    const lines = cost ? `+${cost.total_lines_added ?? 0} / −${cost.total_lines_removed ?? 0}` : null;
    return v_flex().w(300).p(10).gap(4).rounded(10).bg(t.popover ?? t.raised).border_1().border_color(t.border).shadow_lg().text_color(t.foreground)
      .child(h_flex().gap(10).items_center()
        .child(this.pet(x, 48))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().truncate().text_size(14).font_semibold().child(this.title(x)))
          .child(h_flex().gap(6).items_center().child(this.statusGlyph(t, x, 11))
            .child(div().truncate().text_size(12).text_color(t.muted).child(`${STATUS_WORD[x.failed ? "failed" : a.status] ?? a.status} · ${a.address}`)))))
      .when(Boolean(why), (el) => el.child(div().px(8).py(4).rounded(6).bg(t.blocked + "22").text_size(12).text_color(t.blocked).child(why)))
      .children([
        kv("Agent", otherAgent(a) ? a.program?.name ?? a.app : null),
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
    if (r.status === "ended") return div().text_size(12).text_color(t.dim).child("⊘");
    return div().text_size(12).text_color(t.muted).child("✓");
  }

  taskRow(t, x, r, now, depth, last, inset = 0) {
    const live = r.status === "running";
    const sub = [r.activity && live ? r.activity : null, r.description].filter(Boolean).join(" · ");
    const age = r.status === "idle" ? `idle ${ago(now - (r.lastAt ?? r.ended ?? now))}` : ago((r.status === "running" ? now : r.ended ?? now) - r.started);
    const stats = [r.tools ? `${r.tools} tools` : null, age].filter(Boolean).join(" · ");
    const tip = [r.name, r.description, r.status === "idle" ? "Idle: can still be messaged" : null, r.kind && r.kind !== r.name ? r.kind : null, [r.model, r.effort].filter(Boolean).join(" · "), r.mode, r.turns > 1 ? `${r.turns} turns` : null, r.tokens ? `${compact(r.tokens)} tokens` : null, stats].filter(Boolean).join("\n");
    return h_flex().id(`a-${x.a.address}-${r.id}`).pl(30 + r.depth * 14 - inset).pr(6).h(sub ? 34 : 22).flex_none().gap(0).items_center().text_size(12.5)
      .tooltip(tip)
      .child(div().self_start().w(10).h(last ? 11 : sub ? 34 : 22).mr(6).flex_none().border_l(1).border_color(t.border)
        .child(div().mt(10).w(8).border_b(1).border_color(t.border)))
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
      return div().px(5).h(16).flex().items_center().rounded(4).border_1().border_dashed().border_color(mine ? t.background : c)
        .bg(mine ? c : c + "22").text_size(11).font_medium().text_color(mine ? t.background : c).child(g);
    }));
  }

  // Worktree detail for the footer: changed files, diff size, short sha and main repo root (20 s cache).
  gitDetail(cwd, on = null) {
    if (!cwd) return null;
    this.detail ??= new Map();
    const key = on ? `${on}:${cwd}` : cwd;
    const d = this.detail.get(key);
    if (!d?.busy && Date.now() - (d?.at ?? 0) > 20000) {
      this.detail.set(key, { v: d?.v ?? null, at: d?.at ?? 0, busy: true });
      this.cx?.spawn(async (cx) => {
        let v = null;
        try {
          const git = (...args) => exec("git", ["-C", cwd, ...args], on ? { on } : undefined).then((r) => (r.code === 0 ? r.stdout : null)).catch(() => null);
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
        this.detail.set(key, { v, at: Date.now(), busy: false });
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
    const g = this.gitOf(x.cwd, x.machine);
    const gd = this.gitDetail(x.cwd, x.machine);
    const tilde = (p) => (p ? p.replace(home(), "~") : null);
    const branch = g?.branch ?? x.branch;
    const added = gd ? gd.added : cost?.total_lines_added;
    const removed = gd ? gd.removed : cost?.total_lines_removed;
    const seen = new Date(this.observed(x));
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${seen.getFullYear()}-${pad(seen.getMonth() + 1)}-${pad(seen.getDate())} ${pad(seen.getHours())}:${pad(seen.getMinutes())}:${pad(seen.getSeconds())}`;
    const field = (k, v, copyText = v, mono = true) => v == null || v === "" ? null : h_flex().gap(6).items_center()
      .child(div().w(84).flex_none().truncate().text_size(11).text_color(t.dim).child(k))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).when(mono, (el) => el.font_family(MONO)).child(String(v)))
      .child(div().id(`copy-${k}`).size(16).flex_none().flex().items_center().justify_center().rounded(4).text_color(t.dim)
        .hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip(`Copy ${k.toLowerCase()}`)
        .on_click((_e, cx) => this.copy(cx, k, copyText))
        .child(svg("mods/maestro/copy.svg").size(11)));
    const metric = (v) => div().flex_1().min_w(0).truncate().child(v);
    return v_flex().id("maestro-footer").size_full().min_h(0).overflow_y_scrollbar().px(10).pt(6).pb(6).gap(4).bg(t.chrome)
      .child(h_flex().gap(10).items_center()
        .child(div().id("pet-box").size(48).flex_none().rounded(8).border_1().border_color(t.border).bg(t.surface).flex().items_center().justify_center()
          .tooltip(`${this.petOf(x)?.name ?? "No pet"} · ${this.petMood(x)} — click to open the pet pokedex`)
          .on_click(() => this.openPets())
          .child(this.pet(x, 40)))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(div().truncate().text_size(14).font_semibold().child(this.title(x)))
          .child(h_flex().gap(6).items_center().child(this.statusGlyph(t, x, 11))
            .child(div().truncate().text_size(12).text_color(t.muted).child(`${STATUS_WORD[x.failed ? "failed" : a.status]} · ${a.address}`)))
          .when(Boolean(model), (el) => el.child(div().truncate().text_size(12).text_color(t.dim).child(effort && !model.includes(" · ") ? `${model} · ${effort}` : model)))))
      .child(h_flex().gap(6).items_center().text_size(11.5).text_color(t.muted)
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
        .child(h_flex().id("edit-icon").gap(2).items_center().px(6).rounded(4).text_size(11).text_color(t.dim).hover((st) => st.bg(t.hover).text_color(t.foreground))
          .tooltip("Change this agent's icon").on_click(() => this.openIcon(x))
          .child(this.icon(t, x, 11)).child("Icon…"))
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
        field("Machine", x.machine),
      ].filter(Boolean))
      .when(sched.length > 0, (el) => el.child(v_flex().gap(1)
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
      .child(h_flex().px(12).py(8).gap(8).items_center().bg(t.chrome)
        .child(div().text_size(16).child("Maestro board"))
        .child(div().text_color(t.dim).child(`${list.length} sessions`))
        .child(div().flex_1())
        .child(this.paneButtons(t, "board", "maestro", "Maestro board", { view: "board" }))
        .child(div().id("board-close").px(8).rounded(4).text_color(t.dim).hover((st) => st.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", (_e, cx) => { if (props()?.place !== "pane") cx.stop_propagation(); })
          .on_click(() => this.dismissBoard()).child("×")))
      .child(h_flex().id("board-cols").flex_1().min_h(0).p(8).gap(8).items_start().children(cols.map((c) =>
        v_flex().id(`col-${c.id}`).flex_1().min_w(0).h_full().p(6).pr(14).gap(6).rounded(8).bg(t.chrome).overflow_y_scrollbar()
          .child(h_flex().gap(6).items_center().px(2)
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
    return v_flex().id(`card-${a.address}`).px(8).py(6).gap(3).rounded(6).bg(t.surface).border_1().border_color(a.focused ? t.accent : t.border)
      .hover((st) => st.bg(t.hover))
      .on_click(() => this.focus(x))
      .child(h_flex().gap(6).items_center()
        .child(this.pet(x, 13))
        .child(div().flex_1().min_w(0).truncate().text_size(12).child(snap?.session_name || (a.title ?? "").replace(/ - GitHub Copilot$/, "") || a.address)))
      .child(div().truncate().text_size(11).text_color(t.dim).child([x.machine, x.key, snap?.context_window && `ctx ${snap.context_window.used_percentage}%`, snap?.ai_used && `${snap.ai_used.formatted} AIC`].filter(Boolean).join(" · ")))
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
    // Herdr sizes a popup to its content, so the picker sets its height or the list collapses.
    return v_flex().id("maestro-themes").track_focus(this.handle).w_full().h(460).min_h(0).p(8).gap(2).bg(t.popover ?? t.raised).text_color(t.foreground)
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
      .child(v_flex().id("themes-list").flex_1().min_h(0).pr(10).overflow_y_scrollbar().gap(1)
        .when(dark.length > 0, (el) => el.child(head("Dark")))
        .children(dark.map((th, i) => row(th, i)))
        .when(list.length > dark.length, (el) => el.child(head("Light")))
        .children(list.slice(dark.length).map((th, i) => row(th, dark.length + i))));
  }
}
