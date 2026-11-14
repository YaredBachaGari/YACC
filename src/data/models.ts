// The model catalog (plan step 4.1): providers, how each is signed in to, the runtime (agent
// program) each model runs in, and suggested model names. Shared by the server (launching,
// setup checks), the browser (Settings) and the tests.
//
// Model names are suggestions for the picker; any name the program accepts can be typed.

import type { AgentCli, AgentConfig, AuthMode, HqConfig, ProviderId, ProvidersConfig, SetupCheckId } from "./types";

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

/** MCP servers an agent gets: its own picks plus its role's tools. */
export function mcpFor(agent: AgentConfig, cfg: Pick<HqConfig, "roles">): string[] {
  const role = cfg.roles.find((r) => r.id === agent.roleId);
  return [...new Set([...(agent.mcp ?? []), ...(role?.tools ?? [])])];
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

/** Every check the team needs, in a stable order. */
export function teamChecks(cfg: Pick<HqConfig, "team" | "roles" | "providers">): SetupCheckId[] {
  const all = new Set<SetupCheckId>();
  for (const a of cfg.team) for (const c of requiredChecks(a, cfg)) all.add(c);
  return [...all];
}
