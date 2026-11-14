// Briefings: what the CEO reads. Reports from the lead (report_to_ceo) and notices from HQ about
// things the team did on its own (a hire, a dismissal). Kept on this machine, never committed.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Briefing } from "../src/data/types";
import type { Hub } from "./hub";
import { parseCliJson } from "./lib/json";
import { projectHome } from "./paths";
import type { Planner } from "./planner";

const KEEP = 200;

export class Briefings {
  private file: string;
  private seq = 0;

  constructor(private hub: Hub, private planner: Planner) {
    this.file = join(projectHome(hub.slug), "briefings.json");
    const saved = existsSync(this.file) ? parseCliJson<Briefing[]>(readFileSync(this.file, "utf8")) : null;
    hub.snap.briefings = Array.isArray(saved) ? saved : [];
  }

  private get items(): Briefing[] {
    return (this.hub.snap.briefings ??= []);
  }

  private save() {
    this.hub.snap.briefings = this.items.slice(0, KEEP);
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.hub.snap.briefings, null, 2));
    renameSync(tmp, this.file);
  }

  private push(b: Omit<Briefing, "id" | "at" | "read" | "reply">): Briefing {
    const item: Briefing = { ...b, id: `br${Date.now().toString(36)}${++this.seq}`, at: new Date().toISOString(), read: false, reply: null };
    this.items.unshift(item);
    this.save();
    this.hub.emit({ type: "briefing.updated", briefing: { ...item } });
    return item;
  }

  /** report_to_ceo */
  report(fromId: string, summary: string, deliverables: string[] = [], questions: string[] = []): Briefing {
    const clean = summary?.trim().slice(0, 6000);
    if (!clean) throw new Error("Write the summary: what was done, and what is still open.");
    const item = this.push({
      fromId,
      kind: "report",
      summary: clean,
      deliverables: (deliverables ?? []).map((d) => String(d).trim().slice(0, 300)).filter(Boolean).slice(0, 30),
      questions: (questions ?? []).map((q) => String(q).trim().slice(0, 500)).filter(Boolean).slice(0, 10),
    });
    this.hub.activity("agent.needs-input", fromId, `${this.hub.name(fromId)} sent you a briefing${item.questions.length ? ` with ${item.questions.length} question${item.questions.length > 1 ? "s" : ""}` : ""}`);
    return item;
  }

  /** Something the team did on its own that the CEO asked to hear about. */
  notice(fromId: string, summary: string): Briefing {
    return this.push({ fromId, kind: "notice", summary: summary.slice(0, 2000), deliverables: [], questions: [] });
  }

  reply(id: string, text: string) {
    const item = this.items.find((b) => b.id === id);
    const clean = text?.trim().slice(0, 2000);
    if (!item || !clean) return;
    item.reply = clean;
    item.read = true;
    this.save();
    this.hub.emit({ type: "briefing.updated", briefing: { ...item } });
    if (this.hub.cfg(item.fromId)) this.planner.message("you", item.fromId, `Reply to your briefing ("${item.summary.slice(0, 60)}${item.summary.length > 60 ? "…" : ""}"): ${clean}`);
  }

  markAllRead() {
    let changed = false;
    for (const b of this.items)
      if (!b.read) {
        b.read = true;
        changed = true;
        this.hub.emit({ type: "briefing.updated", briefing: { ...b } });
      }
    if (changed) this.save();
  }
}
