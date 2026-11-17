// Template sharing (plan step 7.3): a template as one file you can send, post or put in a
// gallery. A bundle is JSON: the template (as in template.yml, with every text inline) and the
// files that go with it (the template's own skills). HQ checks a bundle completely before it
// writes anything, shows what it would add, and switches its schedules off.

import { describeWhen } from "./schedules";
import { skillMd, toolkit } from "./toolkits";
import type { Template } from "./templates";

export const BUNDLE_FORMAT = "yacc-template";
export const BUNDLE_VERSION = 1;
export const BUNDLE_MAX_BYTES = 1_000_000;
export const BUNDLE_EXTENSION = ".yacc-template.json";
/** Where the public gallery's index is, unless YACC_GALLERY says otherwise. */
export const DEFAULT_GALLERY = "https://raw.githubusercontent.com/YaredBachaGari/YACC/main/templates/index.json";

export interface TemplateBundle {
  format: typeof BUNDLE_FORMAT;
  version: number;
  /** template.yml's content, with role instructions and the brief written out in full. */
  template: Record<string, unknown>;
  /** Text files that go with it: skills/<name>/SKILL.md and anything else in a skill's folder. */
  files: Record<string, string>;
}

/** A gallery's index.json: { templates: [{ id, name, description, url, tags }] }. URLs may be relative to the index. */
export interface GalleryEntry {
  id: string;
  name: string;
  description: string;
  url: string;
  tags?: string[];
}

/** What installing a template would add, for the preview before you install it. */
export interface TemplatePreview {
  name: string;
  description: string;
  item: string;
  deliverable: Template["deliverable"];
  stages: string[];
  roles: { title: string; can: string[]; tools: string[] }[];
  team: { name: string; role: string }[];
  toolkits: string[];
  skills: string[];
  schedules: string[];
  /** Things to know before installing: powers it gives, servers it expects, what's switched off. */
  notes: string[];
}

/** A file path a bundle may carry: inside skills/<name>/, plain segments, text files only. */
export const BUNDLE_FILE = /^skills\/[a-z0-9][a-z0-9-]{0,63}\/(?:[A-Za-z0-9][A-Za-z0-9._-]{0,80}\/){0,3}[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(md|txt|json|ya?ml|csv|html|css|js|ts|py|sh)$/;

export function previewTemplate(t: Template): TemplatePreview {
  const title = (id: string) => t.roles.find((r) => r.id === id)?.title ?? id;
  const notes: string[] = [];
  const hirers = t.roles.filter((r) => r.can.includes("hire")).map((r) => r.title);
  if (hirers.length) notes.push(`${hirers.join(", ")} can hire and dismiss agents, within your headcount limit${t.autonomy?.hire === "ask" ? " and with your approval" : ""}.`);
  const servers = [...new Set([...t.roles.flatMap((r) => r.tools ?? []), ...(t.toolkits ?? []).flatMap((c) => toolkit(c.id)?.mcp ?? [])])];
  if (servers.length) notes.push(`Uses MCP servers you add yourself (Settings → MCP): ${servers.join(", ")}.`);
  if (t.schedules?.length) notes.push(`Its ${t.schedules.length === 1 ? "schedule is" : `${t.schedules.length} schedules are`} switched off when installed; turn ${t.schedules.length === 1 ? "it" : "them"} on in Settings → Schedules.`);
  if (t.deliverable === "pull-request") notes.push("Finished work is pull requests: the repo needs a GitHub remote (without one it's files, reviewed by the lead).");
  if (t.skills?.length) notes.push(`Adds ${t.skills.length === 1 ? "a skill" : `${t.skills.length} skills`} to .yacc/skills/: instructions your agents follow. Read them first if you don't know where the template comes from.`);
  return {
    name: t.name,
    description: t.description,
    item: t.item,
    deliverable: t.deliverable,
    stages: t.stages.map((s) => s.name),
    roles: t.roles.map((r) => ({ title: r.title, can: r.can, tools: r.tools ?? [] })),
    team: t.team.map((a) => ({ name: a.name, role: title(a.role) })),
    toolkits: (t.toolkits ?? []).map((c) => `${toolkit(c.id)?.name ?? c.id}${c.roles?.length ? ` (${c.roles.map(title).join(", ")})` : ""}`),
    skills: (t.skills ?? []).map((s) => s.name),
    schedules: (t.schedules ?? []).map((s) => `${s.name}: ${describeWhen(s).toLowerCase()}`),
    notes,
  };
}

/** A template as a bundle. `files` adds files from a saved template's skill folders. */
export function templateToBundle(t: Template, files: Record<string, string> = {}): TemplateBundle {
  const roles: Record<string, unknown> = {};
  for (const r of t.roles) roles[r.id] = { title: r.title, can: r.can, instructions: r.instructions, ...(r.cli ? { cli: r.cli } : {}), ...(r.model ? { model: r.model } : {}), ...(r.tools?.length ? { tools: r.tools } : {}) };
  const all: Record<string, string> = { ...files };
  for (const s of t.skills ?? []) all[`skills/${s.name}/SKILL.md`] ??= skillMd(s.name, s.description, s.body);
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    template: {
      name: t.name,
      description: t.description,
      ...(t.officeName ? { officeName: t.officeName } : {}),
      ...(t.theme ? { theme: t.theme } : {}),
      item: t.item,
      deliverable: t.deliverable,
      stages: t.stages,
      roles,
      team: t.team,
      ...(t.autonomy ? { autonomy: t.autonomy } : {}),
      ...(t.maxAgents ? { maxAgents: t.maxAgents } : {}),
      ...(t.brief ? { brief: t.brief } : {}),
      ...(t.toolkits?.length ? { toolkits: t.toolkits } : {}),
      ...(t.skills?.length ? { skills: t.skills.map((s) => (s.roles?.length ? { name: s.name, roles: s.roles } : s.name)) } : {}),
      ...(t.schedules?.length ? { schedules: t.schedules } : {}),
    },
    files: all,
  };
}

