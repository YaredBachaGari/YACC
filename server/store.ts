// Persistence in the repo, under .yacc/:
//   config.yml      settings: project, CEO, limits, roles, team, workflow (safe to commit, safe to edit by hand)
//   roles/<id>.md   each role's instructions
//   plan.json       boards + tasks (data, owned by HQ)
// The YAML files are the source of truth: the Settings screens write them, and edits made
// by hand are read back while HQ runs (see watchConfig).

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as toYaml } from "yaml";
import { z } from "zod";
import { CEO_ID, LEAD_ROLE_ID, PERMISSIONS, type AgentConfig, type Board, type HqConfig, type RoleConfig, type SandboxSettings, type Task } from "../src/data/types";
import { LEAD_NAME, WORKER_NAMES } from "../src/data/names";
import { DEFAULT_CEO_NAME, DEFAULT_MAX_AGENTS, DEVELOPER_INSTRUCTIONS, defaultRoles, freeRoleId, normalizeConfig, roleSlug } from "../src/data/roles";
import { slugify } from "./paths";
import type { RepoInfo } from "./repo";

export interface PlanFile {
  boards: Board[];
  tasks: Task[];
}

export const CONFIG_FILE = "config.yml";
const LEGACY_CONFIG_FILE = "config.json";
const ROLES_DIR = "roles";

const dir = (root: string) => join(root, ".yacc");

function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

/** Atomic write so a crash never leaves half a file. */
function writeText(file: string, text: string) {
  mkdirSync(join(file, ".."), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}
const writeJson = (file: string, value: unknown) => writeText(file, JSON.stringify(value, null, 2) + "\n");

export const defaultSandbox = (): SandboxSettings => ({
  resources: { cpus: null, memoryGb: null }, // sbx's own defaults
  allow: [],
  deny: [],
});

/** A new agent with a role. `role` and `isLead` are filled in by normalizeConfig. */
export function newAgent(id: string, name: string, roleId: string, color: string, reportsTo: string = CEO_ID): AgentConfig {
  return {
    id,
    name,
    roleId,
    reportsTo,
    role: roleId,
    isLead: roleId === LEAD_ROLE_ID,
    cli: "claude",
    model: "", // the CLI's default; users can pick with /model or "Start with model"
    mode: "sandbox",
    color,
    skills: [],
    roleMd: "",
    sandbox: defaultSandbox(),
    workspacePath: null,
    mcp: [],
  };
}

function defaultConfig(repo: RepoInfo, port: number): HqConfig {
  const lead = newAgent(slugify(LEAD_NAME), LEAD_NAME, LEAD_ROLE_ID, "#ff77a8");
  const cfg: HqConfig = {
    project: { id: slugify(repo.name), name: repo.name, repo: repo.github ?? repo.name, path: repo.root, hqPort: port },
    ceo: { name: DEFAULT_CEO_NAME },
    limits: { maxAgents: DEFAULT_MAX_AGENTS },
    roles: defaultRoles(),
    team: [lead, newAgent(slugify(WORKER_NAMES[0]), WORKER_NAMES[0], "developer", "#29adff", lead.id)],
    workflow: {
      review: { enabled: true, tool: repo.hasCodeRabbit ? "coderabbit" : "human", command: "" },
      merge: { by: "human" },
      deploy: { enabled: repo.hasInsta, tool: "instacloud", command: "", perAgentEnvironments: repo.hasInsta },
    },
  };
  normalizeConfig(cfg);
  return cfg;
}

// ---------------------------------------------------------------- YAML shape

const sandboxSchema = z
  .object({
    resources: z.object({ cpus: z.number().nullable().default(null), memoryGb: z.number().nullable().default(null) }).default({ cpus: null, memoryGb: null }),
    allow: z.array(z.string()).default([]),
    deny: z.array(z.string()).default([]),
  })
  .default({ resources: { cpus: null, memoryGb: null }, allow: [], deny: [] });

const agentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  /** An agent id or "ceo". Left out: the lead (and the lead always reports to the CEO). */
  reportsTo: z.string().optional(),
  cli: z.enum(["claude", "codex"]).default("claude"),
  model: z.string().default(""),
  mode: z.enum(["sandbox", "local"]).default("sandbox"),
  color: z.string().default("#29adff"),
  notes: z.string().default(""),
  skills: z.array(z.string()).default([]),
  mcp: z.array(z.string()).default([]),
  workspacePath: z.string().nullable().default(null),
  sandbox: sandboxSchema,
  hiredBy: z.string().optional(),
  temporary: z.boolean().optional(),
});

