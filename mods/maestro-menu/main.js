// Maestro's terminal right-click menu (layout root "terminal_menu"): Copy and Paste, then
// Herdr's shipped terminal menu items unchanged (cloned from mods/menu). Herdr opens it as a
// pointer popup with props { tab: "pane", target: { pane, terminal }, overlay }.
// ↑/↓ move, Enter runs, Esc closes. An item is [label, command, args].

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, theme, keys, terminals, panes } from "herdr";

function items(p) {
  const tg = p?.target ?? {};
  const all = terminals();
  const term = all.find((t) => t.address === tg.terminal);
  const parent = term?.parent && all.find((t) => t.address === term.parent);
  // Once they go to the program, Shift+right-click still opens this menu.
  const toProgram = term?.labels?.["herdr.right-click"] === "program";
  // A terminal shown outside a tab (a layout terminal block, a window) has
  // no pane to split, zoom or close: its pane is the block's id.
  const inTab = panes().some((pane) => pane.pane === tg.pane);
  // Copy and paste follow keyboard focus, so they first focus the clicked terminal.
  const target = inTab ? { pane: tg.pane } : tg.terminal ? { terminal: tg.terminal } : null;
  return [
    ...(target
      ? [
          ["Copy", "terminal.copy", target],
          ["Paste", "terminal.paste", target],
        ]
      : []),
    ...(inTab
      ? [
          ["Split right", "pane.split", { direction: "right", pane: tg.pane }],
          ["Split down", "pane.split", { direction: "down", pane: tg.pane }],
          ["Zoom", "pane.zoom", { pane: tg.pane }],
        ]
      : []),
    ...(term
      ? [
          toProgram
            ? ["Use Herdr right-click menu", "terminal.right_click", { terminal: term.address, to: "menu" }]
            : ["Send right-clicks to pane", "terminal.right_click", { terminal: term.address, to: "program" }],
        ]
      : []),
    ...(parent ? [[`Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: term.address }]] : []),
    ...(inTab ? [["Close pane", "pane.close", { pane: tg.pane }]] : []),
  ];
}

const clipboard = (command) => command === "terminal.copy" || command === "terminal.paste";

function act(it) {
  if (!clipboard(it[1])) return run(it[1], it[2]);
  run("pane.focus", it[2]);
  run(it[1], {});
}

function menuIcon(command) {
  // Shipped icons: SVGs inside a symlinked mod folder do not render (docs/GAPS.md G-21).
  const name = command === "terminal.copy" ? "files" : command === "terminal.paste" ? "file-text" : command.endsWith(".close") ? "x" : command === "pane.split" ? "panel-right" : command === "pane.zoom" ? "square" : "terminal";
  return `mods/workspace-chrome/${name}.svg`;
}

// The key bound to a command, for the hint on the right.
function shortcut(name, args) {
  if (clipboard(name)) return keys().find((b) => b.section === "terminal" && b.action === name)?.keys ?? "";
  // `pane.split:right` binds pane.split with { direction: "right" }.
  const value = args && Object.values(args)[0];
  const k = keys().find((b) => b.section === "global" && (b.action === name || b.action === `${name}:${value}`));
  return k ? k.keys : "";
}

// A rule above Close and between the clipboard items and the rest.
const ruleAbove = (list, i) => i > 0 && (list[i][1].endsWith(".close") || (clipboard(list[i - 1][1]) && !clipboard(list[i][1])));

export default class MaestroMenu extends View {
  init(_props, cx) {
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  choose(i, _cx) {
    const it = items(props())[i];
    if (!it) return;
    closeOverlay(props()?.overlay);
    act(it);
  }

  render(cx) {
    const t = theme();
    const list = items(props());
    return v_flex()
      .id("maestro-menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(
        list.map((it, i) =>
          v_flex()
            .when(ruleAbove(list, i), (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
            .child(h_flex()
            .id(`mi-${i}`)
            .h(31)
            .px(8)
            .gap(9)
            .rounded(7)
            .items_center()
            .justify_between()
            .text_color(t.foreground)
            .when(i === this.at, (el) => el.bg(t.selected))
            .hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.choose(i, cx))
            .child(svg(menuIcon(it[1])).size(14).flex_none().text_color(t.muted))
            .child(div().flex_1().child(it[0]))
            .child(div().text_size(11).text_color(t.dim).child(shortcut(it[1], it[2])))),
        ),
      );
  }
}
