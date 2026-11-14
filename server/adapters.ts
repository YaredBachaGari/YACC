// Runtime adapters (plan step 4.2). An agent program can join the team when its adapter can:
//   1. take injected instructions: the role, team and rules HQ generates (roleMd);
//   2. connect to an MCP server over HTTP: the Team MCP (`hq`), plus tools like Perplexity;
//   3. report turn start and stop: hooks POST to HQ as /hook/<agent>/<Event>, using HQ's event
//      names (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Notification, Stop,
//      SessionEnd), and at Stop accept {"decision":"block","reason":…} to continue with new messages;
//   4. launch inside a Docker Sandbox (`sbx run <agent>`) and on the host (Local mode).
// Everything else (state, delivery, the office) is shared. Per-program files are all git-excluded.

import { agentRead, agentWrite } from "./lib/agentFs";
import type { AgentCli, AgentConfig, HqConfig } from "../src/data/types";
import { DEEPSEEK_ANTHROPIC_URL, PERPLEXITY_MCP, PROVIDERS, authFor, mcpFor, modelFor, providerOf, runtimeOf } from "../src/data/models";
import { adoptRoleFile, excludeFromGit, HOOK_SCRIPT, hookCommand, hookScriptFor, hqUrl, isOurs, MCP_CONFIG, ROLE_FILE, roleMd, type RoleExtras, writeClaudeFiles, writeHookScript } from "./agentFiles";
import { run } from "./lib/exec";

export interface Launch {
  sbxAgent: string; // agent name for `sbx run`
  args: string[]; // the program's own arguments (not shell-quoted)
  /** `sbx run` flags before the agent name (e.g. a model provider). Sandbox mode only. */
  sbxArgs?: string[];
  /** Variables for the session. Local mode only: in a sandbox, sbx's proxy holds the keys. */
  env?: Record<string, string>;
}

export interface LaunchContext {
  cfg: HqConfig;
  /** Where Local-mode keys come from: the environment YACC was started from. */
  hostEnv: NodeJS.ProcessEnv;
}

export interface CliAdapter {
  /** Writes HQ's files into the agent's folder (all git-excluded). */
  writeFiles(dir: string, agent: AgentConfig, cfg: HqConfig, token: string, extras?: RoleExtras): Promise<void>;
  launch(agent: AgentConfig, ctx: LaunchContext): Launch;
}

/** In Local mode, a role tool like Perplexity is wired into the program itself, with its key from the environment. */
const localPerplexity = (agent: AgentConfig, cfg: HqConfig) => agent.mode === "local" && mcpFor(agent, cfg).includes(PERPLEXITY_MCP.name);

/** Local mode with an API key: hand the program the key YACC has (it may not be in tmux's environment). */
function localKeys(agent: AgentConfig, ctx: LaunchContext): Record<string, string> {
  if (agent.mode !== "local") return {};
  const env: Record<string, string> = {};
  const provider = providerOf(agent.cli);
  const names = provider === "google" ? ["GEMINI_API_KEY", "GOOGLE_API_KEY"] : provider === "deepseek" ? [] : [PROVIDERS[provider].keyEnv];
  if (authFor(ctx.cfg.providers, provider) === "api-key") for (const n of names) if (ctx.hostEnv[n]) env[n] = ctx.hostEnv[n]!;
  if (localPerplexity(agent, ctx.cfg) && ctx.hostEnv.PERPLEXITY_API_KEY) env.PERPLEXITY_API_KEY = ctx.hostEnv.PERPLEXITY_API_KEY;
  return env;
}

// ---------------------------------------------------------------- Claude Code

/** Claude Code's model flag: "Opus" / "Sonnet" / "Haiku" → its aliases; anything else is a full model id. */
function claudeModelArgs(agent: AgentConfig): string[] {
  const m = modelFor(agent);
  if (!m) return [];
  return ["--model", /^(opus|sonnet|haiku)$/i.test(m) ? m.toLowerCase() : m];
}

const claude: CliAdapter = {
  async writeFiles(dir, agent, cfg, token, extras = {}) {
    const ownRole = await adoptRoleFile(dir);
    writeClaudeFiles(dir, agent, cfg, token, { ...extras, ownRole }, { perplexity: localPerplexity(agent, cfg) });
  },
  launch(agent, ctx) {
    // The MCP config path is relative to the agent's folder, where it starts. An absolute path would be the
    // host's, and on Windows the folder has a different path inside the sandbox (C:\x on the host, /c/x in it).
    const env = localKeys(agent, ctx);
    return { sbxAgent: "claude", args: ["--mcp-config", MCP_CONFIG, ...claudeModelArgs(agent)], ...(Object.keys(env).length ? { env } : {}) };
  },
};

