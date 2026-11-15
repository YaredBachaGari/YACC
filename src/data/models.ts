// The model catalog (plan step 4.1): providers, how each is signed in to, the runtime (agent
// program) each model runs in, and suggested model names. Shared by the server (launching,
// setup checks), the browser (Settings) and the tests.
//
// Model names are suggestions for the picker; any name the program accepts can be typed.

import { toolkitMcpFor } from "./toolkits";
import type { AgentCli, AgentConfig, AuthMode, Budget, BudgetPeriod, HqConfig, ModelPick, ModelPrice, ProviderId, ProvidersConfig, RoutingConfig, RoutingRule, SetupCheckId } from "./types";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** Sign-in modes it offers. API-only providers have just "api-key". */
  auth: AuthMode[];
  defaultAuth: AuthMode;
  /** Environment variable that holds the key (Local mode, and where the program reads it). */
  keyEnv: string;
  /** Where to get a key. */
  keyUrl: string;
  /** What a subscription means here, for Settings. */
  subscriptionNote?: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    auth: ["subscription", "api-key"],
    defaultAuth: "subscription",
    keyEnv: "ANTHROPIC_API_KEY",
    keyUrl: "https://console.anthropic.com/settings/keys",
    subscriptionNote: "Claude Pro or Max: each agent signs in to Claude Code the first time it starts.",
  },
  openai: {
    id: "openai",
    label: "OpenAI (Codex)",
    auth: ["subscription", "api-key"],
    defaultAuth: "subscription",
    keyEnv: "OPENAI_API_KEY",
    keyUrl: "https://platform.openai.com/api-keys",
    subscriptionNote: "ChatGPT Plus, Pro or Business: sign in once for every sandbox on this machine.",
  },
  google: {
    id: "google",
    label: "Google (Gemini)",
    auth: ["subscription", "api-key"],
    defaultAuth: "api-key",
    keyEnv: "GEMINI_API_KEY",
    keyUrl: "https://aistudio.google.com/apikey",
    subscriptionNote: "Sign in with Google (free tier, Google AI Pro or Ultra). Local mode only: sandboxes need an API key.",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    auth: ["api-key"],
    defaultAuth: "api-key",
    keyEnv: "DEEPSEEK_API_KEY",
    keyUrl: "https://platform.deepseek.com/api_keys",
  },
  perplexity: {
    id: "perplexity",
    label: "Perplexity (research tool)",
    auth: ["api-key"],
    defaultAuth: "api-key",
    keyEnv: "PERPLEXITY_API_KEY",
    keyUrl: "https://www.perplexity.ai/account/api/group",
  },
};

export interface ModelChoice {
  id: string; // what is passed to the program; "" = the program's default
  label: string;
}

/** The agent program each choice runs in. */
export type Program = "claude" | "codex" | "gemini";

export interface RuntimeInfo {
  id: AgentCli;
  label: string;
  provider: ProviderId;
  program: Program;
  /** Agent name for `sbx run`. */
  sbxAgent: string;
  models: ModelChoice[];
  /** Used when the agent's model is empty and the program has no default of its own for this provider. */
  defaultModel: string;
}

export const RUNTIMES: Record<AgentCli, RuntimeInfo> = {
  claude: {
    id: "claude",
    label: "Claude",
    provider: "anthropic",
    program: "claude",
    sbxAgent: "claude",
    models: [
      { id: "", label: "Default" },
      { id: "opus", label: "Opus" },
      { id: "sonnet", label: "Sonnet" },
      { id: "haiku", label: "Haiku" },
    ],
    defaultModel: "",
  },
  codex: {
    id: "codex",
    label: "OpenAI",
    provider: "openai",
    program: "codex",
    sbxAgent: "codex",
    models: [
      { id: "", label: "Default" },
      { id: "gpt-5.5", label: "GPT-5.5" },
      { id: "gpt-5.4", label: "GPT-5.4" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 mini" },
      { id: "gpt-5-codex", label: "GPT-5-Codex" },
    ],
    defaultModel: "",
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    provider: "google",
    program: "gemini",
    sbxAgent: "gemini",
    models: [
      { id: "", label: "Auto" },
      { id: "pro", label: "Pro" },
      { id: "flash", label: "Flash" },
      { id: "flash-lite", label: "Flash-Lite" },
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)" },
      { id: "gemini-3-flash-preview", label: "Gemini 3 Flash (preview)" },
    ],
    defaultModel: "",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    provider: "deepseek",
    program: "claude",
    sbxAgent: "claude",
    models: [
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
    ],
    defaultModel: "deepseek-v4-pro",
  },
};

