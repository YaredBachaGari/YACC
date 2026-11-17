// The audit log (plan step 7.1): who did what, for things that matter later. Assignments,
// reviews and approvals, access grants, hires and removals, keys set or removed (never their
// values), budgets, schedules, templates and every settings change. Kept on this machine, one
// file per month, and never sent anywhere.

import type { AgentConfig, HqConfig, RoleConfig } from "./types";

export type AuditKind = "assign" | "review" | "approval" | "access" | "team" | "config" | "secret" | "budget" | "schedule" | "template" | "retro";

export const AUDIT_KINDS: { id: AuditKind; label: string }[] = [
  { id: "assign", label: "Assignments" },
  { id: "review", label: "Reviews" },
  { id: "approval", label: "Your approvals" },
  { id: "access", label: "Website access" },
  { id: "team", label: "Hires and removals" },
  { id: "config", label: "Settings" },
  { id: "secret", label: "Keys" },
  { id: "budget", label: "Budgets" },
  { id: "schedule", label: "Schedules" },
  { id: "template", label: "Templates" },
  { id: "retro", label: "Retrospectives" },
];

export interface AuditEntry {
  at: string;
  kind: AuditKind;
  /** Who did it: "you", an agent id, "hq", "config.yml" (a hand edit) or "schedule:<id>". */
  actor: string;
  /** One line a person can read. */
  summary: string;
  /** What it was about: a task, agent, role or domain id, when there is one. */
  target?: string;
}

export const AUDIT_SUMMARY_MAX = 500;

/** Who an actor is, in words. */
export function actorName(actor: string, cfg: Pick<HqConfig, "team" | "ceo">): string {
  if (actor === "you" || actor === "ceo") return `${cfg.ceo.name} (you)`;
  if (actor === "hq") return "HQ";
  if (actor === "config.yml") return "config.yml, edited by hand";
  if (actor.startsWith("schedule:")) return `Schedule ${actor.slice(9)}`;
  return cfg.team.find((a) => a.id === actor)?.name ?? actor;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const SECTIONS: [keyof HqConfig, string][] = [
  ["project", "project"],
  ["ceo", "CEO"],
  ["limits", "limits"],
  ["autonomy", "autonomy"],
  ["workflow", "workflow"],
  ["stack", "coding stack"],
  ["toolkits", "toolkits"],
  ["skills", "team skills"],
  ["messaging", "messaging rules"],
  ["schedules", "schedules"],
  ["providers", "sign-in"],
  ["routing", "routing"],
  ["prices", "prices"],
];

/** The fields of an agent that changed, by name. */
function agentChanges(a: AgentConfig, b: AgentConfig): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof AgentConfig)[]);
  return [...keys].filter((k) => k !== "role" && k !== "isLead" && !same(a[k], b[k])).sort();
}

function roleChanges(a: RoleConfig, b: RoleConfig): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof RoleConfig)[]);
  return [...keys].filter((k) => !same(a[k], b[k])).sort();
}

/**
 * What changed between two configs, as short lines: "added agent Gus (Designer)",
 * "Ada: model, reportsTo", "role Writer: instructions", "workflow". Empty when nothing did.
 */
export function describeConfigChange(before: HqConfig, after: HqConfig): string[] {
  const out: string[] = [];
  for (const a of after.team) {
    const was = before.team.find((x) => x.id === a.id);
    if (!was) out.push(`added agent ${a.name} (${a.role})`);
    else {
      const changed = agentChanges(was, a);
      if (changed.length) out.push(`${a.name}: ${changed.join(", ")}`);
    }
  }
  for (const a of before.team) if (!after.team.some((x) => x.id === a.id)) out.push(`removed agent ${a.name}`);
  for (const r of after.roles) {
    const was = before.roles.find((x) => x.id === r.id);
    if (!was) out.push(`added role ${r.title}`);
    else {
      const changed = roleChanges(was, r);
      if (changed.length) out.push(`role ${r.title}: ${changed.join(", ")}`);
    }
  }
  for (const r of before.roles) if (!after.roles.some((x) => x.id === r.id)) out.push(`removed role ${r.title}`);
  for (const [key, label] of SECTIONS) if (!same(before[key], after[key])) out.push(label);
  return out;
}

/** Entries as CSV (for spreadsheets): at, kind, actor, target, summary. */
export function auditCsv(entries: AuditEntry[], cfg: Pick<HqConfig, "team" | "ceo">): string {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return ["at,kind,actor,target,summary", ...entries.map((e) => [e.at, e.kind, actorName(e.actor, cfg), e.target ?? "", e.summary].map(cell).join(","))].join("\n") + "\n";
}
