// Action items: things an agent needs the user to do outside its sandbox
// (create a database, put a key in an env file, change a dashboard setting).
// Agents add them with the Team MCP tool `ask_user`; the user closes them in HQ,
// and HQ tells the agent so it can continue. Kept on this Mac, never committed.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ActionItem } from "../src/data/types";
import type { Hub } from "./hub";
import { parseCliJson } from "./lib/json";
import { projectHome } from "./paths";
import type { Planner } from "./planner";

const KEEP_CLOSED = 100;

export class ActionItems {
  private file: string;
  private seq = 0;

  /** Set by main: carries out a hire or dismissal the CEO approved, or tells the agent it was declined. */
  onDecision: ((item: ActionItem, decision: "done" | "dismissed", note: string | null) => void | Promise<void>) | null = null;

  constructor(private hub: Hub, private planner: Planner) {
    this.file = join(projectHome(hub.slug), "action-items.json");
    const saved = existsSync(this.file) ? parseCliJson<ActionItem[]>(readFileSync(this.file, "utf8")) : null;
    hub.snap.actionItems = Array.isArray(saved) ? saved : [];
  }

  private get items(): ActionItem[] {
    return (this.hub.snap.actionItems ??= []);
  }

  private save() {
    const open = this.items.filter((i) => i.status === "open");
    const closed = this.items.filter((i) => i.status !== "open").slice(0, KEEP_CLOSED);
    this.hub.snap.actionItems = [...open, ...closed].sort((a, b) => b.at.localeCompare(a.at));
    // Write a temp file and rename it over, so a crash mid-save can't leave a half-written list.
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.hub.snap.actionItems, null, 2));
    renameSync(tmp, this.file);
  }

  add(fromId: string, title: string, details: string, waiting: boolean): ActionItem {
    const clean = title.trim().replace(/\s+/g, " ").slice(0, 160);
    if (!clean) throw new Error("Give the action item a short title.");
    const item: ActionItem = {
      id: `ai${Date.now().toString(36)}${++this.seq}`,
      kind: "request",
      fromId,
      taskId: this.planner.currentTask(fromId)?.id ?? null,
      title: clean,
      details: details.trim().slice(0, 4000),
      waiting,
      status: "open",
      note: null,
      at: new Date().toISOString(),
      closedAt: null,
    };
    this.items.unshift(item);
    this.save();
    this.hub.emit({ type: "action.updated", item: { ...item } });
    this.hub.activity("agent.needs-input", fromId, `${this.hub.name(fromId)} added an action item${waiting ? " (waiting)" : ""}: ${clean}`);
    return item;
  }

  /** A hire or dismissal waiting for the CEO (autonomy "ask"), a budget reached, or an agent stopped at a usage limit. */
  addDecision(kind: "hire" | "dismiss" | "budget" | "limit", fromId: string, title: string, details: string, payload: Record<string, unknown>): ActionItem {
    const item: ActionItem = {
      id: `ai${Date.now().toString(36)}${++this.seq}`,
      kind,
      payload,
      fromId,
      taskId: null,
      title: title.slice(0, 160),
      details: details.slice(0, 4000),
      waiting: false,
      status: "open",
      note: null,
      at: new Date().toISOString(),
      closedAt: null,
    };
    this.items.unshift(item);
    this.save();
    this.hub.emit({ type: "action.updated", item: { ...item } });
    if (kind === "hire" || kind === "dismiss") this.hub.activity("agent.needs-input", fromId, `${this.hub.name(fromId)} asks: ${item.title}`);
    return item;
  }

  /**
   * A change to a role's instructions, proposed by the lead in a retrospective (plan step 7.5).
   * The CEO accepts it (the role's instructions become the new text) or rejects it with a note.
   */
  addRoleChange(fromId: string, roleId: string, after: string, reason: string): ActionItem {
    const role = this.hub.snap.config.roles.find((r) => r.id === roleId);
    if (!role) throw new Error(`No role "${roleId}".`);
    const before = role.instructions;
    if (before.trim() === after.trim()) throw new Error("Those are the role's instructions already.");
    // One open proposal per role: a newer one replaces it.
    for (const old of this.items)
      if (old.kind === "role-change" && old.status === "open" && old.payload?.roleId === roleId) {
        old.status = "dismissed";
        old.note = "Replaced by a newer proposal.";
        old.closedAt = new Date().toISOString();
        this.hub.emit({ type: "action.updated", item: { ...old } });
      }
    const item: ActionItem = {
      id: `ai${Date.now().toString(36)}${++this.seq}`,
      kind: "role-change",
      payload: { roleId, before, after: after.trim(), reason: reason.trim() },
      fromId,
      taskId: null,
      title: `Change the ${role.title} role's instructions`,
      details: reason.trim().slice(0, 2000),
      waiting: false,
      status: "open",
      note: null,
      at: new Date().toISOString(),
      closedAt: null,
    };
    this.items.unshift(item);
    this.save();
    this.hub.emit({ type: "action.updated", item: { ...item } });
    this.hub.activity("agent.needs-input", fromId, `${this.hub.name(fromId)} proposes a change to the ${role.title} role (retrospective)`);
    this.hub.audit("retro", `Proposed a change to the ${role.title} role: ${reason.trim()}`, roleId, fromId);
    return item;
  }

  /** Work waiting for the CEO's sign-off at a stage gate. Closing it approves the work or sends it back. */
  addApproval(fromId: string, taskId: string, title: string, details: string): ActionItem {
    // One open approval per task.
    for (const old of this.items) if (old.kind === "approval" && old.taskId === taskId && old.status === "open") old.status = "dismissed";
    const item: ActionItem = {
      id: `ai${Date.now().toString(36)}${++this.seq}`,
      kind: "approval",
      fromId,
      taskId,
      title: title.slice(0, 160),
      details: details.slice(0, 4000),
      waiting: true,
      status: "open",
      note: null,
      at: new Date().toISOString(),
      closedAt: null,
    };
    this.items.unshift(item);
    this.save();
    this.hub.emit({ type: "action.updated", item: { ...item } });
    return item;
  }

  resolve(id: string, decision: "done" | "dismissed", note?: string) {
    const item = this.items.find((i) => i.id === id);
    if (!item || item.status !== "open") return;
    if (item.kind === "hire" || item.kind === "dismiss" || item.kind === "budget" || item.kind === "limit") {
      this.hub.audit(item.kind === "hire" || item.kind === "dismiss" ? "team" : "budget", `${decision === "done" ? "Approved" : "Declined"}: ${item.title}${note?.trim() ? ` (${note.trim()})` : ""}`, item.fromId, "you");
      item.status = decision;
      item.note = note?.trim().slice(0, 1000) || null;
      item.closedAt = new Date().toISOString();
      this.save();
      this.hub.emit({ type: "action.updated", item: { ...item } });
      void Promise.resolve(this.onDecision?.(item, decision, item.note)).catch((err) =>
        this.planner.notify(item.fromId, `The CEO approved "${item.title}", but it couldn't be done: ${err instanceof Error ? err.message : err}`),
      );
      return;
    }
    if (item.kind === "role-change") {
      const roleId = String(item.payload?.roleId ?? "");
      const role = this.hub.snap.config.roles.find((r) => r.id === roleId);
      const n = note?.trim() ? ` Note from the CEO: ${note.trim()}` : "";
      item.status = decision;
      item.note = note?.trim().slice(0, 1000) || null;
      item.closedAt = new Date().toISOString();
      if (decision === "done" && role) {
        role.instructions = String(item.payload?.after ?? role.instructions);
        this.hub.configChanged();
        this.hub.audit("retro", `Accepted the change to the ${role.title} role`, roleId, "you");
        this.planner.notify(item.fromId, `The CEO accepted your change to the ${role.title} role. Agents with it get the new instructions on their next start.${n}`);
      } else {
        this.hub.audit("retro", `Rejected the change to the ${role?.title ?? roleId} role${note?.trim() ? `: ${note.trim()}` : ""}`, roleId, "you");
        this.planner.notify(item.fromId, role ? `The CEO rejected your change to the ${role.title} role.${n}` : `Your change to the ${roleId} role wasn't applied: the role no longer exists.`);
      }
      this.save();
      this.hub.emit({ type: "action.updated", item: { ...item } });
      return;
    }
    if (item.kind === "approval" && item.taskId) {
      // Approve = "done"; send back = "dismissed", and the note says what to change.
      if (decision === "dismissed" && !note?.trim()) throw new Error("Say what needs to change.");
      if (decision === "done") this.planner.approveWork("you", item.taskId, note);
      else this.planner.requestChanges("you", item.taskId, note!);
      item.status = decision;
      item.note = note?.trim().slice(0, 1000) || null;
      item.closedAt = new Date().toISOString();
      this.save();
      this.hub.emit({ type: "action.updated", item: { ...item } });
      return;
    }
    this.hub.audit("approval", `${decision === "done" ? "Did" : "Dismissed"} the action item "${item.title}" from ${this.hub.name(item.fromId)}`, item.fromId, "you");
    item.status = decision;
    item.note = note?.trim().slice(0, 1000) || null;
    item.closedAt = new Date().toISOString();
    this.save();
    this.hub.emit({ type: "action.updated", item: { ...item } });
    const n = item.note ? ` Note from the user: ${item.note}` : "";
    if (decision === "done") this.planner.notify(item.fromId, `The user did your action item "${item.title}".${n} Continue with it.`);
    else this.planner.notify(item.fromId, `The user dismissed your action item "${item.title}".${n} Continue without it, or find another way.`);
  }
}
