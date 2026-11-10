// Picks one agent's icon (props { key, label, agent, program, overlay }), opened from its card's icon or the
// footer. Writes shared("maestro.icons")[key] = { icon, color }, which wins over the agent's own
// `maestro icon` (agenticon.js). Each pick applies at once; Reset removes the entry.
// Arrow keys move between icons and colors, Enter picks, Esc closes.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, theme, shared, setShared } from "herdr";
import { ICON_KEY, ICONS, COLORS, PICKER, hash, parseGlyph, parseColor, cleanChoice, resolveIcon, withIcon } from "./agenticon.js";

const NERD = "JetBrainsMono Nerd Font Mono";
const COLS = 6;
const SWATCHES = 7;
const PRESETS = Object.keys(ICONS);
const palette = (t) => [t.ansi6, t.ansi3, t.ansi4, t.ansi5, t.ansi2, t.ansi1].filter(Boolean);
const SOURCE = { human: "Your pick", agent: "The agent's pick", program: "Its program's icon", auto: "Picked from its name" };

export default class MaestroIcon extends View {
  init(_props, cx) {
    const cur = cleanChoice((shared(ICON_KEY) ?? {})[props()?.key]);
    this.choice = cur ?? { icon: null, color: null };
    const field = (placeholder, value, submit) => {
      const s = InputState.new({ placeholder });
      if (value) s.set_value(value);
      s.on("change", (_e, cx) => { this.error = null; cx.notify(); });
      s.on("submit", (_e, cx) => submit(cx));
      s.on("focus", () => { this.typing = true; });
      s.on("blur", () => { this.typing = false; });
      return s;
    };
    this.glyph = field("Custom glyph", cur?.icon && !ICONS[cur.icon] ? cur.icon : "", (cx) => this.customGlyph(cx));
    this.hex = field("#rrggbb", cur?.color?.startsWith("#") ? cur.color : "", (cx) => this.customColor(cx));
    this.error = null;
    this.at = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  set(patch) {
    const key = props()?.key;
    if (!key) return;
    this.choice = { ...this.choice, ...patch };
    setShared(ICON_KEY, withIcon(shared(ICON_KEY), key, this.choice));
  }

  reset() {
    const key = props()?.key;
    if (key) setShared(ICON_KEY, withIcon(shared(ICON_KEY), key, null));
    closeOverlay(props()?.overlay);
  }

  customGlyph(cx) {
    const g = parseGlyph(this.glyph.value());
    if (g) this.set({ icon: g });
    else this.error = "glyph";
    cx?.notify();
  }

  customColor(cx) {
    const c = parseColor(this.hex.value());
    if (c) this.set({ color: c });
    else this.error = "color";
    cx?.notify();
  }

  // Icons, then colors: left/right step, up/down move a row of icons (or colors).
  key(e, cx, items) {
    const n = items.length;
    const row = this.at != null && items[this.at]?.color ? SWATCHES : COLS;
    if (e.key === "escape") closeOverlay(props()?.overlay);
    else if (this.typing) return;
    else if (e.key === "right") this.at = this.at == null ? 0 : (this.at + 1) % n;
    else if (e.key === "left") this.at = this.at == null ? n - 1 : (this.at + n - 1) % n;
    else if (e.key === "down") this.at = this.at == null ? 0 : Math.min(n - 1, this.at + row);
    else if (e.key === "up") this.at = this.at == null ? n - 1 : Math.max(0, this.at - row);
    else if (e.key === "enter" && this.at != null && items[this.at]) this.set(items[this.at].icon ? { icon: items[this.at].icon } : { color: items[this.at].color });
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const colorOf = (c) => (c && !c.startsWith("#") ? t[c] : c) ?? palette(t)[hash(`${p.key}c`) % palette(t).length] ?? t.foreground;
    const r = resolveIcon({ human: this.choice, agent: p.agent, program: p.program, key: p.key });
    const ink = colorOf(r.color);
    const colors = COLORS.filter((c) => t[c]);
    const items = [...PRESETS.map((icon) => ({ icon })), ...colors.map((color) => ({ color }))];
    const draw = (size) => (r.program
      ? (r.program.tint ? svg(r.program.icon).size(size).text_color(r.color ? ink : t.foreground) : image(r.program.icon).w(size).h(size))
      : div().font_family(NERD).text_size(size).text_color(ink).child(r.glyph));
    const label = (text) => div().h(14).text_size(11).text_color(t.dim).child(text);
    const ring = (on, at) => (on || this.at === at ? t.foreground : t.border);
    const cell = (name, i) => h_flex().id(`ic-${name}`).size(30).flex_none().rounded(6).items_center().justify_center().cursor_pointer()
      .bg(t.raised).border_1().border_color(ring(this.choice.icon === name, i)).tooltip(name)
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { this.set({ icon: name }); cx.notify(); })
      .child(div().font_family(NERD).text_size(16).text_color(ink).child(ICONS[name]));
    const swatch = (name, i) => h_flex().id(`icc-${name}`).size(20).flex_none().rounded(10).bg(t[name]).cursor_pointer()
      .border_2().border_color(ring(this.choice.color === name, PRESETS.length + i)).tooltip(name)
      .hover((s) => s.opacity(0.85)).on_click((_e, cx) => { this.set({ color: name }); cx.notify(); });
    const rows = (list, size, fn, offset = 0) => Array.from({ length: Math.ceil(list.length / size) }, (_, k) =>
      h_flex().gap(5).children(list.slice(k * size, (k + 1) * size).map((x, j) => fn(x, offset + k * size + j))));
    const button = (id, text, action) => div().id(id).px(10).h(28).flex().items_center().rounded(6).cursor_pointer().flex_none()
      .bg(t.raised).text_color(t.foreground).text_size(12).hover((s) => s.bg(t.hover)).on_click(action).child(text);
    const input = (state, bad) => Input.new(state).flex_1().h(28).px(8).rounded(6).border_1().border_color(bad ? t.blocked : t.border)
      .bg(t.background).text_size(12.5).text_color(t.foreground);
    const err = this.error === "glyph" ? `Use one glyph or a preset (${PRESETS.slice(0, 3).join(", ")}, …)`
      : this.error === "color" ? "Use a hex color like #3fae6a" : "";
    // Herdr sizes a popup to its content, so the picker sets its own height.
    return v_flex().id("maestro-icon").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx, items))
      .w_full().h(PICKER.height).p(12).gap(6).bg(t.popover).text_color(t.foreground).text_size(12.5)
      .child(h_flex().h(30).gap(8).items_center()
        .child(h_flex().size(30).flex_none().rounded(6).bg(t.raised).items_center().justify_center().child(draw(18)))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().font_semibold().child(`Icon for ${p.label ?? "agent"}`))
          .child(div().truncate().text_size(11).text_color(t.dim).child(SOURCE[r.source]))))
      .child(label("Icon"))
      .child(v_flex().gap(5).children(rows(PRESETS, COLS, cell)))
      .child(h_flex().gap(6).items_center()
        .child(input(this.glyph, this.error === "glyph").font_family(NERD))
        .child(button("ic-glyph", "Use", (_e, cx) => this.customGlyph(cx))))
      .child(label("Color"))
      .child(v_flex().gap(5).children(rows(colors, SWATCHES, swatch, PRESETS.length)))
      .child(h_flex().gap(6).items_center()
        .child(div().size(20).flex_none().rounded(10).bg(parseColor(this.hex.value()) ? colorOf(parseColor(this.hex.value())) : ink).border_1().border_color(t.border))
        .child(input(this.hex, this.error === "color"))
        .child(button("ic-hex", "Use", (_e, cx) => this.customColor(cx))))
      .child(div().h(14).text_size(11).text_color(t.blocked).child(err))
      .child(div().flex_1())
      .child(h_flex().gap(6).justify_end()
        .child(button("ic-reset", p.agent?.icon ? "Agent's choice" : "Auto", () => this.reset())
          .tooltip("Remove your pick; the agent's own icon, else its program's or an automatic one, shows"))
        .child(button("ic-close", "Done", () => closeOverlay(p.overlay))));
  }
}
