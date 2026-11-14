// Models and runtimes (Phase 4 part 1): the catalog, sign-in per provider, the Gemini and DeepSeek
// adapters, setup checks per agent, Perplexity as a role tool, and the YAML for all of it.
// No agents, sandboxes or network needed.
//
//   npx tsx scripts/models-test.ts

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adapters, codexConfig, GEMINI_EVENTS, GEMINI_SETTINGS, geminiSettings, localBinary } from "../server/adapters";
import { MCP_CONFIG, ROLE_FILE, roleMd } from "../server/agentFiles";
import { envLines, sessionEnvFile, shellCommand } from "../server/backends/tmux";
import { makeCommands } from "../server/commands";
import { Hub } from "../server/hub";
import { parseProviders } from "../server/sessions";
import type { RepoInfo } from "../server/repo";
import { newAgent, parseConfig, serializeConfig } from "../server/store";
import { DEEPSEEK_ANTHROPIC_URL, DEEPSEEK_SBX_PROVIDER, PERPLEXITY_MCP, PROVIDERS, RUNTIMES, authFor, mcpFor, modelFor, providerOf, requiredChecks, teamChecks, unsupportedReason } from "../src/data/models";
import { defaultAutonomy, defaultRoles, normalizeConfig } from "../src/data/roles";
import { defaultWorkflowParts } from "../src/data/workflow";
import { AGENT_CLIS, CLI_LABEL, LEAD_ROLE_ID, type AgentCli, type AgentConfig, type HqConfig, type SetupState } from "../src/data/types";

const tmp = mkdtempSync(join(tmpdir(), "yacc-models-"));
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

function team(): HqConfig {
  const lead = newAgent("maya", "Maya", LEAD_ROLE_ID, "#ff77a8");
  const ada = newAgent("ada", "Ada", "developer", "#29adff", "maya");
  const cfg: HqConfig = {
    project: { id: "p", name: "P", repo: "acme/p", path: tmp, hqPort: 7420 },
    ceo: { name: "Abuti" },
    limits: { maxAgents: 8 },
    autonomy: defaultAutonomy(),
    roles: defaultRoles(),
    team: [lead, ada],
    workflow: {
      ...defaultWorkflowParts(true),
      review: { enabled: true, tool: "human", command: "" },
      merge: { by: "human" },
      deploy: { enabled: false, tool: "custom", command: "", perAgentEnvironments: false },
    },
  };
  normalizeConfig(cfg);
  return cfg;
}
const agentWith = (cfg: HqConfig, id: string, patch: Partial<AgentConfig>) => Object.assign(cfg.team.find((a) => a.id === id)!, patch);

// ------------------------------------------------------------------ 1. the catalog

ok("catalog: every model choice has a runtime and a label", AGENT_CLIS.every((c) => RUNTIMES[c]?.id === c && CLI_LABEL[c]));
ok("catalog: providers", providerOf("claude") === "anthropic" && providerOf("codex") === "openai" && providerOf("gemini") === "google" && providerOf("deepseek") === "deepseek");
ok("catalog: DeepSeek runs in Claude Code", RUNTIMES.deepseek.program === "claude" && localBinary("deepseek") === "claude" && localBinary("gemini") === "gemini");
ok("catalog: API-only providers", PROVIDERS.deepseek.auth.join() === "api-key" && PROVIDERS.perplexity.auth.join() === "api-key");
ok("auth: defaults", authFor(undefined, "anthropic") === "subscription" && authFor(undefined, "openai") === "subscription" && authFor(undefined, "google") === "api-key");
ok("auth: a set choice wins", authFor({ anthropic: { auth: "api-key" } }, "anthropic") === "api-key");
ok("auth: a provider without sign-in stays on its key", authFor({ deepseek: { auth: "subscription" } }, "deepseek") === "api-key");
ok("model: DeepSeek has a default, others leave it to the program", modelFor({ cli: "deepseek", model: "" }) === "deepseek-v4-pro" && modelFor({ cli: "gemini", model: " " }) === "" && modelFor({ cli: "claude", model: "default" }) === "");
ok("model: an agent's own wins", modelFor({ cli: "deepseek", model: "deepseek-v4-flash" }) === "deepseek-v4-flash");

