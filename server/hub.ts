// The server's single source of truth. Every mutation emits the matching
// OfficeEvent to all connected browsers, and config/plan changes are saved.

import type { OfficeEvent } from "../src/data/source";
import type { ActivityType, AgentConfig, AgentStatus, HqConfig, OfficeSnapshot, SessionInfo, SetupState } from "../src/data/types";
import { writePlanExport } from "./planExport";
import { normalizeConfig } from "../src/data/roles";
import { saveConfig, savePlan, type PlanFile } from "./store";
import type { RepoInfo } from "./repo";

type Listener = (e: OfficeEvent) => void;

const now = () => new Date().toISOString();

export class Hub {
  snap: OfficeSnapshot;
  private listeners = new Set<Listener>();
  private seq = 0;

  constructor(readonly repo: RepoInfo, readonly slug: string, config: HqConfig, plan: PlanFile, setup: SetupState) {
    this.snap = {
      setup,
      sbx: { basePolicy: "unknown", proxy: null, globalKeys: [], agents: {}, checkedAt: now() },
      config,
      agents: config.team.map((a) => Hub.freshStatus(a.id)),
      boards: plan.boards,
      tasks: plan.tasks,
      pullRequests: [],
      environments: [],
      messages: [],
      activity: [],
    };
  }

  static freshStatus(agentId: string): AgentStatus {
    return {
      agentId, state: "idle", currentTaskId: null, stateSince: now(), note: "Not started",
      session: { state: "stopped", detail: null, workspace: null, sandbox: null },
    };
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(e: OfficeEvent) {
    for (const fn of this.listeners) fn(e);
  }

  // ------------------------------------------------------------ lookups

  cfg(id: string): AgentConfig | undefined {
    return this.snap.config.team.find((a) => a.id === id);
  }

  status(id: string): AgentStatus | undefined {
    return this.snap.agents.find((a) => a.agentId === id);
  }

  name(id: string | null) {
    if (id === "you") return "You";
    if (id === "hq") return "HQ";
    return (id && this.cfg(id)?.name) || "Someone";
  }

  // ------------------------------------------------------------ mutations

  /** While an access request is open, the agent stays "needs you"; what hooks report meanwhile is kept for after. */
  private held = new Map<string, { state: AgentStatus["state"]; note: string | null }>();

  /** Remember what the agent was doing before it asked, to return to it after the answer. */
  holdForAccess(agentId: string) {
    const s = this.status(agentId);
    if (s && !this.held.has(agentId) && s.state !== "needs-input") this.held.set(agentId, { state: s.state, note: s.note });
  }

  pendingAccess(agentId: string) {
    return this.snap.accessRequests?.find((r) => r.agentId === agentId && r.status === "pending");
  }

  /** An access request was answered: drop back to what the agent is really doing (unless another is open). */
  accessAnswered(agentId: string) {
    // Another request from this agent is still open: keep waiting (and keep what it was doing).
    if (this.pendingAccess(agentId)) return;
    const held = this.held.get(agentId);
    this.held.delete(agentId);
    const s = this.status(agentId);
    if (s?.state === "needs-input" && s.note?.startsWith("Asking: access to"))
      this.setStatus(agentId, held ?? { state: "working", note: "Access answered" });
  }

  setStatus(id: string, patch: Partial<Omit<AgentStatus, "agentId" | "session">>) {
    const s = this.status(id);
    if (!s) return;
    const open = this.pendingAccess(id);
    if (open && patch.state !== undefined && patch.state !== "needs-input") {
      // A patch without a note keeps the note from before the request, not the "Asking" one.
      this.held.set(id, { state: patch.state, note: patch.note !== undefined ? patch.note : (this.held.get(id)?.note ?? null) });
      patch = { ...patch, state: "needs-input", note: `Asking: access to ${open.domain}` };
    }
    if (patch.state !== undefined && patch.state !== s.state) s.stateSince = now();
    Object.assign(s, patch);
    this.emit({ type: "agent.updated", agent: structuredClone(s) });
  }

  setSession(id: string, patch: Partial<SessionInfo>) {
    const s = this.status(id);
    if (!s) return;
    s.session = { ...s.session, ...patch };
    this.emit({ type: "agent.updated", agent: structuredClone(s) });
  }

  setSetup(setup: SetupState) {
    this.snap.setup = setup;
    this.emit({ type: "setup.updated", setup });
  }

  activity(type: ActivityType, agentId: string | null, text: string) {
    this.seq += 1;
    const event = { id: `a${this.seq}`, at: now(), type, agentId, text };
    this.snap.activity = [event, ...this.snap.activity].slice(0, 50);
    this.emit({ type: "activity", event });
  }

  /** Call after any change to settings: keeps them consistent, writes config.yml, tells the browsers. */
  configChanged() {
    normalizeConfig(this.snap.config);
    saveConfig(this.repo.root, this.snap.config);
    this.emit({ type: "config.updated", config: structuredClone(this.snap.config) });
  }

  /**
   * Settings edited by hand in config.yml while HQ runs. Applied when safe: an agent whose
   * session is running can't be removed this way (stop it first). Returns why not, or null.
   */
  applyExternalConfig(next: HqConfig): string | null {
    const cur = this.snap.config;
    if (next.project.id !== cur.project.id) return `project.id can't change while HQ runs (it names the sandboxes and folders). It is "${cur.project.id}".`;
    const nextIds = new Set(next.team.map((a) => a.id));
    const running = cur.team.filter((a) => !nextIds.has(a.id) && this.status(a.id)?.session.state !== "stopped");
    if (running.length) return `${running.map((a) => a.name).join(", ")} ${running.length > 1 ? "are" : "is"} still running. Stop ${running.length > 1 ? "them" : "it"} before removing ${running.length > 1 ? "them" : "it"} from config.yml.`;
    next.project.path = cur.project.path;
    next.project.hqPort = cur.project.hqPort;
    this.snap.config = next;
    const removed = this.snap.agents.filter((s) => !nextIds.has(s.agentId)).map((s) => s.agentId);
    this.snap.agents = this.snap.agents.filter((s) => nextIds.has(s.agentId));
    for (const a of next.team) if (!this.status(a.id)) this.snap.agents.push(Hub.freshStatus(a.id));
    for (const t of this.snap.tasks)
      if (t.ownerId && removed.includes(t.ownerId) && t.status !== "done") {
        t.ownerId = null;
        if (t.status === "in-progress") t.status = "todo";
      }
    if (removed.length) this.planChanged();
    this.emit({ type: "snapshot", snapshot: structuredClone(this.snap) });
    return null;
  }

  planChanged() {
    const plan = { boards: this.snap.boards, tasks: this.snap.tasks };
    savePlan(this.repo.root, plan);
    if (this.snap.config.project.exportPlan) writePlanExport(this.repo.root, this.snap.config, plan);
  }

  terminal(agentId: string, data: string) {
    this.emit({ type: "terminal.output", agentId, data });
  }
}
