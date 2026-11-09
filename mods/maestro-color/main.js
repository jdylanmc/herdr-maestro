// Picks one space's color (props { space, overlay }), opened from its avatar in Maestro.
// Writes shared("space.colors") as Herdr's Spaces sidebar does, so both show the same color:
// a theme color name for a swatch, "#rrggbb" for a custom one, no entry for Auto (Herdr picks).
// Arrow keys move between swatches, Enter applies, Esc closes.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, theme, shared, setShared, spaces } from "herdr";
import { parseHex, spaceFill, inkOn, swatches, withColor } from "./spacecolor.js";

export default class MaestroColor extends View {
  init(_props, cx) {
    const cur = this.current();
    this.input = InputState.new({ placeholder: "#rrggbb" });
    if (cur?.startsWith("#")) this.input.set_value(cur);
    this.input.on("change", (_e, cx) => { this.error = false; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.custom(cx));
    this.input.on("focus", () => { this.typing = true; });
    this.input.on("blur", () => { this.typing = false; });
    this.error = false;
    this.at = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  current() { return (shared("space.colors") ?? {})[props()?.space] ?? null; }

  apply(value) {
    const id = props()?.space;
    if (id) setShared("space.colors", withColor(shared("space.colors"), id, value));
    closeOverlay(props()?.overlay);
  }

  custom(cx) {
    const hex = parseHex(this.input.value());
    if (hex) return this.apply(hex);
    this.error = true;
    cx?.notify();
  }

  key(e, cx, list) {
    const n = list.length;
    if (e.key === "escape") closeOverlay(props()?.overlay);
    else if (this.typing) return;
    else if (e.key === "right" || e.key === "down") this.at = this.at == null ? 0 : (this.at + 1) % n;
    else if (e.key === "left" || e.key === "up") this.at = this.at == null ? n - 1 : (this.at + n - 1) % n;
    else if (e.key === "enter" && this.at != null && list[this.at]) return this.apply(list[this.at].name);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const sp = spaces().find((s) => s.id === p.space);
    const cur = this.current();
    const fill = spaceFill(t, cur);
    const list = swatches(t);
    const label = (text) => div().text_size(11).text_color(t.dim).child(text);
    const swatch = ({ name, fill: c }, i) => h_flex().id(`sc-${name}`).size(26).flex_none().rounded(6).bg(c)
      .items_center().justify_center().text_size(12).font_bold().text_color(inkOn(c)).cursor_pointer()
      .border_2().border_color(cur === name || this.at === i ? t.foreground : c).tooltip(name)
      .hover((s) => s.opacity(0.85))
      .on_click(() => this.apply(name))
      .child(cur === name ? "✓" : "");
    const row = (g) => h_flex().flex_wrap().gap(6).children(list.map((s, i) => (s.group === g ? swatch(s, i) : null)).filter(Boolean));
    const button = (id, text, action) => div().id(id).px(10).h(28).flex().items_center().rounded(6).cursor_pointer().flex_none()
      .bg(t.raised).text_color(t.foreground).text_size(12).hover((s) => s.bg(t.hover)).on_click(action).child(text);
    return v_flex().id("maestro-color").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx, list))
      .size_full().p(12).gap(8).bg(t.popover).text_color(t.foreground).text_size(12.5)
      .child(h_flex().gap(8).items_center()
        .child(h_flex().size(18).flex_none().rounded(4).bg(fill).items_center().justify_center()
          .text_size(11).font_bold().text_color(inkOn(fill)).child([...(sp?.name ?? "?")][0]?.toUpperCase() ?? "?"))
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(`Color for ${sp?.name ?? "space"}`)))
      .child(label("Herdr"))
      .child(row("herdr"))
      .when(list.some((s) => s.group === "theme"), (el) => el.child(label("Theme")).child(row("theme")))
      .child(label("Custom"))
      .child(h_flex().gap(6).items_center()
        .child(div().size(26).flex_none().rounded(6).bg(parseHex(this.input.value()) ?? fill).border_1().border_color(t.border))
        .child(Input.new(this.input).flex_1().h(28).px(8).rounded(6).border_1().border_color(this.error ? t.blocked : t.border).bg(t.background).text_size(12.5).text_color(t.foreground))
        .child(button("sc-apply", "Apply", (_e, cx) => this.custom(cx))))
      .when(this.error, (el) => el.child(div().text_size(11).text_color(t.blocked).child("Use a hex color like #3fae6a")))
      .child(div().flex_1())
      .child(h_flex().gap(6).justify_end()
        .child(button("sc-reset", "Auto", () => this.apply(null)).tooltip("Remove this space's color; Herdr picks one"))
        .child(button("sc-close", "Close", () => closeOverlay(p.overlay))));
  }
}
