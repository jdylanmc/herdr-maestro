// Shared test helpers: tiny in-memory PNGs and scratch directories.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

// An 8-bit PNG; `rows` are [filter, ...raw scanline bytes].

const chunk = (type, data) => {
  const len = Buffer.alloc(4), crc = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

export function png(w, h, colorType, rows, extra = []) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...extra.map(([t, d]) => chunk(t, d)),
    chunk("IDAT", deflateSync(Buffer.from(rows.flat()))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Unfiltered RGBA image where pixel (x, y) is fill(x, y) -> [r, g, b, a].
export function rgba(w, h, fill) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = [0];
    for (let x = 0; x < w; x++) row.push(...fill(x, y));
    rows.push(row);
  }
  return png(w, h, 6, rows);
}

// Per-test scratch directory inside the checkout (git-ignored), removed after the test.
export function scratch(t) {
  const base = fileURLToPath(new URL("../.test-tmp/", import.meta.url));
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(base);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
