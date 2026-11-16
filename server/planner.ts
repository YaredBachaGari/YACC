// Boards, tasks, assignments and messages. Used by both the Team MCP tools
// (agents) and the browser commands (you), so both follow the same rules.

import { channelMembers, channelsOf, directBlock, isChannel, postBlock } from "../src/data/messaging";
import { ANY_ROLE, CEO_ID, type AgentConfig, type Board, type StageConfig, type Task, type TaskStatus } from "../src/data/types";
import { nextStageOf, stageOf } from "../src/data/workflow";
import type { Hub } from "./hub";
import type { ActionItems } from "./actionItems";
import type { Inbox } from "./inbox";
import { can, leadOf, roleOf } from "../src/data/roles";

export interface NewTask {
  boardId?: string;
  title: string;
  description?: string;
  files?: string[];
  doneWhen?: string;
  needs?: string[];
  /** Stage id to start in. Left out: the first stage. */
  stage?: string;
  /** Kind of work; routing rules pick the model for it. */
  kind?: string;
}

export type TaskPatch = Partial<Pick<Task, "title" | "description" | "files" | "doneWhen" | "needs" | "status" | "boardId" | "note" | "prNumber" | "stage" | "kind">>;

/** A kind of work: lowercase, short, or undefined when empty. */
export const cleanKind = (k: unknown): string | undefined => (typeof k === "string" && k.trim() ? k.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40) : undefined);

const now = () => new Date().toISOString();

export class Planner {
  /** Called just before a task is handed to an agent (routing may switch its model first). */
  onAssign: ((agentId: string, task: Task) => void) | null = null;
  private seq = 0;
  /** Set by main: the user's action items (Team MCP `ask_user`). */
  actions: ActionItems | null = null;
  /** Set by main: copies the shared folder into an agent's folder when work is handed to it. */
  shared: { deliverQuietly(agentId: string): void } | null = null;

  constructor(private hub: Hub, private inbox: Inbox) {}

  private get snap() {
    return this.hub.snap;
  }

  task(id: string): Task | undefined {
    return this.snap.tasks.find((t) => t.id.toLowerCase() === id.trim().toLowerCase());
  }

  /** An agent by id or (case-insensitive) name; "lead" means the lead. */
  agentId(ref: string): string | null {
    const r = ref.trim().toLowerCase();
    const team = this.snap.config.team;
    if (r === "lead") return leadOf(this.snap.config)?.id ?? null;
    return team.find((a) => a.id === r || a.name.toLowerCase() === r)?.id ?? null;
  }

  defaultBoard(): Board {
    const active = this.snap.boards.filter((b) => b.status === "active").sort((a, b) => a.order - b.order);
    if (active[0]) return active[0];
    return this.createBoard("Backlog", "active");
  }

  // ------------------------------------------------------------ boards

