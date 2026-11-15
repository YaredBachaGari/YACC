import type { StackConfig } from "./stack";
import type { ProjectSkillChoice, ProjectSkillInfo, ToolkitChoice } from "./toolkits";
// Domain types shared by the data source, the store, the office and the HUD.

// ---------------------------------------------------------------- Config

/** sbx's machine-wide base network policy (`sbx policy init`). */
export type BasePolicy = "allow-all" | "balanced" | "deny-all" | "unknown";

/** Services sbx can inject keys for through its host proxy (the value never enters the VM). */
export const SERVICE_KEYS = ["anthropic", "openai", "github", "google", "groq", "mistral", "openrouter", "xai", "nebius", "copilot", "cursor", "devin", "droid"] as const;
export type ServiceKey = (typeof SERVICE_KEYS)[number];

/** VM size. null = let sbx decide (all host CPUs; 50% of RAM, 0.5–32 GB). Set at creation only. */
export interface SandboxResources {
  cpus: number | null;
  memoryGb: number | null;
}

/** Per-agent sandbox settings HQ applies through sbx. Machine-wide ones live in SbxState. */
export interface SandboxSettings {
  resources: SandboxResources;
  allow: string[]; // extra allowed domains for this sandbox, e.g. "registry.npmjs.org"
  deny: string[]; // blocked domains for this sandbox (deny wins over allow)
}

export type AgentMode = "sandbox" | "local";

/**
 * Which model runs the agent, and so which agent program (runtime) it runs in.
 * Saved as `cli:` in config.yml. DeepSeek runs in Claude Code, pointed at DeepSeek's API.
 * The catalog of each one (provider, models, sign-in) is in src/data/models.ts.
 */
export type AgentCli = "claude" | "codex" | "gemini" | "deepseek";
export const AGENT_CLIS = ["claude", "codex", "gemini", "deepseek"] as const satisfies readonly AgentCli[];

export const CLI_LABEL: Record<AgentCli, string> = { claude: "Claude Code", codex: "Codex", gemini: "Gemini CLI", deepseek: "DeepSeek (in Claude Code)" };

/** Who provides the model. Perplexity is a research tool, not a model an agent runs on. */
export type ProviderId = "anthropic" | "openai" | "google" | "deepseek" | "perplexity";
export const PROVIDER_IDS = ["anthropic", "openai", "google", "deepseek", "perplexity"] as const satisfies readonly ProviderId[];

/**
 * How YACC signs in to a provider. subscription: you sign in with your own account (Claude, ChatGPT,
 * Google) in the provider's own program. api-key: a key kept in Docker Sandboxes' secret store (or, in
 * Local mode, in the environment YACC starts from). Keys are never saved in config.yml.
 */
export type AuthMode = "subscription" | "api-key";
export const AUTH_LABEL: Record<AuthMode, string> = { subscription: "Your subscription (sign in)", "api-key": "API key" };

/** Sign-in choice per provider (config.yml `providers:`). Providers left out use their default. */
export type ProvidersConfig = Partial<Record<ProviderId, { auth: AuthMode }>>;

export type BudgetPeriod = "day" | "week" | "month";
export const BUDGET_PERIODS = ["day", "week", "month"] as const satisfies readonly BudgetPeriod[];
/** A spending limit in US dollars (estimated from tokens; API prices even on a subscription). */
export interface Budget {
  usd: number;
  period: BudgetPeriod;
}

/** A model choice in routing: which model (cli) and, optionally, which model name. */
export interface ModelPick {
  cli: AgentCli;
  model?: string;
}
/** Tasks of this kind go to this model. */
export interface RoutingRule extends ModelPick {
  kind: string;
}
/** config.yml `routing:`. */
export interface RoutingConfig {
  rules?: RoutingRule[];
  /** Models to switch to, in order, when an agent's model hits a usage limit. */
  fallback?: ModelPick[];
}

/** API prices per million tokens, US dollars. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** Tokens and estimated cost. */
export interface UsageLine {
  input: number; // not counting cached input
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  /** Some of the cost is YACC's estimate from API prices (the rest the program reported). */
  estimated: boolean;
}
export interface AgentUsageView {
  day: UsageLine;
  week: UsageLine;
  month: UsageLine;
  models: string[]; // seen this month
  lastAt: string | null;
}
/** Usage per agent and for the project, this day, week and month (local time). */
export interface UsageView {
  agents: Record<string, AgentUsageView>;
  project: { day: UsageLine; week: UsageLine; month: UsageLine };
}

