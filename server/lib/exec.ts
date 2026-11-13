import { execFile } from "node:child_process";

export interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs a program without a shell. Never throws; check `ok`. */
export function run(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number; input?: string } = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      { cwd: opts.cwd, timeout: opts.timeoutMs ?? 20_000, maxBuffer: 8 * 1024 * 1024, env: process.env },
      (err, stdout, stderr) => {
        const code = err && typeof (err as NodeJS.ErrnoException).code === "number" ? Number((err as NodeJS.ErrnoException).code) : err ? null : 0;
        resolve({ ok: !err, code: err ? (code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr || (err && !stderr ? err.message : "")) });
      },
    );
    if (opts.input !== undefined) child.stdin?.end(opts.input);
  });
}

/** One PATH entry, normalised for comparing: case-insensitive, no trailing slash, no quotes. */
const pathKey = (entry: string) => entry.trim().replace(/^"|"$/g, "").replace(/[\\/]+$/, "").toLowerCase();

/**
 * Adds to `current` the PATH entries Windows has in the registry that the running process doesn't
 * know about. `regOutputs` are the outputs of `reg query ... /v Path` (machine first, then user).
 * Entries already present keep their place, so nothing a terminal set up is lost or reordered.
 */
export function mergeWindowsPath(current: string, regOutputs: string[], env: Record<string, string | undefined>): string {
  const lookup = new Map(Object.entries(env).map(([k, v]) => [k.toLowerCase(), v ?? ""]));
  const expand = (s: string) => s.replace(/%([^%;]+)%/g, (whole, name: string) => lookup.get(name.toLowerCase()) || whole);
  const entries = current.split(";").filter((e) => e.trim());
  const seen = new Set(entries.map(pathKey));
  for (const out of regOutputs) {
    const value = out.match(/^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im)?.[1] ?? "";
    for (const raw of value.split(";")) {
      const entry = expand(raw.trim());
      // An entry whose %VARIABLE% couldn't be filled in is no use to anyone.
      if (!entry || entry.includes("%") || seen.has(pathKey(entry))) continue;
      seen.add(pathKey(entry));
      entries.push(entry);
    }
  }
  return entries.join(";");
}

/**
 * Windows only: a program installed while HQ is running (winget, an installer) is added to the
 * PATH in the registry, but a running process keeps the PATH it started with. This re-reads the
 * registry so the setup checks, and agents started afterwards, can find it without restarting HQ.
 * Returns the entries that were added.
 */
export async function refreshWindowsPath(): Promise<string[]> {
  if (process.platform !== "win32") return [];
  const [machine, user] = await Promise.all([
    run("reg", ["query", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment", "/v", "Path"], { timeoutMs: 5000 }),
    run("reg", ["query", "HKCU\\Environment", "/v", "Path"], { timeoutMs: 5000 }),
  ]);
  const before = process.env.PATH ?? "";
  const after = mergeWindowsPath(before, [machine.ok ? machine.stdout : "", user.ok ? user.stdout : ""], process.env);
  if (after === before) return [];
  process.env.PATH = after;
  const had = new Set(before.split(";").map(pathKey));
  return after.split(";").filter((e) => !had.has(pathKey(e)));
}

/** True when `cmd` is on PATH. */
export async function has(cmd: string): Promise<boolean> {
  const r = process.platform === "win32" ? await run("where", [cmd], { timeoutMs: 5000 }) : await run("sh", ["-c", `command -v ${cmd}`], { timeoutMs: 5000 });
  return r.ok && r.stdout.trim().length > 0;
}

/** Quotes a value for a POSIX shell command line. */
export function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