// ------------------------------------------------------------------ 2. setup checks per agent

{
  const cfg = team();
  const ada = cfg.team[1];
  const req = (patch: Partial<AgentConfig>) => requiredChecks(Object.assign(ada, patch), cfg).join();
  ok("checks: Claude in a sandbox on your subscription needs nothing more", req({ cli: "claude", mode: "sandbox" }) === "");
  cfg.providers = { anthropic: { auth: "api-key" } };
  ok("checks: Claude with an API key needs it in sbx", req({ cli: "claude", mode: "sandbox" }) === "anthropic-secret");
  ok("checks: …or in the environment in Local mode", req({ cli: "claude", mode: "local" }) === "claude,anthropic-env");
  cfg.providers = {};
  ok("checks: Codex in a sandbox", req({ cli: "codex", mode: "sandbox" }) === "openai-secret");
  ok("checks: Codex locally", req({ cli: "codex", mode: "local" }) === "codex");
  ok("checks: Gemini in a sandbox", req({ cli: "gemini", mode: "sandbox" }) === "google-secret");
  ok("checks: Gemini locally with a key", req({ cli: "gemini", mode: "local" }) === "gemini,google-env");
  cfg.providers = { google: { auth: "subscription" } };
  ok("checks: Gemini locally with Google sign-in", req({ cli: "gemini", mode: "local" }) === "gemini,gemini-login");
  ok("unsupported: Google sign-in in a sandbox is refused, and says what to do", /Local mode only/.test(unsupportedReason({ ...ada, cli: "gemini", mode: "sandbox" }, cfg.providers) ?? ""));
  ok("unsupported: the same agent in Local mode is fine", unsupportedReason({ ...ada, cli: "gemini", mode: "local" }, cfg.providers) === null);
  ok("checks: DeepSeek in a sandbox", req({ cli: "deepseek", mode: "sandbox" }) === "deepseek-provider,deepseek-secret");
  ok("checks: DeepSeek locally", req({ cli: "deepseek", mode: "local" }) === "claude,deepseek-env");
  cfg.roles.find((r) => r.id === "developer")!.tools = ["perplexity"];
  ok("checks: a local agent with Perplexity needs its key", req({ cli: "claude", mode: "local" }).endsWith("perplexity-env"));
  ok("checks: a sandboxed one gets it through sbx's gateway", !req({ cli: "claude", mode: "sandbox" }).includes("perplexity"));
  ok("checks: the team's list has each check once", new Set(teamChecks(cfg)).size === teamChecks(cfg).length);
}

// ------------------------------------------------------------------ 3. launching