  createBoard(title: string, status: Board["status"] = "planned"): Board {
    const clean = title.trim().slice(0, 80) || "Board";
    const base = clean.split(/\s+/).map((w) => w[0]).join("").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) || "B";
    let id = base;
    for (let i = 2; this.snap.boards.some((b) => b.id === id); i++) id = `${base}${i}`;
    const board: Board = { id, title: clean, status, order: this.snap.boards.length };
    this.snap.boards.push(board);
    this.hub.emit({ type: "board.updated", board: { ...board } });
    this.hub.planChanged();
    return board;
  }

  snapshotTasks() {
    return this.snap.tasks;
  }

  updateBoard(id: string, patch: Partial<Pick<Board, "title" | "status">>) {
    const board = this.snap.boards.find((b) => b.id === id);
    if (!board) throw new Error(`No board ${id}`);
    if (patch.title?.trim()) board.title = patch.title.trim().slice(0, 80);
    if (patch.status) board.status = patch.status;
    this.hub.emit({ type: "board.updated", board: { ...board } });
    this.hub.planChanged();
    return board;
  }

  // ------------------------------------------------------------ tasks

  createTask(input: NewTask, byId: string): Task {
    const board = input.boardId ? this.snap.boards.find((b) => b.id === input.boardId) : this.defaultBoard();
    if (!board) throw new Error(`No board ${input.boardId}. Boards: ${this.snap.boards.map((b) => b.id).join(", ")}`);
    let n = this.snap.tasks.filter((t) => t.boardId === board.id).length + 1;
    let id = `${board.id}-T${String(n).padStart(2, "0")}`;
    while (this.task(id)) id = `${board.id}-T${String(++n).padStart(2, "0")}`;
    const task: Task = {
      id, boardId: board.id, title: input.title.trim().slice(0, 120), ownerId: null, status: "todo",
      needs: input.needs ?? [], prNumber: null, description: input.description ?? "", files: input.files ?? [], doneWhen: input.doneWhen ?? "", note: null,
      stage: this.stageFor(input.stage).id, reviewerId: null,
      ...(cleanKind(input.kind) ? { kind: cleanKind(input.kind) } : {}),
    };
    this.snap.tasks.push(task);
    this.hub.emit({ type: "task.updated", task: { ...task } });
    this.hub.activity("task.created", byId === "you" ? null : byId, `${this.hub.name(byId)} added ${task.id} ${task.title}`);
    this.hub.planChanged();
    return task;
  }

  updateTask(id: string, patch: TaskPatch): Task {
    const task = this.task(id);
    if (!task) throw new Error(`No task ${id}`);
    if (patch.stage !== undefined) patch = { ...patch, stage: this.stageFor(patch.stage).id };
    if (patch.kind !== undefined) {
      const kind = cleanKind(patch.kind);
      if (kind) task.kind = kind;
      else delete task.kind;
      const { kind: _, ...rest } = patch;
      patch = rest;
    }
    Object.assign(task, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    if (task.status !== "in-review") task.reviewerId = null;
    if (task.status === "done") {
      for (const a of this.snap.agents) if (a.currentTaskId === task.id) this.hub.setStatus(a.agentId, { currentTaskId: null });
    }
    this.hub.emit({ type: "task.updated", task: { ...task } });
    this.hub.planChanged();
    return task;
  }

  /** Gives a task to an agent and tells them to start. */
  assign(taskId: string, agentRef: string, byId: string): Task {
    const task = this.task(taskId);
    const agentId = this.agentId(agentRef);
    if (!task) throw new Error(`No task ${taskId}`);
    if (!agentId) throw new Error(`No agent "${agentRef}". Team: ${this.snap.config.team.map((a) => a.id).join(", ")}`);
    const agent = this.hub.cfg(agentId)!;
    if (!can(this.snap.config, agent, "work")) throw new Error(`${agent.name}'s role (${roleOf(this.snap.config, agent)?.title ?? agent.roleId}) doesn't take tasks. Pick an agent that list_workers shows as free.`);
    task.ownerId = agentId;
    if (task.status === "done") task.status = "todo";
    this.hub.emit({ type: "task.updated", task: { ...task } });
    this.hub.setStatus(agentId, { currentTaskId: task.id });
    this.hub.planChanged();
    this.hub.activity("task.assigned", byId === "you" ? null : byId, `${this.hub.name(byId)} assigned ${task.id} ${task.title} to ${agent.name}`);
    this.hub.audit("assign", `Assigned ${task.id} "${task.title}" to ${agent.name}`, task.id, byId);
    const by = byId === "you" ? "The user (your human)" : this.hub.name(byId);
    const text = `${by} assigned you ${task.id} (${task.title}). ${this.hub.repo.github ? "Pull main, start" : "Start"} ${task.id}. Call the hq get_my_task tool for the details.`;
    this.record(byId, agentId, `Start ${task.id}: ${task.title}`);
    this.shared?.deliverQuietly(agentId);
    this.onAssign?.(agentId, task);
    this.inbox.push(agentId, { fromId: byId, kind: "assign", text });
    return task;
  }

  setStatus(agentId: string, status: Extract<TaskStatus, "in-progress" | "blocked" | "in-review" | "done">, note?: string, prNumber?: number): Task {
    const task = this.currentTask(agentId);
    if (!task) throw new Error("You have no task. Ask the lead for one.");
    // Outside a pull-request stage, "ready for review" and "done" both mean: my part of this stage is finished.
    if ((status === "in-review" || status === "done") && stageOf(this.wf, task).gate !== "pull-request") return this.completeStage(agentId, note);
    // Starting work keeps the note it arrived with (the last stage's handoff, or a reviewer's changes); a blocked reason is cleared.
    const keepNote = status === "in-progress" && !note && task.status !== "blocked";
    task.status = status;
    if (!keepNote) task.note = note?.slice(0, 300) || null;
    if (prNumber) task.prNumber = prNumber;
    if (status === "done") this.hub.setStatus(agentId, { currentTaskId: null });
    else this.hub.setStatus(agentId, { currentTaskId: task.id });
    this.hub.emit({ type: "task.updated", task: { ...task } });
    this.hub.planChanged();
    const name = this.hub.name(agentId);
    const words = { "in-progress": "started", blocked: "is blocked on", "in-review": "sent for review", done: "finished" }[status];
    this.hub.activity(status === "blocked" ? "agent.needs-input" : "task.started", agentId, `${name} ${words} ${task.id}${note ? `: ${note}` : ""}`);
    // Let the lead know when work is blocked or ready for review.
    const lead = leadOf(this.snap.config);
    if (lead && lead.id !== agentId && (status === "blocked" || status === "in-review" || status === "done"))
      this.message(agentId, lead.id, `${task.id} ${words}${note ? `: ${note}` : ""}${prNumber ? ` (PR #${prNumber})` : ""}`);
    return task;
  }

  currentTask(agentId: string): Task | undefined {
    const st = this.hub.status(agentId);
    const byCurrent = st?.currentTaskId ? this.task(st.currentTaskId) : undefined;
    if (byCurrent && byCurrent.ownerId === agentId) return byCurrent;
    // Work waiting for someone else's review is not the owner's to continue until it comes back.
    const mine = this.snap.tasks.filter((t) => t.ownerId === agentId && t.status !== "done" && !t.reviewerId);
    return mine.find((t) => t.status === "in-progress") ?? mine.find((t) => t.status === "todo") ?? mine[0];
  }

  // ------------------------------------------------------------ workflow: stages and gates

  private get wf() {
    return this.snap.config.workflow;
  }

  private stageFor(ref?: string): StageConfig {
    if (!ref?.trim()) return this.wf.stages[0];
    const r = ref.trim().toLowerCase();
    const stage = this.wf.stages.find((s) => s.id === r || s.name.toLowerCase() === r);
    if (!stage) throw new Error(`No stage "${ref}". Stages: ${this.wf.stages.map((s) => s.id).join(", ")}`);
    return stage;
  }

  /** Who should do a stage: someone with the stage's role, preferring whoever did the last one, then running and free agents. */
  private pickOwner(stage: StageConfig, previous: string | null): AgentConfig | null {
    const cfg = this.snap.config;
    const fits = cfg.team.filter((a) => can(cfg, a, "work") && (stage.owner === ANY_ROLE || a.roleId === stage.owner));
    if (!fits.length) return null;
    const rank = (a: AgentConfig) => {
      const running = this.hub.status(a.id)?.session.state === "running";
      const free = !this.currentTask(a.id);
      return (a.id === previous ? 8 : 0) + (running ? 4 : 0) + (free ? 2 : 0);
    };
    return [...fits].sort((x, y) => rank(y) - rank(x))[0];
  }

  /** Who checks a stage at a review or approval gate: never the person who did it. */
  private pickReviewer(stage: StageConfig, ownerId: string | null): AgentConfig | null {
    const cfg = this.snap.config;
    const permission = stage.gate === "approval" ? "approve" : "review";
    const fits = cfg.team.filter((a) => a.id !== ownerId && can(cfg, a, permission) && (!stage.reviewer || a.roleId === stage.reviewer));
    const running = fits.filter((a) => this.hub.status(a.id)?.session.state === "running");
    return running[0] ?? fits[0] ?? null;
  }

  private changed(task: Task) {
    this.hub.emit({ type: "task.updated", task: { ...task } });
    this.hub.planChanged();
  }

  /**
   * The owner says their part of the current stage is finished. Depending on the stage's gate the
   * work moves on, or waits for a reviewer, a sign-off or the CEO.
   */
  completeStage(agentId: string, note?: string): Task {
    const task = this.currentTask(agentId);
    if (!task) throw new Error("You have no task. Ask the lead for one.");
    const stage = stageOf(this.wf, task);
    const clean = note?.trim().slice(0, 600) || null;
    if (stage.gate === "pull-request")
      throw new Error(`${stage.name} ends with a pull request. Open it, then call set_my_status with in-review and the PR number.`);
    task.note = clean;
    const who = this.hub.name(agentId);
    if (stage.gate === "none") return this.advance(task, agentId, `${who} finished ${stage.name} on ${task.id}${clean ? `: ${clean}` : ""}`);

    // The owner is free for other work while this waits.
    this.hub.setStatus(agentId, { currentTaskId: null });
    task.status = "in-review";
    const reviewer = stage.gate === "ceo" ? null : this.pickReviewer(stage, agentId);
    if (stage.gate === "ceo" || !reviewer) {
      // No teammate can check it: it comes to you.
      task.reviewerId = CEO_ID;
      this.changed(task);
      const why = stage.gate === "ceo" ? "" : ` (nobody on the team can ${stage.gate === "review" ? "review" : "sign off"} it)`;
      this.actions?.addApproval(agentId, task.id, `Approve ${task.id}: ${task.title}`, [`${stage.name} is done${why}.`, clean ? `${who}: ${clean}` : "", task.doneWhen ? `Done when: ${task.doneWhen}` : ""].filter(Boolean).join("\n\n"));
      this.hub.activity("agent.needs-input", agentId, `${task.id} waits for your approval after ${stage.name}`);
      return task;
    }
    task.reviewerId = reviewer.id;
    this.changed(task);
    const verb = stage.gate === "review" ? "review" : "sign off";
    this.hub.activity("task.started", agentId, `${who} sent ${task.id} to ${reviewer.name} to ${verb} (${stage.name})`);
    this.shared?.deliverQuietly(reviewer.id);
    this.notify(
      reviewer.id,
      `Please ${verb} ${task.id} (${task.title}), stage ${stage.name}. ${who} says: ${clean ?? "(no note)"}${task.doneWhen ? ` Done when: ${task.doneWhen}.` : ""} Check it, then call approve_work, or request_changes with what to fix.`,
    );
    return task;
  }

  /** A reviewer (or the CEO, as "you") passes the work: it moves to the next stage. */
  approveWork(byId: string, taskId: string, note?: string): Task {
    const task = this.task(taskId);
    if (!task) throw new Error(`No task ${taskId}`);
    const me = byId === "you" ? CEO_ID : byId;
    if (task.status !== "in-review" || !task.reviewerId) throw new Error(`${task.id} isn't waiting for a review.`);
    if (task.reviewerId !== me) throw new Error(`${task.id} is waiting for ${task.reviewerId === CEO_ID ? "the CEO" : this.hub.name(task.reviewerId)}, not you.`);
    const stage = stageOf(this.wf, task);
    const by = me === CEO_ID ? this.snap.config.ceo.name : this.hub.name(byId);
    const clean = note?.trim().slice(0, 600);
    this.hub.audit(me === CEO_ID ? "approval" : "review", `Approved ${stage.name} on ${task.id} "${task.title}"${clean ? `: ${clean}` : ""}`, task.id, byId);
    if (task.ownerId) this.notify(task.ownerId, `${by} approved ${task.id} (${stage.name})${clean ? `: ${clean}` : "."}`);
    return this.advance(task, me === CEO_ID ? null : byId, `${by} approved ${stage.name} on ${task.id}${clean ? `: ${clean}` : ""}`);
  }

  /** A reviewer (or the CEO) sends the work back to whoever did the stage. */
  requestChanges(byId: string, taskId: string, feedback: string): Task {
    const task = this.task(taskId);
    if (!task) throw new Error(`No task ${taskId}`);
    const me = byId === "you" ? CEO_ID : byId;
    if (task.status !== "in-review" || !task.reviewerId) throw new Error(`${task.id} isn't waiting for a review.`);
    if (task.reviewerId !== me) throw new Error(`${task.id} is waiting for ${task.reviewerId === CEO_ID ? "the CEO" : this.hub.name(task.reviewerId)}, not you.`);
    const what = feedback?.trim().slice(0, 1500);
    if (!what) throw new Error("Say what needs to change.");
    const stage = stageOf(this.wf, task);
    const by = me === CEO_ID ? this.snap.config.ceo.name : this.hub.name(byId);
    this.hub.audit(me === CEO_ID ? "approval" : "review", `Sent ${task.id} "${task.title}" back (${stage.name}): ${what}`, task.id, byId);
    task.reviewerId = null;
    task.note = `Changes requested by ${by}: ${what}`.slice(0, 600);
    task.status = task.ownerId ? "in-progress" : "todo";
    this.changed(task);
    this.hub.activity("task.started", me === CEO_ID ? null : byId, `${by} sent ${task.id} back (${stage.name}): ${what.slice(0, 120)}`);
    if (task.ownerId) {
      if (!this.currentTask(task.ownerId)) this.hub.setStatus(task.ownerId, { currentTaskId: task.id });
      this.notify(task.ownerId, `${by} sent ${task.id} (${task.title}) back with changes for ${stage.name}: ${what} Fix it, then call complete_stage again.`);
    }
    return task;
  }

  /** Moves work to the next stage and hands it to someone who does that stage; or finishes it. */
  private advance(task: Task, byId: string | null, summary: string): Task {
    const from = stageOf(this.wf, task);
    const next = nextStageOf(this.wf, task);
    const previous = task.ownerId;
    const lead = leadOf(this.snap.config);
    task.reviewerId = null;
    if (previous && this.hub.status(previous)?.currentTaskId === task.id) this.hub.setStatus(previous, { currentTaskId: null });
    if (!next) {
      task.status = "done";
      this.changed(task);
      this.hub.activity("task.started", byId, `${summary}. ${task.id} is done.`);
      if (lead && lead.id !== byId) this.notify(lead.id, `${task.id} (${task.title}) is done: ${from.name} was the last stage.${task.note ? ` Last note: ${task.note}` : ""}`);
      return task;
    }
    task.stage = next.id;
    task.status = "todo";
    const owner = this.pickOwner(next, previous);
    task.ownerId = owner?.id ?? null;
    this.changed(task);
    if (!owner) {
      const role = this.snap.config.roles.find((r) => r.id === next.owner)?.title ?? next.owner;
      this.hub.activity("agent.needs-input", byId, `${summary}. ${task.id} moved to ${next.name}, but nobody on the team is a ${role}.`);
      if (lead) this.notify(lead.id, `${task.id} (${task.title}) moved to ${next.name}, but nobody on the team has the ${role} role. Assign it to someone, or hire a ${role}.`);
      return task;
    }
    this.hub.activity("task.assigned", byId, `${summary}. ${task.id} moved to ${next.name}: ${owner.name}`);
    if (!this.currentTask(owner.id) || this.currentTask(owner.id)?.id === task.id) this.hub.setStatus(owner.id, { currentTaskId: task.id });
    const busy = this.currentTask(owner.id)?.id !== task.id;
    this.shared?.deliverQuietly(owner.id);
    if (!busy) this.onAssign?.(owner.id, task);
    const handoff = task.note ? ` From the last stage: ${task.note}` : "";
    this.inbox.push(owner.id, {
      fromId: "hq",
      kind: "assign",
      text: `${task.id} (${task.title}) is yours for the ${next.name} stage.${next.description ? ` ${next.name} is done when: ${next.description}` : ""}${handoff} ${busy ? "Start it when your current task is done." : "Start now."} Call the hq get_my_task tool for the details.`,
    });
    return task;
  }

  // ------------------------------------------------------------ messages

  /** Records a message, shows it in the office, and delivers it. */
  /**
   * A message to an agent, or a post to a channel (#team, #<role>) that reaches everyone in it.
   * The team's messaging rules apply to agents; you and HQ are never limited. Returns the id it went to.
   */
  message(fromId: string, toRef: string, text: string) {
    const cfg = this.snap.config;
    const clean = text.trim().slice(0, 2000);
    if (isChannel(toRef.trim())) {
      const channel = toRef.trim().toLowerCase();
      const blocked = postBlock(cfg, fromId, channel);
      if (blocked) throw new Error(blocked);
      if (!clean) throw new Error("Empty message");
      const to = channelMembers(cfg, channel).filter((id) => id !== fromId);
      this.record(fromId, channel, clean);
      this.hub.activity("message", fromId === "you" || fromId === "hq" ? null : fromId, `${this.hub.name(fromId)} → ${channel} (${to.length}): ${clean.slice(0, 80)}`);
      for (const id of to) this.inbox.push(id, { fromId, kind: "message", text: `[${channel}] ${clean}` });
      return channel;
    }
    const toId = this.agentId(toRef);
    if (!toId) throw new Error(`No agent "${toRef}". Team: ${cfg.team.map((a) => a.id).join(", ")}. Channels: ${channelsOf(cfg).map((c) => c.id).join(", ")}`);
    if (!clean) throw new Error("Empty message");
    const blocked = directBlock(cfg, fromId, toId);
    if (blocked) throw new Error(blocked);
    this.record(fromId, toId, clean);
    this.hub.activity("message", fromId === "you" ? null : fromId, `${this.hub.name(fromId)} → ${this.hub.name(toId)}: ${clean.slice(0, 80)}`);
    this.inbox.push(toId, { fromId, kind: "message", text: clean });
    return toId;
  }

  /** A notice from HQ itself (review results, merges) to one agent. */
  notify(agentId: string, text: string) {
    if (!this.hub.cfg(agentId)) return;
    this.record("hq", agentId, text);
    this.inbox.push(agentId, { fromId: "hq", kind: "notice", text });
  }

  private record(fromId: string, toId: string, text: string) {
    this.seq += 1;
    const msg = { id: `m${Date.now().toString(36)}${this.seq}`, at: now(), fromId, toId, text };
    this.snap.messages = [msg, ...this.snap.messages].slice(0, 100);
    this.hub.emit({ type: "message", message: msg });
  }
}
