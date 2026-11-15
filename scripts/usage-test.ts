// Usage, budgets, routing and fallback (Phase 4 part 2): OTLP decoding (JSON and protobuf), what each
// program reports → tokens and cost, budgets that hold agents, the inbox gate, routing by task kind,
// fallback at a usage limit, limit detection on screens, telemetry settings, and the YAML.
// No agents, sandboxes or network needed.
//
//   npx tsx scripts/usage-test.ts

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "yacc-usage-"));
Object.assign(process.env, { HOME: tmp, USERPROFILE: tmp }); // usage.json and action items go under this ~/.yacc

const { ActionItems } = await import("../server/actionItems");
const { adapters, claudeAtLeast, codexConfig, geminiSettings } = await import("../server/adapters");
const { roleMd } = await import("../server/agentFiles");
const { Hub } = await import("../server/hub");
const { Inbox } = await import("../server/inbox");
const { decodeLogs, decodeMetrics } = await import("../server/otlp");
const { Planner } = await import("../server/planner");
const { Sessions } = await import("../server/sessions");
const { newAgent, parseConfig, serializeConfig } = await import("../server/store");
const { Budgets, Usage, periodStart, readLogs, readMetrics, Cumulative } = await import("../server/usage");
const { cleanBudget, cleanRouting, costOf, detectLimit, fallbackFor, priceFor, routeFor, teamChecks } = await import("../src/data/models");
const { defaultAutonomy, defaultRoles, normalizeConfig } = await import("../src/data/roles");
const { defaultWorkflowParts } = await import("../src/data/workflow");
const { LEAD_ROLE_ID } = await import("../src/data/types");
import type { AgentConfig, HqConfig, SetupCheck, SetupState } from "../src/data/types";
import type { RepoInfo } from "../server/repo";

let passed = 0;
function ok(label: string, cond: unknown, detail?: unknown) {
  if (!cond) throw new Error(`FAILED: ${label}${detail !== undefined ? `\n  got: ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  passed += 1;
}
function throws(label: string, fn: () => unknown, match: RegExp) {
  try {
    fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return ok(`${label} (message)`, match.test(msg), msg);
  }
  throw new Error(`FAILED: ${label}: expected an error`);
}
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

function team(): HqConfig {
  const lead = newAgent("maya", "Maya", LEAD_ROLE_ID, "#ff77a8");
  const ada = newAgent("ada", "Ada", "developer", "#29adff", "maya");
  const gus = newAgent("gus", "Gus", "developer", "#00e436", "maya");
  const cfg: HqConfig = {
    project: { id: "p", name: "P", repo: "acme/p", path: tmp, hqPort: 7420 },
    ceo: { name: "Abuti" },
    limits: { maxAgents: 8 },
    autonomy: defaultAutonomy(),
    roles: defaultRoles(),
    team: [lead, ada, gus],
    workflow: { ...defaultWorkflowParts(true), review: { enabled: true, tool: "human", command: "" }, merge: { by: "human" }, deploy: { enabled: false, tool: "custom", command: "", perAgentEnvironments: false } },
  };
  normalizeConfig(cfg);
  return cfg;
}

let n = 0;
function world(cfg = team(), checks: SetupCheck[] = []) {
  const name = `w${++n}`;
  const root = join(tmp, name);
  mkdirSync(join(root, ".yacc"), { recursive: true });
  const repo: RepoInfo = { root, name, originUrl: null, github: null, hasCodeRabbit: false, hasInsta: false };
  cfg.project.path = root;
  const setup = { machine: { cpus: 4, memoryGb: 8 }, checks, sandboxReady: true, localReady: true, checkedAt: "" } as SetupState;
  const hub = new Hub(repo, `usage-${name}-${process.pid}`, cfg, { boards: [{ id: "B1", title: "Backlog", status: "active", order: 0 }], tasks: [] }, setup);
  return { hub, root };
}

// ------------------------------------------------------------------ 1. OTLP decoding

const kv = (key: string, v: string | number) => ({ key, value: typeof v === "string" ? { stringValue: v } : Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v } });
{
  const body = {
    resourceMetrics: [
      {
        scopeMetrics: [
          {
            metrics: [
              { name: "claude_code.token.usage", sum: { aggregationTemporality: 1, dataPoints: [{ attributes: [kv("type", "input"), kv("model", "claude-sonnet-5-5")], asDouble: 1200, startTimeUnixNano: "1", timeUnixNano: "2" }] } },
              { name: "claude_code.cost.usage", sum: { aggregationTemporality: "AGGREGATION_TEMPORALITY_DELTA", dataPoints: [{ attributes: [kv("model", "claude-sonnet-5-5")], asDouble: 0.0123 }] } },
              { name: "claude_code.session.count", gauge: { dataPoints: [{ asInt: "1" }] } },
            ],
          },
        ],
      },
    ],
  };
  const pts = decodeMetrics(Buffer.from(JSON.stringify(body)), "application/json");
  ok("otlp json: sums only, gauges skipped", pts.length === 2, pts);
  ok("otlp json: attributes, values, delta", pts[0].attrs.type === "input" && pts[0].attrs.model === "claude-sonnet-5-5" && pts[0].value === 1200 && pts[0].temporality === "delta" && pts[1].temporality === "delta");
  const logs = decodeLogs(Buffer.from(JSON.stringify({ resourceLogs: [{ scopeLogs: [{ logRecords: [{ attributes: [kv("event.name", "codex.sse_event"), kv("input_token_count", 5000), kv("cached_token_count", 1000), kv("output_token_count", 300)] }] }] }] })), "application/json");
  ok("otlp json logs: event name and int attributes", logs[0].name === "codex.sse_event" && logs[0].attrs.input_token_count === 5000);
  throws("otlp: bad JSON is refused", () => decodeMetrics(Buffer.from("{oops"), "application/json"), /JSON|Unexpected|token/i);
}

