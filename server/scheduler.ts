// Runs schedules (plan step 6.5): clock schedules every half minute, event schedules when a
// task or board is done or a pull request is merged. Each run sends a message or adds a task.
// When each schedule last ran is kept in ~/.yacc/<project>/schedules.json, so a restart neither
// repeats a run nor forgets one: a time missed while HQ was off runs once when it's back.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isChannel } from "../src/data/messaging";
import { leadOf } from "../src/data/roles";
import { fill, isDue, nextRun, type Schedule, type ScheduleEvent, type ScheduleStatus } from "../src/data/schedules";
import type { OfficeEvent } from "../src/data/source";
import type { Hub } from "./hub";
import { projectHome } from "./paths";
import type { Planner } from "./planner";

interface Kept {
  /** When HQ first saw the schedule: times before this never fire. */
  seen: string;
  lastRun: string | null;
  lastResult: string | null;
}

const TICK_MS = 30_000;
const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export class Scheduler {
  private kept: Record<string, Kept> = {};
  private file: string;
  private timer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  // What was already done/merged, so an event fires once, on the change.
  private doneTasks = new Set<string>();
  private doneBoards = new Set<string>();
  private mergedPrs = new Set<number>();

  constructor(
    private hub: Hub,
    private planner: Planner,
    private now: () => Date = () => new Date(),
  ) {
    this.file = join(projectHome(hub.slug), "schedules.json");
    try {
      if (existsSync(this.file)) this.kept = JSON.parse(readFileSync(this.file, "utf8")) as Record<string, Kept>;
    } catch {
      this.kept = {};
    }
  }

  private get schedules(): Schedule[] {
    return this.hub.snap.config.schedules ?? [];
  }

  start() {
    if (this.timer) return;
    for (const t of this.hub.snap.tasks) if (t.status === "done") this.doneTasks.add(t.id);
    for (const b of this.hub.snap.boards) if (b.status === "done") this.doneBoards.add(b.id);
    for (const p of this.hub.snap.pullRequests) if (p.merged) this.mergedPrs.add(p.number);
    this.unsubscribe = this.hub.subscribe((e) => this.onEvent(e));
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.unsubscribe?.();
  }

  /** Schedules changed: new ones start counting from now; ones removed are forgotten. */
  sync() {
    const now = this.now().toISOString();
    const ids = new Set(this.schedules.map((s) => s.id));
    for (const s of this.schedules) this.kept[s.id] ??= { seen: now, lastRun: null, lastResult: null };
    for (const id of Object.keys(this.kept)) if (!ids.has(id)) delete this.kept[id];
    this.save();
    this.publish();
  }

  /** Runs every clock schedule that's due. */
  tick() {
    const now = this.now();
    let changed = false;
    for (const s of this.schedules) {
      if (!this.kept[s.id]) {
        this.kept[s.id] = { seen: now.toISOString(), lastRun: null, lastResult: null };
        changed = true;
        continue;
      }
      const k = this.kept[s.id];
      const since = new Date(Math.max(Date.parse(k.seen), k.lastRun ? Date.parse(k.lastRun) : 0));
      if (isDue(s, since, now)) {
        this.run(s, {}, false);
        changed = false; // run() saves and publishes
      }
    }
    if (changed) this.save();
    this.publish();
  }

  /** "Run now" from Settings. */
  runNow(id: string): string | null {
    const s = this.schedules.find((x) => x.id === id);
    return s ? this.run(s, {}, true) : null;
  }

  private onEvent(e: OfficeEvent) {
    if (e.type === "task.updated") {
      const done = e.task.status === "done";
      if (done && !this.doneTasks.has(e.task.id)) {
        this.doneTasks.add(e.task.id);
        const board = this.hub.snap.boards.find((b) => b.id === e.task.boardId);
        this.fire("task-done", { task: e.task.id, title: e.task.title, board: board?.title ?? e.task.boardId });
      } else if (!done) this.doneTasks.delete(e.task.id);
    } else if (e.type === "board.updated") {
      const done = e.board.status === "done";
      if (done && !this.doneBoards.has(e.board.id)) {
        this.doneBoards.add(e.board.id);
        this.fire("board-done", { board: e.board.title });
      } else if (!done) this.doneBoards.delete(e.board.id);
    } else if (e.type === "pr.updated" && e.pr.merged && !this.mergedPrs.has(e.pr.number)) {
      this.mergedPrs.add(e.pr.number);
      const task = this.hub.snap.tasks.find((t) => t.prNumber === e.pr.number);
      this.fire("pr-merged", { pr: `#${e.pr.number}`, task: task?.id ?? "", title: task?.title ?? e.pr.title });
    }
  }

  private fire(event: ScheduleEvent, vars: Record<string, string>) {
    // Later, so the change that caused it (a task marked done) finishes first.
    const due = this.schedules.filter((s) => s.enabled && s.on === event);
    if (due.length) setImmediate(() => due.forEach((s) => this.run(s, vars, false)));
  }

  /** Does what the schedule says. Returns what happened. */
  private run(s: Schedule, vars: Record<string, string>, manual: boolean): string {
    const now = this.now();
    const v = { date: localDate(now), ...vars };
    const tag = `[Schedule: ${s.name}]`;
    let result: string;
    try {
      result = s.action === "task" ? this.addTask(s, v, tag) : this.sendMessage(s, v, tag);
      this.hub.activity("config", null, `${manual ? "You ran" : "Schedule"} "${s.name}": ${result}`);
    } catch (err) {
      result = `Didn't run: ${err instanceof Error ? err.message : String(err)}`;
      this.hub.activity("config", null, `Schedule "${s.name}" ${result.charAt(0).toLowerCase()}${result.slice(1)}`);
    }
    this.kept[s.id] = { seen: this.kept[s.id]?.seen ?? now.toISOString(), lastRun: now.toISOString(), lastResult: result };
    this.save();
    this.publish();
    return result;
  }

  private sendMessage(s: Schedule, v: Record<string, string>, tag: string): string {
    const lead = leadOf(this.hub.snap.config);
    const to = !s.to || s.to === "lead" ? lead?.id : s.to;
    if (!to) throw new Error("the team has no lead");
    const text = `${tag} ${fill(s.text, v)}`;
    const sent = this.planner.message("hq", to, text);
    return isChannel(sent) ? `posted to ${sent}` : `message sent to ${this.hub.name(sent)}`;
  }

  private addTask(s: Schedule, v: Record<string, string>, tag: string): string {
    const cfg = this.hub.snap.config;
    const task = this.planner.createTask({ title: fill(s.title ?? s.name, v), description: `${fill(s.text, v)}\n\n${tag}`.trim() }, "hq");
    let who: string | null = null;
    if (s.to?.startsWith("role:")) {
      const roleId = s.to.slice(5);
      const rank = (id: string) => (this.hub.status(id)?.session.state === "running" ? 2 : 0) + (this.hub.status(id)?.currentTaskId ? 0 : 1);
      who = cfg.team.filter((a) => a.roleId === roleId).map((a) => a.id).sort((a, b) => rank(b) - rank(a))[0] ?? null;
      if (!who) {
        this.tellLead(`${tag} Added ${task.id} (${task.title}), for the ${cfg.roles.find((r) => r.id === roleId)?.title ?? roleId} role, but nobody has it. Assign it, or hire.`);
        return `added ${task.id}; nobody has that role, so the lead was told`;
      }
    } else if (s.to && s.to !== "lead") who = s.to;
    if (who) {
      this.planner.assign(task.id, who, "hq");
      return `added ${task.id} for ${this.hub.name(who)}`;
    }
    this.tellLead(`${tag} Added ${task.id} (${task.title}). Plan it and assign it.`);
    return `added ${task.id} for the lead to assign`;
  }

  private tellLead(text: string) {
    const lead = leadOf(this.hub.snap.config);
    if (lead) this.planner.notify(lead.id, text);
  }

  statuses(): ScheduleStatus[] {
    const now = this.now();
    return this.schedules.map((s) => ({
      id: s.id,
      lastRun: this.kept[s.id]?.lastRun ?? null,
      lastResult: this.kept[s.id]?.lastResult ?? null,
      nextRun: s.enabled && s.every ? (nextRun(s, now)?.toISOString() ?? null) : null,
    }));
  }

  private publish() {
    const next = this.statuses();
    if (JSON.stringify(next) === JSON.stringify(this.hub.snap.schedules ?? [])) return;
    this.hub.snap.schedules = next;
    this.hub.emit({ type: "schedules.updated", schedules: structuredClone(next) });
  }

  private save() {
    mkdirSync(projectHome(this.hub.slug), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.kept, null, 2));
  }
}