{
  const cfg = team();
  const ada = cfg.team[1];
  const launch = (cli: AgentCli, mode: "sandbox" | "local", model = "", hostEnv: NodeJS.ProcessEnv = {}) => adapters[cli].launch(Object.assign(ada, { cli, mode, model }), { cfg, hostEnv });

  let l = launch("claude", "sandbox", "Opus");
  ok("claude: team MCP config and the model alias", l.sbxAgent === "claude" && l.args.join(" ") === `--mcp-config ${MCP_CONFIG} --model opus` && !l.env && !l.sbxArgs);
  cfg.providers = { anthropic: { auth: "api-key" } };
  l = launch("claude", "local", "", { ANTHROPIC_API_KEY: "sk-ant", OTHER: "x" });
  ok("claude local with a key: hands over only that key", l.env?.ANTHROPIC_API_KEY === "sk-ant" && Object.keys(l.env ?? {}).length === 1);
  ok("claude in a sandbox never gets a key in its env", !launch("claude", "sandbox", "", { ANTHROPIC_API_KEY: "sk-ant" }).env);
  cfg.providers = {};
  ok("claude local on a subscription: no key passed", !launch("claude", "local", "", { ANTHROPIC_API_KEY: "sk-ant" }).env);

  l = launch("codex", "sandbox", "gpt-5.5");
  ok("codex: model flag", l.sbxAgent === "codex" && l.args.join(" ") === "-m gpt-5.5");

  l = launch("gemini", "sandbox", "pro");
  ok("gemini: sbx agent and model flag", l.sbxAgent === "gemini" && l.args.join(" ") === "--model pro" && !l.env);
  ok("gemini: no model means Gemini's own Auto", launch("gemini", "sandbox").args.length === 0);
  l = launch("gemini", "local", "", { GEMINI_API_KEY: "g-key" });
  ok("gemini local with a key", l.env?.GEMINI_API_KEY === "g-key");

  l = launch("deepseek", "sandbox");
  ok("deepseek sandbox: Claude Code through sbx's deepseek provider", l.sbxAgent === "claude" && l.sbxArgs?.join(" ") === "--provider deepseek --model deepseek-v4-pro" && l.args.join(" ") === `--mcp-config ${MCP_CONFIG}` && !l.env);
  l = launch("deepseek", "local", "deepseek-v4-flash", { DEEPSEEK_API_KEY: "ds-key" });
  ok("deepseek local: Claude Code pointed at DeepSeek's API", l.env?.ANTHROPIC_BASE_URL === DEEPSEEK_ANTHROPIC_URL && l.env?.ANTHROPIC_AUTH_TOKEN === "ds-key" && l.env?.ANTHROPIC_MODEL === "deepseek-v4-flash");
  ok("deepseek local: small and subagent work on Flash", l.env?.ANTHROPIC_DEFAULT_HAIKU_MODEL === "deepseek-v4-flash" && l.env?.CLAUDE_CODE_SUBAGENT_MODEL === "deepseek-v4-flash");
  ok("deepseek local: no key, no token (the setup check says what's missing)", !launch("deepseek", "local").env?.ANTHROPIC_AUTH_TOKEN);
  ok("deepseek: the sbx provider uses the Anthropic wire format", DEEPSEEK_SBX_PROVIDER.wire === "anthropic" && DEEPSEEK_SBX_PROVIDER.url === `${DEEPSEEK_ANTHROPIC_URL}/v1`);

  cfg.roles.find((r) => r.id === "developer")!.tools = ["perplexity"];
  l = launch("codex", "local", "", { PERPLEXITY_API_KEY: "pplx" });
  ok("perplexity local: its key reaches the session", l.env?.PERPLEXITY_API_KEY === "pplx");
}

// ------------------------------------------------------------------ 4. Gemini's settings

