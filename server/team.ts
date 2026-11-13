// Who is on the team: adding and removing agents. Used by the browser commands (the CEO)
// and by the Team MCP's hire_agent / dismiss_agent (the lead), so both follow the same rules.

import { nextAgentName } from "../src/data/names";
import { can, findRole, freeRoleId, leadOf, roleOf } from "../src/data/roles";
import { LEAD_ROLE_ID, type AgentCli, type AgentConfig, type AgentMode, type RemoveAgentOptions, type RoleConfig } from "../src/data/types";
import { agentPalette } from "../src/theme/tokens";
import { Hub } from "./hub";
import { slugify } from "./paths";
import { newAgent } from "./store";

/** What the team needs from the rest of HQ (sessions, inbox, sandboxes). */
export interface TeamDeps {
  start(agentId: string): unknown;
  removeResources(agentId: string, opts: RemoveAgentOptions): Promise<string[]>;
  /** Drop queued messages and sandbox bookkeeping for an agent that left. */
  forget(agentId: string): void;
  recheckSetup(): unknown;
}

export interface AddAgentInput {
  name: string;
  roleId: string;
  cli?: AgentCli;
  model?: string;
  mode?: AgentMode;
  reportsTo?: string;
  hiredBy?: string;
  temporary?: boolean;
}

export interface HireInput {
  /** An existing role (id or title), or the title of a new one. */
  role: string;
  /** Why this hire is needed. Shown to the CEO. */
  reason: string;
  name?: string;
  /** Needed when the role is new: what this role does and how. */
  instructions?: string;
  temporary?: boolean;
  cli?: AgentCli;
  model?: string;
}

export class Team {
  constructor(private hub: Hub, private deps: TeamDeps) {}

  private get cfg() {
    return this.hub.snap.config;
  }

  /** Adds an agent to the team (not started). The caller has already checked who may do this. */
  add(input: AddAgentInput): AgentConfig {
    const team = this.cfg.team;
    const name = input.name.trim().slice(0, 40) || nextAgentName(team.map((a) => a.name));
    const base = slugify(name) || "agent";
    let id = base;
    for (let i = 2; team.some((a) => a.id === id); i++) id = `${base}-${i}`;
    const used = new Set(team.map((a) => a.color));
    const color = agentPalette.find((c) => !used.has(c)) ?? agentPalette[team.length % agentPalette.length];
    const lead = leadOf(this.cfg);
    const role = this.cfg.roles.find((r) => r.id === input.roleId);
    const agent = newAgent(id, name, input.roleId, color, input.reportsTo ?? lead?.id);
    agent.cli = input.cli ?? role?.cli ?? "claude";
    agent.model = (input.model ?? role?.model ?? "").trim().slice(0, 60);
    agent.mode = input.mode ?? "sandbox";
    // Same network rules and VM size as whoever they work for.
    const like = (input.hiredBy && this.hub.cfg(input.hiredBy)) || lead;
    if (like) agent.sandbox = structuredClone(like.sandbox);
    if (input.hiredBy) agent.hiredBy = input.hiredBy;
    if (input.temporary) agent.temporary = true;
    team.push(agent);
    const status = Hub.freshStatus(id);
    this.hub.snap.agents.push(status);
    this.hub.configChanged();
    this.hub.emit({ type: "agent.updated", agent: structuredClone(status) });
    if (agent.cli === "codex") void this.deps.recheckSetup();
    return agent;
  }

  /** Stops an agent and takes it off the team. Its unfinished tasks go back to unassigned. Returns what was deleted. */
  async remove(agentId: string, opts: RemoveAgentOptions): Promise<{ deleted: string[]; freedTasks: string[] }> {
    const agent = this.hub.cfg(agentId);
    if (!agent) throw new Error(`No agent ${agentId}`);
    if (agent.roleId === LEAD_ROLE_ID) throw new Error("The lead can't be removed: every team has one.");
    const deleted = await this.deps.removeResources(agent.id, opts);
    this.cfg.team = this.cfg.team.filter((a) => a.id !== agent.id);
    // Anyone who reported to them now reports to their manager.
    for (const a of this.cfg.team) if (a.reportsTo === agent.id) a.reportsTo = agent.reportsTo;
    this.hub.snap.agents = this.hub.snap.agents.filter((a) => a.agentId !== agent.id);
    this.deps.forget(agent.id);
    const freedTasks: string[] = [];
    for (const t of this.hub.snap.tasks)
      if (t.ownerId === agent.id && t.status !== "done") {
        t.ownerId = null;
        if (t.status === "in-progress") t.status = "todo";
        freedTasks.push(t.id);
        this.hub.emit({ type: "task.updated", task: { ...t } });
      }
    this.hub.planChanged();
    this.hub.emit({ type: "agent.removed", agentId: agent.id });
    this.hub.configChanged();
    return { deleted, freedTasks };
  }

