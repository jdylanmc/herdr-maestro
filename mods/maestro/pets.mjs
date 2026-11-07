// Renders Codex-format pet sprite sheets (8 columns of 192x208 cells) into one animated
// GIF per mood row, which Herdr's image loader plays natively. Run by helper.mjs:
//   node helper.mjs pets <out-dir> [pet-dir ...]
// Writes <out-dir>/<id>/<row>.gif and <out-dir>/index.json; skips pets already rendered
// from the same sheet (size + mtime).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inflateSync } from "node:zlib";

const COLS = 8, CELL_W = 192, CELL_H = 208, STD_W = 1536;
const COUNTS = [6, 8, 8, 4, 5, 8, 6, 6, 6];
// cmux Maestro's mood rows: [mood atlas row, 9-row fallback].
export const MOOD_ROWS = {
  idle: [0, 0], thinking: [11, 8], working: [7, 7], delegating: [12, 1], question: [6, 6],
  "needs-permission": [13, 6], confused: [14, 8], content: [3, 3], startled: [9, 4], sad: [5, 5],
  compacting: [15, 2], sleepy: [16, 0], gone: [17, 0], proud: [18, 3], celebrating: [19, 4],
};
const frameCount = (row) => (row === 9 || row === 19 ? 5 : row === 12 ? 8 : row === 11 || (row >= 13 && row <= 17) ? 6 : row === 18 ? 4 : COUNTS[row] ?? 6);
const DELAY_CS = 14;
const SCALE = 2; // 192x208 cells become 96x104 GIFs

// ---- PNG decode (8-bit RGB/RGBA/gray/gray-alpha/palette, non-interlaced) ----
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let p = 8, w = 0, h = 0, depth = 0, ct = 0, interlace = 0, pal = null, trns = null;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("latin1", p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ct = data[9]; interlace = data[12]; }
    else if (type === "PLTE") pal = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error(`unsupported PNG (depth ${depth}, interlace ${interlace})`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch, out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, s = x * ch;
      if (ct === 6) { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = cur[s + 3]; }
      else if (ct === 2) { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = 255; }
      else if (ct === 0) { out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = 255; }
      else if (ct === 4) { out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = cur[s + 1]; }
      else { const k = cur[s]; out[o] = pal[k * 3]; out[o + 1] = pal[k * 3 + 1]; out[o + 2] = pal[k * 3 + 2]; out[o + 3] = trns && k < trns.length ? trns[k] : 255; }
    }
    [prev, cur] = [cur, prev];
  }
  return { w, h, px: out };
}

// One cell, box-downscaled by SCALE with premultiplied alpha.
function cell(img, row, col, unit) {
  const cw = Math.round(CELL_W * unit), chh = Math.round(CELL_H * unit);
  const ow = Math.round(CELL_W / SCALE), oh = Math.round(CELL_H / SCALE);
  const out = Buffer.alloc(ow * oh * 4);
  const x0 = col * cw, y0 = Math.round(row * CELL_H * unit);
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const sx0 = x0 + Math.floor((x * cw) / ow), sx1 = x0 + Math.floor(((x + 1) * cw) / ow);
    const sy0 = y0 + Math.floor((y * chh) / oh), sy1 = y0 + Math.floor(((y + 1) * chh) / oh);
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let sy = sy0; sy < Math.max(sy1, sy0 + 1); sy++) for (let sx = sx0; sx < Math.max(sx1, sx0 + 1); sx++) {
      if (sx >= img.w || sy >= img.h) continue;
      const o = (sy * img.w + sx) * 4, al = img.px[o + 3];
      r += img.px[o] * al; g += img.px[o + 1] * al; b += img.px[o + 2] * al; a += al; n++;
    }
    const o = (y * ow + x) * 4;
    if (a) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
    out[o + 3] = n ? a / n : 0;
  }
  return { w: ow, h: oh, px: out };
}

// ---- GIF encode: shared palette by popularity of 5-bit colors, index 255 transparent ----
function palette(frames) {
  const counts = new Map();
  for (const f of frames) for (let i = 0; i < f.px.length; i += 4) {
    if (f.px[i + 3] < 128) continue;
    const k = ((f.px[i] >> 3) << 10) | ((f.px[i + 1] >> 3) << 5) | (f.px[i + 2] >> 3);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 255).map(([k]) => [((k >> 10) & 31) * 8 + 4, ((k >> 5) & 31) * 8 + 4, (k & 31) * 8 + 4]);
  const cache = new Map();
  const nearest = (r, g, b) => {
    const k = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    let best = cache.get(k);
    if (best !== undefined) return best;
    let d = Infinity;
    for (let i = 0; i < top.length; i++) {
      const dr = top[i][0] - r, dg = top[i][1] - g, db = top[i][2] - b, e = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (e < d) { d = e; best = i; }
    }
    cache.set(k, best ?? 0);
    return best ?? 0;
  };
  return { colors: top, nearest };
}