/** DeepSeek's Anthropic-compatible API (Claude Code talks to it directly in Local mode). */
export const DEEPSEEK_ANTHROPIC_URL = "https://api.deepseek.com/anthropic";
/**
 * The custom provider HQ adds to Docker Sandboxes (`sbx settings set model.providers`) so a sandboxed
 * Claude Code reaches DeepSeek. sbx appends `/messages` to an Anthropic-wire URL.
 */
export const DEEPSEEK_SBX_PROVIDER = { url: `${DEEPSEEK_ANTHROPIC_URL}/v1`, wire: "anthropic", apiKeyEnv: "DEEPSEEK_API_KEY", name: "DeepSeek" } as const;

/** Perplexity's hosted MCP server (search, ask, research). Its key goes to sbx's secret store. */
export const PERPLEXITY_MCP = { name: "perplexity", url: "https://api.perplexity.ai/mcp" } as const;

export const runtimeOf = (cli: AgentCli): RuntimeInfo => RUNTIMES[cli] ?? RUNTIMES.claude;
export const providerOf = (cli: AgentCli): ProviderId => runtimeOf(cli).provider;

/** The sign-in mode in effect for a provider: the configured one if the provider offers it, else its default. */
export function authFor(providers: ProvidersConfig | undefined, provider: ProviderId): AuthMode {
  const info = PROVIDERS[provider];
  const set = providers?.[provider]?.auth;
  return set && info.auth.includes(set) ? set : info.defaultAuth;
}

/** The model to start with: the agent's, or the runtime's default (DeepSeek needs one). */
export function modelFor(agent: Pick<AgentConfig, "cli" | "model">): string {
  const m = agent.model.trim();
  return m && !/^default$/i.test(m) ? m : runtimeOf(agent.cli).defaultModel;
}

/** MCP servers an agent gets: its own picks, its role's tools and its toolkits'. */
export function mcpFor(agent: AgentConfig, cfg: Pick<HqConfig, "roles"> & Partial<Pick<HqConfig, "toolkits">>): string[] {
  const role = cfg.roles.find((r) => r.id === agent.roleId);
  return [...new Set([...(agent.mcp ?? []), ...(role?.tools ?? []), ...toolkitMcpFor(agent, cfg)])];
}

/**
 * Why this agent can't run as set up, before any check runs (a combination that can't work), or null.
 * Sign in with Google needs a browser on your machine, so sandboxes take a Gemini API key.
 */
export function unsupportedReason(agent: Pick<AgentConfig, "cli" | "mode" | "name">, providers: ProvidersConfig | undefined): string | null {
  if (agent.cli === "gemini" && agent.mode === "sandbox" && authFor(providers, "google") === "subscription")
    return `${agent.name} runs Gemini in a sandbox, which needs an API key: Sign in with Google works in Local mode only. Change Google to API key in Settings → Models, or switch ${agent.name} to Local mode.`;
  return null;
}

/**
 * Setup checks an agent needs to pass before it can start (the adapter contract's "can it sign in").
 * The checklist shows exactly these, for the agents on the team.
 */
export function requiredChecks(agent: AgentConfig, cfg: Pick<HqConfig, "roles" | "providers">): SetupCheckId[] {
  const auth = authFor(cfg.providers, providerOf(agent.cli));
  const out: SetupCheckId[] = [];
  if (agent.mode === "sandbox") {
    if (agent.cli === "claude" && auth === "api-key") out.push("anthropic-secret");
    if (agent.cli === "codex") out.push("openai-secret");
    if (agent.cli === "gemini") out.push("google-secret");
    if (agent.cli === "deepseek") out.push("deepseek-provider", "deepseek-secret");
  } else {
    const program = runtimeOf(agent.cli).program;
    out.push(program);
    if (agent.cli === "claude" && auth === "api-key") out.push("anthropic-env");
    if (agent.cli === "codex" && auth === "api-key") out.push("openai-env");
    if (agent.cli === "gemini") out.push(auth === "api-key" ? "google-env" : "gemini-login");
    if (agent.cli === "deepseek") out.push("deepseek-env");
    // A sandbox reaches Perplexity through sbx's MCP gateway; Local mode needs the key itself.
    if (mcpFor(agent, cfg).includes(PERPLEXITY_MCP.name)) out.push("perplexity-env");
  }
  return out;
}

