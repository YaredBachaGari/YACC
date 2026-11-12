import { ptyBackend } from "./pty";
import { tmuxBackend } from "./tmux";
import type { SessionBackend } from "./types";

export type { LaunchSpec, SessionBackend, TermHandle } from "./types";

/**
 * tmux on macOS and Linux; HQ-owned ptys on Windows, which has no tmux.
 * HQ_SESSION_BACKEND=pty|tmux overrides it (used to test the pty backend anywhere).
 */
export function usesTmux(): boolean {
  const forced = process.env.HQ_SESSION_BACKEND;
  if (forced === "pty" || forced === "tmux") return forced === "tmux";
  return process.platform !== "win32";
}

export function sessionBackend(): SessionBackend {
  return usesTmux() ? tmuxBackend : ptyBackend;
}
