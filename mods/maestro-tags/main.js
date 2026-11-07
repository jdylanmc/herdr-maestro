// Edits the operator's tags for one Maestro session and the color of each tag.
// A tag is a short canonical slug; its color belongs to the slug everywhere and only
// the human picks it. Colors live in shared("maestro.tagColors") = { [slug]: themeName },
// a Herdr theme color name (never hex) so tags follow the active theme. A slug without
// one falls back to a hash over FALLBACK (keep in sync with tagColor in mods/maestro).
// Enter adds the typed tag (on an empty input it saves and closes), Esc cancels,
// Backspace on an empty input removes the last tag. Colors apply immediately.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, theme, shared, setShared, appHome, readTextFile } from "herdr";

const MAX_TAGS = 8;
const PALETTE = ["ansi1", "ansi2", "ansi3", "ansi4", "ansi5", "ansi6", "accent", "working", "blocked", "done"];
const FALLBACK = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619); return h >>> 0; };
const slug = (x) => String(x).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24).replace(/-+$/, "");
const tint = (t, c) => (/^#[0-9a-f]{6}$/i.test(c) ? c + "22" : t.hover);
const colorName = (g) => (shared("maestro.tagColors") ?? {})[g] ?? null;
const colorOf = (t, g) => t[colorName(g)] ?? t[FALLBACK[hash(g) % FALLBACK.length]];

export default class MaestroTags extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.tags = [...((shared("maestro.tags") ?? {})[p.key] ?? [])];
    this.agentTags = [];
    this.selected = null;
    this.text = "";
    this.input = InputState.new({ placeholder: "add a tag…" });
    this.input.on("change", (_e, cx) => this.changed(cx));
    this.input.on("submit", (_e, cx) => { if (this.input.value().trim()) { this.add(this.input.value()); this.clear(); cx.notify(); } else this.save(); });
    this.input.focus();
    cx.timer.after(400, () => this.input.focus());
    this.handle = cx.focus_handle();
    if (p.terminal) cx.spawn(async (cx) => {
      try {
        const rec = JSON.parse((await readTextFile(`${appHome()}/data/maestro/agents/${p.terminal}.json`)) ?? "{}");
        this.agentTags = Array.isArray(rec.tags) ? rec.tags.map(slug).filter(Boolean) : [];
      } catch { this.agentTags = []; }
      cx.notify();
    });
  }

  // Comma or whitespace commits everything before it; the rest stays in the input.
  changed(cx) {
    if (this.resetting) return;
    const v = this.input.value();
    const parts = v.split(/[,\s]+/);
    if (parts.length > 1) {
      parts.slice(0, -1).forEach((x) => this.add(x));
      this.resetting = true;
      this.input.set_value(parts[parts.length - 1]);
      this.resetting = false;
    }
    this.text = this.input.value();
    cx.notify();
  }

  clear() { this.resetting = true; this.input.set_value(""); this.resetting = false; this.text = ""; }

  add(raw) {
    const g = slug(raw);
    if (g && !this.tags.includes(g) && this.tags.length < MAX_TAGS) this.tags.push(g);
  }

  remove(g) {
    this.tags = this.tags.filter((x) => x !== g);
    if (this.selected === g) this.selected = null;
  }

  setColor(g, name) {
    const all = { ...(shared("maestro.tagColors") ?? {}) };
    if (name) all[g] = name; else delete all[g];
    setShared("maestro.tagColors", all);
  }

  save() {
    const p = props();
    const all = { ...(shared("maestro.tags") ?? {}) };
    this.add(this.input.value());
    if (this.tags.length) all[p.key] = this.tags.slice(0, MAX_TAGS); else delete all[p.key];
    setShared("maestro.tags", all);
    closeOverlay(p.overlay);
  }

  // Every tag in use on any session or given a color, most used first, minus the current ones.
  suggestions() {
    const count = new Map();
    for (const list of Object.values(shared("maestro.tags") ?? {})) for (const g of list ?? []) count.set(g, (count.get(g) ?? 0) + 1);
    for (const g of Object.keys(shared("maestro.tagColors") ?? {})) if (!count.has(g)) count.set(g, 0);
    const q = slug(this.text);
    return [...count.entries()].filter(([g]) => !this.tags.includes(g) && (!q || g.startsWith(q)))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([g]) => g).slice(0, 12);
  }

  key(e, cx) {
    if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
    else if (e.key === "backspace" && !this.input.value() && this.tags.length) { this.remove(this.tags[this.tags.length - 1]); cx.stop_propagation(); cx.notify(); }
  }

  chip(t, g) {
    const c = colorOf(t, g);
    const on = this.selected === g;
    return h_flex().id(`tag-${g}`).h(24).pl(8).pr(2).gap(2).items_center().rounded(6).bg(c).text_color(t.background)
      .text_size(12).font_medium().cursor_pointer().border_2().border_color(on ? t.foreground : c)
      .on_click((_e, cx) => { this.selected = on ? null : g; cx.notify(); })
      .child(g)
      .child(div().id(`rm-${g}`).w(18).h(18).flex().items_center().justify_center().rounded(4).hover((s) => s.opacity(0.6))
        .on_click((_e, cx) => { this.remove(g); cx.stop_propagation(); cx.notify(); }).child("×"));
  }

  agentChip(t, g) {
    const c = colorOf(t, g);
    return h_flex().h(24).px(8).gap(4).items_center().rounded(6).border_1().border_dashed().border_color(c)
      .text_color(c).text_size(12).font_medium().child(g).child(div().text_size(10).text_color(t.dim).child("agent"));
  }

  palette(t, g) {
    const cur = colorName(g);
    const swatch = (name) => {
      const on = cur === name;
      const fill = name ? t[name] : t[FALLBACK[hash(g) % FALLBACK.length]];
      return div().id(`sw-${name ?? "default"}`).w(22).h(22).rounded(11).bg(fill).cursor_pointer()
        .border_2().border_color(on ? t.foreground : t.border).hover((s) => s.opacity(0.8))
        .flex().items_center().justify_center().text_size(10).text_color(t.background).child(name ? "" : "A")
        .on_click((_e, cx) => { this.setColor(g, name); cx.notify(); });
    };
    return v_flex().gap(6)
      .child(div().text_size(11).text_color(t.dim).child(`Color for ${g} (everywhere) · ${cur ?? "default"}`))
      .child(h_flex().gap(6).items_center().child(swatch(null)).children(PALETTE.map(swatch)));
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const sugg = this.suggestions();
    const own = this.agentTags.filter((g) => !this.tags.includes(g));
    const label = (text) => div().text_size(11).text_color(t.dim).child(text);
    const button = (id, text, primary, action) => div().id(id).px(12).py(5).rounded(6).cursor_pointer()
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .hover((s) => s.opacity(0.85)).on_click(action).child(text);
    return v_flex().id("maestro-tags").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().p(16).gap(10).bg(t.popover).text_color(t.foreground).text_size(13)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(13).font_semibold().child(`Tags for ${p.label ?? "session"}`))
        .child(div().text_size(11).text_color(t.dim).child(`${this.tags.length}/${MAX_TAGS}`)))
      .child(h_flex().flex_wrap().gap(6).min_h(24)
        .children(this.tags.map((g) => this.chip(t, g)))
        .children(own.map((g) => this.agentChip(t, g)))
        .when(!this.tags.length && !own.length, (el) => el.child(div().text_size(12).text_color(t.dim).child("No tags yet"))))
      .child(div().min_h(42).child(this.selected && this.tags.includes(this.selected)
        ? this.palette(t, this.selected)
        : label("Click a tag to pick its color. Backspace removes the last one.")))
      .child(Input.new(this.input).h(34).px(10).rounded(8).border_1().border_color(t.accent).bg(t.background).text_size(13).text_color(t.foreground))
      .when(sugg.length > 0, (el) => el.child(v_flex().gap(6).child(label("Known tags"))
        .child(h_flex().flex_wrap().gap(6).children(sugg.map((g) => {
          const c = colorOf(t, g);
          return div().id(`sg-${g}`).h(22).px(8).flex().items_center().rounded(6).border_1().border_color(c).text_color(c)
            .text_size(12).cursor_pointer().hover((s) => s.bg(tint(t, c)))
            .on_click((_e, cx) => { this.add(g); this.clear(); this.input.focus(); cx.notify(); }).child(g);
        })))))
      .child(div().flex_1())
      .child(h_flex().gap(8).justify_end()
        .child(button("cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button("save", "Save", true, () => this.save())));
  }
}
