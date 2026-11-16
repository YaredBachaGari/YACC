// Toolkits (plan steps 6.1 and 6.2): what each role works with, beyond the program it runs.
//
// A toolkit bundles agent skills (installed with the skills CLI) and MCP servers for one kind of
// work: office documents, web research, visual design… The project turns toolkits on in
// config.yml and says which roles get each one (left out: every role). Project skills are the
// team's own: folders in .yacc/skills/<name>/ with a SKILL.md, committed with the project, given
// to roles the same way. The coding stack (stack.ts) stays a toolkit kind of its own: frameworks
// and services, for every role.

import { stackSkills, type SkillSpec } from "./stack";
import type { AgentConfig, HqConfig } from "./types";

export type ToolkitGroup = "documents" | "research" | "design" | "building";

export const TOOLKIT_GROUPS: { id: ToolkitGroup; label: string }[] = [
  { id: "documents", label: "Documents and writing" },
  { id: "research", label: "Research" },
  { id: "design", label: "Design" },
  { id: "building", label: "Building and testing" },
];

export interface Toolkit {
  id: string;
  name: string;
  group: ToolkitGroup;
  /** One line for the settings card. */
  description: string;
  /** One line for the agents' role file: what it's for. */
  note: string;
  /** Agent skills to install. */
  skills: SkillSpec[];
  /** MCP servers (names in Docker Sandboxes' registry) agents with the toolkit get. */
  mcp: string[];
  /** Anything to know before turning it on (an API key, programs the skills call). */
  needs?: string;
}

const ANTHROPIC = "anthropics/skills";
const kit = (t: Toolkit) => t;

export const TOOLKIT_CATALOG: Toolkit[] = [
  kit({
    id: "documents",
    name: "Office documents",
    group: "documents",
    description: "Read and write Word, PDF, PowerPoint and Excel files.",
    note: "Office documents: use the docx, pdf, pptx and xlsx skills to read or produce those files.",
    skills: [{ source: ANTHROPIC, skills: ["docx", "pdf", "pptx", "xlsx"] }],
    mcp: [],
    needs: "Some steps run Python and LibreOffice; agents install what's missing or say what they need.",
  }),
  kit({
    id: "writing",
    name: "Writing together",
    group: "documents",
    description: "Draft documents with others step by step, and write internal updates.",
    note: "Writing: use the doc-coauthoring skill for long documents and internal-comms for updates and announcements.",
    skills: [{ source: ANTHROPIC, skills: ["doc-coauthoring", "internal-comms"] }],
    mcp: [],
  }),
  kit({
    id: "web-research",
    name: "Web research",
    group: "research",
    description: "Live web search with sources, through Perplexity.",
    note: "Web research: search the live web with the perplexity tools and keep every source link.",
    skills: [],
    mcp: ["perplexity"], // PERPLEXITY_MCP.name in models.ts (not imported: models.ts imports this file)
    needs: "A Perplexity API key (Settings → Models). In a sandbox, add the perplexity server in Settings → MCP.",
  }),
  kit({
    id: "visual-design",
    name: "Visual design",
    group: "design",
    description: "Posters, graphics and themed visuals as image and PDF files.",
    note: "Visual design: use canvas-design for posters and graphics, theme-factory to style a piece, algorithmic-art for generated art.",
    skills: [{ source: ANTHROPIC, skills: ["algorithmic-art", "canvas-design", "theme-factory"] }],
    mcp: [],
  }),
  kit({
    id: "frontend-design",
    name: "Frontend design",
    group: "design",
    description: "Distinctive web pages and interfaces, not template look-alikes.",
    note: "Frontend design: follow the frontend-design skill for any page or interface; web-artifacts-builder for multi-part HTML apps.",
    skills: [{ source: ANTHROPIC, skills: ["frontend-design", "web-artifacts-builder"] }],
    mcp: [],
  }),
  kit({
    id: "web-testing",
    name: "Web app testing",
    group: "building",
    description: "Drive a running web app with Playwright: click through, screenshot, check.",
    note: "Web app testing: use the webapp-testing skill to run the app and check it in a real browser.",
    skills: [{ source: ANTHROPIC, skills: ["webapp-testing"] }],
    mcp: [],
    needs: "Python and Playwright; agents install them in their folder when missing.",
  }),
  kit({
    id: "tool-making",
    name: "Making tools",
    group: "building",
    description: "Write new agent skills and MCP servers for the team.",
    note: "Making tools: use skill-creator to write a new skill and mcp-builder to build an MCP server.",
    skills: [{ source: ANTHROPIC, skills: ["mcp-builder", "skill-creator"] }],
    mcp: [],
  }),
];

