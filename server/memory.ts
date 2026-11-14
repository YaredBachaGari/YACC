// Project memory: what every agent should know, kept in the repo under .yacc/memory/ so it is
// shared with teammates and survives restarts. brief.md (goals, audience, constraints) is written by
// the CEO or the lead; decisions.md and lessons.md are dated lines any agent can add to.
// Every agent gets the brief and the latest lines in its role file at start, so a new hire
// starts with the context.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectMemory } from "../src/data/types";
import type { Hub } from "./hub";

const FILES = { brief: "brief.md", decisions: "decisions.md", lessons: "lessons.md" } as const;
export type MemoryPart = keyof typeof FILES;
const LIMIT = 40_000; // per file, so the role file stays a sensible size

const HEADERS: Record<MemoryPart, string> = {
  brief: "",
  decisions: "# Decisions\n\nOne line each, newest last. Agents add to this with add_to_memory.\n",
  lessons: "# Lessons\n\nWhat worked, what didn't. One line each, newest last.\n",
};

export class Memory {
  constructor(private hub: Hub) {
    this.hub.snap.memory = this.read();
  }

  private get dir() {
    return join(this.hub.repo.root, ".yacc", "memory");
  }

  read(): ProjectMemory {
    const get = (part: MemoryPart) => {
      const f = join(this.dir, FILES[part]);
      return existsSync(f) ? readFileSync(f, "utf8") : "";
    };
    return { brief: get("brief"), decisions: get("decisions"), lessons: get("lessons") };
  }

  private write(part: MemoryPart, text: string) {
    mkdirSync(this.dir, { recursive: true });
    const f = join(this.dir, FILES[part]);
    writeFileSync(`${f}.tmp`, text.slice(0, LIMIT));
    renameSync(`${f}.tmp`, f);
    this.hub.snap.memory = this.read();
    this.hub.emit({ type: "memory.updated", memory: { ...this.hub.snap.memory } });
  }

  /** The CEO's edits in Settings, or the lead's update_brief. */
  set(patch: Partial<ProjectMemory>) {
    for (const part of Object.keys(FILES) as MemoryPart[]) if (typeof patch[part] === "string") this.write(part, patch[part]!);
  }

  /** add_to_memory: one dated line, with who wrote it. */
  add(byId: string, kind: "decision" | "lesson", text: string): string {
    const clean = text?.trim().replace(/\s+/g, " ").slice(0, 500);
    if (!clean) throw new Error("Write the decision or lesson in one or two sentences.");
    const part: MemoryPart = kind === "decision" ? "decisions" : "lessons";
    const current = this.read()[part] || HEADERS[part];
    const line = `- ${new Date().toISOString().slice(0, 10)} ${this.hub.name(byId)}: ${clean}`;
    if (current.length + line.length > LIMIT) throw new Error(`${FILES[part]} is full. Ask the CEO to tidy it (Settings → Memory).`);
    this.write(part, `${current.replace(/\n*$/, "\n")}${line}\n`);
    return line;
  }

  /** What goes into every role file: the brief, and the most recent decisions and lessons. */
  forRoleFile(): string {
    const m = this.read();
    const recent = (text: string, n: number) => text.split("\n").filter((l) => l.startsWith("- ")).slice(-n).join("\n");
    const parts = [
      m.brief.trim() ? `### Brief\n${m.brief.trim().slice(0, 6000)}` : "",
      recent(m.decisions, 15) ? `### Recent decisions\n${recent(m.decisions, 15)}` : "",
      recent(m.lessons, 10) ? `### Recent lessons\n${recent(m.lessons, 10)}` : "",
    ].filter(Boolean);
    return parts.join("\n\n");
  }
}
