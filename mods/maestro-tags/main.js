// Edits the operator's tags for one Maestro session. Enter saves, Esc cancels.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, theme, shared, setShared } from "herdr";

const parse = (text) => [...new Set(text.split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))].slice(0, 8);

export default class MaestroTags extends View {
  init(_props, cx) {
    const key = props()?.key;
    const current = (shared("maestro.tags") ?? {})[key] ?? [];
    this.input = InputState.new({ value: current.join(", ") });
    this.input.on("submit", () => this.save());
    this.input.focus();
    cx.timer.after(400, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  save() {
    const p = props();
    const all = { ...(shared("maestro.tags") ?? {}) };
    const tags = parse(this.input.value());
    if (tags.length) all[p.key] = tags; else delete all[p.key];
    setShared("maestro.tags", all);
    closeOverlay(p.overlay);
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    return v_flex().id("maestro-tags").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .size_full().p(16).gap(10).bg(t.popover).text_color(t.foreground).text_size(13)
      .child(div().text_size(12).text_color(t.dim).child(`Tags for ${p.label ?? "session"}`))
      .child(Input.new(this.input).h(34).px(10).rounded(8).border_1().border_color(t.accent).bg(t.background).text_size(13).text_color(t.foreground))
      .child(h_flex().gap(8).justify_end()
        .child(div().id("cancel").px(12).py(5).rounded(6).bg(t.raised).hover((s) => s.opacity(0.85))
          .on_click(() => closeOverlay(p.overlay)).child("Cancel"))
        .child(div().id("save").px(12).py(5).rounded(6).bg(t.solid).text_color(t.solid_foreground).hover((s) => s.opacity(0.85))
          .on_click(() => this.save()).child("Save")));
  }
}
