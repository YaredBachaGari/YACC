// The mock team's behaviour. No fixed script: every non-lead agent runs the same
// loop (get work → build → PR → review → merge → rest), offset in time, so it
// scales with the team. The lead assigns work and tops up the active board.

import type { Task } from "../types";
import * as T from "./terminalScripts";
import type { World } from "./world";

interface Job {
  taskId: string;
  phase: "build" | "fix";
  left: number; // sim seconds of work left (only counts down while `working`)
  inputAt: number | null; // ask a question when `left` drops below this
  nextChunk: number;
  prNumber: number | null;
}

const COMMENTS = [
  "Missing error handling for empty input",
  "Add a test for the 413 path",
  "Avoid the N+1 query in loadChunks()",
  "Validate the request body",
  "Handle the abort signal when streaming",
  "This type should come from the shared contract",
];

const CHATTER: [string, string][] = [
  ["I changed the shared contract, pull main before you push.", "Thanks, pulling now."],
  ["Are you touching src/lib/db.ts? I need one export there.", "No, it's yours."],
  ["Heads up: the test DB seed changed.", "Got it, re-seeding."],
  ["Can I reuse your error helper?", "Yes, it's in the contract."],
];

export class Simulation {
  private jobs = new Map<string, Job>();
  private seed = 1;

  constructor(private w: World) {}

  private r(a: number, b: number) {
    return a + this.w.rand() * (b - a);
  }

  private s() {
    this.seed += 7;
    return this.seed;
  }

  start() {
    const w = this.w;
    w.syncEnvironments();
    for (const a of w.snap.config.team) w.write(a.id, T.banner(a.name, a.role, w.snap.config.project.repo, a.mode));
    this.startLead(0.5);
    w.workers().forEach((a, i) => this.startWorker(a.id, 1.5 + i * 2.2));
  }

  startLead(delay: number) {
    const lead = this.w.lead();
    const board = this.w.activeBoards()[0];
    this.w.after(delay, () => {
      this.w.setStatus(lead.id, { state: "working", note: board ? `Planning ${board.title}` : "Planning" });
      this.leadLoop();
    }, lead.id);
    this.w.after(delay + 35, () => this.leadAsk(), lead.id);
  }

  startWorker(id: string, delay: number) {
    this.w.after(delay, () => this.needWork(id), id);
  }

  stopAgent(id: string) {
    this.w.cancel(id);
    this.jobs.delete(id);
  }

  // ------------------------------------------------------------ per-tick work

  tick(dt: number) {
    const w = this.w;
    for (const [id, job] of this.jobs) {
      const st = w.status(id);
      if (!st || st.state !== "working") continue;
      job.left -= dt;
      job.nextChunk -= dt;
      const task = w.task(job.taskId);
      if (job.nextChunk <= 0 && task) {
        job.nextChunk = this.r(2.5, 4);
        w.write(id, T.workChunk(task.title, this.s()));
        if (w.rand() < 0.12) this.chatter(id);
      }
      if (job.inputAt !== null && job.left <= job.inputAt) {
        job.inputAt = null;
        this.ask(id, w.preset.questions[Math.floor(w.rand() * w.preset.questions.length)] ?? "Which approach do you prefer?");
      } else if (job.left <= 0) {
        if (job.phase === "build") this.openPr(id, job);
        else this.pushFix(id, job);
      }
    }
  }

  // ------------------------------------------------------------ lead

  private leadLoop() {
    const w = this.w;
    const lead = w.lead();
    const board = w.activeBoards()[0];
    if (w.status(lead.id)?.state === "working") {
      w.write(lead.id, T.leadPlanning(board?.title ?? "the plan", this.s()));
      const notes = [board ? `Planning ${board.title}` : "Planning", "Checking merge order", "Reading open PRs", "Writing task files"];
      w.setStatus(lead.id, { note: notes[Math.floor(w.rand() * notes.length)] });
    }
    this.topUp();
    w.after(this.r(8, 14), () => this.leadLoop(), lead.id);
  }

  private leadAsk() {
    const w = this.w;
    const lead = w.lead();
    const qs = w.preset.leadQuestions;
    const open = w.snap.pullRequests.find((p) => !p.merged);
    const q = (qs[Math.floor(w.rand() * qs.length)] ?? "Approve the plan?").replace("{pr}", String(open?.number ?? w.nextPr));
    if (w.status(lead.id)?.state === "working") this.ask(lead.id, q);
    w.after(this.r(60, 80), () => this.leadAsk(), lead.id);
  }

