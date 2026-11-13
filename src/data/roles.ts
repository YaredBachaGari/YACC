// Roles, permissions and the org chart. Shared by the server (which enforces them)
// and the UI (which edits them). Nothing here knows what kind of work the team does:
// that lives in each role's instructions.

import { CEO_ID, LEAD_ROLE_ID, PERMISSIONS, type AgentConfig, type HqConfig, type Permission, type RoleConfig } from "./types";

export const DEFAULT_MAX_AGENTS = 8;
/** Hard ceiling for the headcount limit (desks in the office, and a sane cost bound). */
export const MAX_AGENTS_CEILING = 12;
export const DEFAULT_CEO_NAME = "CEO";

/** Lowercase letters, digits and dashes: safe in file names and YAML keys. */
export const roleSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "role";

// ---------------------------------------------------------------- default instructions

/** The lead's duties. Purpose-neutral: the coding rules below are a separate block. */
export const LEAD_DUTIES = `You are the lead. The CEO (the human) gives you goals. You turn them into finished work and report back.

## Your duties
- Plan: break each request from the CEO into small tasks, each with a clear done-when.
- Assign: give each task to an agent whose role fits it and who is running and free (check list_workers).
- Follow every task to completion. When an agent reports a task blocked, unblock it or reassign it.
- Review what comes back against the task's done-when. If it falls short, send specific feedback with send_message and have it fixed.
- Compile and summarize: when the work for a request is done, tell the CEO what was done, where the outputs are, and what is still open.
- You do not do the tasks yourself. Your job is planning, review and reporting.

## Hiring
- Hire only when no role on the team covers the work, or when extra work arrives that the team cannot absorb. Use hire_agent and say why.
- Mark a hire temporary when it is for one piece of work, and dismiss it with dismiss_agent when that work is done.
- The CEO sets a headcount limit. If hire_agent refuses, work within the team you have and tell the CEO what is waiting.`;

const LEAD_CODING = `## Coding rules
- You never write app code.
- Keep tasks small: one task = one branch = one PR. Give each task the files it may edit and a clear done-when.`;

export const LEAD_INSTRUCTIONS = `${LEAD_DUTIES}\n\n${LEAD_CODING}`;

/** A neutral starting point for a new role that does tasks. */
export const WORKER_BASE_INSTRUCTIONS = `- Work only on the task you were given.
- When HQ tells you to start a task, call get_my_task first.
- Report with set_my_status: in-review when your output is ready to be checked, blocked (with the reason) when you cannot continue, done when it is finished.
- set_my_status tells the lead automatically. Don't also send_message the same news.
- Need something from a teammate? Ask them directly with send_message.`;

export const DEVELOPER_INSTRUCTIONS = `- Work only on the task you were given. One task = one branch = one PR.
- When HQ tells you to start a task, call get_my_task first, then \`git pull origin main\` and create a branch.
- Edit only the files the task lists. Need another file? Ask the lead with send_message.
- Title PRs \`[TASK-ID] Short title\` and open them with \`gh pr create\`, then call set_my_status in-review with the PR number.
- set_my_status tells the lead automatically. Don't also send_message the same news.
- If you are blocked or need a decision, call set_my_status blocked with the reason.`;

export const leadRole = (): RoleConfig => ({ id: LEAD_ROLE_ID, title: "Lead", can: ["plan", "assign", "review", "hire"], instructions: LEAD_INSTRUCTIONS });
export const developerRole = (): RoleConfig => ({ id: "developer", title: "Developer", can: ["work"], instructions: DEVELOPER_INSTRUCTIONS });
export const defaultRoles = (): RoleConfig[] => [leadRole(), developerRole()];

// ---------------------------------------------------------------- lookups

export const roleOf = (cfg: Pick<HqConfig, "roles">, agent: Pick<AgentConfig, "roleId">): RoleConfig | undefined => cfg.roles.find((r) => r.id === agent.roleId);

export const can = (cfg: Pick<HqConfig, "roles">, agent: Pick<AgentConfig, "roleId"> | undefined, permission: Permission): boolean =>
  !!agent && !!roleOf(cfg, agent)?.can.includes(permission);

export const leadOf = (cfg: Pick<HqConfig, "team">): AgentConfig | undefined => cfg.team.find((a) => a.roleId === LEAD_ROLE_ID);

/** Finds a role by id or (case-insensitive) title. */
export function findRole(cfg: Pick<HqConfig, "roles">, ref: string): RoleConfig | undefined {
  const r = ref.trim().toLowerCase();
  return cfg.roles.find((x) => x.id === r) ?? cfg.roles.find((x) => x.title.toLowerCase() === r) ?? cfg.roles.find((x) => x.id === roleSlug(r));
}

/** A role id nobody uses yet, from a title. */
export function freeRoleId(cfg: Pick<HqConfig, "roles">, title: string): string {
  const base = roleSlug(title);
  let id = base;
  for (let i = 2; cfg.roles.some((r) => r.id === id); i++) id = `${base}-${i}`;
  return id;
}

/** Who an agent reports to, as a display name. */
export function managerName(cfg: Pick<HqConfig, "team" | "ceo">, agent: Pick<AgentConfig, "reportsTo">): string {
  if (agent.reportsTo === CEO_ID) return cfg.ceo.name;
  return cfg.team.find((a) => a.id === agent.reportsTo)?.name ?? cfg.ceo.name;
}

// ---------------------------------------------------------------- tools by permission

/** Team MCP tools every agent has, whatever its role. */
export const COMMON_TOOLS = ["list_workers", "get_status", "list_tasks", "send_message", "ask_user", "request_access"] as const;