/** What a role may do. The Team MCP offers each agent only the tools its role allows. */
export const PERMISSIONS = ["plan", "assign", "work", "review", "approve", "hire"] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABEL: Record<Permission, string> = {
  plan: "Plan: create boards and tasks",
  assign: "Assign: give tasks to agents",
  work: "Work: take tasks and report status",
  review: "Review: check other agents' work",
  approve: "Approve: sign off finished work",
  hire: "Hire: add and dismiss agents",
};

/** The role every team has: the one agent that takes the CEO's instructions. */
export const LEAD_ROLE_ID = "lead";
/** `reportsTo` value for agents that report to the human. */
export const CEO_ID = "ceo";

/** A job on the team. Saved in .yacc/config.yml; its instructions in .yacc/roles/<id>.md. */
export interface RoleConfig {
  id: string; // "lead", "developer", "researcher"
  title: string; // "Lead"
  can: Permission[];
  /** Markdown rules every agent with this role is given at session start. */
  instructions: string;
  /** Defaults for new agents with this role ("" / undefined = no preference). */
  cli?: AgentCli;
  model?: string;
  /** MCP servers (names in Docker Sandboxes' registry, e.g. "perplexity") every agent with this role gets. */
  tools?: string[];
}

/** The human. Always the head of the org chart. */
export interface CeoConfig {
  name: string; // shown in the org chart and to agents
  /** Your picture or look in the office. */
  avatar?: AvatarConfig;
}

/**
 * How much the team may do on its own, per kind of action.
 * auto: just do it. notify: do it, and tell the CEO in Briefings. ask: wait for the CEO's approval in Action items.
 */
export type AutonomyMode = "auto" | "notify" | "ask";
export const AUTONOMY_LABEL: Record<AutonomyMode, string> = { auto: "Do it", notify: "Do it and tell me", ask: "Ask me first" };
export interface AutonomyConfig {
  hire: AutonomyMode;
  dismiss: AutonomyMode;
}

export interface TeamLimits {
  /** Most agents the team may have, lead included. The lead cannot hire past it. */
  maxAgents: number;
  /** Spending limit for the whole team. Reaching it pauses everyone until you decide. */
  budget?: Budget;
}

export interface AgentConfig {
  id: string; // "john"
  name: string; // "John"
  /** Which role (RoleConfig.id) this agent has. */
  roleId: string;
  /** Who this agent reports to: an agent id, or CEO_ID. */
  reportsTo: string;
  /** Derived from the role's title on load and whenever roles change. Not saved. */
  role: string;
  /** Derived: roleId === LEAD_ROLE_ID. Not saved. */
  isLead: boolean;
  /** Set when an agent (the lead) hired this one, to its id. Absent for agents the CEO added. */
  hiredBy?: string;
  /** Hired for one piece of work; the lead dismisses it when that is done. */
  temporary?: boolean;
  /** Which desk in the open-plan office (0-based). The lead has its own desk. Kept unique by normalizeConfig. */
  desk?: number;
  /** Spending limit for this agent. Reaching it pauses the agent until you decide. */
  budget?: Budget;
  cli: AgentCli;
  model: string; // optional start model ("" = the CLI's default; users can switch with /model)
  mode: AgentMode;
  color: string; // hex, used for the robot, owner dots and chips
  /** Profile picture or illustrated look (Settings → Team → Profile). */
  avatar?: AvatarConfig;
  /** A line or two about this agent, shown to you and to teammates. */
  bio?: string;
  skills: string[];
  roleMd: string; // a personal note for this agent, added to its role file
  sandbox: SandboxSettings;
  workspacePath: string | null; // an existing folder to use; null = HQ-managed clone
  /** MCP servers (names in sbx's registry) this agent's sandbox gets. */
  mcp?: string[];
}

/** An MCP server registered with Docker Sandboxes (`sbx mcp ls`). */
export interface McpServer {
  name: string;
  transport: string; // "remote http" | "local stdio" | …
  status: string; // "ready" | "needs-auth" | …
  nextStep: string | null; // e.g. "sbx mcp auth arcjet"
}

export interface McpState {
  servers: McpServer[];
  /** Per agent: servers attached to its sandbox right now (sbx can't detach one; recreating the sandbox does). */
  attached: Record<string, string[]>;
  error: string | null;
  checkedAt: string;
}