// A tiny protobuf writer for the test (the server only reads).
const varint = (n: bigint | number) => {
  let v = BigInt(n);
  const out: number[] = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Buffer.from(out);
};
const tag = (no: number, wire: number) => varint((no << 3) | wire);
const msg = (no: number, payload: Buffer) => Buffer.concat([tag(no, 2), varint(payload.length), payload]);
const strF = (no: number, s: string) => msg(no, Buffer.from(s, "utf8"));
const vF = (no: number, n: number | bigint) => Buffer.concat([tag(no, 0), varint(n)]);
const dF = (no: number, d: number) => {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(d);
  return Buffer.concat([tag(no, 1), b]);
};
const fF = (no: number, n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return Buffer.concat([tag(no, 1), b]);
};
const attr = (k: string, v: string | number) => msg(7, Buffer.concat([strF(1, k), msg(2, typeof v === "string" ? strF(1, v) : vF(3, v))]));
{
  // gemini_cli.token.usage, cumulative (2), one point with type=input, model=gemini-3-flash-preview, as_int 900.
  const asInt = Buffer.alloc(8);
  asInt.writeBigInt64LE(900n);
  const point = Buffer.concat([attr("type", "input"), attr("model", "gemini-3-flash-preview"), fF(2, 10n), fF(3, 20n), Buffer.concat([tag(6, 1), asInt])]);
  const sum = Buffer.concat([msg(1, point), vF(2, 2), vF(3, 1)]);
  const metric = Buffer.concat([strF(1, "gemini_cli.token.usage"), msg(7, sum)]);
  const req = msg(1, msg(2, msg(2, metric)));
  const pts = decodeMetrics(req, "application/x-protobuf");
  ok("otlp protobuf: metric, attributes, int value, cumulative", pts.length === 1 && pts[0].name === "gemini_cli.token.usage" && pts[0].attrs.model === "gemini-3-flash-preview" && pts[0].value === 900 && pts[0].temporality === "cumulative" && pts[0].start === "10", pts);
  // A double point.
  const p2 = Buffer.concat([attr("model", "x"), dF(4, 0.5)]);
  const pts2 = decodeMetrics(msg(1, msg(2, msg(2, Buffer.concat([strF(1, "claude_code.cost.usage"), msg(7, Buffer.concat([msg(1, p2), vF(2, 1)]))])))), "application/x-protobuf");
  ok("otlp protobuf: double value, delta", pts2[0].value === 0.5 && pts2[0].temporality === "delta");
  // Logs: LogRecord with attributes (6) and event_name (12).
  const rec = Buffer.concat([msg(6, Buffer.concat([strF(1, "output_token_count"), msg(2, vF(3, 77))])), strF(12, "codex.sse_event")]);
  const logs = decodeLogs(msg(1, msg(2, msg(2, rec))), "application/x-protobuf");
  ok("otlp protobuf logs: event_name and attributes", logs[0].name === "codex.sse_event" && logs[0].attrs.output_token_count === 77);
  throws("otlp protobuf: a truncated body is refused", () => decodeMetrics(req.subarray(0, req.length - 3), "application/x-protobuf"), /truncated/);
}

