import type { ProjectSkillChoice, ProjectSkillInfo, ToolkitChoice } from "./toolkits";
import type { MessagingConfig } from "./messaging";
import type { Schedule, ScheduleStatus } from "./schedules";
import type { AuditEntry, AuditKind } from "./audit";
import type { Template } from "./templates";
import type { ProjectEntry } from "./projects";
import type { GalleryEntry, TemplateBundle, TemplatePreview } from "./templateBundle";
import type { StackConfig } from "./stack";
import type {
  AccessDecision,
  AccessRequest,
  ActionItem,
  Briefing,
  ProjectMemory,
  SharedFile,
  McpState,
  NewMcpServer,
  ActivityEvent,
  AgentMessage,
  AgentPatch,
  AgentStatus,
  Board,
  Environment,
  HqConfig,
  NewAgentInput,
  NewRoleInput,
  OrgPatch,
  RolePatch,
  OfficeSnapshot,
  SbxState,
  RemoveAgentOptions,
  SetupCheckId,
  SetupState,
  WelcomeInput,
  WorkspaceInfo,
  ProjectConfig,
  PullRequest,
  SandboxSettings,
  Task,
  WorkflowPatch,
  ProviderId,
  AuthMode,
  UsageView,
  RoutingConfig,
} from "./types";

export type OfficeEvent =
  | { type: "snapshot"; snapshot: OfficeSnapshot }
  | { type: "setup.updated"; setup: SetupState }
  | { type: "sbx.updated"; sbx: SbxState }
  | { type: "workspace.info"; info: WorkspaceInfo }
  | { type: "config.updated"; config: HqConfig }
  | { type: "agent.updated"; agent: AgentStatus }
  | { type: "agent.removed"; agentId: string }
  | { type: "board.updated"; board: Board }
  | { type: "task.updated"; task: Task }
  | { type: "task.removed"; taskId: string }
  | { type: "pr.updated"; pr: PullRequest }
  | { type: "env.updated"; env: Environment }
  | { type: "env.removed"; name: string }
  | { type: "message"; message: AgentMessage }
  | { type: "activity"; event: ActivityEvent }
  | { type: "terminal.output"; agentId: string; data: string }
  | { type: "access.updated"; request: AccessRequest }
  | { type: "mcp.updated"; mcp: McpState }
  | { type: "action.updated"; item: ActionItem }
  | { type: "briefing.updated"; briefing: Briefing }
  | { type: "shared.updated"; files: SharedFile[] }
  | { type: "memory.updated"; memory: ProjectMemory }
  | { type: "usage.updated"; usage: UsageView }
  | { type: "skills.updated"; skills: ProjectSkillInfo[] }
  | { type: "schedules.updated"; schedules: ScheduleStatus[] }
  | { type: "templates.updated"; templates: Template[] };

export type SimSpeed = 1 | 2 | 4;

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "unauthorized";

export interface DataPreset {
  id: string;
  label: string;
}

/** Controls that only exist on the mock source. The UI hides them when absent. */
export interface DevControls {
  presets: DataPreset[];
  loadPreset(id: string): void;
  setSpeed(multiplier: SimSpeed): void;
  /** Demo only: a random agent asks for a blocked domain. */
  simulateAccessRequest(): void;
}

export interface OfficeDataSource {
  connect(onEvent: (e: OfficeEvent) => void, onStatus?: (s: ConnectionStatus) => void): () => void; // returns disconnect

  sendTerminalInput(agentId: string, data: string): void;
  resizeTerminal(agentId: string, cols: number, rows: number): void;
  assignTask(taskId: string, agentId: string): void;
  /** You → an agent, or a post to a channel (#team, #<role id>), delivered like any Team MCP message. */
  sendMessage(toId: string, text: string): void;

  // agent sessions
  startAgent(id: string): void;
  stopAgent(id: string): void;
  openWorkspace(id: string): void; // opens the agent's folder on the host
  /** Opens a plain shell in the agent's sandbox (or folder); output on terminal id `shell:<id>`. */
  openShell(id: string): void;
  closeShell(id: string): void;
  /** The Terminal panel: your own shell on this machine in `dir` (empty = the repo); terminal id `shell:@host`. */
  openHostShell(dir: string, fresh?: boolean): void;
  closeHostShell(): void;
  /** Makes a port inside the agent's sandbox reachable at localhost:<port> on this machine. */
  forwardPort(agentId: string, port: number): void;
  unforwardPort(agentId: string, port: number): void;
  /** Removes and recreates the agent's sandbox (e.g. to apply new CPU/memory). The folder is kept. */
  recreateSandbox(id: string): void;

  // setup checklist
  recheckSetup(): void;
  /** Runs a check's fix command in a visible terminal (output on terminal id `setup:<checkId>`). */
  runSetupFix(id: SetupCheckId): void;

  addAgent(input: NewAgentInput): void;
  updateAgent(id: string, patch: AgentPatch): void;
  /** Stops the agent and removes it from the team; optionally deletes its sandbox and HQ-made folder. Ignored for the lead. */
  removeAgent(id: string, opts?: RemoveAgentOptions): void;
  /** Asks what removing would delete; answered with a `workspace.info` event. */
  inspectWorkspace(id: string): void;
  updateSandbox(agentId: string, patch: Partial<SandboxSettings>): void;
  /** A service key for one agent's sandbox, or every sandbox (agentId null). The value goes to sbx via stdin; HQ never keeps it. */
  setSecret(agentId: string | null, service: string, value: string): void;
  removeSecret(agentId: string | null, service: string): void;
  /** Machine-wide upstream proxy for sandbox traffic (null clears it). */
  setProxy(url: string | null): void;
  /** Creates the agent's env file if needed and opens it in the default editor. */
  openEnvFile(agentId: string): void;
  /** Closes an action item; HQ tells the agent (done: with your note; dismissed: continue without it). */
  resolveActionItem(id: string, decision: "done" | "dismissed", note?: string): void;
  /** Answers a briefing's questions: sent to whoever wrote it. */
  replyBriefing(id: string, text: string): void;
  markBriefingsRead(): void;
  /** Rewrites parts of the project memory (.yacc/memory/). */
  updateMemory(patch: Partial<ProjectMemory>): void;
  /** Saves the current setup as a template, in this project or for you. */
  saveTemplate(name: string, where: "project" | "user", description?: string): void;