/** Tools a permission unlocks. `review` and `approve` gain tools with the workflow engine (Phase 2). */
export const PERMISSION_TOOLS: Record<Permission, readonly string[]> = {
  plan: ["create_board", "create_task", "update_task"],
  assign: ["assign_task"],
  work: ["get_my_task", "set_my_status"],
  review: [],
  approve: [],
  hire: ["hire_agent", "dismiss_agent"],
};

/** The Team MCP tools a role gets, in a stable order. */
export function toolsFor(role: Pick<RoleConfig, "can"> | undefined): string[] {
  const own = PERMISSIONS.filter((p) => role?.can.includes(p)).flatMap((p) => PERMISSION_TOOLS[p]);
  return [...own, ...COMMON_TOOLS];
}

// ---------------------------------------------------------------- keeping a config consistent

const cleanPermissions = (list: unknown): Permission[] => PERMISSIONS.filter((p) => Array.isArray(list) && list.includes(p));

/**
 * Makes a config self-consistent after loading or editing it:
 * the lead role always exists and keeps the powers a lead needs, every agent has a known role,
 * exactly one agent is the lead and it reports to the CEO, reporting lines point at real agents
 * with no loops, and the derived fields (`role`, `isLead`) match. Returns what it had to fix.
 */
export function normalizeConfig(cfg: HqConfig): string[] {
  const fixed: string[] = [];
  cfg.ceo = { name: (cfg.ceo?.name ?? "").trim().slice(0, 40) || DEFAULT_CEO_NAME };
  const max = Number(cfg.limits?.maxAgents);
  cfg.limits = { maxAgents: Number.isFinite(max) ? Math.min(MAX_AGENTS_CEILING, Math.max(2, Math.round(max))) : DEFAULT_MAX_AGENTS };

  // Roles: unique ids, clean permissions, the lead role always present.
  const seen = new Set<string>();
  cfg.roles = (Array.isArray(cfg.roles) ? cfg.roles : []).filter((r) => {
    r.id = roleSlug(String(r.id ?? r.title ?? ""));
    if (seen.has(r.id)) return fixed.push(`Dropped a second role with the id "${r.id}".`), false;
    seen.add(r.id);
    r.title = String(r.title ?? "").trim().slice(0, 40) || r.id;
    r.can = cleanPermissions(r.can);
    r.instructions = String(r.instructions ?? "");
    return true;
  });
  let lead = cfg.roles.find((r) => r.id === LEAD_ROLE_ID);
  if (!lead) {
    lead = leadRole();
    cfg.roles.unshift(lead);
    fixed.push("Added the built-in lead role.");
  }
  // A lead that cannot plan or assign is not a lead; the CEO can still remove `hire` or `review`.
  for (const p of ["plan", "assign"] as const)
    if (!lead.can.includes(p)) {
      lead.can = cleanPermissions([...lead.can, p]);
      fixed.push(`The lead role always keeps "${p}".`);
    }
  const fallback = cfg.roles.find((r) => r.id !== LEAD_ROLE_ID && r.can.includes("work")) ?? cfg.roles.find((r) => r.id !== LEAD_ROLE_ID);

  // Agents: a known role, exactly one lead.
  let leadAgent: AgentConfig | undefined;
  for (const a of cfg.team) {
    if (!cfg.roles.some((r) => r.id === a.roleId)) {
      const to = fallback ?? developerRole();
      if (!cfg.roles.includes(to)) cfg.roles.push(to);
      fixed.push(`${a.name} had an unknown role "${a.roleId}"; now ${to.title}.`);
      a.roleId = to.id;
    }
    if (a.roleId === LEAD_ROLE_ID) {
      if (leadAgent) {
        const to = fallback ?? developerRole();
        if (!cfg.roles.includes(to)) cfg.roles.push(to);
        fixed.push(`Only one agent can be the lead; ${a.name} is now ${to.title}.`);
        a.roleId = to.id;
      } else leadAgent = a;
    }
  }
  if (!leadAgent && cfg.team[0]) {
    leadAgent = cfg.team[0];
    leadAgent.roleId = LEAD_ROLE_ID;
    fixed.push(`Every team needs a lead; ${leadAgent.name} is now the lead.`);
  }

  // Reporting lines: the lead reports to the CEO; everyone else to a real agent (default: the lead).
  const ids = new Set(cfg.team.map((a) => a.id));
  for (const a of cfg.team) {
    if (a === leadAgent) a.reportsTo = CEO_ID;
    else if (a.reportsTo !== CEO_ID && (!ids.has(a.reportsTo) || a.reportsTo === a.id)) a.reportsTo = leadAgent?.id ?? CEO_ID;
  }
  for (const a of cfg.team) {
    // Walk up; a loop means this agent's line is reset to the lead.
    const path = new Set<string>([a.id]);
    for (let at = a.reportsTo; at !== CEO_ID; ) {
      if (path.has(at)) {
        a.reportsTo = leadAgent && leadAgent !== a ? leadAgent.id : CEO_ID;
        fixed.push(`${a.name}'s reporting line looped; reset.`);
        break;
      }
      path.add(at);
      at = cfg.team.find((x) => x.id === at)?.reportsTo ?? CEO_ID;
    }
  }

  // Derived fields the UI and the office read.
  for (const a of cfg.team) {
    a.role = cfg.roles.find((r) => r.id === a.roleId)?.title ?? a.roleId;
    a.isLead = a.roleId === LEAD_ROLE_ID;
    if (a.hiredBy && !ids.has(a.hiredBy)) delete a.hiredBy;
    if (!a.temporary) delete a.temporary;
  }
  return fixed;
}