export interface NewMcpServer {
  name: string;
  url?: string;
  /** Local stdio server: a program on this Mac. */
  command?: string;
  args?: string[];
  /** Optional API key: sent as "Authorization: Bearer <key>", stored by sbx (never by HQ). */
  apiKey?: string;
}

export type ReviewTool = "coderabbit" | "greptile" | "copilot" | "human" | "custom";
export type DeployTool = "instacloud" | "vercel" | "custom";

/**
 * What must happen before work leaves a stage.
 * none: it moves on as soon as the owner finishes. review / approval: an agent whose role has the
 * `review` / `approve` permission checks it. ceo: you approve it (an action item). pull-request:
 * the owner opens a PR; review and merge on GitHub finish it (last stage only).
 */
export const GATES = ["none", "review", "approval", "ceo", "pull-request"] as const;
export type GateKind = (typeof GATES)[number];

export const GATE_LABEL: Record<GateKind, string> = {
  none: "Nothing: moves on",
  review: "Teammate review",
  approval: "Teammate sign-off",
  ceo: "Your approval",
  "pull-request": "Pull request (GitHub)",
};

/** One step work goes through. */
export interface StageConfig {
  id: string; // "script"
  name: string; // "Script"
  /** Role id that does this stage, or "any" (any role that takes tasks). */
  owner: string;
  gate: GateKind;
  /** review / approval gates: the role that checks it. Left out: any role with the permission. */
  reviewer?: string;
  /** What finishing this stage means ("A draft of 600–900 words in shared/scripts/"). Told to whoever does it. */
  description?: string;
}

/** Where finished work goes. pull-request: a branch and PR on GitHub. files: files in the agent's folder. */
export type DeliverableKind = "pull-request" | "files";

/** Stage id for agents and stages: "any" role that takes tasks. */
export const ANY_ROLE = "any";

export interface WorkflowConfig {
  /** What one piece of work is called in the app: Task, Piece, Experiment. */
  item: string;
  deliverable: DeliverableKind;
  /** In order. Every new item starts in the first. */
  stages: StageConfig[];
  review: { enabled: boolean; tool: ReviewTool; command: string };
  merge: { by: "human" | "lead" };
  deploy: { enabled: boolean; tool: DeployTool; command: string; perAgentEnvironments: boolean };
}

export interface ProjectConfig {
  /** Fixed once created: names sandboxes, tmux sessions and ~/.yacc/<id>. Renaming the project never changes it. */
  id: string; // "askwell"
  name: string; // "Askwell"
  repo: string; // "acme/askwell"
  path: string; // "~/developer/askwell"
  hqPort: number; // port sandboxes use to reach HQ via host.docker.internal
  exportPlan?: boolean; // also write the plan to docs/plan.md
  officeName?: string; // the sign on the office wall; empty = "YACC"
  /** The modern office's look: palette, floor, wall and furniture. Templates pick one; default "modern". */
  theme?: ThemeId;
}

export type ThemeId = "modern" | "studio" | "lab" | "loft" | "night";
export const THEME_IDS = ["modern", "studio", "lab", "loft", "night"] as const satisfies readonly ThemeId[];

/**
 * How someone looks in the office. A picture you uploaded (kept in the repo under .yacc/avatars/) wins;
 * otherwise an illustrated person built from these choices, each falling back to one picked from their id.
 */
export interface AvatarConfig {
  skin?: number; // index into the skin tones
  hair?: number; // index into the hair colours
  style?: number; // 0 short, 1 long, 2 bun, 3 curly, 4 buzz
  glasses?: boolean;
  /** An uploaded picture, relative to .yacc/ (e.g. avatars/ada.png). */
  image?: string;
}

export interface HqConfig {
  project: ProjectConfig;
  ceo: CeoConfig;
  limits: TeamLimits;
  autonomy: AutonomyConfig;
  roles: RoleConfig[];
  team: AgentConfig[];
  workflow: WorkflowConfig;
  /** Optional: what the project is built with (plan 009). */
  stack?: StackConfig;
  /** Toolkits the team uses (toolkits.ts), each for every role or the roles listed. */
  toolkits?: ToolkitChoice[];
  /** The team's own skills (.yacc/skills/<name>/), each for every role or the roles listed. */
  skills?: ProjectSkillChoice[];
  /** How each model provider is signed in to. Left out: each provider's default (see models.ts). */
  providers?: ProvidersConfig;
  /** Model by kind of work, and what to switch to at a usage limit. */
  routing?: RoutingConfig;
  /** Your own API prices per model (a model name, or part of one), over YACC's built-in estimates. */
  prices?: Record<string, ModelPrice>;
}

