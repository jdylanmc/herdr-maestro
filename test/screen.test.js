import { test } from "node:test";
import assert from "node:assert/strict";
import { stripControls, parseRead, screenLines, promptLine } from "../mods/maestro/screen.js";

// Captured from `hc read preview-test --lines 20 --json` (a throwaway `sh -c 'printf …; sleep 60'`).
const CAPTURED = '{"complete":true,"how":"history","text":"hello\\nred text\\n\\n\\nlast line"}\n';

// Synthetic agent screen in the shape `hc read --json` returns for a Copilot terminal.
const AGENT = JSON.stringify({
  complete: false, how: "screen", why: "blocked",
  text: [
    "\x1b[1m● Edited src/app.js\x1b[0m",
    "  Do you want to run `npm test`?",
    "│ 1. Yes                │",
    "│ 2. No, and tell me    │",
    "╻▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄",
    "┃",
    "╹▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
    "   ",
  ].join("\n"),
});

test("parseRead takes text from hc read --json and passes plain output through", () => {
  assert.equal(parseRead(CAPTURED), "hello\nred text\n\n\nlast line");
  assert.equal(parseRead("plain\nscreen"), "plain\nscreen");
  assert.equal(parseRead(""), "");
});

test("screenLines keeps the last non-empty lines of the captured screen", () => {
  assert.deepEqual(screenLines(parseRead(CAPTURED)), ["hello", "red text", "last line"]);
  assert.deepEqual(screenLines(parseRead(CAPTURED), 2), ["red text", "last line"]);
});

test("stripControls removes ANSI, OSC and control characters and honors carriage returns", () => {
  assert.equal(stripControls("\x1b[31mred\x1b[0m \x1b]0;title\x07ok\x1b]8;;http://x\x1b\\link"), "red oklink");
  assert.equal(stripControls("50%\r100%\x07\x08"), "100%");
  assert.equal(stripControls("line\r\nnext"), "line\nnext");
});

test("screenLines drops input frames, strips borders and truncates long lines", () => {
  assert.deepEqual(screenLines(parseRead(AGENT)), ["● Edited src/app.js", "Do you want to run `npm test`?", "1. Yes", "2. No, and tell me"]);
  const [long] = screenLines("x".repeat(300), 8, 20);
  assert.equal(long.length, 20);
  assert.ok(long.endsWith("…"));
});

test("promptLine prefers the latest question, else the last text line", () => {
  assert.equal(promptLine(parseRead(AGENT)), "Do you want to run `npm test`?");
  assert.equal(promptLine(parseRead(CAPTURED)), "last line");
  assert.equal(promptLine(""), "");
});
