// Templates on disk: folders with template.yml and roles/<id>.md, saved in this project
// (.yacc/templates/<id>/, share by committing) or for you on this machine (~/.yacc/templates/<id>/).
// Built-in templates are in src/data/templates.ts. A template is applied once, when a team is created.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml, stringify as toYaml } from "yaml";
import { z } from "zod";
import { roleSlug } from "../src/data/roles";
import { BUILT_IN_TEMPLATES, type Template } from "../src/data/templates";
import { GATES, LEAD_ROLE_ID, PERMISSIONS, type HqConfig } from "../src/data/types";

const roleFileRef = (id: string) => `roles/${roleSlug(id)}.md`;

const schema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  officeName: z.string().optional(),
  item: z.string().default("Task"),
  deliverable: z.enum(["pull-request", "files"]).default("files"),
  stages: z.array(z.object({ id: z.string().optional(), name: z.string().min(1), owner: z.string().default("any"), gate: z.enum(GATES).default("none"), reviewer: z.string().optional() })).min(1),
  roles: z.record(z.string(), z.object({ title: z.string().min(1), can: z.array(z.enum(PERMISSIONS)).default([]), instructions: z.string().default(""), cli: z.enum(["claude", "codex"]).optional(), model: z.string().optional() })),
  team: z.array(z.object({ name: z.string().min(1), role: z.string().min(1) })).min(1),
  autonomy: z.object({ hire: z.enum(["auto", "notify", "ask"]), dismiss: z.enum(["auto", "notify", "ask"]) }).optional(),
  maxAgents: z.number().int().min(2).optional(),
  brief: z.string().optional(),
});

/** Reads one template folder. Throws with a message saying what is wrong. */
export function readTemplate(dir: string, source: Template["source"]): Template {
  const file = join(dir, "template.yml");
  const parsed = schema.safeParse(parseYaml(readFileSync(file, "utf8")));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`${file}: ${first.path.join(".") || "file"}: ${first.message}`);
  }
  const t = parsed.data;
  // Only roles/<id>.md and brief.md inside the folder are read; anything else is the text itself.
  const text = (value: string) => (/^(roles\/[a-z0-9-]+\.md|brief\.md)$/.test(value.trim()) && existsSync(join(dir, value.trim())) ? readFileSync(join(dir, value.trim()), "utf8").trim() : value);
  const roles = Object.entries(t.roles).map(([id, r]) => ({ id: roleSlug(id), title: r.title, can: r.can, instructions: text(r.instructions), ...(r.cli ? { cli: r.cli } : {}), ...(r.model ? { model: r.model } : {}) }));
  if (!roles.some((r) => r.id === LEAD_ROLE_ID)) throw new Error(`${file}: roles needs a "lead" role.`);
  if (t.team[0].role !== LEAD_ROLE_ID) throw new Error(`${file}: the first agent in team must have the lead role.`);
  for (const a of t.team) if (!roles.some((r) => r.id === roleSlug(a.role))) throw new Error(`${file}: ${a.name} has the role "${a.role}", which isn't under roles.`);
  const id = roleSlug(dir.split(/[\\/]/).pop() ?? t.name);
  return {
    id: `${source}:${id}`,
    name: t.name,
    description: t.description,
    source,
    ...(t.officeName ? { officeName: t.officeName } : {}),
    item: t.item,
    deliverable: t.deliverable,
    stages: t.stages.map((s) => ({ ...s, id: s.id ?? roleSlug(s.name) })),
    roles,
    team: t.team.map((a) => ({ name: a.name, role: roleSlug(a.role) })),
    ...(t.autonomy ? { autonomy: t.autonomy } : {}),
    ...(t.maxAgents ? { maxAgents: t.maxAgents } : {}),
    ...(t.brief ? { brief: text(t.brief) } : {}),
  };
}

const userDir = () => join(homedir(), ".yacc", "templates");
const projectDir = (repoRoot: string) => join(repoRoot, ".yacc", "templates");

/** Built-ins, then this project's, then yours. A folder that can't be read is skipped and reported. */
export function listTemplates(repoRoot: string): { templates: Template[]; problems: string[] } {
  const templates: Template[] = [...BUILT_IN_TEMPLATES];
  const problems: string[] = [];
  for (const [dir, source] of [
    [projectDir(repoRoot), "project"],
    [userDir(), "user"],
  ] as const) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (!existsSync(join(dir, name, "template.yml"))) continue;
      try {
        templates.push(readTemplate(join(dir, name), source));
      } catch (err) {
        problems.push(err instanceof Error ? err.message : String(err));
      }
    }
  }
  return { templates, problems };
}

/** Saves the current setup as a template folder. Returns the folder. */
export function saveTemplate(cfg: HqConfig, brief: string, name: string, where: "project" | "user", repoRoot: string, description = ""): string {
  const clean = name.trim().slice(0, 60);
  if (!clean) throw new Error("Give the template a name.");
  const dir = join(where === "project" ? projectDir(repoRoot) : userDir(), roleSlug(clean));
  mkdirSync(join(dir, "roles"), { recursive: true });
  const roles: Record<string, unknown> = {};
  for (const r of cfg.roles) {
    writeFileSync(join(dir, roleFileRef(r.id)), r.instructions.trim() + "\n");
    roles[r.id] = { title: r.title, can: r.can, instructions: roleFileRef(r.id), ...(r.cli ? { cli: r.cli } : {}), ...(r.model ? { model: r.model } : {}) };
  }
  // Agents hired for one piece of work don't belong in a starting team.
  const team = cfg.team.filter((a) => !a.temporary).sort((a, b) => Number(b.isLead) - Number(a.isLead));
  if (brief.trim()) writeFileSync(join(dir, "brief.md"), brief.trim() + "\n");
  const doc = {
    name: clean,
    description: description.trim().slice(0, 300) || `Saved from ${cfg.project.name}.`,
    ...(cfg.project.officeName ? { officeName: cfg.project.officeName } : {}),
    item: cfg.workflow.item,
    deliverable: cfg.workflow.deliverable,
    stages: cfg.workflow.stages,
    roles,
    team: team.map((a) => ({ name: a.name, role: a.roleId })),
    autonomy: cfg.autonomy,
    maxAgents: cfg.limits.maxAgents,
    ...(brief.trim() ? { brief: "brief.md" } : {}),
  };
  writeFileSync(join(dir, "template.yml"), `# A YACC team template. Edit by hand or save again from Settings → Project.\n${toYaml(doc, { lineWidth: 0 })}`);
  return dir;
}