/** An agent asked to reach a domain its sandbox blocks (Team MCP `request_access`). */
export interface AccessRequest {
  id: string;
  agentId: string;
  domain: string;
  reason: string;
  at: string;
  status: "pending" | "allowed" | "denied";
}

export type AccessDecision = "agent" | "everyone" | "deny";

// ---------------------------------------------------------------- Live state

export type AgentState = "idle" | "working" | "needs-input" | "in-review" | "review-passed";

/** The agent's process: its tmux session running `sbx run` (Sandbox) or `claude` (Local). */
export type SessionState = "stopped" | "starting" | "running" | "failed";

export interface SessionInfo {
  state: SessionState;
  detail: string | null; // why it failed, or what it is doing
  workspace: string | null; // absolute folder path on the host
  sandbox: { cpus: number; memoryGb: number } | null; // what the existing sandbox actually has
}

export interface AgentStatus {
  agentId: string;
  state: AgentState;
  currentTaskId: string | null;
  stateSince: string; // ISO time
  note: string | null; // e.g. "Asking: max PDF size 10 MB or 20 MB?"
  session: SessionInfo;
  /** Running on another model than its own: a routing rule or a fallback (not saved in config.yml). */
  using?: ModelChoiceInUse | null;
  /** Its provider stopped it at a usage limit (or a billing problem). */
  limited?: { provider: ProviderId; note: string; at: string } | null;
  /** Why HQ holds its messages, e.g. a budget reached. Null when it works normally. */
  held?: string | null;
}

/** The model an agent runs on instead of its own, and why. */
export interface ModelChoiceInUse {
  cli: AgentCli;
  model: string;
  why: "routing" | "fallback";
  reason: string;
}

export type BoardStatus = "active" | "planned" | "done";

export interface Board {
  id: string; // "P3"
  title: string; // "Phase 3 — Knowledge + chat"
  status: BoardStatus;
  order: number;
}

export type TaskStatus = "todo" | "in-progress" | "in-review" | "done" | "blocked";

export interface Task {
  id: string; // "P3-T02"
  boardId: string;
  title: string;
  ownerId: string | null;
  status: TaskStatus;
  needs: string[]; // task IDs
  prNumber: number | null;
  /** Workflow stage id. Missing on plans from before stages: the first stage. */
  stage?: string;
  /** Who must approve or send it back: an agent id, or "ceo". Set while it waits at a gate. */
  reviewerId?: string | null;
  description?: string; // what to build
  files?: string[]; // the only files this task may edit
  doneWhen?: string; // acceptance criteria
  note?: string | null; // e.g. why it's blocked
  /** Kind of work (e.g. "research"). Routing rules pick the model for it. */
  kind?: string;
}

export type ReviewState = "pending" | "reviewing" | "changes-requested" | "passed";

export interface PullRequest {
  number: number;
  title: string; // "[P3-T02] Chat route"
  taskId: string;
  authorId: string;
  review: ReviewState;
  openComments: number;
  mergeable: boolean;
  merged: boolean;
  openedAt: string;
  url?: string; // link to GitHub
  branch?: string;
  closed?: boolean; // closed without merging — hidden from the board
  conflict?: boolean; // has merge conflicts with the base branch
  reviewNote?: string | null; // e.g. "CodeRabbit: review rate limited"
}

export type EnvironmentStatus = "live" | "deploying" | "sleeping";

export interface Environment {
  name: string; // "main" | agent id
  agentId: string | null;
  url: string;
  status: EnvironmentStatus;
  lastDeployAt: string;
}

/** The human at the keyboard, as a message sender. */
export const HUMAN_ID = "you";

/** One message carried by the Team MCP between two agents (or from you). */
export interface AgentMessage {
  id: string;
  at: string;
  fromId: string; // agent id, or HUMAN_ID
  toId: string;
  text: string;
  delivered?: "typed" | "on-stop" | "queued"; // how HQ handed it over
}

export type ActivityType =
  | "task.assigned"
  | "task.started"
  | "task.created"
  | "agent.needs-input"
  | "agent.answered"
  | "message"
  | "pr.opened"
  | "review.started"
  | "review.passed"
  | "review.changes"
  | "pr.merged"
  | "deploy"
  | "session"
  | "config";