// ---------------------------------------------------------------- DeepSeek (Claude Code against DeepSeek's API)

const deepseek: CliAdapter = {
  writeFiles: claude.writeFiles,
  launch(agent, ctx) {
    const model = modelFor(agent);
    if (agent.mode === "sandbox")
      // Docker Sandboxes routes the sandbox's Claude Code to the "deepseek" provider HQ configured
      // (Settings → Models → DeepSeek), with the key from its secret store.
      return { sbxAgent: "claude", sbxArgs: ["--provider", "deepseek", "--model", model], args: ["--mcp-config", MCP_CONFIG] };
    // Local mode: point Claude Code at DeepSeek's Anthropic-compatible API (DeepSeek's documented setup).
    const fast = runtimeOf("deepseek").models.find((m) => /flash/.test(m.id))?.id ?? model;
    const env: Record<string, string> = {
      ANTHROPIC_BASE_URL: DEEPSEEK_ANTHROPIC_URL,
      ANTHROPIC_MODEL: model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: fast,
      CLAUDE_CODE_SUBAGENT_MODEL: fast,
      ...localKeys(agent, ctx),
    };
    if (ctx.hostEnv.DEEPSEEK_API_KEY) env.ANTHROPIC_AUTH_TOKEN = ctx.hostEnv.DEEPSEEK_API_KEY;
    return { sbxAgent: "claude", args: ["--mcp-config", MCP_CONFIG], env };
  },
};

// ---------------------------------------------------------------- Codex

export const CODEX_CONFIG = ".codex/config.toml";
const CODEX_EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "Stop", "SessionEnd"];

/** TOML basic string (JSON's escaping is valid TOML for these characters). */
const t = (s: string) => JSON.stringify(s);

export function codexConfig(agent: AgentConfig, cfg: HqConfig, token: string, dir: string, extras: RoleExtras = {}): string {
  const url = hqUrl(agent, cfg.project.hqPort);
  const script = hookScriptFor(agent, dir);
  const lines = [
    "# Written by YACC for this agent (git-excluded). Codex loads it once you trust this folder.",
    `developer_instructions = ${t(roleMd(agent, cfg, extras))}`,
    "",
    "[features]",
    "hooks = true",
    "",
    "[mcp_servers.hq]",
    `url = ${t(`${url}/mcp`)}`,
    `http_headers = { Authorization = ${t(`Bearer ${token}`)}, "X-HQ-Agent" = ${t(agent.id)} }`,
  ];
  if (localPerplexity(agent, cfg)) lines.push("", `[mcp_servers.${PERPLEXITY_MCP.name}]`, `url = ${t(PERPLEXITY_MCP.url)}`, 'bearer_token_env_var = "PERPLEXITY_API_KEY"');
  for (const event of CODEX_EVENTS)
    lines.push("", `[[hooks.${event}]]`, `[[hooks.${event}.hooks]]`, 'type = "command"', `command = ${t(hookCommand(url, token, agent.id, event, script))}`);
  return lines.join("\n") + "\n";
}

const codex: CliAdapter = {
  async writeFiles(dir, agent, cfg, token, extras = {}) {
    // A repo that commits its own Codex config can't take HQ's without changing a tracked file.
    const tracked = await run("git", ["ls-files", "--error-unmatch", CODEX_CONFIG], { cwd: dir });
    if (tracked.ok) throw new Error(`This repo commits ${CODEX_CONFIG}, so YACC can't add its Codex settings without changing a tracked file. Use another model for this agent, or remove that file from the repo.`);
    // The role goes in the config (developer_instructions); the folder's own ROLE.md is included, never overwritten.
    const ownRole = await adoptRoleFile(dir);
    agentWrite(dir, CODEX_CONFIG, codexConfig(agent, cfg, token, dir, { ...extras, ownRole }), { mode: 0o600 });
    if (hookScriptFor(agent, dir)) writeHookScript(dir);
    excludeFromGit(dir, [CODEX_CONFIG, HOOK_SCRIPT]);
  },
  launch(agent, ctx) {
    const model = modelFor(agent);
    const env = localKeys(agent, ctx);
    return { sbxAgent: "codex", args: model ? ["-m", model] : [], ...(Object.keys(env).length ? { env } : {}) };
  },
};

// ---------------------------------------------------------------- Gemini CLI

export const GEMINI_SETTINGS = ".gemini/settings.json";