/** Every check the team needs, in a stable order: its own models, and those routing or a fallback can switch to. */
export function teamChecks(cfg: Pick<HqConfig, "team" | "roles" | "providers"> & Partial<Pick<HqConfig, "routing">>): SetupCheckId[] {
  const all = new Set<SetupCheckId>();
  const picks = [...(cfg.routing?.rules ?? []), ...(cfg.routing?.fallback ?? [])];
  for (const a of cfg.team) {
    for (const c of requiredChecks(a, cfg)) all.add(c);
    for (const p of picks) if (!unsupportedReason(withModel(a, p), cfg.providers)) for (const c of requiredChecks(withModel(a, p), cfg)) all.add(c);
  }
  return [...all];
}

// ---------------------------------------------------------------- Prices (plan step 4.4)

/**
 * API prices per million tokens (US dollars, November 2026), for estimates. Matched against the model
 * name a program reports, most specific first. Claude Code reports its own cost, which is used instead.
 * On a subscription these are what the same work would cost on the API, not what you pay.
 * Your own prices go in config.yml `prices:`.
 */
export const PRICES: { match: RegExp; price: ModelPrice }[] = [
  { match: /deepseek.*flash/i, price: { input: 0.14, output: 0.28, cacheRead: 0.0028 } },
  { match: /deepseek/i, price: { input: 0.435, output: 0.87, cacheRead: 0.003625 } },
  { match: /gemini.*flash-lite|^flash-lite$/i, price: { input: 0.25, output: 1.5, cacheRead: 0.025 } },
  { match: /gemini.*flash|^flash$/i, price: { input: 0.5, output: 3, cacheRead: 0.05 } },
  { match: /gemini.*pro|^pro$/i, price: { input: 2, output: 12, cacheRead: 0.2 } },
  { match: /gpt-5\.\d+-mini|gpt-5-mini/i, price: { input: 0.75, output: 4.5, cacheRead: 0.075 } },
  { match: /gpt-5\.5/i, price: { input: 5, output: 30, cacheRead: 0.5 } },
  { match: /gpt-5/i, price: { input: 2.5, output: 15, cacheRead: 0.25 } },
  { match: /opus/i, price: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 } },
  { match: /sonnet/i, price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  { match: /haiku/i, price: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 } },
];

/** The price for a model name: yours from config.yml first (a key that is the name or part of it), then YACC's. */
export function priceFor(model: string, overrides?: Record<string, ModelPrice>): ModelPrice | null {
  const m = model.trim();
  if (!m) return null;
  for (const [key, price] of Object.entries(overrides ?? {})) if (key && m.toLowerCase().includes(key.toLowerCase())) return price;
  return PRICES.find((p) => p.match.test(m))?.price ?? null;
}