export interface ActivityEvent {
  id: string;
  at: string;
  type: ActivityType;
  agentId: string | null;
  text: string;
}

/** What removing an agent would delete. Answer to `inspectWorkspace`. */
export interface WorkspaceInfo {
  agentId: string;
  path: string;
  managed: boolean; // HQ made this folder (only these can be deleted from HQ)
  exists: boolean;
  changedFiles: number; // uncommitted changes
  unpushedCommits: number; // commits on local branches that aren't on any remote
  sandboxName: string | null;
  sandboxExists: boolean;
}

export interface RemoveAgentOptions {
  deleteSandbox: boolean;
  deleteFolder: boolean;
}

// ---------------------------------------------------------------- Setup

export type SetupCheckId =
  | "os"
  | "sbx"
  | "sbx-login"
  | "sbx-policy"
  | "tmux"
  | "gh"
  | "gh-remote"
  | "github-secret"
  | "claude"
  | "codex"
  | "gemini"
  | "openai-secret"
  | "anthropic-secret"
  | "google-secret"
  | "deepseek-provider"
  | "deepseek-secret"
  | "anthropic-env"
  | "openai-env"
  | "google-env"
  | "gemini-login"
  | "deepseek-env"
  | "perplexity-env";
export type SetupStatus = "ok" | "missing" | "unsupported" | "warning";

export interface SetupFix {
  command: string; // shown with a Copy button
  runnable: boolean; // HQ may run it in a visible terminal ("Run in terminal")
  docs: string | null;
}

export interface SetupCheck {
  id: SetupCheckId;
  label: string;
  status: SetupStatus;
  detail: string; // version found, or what is wrong
  neededFor: "sandbox" | "local" | "all" | "github";
  fix: SetupFix | null;
}

/** A network rule in effect for a sandbox, as sbx reports it. */
export interface SbxRule {
  id: string;
  decision: "allow" | "deny";
  resources: string[];
  source: "hq" | "kit" | "org" | "cli"; // cli = added with the sbx CLI, outside HQ
}

export interface SbxAgentState {
  rules: SbxRule[]; // empty until the sandbox exists
  keys: string[]; // service keys scoped to this sandbox
  envFile: { path: string; exists: boolean };
  syncError: string | null;
  /** Requests the sandbox blocked, waiting in sbx's approval queue (`sbx policy approval ls`). */
  approvals: SbxApproval[];
  /** Sandbox ports reachable from this machine (`sbx ports`), e.g. for a CLI's sign-in callback. */
  ports?: SbxPort[];
}

/** Terminal id of the Terminal panel: your own shell on this machine, not in a sandbox. */
export const HOST_TERMINAL = "shell:@host";

export interface SbxPort {
  sandbox: number;
  host: number;
}

export interface SbxApproval {
  id: string; // sbx's approval id
  host: string; // "mcp.notion.com:443"
  /** sbx's title as is, e.g. "GET api.example.com:443/v1/data" (shown, so different requests can be told apart). */
  title?: string;
  detail: string;
  /** False when sbx's entry is narrower than host:port (e.g. one HTTP method and path). */
  hostWide?: boolean;
  /** "TCP" or "UDP" from sbx's detail. HQ's allow rules are TCP, so others are answered through sbx. */
  protocol?: string;
}

/** What sbx actually has on this machine (read back, not saved settings). */
export interface SbxState {
  basePolicy: BasePolicy;
  proxy: string | null;
  globalKeys: string[]; // service keys available to every sandbox
  agents: Record<string, SbxAgentState>;
  checkedAt: string;
}

export interface MachineInfo {
  cpus: number;
  memoryGb: number;
  /** False on Windows: agents run inside HQ and stop when it stops (no tmux). */
  persistentAgents?: boolean;
}

export interface SetupState {
  machine: MachineInfo;
  checks: SetupCheck[];
  sandboxReady: boolean; // every sandbox check passes
  localReady: boolean; // Local mode can run
  checkedAt: string;
}

import type { Template } from "./templates";

