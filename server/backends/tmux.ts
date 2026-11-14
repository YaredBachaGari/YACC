// macOS and Linux: each agent runs in a tmux session, so it keeps running when
// HQ or the browser closes. HQ attaches a pty to show its terminal.

import { spawn as spawnPty } from "@lydell/node-pty";
import { chmodSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, shq } from "../lib/exec";
import * as tmux from "./tmuxCli";
import type { LaunchSpec, SessionBackend } from "./types";

const TERM_ENV = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" } as Record<string, string>;

/** Quotes for a POSIX shell only when needed, so simple commands stay readable. */
const q = (s: string) => (/^[A-Za-z0-9_\-.,:/=@%+]+$/.test(s) ? s : shq(s));

/**
 * Shell code that exports each KEY=value line of an env file literally, like `sbx --env-file`
 * (no $-expansion, spaces kept; comments and blank lines skipped). HQ itself never reads the file.
 */
export const loadEnvFile = (quotedPath: string) =>
  // CRLF files: drop the \r. Lines whose key isn't a valid name are skipped (export would stop the shell).
  // Scratch names are unlikely to clash with app variables and are unset afterwards; the CR is
  // computed per line, so nothing in the file can change it.
  `while IFS= read -r __yacc_l || [ -n "$__yacc_l" ]; do __yacc_l=\${__yacc_l%"$(printf '\\r')"}; __yacc_k=\${__yacc_l%%=*}; ` +
  `case "$__yacc_l" in *=*) case "$__yacc_k" in ""|[!A-Za-z_]*|*[!A-Za-z0-9_]*) ;; *) export "$__yacc_l";; esac;; esac; done < ${quotedPath}; ` +
  `unset __yacc_l __yacc_k`;

/** Where HQ's own variables for a session go (owner-only): keys stay out of the command line and `ps`. */
export const sessionEnvFile = (name: string) => join(tmpdir(), `yacc-${name.replace(/[^A-Za-z0-9_.-]/g, "_")}.env`);

/** KEY=value lines, as loadEnvFile reads them. A value with a newline can't be one line, so it's dropped. */
export const envLines = (env: Record<string, string>) =>
  Object.entries(env)
    .filter(([k, v]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && !/[\r\n]/.test(v))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n";

/** The shell line tmux runs. Local mode loads HQ's variables, then the app's env file, into that shell. */
export function shellCommand(spec: LaunchSpec, hqEnvFile: string | null = null): string {
  const files = [hqEnvFile, spec.envFile].filter((f): f is string => !!f);
  const load = files.map((f) => `${loadEnvFile(shq(f))} && `).join("");
  return load + [spec.file, ...spec.args].map(q).join(" ");
}

export const tmuxBackend: SessionBackend = {
  kind: "tmux",
  persistent: true,

  exists: (name) => tmux.hasSession(name),

  async create(name, cwd, spec) {
    let hqEnv: string | null = null;
    if (spec.env && Object.keys(spec.env).length) {
      hqEnv = sessionEnvFile(name);
      writeFileSync(hqEnv, envLines(spec.env), { mode: 0o600 });
      chmodSync(hqEnv, 0o600); // an older file keeps its mode otherwise
    }
    await tmux.newSession(name, cwd, shellCommand(spec, hqEnv));
  },

  async kill(name) {
    await tmux.killSession(name);
    rmSync(sessionEnvFile(name), { force: true });
  },

  attach(name, size, onData, onEnd) {
    const pty = spawnPty("tmux", ["attach-session", "-t", `=${name}`], { name: "xterm-256color", cols: size.cols, rows: size.rows, env: TERM_ENV });
    pty.onData(onData);
    pty.onExit(onEnd);
    return { write: (d) => pty.write(d), resize: (c, r) => pty.resize(c, r), close: () => pty.kill() };
  },

  async type(name, text) {
    if (!(await tmux.hasSession(name))) return false;
    return (await run("tmux", ["send-keys", "-t", `=${name}:`, "-l", text], { timeoutMs: 5000 })).ok;
  },

  async enter(name) {
    return (await run("tmux", ["send-keys", "-t", `=${name}:`, "Enter"], { timeoutMs: 5000 })).ok;
  },

  exitInfo: (name) => tmux.paneInfo(name),

  screenText: (name, lines) => tmux.tailText(name, lines),

  shutdown() {
    // Nothing to do: tmux keeps the agents running.
  },
};