  // MCP servers (Docker Sandboxes' registry)
  refreshMcp(): void;
  addMcp(input: NewMcpServer): void;
  /** Runs `sbx mcp auth <name>` in a visible terminal (id `setup:mcp-auth-<name>`). */
  authMcp(name: string): void;
  /** Unregisters a server from sbx (affects every sandbox on this machine). */
  removeMcp(name: string): void;
  /** Which servers an agent gets. New ones are attached right away if it's running. */
  setAgentMcp(agentId: string, names: string[]): void;
  /** Answers requests an agent's sandbox blocked (sbx's approval queue). "all" with dismiss clears them all. */
  answerApproval(agentId: string, approvalId: string, decision: "allow" | "dismiss"): void;
  /** Re-reads policy rules, keys and proxy from sbx. */
  refreshSbx(): void;
  // roles and org (saved to .yacc/config.yml and .yacc/roles/<id>.md)
  addRole(input: NewRoleInput): void;
  updateRole(id: string, patch: RolePatch): void;
  /** Ignored for the lead role and for roles an agent still has. */
  removeRole(id: string): void;
  /** The CEO's name and the headcount limit. */
  updateOrg(patch: OrgPatch): void;
  /** Channels and who may message whom. */
  updateMessaging(messaging: MessagingConfig): void;
  /** Asks the lead for a retrospective on a board (the last one done, when none is given). */
  requestRetrospective(boardId?: string): void;
  /** Template sharing: what a bundle (or a URL to one) would add, installing it, exporting one, deleting one, the gallery. */
  previewTemplate(src: { bundle?: unknown; url?: string }): Promise<{ preview?: TemplatePreview; error?: string }>;
  importTemplate(src: { bundle?: unknown; url?: string }, where: "project" | "user"): Promise<{ id?: string; name?: string; error?: string }>;
  exportTemplate(id: string): Promise<TemplateBundle | { error: string }>;
  deleteTemplate(id: string): Promise<{ error?: string }>;
  readGallery(): Promise<{ templates?: GalleryEntry[]; error?: string }>;
  /** The project switcher: projects on this computer; open one (starting its HQ if needed); take one off the list. */
  listProjects(): Promise<{ projects?: ProjectEntry[]; error?: string }>;
  openProject(ref: { slug?: string; root?: string }): Promise<{ url?: string; started?: boolean; error?: string }>;
  forgetProject(slug: string): Promise<{ projects?: ProjectEntry[]; error?: string }>;
  /** The audit log, newest first. */
  readAudit(q: { before?: string; limit?: number; kind?: AuditKind; actor?: string; text?: string }): Promise<{ entries: AuditEntry[]; more: boolean }>;
  /** The team's schedules, saved whole. */
  updateSchedules(schedules: Schedule[]): void;
  /** Runs a schedule now, whatever its time. */
  runSchedule(id: string): void;
  /** Which toolkits the team uses, each for every role or the roles listed. */
  updateToolkits(list: ToolkitChoice[]): void;
  /** Which roles get each of the team's own skills. */
  updateProjectSkills(list: ProjectSkillChoice[]): void;
  /** Creates or rewrites a project skill (.yacc/skills/<name>/SKILL.md). A new one goes to `roles` (none: every role). */
  saveProjectSkill(input: { name: string; description: string; body: string; roles?: string[] }): void;
  removeProjectSkill(name: string): void;
  /** Reads .yacc/skills/ again. */
  refreshProjectSkills(): void;
  /** A project skill's text, for editing. */
  readProjectSkill(name: string): Promise<{ name: string; description: string; body: string } | null>;
  /** An uploaded picture (a small PNG as base64) for an agent or the CEO ("ceo"); null removes it. */
  setAvatarImage(who: string, png: string | null): void;
  /** Where the browser loads an uploaded picture from (`avatar.image` is a path under .yacc/). */
  avatarUrl(image: string): string;
  /** How a model provider is signed in to: your subscription, or an API key (Settings → Models). */
  setProviderAuth(provider: ProviderId, auth: AuthMode): void;
  /** Routing rules (model by kind of work) and the fallback order at a usage limit. */
  setRouting(routing: RoutingConfig): void;
  /** Back to the agent's own model, after routing or a fallback switched it. */
  useOwnModel(agentId: string): void;
  updateWorkflow(patch: WorkflowPatch): void;
  updateProject(patch: Partial<ProjectConfig>): void;
  createBoard(title: string): void;
  updateBoard(id: string, patch: Partial<Pick<Board, "title" | "status">>): void;

  /** The project's stack (null clears it). */
  updateStack(stack: StackConfig | null): void;
  /** Answers an agent's request_access: allow for that agent, for every agent, or deny. */
  resolveAccess(requestId: string, decision: AccessDecision): void;

  /** Finishes first-run setup: saves the project's team and review tool. */
  completeWelcome(input: WelcomeInput): void;

  dev?: DevControls;
}
