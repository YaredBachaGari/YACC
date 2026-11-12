// Sandbox sizing maths shared by settings and the agent drawer.

import type { AgentConfig, MachineInfo, SandboxResources, SessionInfo } from "../data/types";

/** sbx defaults: all host CPUs; 50% of RAM clamped to 0.5–32 GB. */
export function sbxDefault(m: MachineInfo) {
  return { cpus: m.cpus, memoryGb: Math.min(32, Math.max(0.5, m.memoryGb / 2)) };
}

export function effective(r: SandboxResources, m: MachineInfo) {
  const d = sbxDefault(m);
  return { cpus: r.cpus ?? d.cpus, memoryGb: r.memoryGb ?? d.memoryGb };
}

/** sbx's ceiling: 75% of RAM, in 0.5 GB steps. */
export const maxMemory = (m: MachineInfo) => Math.max(0.5, Math.floor(m.memoryGb * 0.75 * 2) / 2);

export function teamBudget(team: AgentConfig[], m: MachineInfo) {
  const sandboxed = team.filter((a) => a.mode === "sandbox");
  const sum = sandboxed.reduce(
    (acc, a) => {
      const e = effective(a.sandbox.resources, m);
      return { cpus: acc.cpus + e.cpus, memoryGb: acc.memoryGb + e.memoryGb };
    },
    { cpus: 0, memoryGb: 0 },
  );
  return { ...sum, count: sandboxed.length, overMemory: sum.memoryGb > m.memoryGb };
}

/** True when the existing sandbox was created with a different size than the setting asks for. */
export function sizeMismatch(r: SandboxResources, session: SessionInfo, m: MachineInfo): boolean {
  if (!session.sandbox) return false;
  const want = effective(r, m);
  return want.cpus !== session.sandbox.cpus || Math.abs(want.memoryGb - session.sandbox.memoryGb) > 0.26;
}

export const fmtGb = (gb: number) => `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
