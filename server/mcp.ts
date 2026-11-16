// The HQ Team MCP. Agents connect over Streamable HTTP (stateless) at /mcp,
// identified by the agent token + X-HQ-Agent header that HQ writes into their
// .mcp.json. Each agent is offered only the tools its role's permissions allow
// (src/data/roles.ts); everyone can message everyone and ask the CEO directly.

import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Hub } from "./hub";
import { requestAccess } from "./access";
import type { Planner } from "./planner";
import { can, findRole, managerName, roleOf, toolsFor } from "../src/data/roles";
import type { Permission } from "../src/data/types";
import type { Team } from "./team";
import type { Briefings } from "./briefings";
import type { Memory } from "./memory";
import { SHARED_DIR, type SharedFiles } from "./shared";
import { stageOf } from "../src/data/workflow";
import { ROLE_LIBRARY } from "../src/data/templates";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (value: unknown): Result => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const fail = (msg: string): Result => ({ content: [{ type: "text", text: msg }], isError: true });

/** Wraps a tool body: thrown errors become tool errors the agent can read. */
function guard<A>(fn: (args: A) => Result | Promise<Result>) {
  return async (args: A): Promise<Result> => {
    try {
      return await fn(args);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  };
}

/** Briefings, shared files and project memory, for the tools that use them. */
export interface McpExtras {
  briefings: Briefings;
  shared: SharedFiles;
  memory: Memory;
}

function buildServer(hub: Hub, planner: Planner, team: Team, extras: McpExtras, me: string): McpServer {
  const base = new McpServer({ name: "hq", version: "0.2.0" });
  const cfg = hub.snap.config;
  const allowed = new Set(toolsFor(roleOf(cfg, hub.cfg(me) ?? { roleId: "" })));
  // Only the tools this agent's role allows are offered at all.
  const server = {
    registerTool: ((name: string, ...rest: unknown[]) => {
      if (allowed.has(name)) (base.registerTool as (...a: unknown[]) => unknown)(name, ...rest);
    }) as typeof base.registerTool,
  };
  /** Checked again at call time: a role can change while a session is running. */
  const needs = (permission: Permission) => {
    if (!can(hub.snap.config, hub.cfg(me), permission)) throw new Error(`Your role can't do this (it needs the "${permission}" permission). Ask the lead with send_message.`);
  };
  const taskView = (id: string) => {
    const t = planner.task(id);
    return t && { ...t, owner: t.ownerId ? hub.name(t.ownerId) : null };
  };

  server.registerTool(
    "list_workers",
    {
      description: "The team: each agent's id, name, role, short bio, who they report to, whether they are running, and what they are doing now. Pass role to see only one role.",
      inputSchema: { role: z.string().optional().describe("A role id or title, e.g. developer") },
    },
    guard(({ role }: { role?: string }) => {
      const c = hub.snap.config;
      const wanted = role?.trim().toLowerCase();
      return ok(
        c.team
          .filter((a) => !wanted || a.roleId === wanted || a.role.toLowerCase() === wanted)
          .map((a) => {
            const st = hub.status(a.id);
            return {
              id: a.id, name: a.name, role: a.role, roleId: a.roleId, lead: a.isLead, reportsTo: managerName(c, a), you: a.id === me,
              ...(a.bio ? { bio: a.bio } : {}),
              ...(a.temporary ? { temporary: true } : {}),
              running: st?.session.state === "running", state: st?.state, task: st?.currentTaskId ?? null,
              // Free = can take a task now: running, its role does tasks, and it has none.
              free: st?.session.state === "running" && can(c, a, "work") && !planner.currentTask(a.id),
            };
          }),
      );
    }),
  );

  server.registerTool(
    "get_status",
    { description: "Live status of every agent (state, note, current task) plus the active boards with task counts." },
    guard(() =>
      ok({
        agents: hub.snap.agents.map((s) => ({ id: s.agentId, name: hub.name(s.agentId), state: s.state, note: s.note, task: s.currentTaskId, session: s.session.state })),
        boards: hub.snap.boards.map((b) => {
          const ts = hub.snap.tasks.filter((t) => t.boardId === b.id);
          const n = (st: string) => ts.filter((t) => t.status === st).length;
          return { id: b.id, title: b.title, status: b.status, todo: n("todo"), inProgress: n("in-progress"), inReview: n("in-review"), blocked: n("blocked"), done: n("done") };
        }),
      }),
    ),
  );

  server.registerTool(
    "list_tasks",
    {
      description: "Tasks, optionally filtered by board, status or owner.",
      inputSchema: {
        boardId: z.string().optional().describe("Board id, e.g. P3"),
        status: z.enum(["todo", "in-progress", "in-review", "done", "blocked"]).optional(),
        owner: z.string().optional().describe("Agent id or name"),
      },
    },
    guard(({ boardId, status, owner }: { boardId?: string; status?: string; owner?: string }) => {
      const ownerId = owner ? planner.agentId(owner) : undefined;
      const list = hub.snap.tasks.filter((t) => (!boardId || t.boardId === boardId) && (!status || t.status === status) && (!owner || t.ownerId === ownerId));
      return ok(list.map((t) => ({ id: t.id, board: t.boardId, title: t.title, status: t.status, owner: t.ownerId ? hub.name(t.ownerId) : null, needs: t.needs })));
    }),
  );

  server.registerTool(
    "create_board",
    { description: "Create a board (a phase or an area of work).", inputSchema: { title: z.string(), active: z.boolean().optional().describe("Agents only pick tasks from active boards") } },
    guard(({ title, active }: { title: string; active?: boolean }) => {
      needs("plan");
      return ok(planner.createBoard(title, active ? "active" : "planned"));
    }),
  );

  server.registerTool(
    "update_board",
    {
      description: "Rename a board, or set its status: planned, active (agents pick tasks from it) or done. When a board is done, HQ may ask you for a retrospective.",
      inputSchema: { boardId: z.string(), title: z.string().optional(), status: z.enum(["planned", "active", "done"]).optional() },
    },
    guard(({ boardId, title, status }: { boardId: string; title?: string; status?: "planned" | "active" | "done" }) => {
      needs("plan");
      if (status === "done") {
        const open = planner.snapshotTasks().filter((t) => t.boardId === boardId && t.status !== "done");
        if (open.length) throw new Error(`${open.length} task${open.length > 1 ? "s are" : " is"} not done yet: ${open.map((t) => t.id).join(", ")}. Finish or move ${open.length > 1 ? "them" : "it"} first.`);
      }
      return ok(planner.updateBoard(boardId, { title, status }));
    }),
  );

  server.registerTool(
    "create_task",
    {
      description: "Add a task. Keep tasks small, each with a clear done-when.",
      inputSchema: {
        title: z.string(),
        boardId: z.string().optional().describe("Defaults to the first active board"),
        description: z.string().optional().describe("What to do and why"),
        files: z.array(z.string()).optional().describe("The only files/folders this task may edit"),
        doneWhen: z.string().optional().describe("Acceptance criteria"),
        needs: z.array(z.string()).optional().describe("Task ids that must be done first"),
        stage: z.string().optional().describe("Workflow stage to start in (id or name). Left out: the first stage."),
        kind: z.string().optional().describe("Kind of work, e.g. research or writing. Routing rules (see your role) pick the model for it."),
      },
    },
    guard((args: { title: string; boardId?: string; description?: string; files?: string[]; doneWhen?: string; needs?: string[]; stage?: string; kind?: string }) => {
      needs("plan");
      return ok(planner.createTask(args, me));
    }),
  );

  server.registerTool(
    "update_task",
    {
      description: "Edit a task's details or status.",
      inputSchema: {
        taskId: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        files: z.array(z.string()).optional(),
        doneWhen: z.string().optional(),
        needs: z.array(z.string()).optional(),
        status: z.enum(["todo", "in-progress", "in-review", "done", "blocked"]).optional(),
        stage: z.string().optional().describe("Move it to another workflow stage (id or name)"),
        kind: z.string().optional().describe("Kind of work (routing picks the model); empty clears it"),
      },
    },
    guard(({ taskId, ...patch }: { taskId: string; title?: string; description?: string; files?: string[]; doneWhen?: string; needs?: string[]; status?: "todo" | "in-progress" | "in-review" | "done" | "blocked"; stage?: string; kind?: string }) => {
      needs("plan");
      return ok(planner.updateTask(taskId, patch));
    }),
  );

  server.registerTool(
    "assign_task",
    {
      description: "Give a task to an agent whose role does tasks. HQ tells them to start it (right away if idle, otherwise when their current turn ends).",
      inputSchema: { taskId: z.string(), agent: z.string().describe("Agent id or name") },
    },
    guard(({ taskId, agent }: { taskId: string; agent: string }) => {
      needs("assign");
      const t = planner.assign(taskId, agent, me);
      return ok(`Assigned ${t.id} to ${hub.name(t.ownerId)}. They have been told to start.`);
    }),
  );

  server.registerTool(
    "get_my_task",
    { description: "Your current task: title, description, the files you may edit, done-when, and what it needs. Marks it in progress." },
    guard(() => {
      needs("work");
      const t = planner.currentTask(me);
      if (!t) return ok("You have no task right now. Wait for the lead, or ask with send_message.");
      if (t.status === "todo") planner.setStatus(me, "in-progress");
      const blockedBy = t.needs.filter((n) => planner.task(n)?.status !== "done");
      const stage = stageOf(hub.snap.config.workflow, t);
      // PR wording only for a pull-request stage; other stages end with complete_stage.
      const rules =
        stage.gate === "pull-request"
          ? "Work only on this task, on its own branch. Edit only the listed files. Title the PR `[" + t.id + "] " + t.title + "`. When the PR is open, call set_my_status with in-review and the PR number."
          : `Work only on this task. You are doing the ${stage.name} stage${stage.description ? ` (done when: ${stage.description})` : ""}. When your part is finished, call complete_stage with a note saying what you did and where the output is.`;
      return ok({ ...taskView(t.id), stage: stage.name, waitingOn: blockedBy, rules });
    }),
  );

  server.registerTool(
    "set_my_status",
    {
      description: "Update your current task: in-progress, blocked (say why), in-review (your output is ready to be checked; for code, the PR is open), or done. The lead is told automatically.",
      inputSchema: {
        status: z.enum(["in-progress", "blocked", "in-review", "done"]),
        note: z.string().optional().describe("Why you are blocked, or a short summary"),
        prNumber: z.number().int().optional(),
      },
    },
    guard(({ status, note, prNumber }: { status: "in-progress" | "blocked" | "in-review" | "done"; note?: string; prNumber?: number }) => {
      needs("work");
      const t = planner.setStatus(me, status, note, prNumber);
      return ok(`${t.id} is now ${t.status}.`);
    }),
  );

  server.registerTool(
    "complete_stage",
    {
      description:
        "Say your part of your current task's stage is finished. HQ moves it on: to the next stage, to a teammate to review, or to the CEO to approve, as the workflow says. Not for pull-request stages: there, open the PR and call set_my_status in-review.",
      inputSchema: { note: z.string().optional().describe("What you did and where the output is (file paths). The next person reads it.") },
    },
    guard(({ note }: { note?: string }) => {
      needs("work");
      const t = planner.completeStage(me, note);
      const where = t.status === "done" ? "It is done." : t.reviewerId ? `It waits for ${t.reviewerId === "ceo" ? "the CEO" : hub.name(t.reviewerId)} to check it.` : `It moved to ${t.stage} (${t.ownerId ? hub.name(t.ownerId) : "unassigned"}).`;
      return ok(`${t.id}: ${where}`);
    }),
  );

  server.registerTool(
    "approve_work",
    {
      description: "Pass work HQ asked you to review or sign off. It moves to the next stage, or is done if that was the last.",
      inputSchema: { taskId: z.string(), note: z.string().optional().describe("Anything the next person should know") },
    },
    guard(({ taskId, note }: { taskId: string; note?: string }) => {
      if (!can(hub.snap.config, hub.cfg(me), "review") && !can(hub.snap.config, hub.cfg(me), "approve")) needs("review");
      const t = planner.approveWork(me, taskId, note);
      return ok(`${t.id} approved. ${t.status === "done" ? "It is done." : `Now in ${t.stage}.`}`);
    }),
  );

  server.registerTool(
    "request_changes",
    {
      description: "Send work HQ asked you to review back to whoever did it, with what to fix. They fix it and send it back to you.",
      inputSchema: { taskId: z.string(), feedback: z.string().describe("Specific changes needed") },
    },
    guard(({ taskId, feedback }: { taskId: string; feedback: string }) => {
      if (!can(hub.snap.config, hub.cfg(me), "review") && !can(hub.snap.config, hub.cfg(me), "approve")) needs("review");
      const t = planner.requestChanges(me, taskId, feedback);
      return ok(`${t.id} sent back to ${t.ownerId ? hub.name(t.ownerId) : "the team (unassigned)"}.`);
    }),
  );

  server.registerTool(
    "share_files",
    {
      description: `Copy files or folders from your folder into the project's shared folder, so teammates (and the CEO) can use them. Do this for every output the next stage needs, then mention the paths in complete_stage's note. Up to 50 MB at a time.`,
      inputSchema: { paths: z.array(z.string()).describe("Paths relative to your folder, e.g. drafts/script.md or research/") },
    },
    guard(({ paths }: { paths: string[] }) => {
      const done = extras.shared.share(me, paths);
      return ok(`Shared ${done.length} file${done.length === 1 ? "" : "s"}: ${done.slice(0, 20).join(", ")}${done.length > 20 ? "…" : ""}. Teammates find them in ${SHARED_DIR}/ in their folders.`);
    }),
  );

  server.registerTool(
    "get_shared_files",
    {
      description: `Copy the project's shared files into ${SHARED_DIR}/ in your folder (all of them, or the paths you name). HQ also does this when work is handed to you.`,
      inputSchema: { paths: z.array(z.string()).optional().describe("Shared paths to get. Left out: everything.") },
    },
    guard(({ paths }: { paths?: string[] }) => {
      const got = extras.shared.deliver(me, paths);
      return ok(got.length ? `Copied ${got.length} file${got.length === 1 ? "" : "s"} into ${SHARED_DIR}/ in your folder.` : "Nothing is shared yet.");
    }),
  );

  server.registerTool(
    "list_shared_files",
    { description: "What is in the project's shared folder: each file's path, who shared it, when, and its size." },
    guard(() => ok(extras.shared.list().map((f) => ({ ...f, by: f.by ? hub.name(f.by) : "" })))),
  );

  server.registerTool(
    "read_memory",
    { description: "The project memory: the brief (goals, audience, constraints), decisions and lessons. Read it before starting new work." },
    guard(() => ok(extras.memory.read())),
  );

  server.registerTool(
    "add_to_memory",
    {
      description: "Add one line to the project memory, for everyone now and later: a decision (something agreed that others must follow) or a lesson (what worked or didn't).",
      inputSchema: { kind: z.enum(["decision", "lesson"]), text: z.string().describe("One or two sentences") },
    },
    guard(({ kind, text }: { kind: "decision" | "lesson"; text: string }) => ok(`Added: ${extras.memory.add(me, kind, text)}`)),
  );

  server.registerTool(
    "update_brief",
    {
      description: "Replace the project brief (goals, audience, constraints, what done looks like) with the text you give. Write it from what the CEO asked for. Every agent reads it at start.",
      inputSchema: { text: z.string().describe("The whole brief, in Markdown") },
    },
    guard(({ text }: { text: string }) => {
      needs("plan");
      if (!text?.trim()) throw new Error("The brief can't be empty.");
      extras.memory.set({ brief: text.trim() + "\n" });
      hub.activity("config", me, `${hub.name(me)} updated the project brief`);
      return ok("Brief updated. Agents get it the next time they start; tell running ones with send_message if it matters now.");
    }),
  );

  server.registerTool(
    "report_to_ceo",
    {
      description:
        "Report to the CEO: what was done, where the outputs are, and any questions. It appears in their Briefings. Use it when a request from the CEO is finished, or when you need decisions. Replies come back to you as messages.",
      inputSchema: {
        summary: z.string().describe("What was done and what is still open, in plain words"),
        deliverables: z.array(z.string()).optional().describe("Where the outputs are, e.g. shared/scripts/scam-calls.md"),
        questions: z.array(z.string()).optional().describe("Decisions you need from the CEO"),
      },
    },
    guard(({ summary, deliverables, questions }: { summary: string; deliverables?: string[]; questions?: string[] }) => {
      needs("plan");
      extras.briefings.report(me, summary, deliverables, questions);
      return ok("Sent. It is in the CEO's Briefings; their reply comes to you as a message.");
    }),
  );

  server.registerTool(
    "read_role",
    {
      description: "A role's full instructions (what agents with it are told), so you can propose a change with propose_role_change.",
      inputSchema: { role: z.string().describe("A role id or title") },
    },
    guard(({ role }: { role: string }) => {
      needs("plan");
      const r = findRole(hub.snap.config, role);
      if (!r) throw new Error(`No role "${role}". Roles: ${hub.snap.config.roles.map((x) => x.id).join(", ")}`);
      return ok({ id: r.id, title: r.title, can: r.can, instructions: r.instructions, holders: hub.snap.config.team.filter((a) => a.roleId === r.id).map((a) => a.name) });
    }),
  );

  server.registerTool(
    "propose_role_change",
    {
      description:
        "Propose new instructions for a role (in a retrospective, or whenever you learn the instructions should change). Give the role, its complete new instructions (not a diff: read_role first) and why. The CEO accepts or rejects it in Action items; HQ tells you which. Agents get accepted instructions on their next start.",
      inputSchema: {
        role: z.string().describe("A role id or title"),
        instructions: z.string().describe("The role's complete new instructions, in Markdown"),
        reason: z.string().describe("What went wrong or could go better, and how this change helps"),
      },
    },
    guard(({ role, instructions, reason }: { role: string; instructions: string; reason: string }) => {
      needs("plan");
      const r = findRole(hub.snap.config, role);
      if (!r) throw new Error(`No role "${role}". Roles: ${hub.snap.config.roles.map((x) => x.id).join(", ")}`);
      if (!reason?.trim()) throw new Error("Say why (reason). The CEO sees it.");
      if (!instructions?.trim()) throw new Error("Give the complete new instructions.");
      if (instructions.length > 20_000) throw new Error("Keep instructions under 20,000 characters.");
      if (!planner.actions) throw new Error("HQ can't take proposals right now.");
      planner.actions.addRoleChange(me, r.id, instructions, reason);
      return ok(`Sent to the CEO: a change to the ${r.title} role. HQ tells you when they accept or reject it.`);
    }),
  );

  server.registerTool(
    "list_roles",
    { description: "Roles you can hire into: the team's roles (with who holds them) and ready-made roles from the role library. Hire into one with hire_agent and its title; no instructions needed." },
    guard(() => {
      const c = hub.snap.config;
      const onTeam = c.roles.map((r) => ({ title: r.title, id: r.id, can: r.can, holders: c.team.filter((a) => a.roleId === r.id).map((a) => a.name), instructions: r.instructions.split("\n")[0].slice(0, 160) }));
      const library = ROLE_LIBRARY.filter((card) => !c.roles.some((r) => r.id === card.id || r.title.toLowerCase() === card.title.toLowerCase())).map((card) => ({ title: card.title, summary: card.summary }));
      return ok({ onTeam, library, headcount: `${c.team.length} of ${c.limits.maxAgents}` });
    }),
  );

  server.registerTool(
    "hire_agent",
    {
      description:
        "Add an agent to the team without asking the CEO. Use it only when no role on the team covers the work, or extra work arrives that the team can't absorb. The CEO's headcount limit applies. For a role that doesn't exist yet, pass instructions; the new role can do tasks and nothing more.",
      inputSchema: {
        role: z.string().describe("An existing role (id or title), or the title of a new role, e.g. Researcher"),
        reason: z.string().describe("Why this hire is needed. The CEO sees it."),
        name: z.string().optional().describe("The agent's name. Left out, HQ picks one."),
        instructions: z.string().optional().describe("Only for a new role: what it does, how it should work, and what a finished result looks like."),
        temporary: z.boolean().optional().describe("True when the hire is for one piece of work; dismiss them when it is done."),
        cli: z.enum(["claude", "codex"]).optional().describe("Which agent runs them. Left out: the role's default, else yours."),
        model: z.string().optional().describe("Start model. Left out: the role's default."),
      },
    },
    guard((args: { role: string; reason: string; name?: string; instructions?: string; temporary?: boolean; cli?: "claude" | "codex"; model?: string }) => {
      needs("hire");
      return ok(team.hire(me, args));
    }),
  );

  server.registerTool(
    "dismiss_agent",
    {
      description: "Let go of an agent that you (or another agent) hired, when their work is done. Their unfinished tasks become unassigned and their folder is kept. Agents the CEO added can only be removed by the CEO.",
      inputSchema: { agent: z.string().describe("Agent id or name"), reason: z.string().describe("Why, in a few words") },
    },
    guard(async ({ agent, reason }: { agent: string; reason: string }) => {
      needs("hire");
      return ok(await team.dismiss(me, agent, reason));
    }),
  );

  server.registerTool(
    "ask_user",
    {
      description:
        "Ask the CEO (the user) directly, without going through the lead, to do something you can't do from your sandbox, or to approve or decide something: create an account, database or API key, change a setting in a dashboard (Vercel, Supabase…), or put a value in your env file. It goes to their Action items list. Give a short title and clear steps. Never include secret values; name the variable instead. HQ messages you when they've done it. For a variable you need, write: add NAME to <your name>'s App variables in HQ (Settings → Sandbox → App variables), then restart <your name>. For a site you need, use request_access instead.",
      inputSchema: {
        title: z.string().describe("What to do, in a few words"),
        details: z.string().describe("The exact steps: where to go, what to create, which variable name, where to put it, and whether you need a restart. No secret values."),
        waiting: z.boolean().optional().describe("True if you can't continue without it"),
      },
    },
    guard(({ title, details, waiting }: { title: string; details: string; waiting?: boolean }) => {
      if (!planner.actions) throw new Error("Action items aren't available.");
      if (!details.trim()) throw new Error("Add the steps in details, so the user knows exactly what to do.");
      const item = planner.actions.add(me, title, details, !!waiting);
      return ok(`Added to the user's Action items (${item.id}). ${waiting ? "Wait for HQ's message, or work on something else meanwhile." : "Keep working; HQ will message you when it's done."}`);
    }),
  );

  server.registerTool(
    "request_access",
    {
      description:
        "Your sandbox blocks most websites and APIs. When a request you need is blocked (docs or an API), ask the user to allow that domain. Pass the host (e.g. docs.example.com) and why you need it. The user answers in HQ; you'll get a message.",
      inputSchema: { domain: z.string(), reason: z.string() },
    },
    guard(({ domain, reason }: { domain: string; reason: string }) => ok(requestAccess(hub, me, domain, reason))),
  );

  server.registerTool(
    "send_message",
    {
      description: "Send a message to another agent (id, name, or \"lead\"), or post to a channel: \"#team\" reaches everyone, \"#<role id>\" (e.g. #writer) everyone with that role. HQ delivers it: right away if they are idle, otherwise when their current turn ends. Your team may limit who you can message; the error says who to ask instead.",
      inputSchema: { to: z.string(), text: z.string() },
    },
    guard(({ to, text }: { to: string; text: string }) => {
      if (to.trim().startsWith("#")) {
        const channel = planner.message(me, to, text);
        return ok(`Posted to ${channel}.`);
      }
      const toId = planner.agentId(to);
      if (toId === me) throw new Error("That's you.");
      planner.message(me, to, text);
      return ok(`Sent to ${hub.name(toId)}.`);
    }),
  );

  return base;
}

/** Handles one MCP HTTP request for an already-authenticated agent. */
export async function handleMcp(hub: Hub, planner: Planner, team: Team, extras: McpExtras, agentId: string, req: IncomingMessage, res: ServerResponse, body: unknown) {
  const server = buildServer(hub, planner, team, extras, agentId);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