export const toolkit = (id: string) => TOOLKIT_CATALOG.find((t) => t.id === id);

// ---------------------------------------------------------------- choices in config.yml

/** A toolkit the project uses. `roles` left out: every role. */
export interface ToolkitChoice {
  id: string;
  roles?: string[];
}

/** A project skill (.yacc/skills/<name>/SKILL.md) and the roles that get it (left out: every role). */
export interface ProjectSkillChoice {
  name: string;
  roles?: string[];
}

/** What HQ found in .yacc/skills/. */
export interface ProjectSkillInfo {
  name: string;
  description: string;
  /** Why it can't be used (no SKILL.md, no description…), or null. */
  problem: string | null;
}

/** Skill folder names: what Claude Code and Codex accept, and safe as a path. */
export const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const SKILL_DESCRIPTION_MAX = 1024;
export const SKILL_BODY_MAX = 40_000;

const forRole = (roles: string[] | undefined, roleId: string) => !roles?.length || roles.includes(roleId);

/**
 * Role ids that exist, deduplicated. None given: undefined (every role). Some given but none of
 * them exist any more: null, and the choice is dropped (it must not spread to every role).
 */
function cleanRoles(raw: unknown, roleIds: string[]): string[] | undefined | null {
  if (!Array.isArray(raw) || !raw.length) return undefined;
  const ids = [...new Set(raw.filter((r): r is string => typeof r === "string" && roleIds.includes(r)))];
  return ids.length ? ids : null;
}

/** Toolkits from YAML or the browser: known ids once each, roles that exist. A plain id string is every role. */
export function cleanToolkits(raw: unknown, roleIds: string[]): ToolkitChoice[] {
  if (!Array.isArray(raw)) return [];
  const out: ToolkitChoice[] = [];
  for (const item of raw.slice(0, 40)) {
    const v = typeof item === "string" ? { id: item } : (item as Partial<ToolkitChoice> | null);
    if (!v || typeof v.id !== "string" || !toolkit(v.id) || out.some((c) => c.id === v.id)) continue;
    const roles = cleanRoles(v.roles, roleIds);
    if (roles === null) continue;
    out.push({ id: v.id, ...(roles ? { roles } : {}) });
  }
  return out;
}

/** Project skills from YAML or the browser. A plain name string is every role. */
export function cleanProjectSkills(raw: unknown, roleIds: string[]): ProjectSkillChoice[] {
  if (!Array.isArray(raw)) return [];
  const out: ProjectSkillChoice[] = [];
  for (const item of raw.slice(0, 60)) {
    const v = typeof item === "string" ? { name: item } : (item as Partial<ProjectSkillChoice> | null);
    if (!v || typeof v.name !== "string" || !SKILL_NAME.test(v.name) || out.some((c) => c.name === v.name)) continue;
    const roles = cleanRoles(v.roles, roleIds);
    if (roles === null) continue;
    out.push({ name: v.name, ...(roles ? { roles } : {}) });
  }
  return out;
}

/** In YAML, a choice for every role is written as its bare id. */
export const toolkitsYaml = (list: ToolkitChoice[]) => list.map((c) => (c.roles?.length ? c : c.id));
export const projectSkillsYaml = (list: ProjectSkillChoice[]) => list.map((c) => (c.roles?.length ? c : c.name));

// ---------------------------------------------------------------- what one agent gets

type KitCfg = Pick<HqConfig, "toolkits" | "skills" | "stack">;