/** Gemini CLI's hook events → HQ's. AfterAgent is the end of a turn, like Claude Code's Stop. */
export const GEMINI_EVENTS: Record<string, string> = {
  SessionStart: "SessionStart",
  BeforeAgent: "UserPromptSubmit",
  BeforeTool: "PreToolUse",
  AfterTool: "PostToolUse",
  Notification: "Notification",
  AfterAgent: "Stop",
  SessionEnd: "SessionEnd",
};

type GeminiHook = { name?: string; type: "command"; command: string; timeout?: number };
type GeminiHookEntry = { matcher?: string; hooks: GeminiHook[] };
type GeminiSettings = {
  context?: { fileName?: string | string[]; [k: string]: unknown };
  mcpServers?: Record<string, unknown>;
  hooks?: Record<string, GeminiHookEntry[] | unknown>;
  [k: string]: unknown;
};

/**
 * The project settings Gemini CLI reads from the agent's folder: the role as a context file (next to the
 * project's own GEMINI.md), the Team MCP, and hooks. Settings already in the file are kept.
 */
export function geminiSettings(agent: AgentConfig, cfg: HqConfig, token: string, dir: string, existing: GeminiSettings = {}): GeminiSettings {
  const url = hqUrl(agent, cfg.project.hqPort);
  const script = hookScriptFor(agent, dir);
  const names = existing.context?.fileName;
  const fileName = [...new Set([...(Array.isArray(names) ? names : names ? [names] : ["GEMINI.md"]), ROLE_FILE])];
  const mcpServers: Record<string, unknown> = {
    ...(existing.mcpServers ?? {}),
    hq: { httpUrl: `${url}/mcp`, headers: { Authorization: `Bearer ${token}`, "X-HQ-Agent": agent.id }, trust: true, description: "YACC team: tasks, messages, the CEO" },
  };
  if (localPerplexity(agent, cfg)) mcpServers[PERPLEXITY_MCP.name] = { httpUrl: PERPLEXITY_MCP.url, headers: { Authorization: "Bearer $PERPLEXITY_API_KEY" }, trust: true };
  const hooks: Record<string, unknown> = { ...(existing.hooks ?? {}) };
  for (const [native, ours] of Object.entries(GEMINI_EVENTS)) {
    const kept = (Array.isArray(hooks[native]) ? (hooks[native] as GeminiHookEntry[]) : [])
      .map((e) => ({ ...e, hooks: (e.hooks ?? []).filter((h) => !isOurs(h.command ?? "")) }))
      .filter((e) => e.hooks.length);
    // Gemini CLI's timeouts are in milliseconds.
    hooks[native] = [...kept, { matcher: "*", hooks: [{ name: "yacc", type: "command", command: hookCommand(url, token, agent.id, ours, script), timeout: 5000 }] }];
  }
  return { ...existing, context: { ...(existing.context ?? {}), fileName }, mcpServers, hooks };
}

const gemini: CliAdapter = {
  async writeFiles(dir, agent, cfg, token, extras = {}) {
    const tracked = await run("git", ["ls-files", "--error-unmatch", GEMINI_SETTINGS], { cwd: dir });
    if (tracked.ok) throw new Error(`This repo commits ${GEMINI_SETTINGS}, so YACC can't add its Gemini settings without changing a tracked file. Use another model for this agent, or remove that file from the repo.`);
    const ownRole = await adoptRoleFile(dir);
    agentWrite(dir, ROLE_FILE, roleMd(agent, cfg, { ...extras, ownRole }));
    let existing: GeminiSettings = {};
    try {
      existing = JSON.parse(agentRead(dir, GEMINI_SETTINGS) ?? "{}") as GeminiSettings;
    } catch {
      existing = {};
    }
    agentWrite(dir, GEMINI_SETTINGS, JSON.stringify(geminiSettings(agent, cfg, token, dir, existing), null, 2) + "\n", { mode: 0o600 });
    if (hookScriptFor(agent, dir)) writeHookScript(dir);
    excludeFromGit(dir, [ROLE_FILE, GEMINI_SETTINGS, HOOK_SCRIPT]);
  },
  launch(agent, ctx) {
    const model = modelFor(agent);
    const env = localKeys(agent, ctx);
    return { sbxAgent: "gemini", args: model ? ["--model", model] : [], ...(Object.keys(env).length ? { env } : {}) };
  },
};

export const adapters: Record<AgentCli, CliAdapter> = { claude, codex, gemini, deepseek };

/** The command a Local-mode agent runs on the host. */
export const localBinary = (cli: AgentCli): string => runtimeOf(cli).program;