export interface TokenCounts {
  input: number; // not counting cached input
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Estimated cost of some tokens, or null when the model's price is unknown. */
export function costOf(t: TokenCounts, model: string, overrides?: Record<string, ModelPrice>): number | null {
  const p = priceFor(model, overrides);
  if (!p) return null;
  const per = 1_000_000;
  return (t.input * p.input + t.output * p.output + t.cacheRead * (p.cacheRead ?? p.input * 0.1) + t.cacheWrite * (p.cacheWrite ?? p.input * 1.25)) / per;
}

// ---------------------------------------------------------------- Routing and fallback (plan step 4.8)

const same = (a: ModelPick, b: Pick<AgentConfig, "cli" | "model">) => a.cli === b.cli && (a.model ?? "").trim() === b.model.trim();

/** The model a routing rule gives tasks of this kind, or null (the agent keeps its own). */
export function routeFor(kind: string | undefined, cfg: Pick<HqConfig, "routing">): ModelPick | null {
  const k = kind?.trim().toLowerCase();
  if (!k) return null;
  return cfg.routing?.rules?.find((r) => r.kind.trim().toLowerCase() === k) ?? null;
}

/** Kinds of work the routing rules know, for the lead and the task editor. */
export const routingKinds = (cfg: Pick<HqConfig, "routing">): string[] => [...new Set((cfg.routing?.rules ?? []).map((r) => r.kind.trim().toLowerCase()).filter(Boolean))];

/**
 * The first fallback model this agent can switch to when `limited` (its provider, or a list of providers
 * at their limits) stops it: another provider, not limited, that can run here (`canRun`).
 */
export function fallbackFor(
  agent: AgentConfig,
  cfg: Pick<HqConfig, "routing">,
  limited: ProviderId[],
  canRun: (pick: ModelPick) => boolean,
): ModelPick | null {
  for (const pick of cfg.routing?.fallback ?? []) {
    if (limited.includes(providerOf(pick.cli))) continue;
    if (same(pick, agent)) continue;
    if (canRun(pick)) return pick;
  }
  return null;
}

/** An agent as it runs with a different model (routing or fallback). */
export const withModel = (agent: AgentConfig, pick: ModelPick): AgentConfig => ({ ...agent, cli: pick.cli, model: pick.model?.trim() ?? "" });

export const describePick = (pick: ModelPick) => `${RUNTIMES[pick.cli]?.label ?? pick.cli}${pick.model?.trim() ? ` (${pick.model.trim()})` : ""}`;

// ---------------------------------------------------------------- Usage limits

/**
 * What each program prints when its provider stops it at a usage limit or for billing. Only the
 * programs' own wording, so an agent writing about rate limits isn't mistaken for one. "Approaching"
 * warnings and "continuing with usage credits" aren't limits.
 */
export const LIMIT_PATTERNS: Record<Program, RegExp> = {
  claude:
    /Claude usage limit reached|\b(?:5-hour|session|weekly|Opus|Sonnet|Fable|usage) limit (?:reached|hit)\b(?![^\n]*continuing with)|You['’]ve (?:hit|reached) your (?:session|weekly|5-hour|usage|Opus|Sonnet|Fable)[\w -]*limit|Credit balance is too low|Insufficient Balance/i,
  codex: /You['’]ve (?:hit|reached) your usage limit|exceeded your (?:daily )?usage limit|You exceeded your current quota/i,
  gemini: /Usage limit reached for|exhausted your daily quota|You exceeded your current quota|Quota exceeded for metric/i,
};

/** The limit line on a program's screen and when it says it resets, or null. */
export function detectLimit(program: Program, screen: string): { line: string; resets: string | null } | null {
  for (const raw of screen.split("\n").reverse()) {
    const line = raw.trim();
    if (!line || /approaching/i.test(line) || /continuing with usage credits|now using credits/i.test(line)) continue;
    if (!LIMIT_PATTERNS[program].test(line)) continue;
    const r = /resets? (?:at |on )?([^·•∙().\n]{2,40})|try again (?:at|in|after) ([^.\n]{2,40})/i.exec(line);
    const resets = (r?.[1] ?? r?.[2])?.trim().replace(/[\s,]+$/, "") ?? null;
    return { line: line.slice(0, 200), resets };
  }
  return null;
}

// ---------------------------------------------------------------- cleaning settings (Settings and config.yml)

const CLIS: readonly AgentCli[] = ["claude", "codex", "gemini", "deepseek"];
const PERIODS: readonly BudgetPeriod[] = ["day", "week", "month"];

/** A budget from Settings or config.yml, or null when it's empty or not a budget. Up to $1,000,000. */
export function cleanBudget(v: unknown): Budget | null {
  if (!v || typeof v !== "object") return null;
  const b = v as Partial<Budget>;
  const usd = Number(b.usd);
  if (!Number.isFinite(usd) || usd <= 0) return null;
  const period = PERIODS.find((p) => p === b.period) ?? "month";
  return { usd: Math.min(Math.round(usd * 100) / 100, 1_000_000), period };
}

function cleanPick(v: unknown): ModelPick | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Partial<ModelPick>;
  const cli = CLIS.find((c) => c === p.cli);
  if (!cli) return null;
  const model = typeof p.model === "string" ? p.model.trim().slice(0, 80) : "";
  return model ? { cli, model } : { cli };
}

/** Routing rules (one per kind, lowercase) and a fallback list (no repeats), from Settings or config.yml. */
export function cleanRouting(v: unknown): RoutingConfig {
  const r = (v && typeof v === "object" ? v : {}) as RoutingConfig;
  const rules: RoutingRule[] = [];
  for (const raw of (Array.isArray(r.rules) ? r.rules : []).slice(0, 30)) {
    const pick = cleanPick(raw);
    const kind = typeof raw?.kind === "string" ? raw.kind.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40) : "";
    if (pick && kind && !rules.some((x) => x.kind === kind)) rules.push({ kind, ...pick });
  }
  const fallback: ModelPick[] = [];
  for (const raw of (Array.isArray(r.fallback) ? r.fallback : []).slice(0, 8)) {
    const pick = cleanPick(raw);
    if (pick && !fallback.some((x) => x.cli === pick.cli && (x.model ?? "") === (pick.model ?? ""))) fallback.push(pick);
  }
  return { ...(rules.length ? { rules } : {}), ...(fallback.length ? { fallback } : {}) };
}
