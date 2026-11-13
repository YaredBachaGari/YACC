// Browser commands → server actions. Names match OfficeDataSource methods.

import { CEO_ID, LEAD_ROLE_ID, PERMISSIONS, SERVICE_KEYS, type AgentCli, type AgentConfig, type AgentPatch, type NewRoleInput, type OrgPatch, type ReviewTool, type RolePatch, type WelcomeInput, type NewMcpServer, type Board, type NewAgentInput, type ProjectConfig, type RemoveAgentOptions, type RoleConfig, type SandboxSettings, type SetupCheckId, type WorkflowPatch } from "../src/data/types";
import { DEVELOPER_INSTRUCTIONS, MAX_AGENTS_CEILING, WORKER_BASE_INSTRUCTIONS, defaultRoles, findRole, freeRoleId, leadOf } from "../src/data/roles";
import { LEAD_NAME, OFFICE_NAME_MAX } from "../src/data/names";
import { STACK_CATEGORIES, stackSkills, stackTool, type StackChoice, type StackConfig } from "../src/data/stack";
import { resolveAccess } from "./access";
import { ensureSkillCache } from "./skills";
import { run } from "./lib/exec";
import { agentPalette } from "../src/theme/tokens";
import { Hub } from "./hub";
import type { Planner } from "./planner";
import type { Sbx } from "./sbx";
import type { SbxMcp } from "./sbxMcp";
import type { Sessions } from "./sessions";
import { newAgent, removeRoleFile } from "./store";
import type { Team } from "./team";
import { mergeByNotice } from "./githubSync";