function lzw(indices) {
  const MIN = 8, CLEAR = 256, END = 257;
  const out = [];
  let acc = 0, bits = 0;
  const emit = (code, size) => { acc |= code << bits; bits += size; while (bits >= 8) { out.push(acc & 255); acc >>>= 8; bits -= 8; } };
  let dict = new Map(), next = END + 1, size = MIN + 1;
  emit(CLEAR, size);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const c = indices[i], key = prefix * 256 + c;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix, size);
    if (next < 4096) { dict.set(key, next++); if (next > 1 << size && size < 12) size++; }
    else { emit(CLEAR, size); dict = new Map(); next = END + 1; size = MIN + 1; }
    prefix = c;
  }
  emit(prefix, size);
  emit(END, size);
  if (bits) out.push(acc & 255);
  const blocks = [MIN];
  for (let i = 0; i < out.length; i += 255) { const part = out.slice(i, i + 255); blocks.push(part.length, ...part); }
  blocks.push(0);
  return blocks;
}

export function encodeGif(frames) {
  const { w, h } = frames[0];
  const { colors, nearest } = palette(frames);
  const bytes = [...Buffer.from("GIF89a"), w & 255, w >> 8, h & 255, h >> 8, 0xf7, 255, 0];
  for (let i = 0; i < 256; i++) { const c = colors[i] ?? [0, 0, 0]; bytes.push(c[0], c[1], c[2]); }
  bytes.push(0x21, 0xff, 11, ...Buffer.from("NETSCAPE2.0"), 3, 1, 0, 0, 0);
  for (const f of frames) {
    bytes.push(0x21, 0xf9, 4, 0x09, DELAY_CS, 0, 255, 0); // disposal 2, transparent index 255
    bytes.push(0x2c, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0);
    const idx = new Array(w * h);
    for (let i = 0; i < w * h; i++) { const o = i * 4; idx[i] = f.px[o + 3] < 128 ? 255 : nearest(f.px[o], f.px[o + 1], f.px[o + 2]); }
    for (const b of lzw(idx)) bytes.push(b);
  }
  bytes.push(0x3b);
  return Buffer.from(bytes);
}

// ---- Pets ----
function loadSheet(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) === 0x89504e47) return decodePng(buf);
  // WebP and others: let the platform convert (macOS sips; Windows/Linux need ImageMagick).
  const dir = mkdtempSync(join(tmpdir(), "maestro-pet-"));
  try {
    const png = join(dir, "sheet.png");
    if (process.platform === "darwin") execFileSync("sips", ["-s", "format", "png", path, "--out", png], { stdio: "ignore" });
    else execFileSync("magick", [path, png], { stdio: "ignore" });
    return decodePng(readFileSync(png));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export function renderPet(manifestPath, outRoot) {
  const petDir = dirname(manifestPath);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const id = manifest.id;
  if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) throw new Error("bad pet id");
  const sheet = join(petDir, manifest.spritesheetPath ?? "spritesheet.webp");
  const st = statSync(sheet);
  const stamp = `${st.size}:${Math.floor(st.mtimeMs)}`;
  const out = join(outRoot, id);
  const metaPath = join(out, "meta.json");
  if (existsSync(metaPath)) { try { const m = JSON.parse(readFileSync(metaPath, "utf8")); if (m.stamp === stamp) return m; } catch {} }
  const img = loadSheet(sheet);
  if (img.w % COLS) throw new Error(`width ${img.w} is not 8 columns`);
  const unit = img.w / STD_W;
  const rows = Math.floor(img.h / Math.round(CELL_H * unit));
  const moods = rows >= 20;
  mkdirSync(out, { recursive: true });
  const wanted = new Set(Object.values(MOOD_ROWS).map(([m, f]) => (moods ? m : f)));
  const made = [];
  for (const row of wanted) {
    if (row >= rows) continue;
    const frames = [];
    for (let c = 0; c < frameCount(row); c++) frames.push(cell(img, row, c, unit));
    writeFileSync(join(out, `${row}.gif`), encodeGif(frames));
    made.push(row);
  }
  const meta = { id, name: manifest.displayName ?? id, moods, rows: made.sort((a, b) => a - b), stamp };
  writeFileSync(metaPath, JSON.stringify(meta));
  return meta;
}

export function renderAll(outRoot, roots) {
  mkdirSync(outRoot, { recursive: true });
  const index = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    // A manifest file, a pet folder, or a folder of pet folders.
    const dirs = root.endsWith(".json") ? [root] : existsSync(join(root, "pet.json")) ? [join(root, "pet.json")]
      : readdirSync(root).map((d) => join(root, d, "pet.json")).filter((f) => existsSync(f));
    for (const d of dirs) {
      try { const m = renderPet(d, outRoot); if (!index.some((x) => x.id === m.id)) index.push({ id: m.id, name: m.name, moods: m.moods, rows: m.rows }); }
      catch (e) { index.push({ id: dirname(d).split(/[\\/]/).pop(), error: String(e.message ?? e) }); }
    }
  }
  writeFileSync(join(outRoot, "index.json"), JSON.stringify(index));
  return index;
}