const roleSchema = z.object({
  title: z.string().min(1),
  can: z.array(z.enum(PERMISSIONS)).default([]),
  /** A file under .yacc/ (roles/<id>.md), or the text itself. */
  instructions: z.string().default(""),
  cli: z.enum(["claude", "codex"]).optional(),
  model: z.string().optional(),
});

const fileSchema = z.object({
  project: z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    repo: z.string().default(""),
    hqPort: z.number().int().default(7420),
    exportPlan: z.boolean().optional(),
    officeName: z.string().optional(),
  }),
  ceo: z.object({ name: z.string().default(DEFAULT_CEO_NAME) }).default({ name: DEFAULT_CEO_NAME }),
  limits: z.object({ maxAgents: z.number().int().min(2).default(DEFAULT_MAX_AGENTS) }).default({ maxAgents: DEFAULT_MAX_AGENTS }),
  roles: z.record(z.string(), roleSchema).default({}),
  team: z.array(agentSchema).min(1, "The team needs at least one agent (the lead)."),
  workflow: z.object({
    review: z.object({ enabled: z.boolean(), tool: z.enum(["coderabbit", "greptile", "copilot", "human", "custom"]), command: z.string().default("") }),
    merge: z.object({ by: z.enum(["human", "lead"]) }),
    deploy: z.object({ enabled: z.boolean(), tool: z.enum(["instacloud", "vercel", "custom"]), command: z.string().default(""), perAgentEnvironments: z.boolean().default(false) }),
  }),
  stack: z.unknown().optional(),
});

/** Thrown for a config.yml that can't be used; the message says what to fix. */
export class ConfigError extends Error {}

const roleFile = (id: string) => `${ROLES_DIR}/${roleSlug(id)}.md`;
/** `instructions: roles/x.md` names a file; anything else is the text itself. */
const isRoleFileRef = (value: string) => /^roles\/[a-z0-9-]+\.md$/.test(value.trim());

const HEADER = `# YACC settings for this project.
# You can edit this file by hand or use Settings in the app: both stay in sync.
# Each role's instructions are in roles/<role>.md next to this file.
# Never put secrets here.
`;

/** The config as YAML text, plus each role's instructions file (path relative to .yacc/ → text). */
export function serializeConfig(cfg: HqConfig): { yaml: string; files: Record<string, string> } {
  const files: Record<string, string> = {};
  const roles: Record<string, unknown> = {};
  for (const r of cfg.roles) {
    files[roleFile(r.id)] = r.instructions.trim() + "\n";
    roles[r.id] = { title: r.title, can: r.can, instructions: roleFile(r.id), ...(r.cli ? { cli: r.cli } : {}), ...(r.model ? { model: r.model } : {}) };
  }
  // The path is machine-specific; teammates get their own.
  const { path: _path, ...project } = cfg.project;
  const doc = {
    project,
    ceo: cfg.ceo,
    limits: cfg.limits,
    roles,
    team: cfg.team.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.roleId,
      reportsTo: a.reportsTo,
      cli: a.cli,
      model: a.model,
      mode: a.mode,
      color: a.color,
      ...(a.hiredBy ? { hiredBy: a.hiredBy } : {}),
      ...(a.temporary ? { temporary: true } : {}),
      notes: a.roleMd,
      skills: a.skills,
      mcp: a.mcp ?? [],
      workspacePath: a.workspacePath,
      sandbox: a.sandbox,
    })),
    workflow: cfg.workflow,
    ...(cfg.stack ? { stack: cfg.stack } : {}),
  };
  return { yaml: HEADER + toYaml(doc, { lineWidth: 0 }), files };
}

/**
 * Reads config.yml text into a config, checking it. `readFile` returns a file under .yacc/ (or null).
 * Throws ConfigError with a message a person can act on.
 */