/** A stack from the browser, checked against the catalog. Null when nothing is chosen. */
function cleanStack(raw: unknown): StackConfig | null {
  const input = (raw ?? {}) as Partial<StackConfig>;
  const choice = (c: unknown, category: string): StackChoice | null => {
    const v = (c ?? {}) as Partial<StackChoice>;
    const id = str(v.id, 40);
    const known = id === "other" || stackTool(id)?.category === category;
    if (!known) return null;
    const out: StackChoice = { id };
    if (typeof v.where === "string" && v.where.trim()) out.where = str(v.where, 120).trim();
    if (id === "other") {
      if (typeof v.name === "string" && v.name.trim()) out.name = str(v.name, 60).trim();
      if (typeof v.docsUrl === "string" && v.docsUrl.trim()) out.docsUrl = str(v.docsUrl, 300).trim();
    }
    return out;
  };
  const frameworks = (Array.isArray(input.frameworks) ? input.frameworks : []).slice(0, 10).map((f) => choice(f, "framework")).filter((f): f is StackChoice => !!f);
  const tools: StackConfig["tools"] = {};
  for (const c of STACK_CATEGORIES) {
    const picked = choice(input.tools?.[c.id], c.id);
    if (picked) tools[c.id] = picked;
  }
  return frameworks.length || Object.keys(tools).length ? { frameworks, tools } : null;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "agent";
const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function makeCommands(hub: Hub, sessions: Sessions, planner: Planner, sbx: Sbx, mcp: SbxMcp, teamOps: Team) {
  /** Runs an sbx change and reports failures in the activity feed. */
  const attempt = async (agentId: string | null, what: string, fn: () => Promise<void>) => {
    try {
      await fn();
      hub.activity("config", agentId, what);
    } catch (err) {
      hub.activity("config", agentId, `Couldn't ${what.charAt(0).toLowerCase() + what.slice(1)}: ${err instanceof Error ? err.message : err}`);
    }
  };
  const team = () => hub.snap.config.team;

  const commands: Record<string, (...args: unknown[]) => unknown> = {
    sendTerminalInput: (id, data) => sessions.input(str(id, 80), str(data, 100_000)),
    openShell: (id) => sessions.openShell(str(id, 80)),
    closeShell: (id) => sessions.closeShell(str(id, 80)),
    openHostShell: (dir, fresh) => sessions.openHostShell(str(dir, 4096), fresh === true),
    closeHostShell: () => sessions.closeHostShell(),
    forwardPort: (agentId, port) => sbx.forwardPort(str(agentId, 80), num(port)),
    unforwardPort: (agentId, port) => sbx.unforwardPort(str(agentId, 80), num(port)),
    resizeTerminal: (id, cols, rows) => sessions.resize(str(id, 80), num(cols), num(rows)),
    startAgent: (id) => sessions.start(str(id, 80)),
    stopAgent: (id) => sessions.stop(str(id, 80)),
    openWorkspace: (id) => sessions.openWorkspace(str(id, 80)),
    recreateSandbox: (id) => sessions.recreate(str(id, 80)),
    recheckSetup: async () => {
      await sessions.recheckSetup();
      await sbx.refresh();
    },
    runSetupFix: (id) => sessions.runFix(str(id, 40) as SetupCheckId),

    // You → agent: same delivery path as the lead's assign_task / send_message.
    assignTask: (taskId, agentId) => planner.assign(str(taskId, 40), str(agentId, 80), "you"),
    sendMessage: (toId, text) => planner.message("you", str(toId, 80), str(text, 2000)),

    addAgent: (raw) => {
      const input = (raw ?? {}) as Partial<NewAgentInput>;
      const cfg = hub.snap.config;
      if (team().length >= MAX_AGENTS_CEILING) return hub.activity("config", null, `A team can have at most ${MAX_AGENTS_CEILING} agents.`);
      // A role id or title that exists, or a new title: then a role is made for it.
      const wanted = str(input.role, 40).trim() || "developer";
      let role = findRole(cfg, wanted);
      if (!role || role.id === LEAD_ROLE_ID) {
        role = { id: freeRoleId(cfg, wanted), title: wanted, can: ["work"], instructions: WORKER_BASE_INSTRUCTIONS };
        cfg.roles.push(role);
      }
      const agent = teamOps.add({
        name: str(input.name, 40),
        roleId: role.id,
        cli: input.cli === "codex" ? "codex" : input.cli === "claude" ? "claude" : undefined,
        model: typeof input.model === "string" ? str(input.model, 60) : undefined,
        mode: input.mode === "local" ? "local" : "sandbox",
      });
      hub.activity("config", null, `Added ${agent.name} (${agent.role}). Press Start to launch their session.`);
    },

    updateAgent: (id, patch) => {
      const agent = hub.cfg(str(id));
      if (!agent) return;
      const p = (patch ?? {}) as AgentPatch;
      const before = `${agent.cli}/${agent.mode}`;
      for (const k of ["name", "model", "color", "roleMd"] as const) if (typeof p[k] === "string") agent[k] = str(p[k], 8000);
      const cfg = hub.snap.config;
      // The lead keeps its role, and nobody is made lead this way: a team has exactly one.
      if (typeof p.roleId === "string" && agent.roleId !== LEAD_ROLE_ID && p.roleId !== LEAD_ROLE_ID && cfg.roles.some((r) => r.id === p.roleId)) agent.roleId = p.roleId;
      if (typeof p.reportsTo === "string" && agent.roleId !== LEAD_ROLE_ID && (p.reportsTo === CEO_ID || (p.reportsTo !== agent.id && hub.cfg(p.reportsTo)))) agent.reportsTo = p.reportsTo;
      if (p.mode === "sandbox" || p.mode === "local") agent.mode = p.mode;
      if ((p.cli === "claude" || p.cli === "codex") && p.cli !== agent.cli) {
        agent.cli = p.cli;
        // Model names don't carry over between CLIs.
        if (typeof p.model !== "string") agent.model = "";
      }
      if (Array.isArray(p.skills)) agent.skills = p.skills.map((s) => str(s, 60)).filter(Boolean);
      if (p.workspacePath !== undefined) agent.workspacePath = p.workspacePath ? str(p.workspacePath, 500).trim() || null : null;
      hub.configChanged();
      // Codex agents add their own setup checks.
      if (`${agent.cli}/${agent.mode}` !== before) void sessions.recheckSetup();
    },

    inspectWorkspace: async (id) => {
      const info = await sessions.inspectWorkspace(str(id, 80));
      if (info) hub.emit({ type: "workspace.info", info });
    },

    removeAgent: async (id, opts) => {
      const agent = hub.cfg(str(id));
      if (!agent || agent.roleId === LEAD_ROLE_ID) return;
      const o = (opts ?? {}) as Partial<RemoveAgentOptions>;
      const { deleted } = await teamOps.remove(agent.id, { deleteSandbox: o.deleteSandbox !== false, deleteFolder: o.deleteFolder === true });
      const what = deleted.length ? ` Deleted: ${deleted.join(" and ")}.` : "";
      const kept = deleted.includes("folder") ? "" : " Their folder is kept.";
      hub.activity("config", null, `Removed ${agent.name}.${what}${kept}`);
    },

    // ---------------------------------------------------------- roles and org

    addRole: (raw) => {
      const input = (raw ?? {}) as Partial<NewRoleInput>;
      const cfg = hub.snap.config;
      const title = str(input.title, 40).trim();
      if (!title) return;
      if (findRole(cfg, title)) return hub.activity("config", null, `There is already a "${title}" role.`);
      const role: RoleConfig = {
        id: freeRoleId(cfg, title),
        title,
        can: Array.isArray(input.can) ? PERMISSIONS.filter((p) => input.can!.includes(p)) : ["work"],
        instructions: typeof input.instructions === "string" && input.instructions.trim() ? str(input.instructions, 20_000) : WORKER_BASE_INSTRUCTIONS,
      };
      cfg.roles.push(role);
      hub.configChanged();
      hub.activity("config", null, `Added the ${role.title} role.`);
    },

    updateRole: (id, patch) => {
      const role = hub.snap.config.roles.find((r) => r.id === str(id, 60));
      if (!role) return;
      const p = (patch ?? {}) as RolePatch;
      if (typeof p.title === "string" && p.title.trim()) role.title = str(p.title, 40).trim();
      if (Array.isArray(p.can)) role.can = PERMISSIONS.filter((x) => p.can!.includes(x));
      if (typeof p.instructions === "string") role.instructions = str(p.instructions, 20_000);
      if (p.cli === "claude" || p.cli === "codex") role.cli = p.cli;
      else if (p.cli === null || (p.cli as unknown) === "") delete role.cli;
      if (typeof p.model === "string") {
        if (p.model.trim()) role.model = str(p.model, 60).trim();
        else delete role.model;
      }
      hub.configChanged(); // the lead role keeps plan + assign (normalizeConfig)
    },

    removeRole: (id) => {
      const cfg = hub.snap.config;
      const role = cfg.roles.find((r) => r.id === str(id, 60));
      if (!role) return;
      if (role.id === LEAD_ROLE_ID) return hub.activity("config", null, "The lead role is built in and can't be removed.");
      const holders = cfg.team.filter((a) => a.roleId === role.id).map((a) => a.name);
      if (holders.length) return hub.activity("config", null, `${holders.join(", ")} ${holders.length > 1 ? "have" : "has"} the ${role.title} role. Give them another role first.`);
      cfg.roles = cfg.roles.filter((r) => r !== role);
      hub.configChanged();
      removeRoleFile(hub.repo.root, role.id);
      hub.activity("config", null, `Removed the ${role.title} role.`);
    },

    updateOrg: (patch) => {
      const p = (patch ?? {}) as OrgPatch;
      const cfg = hub.snap.config;
      if (typeof p.ceoName === "string" && p.ceoName.trim()) cfg.ceo.name = str(p.ceoName, 40).trim();
      if (typeof p.maxAgents === "number" && Number.isFinite(p.maxAgents)) {
        // Never below the team you already have: lowering the limit doesn't fire anyone.
        cfg.limits.maxAgents = Math.max(cfg.team.length, 2, Math.min(MAX_AGENTS_CEILING, Math.round(p.maxAgents)));
      }
      hub.configChanged();
    },

    updateSandbox: (id, patch) => {
      const agent = hub.cfg(str(id));
      if (!agent) return;
      const p = (patch ?? {}) as Partial<SandboxSettings>;
      const clean = (list: unknown[]) => [...new Set(list.map((d) => str(d, 200).trim().toLowerCase()).filter(Boolean))];
      const rulesChanged = Array.isArray(p.allow) || Array.isArray(p.deny);
      if (Array.isArray(p.allow)) agent.sandbox.allow = clean(p.allow);
      if (Array.isArray(p.deny)) agent.sandbox.deny = clean(p.deny);
      if (p.resources) {
        // Same limits as sbx: ≥1 CPU up to the host; 0.5 GB up to 75% of RAM.
        const m = hub.snap.setup.machine;
        const cpus = p.resources.cpus === null ? null : Math.round(Math.min(m.cpus, Math.max(1, num(p.resources.cpus))));
        const maxMem = Math.max(0.5, Math.floor(m.memoryGb * 0.75 * 2) / 2);
        const memoryGb = p.resources.memoryGb === null ? null : Math.min(maxMem, Math.max(0.5, Math.round(num(p.resources.memoryGb) * 2) / 2));
        agent.sandbox.resources = { cpus, memoryGb };
      }
      hub.configChanged();
      // Applies now if the sandbox exists; otherwise on its first Start.
      if (rulesChanged) void sbx.syncRules(agent.id);
    },

    setSecret: (id, service, value) => {
      const agentId = id === null ? null : str(id, 80);
      const svc = str(service, 40);
      if (!(SERVICE_KEYS as readonly string[]).includes(svc) || typeof value !== "string" || !value.trim()) return;
      if (agentId && !hub.cfg(agentId)) return;
      return attempt(agentId, `Stored the ${svc} key ${agentId ? `for ${hub.name(agentId)}'s sandbox` : "for every sandbox"}`, () => sbx.setKey(agentId, svc, value));
    },
    removeSecret: (id, service) => {
      const agentId = id === null ? null : str(id, 80);
      const svc = str(service, 40);
      if (!(SERVICE_KEYS as readonly string[]).includes(svc)) return;
      return attempt(agentId, `Removed the ${svc} key ${agentId ? `from ${hub.name(agentId)}'s sandbox` : "from every sandbox"}`, () => sbx.removeKey(agentId, svc));
    },
    setProxy: (url) => {
      const u = typeof url === "string" && url.trim() ? str(url, 300).trim() : null;
      if (u && !/^https?:\/\/[^\s]+$/i.test(u)) return hub.activity("config", null, "Proxy must be an http(s):// URL");
      return attempt(null, u ? `Set the sandbox proxy to ${u}` : "Removed the sandbox proxy", () => sbx.setProxy(u));
    },
    openEnvFile: async (id) => {
      const agent = hub.cfg(str(id, 80));
      if (!agent) return;
      const file = sbx.ensureEnvFile(agent.id);
      const [cmd, args] = process.platform === "darwin" ? ["open", ["-t", file]] : process.platform === "win32" ? ["notepad", [file]] : ["xdg-open", [file]];
      await run(cmd, args, { timeoutMs: 5000 });
      await sbx.refresh();
    },
    refreshSbx: () => sbx.refresh(),

    resolveActionItem: (id, decision, note) => {
      const d = decision === "done" || decision === "dismissed" ? decision : null;
      if (d) planner.actions?.resolve(str(id, 40), d, typeof note === "string" ? str(note, 1000) : undefined);
    },
    refreshMcp: () => mcp.refresh(),
    addMcp: (raw) => {
      const v = (raw ?? {}) as Partial<NewMcpServer>;
      return mcp.add({
        name: str(v.name, 40),
        url: str(v.url, 500) || undefined,
        command: str(v.command, 300) || undefined,
        args: Array.isArray(v.args) ? v.args.slice(0, 20).map((a) => str(a, 200)) : undefined,
        apiKey: str(v.apiKey, 4000) || undefined,
      });
    },
    authMcp: (name) => mcp.authorize(str(name, 40)),
    removeMcp: (name) => mcp.remove(str(name, 40)),
    setAgentMcp: (agentId, names) => mcp.setAgent(str(agentId, 80), Array.isArray(names) ? names.slice(0, 50).map((n) => str(n, 40)) : []),
    answerApproval: (agentId, approvalId, decision) => {
      const d = decision === "allow" || decision === "dismiss" ? decision : null;
      if (d) return sbx.answerApproval(str(agentId, 80), str(approvalId, 120), d);
    },

    /** Saves the project's stack (sanitised against the catalog). The agents get it in ROLE.md on their next start. */
    updateStack: (raw) => {
      const cfg = hub.snap.config;
      const stack = cleanStack(raw);
      if (!stack) {
        delete cfg.stack;
        return hub.configChanged();
      }
      cfg.stack = stack;
      hub.configChanged();
      // Fetch the skills now so the next Start doesn't wait for them.
      const specs = stackSkills(cfg.stack);
      if (specs.length) void ensureSkillCache(hub.slug, specs).catch((e) => hub.activity("config", null, `Couldn't fetch agent skills: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`));
    },

    resolveAccess: (id, decision) => {
      const d = decision === "agent" || decision === "everyone" || decision === "deny" ? decision : null;
      if (d) return resolveAccess(hub, sbx, planner, str(id, 40), d);
    },

    completeWelcome: async (raw) => {
      if (!hub.snap.welcome) return;
      const input = (raw ?? {}) as Partial<WelcomeInput>;
      const cli = (c: unknown): AgentCli => (c === "codex" ? "codex" : "claude");
      const used = new Set<string>();
      const cfg = hub.snap.config;
      const roles = defaultRoles();
      // A worker's job title becomes a role. This welcome sets up a coding team, so they start from the developer's rules.
      const roleFor = (title: string): RoleConfig => {
        const clean = str(title, 40).trim() || "Developer";
        let role = roles.find((r) => r.id !== LEAD_ROLE_ID && r.title.toLowerCase() === clean.toLowerCase());
        if (!role) {
          role = { id: freeRoleId({ roles }, clean), title: clean, can: ["work"], instructions: DEVELOPER_INSTRUCTIONS };
          roles.push(role);
        }
        return role;
      };
      const make = (name: string, roleId: string, agentCli: AgentCli, reportsTo: string): AgentConfig => {
        const clean = str(name, 40).trim() || (roleId === LEAD_ROLE_ID ? "Lead" : "Agent");
        let id = slug(clean);
        for (let i = 2; used.has(id); i++) id = `${slug(clean)}-${i}`;
        used.add(id);
        const agent = newAgent(id, clean, roleId, agentPalette[used.size - 1] ?? agentPalette[0], reportsTo);
        agent.cli = agentCli;
        return agent;
      };
      const lead = make(input.lead?.name ?? LEAD_NAME, LEAD_ROLE_ID, cli(input.lead?.cli), CEO_ID);
      const workers = (Array.isArray(input.workers) ? input.workers : []).slice(0, MAX_AGENTS_CEILING - 1).map((w) => make(w?.name ?? "", roleFor(w?.role ?? "").id, cli(w?.cli), lead.id));
      if (typeof input.projectName === "string" && input.projectName.trim()) cfg.project.name = str(input.projectName, 80).trim();
      cfg.roles = roles;
      cfg.team = [lead, ...workers];
      cfg.limits.maxAgents = Math.max(cfg.limits.maxAgents, cfg.team.length);
      const tools: ReviewTool[] = ["coderabbit", "greptile", "copilot", "human", "custom"];
      if (tools.includes(input.reviewTool as ReviewTool)) cfg.workflow.review.tool = input.reviewTool as ReviewTool;
      if (typeof input.reviewEnabled === "boolean") cfg.workflow.review.enabled = input.reviewEnabled;
      const stack = cleanStack(input.stack);
      if (stack) {
        cfg.stack = stack;
        const specs = stackSkills(stack);
        if (specs.length) void ensureSkillCache(hub.slug, specs).catch(() => {}); // retried on Start
      }
      hub.snap.agents = cfg.team.map((a) => Hub.freshStatus(a.id));
      hub.snap.welcome = false;
      hub.configChanged(); // saves .yacc/config.yml for the first time
      hub.planChanged();
      await sessions.recheckSetup();
      await sbx.refresh();
      hub.emit({ type: "snapshot", snapshot: structuredClone(hub.snap) });
      hub.activity("config", null, `Welcome! Team created: ${cfg.team.map((a) => a.name).join(", ")}. Press Start team when you're ready.`);
    },

    updateWorkflow: (patch) => {
      const p = (patch ?? {}) as WorkflowPatch;
      const wf = hub.snap.config.workflow;
      const mergeBy = wf.merge.by;
      Object.assign(wf.review, p.review ?? {});
      if (p.merge?.by === "human" || p.merge?.by === "lead") wf.merge.by = p.merge.by;
      Object.assign(wf.deploy, p.deploy ?? {});
      hub.configChanged();
      // The lead was told the old rule; tell it the new one now, so no restart is needed.
      const lead = leadOf(hub.snap.config);
      if (lead && wf.merge.by !== mergeBy) {
        const waiting = hub.snap.pullRequests.filter((pr) => pr.review === "passed" && !pr.merged && !pr.closed).map((pr) => pr.number);
        planner.notify(lead.id, mergeByNotice(wf.merge.by, waiting));
      }
    },

    updateProject: (patch) => {
      const p = (patch ?? {}) as Partial<ProjectConfig>;
      const project = hub.snap.config.project;
      if (typeof p.name === "string" && p.name.trim()) project.name = str(p.name, 80);
      if (typeof p.repo === "string" && p.repo.trim()) project.repo = str(p.repo, 200);
      if (typeof p.officeName === "string") {
        const name = p.officeName.trim().slice(0, OFFICE_NAME_MAX);
        if (name) project.officeName = name;
        else delete project.officeName;
      }
      const exportOn = typeof p.exportPlan === "boolean" && p.exportPlan && !project.exportPlan;
      if (typeof p.exportPlan === "boolean") project.exportPlan = p.exportPlan;
      hub.configChanged();
      if (exportOn) {
        hub.planChanged();
        hub.activity("config", null, "Plan export on: HQ writes docs/plan.md whenever the plan changes.");
      }
    },

    createBoard: (title) => planner.createBoard(str(title, 80)),

    updateBoard: (id, patch) => {
      const p = (patch ?? {}) as Partial<Board>;
      const status = p.status === "active" || p.status === "planned" || p.status === "done" ? p.status : undefined;
      planner.updateBoard(str(id, 20), { title: typeof p.title === "string" ? p.title : undefined, status });
    },
  };

  return commands;
}