  /** Keeps unassigned work on the active boards so a free agent always has something to pick. */
  private topUp() {
    const w = this.w;
    const boards = w.activeBoards();
    if (!boards.length) return;
    const unowned = w.snap.tasks.filter(
      (t) => t.status === "todo" && t.ownerId === null && boards.some((b) => b.id === t.boardId) && t.needs.every((n) => w.task(n)?.status === "done"),
    );
    if (unowned.length > 0) return;
    const board = boards.reduce((min, b) =>
      w.snap.tasks.filter((t) => t.boardId === b.id && t.status === "todo").length <
      w.snap.tasks.filter((t) => t.boardId === min.id && t.status === "todo").length ? b : min);
    const lead = w.lead();
    for (let i = 0; i < 2; i++) {
      const n = w.snap.tasks.filter((t) => t.boardId === board.id).length + 1;
      const pool = w.preset.taskPool;
      const title = pool[(n + i * 3) % pool.length] ?? `Task ${n}`;
      const task: Task = { id: `${board.id}-T${String(n).padStart(2, "0")}`, boardId: board.id, title, ownerId: null, status: "todo", needs: [], prNumber: null };
      w.putTask(task);
      w.write(lead.id, T.leadCreated(task.id, title));
      w.activity("task.created", lead.id, `${lead.name} added ${task.id} ${title} to ${board.title}`);
    }
  }

  private nextTaskFor(id: string): Task | undefined {
    const w = this.w;
    const boards = new Set(w.activeBoards().map((b) => b.id));
    const ready = (t: Task) =>
      t.status === "todo" && boards.has(t.boardId) && t.needs.every((n) => w.task(n)?.status === "done");
    return w.snap.tasks.find((t) => ready(t) && t.ownerId === id) ?? w.snap.tasks.find((t) => ready(t) && t.ownerId === null);
  }

  // ------------------------------------------------------------ workers

  private needWork(id: string) {
    const w = this.w;
    if (!w.cfg(id) || this.jobs.has(id)) return;
    const task = this.nextTaskFor(id);
    if (!task) {
      this.topUp();
      w.after(4, () => this.needWork(id), id);
      return;
    }
    const lead = w.lead();
    w.patchTask(task.id, { ownerId: id });
    w.write(lead.id, T.leadAssign(task.id, task.title, w.name(id)));
    w.activity("task.assigned", lead.id, `${lead.name} assigned ${task.id} ${task.title} to ${w.name(id)}`);
    w.message(lead.id, id, `Pull main, start ${task.id}.`);
    w.after(1.5, () => this.begin(id, task.id), id);
  }

  /** Starts a task right away (used by the lead's assignment and by the user's). */
  begin(id: string, taskId: string) {
    const w = this.w;
    const task = w.task(taskId);
    if (!task || !w.cfg(id)) return;
    w.cancel(id);
    w.patchTask(taskId, { ownerId: id, status: "in-progress" });
    w.setStatus(id, { state: "working", currentTaskId: taskId, note: null });
    w.activity("task.started", id, `${w.name(id)} started ${taskId} ${task.title}`);
    w.write(id, T.startTask(taskId, task.title, this.s()));
    const left = this.r(10, 18);
    this.jobs.set(id, { taskId, phase: "build", left, inputAt: w.rand() < 0.35 ? left * 0.55 : null, nextChunk: 2, prNumber: null });
  }

  ask(id: string, q: string) {
    const w = this.w;
    w.setStatus(id, { state: "needs-input", note: `Asking: ${q}` });
    w.activity("agent.needs-input", id, `${w.name(id)} needs you: ${q}`);
    w.write(id, T.question(q));
    w.after(this.r(7, 9), () => this.answer(id, "you"), id);
  }

  answer(id: string, by: string) {
    const w = this.w;
    if (w.status(id)?.state !== "needs-input") return;
    w.setStatus(id, { state: "working", note: w.cfg(id)?.isLead ? "Planning" : null });
    w.activity("agent.answered", id, `${by === "you" ? "You" : by} answered ${w.name(id)}`);
    w.write(id, T.answered(by === "you" ? "" : by));
  }

  private chatter(id: string) {
    const w = this.w;
    const others = w.workers().filter((a) => a.id !== id);
    if (!others.length) return;
    const to = others[Math.floor(w.rand() * others.length)];
    const [ask, reply] = CHATTER[Math.floor(w.rand() * CHATTER.length)];
    w.message(id, to.id, ask);
    w.after(this.r(2.5, 4), () => w.cfg(to.id) && w.cfg(id) && w.message(to.id, id, reply), to.id);
  }

  private openPr(id: string, job: Job) {
    const w = this.w;
    const task = w.task(job.taskId);
    if (!task) return void this.jobs.delete(id);
    const wf = w.snap.config.workflow;
    const num = w.nextPr++;
    job.prNumber = num;
    w.patchTask(task.id, { status: "in-review", prNumber: num });
    w.putPr({
      number: num, title: `[${task.id}] ${task.title}`, taskId: task.id, authorId: id,
      review: wf.review.enabled ? "pending" : "passed", openComments: 0, mergeable: !wf.review.enabled,
      merged: false, openedAt: new Date().toISOString(),
    });
    w.write(id, T.openPr(num, task.id, task.title, w.snap.config.project.repo, wf.review.enabled ? w.reviewerLabel() : null));
    w.activity("pr.opened", id, `${w.name(id)} opened PR #${num} ${task.title}`);
    if (wf.deploy.enabled && wf.deploy.perAgentEnvironments) w.deploy(id);
    if (wf.review.enabled) {
      w.setStatus(id, { state: "in-review", note: `Waiting for ${w.reviewerLabel()}` });
      w.after(4, () => this.review(id, num), id);
    } else {
      w.setStatus(id, { state: "review-passed", note: `Waiting for ${w.mergerLabel()} to merge` });
      w.after(3, () => this.merge(id, num), id);
    }
  }