{
  const cfg = team();
  const ada = Object.assign(cfg.team[1], { cli: "gemini" as AgentCli, mode: "sandbox" as const });
  const user = { theme: "Dracula", context: { fileName: "AGENTS.md" }, hooks: { BeforeTool: [{ matcher: "write_file", hooks: [{ type: "command", command: "./scan.sh" }] }] }, mcpServers: { mine: { command: "x" } } };
  const s = geminiSettings(ada, cfg, "tok", "/w", user as never);
  const files = s.context?.fileName as string[];
  ok("gemini: the role is a context file, beside the project's own", files.includes(ROLE_FILE) && files.includes("AGENTS.md"));
  ok("gemini: without one set, GEMINI.md still loads", (geminiSettings(ada, cfg, "tok", "/w").context?.fileName as string[]).join() === `GEMINI.md,${ROLE_FILE}`);
  const hq = (s.mcpServers as Record<string, { httpUrl: string; headers: Record<string, string>; trust: boolean }>).hq;
  ok("gemini: Team MCP over HTTP, trusted, with this agent's identity", hq.httpUrl === "http://host.docker.internal:7420/mcp" && hq.headers.Authorization === "Bearer tok" && hq.headers["X-HQ-Agent"] === "ada" && hq.trust);
  ok("gemini: the user's own settings and servers stay", s.theme === "Dracula" && !!(s.mcpServers as Record<string, unknown>).mine);
  const hooks = s.hooks as Record<string, { matcher?: string; hooks: { command: string; timeout?: number }[] }[]>;
  for (const [native, ours] of Object.entries(GEMINI_EVENTS))
    ok(`gemini: ${native} reports as ${ours}`, new RegExp(`/hook/ada/${ours}['\\s]`).test(hooks[native].at(-1)!.hooks[0].command) && hooks[native].at(-1)!.hooks[0].timeout === 5000);
  ok("gemini: the end of a turn prints HQ's reply (queued messages continue the turn)", !hooks.AfterAgent.at(-1)!.hooks[0].command.includes(">/dev/null 2>&1"));
  ok("gemini: the user's hooks are kept", hooks.BeforeTool[0].hooks[0].command === "./scan.sh");
  const again = geminiSettings(ada, cfg, "tok2", "/w", s);
  ok("gemini: rewriting replaces ours, never doubles them", (again.hooks as typeof hooks).AfterAgent.length === 1 && (again.hooks as typeof hooks).BeforeTool.length === 2 && (again.context?.fileName as string[]).filter((f) => f === ROLE_FILE).length === 1);
  ok("gemini: perplexity only in Local mode", !(s.mcpServers as Record<string, unknown>).perplexity);
  cfg.roles.find((r) => r.id === "developer")!.tools = ["perplexity"];
  ada.mode = "local";
  const local = geminiSettings(ada, cfg, "tok", "/w").mcpServers as Record<string, { httpUrl: string; headers: Record<string, string> }>;
  ok("gemini local: Perplexity with its key from the environment", local.perplexity.httpUrl === PERPLEXITY_MCP.url && local.perplexity.headers.Authorization === "Bearer $PERPLEXITY_API_KEY");
  ok("gemini local: HQ on localhost", local.hq.httpUrl === "http://127.0.0.1:7420/mcp");
}

// ------------------------------------------------------------------ 5. files in a real clone

