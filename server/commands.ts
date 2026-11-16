// Browser commands → server actions. Names match OfficeDataSource methods.
import { cpSync } from "node:fs";
import { join } from "node:path";

import { AGENT_CLIS, CEO_ID, LEAD_ROLE_ID, PERMISSIONS, PROVIDER_IDS, SERVICE_KEYS, type AgentCli, type AgentConfig, type AgentPatch, type NewRoleInput, type OrgPatch, type ProjectMemory, type ReviewTool, type RolePatch, type WelcomeInput, type NewMcpServer, type Board, type NewAgentInput, type ProjectConfig, type RemoveAgentOptions, type RoleConfig, type SandboxSettings, type SetupCheckId, type WorkflowPatch } from "../src/data/types";
import { DEVELOPER_INSTRUCTIONS, MAX_AGENTS_CEILING, WORKER_BASE_INSTRUCTIONS, findRole, freeRoleId, leadOf, wouldLoop } from "../src/data/roles";
import { LEAD_NAME, OFFICE_NAME_MAX } from "../src/data/names";
import { STACK_CATEGORIES, stackTool, type StackChoice, type StackConfig } from "../src/data/stack";
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
import type { Briefings } from "./briefings";
import { listTemplates, refreshTemplates, saveTemplate } from "./templates";
import { BUILT_IN_TEMPLATES, libraryCard, roleFromCard } from "../src/data/templates";
import { PROVIDERS, cleanBudget, cleanRouting } from "../src/data/models";
import type { Budgets } from "./usage";
import type { Memory } from "./memory";
import { mergeByNotice } from "./githubSync";
import { AvatarError, removeAvatar, saveAvatar } from "./avatars";
import { listProjectSkills, readProjectSkill, removeProjectSkill, SkillError, skillsDir, writeProjectSkill } from "./projectSkills";
import { cleanProjectSkills, cleanToolkits, teamSkillSets } from "../src/data/toolkits";
import { mcpFor } from "../src/data/models";
import { cleanMessaging } from "../src/data/messaging";
import { cleanSchedules } from "../src/data/schedules";
import type { Scheduler } from "./scheduler";
import type { Retros } from "./retros";
import { cleanAvatar, cleanBio, cleanTheme } from "../src/data/profile";
import type { AvatarConfig } from "../src/data/types";

/** A look from the browser; the uploaded picture is kept (it changes only through setAvatarImage). */
function withLook(current: AvatarConfig | undefined, patch: unknown): AvatarConfig | undefined {
  const look = patch === null ? undefined : cleanAvatar({ ...(patch as object), image: undefined });
  const out = { ...(look ?? {}), ...(current?.image ? { image: current.image } : {}) };
  return Object.keys(out).length ? out : undefined;
}

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

