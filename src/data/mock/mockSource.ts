import { PROVIDERS, cleanRouting } from "../models";
import { agentPalette } from "../../theme/tokens";
import type { OfficeDataSource, OfficeEvent, SimSpeed } from "../source";
import { stackDomains } from "../stack";
import { HOST_TERMINAL, LEAD_ROLE_ID, PERMISSIONS, type AccessRequest, AgentConfig, AgentPatch, Board, NewAgentInput, NewRoleInput, OrgPatch, ProjectMemory, ProjectConfig, RolePatch, SandboxSettings, WorkflowPatch } from "../types";
import { MAX_AGENTS_CEILING, WORKER_BASE_INSTRUCTIONS, findRole, freeRoleId, wouldLoop } from "../roles";
import { nextAgentName } from "../names";
import { BUILT_IN_TEMPLATES } from "../templates";
import { bundleToTemplateLoose, previewTemplate, templateToBundle } from "../templateBundle";
import { channelsOf, cleanMessaging, isChannel, type MessagingConfig } from "../messaging";
import { cleanSchedules, fill, nextRun, type Schedule } from "../schedules";
import { SKILL_NAME, cleanProjectSkills, cleanToolkits, type ProjectSkillChoice, type ToolkitChoice } from "../toolkits";
import { defaultPresetId, presets, type Preset } from "./presets";
import { Simulation } from "./simulation";
import * as T from "./terminalScripts";
import { mockSbx, mockSession, mockSetup, World } from "./world";

const TICK_MS = 50;
const TERM_MS = 30;


/** Demo pictures: name → data URL (the real HQ writes them to .yacc/avatars/). */
const mockAvatars = new Map<string, string>();
let mockAvatarSeq = 1;