export interface OfficeSnapshot {
  /** True until the first-run welcome is finished for this repo (real HQ only). */
  welcome?: boolean;
  setup: SetupState;
  sbx: SbxState;
  config: HqConfig;
  agents: AgentStatus[];
  boards: Board[];
  tasks: Task[];
  pullRequests: PullRequest[];
  environments: Environment[];
  messages: AgentMessage[]; // newest first, last 100
  activity: ActivityEvent[]; // newest first, last 50
  accessRequests?: AccessRequest[];
  mcp?: McpState;
  actionItems?: ActionItem[];
  briefings?: Briefing[];
  /** Templates the welcome can start from (built-in, this project's and yours). */
  templates?: Template[];
  sharedFiles?: SharedFile[];
  memory?: ProjectMemory;
  usage?: UsageView;
  /** The skill folders in .yacc/skills/ (real HQ: read from disk; given to roles by config.skills). */
  projectSkills?: ProjectSkillInfo[];
}

/** A file in the project's shared folder (`shared/` in the repo), which every agent can get. */
export interface SharedFile {
  path: string; // relative to shared/
  by: string; // agent id
  at: string;
  bytes: number;
}

/** A report to the CEO from the lead (report_to_ceo), or a notice from HQ about something the team did. */
export interface Briefing {
  id: string;
  fromId: string; // agent id, or "hq"
  kind: "report" | "notice";
  summary: string;
  /** Paths in the shared folder (or anywhere) where the outputs are. */
  deliverables: string[];
  /** Questions for the CEO. A reply goes back to the sender as a message. */
  questions: string[];
  at: string;
  read: boolean;
  reply: string | null;
}

/** What every agent should know about the project, kept in .yacc/memory/ in the repo. */
export interface ProjectMemory {
  brief: string; // brief.md: goals, audience, constraints
  decisions: string; // decisions.md: dated lines
  lessons: string; // lessons.md: dated lines
}

/** Something an agent needs the user to do outside its sandbox (Team MCP `ask_user`). */
export interface ActionItem {
  id: string;
  /** "request": an agent asked you for something (ask_user). "approval": work waits for your sign-off at a stage gate. */
  kind?: "request" | "approval" | "hire" | "dismiss" | "budget" | "limit";
  /** hire / dismiss: what the agent asked to do, carried out if you approve. */
  payload?: Record<string, unknown>;
  fromId: string; // agent id
  taskId: string | null;
  title: string;
  details: string; // steps; never secret values
  waiting: boolean; // the agent can't continue without it
  status: "open" | "done" | "dismissed";
  note: string | null; // the user's note when closing it
  at: string;
  closedAt: string | null;
}

// ---------------------------------------------------------------- Inputs

export interface NewAgentInput {
  name: string;
  /** A role id, or a new title (a role is created for it). */
  role: string;
  /** Who they report to (an agent id or "ceo"). Left out: the lead. */
  reportsTo?: string;
  cli?: AgentCli;
  model?: string;
  mode: AgentMode;
}

/** First-run choices from the welcome screen. */
export interface WelcomeInput {
  /** Template to start from (Template.id). Left out: the Software Team. */
  templateId?: string;
  projectName: string;
  lead: { name: string; cli: AgentCli };
  workers: { name: string; role: string; cli: AgentCli }[];
  reviewTool: ReviewTool;
  reviewEnabled: boolean;
  /** Optional: what the project is built with. */
  stack?: StackConfig;
  /** Toolkits to start with. Left out: the template's. */
  toolkits?: ToolkitChoice[];
}

export type AgentPatch = Partial<
  Pick<AgentConfig, "name" | "roleId" | "reportsTo" | "cli" | "model" | "mode" | "color" | "skills" | "roleMd" | "workspacePath" | "desk" | "bio">
> & { budget?: Budget | null; avatar?: AvatarConfig | null };

export type RolePatch = Partial<Pick<RoleConfig, "title" | "can" | "instructions" | "cli" | "model" | "tools">>;

export interface NewRoleInput {
  title: string;
  can?: Permission[];
  instructions?: string;
}

export interface OrgPatch {
  ceoName?: string;
  /** Your look in the office (a picture is set with setAvatarImage). Null: picked for you. */
  ceoAvatar?: AvatarConfig | null;
  maxAgents?: number;
  autonomy?: Partial<AutonomyConfig>;
  /** The team's budget; null removes it. */
  budget?: Budget | null;
}

export interface WorkflowPatch {
  item?: string;
  deliverable?: DeliverableKind;
  stages?: StageConfig[];
  review?: Partial<WorkflowConfig["review"]>;
  merge?: Partial<WorkflowConfig["merge"]>;
  deploy?: Partial<WorkflowConfig["deploy"]>;
}
