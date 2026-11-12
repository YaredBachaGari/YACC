// Windows (no tmux): HQ runs each agent itself through node-pty (ConPTY) and
// keeps a headless terminal per agent to read its screen. Agents stop when HQ
// stops; their sandboxes and folders are kept. Also usable on macOS/Linux with
// HQ_SESSION_BACKEND=pty, which is how it's tested without a Windows machine.

import { spawn as spawnPty, type IPty } from "@lydell/node-pty";
import xtermHeadless from "@xterm/headless";
import { run } from "../lib/exec";
import type { ExitInfo, SessionBackend, TermSize } from "./types";

const { Terminal } = xtermHeadless;

const TERM_ENV = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" } as Record<string, string>;

interface Proc {
  pty: IPty;
  screen: InstanceType<typeof Terminal>;
  exit: ExitInfo;
  views: Set<(data: string) => void>;
  ends: Set<() => void>;
}

const procs = new Map<string, Proc>();

/**
 * Windows doesn't search PATH the way a shell does for npm's `.cmd` shims, so
 * find the program with `where`; `.cmd`/`.bat` files run through cmd.exe.
 */
export async function resolveCommand(file: string, args: string[]): Promise<{ file: string; args: string[] }> {
  if (process.platform !== "win32" || /[\\/]/.test(file)) return { file, args };
  const r = await run("where", [file], { timeoutMs: 5000 });
  const found = r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const exe = found.find((p) => /\.exe$/i.test(p));
  if (exe) return { file: exe, args };
  const script = found.find((p) => /\.(cmd|bat)$/i.test(p));
  if (script) return { file: "cmd.exe", args: ["/d", "/s", "/c", script, ...args] };
  throw new Error(`${file} was not found on PATH.`);
}

export const ptyBackend: SessionBackend = {
  kind: "pty",
  persistent: false,

  async exists(name) {
    return procs.has(name);
  },

  async create(name, cwd, spec, size) {
    if (procs.has(name)) return;
    // There's no shell to load an env file into (sandbox mode passes it to sbx instead).
    const { file, args } = await resolveCommand(spec.file, spec.args);
    const pty = spawnPty(file, args, { name: "xterm-256color", cols: size.cols, rows: size.rows, cwd, env: TERM_ENV });
    const screen = new Terminal({ cols: size.cols, rows: size.rows, scrollback: 300, allowProposedApi: true });
    const proc: Proc = { pty, screen, exit: { dead: false, exitStatus: null }, views: new Set(), ends: new Set() };
    pty.onData((d) => {
      screen.write(d);
      for (const view of proc.views) view(d);
    });
    pty.onExit(({ exitCode }) => {
      proc.exit = { dead: true, exitStatus: exitCode };
    });
    procs.set(name, proc);
  },

  async kill(name) {
    const proc = procs.get(name);
    if (!proc) return;
    procs.delete(name);
    if (!proc.exit.dead) proc.pty.kill();
    proc.screen.dispose();
    for (const end of proc.ends) end();
  },

  attach(name, size: TermSize, onData, onEnd) {
    const proc = procs.get(name);
    if (!proc) {
      queueMicrotask(onEnd);
      return { write() {}, resize() {}, close() {} };
    }
    proc.views.add(onData);
    proc.ends.add(onEnd);
    const resize = (cols: number, rows: number) => {
      if (proc.exit.dead) return;
      proc.pty.resize(cols, rows);
      proc.screen.resize(cols, rows);
    };
    resize(size.cols, size.rows);
    return {
      write: (d) => !proc.exit.dead && proc.pty.write(d),
      resize,
      close: () => {
        proc.views.delete(onData);
        proc.ends.delete(onEnd);
      },
    };
  },

  async type(name, text) {
    const proc = procs.get(name);
    if (!proc || proc.exit.dead) return false;
    proc.pty.write(text);
    return true;
  },

  async enter(name) {
    const proc = procs.get(name);
    if (!proc || proc.exit.dead) return false;
    proc.pty.write("\r");
    return true;
  },

  async exitInfo(name) {
    return procs.get(name)?.exit ?? null;
  },

  async screenText(name, lines) {
    const proc = procs.get(name);
    if (!proc) return "";
    // Writes are applied asynchronously; let pending output land first.
    await new Promise<void>((r) => proc.screen.write("", r));
    const buf = proc.screen.buffer.active;
    const out: string[] = [];
    for (let i = 0; i < buf.length; i++) out.push(buf.getLine(i)?.translateToString(true).trimEnd() ?? "");
    return out.filter(Boolean).slice(-lines).join("\n");
  },

  shutdown() {
    for (const proc of procs.values()) if (!proc.exit.dead) proc.pty.kill();
    procs.clear();
  },
};