  /**
   * An agent with the `hire` permission adds a teammate, without asking the CEO, inside the
   * CEO's headcount limit. A role that doesn't exist yet is created with the `work` permission only:
   * a hire can never hand out planning, hiring or approval powers.
   */
  hire(byId: string, input: HireInput): string {
    const by = this.hub.cfg(byId);
    if (!by || !can(this.cfg, by, "hire")) throw new Error("Your role can't hire. Ask the lead with send_message.");
    const reason = input.reason?.trim();
    if (!reason) throw new Error("Say why this hire is needed (reason). The CEO sees it.");
    const max = this.cfg.limits.maxAgents;
    if (this.cfg.team.length >= max) {
      const temps = this.cfg.team.filter((a) => a.hiredBy).map((a) => a.name);
      throw new Error(
        `The team is at the CEO's headcount limit (${max} agents). ${temps.length ? `Dismiss an agent you no longer need (hired: ${temps.join(", ")}), or work` : "Work"} with the team you have, and tell the CEO what is waiting with ask_user.`,
      );
    }
    const wanted = input.role?.trim();
    if (!wanted) throw new Error("Name the role: an existing one (see list_workers) or a new title.");
    let role: RoleConfig | undefined = findRole(this.cfg, wanted);
    let created = false;
    if (role?.id === LEAD_ROLE_ID) throw new Error("A team has one lead. Hire into another role.");
    if (!role) {
      const instructions = input.instructions?.trim() ?? "";
      if (instructions.length < 40)
        throw new Error(`There is no "${wanted}" role yet (roles: ${this.cfg.roles.map((r) => r.title).join(", ")}). To create it, pass instructions: what this role does, how it should work, and what a finished result looks like.`);
      // The hirer says what the role does; how to take and report a task is added to every role file (agentFiles.ts).
      role = { id: freeRoleId(this.cfg, wanted), title: wanted.slice(0, 40), can: ["work"], instructions: instructions.slice(0, 8000) };
      this.cfg.roles.push(role);
      created = true;
    }
    const agent = this.add({
      name: input.name ?? "",
      roleId: role.id,
      cli: input.cli ?? role.cli ?? by.cli,
      model: input.model,
      mode: by.mode,
      reportsTo: by.id,
      hiredBy: by.id,
      temporary: !!input.temporary,
    });
    this.hub.activity("config", by.id, `${by.name} hired ${agent.name} (${role.title}${agent.temporary ? ", temporary" : ""}${created ? ", new role" : ""}): ${reason.slice(0, 200)}`);
    void Promise.resolve(this.deps.start(agent.id)).catch(() => {});
    const left = max - this.cfg.team.length;
    return `Hired ${agent.name} (id ${agent.id}) as ${role.title}${created ? ", a new role" : ""}. Their session is starting; a new sandbox can take a few minutes. Check list_workers until running is true, then assign_task. ${left} more ${left === 1 ? "hire fits" : "hires fit"} under the headcount limit.${agent.temporary ? ` ${agent.name} is temporary: dismiss them with dismiss_agent when their work is done.` : ""}`;
  }

  /** The lead lets go of an agent it (or another agent) hired. Agents the CEO added are the CEO's to remove. */
  async dismiss(byId: string, agentRef: string, reason: string): Promise<string> {
    const by = this.hub.cfg(byId);
    if (!by || !can(this.cfg, by, "hire")) throw new Error("Your role can't dismiss agents.");
    const r = agentRef.trim().toLowerCase();
    const agent = this.cfg.team.find((a) => a.id === r || a.name.toLowerCase() === r);
    if (!agent) throw new Error(`No agent "${agentRef}". Team: ${this.cfg.team.map((a) => a.id).join(", ")}`);
    if (agent.id === byId) throw new Error("That's you.");
    if (agent.roleId === LEAD_ROLE_ID) throw new Error("The lead can't be dismissed.");
    if (!agent.hiredBy) throw new Error(`${agent.name} was added by the CEO, so only the CEO can remove them. If they are no longer needed, tell the CEO with ask_user.`);
    const role = roleOf(this.cfg, agent)?.title ?? agent.roleId;
    // The sandbox goes; the folder stays, so no work is lost.
    const { freedTasks } = await this.remove(agent.id, { deleteSandbox: true, deleteFolder: false });
    this.hub.activity("config", by.id, `${by.name} dismissed ${agent.name} (${role})${reason?.trim() ? `: ${reason.trim().slice(0, 200)}` : ""}. Their folder is kept.`);
    return `Dismissed ${agent.name}.${freedTasks.length ? ` Their unfinished tasks are unassigned again: ${freedTasks.join(", ")}.` : ""}`;
  }
}