export function createMockSource(): OfficeDataSource {
  let presetId = defaultPresetId;
  let world = new World(findPreset(presetId));
  let sim = new Simulation(world);
  let listener: ((e: OfficeEvent) => void) | null = null;
  let timers: number[] = [];
  let last = 0;
  let inputBuf = new Map<string, string>();

  /** The demo's .yacc/skills/: kept in memory. */
  const mockSkills = new Map<string, { name: string; description: string; body: string }>([
    [
      "pr-checklist",
      {
        name: "pr-checklist",
        description: "Use before opening a pull request: what to check and what to write in it.",
        body: "# Before you open a pull request\n\n- Run the tests and the linter; both pass.\n- The PR says what changed, why, and how you checked it.\n- One task, one PR. Nothing unrelated.",
      },
    ],
  ]);
  const mockScheduleRuns = new Map<string, { at: string; result: string }>();
  const publishMockSchedules = () => {
    const now = new Date();
    world.snap.schedules = (world.snap.config.schedules ?? []).map((s) => ({
      id: s.id,
      lastRun: mockScheduleRuns.get(s.id)?.at ?? null,
      lastResult: mockScheduleRuns.get(s.id)?.result ?? null,
      nextRun: s.enabled && s.every ? (nextRun(s, now)?.toISOString() ?? null) : null,
    }));
    listener?.({ type: "schedules.updated", schedules: structuredClone(world.snap.schedules) });
  };
  const publishMockSkills = () => {
    world.snap.schedules = (world.snap.config.schedules ?? []).map((s) => ({ id: s.id, lastRun: null, lastResult: null, nextRun: s.enabled && s.every ? (nextRun(s, new Date())?.toISOString() ?? null) : null }));
    world.snap.projectSkills = [...mockSkills.values()].sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ name: s.name, description: s.description, problem: null }));
    listener?.({ type: "skills.updated", skills: structuredClone(world.snap.projectSkills) });
  };

  /** The demo's gallery: a couple of templates made from the built-ins, renamed. */
  const demoGallery = [
    { id: "newsletter", name: "Newsletter desk", description: "A weekly newsletter: research, write, edit, and you sign off before it goes out.", url: "demo:newsletter", tags: ["writing"], bundle: templateToBundle({ ...BUILT_IN_TEMPLATES[1], id: "newsletter", name: "Newsletter desk", description: "A weekly newsletter: research, write, edit, and you sign off before it goes out.", source: "user" }) },
    { id: "market-research", name: "Market research", description: "Questions in, a sourced report out: survey, analyse, review.", url: "demo:market-research", tags: ["research"], bundle: templateToBundle({ ...BUILT_IN_TEMPLATES[2], id: "market-research", name: "Market research", description: "Questions in, a sourced report out: survey, analyse, review.", source: "user" }) },
  ];

  function findPreset(id: string): Preset {
    return presets.find((p) => p.id === id) ?? presets[0];
  }

  /** Fresh world for the current preset (keeps the speed). */
  function reset() {
    const speed = world.speed;
    world.clearTimers();
    world.setEmitter(null);
    world = new World(findPreset(presetId));
    world.speed = speed;
    sim = new Simulation(world);
    inputBuf = new Map();
    openShells.clear();
  }

  function boot() {
    world.savedConfig = structuredClone(world.snap.config);
    if (!world.audit.length) {
      const team = world.snap.config.team;
      const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
      const lead = team.find((a) => a.isLead) ?? team[0];
      const dev = team.find((a) => !a.isLead);
      world.audit = [
        ...(dev ? [{ at: ago(4), kind: "assign" as const, actor: lead.id, summary: `Assigned a task to ${dev.name}`, target: dev.id }] : []),
        { at: ago(32), kind: "access", actor: "you", summary: "Allowed for every sandbox: registry.npmjs.org", target: "registry.npmjs.org" },
        { at: ago(75), kind: "config", actor: "you", summary: "Changed workflow" },
        { at: ago(120), kind: "secret", actor: "you", summary: "Set the anthropic key for every sandbox (the value isn't recorded)" },
      ];
    }
    world.snap.schedules = (world.snap.config.schedules ?? []).map((s) => ({ id: s.id, lastRun: null, lastResult: null, nextRun: s.enabled && s.every ? (nextRun(s, new Date())?.toISOString() ?? null) : null }));
    world.snap.projectSkills = [...mockSkills.values()].sort((a, b) => a.name.localeCompare(b.name)).map((x) => ({ name: x.name, description: x.description, problem: null }));
    world.setEmitter((e) => listener?.(e));
    listener?.({ type: "snapshot", snapshot: structuredClone(world.snap) });
    sim.start();
  }

  function loop() {
    const t = performance.now();
    const dt = Math.min(0.25, (t - last) / 1000) * world.speed;
    last = t;
    world.advance(dt);
    sim.tick(dt);
  }

  /** Rebuilds the mock "sbx" state from config, keeping any keys set in the UI. */
  function syncSbx() {
    const old = world.snap.sbx;
    const next = mockSbx(world.snap.config.team, world.snap.config.project.name);
    next.globalKeys = old.globalKeys;
    next.proxy = old.proxy;
    for (const id of Object.keys(next.agents)) if (old.agents[id]) (next.agents[id].keys = old.agents[id].keys), (next.agents[id].approvals = old.agents[id].approvals);
    world.snap.sbx = next;
    world.emit({ type: "sbx.updated", sbx: structuredClone(next) });
  }

  function hostCmd(agentId: string, text: string) {
    world.write(agentId, [{ text: `\x1b[38;2;102;114;159mhq ▸ ${text}\x1b[0m` }]);
  }

  /** Demo "Shell" tab: a pretend shell inside the agent's sandbox. */
  const shellPrompt = (id: string) =>
    id === HOST_TERMINAL
      ? `\x1b[38;2;108;240;138myou@mac\x1b[0m:\x1b[38;2;41;173;255m${hostDir}\x1b[0m$ `
      : `\x1b[38;2;108;240;138m${id.slice(6)}@sandbox\x1b[0m:\x1b[38;2;41;173;255m~/workspace\x1b[0m$ `;
  let hostDir = "~/askwell";
  const shellOut = (id: string, data: string) => listener?.({ type: "terminal.output", agentId: id, data });
  const DEMO_SHELL: Record<string, string> = {
    ls: "README.md  app  components  lib  package.json  pnpm-lock.yaml",
    pwd: "/Users/you/.yacc/askwell/workspace",
    "git status": "On branch p3-t02-chat-route\r\nChanges not staged for commit:\r\n  modified:   app/api/chat/route.ts",
    "node -v": "v22.11.0",
    whoami: "agent",
    "npm run dev": "\x1b[1m  ▲ Next.js 15.1\x1b[0m\r\n  - Local:   http://localhost:3000\r\n\r\n ✓ Ready in 1.2s",
  };
  function demoShell(id: string, data: string) {
    let buf = inputBuf.get(id) ?? "";
    for (const ch of data) {
      if (ch === "\r") {
        const cmd = buf.trim();
        buf = "";
        shellOut(id, "\r\n");
        if (cmd) shellOut(id, `${DEMO_SHELL[cmd] ?? `(demo shell) ${cmd}: try ls, pwd, git status, node -v, npm run dev`}\r\n`);
        shellOut(id, shellPrompt(id));
      } else if (ch === "\x7f") {
        if (buf.length) (buf = buf.slice(0, -1)), shellOut(id, "\b \b");
      } else if (ch >= " ") {
        buf += ch;
        shellOut(id, ch);
      }
    }
    inputBuf.set(id, buf);
  }
  const openShells = new Set<string>();

  const source: OfficeDataSource = {
    connect(onEvent, onStatus) {
      listener = onEvent;
      onStatus?.("open");
      last = performance.now();
      reset();
      boot();
      timers = [
        window.setInterval(loop, TICK_MS),
        window.setInterval(() => world.flushTerminals(Math.max(1, Math.round(world.speed * 1.3))), TERM_MS),
      ];
      return () => {
        timers.forEach((id) => window.clearInterval(id));
        timers = [];
        world.clearTimers();
        world.setEmitter(null);
        listener = null;
      };
    },

    sendTerminalInput(agentId, data) {
      if (agentId.startsWith("shell:")) return openShells.has(agentId) ? demoShell(agentId, data) : undefined;
      // Echo printable input; act on Enter.
      let buf = inputBuf.get(agentId) ?? "";
      for (const ch of data) {
        if (ch === "\r") {
          const text = buf.trim();
          buf = "";
          listener?.({ type: "terminal.output", agentId, data: "\r\n" });
          if (!text) continue;
          const st = world.status(agentId);
          if (st?.state === "needs-input") {
            world.after(0.6, () => sim.answer(agentId, "you"));
          } else {
            world.after(1, () => world.write(agentId, T.cannedReply(!!world.cfg(agentId)?.isLead, text.length)));
          }
        } else if (ch === "\x7f") {
          if (buf.length) {
            buf = buf.slice(0, -1);
            listener?.({ type: "terminal.output", agentId, data: "\b \b" });
          }
        } else if (ch >= " ") {
          buf += ch;
          listener?.({ type: "terminal.output", agentId, data: ch });
        }
      }
      inputBuf.set(agentId, buf);
    },

    sendMessage(toId, text) {
      if (!text.trim()) return;
      if (isChannel(toId)) {
        if (!channelsOf(world.snap.config).some((c) => c.id === toId)) return;
        world.message("you", toId, text.trim());
        return;
      }
      if (!world.cfg(toId)) return;
      world.message("you", toId, text.trim());
      world.after(1.2, () => world.write(toId, T.cannedReply(!!world.cfg(toId)?.isLead, text.length)));
    },

    resizeTerminal() {
      // The mock streams plain lines, so size doesn't matter.
    },

    startAgent(id) {
      const st = world.status(id);
      if (!st || st.session.state === "running") return;
      world.setStatus(id, { session: { ...st.session, state: "running", detail: null } });
      world.activity("session", id, `${world.name(id)}'s session started`);
      if (!world.cfg(id)?.isLead) sim.startWorker(id, 1.5);
    },

    stopAgent(id) {
      const st = world.status(id);
      if (!st) return;
      if (openShells.has(`shell:${id}`)) source.closeShell(id);
      sim.stopAgent(id);
      world.setStatus(id, { state: "idle", currentTaskId: null, note: "Stopped", session: { ...st.session, state: "stopped", detail: null } });
      world.activity("session", id, `${world.name(id)}'s session stopped`);
    },

    recreateSandbox(id) {
      const st = world.status(id);
      const r = world.cfg(id)?.sandbox.resources;
      if (!st || !r) return;
      world.setStatus(id, { session: { ...st.session, sandbox: { cpus: r.cpus ?? 8, memoryGb: r.memoryGb ?? 8 } } });
      hostCmd(id, `sbx rm hq-…-${id} && sbx run --cpus ${r.cpus ?? "auto"} --memory ${r.memoryGb ?? "auto"}g … (mock)`);
      world.activity("session", id, `Recreated ${world.name(id)}'s sandbox`);
    },

    openWorkspace(id) {
      hostCmd(id, `open ${world.status(id)?.session.workspace ?? "?"} (mock: nothing opens)`);
    },

    recheckSetup() {
      world.snap.setup = mockSetup();
      world.emit({ type: "setup.updated", setup: world.snap.setup });
    },

    runSetupFix() {
      // Everything is installed in the mock.
    },

    assignTask(taskId, agentId) {
      const task = world.task(taskId);
      const agent = world.cfg(agentId);
      if (!task || !agent || agent.isLead || task.status !== "todo") return;
      world.record("assign", "you", `Assigned ${task.id} "${task.title}" to ${agent.name}`, task.id);
      world.patchTask(taskId, { ownerId: agentId });
      world.activity("task.assigned", null, `You assigned ${taskId} ${task.title} to ${agent.name}`);
      if (!sim.hasJob(agentId) && world.status(agentId)?.state === "idle") {
        world.message(world.lead().id, agentId, `Pull main, start ${taskId}.`);
        world.after(1, () => sim.begin(agentId, taskId), agentId);
      }
    },

    addAgent(input: NewAgentInput) {
      const team = world.snap.config.team;
      const base = T.slug(input.name.trim() || nextAgentName(team.map((a) => a.name))) || "agent";
      let id = base;
      for (let i = 2; team.some((a) => a.id === id); i++) id = `${base}-${i}`;
      const used = new Set(team.map((a) => a.color));
      const color = agentPalette.find((c) => !used.has(c)) ?? agentPalette[team.length % agentPalette.length];
      const lead = world.lead();
      const cfg = world.snap.config;
      const wanted = input.role.trim() || "Developer";
      let role = findRole(cfg, wanted);
      if (!role || role.id === LEAD_ROLE_ID) {
        role = { id: freeRoleId(cfg, wanted), title: wanted, can: ["work"], instructions: WORKER_BASE_INSTRUCTIONS };
        cfg.roles.push(role);
      }
      const agent: AgentConfig = {
        id, name: input.name.trim() || nextAgentName(team.map((a) => a.name)), roleId: role.id, reportsTo: input.reportsTo && (input.reportsTo === "ceo" || world.cfg(input.reportsTo)) ? input.reportsTo : lead.id, role: role.title, isLead: false, cli: input.cli ?? "claude",
        model: input.model ?? "", mode: input.mode, color, skills: ["plan", "review"],
        roleMd: "",
        sandbox: structuredClone(lead.sandbox),
        workspacePath: null,
      };
      team.push(agent);
      world.snap.agents.push({
        agentId: id, state: "idle", currentTaskId: null, stateSince: new Date().toISOString(), note: null,
        session: mockSession(world.snap.config.project.name, id),
      });
      world.configChanged();
      world.emit({ type: "agent.updated", agent: { ...world.snap.agents[world.snap.agents.length - 1] } });
      world.syncEnvironments();
      world.activity("config", null, `Added ${agent.name} (${agent.role}) — new sandbox starting`);
      world.write(id, T.banner(agent.name, agent.role, world.snap.config.project.repo, agent.mode));
      hostCmd(id, `sbx run claude · allow host.docker.internal:${world.snap.config.project.hqPort}`);
      syncSbx();
      sim.startWorker(id, 2);
    },

    updateAgent(id, patch: AgentPatch) {
      const agent = world.cfg(id);
      if (!agent) return;
      if (typeof patch.desk === "number") {
        const holder = world.snap.config.team.find((a) => a !== agent && a.desk === patch.desk);
        if (holder) holder.desk = agent.desk;
      }
      // As on the server: model names don't carry over to another program.
      const switched = patch.cli && patch.cli !== agent.cli && typeof patch.model !== "string";
      const { budget, avatar, bio, reportsTo, ...rest } = patch;
      Object.assign(agent, rest);
      if (reportsTo && !agent.isLead && (reportsTo === "ceo" || world.cfg(reportsTo))) {
        if (wouldLoop(world.snap.config.team, agent.id, reportsTo)) world.activity("config", null, `${agent.name} can't report to ${world.cfg(reportsTo)?.name}: they already report to ${agent.name}.`);
        else agent.reportsTo = reportsTo;
      }
      if (avatar !== undefined) {
        const next = { ...(avatar ?? {}), ...(agent.avatar?.image ? { image: agent.avatar.image } : {}) };
        if (Object.keys(next).length) agent.avatar = next;
        else delete agent.avatar;
      }
      if (typeof bio === "string") {
        if (bio.trim()) agent.bio = bio.trim().slice(0, 280);
        else delete agent.bio;
      }
      if (budget !== undefined) {
        if (budget) agent.budget = budget;
        else delete agent.budget;
      }
      if (switched) agent.model = "";
      world.configChanged();
    },

    inspectWorkspace(id) {
      const st = world.status(id);
      if (!st) return;
      listener?.({
        type: "workspace.info",
        info: { agentId: id, path: st.session.workspace ?? "", managed: true, exists: true, changedFiles: 1, unpushedCommits: 2, sandboxName: `hq-mock-${id}`, sandboxExists: true },
      });
    },

    removeAgent(id) {
      const agent = world.cfg(id);
      if (!agent || agent.isLead) return;
      if (openShells.has(`shell:${id}`)) source.closeShell(id);
      sim.stopAgent(id);
      world.snap.config.team = world.snap.config.team.filter((a) => a.id !== id);
      world.snap.agents = world.snap.agents.filter((a) => a.agentId !== id);
      for (const t of world.snap.tasks)
        if (t.ownerId === id && t.status !== "done") world.patchTask(t.id, { ownerId: null, status: t.status === "in-progress" ? "todo" : t.status });
      world.emit({ type: "agent.removed", agentId: id });
      world.configChanged();
      world.syncEnvironments();
      world.activity("config", null, `Removed ${agent.name} — sandbox stopped`);
    },

    updateSandbox(agentId, patch: Partial<SandboxSettings>) {
      const agent = world.cfg(agentId);
      if (!agent) return;
      Object.assign(agent.sandbox, structuredClone(patch));
      world.configChanged();
      if (patch.allow || patch.deny) {
        hostCmd(agentId, `sbx policy allow/deny network --sandbox hq-mock-${agentId} … (mock)`);
        syncSbx();
      }
      world.activity("config", agentId, `Updated ${agent.name}'s sandbox settings`);
    },

    setSecret(agentId, service, value) {
      void value; // A real source pipes this to `sbx secret set`; HQ never keeps it.
      world.record("secret", "you", `Set the ${service} key ${agentId ? `for ${world.name(agentId)}'s sandbox` : "for every sandbox"} (the value isn't recorded)`);
      const sbx = world.snap.sbx;
      if (agentId === null) sbx.globalKeys = [...new Set([...sbx.globalKeys, service])];
      else if (sbx.agents[agentId]) sbx.agents[agentId].keys = [...new Set([...sbx.agents[agentId].keys, service])];
      world.emit({ type: "sbx.updated", sbx: structuredClone(sbx) });
      world.activity("config", agentId, `Stored the ${service} key ${agentId ? `for ${world.name(agentId)}` : "for every sandbox"} (mock)`);
    },

    removeSecret(agentId, service) {
      const sbx = world.snap.sbx;
      if (agentId === null) sbx.globalKeys = sbx.globalKeys.filter((k) => k !== service);
      else if (sbx.agents[agentId]) sbx.agents[agentId].keys = sbx.agents[agentId].keys.filter((k) => k !== service);
      world.emit({ type: "sbx.updated", sbx: structuredClone(sbx) });
    },

    setProxy(url) {
      world.snap.sbx.proxy = url;
      world.emit({ type: "sbx.updated", sbx: structuredClone(world.snap.sbx) });
    },

    openEnvFile(agentId) {
      hostCmd(agentId, `open ${world.snap.sbx.agents[agentId]?.envFile.path ?? "?"} (mock: nothing opens)`);
    },

    refreshSbx() {
      syncSbx();
    },

    resolveActionItem(id, decision, note) {
      const item = world.snap.actionItems?.find((i) => i.id === id);
      if (!item || item.status !== "open") return;
      item.status = decision;
      item.note = note?.trim() || null;
      item.closedAt = new Date().toISOString();
      world.emit({ type: "action.updated", item: { ...item } });
      if (item.kind === "role-change") {
        const role = world.snap.config.roles.find((r) => r.id === item.payload?.roleId);
        if (decision === "done" && role) {
          role.instructions = String(item.payload?.after ?? role.instructions);
          world.configChanged();
        }
        world.record("retro", "you", `${decision === "done" ? "Accepted" : "Rejected"} the change to the ${role?.title ?? "?"} role`, role?.id);
        world.message("hq", item.fromId, `The CEO ${decision === "done" ? "accepted" : "rejected"} your change to the ${role?.title ?? "?"} role.${item.note ? ` Note: ${item.note}` : ""}`);
        return;
      }
      world.message("you", item.fromId, decision === "done" ? `Done: ${item.title}${item.note ? ` (${item.note})` : ""}` : `Dismissed: ${item.title}${item.note ? ` (${item.note})` : ""}`);
    },

    refreshMcp() {
      if (world.snap.mcp) world.emit({ type: "mcp.updated", mcp: structuredClone(world.snap.mcp) });
    },

    addMcp(input) {
      const m = world.snap.mcp;
      const name = input.name.trim().toLowerCase();
      if (!m || !name || m.servers.some((s) => s.name === name)) return;
      m.servers.push({ name, transport: input.command ? "local stdio" : "remote http", status: input.apiKey || input.command ? "ready" : "needs-auth", nextStep: null });
      world.activity("config", null, `Added MCP server ${name}`);
      world.emit({ type: "mcp.updated", mcp: structuredClone(m) });
    },

    authMcp(name) {
      const m = world.snap.mcp;
      const s = m?.servers.find((x) => x.name === name);
      if (!m || !s) return;
      listener?.({ type: "terminal.output", agentId: `setup:mcp-auth-${name}`, data: `\x1b[2m$ sbx mcp auth ${name}\x1b[0m\r\nOpening your browser to sign in… (demo)\r\n\x1b[32m✓ Done\x1b[0m\r\n` });
      s.status = "ready";
      s.nextStep = null;
      world.emit({ type: "mcp.updated", mcp: structuredClone(m) });
    },

    removeMcp(name) {
      const m = world.snap.mcp;
      if (!m) return;
      m.servers = m.servers.filter((s) => s.name !== name);
      for (const a of world.snap.config.team) if (a.mcp?.includes(name)) a.mcp = a.mcp.filter((n) => n !== name);
      for (const id of Object.keys(m.attached)) m.attached[id] = m.attached[id].filter((n) => n !== name);
      world.configChanged();
      world.emit({ type: "mcp.updated", mcp: structuredClone(m) });
    },

    setAgentMcp(agentId, names) {
      const agent = world.cfg(agentId);
      const m = world.snap.mcp;
      if (!agent || !m) return;
      const added = names.filter((n) => !(agent.mcp ?? []).includes(n));
      agent.mcp = [...names];
      // Demo: running agents get new servers right away; unticked ones stay until the sandbox is recreated.
      if (world.status(agentId)?.session.state === "running") {
        m.attached[agentId] = [...new Set([...(m.attached[agentId] ?? []), ...added])];
        for (const n of added) hostCmd(agentId, `sbx mcp load ${n} --sandbox hq-mock-${agentId} (mock)`);
      }
      world.configChanged();
      world.emit({ type: "mcp.updated", mcp: structuredClone(m) });
    },

    answerApproval(agentId, approvalId, decision) {
      const st = world.snap.sbx.agents[agentId];
      const target = st?.approvals.find((a) => a.id === approvalId);
      if (!st || (approvalId !== "all" && !target)) return;
      if (decision === "allow") {
        const agent = world.cfg(agentId);
        const hosts = [...new Set((target ? [target] : st.approvals).map((a) => a.host))];
        for (const host of hosts) {
          if (agent && !agent.sandbox.allow.includes(host)) agent.sandbox.allow = [...agent.sandbox.allow, host];
          hostCmd(agentId, `sbx policy allow network --sandbox hq-mock-${agentId} ${host} (mock)`);
        }
        world.configChanged();
        world.activity("config", agentId, `You allowed ${target ? target.host : `${hosts.length} sites`} for ${world.name(agentId)}'s sandbox`);
      }
      st.approvals = approvalId === "all" ? [] : st.approvals.filter((a) => (decision === "allow" ? a.host !== target?.host : a.id !== approvalId));
      syncSbx();
    },

    replyBriefing(id: string, text: string) {
      const b = world.snap.briefings?.find((x) => x.id === id);
      if (!b) return;
      b.reply = text;
      b.read = true;
      world.emit({ type: "briefing.updated", briefing: { ...b } });
    },

    markBriefingsRead() {
      for (const b of world.snap.briefings ?? [])
        if (!b.read) {
          b.read = true;
          world.emit({ type: "briefing.updated", briefing: { ...b } });
        }
    },

    saveTemplate() {
      world.activity("config", null, "Templates are saved by real HQ, not the demo.");
    },

    updateMemory(patch: Partial<ProjectMemory>) {
      world.snap.memory = { ...(world.snap.memory ?? { brief: "", decisions: "", lessons: "" }), ...patch };
      world.emit({ type: "memory.updated", memory: { ...world.snap.memory } });
    },

    addRole(input: NewRoleInput) {
      const cfg = world.snap.config;
      const title = input.title.trim();
      if (!title || findRole(cfg, title)) return;
      cfg.roles.push({ id: freeRoleId(cfg, title), title, can: input.can ?? ["work"], instructions: input.instructions?.trim() || WORKER_BASE_INSTRUCTIONS });
      world.configChanged();
    },

    updateRole(id, patch: RolePatch) {
      const role = world.snap.config.roles.find((r) => r.id === id);
      if (!role) return;
      if (patch.title?.trim()) role.title = patch.title.trim();
      if (patch.can) role.can = PERMISSIONS.filter((p) => patch.can!.includes(p));
      if (typeof patch.instructions === "string") role.instructions = patch.instructions;
      if (patch.cli) role.cli = patch.cli;
      else if (patch.cli === null || (patch.cli as unknown) === "") delete role.cli;
      if (typeof patch.model === "string") {
        if (patch.model.trim()) role.model = patch.model.trim();
        else delete role.model;
      }
      if (Array.isArray(patch.tools)) {
        if (patch.tools.length) role.tools = [...new Set(patch.tools)];
        else delete role.tools;
      }
      world.configChanged();
    },

    setRouting(routing) {
      const cfg = world.snap.config;
      const clean = cleanRouting(routing);
      if (Object.keys(clean).length) cfg.routing = clean;
      else delete cfg.routing;
      world.configChanged();
    },

    useOwnModel(agentId) {
      world.setStatus(agentId, { using: null, limited: null });
    },

    setProviderAuth(provider, auth) {
      const cfg = world.snap.config;
      if (!PROVIDERS[provider]?.auth.includes(auth)) return;
      cfg.providers = { ...(cfg.providers ?? {}), [provider]: { auth } };
      world.configChanged();
    },

    removeRole(id) {
      const cfg = world.snap.config;
      if (id === LEAD_ROLE_ID || cfg.team.some((a) => a.roleId === id)) return;
      cfg.roles = cfg.roles.filter((r) => r.id !== id);
      world.configChanged();
    },

    updateOrg(patch: OrgPatch) {
      const cfg = world.snap.config;
      if (patch.ceoName?.trim()) cfg.ceo.name = patch.ceoName.trim();
      if (patch.ceoAvatar !== undefined) {
        const next = { ...(patch.ceoAvatar ?? {}), ...(cfg.ceo.avatar?.image ? { image: cfg.ceo.avatar.image } : {}) };
        if (Object.keys(next).length) cfg.ceo.avatar = next;
        else delete cfg.ceo.avatar;
      }
      if (patch.autonomy) cfg.autonomy = { ...cfg.autonomy, ...patch.autonomy };
      if (typeof patch.maxAgents === "number") cfg.limits.maxAgents = Math.max(cfg.team.length, 2, Math.min(MAX_AGENTS_CEILING, Math.round(patch.maxAgents)));
      if (patch.budget !== undefined) {
        if (patch.budget) cfg.limits.budget = patch.budget;
        else delete cfg.limits.budget;
      }
      world.configChanged();
    },

    async previewTemplate(src) {
      try {
        const raw = src.url ? demoGallery.find((g) => g.url === src.url)?.bundle : src.bundle;
        if (!raw) return { error: "The demo can only fetch its own gallery." };
        return { preview: previewTemplate(bundleToTemplateLoose(raw)) };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },

    async importTemplate(src, where) {
      try {
        const raw = src.url ? demoGallery.find((g) => g.url === src.url)?.bundle : src.bundle;
        if (!raw) return { error: "The demo can only fetch its own gallery." };
        const t = bundleToTemplateLoose(raw, where);
        world.snap.templates = [...(world.snap.templates ?? BUILT_IN_TEMPLATES).filter((x) => x.id !== t.id), t];
        listener?.({ type: "templates.updated", templates: structuredClone(world.snap.templates) });
        world.record("template", "you", `Installed the template "${t.name}" ${where === "project" ? "in this project" : "for you"}`, t.id);
        world.activity("config", null, `Installed the template "${t.name}".`);
        return { id: t.id, name: t.name };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },

    async exportTemplate(id) {
      const t = (world.snap.templates ?? BUILT_IN_TEMPLATES).find((x) => x.id === id);
      return t ? templateToBundle(t) : { error: `No template ${id}.` };
    },

    async deleteTemplate(id) {
      const list = world.snap.templates ?? BUILT_IN_TEMPLATES;
      const t = list.find((x) => x.id === id);
      if (!t || t.source === "built-in") return { error: "Built-in templates can't be deleted." };
      world.snap.templates = list.filter((x) => x.id !== id);
      listener?.({ type: "templates.updated", templates: structuredClone(world.snap.templates) });
      return {};
    },

    async listProjects() {
      const cfg = world.snap.config;
      const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
      return {
        projects: [
          { slug: cfg.project.id, name: cfg.project.name, root: cfg.project.path, port: 7420, running: true, current: true, missing: false, lastOpened: ago(0) },
          { slug: "studio", name: "Studio", root: "~/projects/studio", port: 7421, running: true, current: false, missing: false, lastOpened: ago(20) },
          { slug: "lab-notes", name: "Lab notes", root: "~/projects/lab-notes", port: 7422, running: false, current: false, missing: false, lastOpened: ago(96) },
        ],
      };
    },

    async openProject() {
      return { error: "The demo has only this project. Run YACC (npx yacc-hq) to switch between your own." };
    },

    async forgetProject() {
      return { error: "The demo's list can't change." };
    },

    async readGallery() {
      return { templates: demoGallery.map(({ bundle: _b, ...g }) => g) };
    },

    requestRetrospective() {
      const lead = world.lead();
      const role = world.snap.config.roles.find((r) => r.id !== lead.roleId && world.snap.config.team.some((a) => a.roleId === r.id));
      world.message("hq", lead.id, "[Retrospective] Look back on the last board and propose changes to role instructions.");
      world.record("retro", "you", "Asked for a retrospective");
      if (!role) return;
      world.after(2.5, () => {
        const after = `${role.instructions.trim()}\n- Before you open a pull request, run the whole test suite, not just the tests for your change.`;
        const item = {
          id: `ai${Date.now().toString(36)}`, kind: "role-change" as const, fromId: lead.id, taskId: null,
          title: `Change the ${role.title} role's instructions`,
          details: "Two PRs this board broke tests outside the files they changed; the full suite would have caught it.",
          payload: { roleId: role.id, before: role.instructions, after, reason: "Two PRs this board broke tests outside the files they changed." },
          waiting: false, status: "open" as const, note: null, at: new Date().toISOString(), closedAt: null,
        };
        world.snap.actionItems = [item, ...(world.snap.actionItems ?? [])];
        world.emit({ type: "action.updated", item: { ...item } });
        world.activity("agent.needs-input", lead.id, `${lead.name} proposes a change to the ${role.title} role (retrospective)`);
      });
    },

    async readAudit(q) {
      const limit = Math.min(Math.max(q.limit ?? 100, 1), 1000);
      const words = q.text?.trim().toLowerCase();
      const all = world.audit.filter((e) => (!q.before || e.at < q.before) && (!q.kind || e.kind === q.kind) && (!q.actor || e.actor === q.actor) && (!words || `${e.summary} ${e.target ?? ""}`.toLowerCase().includes(words)));
      return { entries: all.slice(0, limit), more: all.length > limit };
    },

    updateSchedules(list: Schedule[]) {
      const cfg = world.snap.config;
      const clean = cleanSchedules(list);
      if (clean.length) cfg.schedules = clean;
      else delete cfg.schedules;
      world.configChanged();
      publishMockSchedules();
    },

    runSchedule(id: string) {
      const s = world.snap.config.schedules?.find((x) => x.id === id);
      if (!s) return;
      const lead = world.lead();
      const tag = `[Schedule: ${s.name}]`;
      const vars = { date: new Date().toISOString().slice(0, 10) };
      let result: string;
      if (s.action === "message") {
        const to = !s.to || s.to === "lead" ? lead.id : s.to;
        world.message("hq", to, `${tag} ${fill(s.text, vars)}`);
        result = isChannel(to) ? `posted to ${to}` : `message sent to ${world.name(to)}`;
      } else {
        world.message("hq", lead.id, `${tag} New task: ${fill(s.title ?? s.name, vars)}. Plan it and assign it.`);
        result = "added a task for the lead to assign";
      }
      mockScheduleRuns.set(id, { at: new Date().toISOString(), result });
      world.record("schedule", "you", `Ran now "${s.name}": ${result}`, s.id);
      world.activity("config", null, `You ran "${s.name}": ${result}`);
      publishMockSchedules();
    },

    updateMessaging(m: MessagingConfig) {
      const cfg = world.snap.config;
      const clean = cleanMessaging(m, cfg.roles.map((r) => r.id));
      if (clean) cfg.messaging = clean;
      else delete cfg.messaging;
      world.configChanged();
    },

    updateToolkits(list: ToolkitChoice[]) {
      const cfg = world.snap.config;
      const kits = cleanToolkits(list, cfg.roles.map((r) => r.id));
      if (kits.length) cfg.toolkits = kits;
      else delete cfg.toolkits;
      world.configChanged();
    },

    updateProjectSkills(list: ProjectSkillChoice[]) {
      const cfg = world.snap.config;
      const own = cleanProjectSkills(list, cfg.roles.map((r) => r.id));
      if (own.length) cfg.skills = own;
      else delete cfg.skills;
      world.configChanged();
    },

    saveProjectSkill(input: { name: string; description: string; body: string; roles?: string[] }) {
      const name = input.name.trim();
      if (!SKILL_NAME.test(name) || !input.description.trim() || !input.body.trim()) {
        world.activity("config", null, "Skill not saved: give it a name (lowercase letters, numbers and dashes), a description and instructions.");
        return;
      }
      const existed = mockSkills.has(name);
      mockSkills.set(name, { name, description: input.description.replace(/\s+/g, " ").trim(), body: input.body.trim() });
      const cfg = world.snap.config;
      if (!existed && !(cfg.skills ?? []).some((c) => c.name === name)) cfg.skills = cleanProjectSkills([...(cfg.skills ?? []), { name, roles: input.roles }], cfg.roles.map((r) => r.id));
      publishMockSkills();
      world.configChanged();
      world.activity("config", null, `${existed ? "Saved" : "Added"} the skill ${name} (.yacc/skills/${name}/SKILL.md). Agents get it on their next start.`);
    },

    removeProjectSkill(name: string) {
      mockSkills.delete(name);
      const cfg = world.snap.config;
      cfg.skills = (cfg.skills ?? []).filter((c) => c.name !== name);
      if (!cfg.skills.length) delete cfg.skills;
      publishMockSkills();
      world.configChanged();
      world.activity("config", null, `Removed the skill ${name}. Agents that had it lose it on their next start.`);
    },

    refreshProjectSkills() {
      publishMockSkills();
    },

    async readProjectSkill(name: string) {
      return mockSkills.get(name) ?? null;
    },

    setAvatarImage(who: string, png: string | null) {
      const cfg = world.snap.config;
      const holder = who === "ceo" ? cfg.ceo : world.cfg(who);
      if (!holder) return;
      if (png === null) {
        if (!holder.avatar?.image) return;
        const { image: _gone, ...look } = holder.avatar;
        if (Object.keys(look).length) holder.avatar = look;
        else delete holder.avatar;
      } else {
        // The demo keeps pictures in memory, under the kind of name HQ would give the file.
        const image = `avatars/${who}-${(mockAvatarSeq++).toString(16).padStart(8, "0")}.png`;
        mockAvatars.set(image, png.startsWith("data:") ? png : `data:image/png;base64,${png}`);
        holder.avatar = { ...(holder.avatar ?? {}), image };
      }
      world.configChanged();
    },

    avatarUrl(image: string) {
      return mockAvatars.get(image) ?? "";
    },

    updateWorkflow(patch: WorkflowPatch) {
      const wf = world.snap.config.workflow;
      if (patch.item?.trim()) wf.item = patch.item.trim();
      if (patch.deliverable) wf.deliverable = patch.deliverable;
      if (patch.stages?.length) wf.stages = patch.stages;
      if (typeof patch.retrospective === "boolean") {
        if (patch.retrospective) delete wf.retrospective;
        else wf.retrospective = false;
      }
      Object.assign(wf.review, patch.review);
      Object.assign(wf.merge, patch.merge);
      Object.assign(wf.deploy, patch.deploy);
      world.configChanged();
      world.syncEnvironments();
      sim.workflowChanged();
      world.activity("config", null, "Workflow updated");
    },

    updateProject(patch: Partial<ProjectConfig>) {
      Object.assign(world.snap.config.project, patch);
      world.configChanged();
      world.syncEnvironments();
    },

    createBoard(title) {
      const clean = title.trim();
      if (!clean) return;
      const base = clean.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 3) || "B";
      let id = base;
      for (let i = 2; world.snap.boards.some((b) => b.id === id); i++) id = `${base}${i}`;
      const board: Board = { id, title: clean, status: "planned", order: world.snap.boards.length };
      world.snap.boards.push(board);
      world.emit({ type: "board.updated", board: { ...board } });
      world.activity("config", null, `Created board ${clean}`);
    },

    updateBoard(id, patch) {
      const board = world.snap.boards.find((b) => b.id === id);
      if (!board) return;
      Object.assign(board, patch);
      world.emit({ type: "board.updated", board: { ...board } });
    },

    openShell(id) {
      const tid = `shell:${id}`;
      if (openShells.has(tid)) return;
      openShells.add(tid);
      inputBuf.delete(tid);
      shellOut(tid, `\x1b[2m$ sbx exec -it hq-mock-${id} bash   (demo)\x1b[0m\r\n${shellPrompt(tid)}`);
    },

    openHostShell(dir, fresh) {
      const want = dir.trim() || "~/askwell";
      if (openShells.has(HOST_TERMINAL) && !fresh && want === hostDir) return;
      if (openShells.has(HOST_TERMINAL)) shellOut(HOST_TERMINAL, "\x1bc");
      hostDir = want;
      openShells.add(HOST_TERMINAL);
      inputBuf.delete(HOST_TERMINAL);
      shellOut(HOST_TERMINAL, `\x1b[2m$ zsh in ${hostDir}   (demo)\x1b[0m\r\n${shellPrompt(HOST_TERMINAL)}`);
    },

    closeHostShell() {
      openShells.delete(HOST_TERMINAL);
    },

    forwardPort(agentId, port) {
      const st = world.snap.sbx.agents[agentId];
      if (!st || st.ports?.some((p) => p.sandbox === port)) return;
      st.ports = [...(st.ports ?? []), { sandbox: port, host: port }].sort((a, b) => a.sandbox - b.sandbox);
      world.emit({ type: "sbx.updated", sbx: structuredClone(world.snap.sbx) });
      world.activity("config", agentId, `Forwarded port ${port} from ${world.name(agentId)}'s sandbox to localhost:${port} on this machine. (demo)`);
    },

    unforwardPort(agentId, port) {
      const st = world.snap.sbx.agents[agentId];
      if (!st) return;
      st.ports = (st.ports ?? []).filter((p) => p.sandbox !== port);
      world.emit({ type: "sbx.updated", sbx: structuredClone(world.snap.sbx) });
    },

    closeShell(id) {
      openShells.delete(`shell:${id}`);
      inputBuf.delete(`shell:${id}`);
      shellOut(`shell:${id}`, "\r\n\x1b[2m[shell closed]\x1b[0m\r\n");
    },

    completeWelcome() {
      // The demo never shows the welcome screen.
    },

    updateStack(stack) {
      if (stack) world.snap.config.stack = structuredClone(stack);
      else delete world.snap.config.stack;
      world.configChanged();
    },

    resolveAccess(requestId, decision) {
      const req = world.snap.accessRequests?.find((r) => r.id === requestId);
      if (!req || req.status !== "pending") return;
      req.status = decision === "deny" ? "denied" : "allowed";
      world.emit({ type: "access.updated", request: { ...req } });
      const who = world.name(req.agentId);
      world.record("access", "you", `${decision === "deny" ? "Denied" : decision === "everyone" ? "Allowed for every sandbox" : `Allowed for ${who}`}: ${req.domain}`, req.domain);
      if (decision === "deny") {
        world.activity("config", req.agentId, `You denied ${who} access to ${req.domain}`);
        world.write(req.agentId, [{ text: `\x1b[38;2;255;0;77mhq ▸ access to ${req.domain} denied — continuing without it\x1b[0m` }]);
      } else {
        const ids = decision === "everyone" ? world.snap.config.team.filter((a) => a.mode === "sandbox").map((a) => a.id) : [req.agentId];
        for (const id of ids) {
          const a = world.cfg(id);
          if (a && !a.sandbox.allow.includes(req.domain)) a.sandbox.allow = [...a.sandbox.allow, req.domain];
          hostCmd(id, `sbx policy allow network --sandbox hq-mock-${id} ${req.domain} (mock)`);
        }
        world.configChanged();
        syncSbx();
        world.activity("config", req.agentId, `You allowed ${req.domain} for ${decision === "everyone" ? "every agent" : who}`);
      }
      if (world.status(req.agentId)?.state === "needs-input") world.setStatus(req.agentId, { state: "working", note: decision === "deny" ? "Continuing without it" : `Reading ${req.domain}` });
    },

    dev: {
      presets: presets.map((p) => ({ id: p.id, label: p.label })),
      loadPreset(id) {
        presetId = id;
        reset();
        boot();
      },
      setSpeed(multiplier: SimSpeed) {
        world.speed = multiplier;
      },
      simulateAccessRequest() {
        const busy = world.snap.agents.filter((s) => s.session.state === "running" && s.state !== "needs-input" && !world.cfg(s.agentId)?.isLead);
        const st = busy[Math.floor(Math.random() * busy.length)];
        if (!st) return;
        // A domain this agent can't reach yet: from the stack if any, else a common docs site.
        const allowed = new Set(world.cfg(st.agentId)?.sandbox.allow ?? []);
        const open = (list: string[]) => list.filter((d) => !d.startsWith("*.") && !allowed.has(d));
        const fromStack = open(stackDomains(world.snap.config.stack).map((d) => d.domain));
        const pool = fromStack.length ? fromStack : open(["posthog.com", "docs.stripe.com", "hono.dev", "docs.arcjet.com"]);
        const domain = pool[Math.floor(Math.random() * pool.length)] ?? "example.com";
        const req: AccessRequest = { id: world.id("ar"), agentId: st.agentId, domain, reason: `Read the ${domain} docs before integrating it`, at: new Date().toISOString(), status: "pending" };
        world.snap.accessRequests = [req, ...(world.snap.accessRequests ?? [])].slice(0, 30);
        world.emit({ type: "access.updated", request: { ...req } });
        world.setStatus(st.agentId, { state: "needs-input", note: `Asking: access to ${domain}` });
        world.activity("agent.needs-input", st.agentId, `${world.name(st.agentId)} needs you: access to ${domain}`);
        world.write(st.agentId, [{ text: `\x1b[38;2;255;163;0mhq ▸ request_access ${domain} — "${req.reason}" (waiting for you)\x1b[0m` }]);
      },
    },
  };

  return source;
}