/** A file name for a template's bundle: house-studio.yacc-template.json. */
export const bundleFileName = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "template"}${BUNDLE_EXTENSION}`;

/**
 * A bundle read without the server's checks (the demo has no files to write). Real HQ reads
 * bundles with the same checks as saved templates (server/templateShare.ts).
 */
export function bundleToTemplateLoose(raw: unknown, source: Template["source"] = "user"): Template {
  const b = (raw ?? {}) as Partial<TemplateBundle>;
  if (b.format !== BUNDLE_FORMAT || !b.template) throw new Error("This isn't a YACC template (its format isn't yacc-template).");
  const t = b.template as Record<string, unknown>;
  const name = typeof t.name === "string" && t.name.trim() ? t.name.trim() : "";
  if (!name) throw new Error("The template has no name.");
  const roles = Object.entries((t.roles ?? {}) as Record<string, { title?: string; can?: string[]; instructions?: string; tools?: string[] }>).map(([id, r]) => ({
    id, title: r.title ?? id, can: (r.can ?? []) as Template["roles"][number]["can"], instructions: r.instructions ?? "", ...(r.tools?.length ? { tools: r.tools } : {}),
  }));
  if (!roles.some((r) => r.id === "lead")) throw new Error('The template needs a "lead" role.');
  const files = (b.files ?? {}) as Record<string, string>;
  const skills = ((t.skills ?? []) as (string | { name: string; roles?: string[] })[]).map((x) => (typeof x === "string" ? { name: x } : x)).map((x) => ({ name: x.name, description: "", body: files[`skills/${x.name}/SKILL.md`] ?? "", ...(x.roles ? { roles: x.roles } : {}) }));
  return {
    id: `${source}:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    description: typeof t.description === "string" ? t.description : "",
    source,
    item: typeof t.item === "string" ? t.item : "Task",
    deliverable: t.deliverable === "pull-request" ? "pull-request" : "files",
    stages: (t.stages ?? []) as Template["stages"],
    roles,
    team: (t.team ?? []) as Template["team"],
    ...(Array.isArray(t.toolkits) ? { toolkits: t.toolkits as Template["toolkits"] } : {}),
    ...(skills.length ? { skills } : {}),
    ...(Array.isArray(t.schedules) ? { schedules: (t.schedules as NonNullable<Template["schedules"]>).map((s) => ({ ...s, enabled: false })) } : {}),
  };
}
