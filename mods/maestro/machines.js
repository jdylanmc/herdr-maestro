// Remote machines: pure helpers for grouping spaces by machine and reading another
// machine's Maestro setup. No Herdr imports, so node:test can load it.

// "vps/t3" -> "vps"; a bare address lives on this computer (null).
export const machineOf = (address) => {
  const i = typeof address === "string" ? address.indexOf("/") : -1;
  return i > 0 ? address.slice(0, i) : null;
};
export const localAddress = (address) => (machineOf(address) ? address.slice(address.indexOf("/") + 1) : address);

// Remote machine names known from spaces and `hc machine ls` (temporary ones skipped), sorted.
export function remoteNames(spaceList, known) {
  const names = [
    ...(spaceList ?? []).map((s) => s.machine).filter(Boolean),
    ...(known ?? []).filter((m) => m && !m.temporary && m.name).map((m) => m.name),
  ];
  return [...new Set(names)].sort();
}

// The space list with a header entry before each machine's spaces, this computer first;
// spaces of folded machines are left out. Unchanged when only this computer is known.
// `folded(name)` says whether that machine's header is folded.
export function spaceEntries(spaceList, known, folded = () => false) {
  const list = spaceList ?? [];
  const remote = remoteNames(list, known);
  if (!remote.length) return list;
  const out = [];
  for (const name of [null, ...remote]) {
    const spaces = list.filter((s) => (s.machine ?? null) === name);
    const machine = name ? (known ?? []).find((m) => m.name === name) ?? null : null;
    const isFolded = Boolean(folded(name));
    out.push({ header: true, id: `mc:${name ?? "local"}`, name, state: name ? machine?.state ?? null : "connected", spaces, folded: isFolded });
    if (!isFolded) out.push(...spaces);
  }
  return out;
}

// Node one-liner run on a machine (exec "node" -e): where its Herdr home is and whether
// Maestro's helper is installed there. Answers JSON on one line.
export const PROBE = "const o=require('os'),f=require('fs'),p=require('path');"
  + "const a=process.env.HERDR_APP_HOME||p.join(o.homedir(),'.config','herdr-app');"
  + "const h=p.join(a,'mods','maestro','helper.mjs');"
  + "process.stdout.write(JSON.stringify({home:o.homedir(),app:a,helper:f.existsSync(h)?h:null}))";

// The probe's answer, or null when it isn't one.
export function parseProbe(stdout) {
  let v;
  try { v = JSON.parse(String(stdout ?? "").trim()); } catch { return null; }
  if (!v || typeof v.home !== "string" || !v.home || typeof v.app !== "string") return null;
  return { home: v.home, app: v.app, helper: typeof v.helper === "string" && v.helper ? v.helper : null };
}

// argv for a new agent on a machine: through that machine's helper when it has one
// (drops inherited CMUX_* variables), else as given.
export const remoteArgv = (argv, helperPath) => (helperPath ? ["node", helperPath, "run", ...argv] : [...argv]);
