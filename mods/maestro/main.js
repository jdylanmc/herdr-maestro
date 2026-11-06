import { View } from "gpui-kit";
import { v_flex } from "gpui-base";
import { theme } from "herdr";

export default class Maestro extends View {
  render() {
    const t = theme();
    return v_flex().size_full().bg(t.chrome).p(10).text_size(13)
      .text_color(t.muted).child("Maestro");
  }
}