// ------------------------------------------------------------------ 2. readings → tokens and cost

{
  const cum = new Cumulative();
  const p = (value: number, type: string, temporality: "delta" | "cumulative" = "cumulative") => ({ name: "gemini_cli.token.usage", attrs: { type, model: "gemini-3-flash-preview" }, value, temporality, start: "1", time: "2" });
  ok("cumulative: the first point counts whole", cum.delta("a", p(100, "input")) === 100);
  ok("cumulative: then the difference", cum.delta("a", p(160, "input")) === 60);
  ok("cumulative: a restart (lower value) counts whole", cum.delta("a", p(20, "input")) === 20);
  ok("cumulative: per agent", cum.delta("b", p(160, "input")) === 160);
  ok("delta points pass through", cum.delta("a", p(5, "input", "delta")) === 5);

  const g = readMetrics([p(1000, "input", "delta"), p(400, "cache", "delta"), p(50, "tool", "delta"), p(200, "output", "delta"), p(30, "thought", "delta")], (x) => x.value, "gemini");
  const gt = g.get("gemini-3-flash-preview")!.tokens;
  ok("gemini: cached input is taken off input, tool tokens added", gt.input === 650 && gt.cacheRead === 400, gt);
  ok("gemini: thinking tokens count as output", gt.output === 230);

  const c = readMetrics(
    [
      { name: "claude_code.token.usage", attrs: { type: "input", model: "claude-opus-5-5" }, value: 10, temporality: "delta", start: "0", time: "0" },
      { name: "claude_code.token.usage", attrs: { type: "cacheCreation", model: "claude-opus-5-5" }, value: 7, temporality: "delta", start: "0", time: "0" },
      { name: "claude_code.token.usage", attrs: { type: "cacheRead", model: "claude-opus-5-5" }, value: 3, temporality: "delta", start: "0", time: "0" },
      { name: "claude_code.cost.usage", attrs: { model: "claude-opus-5-5" }, value: 0.25, temporality: "delta", start: "0", time: "0" },
    ],
    (x) => x.value,
    "claude",
  );
  const cr = c.get("claude-opus-5-5")!;
  ok("claude: token types and its own cost", cr.tokens.input === 10 && cr.tokens.cacheWrite === 7 && cr.tokens.cacheRead === 3 && cr.reportedUsd === 0.25);

  const x = readLogs(
    [
      { name: "codex.sse_event", attrs: { "event.kind": "response.completed", model: "gpt-5.5", input_token_count: 5000, cached_token_count: 1000, output_token_count: 300 } },
      { name: "codex.sse_event", attrs: { "event.kind": "response.output_text.delta" } },
      { name: "codex.api_request", attrs: { input_token_count: 999 } },
    ],
    "codex",
  );
  ok("codex: finished responses only, cached part of input", x.size === 1 && x.get("gpt-5.5")!.tokens.input === 4000 && x.get("gpt-5.5")!.tokens.cacheRead === 1000 && x.get("gpt-5.5")!.tokens.output === 300);

  ok("prices: specific models before broad ones", priceFor("deepseek-v4-flash")!.input === 0.14 && priceFor("deepseek-v4-pro")!.input === 0.435 && priceFor("gemini-3-flash-preview")!.input === 0.5 && priceFor("gemini-3.1-pro-preview")!.input === 2 && priceFor("gpt-5.4-mini")!.input === 0.75);
  ok("prices: unknown model has none", priceFor("llama-9") === null && costOf({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, "llama-9") === null);
  ok("prices: yours win, by part of the name", priceFor("deepseek-v4-pro", { "v4-pro": { input: 1, output: 2 } })!.input === 1);
  ok("cost: per million tokens", near(costOf({ input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 0 }, "deepseek-v4-pro")!, 0.435 + 0.87 + 0.003625));
}

// ------------------------------------------------------------------ 3. the usage store, periods

{
  ok("week starts on Monday", periodStart("week", new Date(2026, 10, 15)) === "2026-11-09" && periodStart("week", new Date(2026, 10, 9)) === "2026-11-09" && periodStart("week", new Date(2026, 10, 8)) === "2026-11-02");
  ok("month and day", periodStart("month", new Date(2026, 10, 15)) === "2026-11-01" && periodStart("day", new Date(2026, 10, 15)) === "2026-11-15");

  const cfg = team();
  Object.assign(cfg.team.find((a) => a.id === "ada")!, { cli: "deepseek", model: "deepseek-v4-pro" });
  const { hub } = world(cfg);
  const usage = new Usage(hub);
  let changes = 0;
  usage.onChange = () => void changes++;
  usage.ingestMetrics("maya", [
    { name: "claude_code.token.usage", attrs: { type: "input", model: "claude-sonnet-5-5" }, value: 2000, temporality: "delta", start: "0", time: "0" },
    { name: "claude_code.cost.usage", attrs: { model: "claude-sonnet-5-5" }, value: 0.5, temporality: "delta", start: "0", time: "0" },
  ]);
  // DeepSeek runs in Claude Code, whose own cost uses Anthropic's prices: YACC prices it instead.
  usage.ingestMetrics("ada", [
    { name: "claude_code.token.usage", attrs: { type: "output", model: "deepseek-v4-pro" }, value: 1_000_000, temporality: "delta", start: "0", time: "0" },
    { name: "claude_code.cost.usage", attrs: { model: "deepseek-v4-pro" }, value: 15, temporality: "delta", start: "0", time: "0" },
  ]);
  usage.ingestLogs("gus", [{ name: "codex.sse_event", attrs: { model: "mystery-model", input_token_count: 10, output_token_count: 10 } }]);
  const v = usage.view();
  ok("usage: Claude's own cost for Anthropic models", near(v.agents.maya.day.costUsd, 0.5) && !v.agents.maya.day.estimated);
  ok("usage: DeepSeek priced by YACC, marked estimated", near(v.agents.ada.day.costUsd, 0.87) && v.agents.ada.day.estimated);
  ok("usage: an unknown model counts tokens at no cost", v.agents.gus.day.output === 10 && v.agents.gus.day.costUsd === 0);
  ok("usage: day, week and month include today", near(v.project.day.costUsd, 1.37) && near(v.project.week.costUsd, 1.37) && near(v.project.month.costUsd, 1.37));
  ok("usage: models seen this month", v.agents.ada.models.join() === "deepseek-v4-pro");
  ok("usage: budgets are checked after each reading", changes === 3);
  usage.ingestLogs("nobody", [{ name: "codex.sse_event", attrs: { input_token_count: 10 } }]);
  ok("usage: unknown agents are ignored", !usage.view().agents.nobody);
  usage.flush();
  const reopened = new Usage(hub);
  ok("usage: kept on this machine across restarts", near(reopened.view().project.day.costUsd, 1.37));
}

// ------------------------------------------------------------------ 4. budgets hold agents, and the inbox waits

{
  const cfg = team();
  cfg.team.find((a) => a.id === "ada")!.budget = { usd: 1, period: "day" };
  const { hub } = world(cfg);
  const inbox = new Inbox(hub, { type: async () => true, enter: async () => true });
  const planner = new Planner(hub, inbox);
  planner.actions = new ActionItems(hub, planner);
  const usage = new Usage(hub);
  const released: string[] = [];
  const items = () => (hub.snap.actionItems ?? []).filter((i) => i.kind === "budget");
  const budgets = new Budgets(hub, usage, {
    openItem: (target, fromId, title, details) => planner.actions!.addDecision("budget", fromId, title, details, { target }),
    hasOpenItem: (target) => items().some((i) => i.status === "open" && i.payload?.target === target),
    release: (id) => void released.push(id),
  });
  usage.onChange = () => budgets.check();
  inbox.held = (id) => budgets.holdReason(id);
  const spend = (id: string, usd: number) => usage.record(id, new Map([["claude-sonnet-5-5", { tokens: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 }, reportedUsd: usd }]]));

  spend("ada", 0.85);
  ok("budget: 80% warns once in Activity", hub.snap.activity.some((e) => /Ada has used \$0\.850 of \$1\.00 today \(80%/.test(e.text)) && !budgets.holdReason("ada"));
  spend("ada", 0.01);
  ok("budget: warned only once", hub.snap.activity.filter((e) => /80% of the budget/.test(e.text)).length === 1);
  spend("ada", 0.2);
  ok("budget: reached holds the agent", /Budget reached: \$1\.06 of \$1\.00 today/.test(budgets.holdReason("ada") ?? ""), budgets.holdReason("ada"));
  ok("budget: shown on its status", /Budget reached/.test(hub.status("ada")?.held ?? ""));
  ok("budget: one action item for the CEO", items().length === 1 && items()[0].status === "open" && /Ada reached its budget/.test(items()[0].title));
  spend("ada", 0.2);
  ok("budget: no second item while one is open", items().length === 1);
  ok("budget: others keep working", !budgets.holdReason("gus"));

  inbox.push("ada", { fromId: "maya", kind: "message", text: "next thing" });
  ok("inbox: a held agent's messages aren't handed over at Stop", inbox.takeForStop("ada") === null && inbox.pending("ada") === 1);

  planner.actions!.onDecision = (item, decision) => budgets.decide(String(item.payload?.target), decision);
  planner.actions!.resolve(items()[0].id, "done");
  ok("budget: 'Keep going' releases it for the rest of the period", !budgets.holdReason("ada") && released.includes("ada") && hub.status("ada")?.held === null);
  ok("inbox: then its messages go through", inbox.takeForStop("ada") !== null);
  spend("ada", 5);
  ok("budget: stays released this period, however much more", !budgets.holdReason("ada"));

  // The team's budget holds everyone; removing it releases them.
  hub.snap.config.limits.budget = { usd: 2, period: "month" };
  budgets.check();
  ok("team budget: everyone is held", ["maya", "ada", "gus"].every((id) => /team/.test(budgets.holdReason(id) ?? "")), ["maya", "ada", "gus"].map((id) => budgets.holdReason(id)));
  ok("team budget: one item, from the lead", items().filter((i) => i.payload?.target === "project").length === 1 && items().find((i) => i.payload?.target === "project")!.fromId === "maya");
  delete hub.snap.config.limits.budget;
  budgets.check();
  ok("team budget: removing it releases everyone", ["maya", "ada", "gus"].every((id) => !budgets.holdReason(id)));
}

// ------------------------------------------------------------------ 5. routing and fallback

{
  const ok_ = (id: string): SetupCheck => ({ id: id as SetupCheck["id"], label: id, status: "ok", detail: "", fix: null, neededFor: "both" });
  const cfg = team();
  cfg.routing = { rules: [{ kind: "research", cli: "gemini", model: "pro" }], fallback: [{ cli: "claude" }, { cli: "codex" }, { cli: "gemini", model: "flash" }] };
  ok("routing: a rule for the kind", routeFor("Research", cfg)?.cli === "gemini" && routeFor("writing", cfg) === null && routeFor(undefined, cfg) === null);
  const ada = cfg.team.find((a) => a.id === "ada")!;
  const all = () => true;
  ok("fallback: the first from another provider", fallbackFor(ada, cfg, ["anthropic"], all)?.cli === "codex");
  ok("fallback: skips providers at their limit too", fallbackFor(ada, cfg, ["anthropic", "openai"], all)?.cli === "gemini");
  ok("fallback: skips what can't run here", fallbackFor(ada, cfg, ["anthropic"], (p) => p.cli !== "codex")?.cli === "gemini");
  ok("fallback: none left", fallbackFor(ada, cfg, ["anthropic", "openai", "google"], all) === null);
  ok("checks: routing and fallback models get their setup checks", ["google-secret", "openai-secret"].every((c) => teamChecks(cfg).includes(c as never)), teamChecks(cfg));

  const { hub } = world(cfg, [ok_("tmux"), ok_("claude"), ok_("google-secret"), ok_("openai-secret")]);
  const sessions = new Sessions(hub, "tok");
  const notes: string[] = [];
  const stuck: string[] = [];
  sessions.notify = (id, text) => void notes.push(`${id}:${text}`);
  sessions.onStuckAtLimit = (id, title) => void stuck.push(`${id}:${title}`);
  const task = (kind?: string) => ({ id: "B1-T01", boardId: "B1", title: "Find sources", ownerId: "ada", status: "todo" as const, needs: [], prNumber: null, ...(kind ? { kind } : {}) });

  sessions.applyRouting("ada", task("research"));
  ok("routing: a research task moves a stopped agent to Gemini Pro for its next start", hub.status("ada")?.using?.cli === "gemini" && hub.status("ada")?.using?.model === "pro" && hub.status("ada")?.using?.why === "routing");
  sessions.applyRouting("ada", task());
  await new Promise((r) => setTimeout(r, 10));
  ok("routing: a task without a rule moves it back to its own model", !hub.status("ada")?.using);
  hub.setSession("ada", { state: "running" });
  hub.setStatus("ada", { state: "working" });
  sessions.applyRouting("ada", task("research"));
  ok("routing: a busy agent keeps its model (and Activity says why)", !hub.status("ada")?.using && hub.snap.activity.some((e) => /busy/.test(e.text)));
  hub.setSession("ada", { state: "stopped" });
  hub.setStatus("ada", { state: "idle" });

  const blocked = world(Object.assign(team(), { routing: cfg.routing }), [ok_("tmux"), ok_("claude")]);
  const s2 = new Sessions(blocked.hub, "tok");
  s2.applyRouting("ada", task("research"));
  ok("routing: a model that isn't set up is skipped", !blocked.hub.status("ada")?.using && blocked.hub.snap.activity.some((e) => /can't run/.test(e.text)));

  await sessions.onLimit("ada", "Claude usage limit reached. Your limit will reset at 3pm.", "3pm");
  ok("limit: noted on the agent", hub.status("ada")?.limited?.provider === "anthropic" && /resets 3pm/.test(hub.status("ada")?.limited?.note ?? ""));
  ok("limit: the first fallback that can run takes over", hub.status("ada")?.using?.cli === "codex" && hub.status("ada")?.using?.why === "fallback");
  ok("limit: the agent is told to carry on", notes.some((t) => t.startsWith("ada:") && /moved to OpenAI/.test(t) && /git status/.test(t)));
  sessions.applyRouting("ada", task("research"));
  ok("routing: never undoes a fallback", hub.status("ada")?.using?.why === "fallback");

  await sessions.onLimit("gus", "Claude usage limit reached.", null);
  ok("limit: another agent skips the provider that's limited (and its own)", hub.status("gus")?.using?.cli === "codex");
  await sessions.onLimit("gus", "You've hit your usage limit. Try again at 5pm.", "5pm");
  ok("limit: then the next fallback", hub.status("gus")?.using?.cli === "gemini" && hub.status("gus")?.using?.model === "flash");
  await sessions.onLimit("gus", "Usage limit reached for gemini-3-flash.", null);
  ok("limit: with none left, the CEO decides", stuck.some((s) => s.startsWith("gus:") && /Gemini/.test(s)));

  await sessions.useOwnModel("ada");
  ok("own model: back to it, limit note cleared", !hub.status("ada")?.using && !hub.status("ada")?.limited);
  ok("switching: nothing pending once done", !sessions.isSwitching("ada"));
}

// ------------------------------------------------------------------ 6. limit messages on screen

{
  const yes = (p: "claude" | "codex" | "gemini", s: string) => detectLimit(p, `some output\n${s}\n> `);
  ok("claude: the classic message, with its reset time", yes("claude", "Claude usage limit reached. Your limit will reset at 3pm (America/Santiago).")?.resets === "3pm");
  ok("claude: the newer one", yes("claude", "You've hit your session limit · resets 3:45pm")?.resets === "3:45pm");
  ok("claude: 5-hour", yes("claude", "5-hour limit reached ∙ resets 5am")?.resets === "5am");
  ok("claude: weekly", !!yes("claude", "You've hit your weekly limit · resets Mon 12:00am"));
  ok("claude: billing", !!yes("claude", "Credit balance is too low"));
  ok("claude via DeepSeek: out of balance", !!yes("claude", "API Error: 402 Insufficient Balance"));
  ok("claude: a warning isn't a limit", !yes("claude", "Approaching usage limit · resets at 10am"));
  ok("claude: credits taking over isn't a limit", !yes("claude", "5-hour limit reached - continuing with usage credits"));
  ok("claude: an agent writing about rate limits isn't one", !yes("claude", "The API has a rate limit of 100 requests per minute, so we retry."));
  ok("codex: usage limit, with when", yes("codex", "■ You’ve hit your usage limit. Upgrade to Plus to continue using Codex, or try again at Jul 10th, 2026 2:02 PM.")?.resets === "Jul 10th, 2026 2:02 PM");
  ok("codex: try again in", yes("codex", "You've hit your usage limit. Try again in 4 days 2 hours 46 minutes.")?.resets === "4 days 2 hours 46 minutes");
  ok("gemini: daily quota", !!yes("gemini", "TerminalQuotaError: You have exhausted your daily quota on this model."));
  ok("gemini: usage limit for a model", !!yes("gemini", "Usage limit reached for gemini-3.1-pro-preview."));
  ok("each program's own wording only", !yes("gemini", "Claude usage limit reached.") && !yes("codex", "Usage limit reached for gemini"));
}

// ------------------------------------------------------------------ 7. telemetry settings per program

{
  ok("claude version: StopFailure from 2.1.78", claudeAtLeast("2.1.284 (Claude Code)", [2, 1, 78]) && claudeAtLeast("2.1.78", [2, 1, 78]) && !claudeAtLeast("2.1.77", [2, 1, 78]) && !claudeAtLeast("1.9.999", [2, 1, 78]) && !claudeAtLeast(null, [2, 1, 78]));
  const { execFileSync } = await import("node:child_process");
  const cfg = team();
  const ada = cfg.team.find((a) => a.id === "ada")!;
  const clone = (name: string) => {
    const dir = join(tmp, name);
    mkdirSync(dir, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: dir });
    return dir;
  };
  const settings = (dir: string) => JSON.parse(readFileSync(join(dir, ".claude/settings.local.json"), "utf8"));

  const sb = clone("tel-sandbox");
  await adapters.claude.writeFiles(sb, { ...ada, mode: "sandbox" }, cfg, "tok");
  const s1 = settings(sb);
  ok("claude sandbox: StopFailure hook", !!s1.hooks.StopFailure?.[0]?.hooks?.[0]?.command.includes("/hook/ada/StopFailure"));
  ok("claude: usage to HQ over OTLP/HTTP JSON, metrics only", s1.env.CLAUDE_CODE_ENABLE_TELEMETRY === "1" && s1.env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL === "http/json" && s1.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT === "http://host.docker.internal:7420/otlp/ada/tok/v1/metrics" && !s1.env.OTEL_LOGS_EXPORTER);

  const old = clone("tel-old");
  await adapters.claude.writeFiles(old, { ...ada, mode: "local" }, cfg, "tok", { claudeVersion: "2.1.40 (Claude Code)" });
  ok("claude local, older version: no StopFailure (it could reject the file)", !settings(old).hooks.StopFailure);
  await adapters.claude.writeFiles(old, { ...ada, mode: "local" }, cfg, "tok", { claudeVersion: "2.1.90 (Claude Code)" });
  ok("claude local, newer version: StopFailure", !!settings(old).hooks.StopFailure);
  await adapters.claude.writeFiles(old, { ...ada, mode: "local" }, cfg, "tok", { claudeVersion: "2.1.40" });
  ok("claude: StopFailure removed again, without leaving an empty entry", !settings(old).hooks.StopFailure);

  const own = clone("tel-own");
  mkdirSync(join(own, ".claude"), { recursive: true });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(own, ".claude/settings.json"), JSON.stringify({ env: { OTEL_METRICS_EXPORTER: "otlp", OTEL_EXPORTER_OTLP_ENDPOINT: "https://corp" } }));
  await adapters.claude.writeFiles(own, { ...ada, mode: "sandbox" }, cfg, "tok");
  ok("claude: a project with its own telemetry is left alone", !settings(own).env);

  const g = geminiSettings({ ...ada, cli: "gemini" }, cfg, "tok", "/w");
  const tel = g.telemetry as Record<string, unknown>;
  ok("gemini: telemetry to HQ over HTTP, no prompts", tel.enabled === true && tel.otlpProtocol === "http" && tel.otlpEndpoint === "http://host.docker.internal:7420/otlp/ada/tok" && tel.logPrompts === false);
  const kept = geminiSettings({ ...ada, cli: "gemini" }, cfg, "tok", "/w", { telemetry: { enabled: true, otlpEndpoint: "https://corp:4317" } });
  ok("gemini: the project's own telemetry is kept", (kept.telemetry as Record<string, unknown>).otlpEndpoint === "https://corp:4317");
  ok("gemini: ours is replaced on rewrite (new token)", (geminiSettings({ ...ada, cli: "gemini" }, cfg, "tok2", "/w", g).telemetry as Record<string, unknown>).otlpEndpoint === "http://host.docker.internal:7420/otlp/ada/tok2");
  const toml = codexConfig({ ...ada, cli: "codex" }, cfg, "tok", "/w");
  ok("codex: [otel] log events to HQ as JSON, prompts off", /\[otel\]\nlog_user_prompt = false\nexporter = \{ otlp-http = \{ endpoint = "http:\/\/host\.docker\.internal:7420\/otlp\/ada\/tok\/v1\/logs", protocol = "json" \} \}/.test(toml), toml);
}

// ------------------------------------------------------------------ 8. config.yml, cleaning, the lead's role, tasks

{
  ok("budget: cleaned", JSON.stringify(cleanBudget({ usd: "12.345", period: "week" })) === '{"usd":12.35,"period":"week"}' && cleanBudget({ usd: 0 }) === null && cleanBudget({ usd: 5, period: "year" })?.period === "month" && cleanBudget(null) === null);
  const r = cleanRouting({ rules: [{ kind: " Research ", cli: "gemini", model: "pro" }, { kind: "research", cli: "codex" }, { kind: "x", cli: "llama" }, { kind: "", cli: "claude" }], fallback: [{ cli: "codex" }, { cli: "codex" }, { cli: "gemini", model: "flash" }] });
  ok("routing: one rule per kind, known models only, no repeats in fallback", JSON.stringify(r) === '{"rules":[{"kind":"research","cli":"gemini","model":"pro"}],"fallback":[{"cli":"codex"},{"cli":"gemini","model":"flash"}]}', r);
  ok("routing: empty cleans to nothing", Object.keys(cleanRouting({})).length === 0 && Object.keys(cleanRouting(null)).length === 0);

  const cfg = team();
  cfg.limits.budget = { usd: 50, period: "month" };
  cfg.team.find((a) => a.id === "ada")!.budget = { usd: 5, period: "day" };
  cfg.routing = { rules: [{ kind: "research", cli: "gemini", model: "pro" }], fallback: [{ cli: "codex" }] };
  cfg.prices = { "my-model": { input: 1, output: 2 } };
  const { yaml, files } = serializeConfig(cfg);
  ok("yaml: team and agent budgets", /limits:\n\s+maxAgents: 8\n\s+budget:\n\s+usd: 50\n\s+period: month/.test(yaml) && /id: ada[\s\S]*?budget:\n\s+usd: 5\n\s+period: day/.test(yaml), yaml);
  ok("yaml: routing and prices", /routing:\n\s+rules:\n\s+- kind: research\n\s+cli: gemini\n\s+model: pro\n\s+fallback:\n\s+- cli: codex/.test(yaml) && /prices:\n\s+my-model:/.test(yaml), yaml);
  const back = parseConfig(yaml, (rel) => files[rel] ?? null).config;
  ok("yaml: reads back the same", back.limits.budget?.usd === 50 && back.team.find((a: AgentConfig) => a.id === "ada")?.budget?.period === "day" && back.routing?.rules?.[0].kind === "research" && back.prices?.["my-model"].output === 2);
  ok("yaml: nothing written when unset", !/routing:|prices:|budget:/.test(serializeConfig(team()).yaml));
  throws("yaml: an unknown model in a rule is refused", () => parseConfig(yaml.replace("cli: gemini", "cli: llama"), (rel) => files[rel] ?? null), /routing/);
  throws("yaml: a negative budget is refused", () => parseConfig(yaml.replace("usd: 50", "usd: -5"), (rel) => files[rel] ?? null), /budget|usd/);

  ok("lead: told the kinds and their models", /Set a kind on each task \(create_task kind\) when one fits: research → Gemini \(pro\)/.test(roleMd(cfg.team[0], cfg)));
  ok("workers: not told", !/Set a kind on each task/.test(roleMd(cfg.team[1], cfg)));

  const { hub } = world(cfg);
  const planner = new Planner(hub, { push: () => {}, forget: () => {} } as never);
  const assigned: string[] = [];
  planner.onAssign = (id, t) => void assigned.push(`${id}:${t.kind ?? "-"}`);
  const t = planner.createTask({ title: "Find sources", kind: " Research " }, "maya");
  ok("task: kind saved, cleaned", t.kind === "research");
  planner.assign(t.id, "ada", "maya");
  ok("task: routing hears of the assignment, with the kind", assigned.join() === "ada:research");
  planner.updateTask(t.id, { kind: "" });
  ok("task: an empty kind removes it", !("kind" in planner.task(t.id)!));
}

rmSync(tmp, { recursive: true, force: true });
console.log(`usage-test: ${passed} checks passed`);
process.exit(0);
