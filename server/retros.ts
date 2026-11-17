// Retrospectives (plan step 7.5): when a board is done, the lead looks back on it and proposes
// changes to role instructions (propose_role_change). The CEO accepts or rejects each one in
// Action items. Settings → Workflow turns this off; "Ask for a retrospective" runs one any time.

import type { Board } from "../src/data/types";
import { leadOf } from "../src/data/roles";
import type { Hub } from "./hub";
import type { Planner } from "./planner";

export function retroPrompt(hub: Hub, board: Board): string {
  const tasks = hub.snap.tasks.filter((t) => t.boardId === board.id);
  const sentBack = tasks.filter((t) => /^Changes requested/.test(t.note ?? "")).map((t) => t.id);
  const lines = tasks.slice(0, 40).map((t) => `- ${t.id} ${t.title} (${t.ownerId ? hub.name(t.ownerId) : "unassigned"}, ${t.status})`);
  return [
    `[Retrospective] The board "${board.title}" is done. Look back on it before the next one:`,
    ...lines,
    ...(sentBack.length ? [`Sent back with changes at least once: ${sentBack.join(", ")}.`] : []),
    "What went well, and what went wrong (work sent back, blocked tasks, things done twice, lessons in the project memory)? For each role whose instructions should change, call read_role, then propose_role_change with the complete new instructions and why. The CEO accepts or rejects each one. Add lessons with add_to_memory. Finish with a short report_to_ceo: what you learned and what you proposed. If nothing should change, say that in the report.",
  ].join("\n");
}

export class Retros {
  private done = new Set<string>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private hub: Hub,
    private planner: Planner,
  ) {}

  start() {
    for (const b of this.hub.snap.boards) if (b.status === "done") this.done.add(b.id);
    this.unsubscribe = this.hub.subscribe((e) => {
      if (e.type !== "board.updated") return;
      if (e.board.status !== "done") return void this.done.delete(e.board.id);
      if (this.done.has(e.board.id)) return;
      this.done.add(e.board.id);
      if (this.hub.snap.config.workflow.retrospective === false) return;
      setImmediate(() => this.ask(e.board.id));
    });
  }

  stop() {
    this.unsubscribe?.();
  }

  /** Asks the lead for a retrospective on a board (the last one finished, when none is given). Returns why not, or null. */
  ask(boardId?: string): string | null {
    const lead = leadOf(this.hub.snap.config);
    if (!lead) return "The team has no lead.";
    const done = this.hub.snap.boards.filter((b) => b.status === "done");
    const board = boardId ? this.hub.snap.boards.find((b) => b.id === boardId) : done[done.length - 1];
    if (!board) return boardId ? `No board ${boardId}.` : "No board is done yet.";
    this.planner.notify(lead.id, retroPrompt(this.hub, board));
    this.hub.activity("config", lead.id, `Asked ${lead.name} for a retrospective on "${board.title}"`);
    this.hub.audit("retro", `Asked for a retrospective on "${board.title}"`, board.id);
    return null;
  }
}