/** The toolkits an agent's role gets. */
export function toolkitsFor(agent: Pick<AgentConfig, "roleId">, cfg: Pick<HqConfig, "toolkits">): Toolkit[] {
  return (cfg.toolkits ?? []).filter((c) => forRole(c.roles, agent.roleId)).flatMap((c) => toolkit(c.id) ?? []);
}

/** The project skills an agent's role gets (names; the folders may be missing). */
export function projectSkillsFor(agent: Pick<AgentConfig, "roleId">, cfg: Pick<HqConfig, "skills">): string[] {
  return (cfg.skills ?? []).filter((c) => forRole(c.roles, agent.roleId)).map((c) => c.name);
}

/** Skills to install for an agent: the coding stack's (every role) and its toolkits', merged per source. */
export function skillSpecsFor(agent: Pick<AgentConfig, "roleId">, cfg: KitCfg): SkillSpec[] {
  const bySource = new Map<string, Set<string>>();
  for (const spec of [...stackSkills(cfg.stack), ...toolkitsFor(agent, cfg).flatMap((t) => t.skills)])
    for (const name of spec.skills) bySource.set(spec.source, (bySource.get(spec.source) ?? new Set()).add(name));
  return [...bySource].map(([source, names]) => ({ source, skills: [...names].sort() })).sort((a, b) => a.source.localeCompare(b.source));
}

/** MCP servers an agent gets from its toolkits. */
export const toolkitMcpFor = (agent: Pick<AgentConfig, "roleId">, cfg: Pick<HqConfig, "toolkits">) => [...new Set(toolkitsFor(agent, cfg).flatMap((t) => t.mcp))];

/** Every distinct set of skills the team installs (one cache each), for fetching ahead of Start. */
export function teamSkillSets(cfg: KitCfg & Pick<HqConfig, "team">): SkillSpec[][] {
  const seen = new Map<string, SkillSpec[]>();
  for (const a of cfg.team) {
    const specs = skillSpecsFor(a, cfg);
    if (specs.length) seen.set(JSON.stringify(specs), specs);
  }
  return [...seen.values()];
}

/** The "Your tools" section of an agent's role file (empty when it has none). */
export function toolkitsRoleMd(agent: Pick<AgentConfig, "roleId">, cfg: KitCfg, skills: ProjectSkillInfo[] = []): string {
  const kits = toolkitsFor(agent, cfg);
  const own = projectSkillsFor(agent, cfg).flatMap((name) => skills.find((s) => s.name === name && !s.problem) ?? []);
  if (!kits.length && !own.length) return "";
  const lines = ["## Your tools"];
  for (const t of kits) lines.push(`- ${t.note}`);
  for (const s of own) lines.push(`- ${s.name} (the team's own skill): ${s.description}`);
  lines.push("", "Skills are in your folder (.claude/skills/ or .agents/skills/); use one whenever the task fits it, and follow it over your own habits.");
  return lines.join("\n");
}

// ---------------------------------------------------------------- SKILL.md

/** Reads a SKILL.md: its name and description from the front matter, and the body. */
export function parseSkillMd(text: string): { name: string; description: string; body: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  // A one-line YAML scalar: plain, "double-quoted" (JSON escapes) or 'single-quoted' ('' is a quote).
  const field = (key: string) => {
    const line = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(m[1])?.[1]?.trim() ?? "";
    if (/^".*"$/.test(line)) {
      try {
        return String(JSON.parse(line));
      } catch {
        return line.slice(1, -1);
      }
    }
    if (/^'.*'$/.test(line)) return line.slice(1, -1).replace(/''/g, "'");
    return line;
  };
  return { name: field("name"), description: field("description"), body: m[2].replace(/^\s*\n/, "") };
}

/** Writes a SKILL.md for a project skill (the description on one line, quoted for YAML). */
export function skillMd(name: string, description: string, body: string): string {
  const desc = description.replace(/\s+/g, " ").trim().slice(0, SKILL_DESCRIPTION_MAX);
  return `---\nname: ${name}\ndescription: ${JSON.stringify(desc)}\n---\n\n${body.trim()}\n`;
}
