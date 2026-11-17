// The audit log on disk: ~/.yacc/<project>/audit/YYYY-MM.jsonl, one JSON entry per line,
// appended and never rewritten. Read back newest first for Settings → Audit log.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AUDIT_KINDS, AUDIT_SUMMARY_MAX, type AuditEntry, type AuditKind } from "../src/data/audit";
import { projectHome } from "./paths";

export interface AuditQuery {
  /** Only entries before this time (for the next page). */
  before?: string;
  limit?: number;
  kind?: AuditKind;
  actor?: string;
  /** Words to look for in the summary or target. */
  text?: string;
}

export class AuditLog {
  private dir: string;

  constructor(slug: string) {
    this.dir = join(projectHome(slug), "audit");
  }

  record(entry: Omit<AuditEntry, "at"> & { at?: string }) {
    const at = entry.at ?? new Date().toISOString();
    const clean: AuditEntry = {
      at,
      kind: entry.kind,
      actor: String(entry.actor).slice(0, 80),
      summary: String(entry.summary).replace(/\s+/g, " ").trim().slice(0, AUDIT_SUMMARY_MAX),
      ...(entry.target ? { target: String(entry.target).slice(0, 120) } : {}),
    };
    try {
      mkdirSync(this.dir, { recursive: true });
      appendFileSync(join(this.dir, `${at.slice(0, 7)}.jsonl`), JSON.stringify(clean) + "\n");
    } catch {
      // The log must never stop the work it records.
    }
    return clean;
  }

  /** Newest first. Lines that aren't valid entries are skipped. */
  read(q: AuditQuery = {}): { entries: AuditEntry[]; more: boolean } {
    const limit = Math.min(Math.max(q.limit ?? 100, 1), 1000);
    const files = existsSync(this.dir) ? readdirSync(this.dir).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f)).sort().reverse() : [];
    const words = q.text?.trim().toLowerCase();
    const out: AuditEntry[] = [];
    for (const f of files) {
      if (q.before && f.slice(0, 7) > q.before.slice(0, 7)) continue;
      const lines = readFileSync(join(this.dir, f), "utf8").split("\n").reverse();
      for (const line of lines) {
        if (!line.trim()) continue;
        let e: AuditEntry;
        try {
          e = JSON.parse(line) as AuditEntry;
        } catch {
          continue;
        }
        if (!e || typeof e.at !== "string" || !AUDIT_KINDS.some((k) => k.id === e.kind)) continue;
        if (q.before && e.at >= q.before) continue;
        if (q.kind && e.kind !== q.kind) continue;
        if (q.actor && e.actor !== q.actor) continue;
        if (words && !`${e.summary} ${e.target ?? ""}`.toLowerCase().includes(words)) continue;
        if (out.length === limit) return { entries: out, more: true };
        out.push(e);
      }
    }
    return { entries: out, more: false };
  }
}
