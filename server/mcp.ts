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
import { can, managerName, roleOf, toolsFor } from "../src/data/roles";
import type { Permission } from "../src/data/types";
import type { Team } from "./team";

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

function buildServer(hub: Hub, planner: Planner, team: Team, me: string): McpServer {
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
      description: "The team: each agent's id, name, role, who they report to, whether they are running, and what they are doing now. Pass role to see only one role.",
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
      },
    },
    guard((args: { title: string; boardId?: string; description?: string; files?: string[]; doneWhen?: string; needs?: string[] }) => {
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
      },
    },
    guard(({ taskId, ...patch }: { taskId: string; title?: string; description?: string; files?: string[]; doneWhen?: string; needs?: string[]; status?: "todo" | "in-progress" | "in-review" | "done" | "blocked" }) => {
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
      // PR wording only for projects on GitHub; other teams follow their role's instructions.
      const rules = hub.repo.github
        ? "Work only on this task, on its own branch. Edit only the listed files. Title the PR `[" + t.id + "] " + t.title + "`. When the PR is open, call set_my_status with in-review and the PR number."
        : "Work only on this task. When your output is ready to be checked, call set_my_status with in-review and a one-line note saying where it is.";
      return ok({ ...taskView(t.id), waitingOn: blockedBy, rules });
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
      description: "Send a message to another agent (id, name, or \"lead\"). HQ delivers it: right away if they are idle, otherwise when their current turn ends.",
      inputSchema: { to: z.string(), text: z.string() },
    },
    guard(({ to, text }: { to: string; text: string }) => {
      const toId = planner.agentId(to);
      if (toId === me) throw new Error("That's you.");
      planner.message(me, to, text);
      return ok(`Sent to ${hub.name(toId)}.`);
    }),
  );

  return base;
}

/** Handles one MCP HTTP request for an already-authenticated agent. */
export async function handleMcp(hub: Hub, planner: Planner, team: Team, agentId: string, req: IncomingMessage, res: ServerResponse, body: unknown) {
  const server = buildServer(hub, planner, team, agentId);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
