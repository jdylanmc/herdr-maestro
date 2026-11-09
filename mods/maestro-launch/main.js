// Maestro's agent launcher: a popup listing the coding agents Herdr knows (knownAgents()),
// opened from a space's or worktree's +. Copilot comes first and is selected (Enter starts it);
// picking an agent starts it in that space and folder through that machine's Maestro helper
// when available, Copilot with Maestro's own argv. "In another folder…" (local spaces only)
// asks Maestro to pick a folder, then starts the selected agent there.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, spaces, knownAgents, run, closeOverlay, props, shared, setShared, appHome } from "herdr";
import { launchItems, moveSelection, FOLDER } from "./items.js";

// Shared with the Maestro mod and read by `maestro spawn --agent` from shared.json.
const KNOWN = "maestro.knownAgents";
// Read by the Maestro sidebar, which owns the folder picker: { at, space, argv }.
const IN_FOLDER = "maestro.launchInFolder";
const copilotArgv = () => shared("maestro.argv") ?? ["copilot", "--yolo"];

export default class MaestroLaunch extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.space = p.space ?? spaces().find((s) => s.active)?.id ?? null;
    this.folder = p.folder ?? null;
    const machine = spaces().find((s) => s.id === this.space)?.machine ?? null;
    this.local = !machine;
    this.agents = this.local ? shared(KNOWN)?.agents ?? [] : [];
    this.selKey = "agent:copilot"; // the selected row by identity: rows change when discovery resolves
    this.pick = "copilot"; // the agent "In another folder…" starts: the last one selected
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async (cx) => {
      try {
        const list = await knownAgents({ on: machine });
        this.agents = list;
        if (this.local) setShared(KNOWN, { at: Date.now(), agents: list.map(({ key, name, icon, tint, run, installed }) => ({ key, name, icon, tint, run, installed })) });
      } catch { this.failed = true; }
      cx.notify();
    });
  }

  argv(a) {
    const argv = a.key === "copilot" ? copilotArgv() : a.run;
    const helper = this.local ? `${appHome()}/mods/maestro/helper.mjs` : props().helper;
    return helper ? ["node", helper, "run", ...argv] : [...argv];
  }

  start(a) {
    closeOverlay(props().overlay);
    run("tab.new", { ...(this.space ? { space: this.space } : {}), ...(this.folder ? { folder: this.folder } : {}), argv: this.argv(a) });
  }

  inFolder(items) {
    const a = items.find((it) => it.kind === "agent" && it.key === this.pick) ?? items[0];
    closeOverlay(props().overlay);
    setShared(IN_FOLDER, { at: Date.now(), space: this.space, argv: this.argv(a), name: a.name ?? a.key });
  }

  choose(items, it) {
    if (!it?.ok) return;
    if (it.kind === FOLDER) this.inFolder(items);
    else this.start(it);
  }

  render() {
    const t = theme();
    const items = launchItems(this.agents, { local: this.local });
    const rowKey = (it) => `${it.kind}:${it.key}`;
    let sel = items.findIndex((it) => it.ok && rowKey(it) === this.selKey);
    if (sel < 0) { sel = 0; this.selKey = rowKey(items[0]); }
    const picked = items.find((it) => it.kind === "agent" && it.key === this.pick) ?? items[0];
    const icon = (a) => a.kind === FOLDER ? svg("mods/workspace-chrome/folder.svg").size(14).flex_none().text_color(t.foreground)
      : !a.icon ? div().w(14).flex_none() : a.tint ? svg(a.icon).size(14).flex_none().text_color(t.foreground) : image(a.icon).size(14).flex_none();
    return v_flex().id("maestro-launch").size_full().min_h(0).bg(t.popover ?? t.raised).p(5).text_size(12.8).text_color(t.foreground)
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
        if (e.key === "escape") { closeOverlay(props().overlay); return; }
        if (e.key === "down" || e.key === "up") {
          const it = items[moveSelection(items, sel, e.key === "down" ? 1 : -1)];
          this.selKey = rowKey(it);
          if (it.kind === "agent") this.pick = it.key;
          cx.notify();
          return;
        }
        if (e.key === "enter") { this.choose(items, items[sel]); return; }
        const a = /^[1-9]$/.test(e.key) ? items.find((it) => it.hotkey === e.key) : null;
        if (a) this.start(a);
      })
      .child(div().px(9).pt(4).pb(4).text_size(11).text_color(t.dim).child("Start an agent here"))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar()
        .children(items.flatMap((it, i) => [
          ...(it.kind === FOLDER ? [div().mx(9).my(3).h(1).flex_none().bg(t.border)] : []),
          h_flex().id(`agent-${it.key}`).h(31).px(9).gap(10).rounded(7).items_center().flex_none()
            .text_color(it.ok ? t.foreground : t.dim)
            .when(i === sel, (el) => el.bg(t.selected))
            .when(it.ok, (el) => el.hover((s) => s.bg(t.selected)).on_click(() => this.choose(items, it)))
            .child(icon(it))
            .child(div().flex_1().min_w(0).truncate().child(it.name ?? it.key))
            .child(div().text_size(11).text_color(t.dim).child(it.kind === FOLDER ? picked.name ?? picked.key : it.ok ? it.hotkey ?? "" : "not installed")),
        ]))
        .when(this.agents.length === 0, (el) => el.child(div().px(9).py(6).text_color(t.dim).child(this.failed ? "Could not load agents" : "Checking installed agents…"))));
  }
}
