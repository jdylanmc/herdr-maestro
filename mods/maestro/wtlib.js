// Worktree paths, kinds and nesting shared by the Maestro mod and the `maestro` CLI.
// Pure: no Node or Herdr imports, so both can load it.

export const KINDS = ["sibling", "herdr"];

// Herdr's worktree mod (mods/worktree): checkouts in <home>/.herdr/worktrees/<repo>/<slug>.
export const herdrSlug = (branch) => String(branch).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
const trim = (p) => String(p).replace(/[\\/]+$/, "");
export const herdrRoot = (home) => `${trim(home).replace(/\\/g, "/")}/.herdr/worktrees`;
export const herdrPath = (home, repo, branch) => `${herdrRoot(home)}/${repo}/${herdrSlug(branch)}`;

// Maestro's own: a sibling checkout <parent of repo>/<repo>-<branch>.
export function siblingPath(top, branch) {
  const t = trim(top);
  const cut = Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\"));
  const sep = cut >= 0 ? t[cut] : "/";
  return `${t.slice(0, cut)}${sep}${t.slice(cut + 1)}-${String(branch).replace(/[^A-Za-z0-9._-]+/g, "-")}`;
}

// The main checkout and name of a repo from `git rev-parse --path-format=absolute --git-common-dir`.
export function repoOf(commonDir) {
  const c = trim(String(commonDir).trim()).replace(/\\/g, "/");
  const main = c.endsWith("/.git") ? c.slice(0, -5) : c;
  return { main, name: main.split("/").pop().replace(/\.git$/, "") };
}

// Which kind `maestro spawn --worktree` makes: a flag wins, then MAESTRO_WORKTREE, then
// shared("maestro.worktreeKind"), else sibling.
export function chooseKind(flags = [], env = {}, shared = {}) {
  if (flags.includes("--herdr-space")) return "herdr";
  if (flags.includes("--sibling")) return "sibling";
  for (const v of [env.MAESTRO_WORKTREE, shared?.["maestro.worktreeKind"]]) if (KINDS.includes(v)) return v;
  return "sibling";
}

// Entries written before kinds existed are sibling checkouts.
export const kindOf = (entry) => (KINDS.includes(entry?.kind) ? entry.kind : "sibling");

const inside = (p, dir) => {
  const [a, b] = [p, dir].map((x) => trim(String(x ?? "")).replace(/\\/g, "/"));
  return Boolean(a && b) && (a === b || a.startsWith(b + "/"));
};

// Why a worktree must stay: its worker or any live terminal still in it (always),
// or uncommitted changes (unless forced). null: it may go.
export function removalBlocker({ path, displayPath = path, entry = {}, live = [], dirty = false, force = false }) {
  const addrs = new Set(live.map((t) => t.address));
  if (entry.terminal && addrs.has(entry.terminal)) return `its worker ${entry.terminal} is still running`;
  const there = live.find((t) => inside(t.cwd, path));
  if (there) return `live terminal ${there.address} is in it`;
  if (dirty && !force) return `${displayPath} has uncommitted changes (use --force)`;
  return null;
}

// Where a space is: its first terminal's folder, else where it was made (as Herdr's spaces list).
export function spacePlace(space, panes = []) {
  if (!space) return null;
  const tabs = new Set((space.tabs ?? []).map((c) => c.id));
  return panes.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || space.folder || null;
}

// Spaces in order with each worktree space moved under its repo's main-checkout space,
// mirroring Herdr's spaces sidebar. rows: [{ id, g: { main, linked } | null }].
// Returns the rows with tree: null (top level), "├─" or "└─" (nested).
export function nestSpaces(rows) {
  const mains = new Set(rows.filter((r) => r.g && !r.g.linked).map((r) => r.g.main));
  const nested = (r) => Boolean(r.g?.linked && mains.has(r.g.main));
  const out = [];
  const placed = new Set();
  for (const r of rows) {
    if (nested(r)) continue;
    out.push({ ...r, tree: null });
    if (!r.g || r.g.linked || placed.has(r.g.main)) continue;
    placed.add(r.g.main);
    const kids = rows.filter((k) => nested(k) && k.g.main === r.g.main);
    kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
  }
  return out;
}
