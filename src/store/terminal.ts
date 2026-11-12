// Terminal output is high-frequency, so it lives outside React state:
// a capped buffer per agent plus a tiny pub/sub. Fed only by the office store.

import { clearPorts, notePorts } from "./ports";

type Listener = (data: string) => void;

const MAX_CHARS = 60_000;
const buffers = new Map<string, string>();
const listeners = new Map<string, Set<Listener>>();

export function appendTerminal(agentId: string, data: string) {
  const prev = buffers.get(agentId) ?? "";
  let next = prev + data;
  if (next.length > MAX_CHARS) {
    // Cut at a line break so we never start mid escape sequence.
    const cut = next.indexOf("\n", next.length - MAX_CHARS);
    next = next.slice(cut === -1 ? next.length - MAX_CHARS : cut + 1);
  }
  buffers.set(agentId, next);
  notePorts(agentId, data);
  listeners.get(agentId)?.forEach((fn) => fn(data));
}

export function readTerminal(agentId: string): string {
  return buffers.get(agentId) ?? "";
}

export function subscribeTerminal(agentId: string, fn: Listener): () => void {
  const set = listeners.get(agentId) ?? new Set<Listener>();
  set.add(fn);
  listeners.set(agentId, set);
  return () => set.delete(fn);
}

export function clearTerminals() {
  buffers.clear();
  clearPorts();
  listeners.forEach((set) => set.forEach((fn) => fn("\x1bc"))); // full terminal reset
}
