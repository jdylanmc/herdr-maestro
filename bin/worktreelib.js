import { realpathSync } from "node:fs";
import path from "node:path";

function canonical(folder) {
  try { return realpathSync(folder); } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    const parent = path.dirname(folder);
    return parent === folder ? folder : path.join(canonical(parent), path.basename(folder));
  }
}

export function insideWorktree(cwd, worktree, paths = path) {
  if (!cwd || !paths.isAbsolute(cwd)) return false;
  const rel = paths.relative(worktree, cwd);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${paths.sep}`) && !paths.isAbsolute(rel));
}

export function worktreeUsers(terminals, worktree) {
  const root = canonical(path.resolve(worktree));
  return terminals.filter((t) => t.state === "live" && t.cwd && path.isAbsolute(t.cwd)
    && insideWorktree(canonical(path.resolve(t.cwd)), root));
}
