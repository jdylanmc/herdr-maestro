// Maestro's pet pokedex: every rendered pet, its moods, who uses it, and choosing pets.
// Opened by maestro's `pets` command (openOverlay kind "window", key "maestro-pets").
import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, panes, theme, shared, setShared, exec, home, appHome, readTextFile, writeTextFile, watchFolder, focused, props, closeOverlay, run } from "herdr";
import * as fs from "fs/promises";
import { MOODS, moodRow, moodGif, petRoots, parseChoices, setChoice, chosenPet, resolvePet } from "./petlib.js";

const dataDir = () => `${appHome()}/data/maestro`;
const petDir = () => `${dataDir()}/pets`;
const choicesPath = () => `${petDir()}/choices.json`;
const HELPER = () => `${appHome()}/mods/maestro/helper.mjs`;
const MONO = "JetBrainsMono Nerd Font Mono";
const SOURCE = { codex: "Codex", maestro: "Maestro", added: "Added", other: "Other" };
const ADD_HINT = "maestro pet add <folder or pet.json>";

const back = () => run("layout.select", { stack: "work-stack", child: "main" });

// The pokedex as a mod pane (props.place "pane"): its own tab, or split beside the focused pane.
// Same as mods/maestro/main.js openModPane/closeModPane (mods cannot share modules, G-10).
function openModPane(mod, name, extra, how) {
  const props = { ...extra, place: "pane" };
  if (how === "tab") { run("tab.new", { name, mod, props }); return; }
  const f = focused();
  const pane = f?.pane ?? panes().find((p) => p.tab === f?.tab && p.focused)?.pane ?? panes().find((p) => p.tab === f?.tab)?.pane;
  run("pane.split", { direction: "right", mod, props, ...(pane ? { pane } : {}) });
}

function closeModPane(mod) {
  const all = panes();
  const p = all.find((q) => q.pane === focused()?.pane && q.mod === mod && q.terminal == null);
  if (!p) return;
  if (all.filter((q) => q.tab === p.tab).length === 1) run("tab.close", { id: p.tab });
  else run("pane.close", { pane: p.pane });
}

export default class MaestroPets extends View {
  close() { if (props()?.place === "pane") return; if (props()?.overlay) closeOverlay(props().overlay); else back(); }

  // × and Esc. close() is also Herdr's teardown hook, so pane closing lives here, not there.
  dismiss() { if (props()?.place === "pane") closeModPane("maestro-pets"); else this.close(); }

  // After opening as a pane, give the main area (or the window) back.
  leave() { if (props()?.overlay) closeOverlay(props().overlay); else if (props()?.place !== "pane") back(); }

