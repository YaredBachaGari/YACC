// Ports that sandboxed programs mention in their output (localhost:<port>), so the drawer can
// offer to forward them: a CLI's sign-in callback, or a dev server you want to open.
import { create } from "zustand";
import { HOST_TERMINAL } from "../data/types";

interface PortsState {
  /** Terminal id ("bob" for the agent's session, "shell:bob" for its Shell tab) → ports seen, newest last. */
  seen: Record<string, number[]>;
  /** agentId → ports you said "Not now" to. */
  dismissed: Record<string, number[]>;
}

export const usePorts = create<PortsState>(() => ({ seen: {}, dismissed: {} }));

// localhost:8239, 127.0.0.1:3000, and URL-encoded (redirect_uri=http%3A%2F%2Flocalhost%3A8239).
const LOCAL = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::|%3A)(\d{2,5})(?!\d)/gi;
const tails = new Map<string, string>();

/** Called with each chunk of terminal output. Agent terminals and Shell tabs only. */
export function notePorts(terminalId: string, data: string) {
  if (terminalId.startsWith("setup:") || terminalId === HOST_TERMINAL) return;
  // Keep a little of the previous chunk: a URL can arrive split across two.
  const text = (tails.get(terminalId) ?? "") + data;
  tails.set(terminalId, text.slice(-48));
  if (!/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(text)) return;
  const hq = Number(window.location.port) || 0;
  const found: number[] = [];
  for (const m of text.matchAll(LOCAL)) {
    const port = Number(m[1]);
    if (port >= 1024 && port <= 65535 && port !== hq) found.push(port);
  }
  if (!found.length) return;
  usePorts.setState((s) => {
    const prev = s.seen[terminalId] ?? [];
    const next = [...prev.filter((p) => !found.includes(p)), ...new Set(found)];
    return prev.join() === next.join() ? s : { seen: { ...s.seen, [terminalId]: next } };
  });
}

export function dismissPort(agentId: string, port: number) {
  usePorts.setState((s) => ({ dismissed: { ...s.dismissed, [agentId]: [...(s.dismissed[agentId] ?? []), port] } }));
}

export function clearPorts() {
  tails.clear();
  usePorts.setState({ seen: {}, dismissed: {} });
}