  private review(id: string, num: number) {
    const w = this.w;
    w.patchPr(num, { review: "reviewing" });
    w.activity("review.started", null, `${w.reviewerLabel()} is reviewing #${num}`);
    w.after(this.r(6, 8), () => this.verdict(id, num), id);
  }

  private verdict(id: string, num: number) {
    const w = this.w;
    const job = this.jobs.get(id);
    const pr = w.pr(num);
    if (!pr || !job) return;
    const reviewer = w.reviewerLabel();
    if (job.phase === "build" && w.rand() < 0.4) {
      const n = 1 + Math.floor(w.rand() * 3);
      const comments = Array.from({ length: n }, (_, i) => COMMENTS[(num + i * 2) % COMMENTS.length]);
      w.patchPr(num, { review: "changes-requested", openComments: n, mergeable: false });
      w.activity("review.changes", id, `${reviewer} left ${n} comment${n > 1 ? "s" : ""} on #${num}`);
      w.write(id, T.changesRequested(num, comments, reviewer));
      Object.assign(job, { phase: "fix", left: this.r(6, 8), inputAt: null, nextChunk: 1.5 });
      w.setStatus(id, { state: "working", note: "Fixing review comments" });
      return;
    }
    w.patchPr(num, { review: "passed", openComments: 0, mergeable: true });
    w.activity("review.passed", id, `${reviewer} approved #${num}`);
    w.write(id, T.passed(num, reviewer, w.mergerLabel()));
    w.setStatus(id, { state: "review-passed", note: `Waiting for ${w.mergerLabel()} to merge` });
    w.after(4, () => this.merge(id, num), id);
  }

  private pushFix(id: string, job: Job) {
    const w = this.w;
    if (job.prNumber === null) return;
    const num = job.prNumber;
    job.left = Infinity; // parked until the next verdict
    w.write(id, T.pushedFix(num));
    w.setStatus(id, { state: "in-review", note: `Waiting for ${w.reviewerLabel()}` });
    w.after(2, () => this.review(id, num), id);
  }

  merge(id: string, num: number) {
    const w = this.w;
    const pr = w.pr(num);
    if (!pr || pr.merged) return;
    const wf = w.snap.config.workflow;
    const lead = w.lead();
    w.patchPr(num, { merged: true, mergeable: true });
    w.patchTask(pr.taskId, { status: "done" });
    this.pruneDone(w.task(pr.taskId)?.boardId);
    if (wf.merge.by === "lead") w.write(lead.id, [{ text: `\x1b[38;2;0;228;54m●\x1b[0m gh pr merge ${num} --squash` }]);
    w.activity("pr.merged", wf.merge.by === "lead" ? lead.id : null, `${wf.merge.by === "lead" ? lead.name : "You"} merged #${num}`);
    w.write(id, T.merged(num));
    if (wf.deploy.enabled) {
      w.deploy("main");
      const label = { instacloud: "InstaCloud", vercel: "Vercel", custom: "custom deploy" }[wf.deploy.tool];
      w.after(3, () => w.activity("deploy", null, `Deployed main to ${label}`));
    }
    this.jobs.delete(id);
    if (!w.cfg(id)) return;
    w.setStatus(id, { state: "idle", currentTaskId: null, note: "Coffee break" });
    w.after(this.r(3, 6), () => this.needWork(id), id);
  }

  /** Keeps long sessions bounded: at most 30 finished tasks per board. */
  private pruneDone(boardId: string | undefined) {
    const w = this.w;
    const done = w.snap.tasks.filter((t) => t.boardId === boardId && t.status === "done");
    for (const t of done.slice(0, Math.max(0, done.length - 30))) {
      w.snap.tasks = w.snap.tasks.filter((x) => x.id !== t.id);
      w.emit({ type: "task.removed", taskId: t.id });
    }
  }

  /** The workflow changed: let PRs stuck in review pass when review is turned off. */
  workflowChanged() {
    const w = this.w;
    if (w.snap.config.workflow.review.enabled) return;
    for (const pr of w.snap.pullRequests) {
      if (pr.merged || pr.review === "passed") continue;
      w.patchPr(pr.number, { review: "passed", openComments: 0, mergeable: true });
      const job = this.jobs.get(pr.authorId);
      if (job) job.left = Infinity;
      w.setStatus(pr.authorId, { state: "review-passed", note: `Waiting for ${w.mergerLabel()} to merge` });
      w.after(3, () => this.merge(pr.authorId, pr.number), pr.authorId);
    }
  }

  hasJob(id: string) {
    return this.jobs.has(id);
  }
}