  init(_props, cx) {
    this.pets = [];
    this.progress = null;
    this.snaps = new Map(); // terminal address -> status-line snapshot (session id and name)
    this.selected = null;
    this.note = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async (cx) => {
      await this.load();
      cx.notify();
      for (;;) {
        await watchFolder(dataDir());
        await this.load();
        cx.notify();
      }
    });
  }

  async load() {
    try { const v = JSON.parse(await readTextFile(`${petDir()}/index.json`)); if (Array.isArray(v)) this.pets = v; } catch {}
    try { this.progress = JSON.parse(await readTextFile(`${petDir()}/progress.json`)); } catch { this.progress = null; }
    let names = [];
    try { names = await fs.readdir(`${dataDir()}/terminals`); } catch {}
    const snaps = new Map();
    for (const n of names) {
      if (!n.endsWith(".json")) continue;
      try { snaps.set(n.slice(0, -5), JSON.parse(await readTextFile(`${dataDir()}/terminals/${n}`))); } catch {}
    }
    this.snaps = snaps;
  }

  // Live agents with the key Maestro stores their pet under (session id, else terminal).
  sessions() {
    const live = { default: shared("maestro.pet") ?? null, sessions: shared("maestro.pets") ?? {} };
    return agents().map((a) => {
      const snap = this.snaps.get(a.address);
      const key = (shared("maestro.sessionKeys") ?? {})[a.address] ?? snap?.session_id ?? a.address;
      const pet = resolvePet(this.pets, chosenPet(live, key));
      return { address: a.address, key, name: snap?.session_name || (a.title ?? "").replace(/ - GitHub Copilot$/, "") || a.address, pet: pet?.id ?? null, explicit: Boolean(live.sessions[key]), focused: a.focused };
    });
  }

  focusedSession(list) {
    const f = focused();
    return list.find((s) => s.address === f?.terminal) ?? list.find((s) => s.focused) ?? null;
  }

  // Live cache first for instant feedback, then choices.json (atomic, retried when stale).
  async choose(key, id) {
    if (key == null) setShared("maestro.pet", id);
    else setShared("maestro.pets", { ...(shared("maestro.pets") ?? {}), [key]: id });
    for (let i = 0; i < 3; i++) {
      let before = null;
      try { before = await readTextFile(choicesPath()); } catch {}
      try {
        await fs.mkdir(petDir(), { recursive: true });
        await writeTextFile(choicesPath(), JSON.stringify(setChoice(parseChoices(before), key, id), null, 1), before);
        return;
      } catch {}
    }
    this.note = "Could not save choices.json";
  }

  async rescan(force) {
    this.note = null;
    try {
      const r = await exec("node", [HELPER(), "pets", "--bg", ...(force ? ["--force"] : []), petDir(), ...petRoots(home(), dataDir())]);
      if (r.code !== 0) this.note = (r.stderr || "render failed").trim().slice(0, 200);
      else this.progress = { state: "rendering", done: 0, total: this.progress?.total ?? 0 };
    } catch (e) { this.note = `node did not start: ${e?.message ?? e}`; }
  }

  button(t, id, label, on, { primary = false, disabled = false, tip = null } = {}) {
    let b = div().id(id).px(10).py(4).rounded(6).text_size(12).flex_none()
      .bg(primary && !disabled ? t.solid : t.raised).text_color(disabled ? t.dim : primary ? t.solid_foreground : t.foreground)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation());
    if (tip) b = b.tooltip(tip);
    if (!disabled) b = b.hover((s) => s.opacity(0.85)).on_click((_e, cx) => on(cx));
    return b.child(label);
  }

  status(t) {
    const p = this.progress;
    if (this.note) return div().text_size(12).text_color(t.blocked).truncate().child(this.note);
    if (p?.state === "rendering") return div().text_size(12).text_color(t.working).truncate()
      .child(`Rendering ${p.done ?? 0}/${p.total ?? "?"}${p.current ? ` · ${p.current}` : ""}`);
    if (p?.state === "done") return div().text_size(12).text_color(t.dim).truncate()
      .child(`Rendered ${p.total ?? 0} sheets${p.errors ? ` · ${p.errors} failed` : ""}`);
    return div();
  }

  render() {
    const t = theme();
    const list = this.sessions();
    const failed = this.pets.filter((p) => p.error).length;
    const def = shared("maestro.pet") ?? "maestro";
    const sel = this.pets.find((p) => p.id === this.selected) ?? this.pets.find((p) => p.id === def) ?? this.pets[0] ?? null;
    const code = (text) => div().px(6).rounded(4).bg(t.surface).font_family(MONO).text_color(t.foreground).child(text);
    return v_flex().id("maestro-pets").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape" && props()?.place !== "pane") { this.dismiss(); cx.stop_propagation(); } })
      .size_full().bg(t.canvas).text_color(t.foreground).text_size(13)
      .child(h_flex().px(16).py(10).gap(10).items_center().bg(t.chrome).border_b(1).border_color(t.border)
        .child(div().text_size(16).font_semibold().child("Pets"))
        .child(div().text_size(12).text_color(t.dim).child(`${this.pets.length - failed} pets${failed ? ` · ${failed} failed` : ""}`))
        .child(div().flex_1().min_w(0).child(this.status(t)))
        .child(this.button(t, "rescan", "Rescan", (cx) => cx.spawn(async (cx) => { await this.rescan(false); cx.notify(); }), { tip: "Render new or changed sheets in the background" }))
        .child(this.button(t, "rerender", "Re-render all", (cx) => cx.spawn(async (cx) => { await this.rescan(true); cx.notify(); }), { tip: "Render every sheet again (--force)" }))
        .child(this.button(t, "pets-tab", "Open as tab", () => { openModPane("maestro-pets", "Pets", {}, "tab"); this.leave(); }, { tip: "Open in a new tab of this space" }))
        .child(this.button(t, "pets-split", "Split beside", () => { openModPane("maestro-pets", "Pets", {}, "split"); this.leave(); }, { tip: "Open in a pane beside the focused one" }))
        .child(div().id("pets-close").px(8).rounded(4).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", (_e, cx) => { if (props()?.place !== "pane") cx.stop_propagation(); })
          .on_click(() => this.dismiss()).child("×")))
      .child(h_flex().flex_1().min_h(0).items_start()
        .child(v_flex().id("pets-grid").flex_1().min_w(0).h_full().overflow_y_scrollbar().p(12)
          .child(this.pets.length ? div().flex().flex_wrap().gap(8).children(this.pets.map((p) => this.card(t, p, p.id === sel?.id, def, list)))
            : div().p(20).text_color(t.dim).child(this.progress?.state === "rendering" ? "Rendering pets…" : `No pets yet. Add Codex pets to ~/.codex/pets, or run ${ADD_HINT}`)))
        .child(sel ? this.detail(t, sel, def, list) : div()))
      .child(h_flex().px(16).py(8).gap(8).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(12).text_color(t.dim)
        .child(div().child("Add a pet:")).child(code(ADD_HINT))
        .child(div().child("· an agent picks its own with")).child(code("maestro pet use <id>")));
  }

  card(t, p, selected, def, list) {
    const users = list.filter((s) => s.pet === p.id).length;
    return v_flex().id(`pet-${p.id}`).w(116).p(8).gap(4).items_center().rounded(8).border_1()
      .border_color(selected ? t.accent : t.border).bg(selected ? t.selected : t.surface)
      .hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { this.selected = p.id; cx.notify(); })
      .child(p.error
        ? div().size(64).flex().items_center().justify_center().rounded(8).bg(t.raised).text_size(24).text_color(t.blocked).child("!")
        : image(moodGif(p, "idle")).w(64).h(69).flex_none())
      .child(div().w_full().text_center().truncate().text_size(12).child(p.name ?? p.id))
      .child(h_flex().gap(4).items_center()
        .child(div().px(5).rounded(3).text_size(10).bg(t.raised).text_color(t.muted).child(SOURCE[p.source] ?? "Pet"))
        .when(Boolean(p.error), (el) => el.child(div().px(5).rounded(3).text_size(10).bg(t.blocked).text_color(t.background).child("failed")))
        .when(p.id === def && !p.error, (el) => el.child(div().px(5).rounded(3).text_size(10).bg(t.accent).text_color(t.accent_foreground).child("default")))
        .when(users > 0, (el) => el.child(div().text_size(10).text_color(t.dim).child(`×${users}`))));
  }

  detail(t, p, def, list) {
    const me = this.focusedSession(list);
    const users = list.filter((s) => s.pet === p.id);
    const isDefault = p.id === def;
    return v_flex().id("pet-detail").w(400).flex_none().h_full().overflow_y_scrollbar().p(14).gap(10).bg(t.chrome).border_l(1).border_color(t.border)
      .child(h_flex().gap(12).items_center()
        .child(div().size(104).flex_none().rounded(10).border_1().border_color(t.border).bg(t.surface).flex().items_center().justify_center()
          .child(p.error ? div().text_size(36).text_color(t.blocked).child("!") : image(moodGif(p, "idle")).w(88).h(95)))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().truncate().text_size(16).font_semibold().child(p.name ?? p.id))
          .child(div().truncate().text_size(11).text_color(t.dim).font_family(MONO).child(p.id))
          .child(div().text_size(11).text_color(t.muted).child(`${SOURCE[p.source] ?? "Pet"} · ${p.error ? "not rendered" : p.moods ? "20-row mood atlas" : "9-row sheet (some moods share rows)"}`))))
      .when(Boolean(p.description), (el) => el.child(div().whitespace_normal().text_size(12).text_color(t.muted).child(p.description)))
      .when(Boolean(p.error), (el) => el.child(div().whitespace_normal().p(8).rounded(6).bg(t.surface).border_1().border_color(t.blocked).text_size(12).text_color(t.blocked).child(`Render failed: ${p.error}`)))
      .child(h_flex().gap(8)
        .child(this.button(t, "use-focused", me ? `Use for ${me.name.slice(0, 24)}` : "Use for focused session", (cx) => cx.spawn(async (cx) => { await this.choose(me.key, p.id); cx.notify(); }),
          { primary: true, disabled: !me || Boolean(p.error) || (me.pet === p.id && me.explicit), tip: me ? "This session keeps the pet across restarts" : "Focus an agent first" }))
        .child(this.button(t, "make-default", isDefault ? "Default" : "Make default", (cx) => cx.spawn(async (cx) => { await this.choose(null, p.id); cx.notify(); }),
          { disabled: isDefault || Boolean(p.error), tip: "Pet for sessions that have not picked one" })))
      .child(v_flex().gap(3)
        .child(div().text_size(11).text_color(t.dim).child(users.length ? `Used by ${users.length}` : "Not used by a live session"))
        .children(users.slice(0, 12).map((s) => h_flex().gap(6).text_size(12)
          .child(div().flex_1().min_w(0).truncate().text_color(s.focused ? t.foreground : t.muted).child(s.name))
          .child(div().text_size(11).text_color(t.dim).child(s.explicit ? s.address : `${s.address} · default`)))))
      .when(!p.error, (el) => el.child(v_flex().gap(6)
        .child(div().text_size(11).text_color(t.dim).child("Moods"))
        .child(div().flex().flex_wrap().gap(6).children(MOODS.map((m) => {
          const row = moodRow(p, m);
          const own = MOODS.find((o) => moodRow(p, o) === row) === m;
          return v_flex().id(`mood-${m}`).w(84).p(4).gap(2).items_center().rounded(6).bg(t.surface)
            .tooltip(own ? `${m} · row ${row}` : `${m} · shares row ${row} with ${MOODS.find((o) => moodRow(p, o) === row)}`)
            .child(image(moodGif(p, m)).w(56).h(61))
            .child(div().w_full().text_center().truncate().text_size(10.5).text_color(own ? t.foreground : t.dim).child(m));
        })))));
  }
}