export function parseConfig(text: string, readFile: (relPath: string) => string | null): { config: HqConfig; fixed: string[] } {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new ConfigError(`config.yml is not valid YAML: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
  }
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ConfigError(`config.yml: ${first.path.join(".") || "file"}: ${first.message}`);
  }
  const f = parsed.data;
  const ids = new Set<string>();
  for (const a of f.team) {
    const id = slugify(a.id);
    if (id !== a.id) throw new ConfigError(`config.yml: agent id "${a.id}" must be lowercase letters, digits and dashes (try "${id}").`);
    if (ids.has(id)) throw new ConfigError(`config.yml: two agents have the id "${id}".`);
    ids.add(id);
  }
  const roles: RoleConfig[] = Object.entries(f.roles).map(([id, r]) => {
    const text = isRoleFileRef(r.instructions) ? (readFile(r.instructions.trim()) ?? "") : r.instructions;
    return { id: roleSlug(id), title: r.title, can: r.can, instructions: text.trim(), ...(r.cli ? { cli: r.cli } : {}), ...(r.model ? { model: r.model } : {}) };
  });
  const config: HqConfig = {
    project: { id: slugify(f.project.id ?? f.project.name), name: f.project.name, repo: f.project.repo, path: "", hqPort: f.project.hqPort, ...(f.project.exportPlan !== undefined ? { exportPlan: f.project.exportPlan } : {}), ...(f.project.officeName ? { officeName: f.project.officeName } : {}) },
    ceo: f.ceo,
    limits: f.limits,
    roles,
    team: f.team.map((a) => ({
      id: a.id,
      name: a.name,
      roleId: roleSlug(a.role),
      reportsTo: a.reportsTo ?? "",
      role: a.role,
      isLead: false,
      cli: a.cli,
      model: a.model,
      mode: a.mode,
      color: a.color,
      skills: a.skills,
      roleMd: a.notes,
      sandbox: a.sandbox,
      workspacePath: a.workspacePath,
      mcp: a.mcp,
      ...(a.hiredBy ? { hiredBy: a.hiredBy } : {}),
      ...(a.temporary ? { temporary: true } : {}),
    })),
    workflow: f.workflow,
    ...(f.stack ? { stack: f.stack as HqConfig["stack"] } : {}),
  };
  // An agent whose role isn't defined is a typo worth stopping for, not something to guess at.
  for (const a of config.team)
    if (!config.roles.some((r) => r.id === a.roleId) && a.roleId !== LEAD_ROLE_ID)
      throw new ConfigError(`config.yml: ${a.name} has the role "${a.roleId}", which isn't under roles:. Roles: ${config.roles.map((r) => r.id).join(", ") || "none"}.`);
  const fixed = normalizeConfig(config);
  return { config, fixed };
}

// ---------------------------------------------------------------- migration from config.json (JSM HQ / YACC 0.1)

interface LegacyAgent extends Omit<AgentConfig, "roleId" | "reportsTo"> {
  roleId?: string;
  reportsTo?: string;
}

/** Turns the old lead/worker config into roles: the lead flag becomes the lead role, each job title a role. */
export function migrateLegacy(found: Omit<HqConfig, "roles" | "ceo" | "limits" | "team"> & { team: LegacyAgent[] }): HqConfig {
  const cfg = { ...found, ceo: { name: DEFAULT_CEO_NAME }, limits: { maxAgents: Math.max(DEFAULT_MAX_AGENTS, found.team.length) }, roles: defaultRoles() } as HqConfig;
  const lead = found.team.find((a) => a.isLead) ?? found.team[0];
  for (const a of found.team) {
    a.workspacePath ??= null;
    a.mcp ??= [];
    a.cli ??= "claude";
    a.sandbox ??= defaultSandbox();
    a.sandbox.resources ??= { cpus: null, memoryGb: null };
    // Phase D: policy level, proxy and secret names moved to sbx itself.
    const old = a.sandbox as unknown as Record<string, unknown>;
    delete old.policy;
    delete old.proxy;
    delete old.secrets;
    if (a === lead) a.roleId = LEAD_ROLE_ID;
    else {
      const title = (a.role ?? "").trim() || "Developer";
      // Every worker followed the same coding rules, whatever its title: keep that.
      let role = cfg.roles.find((r) => r.id !== LEAD_ROLE_ID && r.title.toLowerCase() === title.toLowerCase());
      if (!role) {
        role = { id: freeRoleId(cfg, title), title, can: ["work"], instructions: DEVELOPER_INSTRUCTIONS };
        cfg.roles.push(role);
      }
      a.roleId = role.id;
    }
    a.reportsTo = a === lead ? CEO_ID : (lead?.id ?? CEO_ID);
  }
  normalizeConfig(cfg);
  return cfg;
}

// ---------------------------------------------------------------- load / save

/** Text HQ last wrote, so the watcher can tell its own saves from edits made by hand. */
const lastWritten = new Map<string, string>();

function readRel(root: string) {
  return (rel: string): string | null => {
    const file = join(dir(root), rel);
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  };
}

/** `isNew`: no config yet — the welcome screen fills it in, then it's saved. */
export function loadConfig(repo: RepoInfo, port: number): { config: HqConfig; isNew: boolean; notes: string[] } {
  const file = join(dir(repo.root), CONFIG_FILE);
  if (existsSync(file)) {
    const { config, fixed } = parseConfig(readFileSync(file, "utf8"), readRel(repo.root));
    config.project.path = repo.root;
    return { config, isNew: false, notes: fixed };
  }
  const legacyFile = join(dir(repo.root), LEGACY_CONFIG_FILE);
  const legacy = readJson<Parameters<typeof migrateLegacy>[0]>(legacyFile);
  if (legacy) {
    // Configs from before project.id: their resources are named after the current name.
    legacy.project.id = slugify(legacy.project.id ?? legacy.project.name);
    const config = migrateLegacy(legacy);
    config.project.path = repo.root;
    saveConfig(repo.root, config);
    renameSync(legacyFile, `${legacyFile}.bak`);
    return { config, isNew: false, notes: [`Settings moved from ${LEGACY_CONFIG_FILE} to ${CONFIG_FILE} (the old file is kept as ${LEGACY_CONFIG_FILE}.bak).`] };
  }
  return { config: defaultConfig(repo, port), isNew: true, notes: [] };
}

export function saveConfig(root: string, cfg: HqConfig) {
  const { yaml, files } = serializeConfig(cfg);
  // Check what we are about to write: a file HQ can't read back must never reach disk.
  parseConfig(yaml, (rel) => files[rel] ?? null);
  for (const [rel, text] of Object.entries(files)) {
    const file = join(dir(root), rel);
    if (lastWritten.get(file) !== text || !existsSync(file)) writeText(file, text);
    lastWritten.set(file, text);
  }
  const file = join(dir(root), CONFIG_FILE);
  lastWritten.set(file, yaml);
  writeText(file, yaml);
}

/** Deletes a removed role's instructions file. */
export function removeRoleFile(root: string, roleId: string) {
  const file = join(dir(root), roleFile(roleId));
  lastWritten.delete(file);
  rmSync(file, { force: true });
}

/**
 * Watches config.yml and roles/*.md for edits made outside HQ. `onChange` gets the new config,
 * or the reason the edit can't be used (HQ then keeps running on the last good settings).
 */
export function watchConfig(root: string, onChange: (result: { config: HqConfig; fixed: string[] } | { error: string }) => void): () => void {
  const base = dir(root);
  let timer: NodeJS.Timeout | null = null;
  const check = () => {
    timer = null;
    const file = join(base, CONFIG_FILE);
    if (!existsSync(file)) return;
    const text = readFileSync(file, "utf8");
    let ours = lastWritten.get(file) === text;
    if (ours)
      for (const [f, t] of lastWritten) if (f !== file && existsSync(f) && readFileSync(f, "utf8") !== t) ours = false;
    if (ours) return;
    try {
      const result = parseConfig(text, readRel(root));
      result.config.project.path = root;
      // Remember the hand-edited text, so the same edit isn't reported twice.
      lastWritten.set(file, text);
      for (const r of result.config.roles) {
        const f = join(base, roleFile(r.id));
        if (existsSync(f)) lastWritten.set(f, readFileSync(f, "utf8"));
      }
      onChange(result);
    } catch (err) {
      lastWritten.set(file, text); // report a broken edit once, not on every poll
      onChange({ error: err instanceof Error ? err.message : String(err) });
    }
  };
  const poke = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(check, 250); // editors save in several steps
  };
  const watchers: FSWatcher[] = [];
  mkdirSync(join(base, ROLES_DIR), { recursive: true });
  for (const d of [base, join(base, ROLES_DIR)]) {
    try {
      watchers.push(watch(d, (_e, name) => (!name || name === CONFIG_FILE || String(name).endsWith(".md")) && poke()));
    } catch {
      // No watch support here: the interval below still catches edits.
    }
  }
  // fs.watch misses events on some filesystems (network drives, some containers).
  const interval = setInterval(check, 5000);
  interval.unref();
  return () => {
    for (const w of watchers) w.close();
    clearInterval(interval);
    if (timer) clearTimeout(timer);
  };
}

export function loadPlan(root: string): PlanFile {
  return readJson<PlanFile>(join(dir(root), "plan.json")) ?? { boards: [{ id: "B1", title: "Backlog", status: "active", order: 0 }], tasks: [] };
}

export function savePlan(root: string, plan: PlanFile) {
  writeJson(join(dir(root), "plan.json"), plan);
}