export function makeCommands(hub: Hub, sessions: Sessions, planner: Planner, sbx: Sbx, mcp: SbxMcp, teamOps: Team, extra: { briefings: Briefings; memory: Memory; budgets?: Budgets; scheduler?: Scheduler; retros?: Retros }) {
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
  /** Fetches the skills each agent will need now, so the next Start doesn't wait for them. */
  const prefetchSkills = (quiet = false) => {
    for (const specs of teamSkillSets(hub.snap.config))
      void ensureSkillCache(hub.slug, specs).catch((e) => !quiet && hub.activity("config", null, `Couldn't fetch agent skills: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`));
  };
  const refreshSkills = () => {
    hub.snap.projectSkills = listProjectSkills(hub.repo.root);
    hub.emit({ type: "skills.updated", skills: structuredClone(hub.snap.projectSkills) });
  };

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
        cli: AGENT_CLIS.find((c) => c === input.cli),
        model: typeof input.model === "string" ? str(input.model, 60) : undefined,
        mode: input.mode === "local" ? "local" : "sandbox",
        reportsTo: typeof input.reportsTo === "string" && (input.reportsTo === CEO_ID || hub.cfg(input.reportsTo)) ? input.reportsTo : undefined,
      });
      const boss = agent.reportsTo === leadOf(cfg)?.id ? "" : `, reporting to ${agent.reportsTo === CEO_ID ? cfg.ceo.name : hub.name(agent.reportsTo)}`;
      hub.activity("config", null, `Added ${agent.name} (${agent.role})${boss}. Press Start to launch their session.`);
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
      if (typeof p.reportsTo === "string" && agent.roleId !== LEAD_ROLE_ID && p.reportsTo !== agent.reportsTo && (p.reportsTo === CEO_ID || (p.reportsTo !== agent.id && hub.cfg(p.reportsTo)))) {
        if (wouldLoop(cfg.team, agent.id, p.reportsTo)) hub.activity("config", null, `${agent.name} can't report to ${hub.name(p.reportsTo)}: ${hub.name(p.reportsTo)} already reports to ${agent.name}, directly or through someone.`);
        else agent.reportsTo = p.reportsTo;
      }
      if (p.mode === "sandbox" || p.mode === "local") agent.mode = p.mode;
      if (p.avatar !== undefined) {
        const avatar = withLook(agent.avatar, p.avatar);
        if (avatar) agent.avatar = avatar;
        else delete agent.avatar;
      }
      if (typeof p.bio === "string") {
        const bio = cleanBio(p.bio);
        if (bio) agent.bio = bio;
        else delete agent.bio;
      }
      if (p.budget !== undefined) {
        const budget = cleanBudget(p.budget);
        if (budget) agent.budget = budget;
        else delete agent.budget;
      }
      // Moving to a desk someone has: they swap.
      if (typeof p.desk === "number" && Number.isInteger(p.desk) && p.desk >= 0 && p.desk < MAX_AGENTS_CEILING && agent.roleId !== LEAD_ROLE_ID && p.desk !== agent.desk) {
        const holder = cfg.team.find((a) => a !== agent && a.desk === p.desk);
        if (holder) holder.desk = agent.desk;
        agent.desk = p.desk;
      }
      if (AGENT_CLIS.some((c) => c === p.cli) && p.cli && p.cli !== agent.cli) {
        agent.cli = p.cli;
        // Model names don't carry over between CLIs.
        if (typeof p.model !== "string") agent.model = "";
      }
      if (Array.isArray(p.skills)) agent.skills = p.skills.map((s) => str(s, 60)).filter(Boolean);
      if (p.workspacePath !== undefined) agent.workspacePath = p.workspacePath ? str(p.workspacePath, 500).trim() || null : null;
      hub.configChanged();
      if (p.budget !== undefined) extra.budgets?.check();
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
      const cli = AGENT_CLIS.find((c) => c === p.cli);
      if (cli) role.cli = cli;
      else if (p.cli === null || (p.cli as unknown) === "") delete role.cli;
      if (typeof p.model === "string") {
        if (p.model.trim()) role.model = str(p.model, 60).trim();
        else delete role.model;
      }
      const toolsBefore = role.tools ?? [];
      if (Array.isArray(p.tools)) {
        const tools = [...new Set(p.tools.slice(0, 20).map((t) => str(t, 40).trim().toLowerCase()).filter(Boolean))];
        if (tools.length) role.tools = tools;
        else delete role.tools;
      }
      hub.configChanged(); // the lead role keeps plan + assign (normalizeConfig)
      // A new tool reaches running agents with this role now; a removed one stays until their sandbox is recreated.
      if ((role.tools ?? []).some((t) => !toolsBefore.includes(t))) void mcp.syncRole(role.id);
      if ((role.tools ?? []).join() !== toolsBefore.join()) void sessions.recheckSetup();
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

    setProviderAuth: (provider, auth) => {
      const id = PROVIDER_IDS.find((x) => x === provider);
      if (!id || (auth !== "subscription" && auth !== "api-key") || !PROVIDERS[id].auth.includes(auth)) return;
      const cfg = hub.snap.config;
      cfg.providers = { ...(cfg.providers ?? {}), [id]: { auth } };
      hub.configChanged();
      hub.activity("config", null, `${PROVIDERS[id].label}: ${auth === "api-key" ? "API key" : "your subscription"}. Restart its agents to switch.`);
      void sessions.recheckSetup();
    },

    updateOrg: (patch) => {
      const p = (patch ?? {}) as OrgPatch;
      const cfg = hub.snap.config;
      if (typeof p.ceoName === "string" && p.ceoName.trim()) cfg.ceo.name = str(p.ceoName, 40).trim();
      if (p.ceoAvatar !== undefined) {
        const avatar = withLook(cfg.ceo.avatar, p.ceoAvatar);
        if (avatar) cfg.ceo.avatar = avatar;
        else delete cfg.ceo.avatar;
      }
      if (p.autonomy) cfg.autonomy = { ...cfg.autonomy, ...p.autonomy }; // normalizeConfig drops anything unknown
      if (typeof p.maxAgents === "number" && Number.isFinite(p.maxAgents)) {
        // Never below the team you already have: lowering the limit doesn't fire anyone.
        cfg.limits.maxAgents = Math.max(cfg.team.length, 2, Math.min(MAX_AGENTS_CEILING, Math.round(p.maxAgents)));
      }
      if (p.budget !== undefined) {
        const budget = cleanBudget(p.budget);
        if (budget) cfg.limits.budget = budget;
        else delete cfg.limits.budget;
      }
      hub.configChanged();
      if (p.budget !== undefined) extra.budgets?.check();
    },

    setRouting: (routing) => {
      const cfg = hub.snap.config;
      const clean = cleanRouting(routing);
      if (Object.keys(clean).length) cfg.routing = clean;
      else delete cfg.routing;
      hub.configChanged();
      // The models routing and fallbacks can switch to get their setup checks.
      void sessions.recheckSetup();
    },

    useOwnModel: (id) => sessions.useOwnModel(str(id, 80)),

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
      hub.audit("secret", `Set the ${svc} key ${agentId ? `for ${hub.name(agentId)}'s sandbox` : "for every sandbox"} (the value isn't recorded)`, agentId ?? undefined);
      return attempt(agentId, `Stored the ${svc} key ${agentId ? `for ${hub.name(agentId)}'s sandbox` : "for every sandbox"}`, () => sbx.setKey(agentId, svc, value));
    },
    removeSecret: (id, service) => {
      const agentId = id === null ? null : str(id, 80);
      const svc = str(service, 40);
      if (!(SERVICE_KEYS as readonly string[]).includes(svc)) return;
      hub.audit("secret", `Removed the ${svc} key ${agentId ? `from ${hub.name(agentId)}'s sandbox` : "from every sandbox"}`, agentId ?? undefined);
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

    replyBriefing: (id, text) => extra.briefings.reply(str(id, 40), str(text, 2000)),
    markBriefingsRead: () => extra.briefings.markAllRead(),
    saveTemplate: (name, where, description) => {
      const dir = saveTemplate(hub.snap.config, extra.memory.read().brief, str(name, 60), where === "user" ? "user" : "project", hub.repo.root, typeof description === "string" ? str(description, 300) : "");
      refreshTemplates(hub);
      hub.audit("template", `Saved the setup as the template "${str(name, 60)}" (${where === "user" ? "for you" : "in this project"})`);
      hub.activity("config", null, `Saved the template "${str(name, 60)}" to ${dir}. ${where === "user" ? "It is offered when you set up any new project on this machine." : "Commit .yacc/templates/ to share it."}`);
    },

    updateMemory: (patch) => {
      const p = (patch ?? {}) as Partial<ProjectMemory>;
      extra.memory.set({
        ...(typeof p.brief === "string" ? { brief: str(p.brief, 40_000) } : {}),
        ...(typeof p.decisions === "string" ? { decisions: str(p.decisions, 40_000) } : {}),
        ...(typeof p.lessons === "string" ? { lessons: str(p.lessons, 40_000) } : {}),
      });
    },

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

    /** Which toolkits the team uses and for which roles (plan 6.2). Skills reach an agent on its next start; MCP servers right away. */
    updateToolkits: (raw) => {
      const cfg = hub.snap.config;
      const before = JSON.stringify(cfg.toolkits ?? []);
      const mcpBefore = cfg.team.map((a) => mcpFor(a, cfg).join()).join("|");
      const kits = cleanToolkits(raw, cfg.roles.map((r) => r.id));
      if (JSON.stringify(kits) === before) return;
      if (kits.length) cfg.toolkits = kits;
      else delete cfg.toolkits;
      hub.configChanged();
      prefetchSkills();
      if (cfg.team.map((a) => mcpFor(a, cfg).join()).join("|") !== mcpBefore) {
        void mcp.syncTeam();
        void sessions.recheckSetup();
      }
    },

    /** The team's schedules, saved whole (plan 6.5). New ones count from now; the lead learns of them on its next start. */
    updateSchedules: (raw) => {
      const cfg = hub.snap.config;
      const list = cleanSchedules(raw);
      if (list.length) cfg.schedules = list;
      else delete cfg.schedules;
      hub.configChanged();
      extra.scheduler?.sync();
    },

    runSchedule: (id) => void extra.scheduler?.runNow(str(id, 80)),

    /** Asks the lead to look back on a board (the last one done, when none is given). */
    requestRetrospective: (boardId) => {
      const why = extra.retros?.ask(typeof boardId === "string" && boardId ? str(boardId, 20) : undefined);
      if (why) hub.activity("config", null, `No retrospective: ${why}`);
    },

    /** Channels and who may message whom. Agents are told on their next start; the rules apply right away. */
    updateMessaging: (raw) => {
      const cfg = hub.snap.config;
      const m = cleanMessaging(raw, cfg.roles.map((r) => r.id));
      if (m) cfg.messaging = m;
      else delete cfg.messaging;
      hub.configChanged();
    },

    /** Which roles get each of the team's own skills (.yacc/skills/). */
    updateProjectSkills: (raw) => {
      const cfg = hub.snap.config;
      const list = cleanProjectSkills(raw, cfg.roles.map((r) => r.id));
      if (list.length) cfg.skills = list;
      else delete cfg.skills;
      hub.configChanged();
    },

    /** Creates or rewrites a project skill. A new one is given to the roles listed (none: every role). */
    saveProjectSkill: (raw) => {
      const v = (raw ?? {}) as { name?: unknown; description?: unknown; body?: unknown; roles?: unknown };
      const name = str(v.name, 64).trim();
      try {
        const existed = !!readProjectSkill(hub.repo.root, name);
        writeProjectSkill(hub.repo.root, name, str(v.description, 2000), str(v.body, 60_000));
        const cfg = hub.snap.config;
        if (!existed && !(cfg.skills ?? []).some((c) => c.name === name)) {
          cfg.skills = cleanProjectSkills([...(cfg.skills ?? []), { name, roles: v.roles }], cfg.roles.map((r) => r.id));
          hub.configChanged();
        }
        refreshSkills();
        hub.activity("config", null, `${existed ? "Saved" : "Added"} the skill ${name} (.yacc/skills/${name}/SKILL.md). Agents get it on their next start.`);
      } catch (err) {
        hub.activity("config", null, err instanceof SkillError ? `Skill not saved: ${err.message}` : `Couldn't save the skill: ${err instanceof Error ? err.message : err}`);
      }
    },

    /** Deletes a project skill's folder and takes it from every role. */
    removeProjectSkill: (name) => {
      const n = str(name, 64);
      removeProjectSkill(hub.repo.root, n);
      const cfg = hub.snap.config;
      if ((cfg.skills ?? []).some((c) => c.name === n)) {
        cfg.skills = (cfg.skills ?? []).filter((c) => c.name !== n);
        if (!cfg.skills.length) delete cfg.skills;
        hub.configChanged();
      }
      refreshSkills();
      hub.activity("config", null, `Removed the skill ${n}. Agents that had it lose it on their next start.`);
    },

    /** Reads .yacc/skills/ again (after you add or edit a folder by hand). */
    refreshProjectSkills: () => refreshSkills(),

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
      prefetchSkills();
    },

    resolveAccess: (id, decision) => {
      const d = decision === "agent" || decision === "everyone" || decision === "deny" ? decision : null;
      if (d) return resolveAccess(hub, sbx, planner, str(id, 40), d);
    },

    completeWelcome: async (raw) => {
      if (!hub.snap.welcome) return;
      const input = (raw ?? {}) as Partial<WelcomeInput>;
      const cli = (c: unknown): AgentCli => AGENT_CLIS.find((x) => x === c) ?? "claude";
      const used = new Set<string>();
      const cfg = hub.snap.config;
      // The template gives the roles, the workflow and the defaults; the welcome screen gives the people.
      const { templates } = listTemplates(hub.repo.root);
      const tpl = templates.find((t) => t.id === input.templateId) ?? BUILT_IN_TEMPLATES[0];
      const roles: RoleConfig[] = structuredClone(tpl.roles);
      // A worker's role: one the template has, else a card from the role library, else a new role with the general rules.
      const roleFor = (ref: string): RoleConfig => {
        const clean = str(ref, 40).trim() || roles.find((r) => r.id !== LEAD_ROLE_ID)?.title || "Developer";
        let role = roles.find((r) => r.id !== LEAD_ROLE_ID && (r.id === clean.toLowerCase() || r.title.toLowerCase() === clean.toLowerCase()));
        if (!role) {
          const fromLibrary = libraryCard(clean);
          role = fromLibrary && !roles.some((r) => r.id === fromLibrary.id) ? roleFromCard(fromLibrary) : { id: freeRoleId({ roles }, clean), title: clean, can: ["work"], instructions: tpl.deliverable === "pull-request" ? DEVELOPER_INSTRUCTIONS : WORKER_BASE_INSTRUCTIONS };
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
        // No sandboxes on this machine but Local mode works: start there, so the team can start right away.
        if (!hub.snap.setup.sandboxReady && hub.snap.setup.localReady) agent.mode = "local";
        return agent;
      };
      const lead = make(input.lead?.name ?? LEAD_NAME, LEAD_ROLE_ID, cli(input.lead?.cli), CEO_ID);
      const workers = (Array.isArray(input.workers) ? input.workers : []).slice(0, MAX_AGENTS_CEILING - 1).map((w) => make(w?.name ?? "", roleFor(w?.role ?? "").id, cli(w?.cli), lead.id));
      if (typeof input.projectName === "string" && input.projectName.trim()) cfg.project.name = str(input.projectName, 80).trim();
      cfg.roles = roles;
      cfg.team = [lead, ...workers];
      cfg.limits.maxAgents = Math.max(tpl.maxAgents ?? cfg.limits.maxAgents, cfg.team.length);
      if (tpl.autonomy) cfg.autonomy = { ...tpl.autonomy };
      if (tpl.officeName && !cfg.project.officeName) cfg.project.officeName = tpl.officeName;
      if (tpl.theme && !cfg.project.theme) cfg.project.theme = tpl.theme;
      cfg.workflow.item = tpl.item;
      cfg.workflow.stages = structuredClone(tpl.stages);
      // Pull requests need GitHub; without a remote the work is files (normalizeConfig turns a PR gate into a review).
      cfg.workflow.deliverable = tpl.deliverable === "pull-request" && hub.repo.github ? "pull-request" : "files";
      if (tpl.brief && !extra.memory.read().brief.trim()) extra.memory.set({ brief: tpl.brief.trim() + "\n" });
      const tools: ReviewTool[] = ["coderabbit", "greptile", "copilot", "human", "custom"];
      if (tools.includes(input.reviewTool as ReviewTool)) cfg.workflow.review.tool = input.reviewTool as ReviewTool;
      if (typeof input.reviewEnabled === "boolean") cfg.workflow.review.enabled = input.reviewEnabled;
      const stack = cleanStack(input.stack);
      if (stack) cfg.stack = stack;
      // The template's toolkits, or the ones picked on the welcome screen; and the template's own skills.
      const roleIds = roles.map((r) => r.id);
      const kits = cleanToolkits(input.toolkits !== undefined ? input.toolkits : (tpl.toolkits ?? []), roleIds);
      if (kits.length) cfg.toolkits = kits;
      for (const sk of tpl.skills ?? []) if (!readProjectSkill(hub.repo.root, sk.name)) {
        try {
          if (sk.dir) cpSync(sk.dir, join(skillsDir(hub.repo.root), sk.name), { recursive: true });
          else writeProjectSkill(hub.repo.root, sk.name, sk.description, sk.body);
        } catch (err) {
          hub.activity("config", null, `The template's skill ${sk.name} wasn't added: ${err instanceof Error ? err.message : err}`);
        }
      }
      const own = cleanProjectSkills((tpl.skills ?? []).map((sk) => ({ name: sk.name, roles: sk.roles })), roleIds);
      if (own.length) cfg.skills = own;
      hub.snap.projectSkills = listProjectSkills(hub.repo.root);
      const schedules = cleanSchedules(tpl.schedules ?? []);
      if (schedules.length) cfg.schedules = schedules;
      hub.snap.agents = cfg.team.map((a) => Hub.freshStatus(a.id));
      hub.snap.welcome = false;
      hub.configChanged(); // saves .yacc/config.yml for the first time
      hub.planChanged();
      prefetchSkills(true); // retried on Start
      extra.scheduler?.start();
      await sessions.recheckSetup();
      await sbx.refresh();
      hub.emit({ type: "snapshot", snapshot: structuredClone(hub.snap) });
      hub.activity("config", null, `Welcome! ${tpl.name} created: ${cfg.team.map((a) => a.name).join(", ")}. Press Start team when you're ready.`);
    },

    updateWorkflow: (patch) => {
      const p = (patch ?? {}) as WorkflowPatch;
      const wf = hub.snap.config.workflow;
      const mergeBy = wf.merge.by;
      const deliverableBefore = wf.deliverable;
      if (typeof p.item === "string" && p.item.trim()) wf.item = str(p.item, 30).trim();
      if (p.deliverable === "files" || p.deliverable === "pull-request") wf.deliverable = p.deliverable;
      if (Array.isArray(p.stages) && p.stages.length)
        wf.stages = p.stages.slice(0, 12).map((st) => ({
          id: str(st?.id ?? "", 40),
          name: str(st?.name ?? "", 30),
          owner: str(st?.owner ?? "any", 40),
          gate: st?.gate,
          ...(st?.reviewer ? { reviewer: str(st.reviewer, 40) } : {}),
          ...(typeof st?.description === "string" && st.description.trim() ? { description: str(st.description, 400) } : {}),
        })); // normalizeConfig (in configChanged) checks owners, gates and ids
      Object.assign(wf.review, p.review ?? {});
      if (p.merge?.by === "human" || p.merge?.by === "lead") wf.merge.by = p.merge.by;
      if (typeof p.retrospective === "boolean") {
        if (p.retrospective) delete wf.retrospective;
        else wf.retrospective = false;
      }
      Object.assign(wf.deploy, p.deploy ?? {});
      hub.configChanged();
      if (wf.deliverable !== deliverableBefore) void sessions.recheckSetup();
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
      if (p.theme !== undefined) {
        const theme = cleanTheme(p.theme);
        if (theme) project.theme = theme;
        else delete project.theme;
      }
      const exportOn = typeof p.exportPlan === "boolean" && p.exportPlan && !project.exportPlan;
      if (typeof p.exportPlan === "boolean") project.exportPlan = p.exportPlan;
      hub.configChanged();
      if (exportOn) {
        hub.planChanged();
        hub.activity("config", null, "Plan export on: HQ writes docs/plan.md whenever the plan changes.");
      }
    },

    /** An uploaded picture for an agent or the CEO ("ceo"); null takes it away. */
    setAvatarImage: (who, png) => {
      const cfg = hub.snap.config;
      const target = str(who, 80);
      const holder: { avatar?: AvatarConfig; name: string } | undefined = target === CEO_ID ? cfg.ceo : hub.cfg(target);
      if (!holder) return;
      const root = hub.repo.root;
      const old = holder.avatar?.image;
      if (png === null) {
        if (!old) return;
        const { image: _gone, ...look } = holder.avatar ?? {};
        if (Object.keys(look).length) holder.avatar = look;
        else delete holder.avatar;
        hub.configChanged();
        removeAvatar(root, old);
        return;
      }
      try {
        const image = saveAvatar(root, target, str(png, 400_000));
        holder.avatar = { ...(holder.avatar ?? {}), image };
        hub.configChanged();
        removeAvatar(root, old);
      } catch (err) {
        hub.activity("config", target === CEO_ID ? null : target, err instanceof AvatarError ? `Picture not saved: ${err.message}` : `Couldn't save the picture: ${err instanceof Error ? err.message : err}`);
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