const git = (dir: string, ...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" }).toString();
const clone = (name: string) => {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  return dir;
};

await (async () => {
  const cfg = team();
  const ada = Object.assign(cfg.team[1], { cli: "gemini" as AgentCli, mode: "sandbox" as const });
  const dir = clone("gem");
  await adapters.gemini.writeFiles(dir, ada, cfg, "tok");
  ok("gemini files: role and settings written", existsSync(join(dir, ROLE_FILE)) && JSON.parse(readFileSync(join(dir, GEMINI_SETTINGS), "utf8")).mcpServers.hq);
  ok("gemini files: the role is the generated one", readFileSync(join(dir, ROLE_FILE), "utf8").includes("# Ada"));
  const exclude = readFileSync(join(dir, ".git/info/exclude"), "utf8");
  ok("gemini files: git-excluded", exclude.includes(GEMINI_SETTINGS) && exclude.includes(ROLE_FILE));
  ok("gemini files: nothing shows up as a change", git(dir, "status", "--porcelain").trim() === "");

  const tracked = clone("gem-tracked");
  mkdirSync(join(tracked, ".gemini"));
  writeFileSync(join(tracked, GEMINI_SETTINGS), "{}");
  git(tracked, "add", ".");
  let refused = "";
  try {
    await adapters.gemini.writeFiles(tracked, ada, cfg, "tok");
  } catch (err) {
    refused = String(err);
  }
  ok("gemini files: a repo that commits .gemini/settings.json is left alone", /commits \.gemini\/settings\.json/.test(refused));

  cfg.roles.find((r) => r.id === "developer")!.tools = ["perplexity"];
  const cl = clone("claude-local");
  Object.assign(ada, { cli: "claude", mode: "local" });
  await adapters.claude.writeFiles(cl, ada, cfg, "tok");
  const mcp = JSON.parse(readFileSync(join(cl, MCP_CONFIG), "utf8")).mcpServers;
  ok("claude local: Perplexity in its MCP config, key from the environment", mcp.perplexity?.url === PERPLEXITY_MCP.url && mcp.perplexity.headers.Authorization === "Bearer ${PERPLEXITY_API_KEY}");
  const settings = JSON.parse(readFileSync(join(cl, ".claude/settings.local.json"), "utf8"));
  ok("claude: Perplexity's tools need no permission prompt", settings.permissions.allow.includes("mcp__perplexity"));
  ok("codex local: Perplexity reads its key from the environment", /\[mcp_servers\.perplexity\][\s\S]*bearer_token_env_var = "PERPLEXITY_API_KEY"/.test(codexConfig({ ...ada, cli: "codex" }, cfg, "tok", cl)));
  ok("role file: agents are told about the research tool", /perplexity_research/.test(roleMd(ada, cfg)));
  ok("role file: agents without it aren't", !/perplexity_research/.test(roleMd(cfg.team[0], cfg)));
  ok("mcp: an agent's servers plus its role's tools, once each", mcpFor({ ...ada, mcp: ["supabase", "perplexity"] }, cfg).join() === "supabase,perplexity");
})();

// ------------------------------------------------------------------ 6. config.yml

{
  const cfg = team();
  agentWith(cfg, "ada", { cli: "deepseek", model: "deepseek-v4-flash", mode: "local" });
  cfg.team.push(Object.assign(newAgent("gus", "Gus", "developer", "#00e436", "maya"), { cli: "gemini" as AgentCli }));
  cfg.providers = { google: { auth: "subscription" }, anthropic: { auth: "api-key" } };
  const dev = cfg.roles.find((r) => r.id === "developer")!;
  Object.assign(dev, { cli: "gemini", model: "flash", tools: ["perplexity"] });
  normalizeConfig(cfg);
  const { yaml, files } = serializeConfig(cfg);
  ok("yaml: providers saved, with no keys", /providers:\n\s+google:\n\s+auth: subscription/.test(yaml) && !/sk-|api_key|apiKey/i.test(yaml), yaml);
  ok("yaml: role default model and tools", /developer:[\s\S]*?cli: gemini[\s\S]*?model: flash[\s\S]*?tools:\n\s+- perplexity/.test(yaml), yaml);
  const back = parseConfig(yaml, (rel) => files[rel] ?? null).config;
  ok("yaml: reads back the same", back.providers?.google?.auth === "subscription" && back.team.find((a) => a.id === "ada")?.cli === "deepseek" && back.team.find((a) => a.id === "gus")?.cli === "gemini");
  ok("yaml: role tools read back", back.roles.find((r) => r.id === "developer")?.tools?.join() === "perplexity");
  ok("yaml: no providers section when nothing was chosen", !/providers:/.test(serializeConfig(team()).yaml));
  throws("yaml: an unknown model is refused", () => parseConfig(yaml.replace("cli: deepseek", "cli: llama"), (rel) => files[rel] ?? null), /cli/);
  throws("yaml: an unknown sign-in is refused", () => parseConfig(yaml.replace("auth: subscription", "auth: password"), (rel) => files[rel] ?? null), /providers/);
  throws("yaml: an unknown provider is refused", () => parseConfig(yaml.replace("  google:\n", "  googel:\n"), (rel) => files[rel] ?? null), /providers/);
}

// ------------------------------------------------------------------ 7. Settings → Models (commands)

{
  const root = join(tmp, "cmds");
  mkdirSync(join(root, ".yacc"), { recursive: true });
  const repo: RepoInfo = { root, name: "cmds", originUrl: null, github: null, hasCodeRabbit: false, hasInsta: false };
  const config = team();
  config.project.path = root;
  const setup = { machine: { cpus: 4, memoryGb: 8 }, checks: [], sandboxReady: false, localReady: true, checkedAt: "" } as SetupState;
  const hub = new Hub(repo, "cmds", config, { boards: [{ id: "B1", title: "Backlog", status: "active", order: 0 }], tasks: [] }, setup);
  const synced: string[] = [];
  let rechecks = 0;
  const stub = {} as never;
  const cmds = makeCommands(hub, { recheckSetup: async () => void rechecks++ } as never, stub, stub, { syncRole: async (id: string) => void synced.push(id) } as never, stub, { briefings: stub, memory: stub });
  const cfg = () => hub.snap.config;

  cmds.setProviderAuth("google", "subscription");
  ok("provider auth: saved, and the checklist is re-run", cfg().providers?.google?.auth === "subscription" && rechecks === 1);
  cmds.setProviderAuth("deepseek", "subscription");
  ok("provider auth: DeepSeek has no sign-in, so it stays on its key", !cfg().providers?.deepseek);
  cmds.setProviderAuth("nobody" as never, "api-key");
  ok("provider auth: unknown providers are ignored", !("nobody" in (cfg().providers ?? {})));
  ok("provider auth: written to config.yml", /google:\n\s+auth: subscription/.test(readFileSync(join(root, ".yacc", "config.yml"), "utf8")));

  cmds.updateRole("developer", { tools: ["Perplexity", "perplexity", " "] });
  ok("role tools: cleaned and saved", cfg().roles.find((r) => r.id === "developer")?.tools?.join() === "perplexity");
  ok("role tools: running agents with the role get the new tool", synced.join() === "developer");
  cmds.updateRole("developer", { tools: [] });
  ok("role tools: emptied removes the key", cfg().roles.find((r) => r.id === "developer")?.tools === undefined);
  cmds.updateRole("developer", { cli: "deepseek", model: "deepseek-v4-flash" });
  ok("role default: any model choice", cfg().roles.find((r) => r.id === "developer")?.cli === "deepseek");
  cmds.updateAgent("ada", { cli: "gemini" });
  ok("agent: can switch to Gemini (and the model is cleared)", hub.cfg("ada")?.cli === "gemini" && hub.cfg("ada")?.model === "");
  cmds.updateAgent("ada", { cli: "llama" as never });
  ok("agent: an unknown model is ignored", hub.cfg("ada")?.cli === "gemini");
}

// ------------------------------------------------------------------ 8. launching in tmux, and sbx's providers

{
  ok("env lines: names and values as given", envLines({ A: "1", B_2: "x y" }) === "A=1\nB_2=x y\n");
  ok("env lines: bad names and multi-line values are dropped", envLines({ "1A": "x", C: "a\nb", D: "ok" }) === "D=ok\n");
  const cmd = shellCommand({ file: "claude", args: ["--model", "opus"], envFile: "/app.env" }, "/hq.env");
  ok("tmux: HQ's variables load first, then the app's, then the program", cmd.indexOf("/hq.env") < cmd.indexOf("/app.env") && cmd.endsWith("claude --model opus"));
  ok("tmux: no key on the command line", !shellCommand({ file: "claude", args: [], envFile: null, env: { ANTHROPIC_AUTH_TOKEN: "secret" } }, "/hq.env").includes("secret"));
  ok("tmux: one env file per session", sessionEnvFile("yacc-p-ada") !== sessionEnvFile("yacc-p-gus") && sessionEnvFile("a/b").endsWith("yacc-a_b.env"));
  ok("sbx providers: parsed from settings output", (parseProviders('model.providers = {"company":{"url":"https://x/v1","wire":"openai"}}') as Record<string, unknown>).company !== undefined);
  ok("sbx providers: nothing set reads as empty", Object.keys(parseProviders("")).length === 0 && Object.keys(parseProviders("null")).length === 0 && Object.keys(parseProviders("{oops")).length === 0);
}

rmSync(tmp, { recursive: true, force: true });
console.log(`models-test: ${passed} checks passed`);
process.exit(0);
