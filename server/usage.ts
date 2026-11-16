// Usage and budgets (plan steps 4.4 and 4.5). Agent programs report tokens over OpenTelemetry
// (otlp.ts); this keeps them per day, agent and model in ~/.yacc/<project>/usage.json (this
// machine only, never committed), prices them, and holds an agent or the whole team when a
// budget is reached, until the CEO decides in an action item.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { costOf, runtimeOf, type TokenCounts } from "../src/data/models";
import type { ActionItem, AgentConfig, Budget, BudgetPeriod, UsageLine, UsageView } from "../src/data/types";
import type { Hub } from "./hub";
import { parseCliJson } from "./lib/json";
import type { LogEvent, MetricPoint } from "./otlp";
import { projectHome } from "./paths";

const KEEP_DAYS = 62;

export const emptyLine = (): UsageLine => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, estimated: false });

function addLine(to: UsageLine, from: UsageLine) {
  to.input += from.input;
  to.output += from.output;
  to.cacheRead += from.cacheRead;
  to.cacheWrite += from.cacheWrite;
  to.costUsd += from.costUsd;
  to.estimated ||= from.estimated;
}

// ---------------------------------------------------------------- periods (local time)

const pad = (n: number) => String(n).padStart(2, "0");
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The first day of the period that contains `now`, as a day key. Weeks start on Monday. */
export function periodStart(period: BudgetPeriod, now = new Date()): string {
  if (period === "day") return dayKey(now);
  if (period === "month") return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayKey(d);
}

