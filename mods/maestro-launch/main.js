// Maestro's agent launcher: a popup listing the coding agents Herdr knows (knownAgents()),
// opened from a space's or worktree's chevron. Picking one starts it in that space and folder
// through that machine's Maestro helper when available, Copilot with Maestro's own argv.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, spaces, knownAgents, run, closeOverlay, props, shared, setShared, appHome } from "herdr";

// Shared with the Maestro mod and read by `maestro spawn --agent` from shared.json.
const KNOWN = "maestro.knownAgents";
const copilotArgv = () => shared("maestro.argv") ?? ["copilot", "--yolo"];

export default class MaestroLaunch extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.space = p.space ?? spaces().find((s) => s.active)?.id ?? null;
    this.folder = p.folder ?? null;
    const machine = spaces().find((s) => s.id === this.space)?.machine ?? null;
    this.local = !machine;
    this.agents = this.local ? shared(KNOWN)?.agents ?? [] : [];
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

  start(a) {
    closeOverlay(props().overlay);
    const argv = a.key === "copilot" ? copilotArgv() : a.run;
    const helper = this.local ? `${appHome()}/mods/maestro/helper.mjs` : props().helper;
    run("tab.new", { ...(this.space ? { space: this.space } : {}), ...(this.folder ? { folder: this.folder } : {}), argv: helper ? ["node", helper, "run", ...argv] : [...argv] });
  }

  render() {
    const t = theme();
    const installed = this.agents.filter((a) => a.installed !== false);
    const choices = [...installed, ...this.agents.filter((a) => a.installed === false).slice(0, 3)];
    const icon = (a) => !a.icon ? div().w(14).flex_none() : a.tint ? svg(a.icon).size(14).flex_none().text_color(t.foreground) : image(a.icon).size(14).flex_none();
    return v_flex().id("maestro-launch").size_full().min_h(0).bg(t.popover ?? t.raised).p(5).text_size(12.8).text_color(t.foreground)
      .track_focus(this.handle)
      .on_key_down((e) => {
        if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
        const a = /^[1-9]$/.test(e.key) ? installed[Number(e.key) - 1] : null;
        if (a) this.start(a);
      })
      .child(div().px(9).pt(4).pb(4).text_size(11).text_color(t.dim).child("Start an agent here"))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar()
        .children(choices.map((a, i) => {
          const ok = a.installed !== false;
          return h_flex().id(`agent-${a.key}`).h(31).px(9).gap(10).rounded(7).items_center().flex_none()
            .text_color(ok ? t.foreground : t.dim).when(ok, (el) => el.hover((s) => s.bg(t.selected)).on_click(() => this.start(a)))
            .child(icon(a))
            .child(div().flex_1().min_w(0).truncate().child(a.name ?? a.key))
            .child(div().text_size(11).text_color(t.dim).child(ok ? (i < 9 ? String(i + 1) : "") : "not installed"));
        }))
        .when(this.agents.length === 0, (el) => el.child(div().px(9).py(6).text_color(t.dim).child(this.failed ? "Could not load agents" : "Checking installed agents…"))));
  }
}