const PERIOD_WORD: Record<BudgetPeriod, string> = { day: "today", week: "this week", month: "this month" };
const PER: Record<BudgetPeriod, string> = { day: "a day", week: "a week", month: "a month" };
export const usd = (n: number) => (n >= 100 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`);

// ---------------------------------------------------------------- what programs report → tokens per model

/** One program's report, as tokens and (if the program said) cost, per model. */
export type Reading = Map<string, { tokens: TokenCounts; reportedUsd: number | null }>;

const zero = (): TokenCounts => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

/**
 * Turns cumulative counters into deltas (a counter that went down was restarted). Delta points pass
 * through. One tracker per agent, kept in memory: after a restart the first cumulative point counts whole.
 */
export class Cumulative {
  private last = new Map<string, number>();
  delta(agentId: string, p: MetricPoint): number {
    if (p.temporality === "delta") return Math.max(0, p.value);
    const key = `${agentId}|${p.name}|${p.start}|${Object.entries(p.attrs).sort().map(([k, v]) => `${k}=${v}`).join(",")}`;
    const prev = this.last.get(key);
    this.last.set(key, p.value);
    if (prev === undefined || p.value < prev) return Math.max(0, p.value);
    return p.value - prev;
  }
}

/**
 * Metrics from Claude Code (claude_code.token.usage by type, claude_code.cost.usage) and Gemini CLI
 * (gemini_cli.token.usage by type). Gemini's input count includes cached input, so the cached part is
 * taken off; its tool and thinking tokens are priced as input and output.
 */
export function readMetrics(points: MetricPoint[], deltaOf: (p: MetricPoint) => number, fallbackModel: string): Reading {
  const out: Reading = new Map();
  const gemini = new Map<string, { input: number; cache: number; tool: number; output: number; thought: number }>();
  const at = (model: string) => {
    let r = out.get(model);
    if (!r) out.set(model, (r = { tokens: zero(), reportedUsd: null }));
    return r;
  };
  for (const p of points) {
    const model = String(p.attrs.model ?? p.attrs["gen_ai.request.model"] ?? fallbackModel) || "unknown";
    const type = String(p.attrs.type ?? "");
    if (p.name === "claude_code.token.usage") {
      const v = deltaOf(p);
      const t = at(model).tokens;
      if (type === "input") t.input += v;
      else if (type === "output") t.output += v;
      else if (type === "cacheRead") t.cacheRead += v;
      else if (type === "cacheCreation") t.cacheWrite += v;
    } else if (p.name === "claude_code.cost.usage") {
      const r = at(model);
      r.reportedUsd = (r.reportedUsd ?? 0) + deltaOf(p);
    } else if (p.name === "gemini_cli.token.usage") {
      const g = gemini.get(model) ?? { input: 0, cache: 0, tool: 0, output: 0, thought: 0 };
      const v = deltaOf(p);
      if (type === "input") g.input += v;
      else if (type === "cache") g.cache += v;
      else if (type === "tool") g.tool += v;
      else if (type === "output") g.output += v;
      else if (type === "thought") g.thought += v;
      gemini.set(model, g);
    }
  }
  for (const [model, g] of gemini) {
    const t = at(model).tokens;
    t.input += Math.max(0, g.input - g.cache) + g.tool;
    t.cacheRead += g.cache;
    t.output += g.output + g.thought;
  }
  return out;
}

/** Codex's codex.sse_event log records carry the counts of each finished response (input includes cached). */
export function readLogs(events: LogEvent[], fallbackModel: string): Reading {
  const out: Reading = new Map();
  for (const e of events) {
    if (e.name !== "codex.sse_event") continue;
    const a = e.attrs;
    if (a.input_token_count === undefined && a.output_token_count === undefined) continue;
    const model = String(a.model ?? a.slug ?? fallbackModel) || "unknown";
    const r = out.get(model) ?? { tokens: zero(), reportedUsd: null };
    const cached = num(a.cached_token_count);
    r.tokens.input += Math.max(0, num(a.input_token_count) - cached);
    r.tokens.cacheRead += cached;
    r.tokens.output += num(a.output_token_count);
    out.set(model, r);
  }
  return out;
}

// ---------------------------------------------------------------- the store

interface Saved {
  v: 1;
  /** day → agent → model → line */
  days: Record<string, Record<string, Record<string, UsageLine>>>;
  /** budget target ("project" or an agent id) → the period start the CEO let it go past its budget */
  allowed: Record<string, string>;
  /** same keys → the period start an 80% warning was shown */
  warned: Record<string, string>;
}

export class Usage {
  private file: string;
  private data: Saved;
  private cumulative = new Cumulative();
  private saveTimer: NodeJS.Timeout | null = null;
  private emitTimer: NodeJS.Timeout | null = null;
  /** Called after new usage is recorded (budgets check it). */
  onChange: (() => void) | null = null;

  constructor(
    private hub: Hub,
    private now: () => Date = () => new Date(),
  ) {
    this.file = join(projectHome(hub.slug), "usage.json");
    const saved = existsSync(this.file) ? parseCliJson<Saved>(readFileSync(this.file, "utf8")) : null;
    this.data = saved && saved.v === 1 && saved.days ? { v: 1, days: saved.days, allowed: saved.allowed ?? {}, warned: saved.warned ?? {} } : { v: 1, days: {}, allowed: {}, warned: {} };
    hub.snap.usage = this.view();
  }

  /** The model an agent runs right now (its own, or the one routing/fallback switched it to). */
  private running(agentId: string): Pick<AgentConfig, "cli" | "model"> | null {
    const agent = this.hub.cfg(agentId);
    if (!agent) return null;
    const using = this.hub.status(agentId)?.using;
    return using ? { cli: using.cli, model: using.model } : agent;
  }

  ingestMetrics(agentId: string, points: MetricPoint[]) {
    const run = this.running(agentId);
    if (!run) return;
    this.record(agentId, readMetrics(points, (p) => this.cumulative.delta(agentId, p), run.model || runtimeOf(run.cli).label));
  }

  ingestLogs(agentId: string, events: LogEvent[]) {
    const run = this.running(agentId);
    if (!run) return;
    this.record(agentId, readLogs(events, run.model || runtimeOf(run.cli).label));
  }

  /** Adds a reading. Claude Code's own cost counts for Anthropic models; everything else is estimated. */
  record(agentId: string, reading: Reading) {
    const run = this.running(agentId);
    if (!run || !reading.size) return;
    const trustCost = runtimeOf(run.cli).provider === "anthropic";
    const day = dayKey(this.now());
    const byAgent = ((this.data.days[day] ??= {})[agentId] ??= {});
    let any = false;
    for (const [model, r] of reading) {
      const t = r.tokens;
      if (!t.input && !t.output && !t.cacheRead && !t.cacheWrite && !r.reportedUsd) continue;
      const estimate = costOf(t, model, this.hub.snap.config.prices);
      const reported = trustCost && r.reportedUsd !== null;
      const line: UsageLine = { ...t, costUsd: reported ? r.reportedUsd! : estimate ?? 0, estimated: !reported };
      addLine((byAgent[model] ??= emptyLine()), line);
      any = true;
    }
    if (!any) return;
    this.prune();
    this.changed();
    this.onChange?.();
  }

  private prune() {
    const cutoff = new Date(this.now());
    cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
    const keep = dayKey(cutoff);
    for (const d of Object.keys(this.data.days)) if (d < keep) delete this.data.days[d];
  }

  private changed() {
    this.saveTimer ??= setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, 2000);
    this.emitTimer ??= setTimeout(() => {
      this.emitTimer = null;
      this.publish();
    }, 1000);
  }

  publish() {
    this.hub.snap.usage = this.view();
    this.hub.emit({ type: "usage.updated", usage: this.hub.snap.usage });
  }

  save() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
  }

  flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.save();
  }

  /** Spent since `from` (a day key) by one agent, or by everyone when agentId is null. */
  sum(from: string, agentId: string | null): UsageLine {
    const total = emptyLine();
    for (const [day, agents] of Object.entries(this.data.days)) {
      if (day < from) continue;
      for (const [id, models] of Object.entries(agents)) if (agentId === null || id === agentId) for (const line of Object.values(models)) addLine(total, line);
    }
    return total;
  }

  spent(period: BudgetPeriod, agentId: string | null): number {
    return this.sum(periodStart(period, this.now()), agentId).costUsd;
  }

  view(): UsageView {
    const now = this.now();
    const from = { day: periodStart("day", now), week: periodStart("week", now), month: periodStart("month", now) };
    const agents: UsageView["agents"] = {};
    const ids = new Set<string>();
    for (const agentsOfDay of Object.values(this.data.days)) for (const id of Object.keys(agentsOfDay)) ids.add(id);
    for (const id of ids) {
      const models = new Set<string>();
      let lastDay: string | null = null;
      for (const [day, a] of Object.entries(this.data.days)) {
        if (!a[id]) continue;
        if (day >= from.month) for (const m of Object.keys(a[id])) models.add(m);
        if (!lastDay || day > lastDay) lastDay = day;
      }
      agents[id] = { day: this.sum(from.day, id), week: this.sum(from.week, id), month: this.sum(from.month, id), models: [...models], lastAt: lastDay };
    }
    return { agents, project: { day: this.sum(from.day, null), week: this.sum(from.week, null), month: this.sum(from.month, null) } };
  }

  // Budget bookkeeping (kept with the usage so it survives restarts).
  allowedFor = (target: string) => this.data.allowed[target];
  allow(target: string, period: BudgetPeriod) {
    this.data.allowed[target] = periodStart(period, this.now());
    this.save();
  }
  warnedFor = (target: string) => this.data.warned[target];
  warn(target: string, period: BudgetPeriod) {
    this.data.warned[target] = periodStart(period, this.now());
    this.changed();
  }
  periodStart = (period: BudgetPeriod) => periodStart(period, this.now());
}

// ---------------------------------------------------------------- budgets

export interface BudgetActions {
  /** Opens (or finds) the CEO's action item for a reached budget. */
  openItem(target: string, fromId: string, title: string, details: string): ActionItem | null;
  /** Whether an open budget item exists for this target. */
  hasOpenItem(target: string): boolean;
  /** Retries delivery to an agent that was just released. */
  release(agentId: string): void;
}

/**
 * Holds agents whose budget (or the team's) is reached: HQ stops handing them messages and tasks,
 * and opens an action item. The CEO keeps them going for the rest of the period, or leaves them
 * paused. Raising a budget in Settings releases them too. A turn already running finishes.
 */
export class Budgets {
  private holds = new Map<string, string>();

  constructor(
    private hub: Hub,
    private usage: Usage,
    private actions: BudgetActions,
  ) {}

  holdReason(agentId: string): string | null {
    return this.holds.get(agentId) ?? null;
  }

  /** Looks at every budget again (after new usage, a settings change, or a decision). */
  check() {
    const cfg = this.hub.snap.config;
    const next = new Map<string, string>();
    const lead = cfg.team.find((a) => a.roleId === "lead") ?? cfg.team[0];

    const team = cfg.limits.budget;
    if (team && team.usd > 0 && lead) {
      const spent = this.usage.spent(team.period, null);
      const reason = this.evaluate("project", team, spent, lead.id, "The team", `Pause the whole team until you decide. Raise the budget in Settings → Models, or keep going ${PERIOD_WORD[team.period]}.`);
      if (reason) for (const a of cfg.team) next.set(a.id, reason);
    }
    for (const agent of cfg.team) {
      if (!agent.budget || agent.budget.usd <= 0 || next.has(agent.id)) continue;
      const spent = this.usage.spent(agent.budget.period, agent.id);
      const reason = this.evaluate(agent.id, agent.budget, spent, agent.id, agent.name, `Paused until you decide. Raise ${agent.name}'s budget in Settings → Models, or keep going ${PERIOD_WORD[agent.budget.period]}.`);
      if (reason) next.set(agent.id, reason);
    }

    for (const a of cfg.team) {
      const was = this.holds.get(a.id) ?? null;
      const now = next.get(a.id) ?? null;
      if (was === now) continue;
      this.hub.audit("budget", now ? `Paused ${a.name}: ${now}` : `${a.name} may go on (budget raised, or you said keep going)`, a.id, "hq");
      this.hub.setStatus(a.id, { held: now });
      if (!now) this.actions.release(a.id);
    }
    this.holds = next;
  }

  /** The hold reason if this target is over its budget (and not let through this period). Warns at 80%. */
  private evaluate(target: string, budget: Budget, spent: number, fromId: string, who: string, what: string): string | null {
    const start = this.usage.periodStart(budget.period);
    if (spent >= budget.usd * 0.8 && spent < budget.usd && this.usage.warnedFor(target) !== start) {
      this.usage.warn(target, budget.period);
      this.hub.activity("config", target === "project" ? null : target, `${who} has used ${usd(spent)} of ${usd(budget.usd)} ${PERIOD_WORD[budget.period]} (80% of the budget).`);
    }
    if (spent < budget.usd || this.usage.allowedFor(target) === start) return null;
    const reason = `Budget reached: ${usd(spent)} of ${usd(budget.usd)} ${PERIOD_WORD[budget.period]}${target === "project" ? " (team)" : ""}`;
    if (!this.actions.hasOpenItem(target)) {
      const item = this.actions.openItem(
        target,
        fromId,
        `${who} reached its budget: ${usd(spent)} of ${usd(budget.usd)} ${PER[budget.period]}`,
        `${what}\n\nCosts are YACC's estimate from API prices (Claude Code reports its own). On a subscription, they're what the work would cost on the API.\n\nKeep going: lets it continue until the period ends. Stay paused: leaves it paused until then, or until you raise the budget.`,
      );
      if (item) this.hub.activity("agent.needs-input", target === "project" ? null : target, `${reason}. Paused until you decide (Action items).`);
    }
    return reason;
  }

  /** The CEO's answer: "done" keeps it going this period; "dismissed" leaves it paused. */
  decide(target: string, decision: "done" | "dismissed") {
    const cfg = this.hub.snap.config;
    const budget = target === "project" ? cfg.limits.budget : cfg.team.find((a) => a.id === target)?.budget;
    if (decision === "done" && budget) {
      this.usage.allow(target, budget.period);
      this.hub.activity("config", target === "project" ? null : target, `${target === "project" ? "The team" : this.hub.name(target)} may go past ${usd(budget.usd)} ${PERIOD_WORD[budget.period]}.`);
    }
    this.check();
  }
}
