// The setup checklist: what this machine has, and how to fix what's missing.

import { existsSync, readFileSync } from "node:fs";
import { arch, cpus, homedir, platform, release, totalmem } from "node:os";
import { join } from "node:path";
import type { HqConfig, SetupCheck, SetupCheckId, SetupFix, SetupState } from "../src/data/types";
import { PROVIDERS, authFor, teamChecks } from "../src/data/models";
import { usesTmux } from "./backends";
import { parseCliJson, sandboxList } from "./lib/json";
import { has, refreshWindowsPath, run } from "./lib/exec";
import type { RepoInfo } from "./repo";

const SBX_DOCS = "https://docs.docker.com/ai/sandboxes/install/";
const os = platform();

type Check = Omit<SetupCheck, "fix"> & { fix: SetupFix | null };

const fix = (command: string, runnable: boolean, docs: string | null): SetupFix => ({ command, runnable, docs });

async function checkOs(): Promise<Check> {
  const base = { id: "os" as const, label: "Machine supports sandboxes", neededFor: "sandbox" as const, fix: fix("", false, SBX_DOCS) };
  if (os === "darwin") {
    const v = (await run("sw_vers", ["-productVersion"])).stdout.trim();
    const major = Number(v.split(".")[0]);
    if (arch() !== "arm64") return { ...base, status: "unsupported", detail: `macOS ${v} on Intel. Sandboxes need Apple silicon — use Local mode.` };
    if (major < 14) return { ...base, status: "unsupported", detail: `macOS ${v}. Sandboxes need macOS 14 (Sonoma) or later.` };
    return { ...base, status: "ok", detail: `macOS ${v} · Apple silicon`, fix: null };
  }
  if (os === "win32") {
    const build = Number(release().split(".")[2] ?? 0);
    return build >= 22000
      ? { ...base, status: "ok", detail: "Windows 11 (needs Windows Hypervisor Platform enabled)", fix: null }
      : { ...base, status: "unsupported", detail: "Windows 10. Sandboxes need Windows 11 — use Local mode." };
  }
  const osRelease = existsSync("/etc/os-release") ? readFileSync("/etc/os-release", "utf8") : "";
  const id = osRelease.match(/^ID=(.*)$/m)?.[1]?.replace(/"/g, "");
  const ver = Number(osRelease.match(/^VERSION_ID="?([\d.]+)/m)?.[1] ?? 0);
  if (id === "ubuntu" && ver >= 24.04) return { ...base, status: "ok", detail: `Ubuntu ${ver} (needs KVM)`, fix: null };
  return { ...base, status: "warning", detail: `${id ?? "Linux"} ${ver || ""} — Docker documents Ubuntu 24.04+ with KVM.` };
}

async function checkSbx(brew: boolean): Promise<Check> {
  const base = { id: "sbx" as const, label: "Docker Sandboxes (sbx)", neededFor: "sandbox" as const };
  const v = await run("sbx", ["version"], { timeoutMs: 8000 });
  if (v.ok) return { ...base, status: "ok", detail: v.stdout.trim().split(/\s+/)[2] ?? v.stdout.trim(), fix: null };
  const cmd =
    os === "darwin" ? "brew trust docker/tap && brew install docker/tap/sbx"
    : os === "win32" ? "winget install -h Docker.sbx"
    : "curl -fsSL https://get.docker.com | sudo SBX=1 sh";
  const runnable = os === "darwin" ? brew : os === "win32";
  return { ...base, status: "missing", detail: "Not installed.", fix: fix(cmd, runnable, SBX_DOCS) };
}

/** sbx's error when its base network policy was never chosen (fresh install). */
export const POLICY_NOT_INITIALIZED = /not been initialized|sbx policy init/i;

/**
 * `sbx policy check network <host>`: "allowed", "denied", or null when sbx gave no verdict.
 * Newer sbx (0.50+) may print the verdict on stderr and add terminal escape codes, so both
 * streams are read with the codes removed.
 */
export async function policyVerdict(host: string): Promise<{ verdict: "allowed" | "denied" | null; out: string }> {
  const r = await run("sbx", ["policy", "check", "network", host], { timeoutMs: 10_000 });
  // eslint-disable-next-line no-control-regex
  const out = `${r.stdout}\n${r.stderr}`.replace(/\x1b(\[[0-9;?]*[ -\/]*[@-~]|\][^\x07\x1b]*(\x07|\x1b\\)|[@-_])/g, "");
  const m = out.match(/\b(Allowed|Denied):/);
  return { verdict: m ? (m[1] === "Allowed" ? "allowed" : "denied") : null, out };
}

/**
 * A fresh sbx needs a base network policy (`sbx policy init`) before any rule
 * can be added or a sandbox started. HQ suggests one but never picks it.
 */
async function checkSbxPolicy(loginOk: boolean): Promise<Check> {
  const base = { id: "sbx-policy" as const, label: "Sandbox network policy", neededFor: "sandbox" as const };
  if (!loginOk) return { ...base, status: "missing", detail: "Waiting for Docker sign-in.", fix: null };
  const { verdict, out } = await policyVerdict("registry.npmjs.org");
  if (POLICY_NOT_INITIALIZED.test(out))
    return {
      ...base,
      status: "missing",
      detail:
        "Not set yet. Choose what sandboxes can reach once: balanced (recommended: AI services, package registries, GitHub), allow-all, or deny-all. Change it later with sbx policy reset.",
      fix: fix("sbx policy init balanced", true, SBX_DOCS),
    };
  if (!verdict) return { ...base, status: "warning", detail: out.trim().split("\n")[0] || "sbx did not respond.", fix: fix("sbx diagnose", true, SBX_DOCS) };
  const open = (await policyVerdict("hq-probe.invalid")).verdict === "allowed";
  const name = open ? "Allow all" : verdict === "allowed" ? "Balanced" : "Deny all";
  return { ...base, status: "ok", detail: `${name}. HQ adds only the rule that lets sandboxes reach it.`, fix: null };
}

async function checkSbxLogin(sbxOk: boolean): Promise<Check> {
  const base = { id: "sbx-login" as const, label: "Signed in to Docker", neededFor: "sandbox" as const };
  if (!sbxOk) return { ...base, status: "missing", detail: "Waiting for sbx.", fix: null };
  const r = await run("sbx", ["ls", "--json"], { timeoutMs: 10_000 });
  const list = r.ok ? sandboxList<unknown>(r.stdout) : null;
  // The command worked, so you're signed in; an unreadable list only loses the count (never block Start on it).
  if (r.ok) {
    const n = list?.length;
    return { ...base, status: "ok", detail: n === undefined ? "Signed in" : `Signed in · ${n} sandbox${n === 1 ? "" : "es"} on this machine`, fix: null };
  }
  const msg = (r.stderr || r.stdout).trim();
  const loggedOut = /log ?in|sign ?in|unauthori[sz]ed|not authenticated/i.test(msg);
  return {
    ...base,
    status: loggedOut ? "missing" : "warning",
    detail: loggedOut ? "Not signed in. Sign-in opens your browser." : msg.split("\n")[0] || "sbx did not respond.",
    fix: fix(loggedOut ? "sbx login" : "sbx diagnose", true, SBX_DOCS),
  };
}

async function checkTmux(brew: boolean): Promise<Check> {
  const base = { id: "tmux" as const, label: "tmux (keeps agents running if HQ closes)", neededFor: "all" as const };
  if (!usesTmux())
    return { ...base, label: "Agent sessions", status: "ok", detail: "HQ runs agents itself on Windows (no tmux needed). They stop when HQ stops; sandboxes and folders are kept.", fix: null };
  const v = await run("tmux", ["-V"], { timeoutMs: 5000 });
  if (v.ok) return { ...base, status: "ok", detail: v.stdout.trim(), fix: null };
  if (os === "win32") return { ...base, status: "unsupported", detail: "tmux needs WSL on Windows. Run HQ inside WSL.", fix: fix("wsl --install", false, "https://learn.microsoft.com/windows/wsl/install") };
  return {
    ...base,
    status: "missing",
    detail: "Not installed.",
    fix: os === "darwin" ? fix("brew install tmux", brew, "https://github.com/tmux/tmux/wiki/Installing") : fix("sudo apt install tmux", false, "https://github.com/tmux/tmux/wiki/Installing"),
  };
}

async function checkClaude(): Promise<Check> {
  const base = { id: "claude" as const, label: "Claude Code (for Local mode)", neededFor: "local" as const };
  const v = await run("claude", ["--version"], { timeoutMs: 8000 });
  if (v.ok) return { ...base, status: "ok", detail: v.stdout.trim(), fix: null };
  return {
    ...base,
    status: "missing",
    detail: "Not installed. Only needed for agents in Local mode.",
    fix: fix(os === "win32" ? "irm https://claude.ai/install.ps1 | iex" : "curl -fsSL https://claude.ai/install.sh | bash", false, "https://docs.claude.com/en/docs/claude-code/setup"),
  };
}

async function checkGh(brew: boolean): Promise<Check> {
  const base = { id: "gh" as const, label: "GitHub CLI (reads PRs and reviews)", neededFor: "github" as const };
  if (!(await has("gh")))
    return {
      ...base,
      status: "missing",
      detail: "Not installed.",
      fix: fix(os === "darwin" ? "brew install gh" : os === "win32" ? "winget install --id GitHub.cli" : "sudo apt install gh", os === "darwin" ? brew : os === "win32", "https://cli.github.com"),
    };
  const r = await run("gh", ["auth", "status"], { timeoutMs: 10_000 });
  const out = r.stdout + r.stderr;
  if (r.ok) return { ...base, status: "ok", detail: `Signed in as ${out.match(/account (\S+)/)?.[1] ?? "you"}`, fix: null };
  return { ...base, status: "missing", detail: "Not signed in.", fix: fix("gh auth login", true, "https://cli.github.com/manual/gh_auth_login") };
}

function checkRemote(repo: RepoInfo): Check {
  const base = { id: "gh-remote" as const, label: "GitHub remote", neededFor: "github" as const };
  if (repo.github) return { ...base, status: "ok", detail: repo.github, fix: null };
  return {
    ...base,
    status: "warning",
    detail: repo.originUrl ? `origin is ${repo.originUrl} (not GitHub)` : "No origin remote. Agents can't push or open PRs.",
    fix: fix("gh repo create --source . --private --push", false, "https://cli.github.com/manual/gh_repo_create"),
  };
}

async function checkGithubSecret(sbxOk: boolean, ghSignedIn: boolean): Promise<Check> {
  const base = { id: "github-secret" as const, label: "GitHub access inside sandboxes", neededFor: "sandbox" as const };
  if (!sbxOk) return { ...base, status: "missing", detail: "Waiting for sbx.", fix: null };
  const r = await run("sbx", ["secret", "ls"], { timeoutMs: 10_000 });
  if (r.ok && /\bgithub\b/.test(r.stdout)) return { ...base, status: "ok", detail: "Stored in Docker's secret store; injected by the proxy.", fix: null };
  // The command below reads the token from the GitHub CLI: without a signed-in gh it fails with "verify command failed".
  if (!ghSignedIn) return { ...base, status: "missing", detail: "Waiting for the GitHub CLI: install it and sign in (below) first. This step reads your token from it.", fix: null };
  return {
    ...base,
    status: "missing",
    detail: "Agents can't push or open PRs until this is set.",
    fix: fix("sbx secret set github --command 'gh auth token'", true, "https://docs.docker.com/ai/sandboxes/get-started/"),
  };
}

async function checkCodex(): Promise<Check> {
  const base = { id: "codex" as const, label: "Codex (for Codex agents in Local mode)", neededFor: "local" as const };
  const v = await run("codex", ["--version"], { timeoutMs: 8000 });
  if (v.ok) return { ...base, status: "ok", detail: v.stdout.trim(), fix: null };
  return { ...base, status: "missing", detail: "Not installed. Only needed for Codex agents in Local mode (sandboxes have it).", fix: fix("npm install -g @openai/codex", false, "https://developers.openai.com/codex/cli") };
}

/** Service secrets stored for every sandbox (`sbx secret ls`), or null when sbx can't say. */
async function globalSecrets(sbxOk: boolean): Promise<Set<string> | null> {
  if (!sbxOk) return null;
  const r = await run("sbx", ["secret", "ls", "--json"], { timeoutMs: 10_000 });
  try {
    const list = parseCliJson<{ secrets?: { name: string; scope: string }[] }>(r.stdout)?.secrets;
    return list ? new Set(list.filter((s) => s.scope === "global").map((s) => s.name)) : null;
  } catch {
    return null;
  }
}

const SBX_CREDENTIALS = "https://docs.docker.com/ai/sandboxes/configuration/credentials/";

/** A key (or sign-in) in Docker Sandboxes' secret store, which its proxy adds to the provider's requests. */
function checkSecret(id: SetupCheckId, label: string, service: string, secrets: Set<string> | null, why: string, command: string, alsoOk = false): Check {
  const base = { id, label, neededFor: "sandbox" as const };
  if (!secrets && !alsoOk) return { ...base, status: "missing", detail: "Waiting for sbx.", fix: null };
  if (secrets?.has(service) || alsoOk) return { ...base, status: "ok", detail: "Stored in Docker's secret store; the proxy adds it, so it never enters a sandbox.", fix: null };
  return { ...base, status: "missing", detail: why, fix: fix(command, true, SBX_CREDENTIALS) };
}

/** A key in the environment YACC was started from (Local mode: the program reads it there). */
function checkEnv(id: SetupCheckId, label: string, vars: string[], keyUrl: string): Check {
  const base = { id, label, neededFor: "local" as const };
  const found = vars.find((v) => process.env[v]?.trim());
  if (found) return { ...base, status: "ok", detail: `${found} is set.`, fix: null };
  const set = os === "win32" ? `setx ${vars[0]} "<your key>"` : `export ${vars[0]}="<your key>"`;
  return {
    ...base,
    status: "missing",
    detail: `Set ${vars.join(" or ")} where YACC starts (your shell profile${os === "win32" ? " or user environment variables" : ""}), then restart YACC. The key isn't saved in config.yml.`,
    fix: fix(set, false, keyUrl),
  };
}

async function checkGemini(): Promise<Check> {
  const base = { id: "gemini" as const, label: "Gemini CLI (for Gemini agents in Local mode)", neededFor: "local" as const };
  const v = await run("gemini", ["--version"], { timeoutMs: 15_000 });
  if (v.ok) return { ...base, status: "ok", detail: v.stdout.trim().split("\n")[0], fix: null };
  return { ...base, status: "missing", detail: "Not installed. Only needed for Gemini agents in Local mode (sandboxes have it).", fix: fix("npm install -g @google/gemini-cli", true, "https://github.com/google-gemini/gemini-cli") };
}

/** Sign in with Google is stored by Gemini CLI itself; a warning, since the agent's own terminal asks too. */
function checkGeminiLogin(): Check {
  const base = { id: "gemini-login" as const, label: "Gemini CLI signed in with Google", neededFor: "local" as const };
  if (existsSync(join(homedir(), ".gemini", "oauth_creds.json"))) return { ...base, status: "ok", detail: "Signed in.", fix: null };
  return { ...base, status: "warning", detail: "Run `gemini` once in a terminal and choose Sign in with Google, or answer the sign-in in the agent's terminal when it starts.", fix: fix("gemini", false, "https://github.com/google-gemini/gemini-cli#-authentication-options") };
}

/** DeepSeek is a custom model provider in Docker Sandboxes (model selection is experimental there). */
async function checkDeepseekProvider(sbxOk: boolean): Promise<Check> {
  const base = { id: "deepseek-provider" as const, label: "DeepSeek set up in Docker Sandboxes", neededFor: "sandbox" as const };
  if (!sbxOk) return { ...base, status: "missing", detail: "Waiting for sbx.", fix: null };
  const [feature, providers] = await Promise.all([
    run("sbx", ["settings", "get", "feature.model"], { timeoutMs: 10_000 }),
    run("sbx", ["settings", "get", "model.providers"], { timeoutMs: 10_000 }),
  ]);
  const on = /\btrue\b/i.test(feature.stdout);
  const has = /"deepseek"\s*:/.test(providers.stdout);
  if (on && has) return { ...base, status: "ok", detail: "Sandboxes reach DeepSeek's API through Docker's model provider.", fix: null };
  return {
    ...base,
    status: "missing",
    detail: `${on ? "" : "Turns on model selection (experimental in sbx) and "}adds DeepSeek as a model provider. Other providers you set are kept.`,
    fix: fix("sbx settings set feature.model true && sbx settings set model.providers '{\"deepseek\":…}'", true, "https://docs.docker.com/ai/sandboxes/configuration/models/"),
  };
}

/**
 * `cfg` decides the model checks: each agent's model, mode and sign-in (models.ts → requiredChecks), so the
 * list shows only what this team needs. `github` false leaves out GitHub (work is files, not pull requests).
 */
export async function runSetupChecks(repo: RepoInfo, cfg: Pick<HqConfig, "team" | "roles" | "providers"> = { team: [], roles: [] }, github = true): Promise<SetupState> {
  // So "Check again" sees a tool that was installed while HQ was running (Windows keeps the old PATH otherwise).
  await refreshWindowsPath();
  const brew = os === "darwin" && (await has("brew"));
  const [osCheck, sbx, tmux, claude, gh] = await Promise.all([checkOs(), checkSbx(brew), checkTmux(brew), checkClaude(), checkGh(brew)]);
  const sbxOk = sbx.status === "ok";
  const [login, secret] = await Promise.all([checkSbxLogin(sbxOk), checkGithubSecret(sbxOk, gh.status === "ok")]);
  const policy = await checkSbxPolicy(login.status === "ok");
  const checks: SetupCheck[] = github ? [osCheck, sbx, login, policy, secret, tmux, claude, gh, checkRemote(repo)] : [osCheck, sbx, login, policy, tmux, claude];
  // What the team's models need: sign-ins and keys for sandboxes go right after the sandbox checks.
  const want = new Set(teamChecks(cfg));
  const secrets = [...want].some((c) => c.endsWith("-secret")) ? await globalSecrets(sbxOk) : null;
  const openaiKey = authFor(cfg.providers, "openai") === "api-key";
  const sandboxChecks: Check[] = [];
  if (want.has("anthropic-secret")) sandboxChecks.push(checkSecret("anthropic-secret", "Anthropic API key for Claude agents", "anthropic", secrets, "Claude agents use an API key (Settings → Models). Paste it when asked.", "sbx secret set anthropic"));
  if (want.has("openai-secret"))
    sandboxChecks.push(
      openaiKey
        ? checkSecret("openai-secret", "OpenAI API key for Codex agents", "openai", secrets, "Codex agents use an API key (Settings → Models). Paste it when asked.", "sbx secret set openai")
        : checkSecret("openai-secret", "OpenAI sign-in for Codex agents", "openai", secrets, "Codex agents can't sign in until this is set. Opens your browser to sign in with ChatGPT.", "sbx secret set openai --oauth"),
    );
  if (want.has("google-secret")) sandboxChecks.push(checkSecret("google-secret", "Gemini API key for Gemini agents", "google", secrets, "Gemini agents in sandboxes need a Google AI Studio key. Paste it when asked.", "sbx secret set google"));
  if (want.has("deepseek-provider")) sandboxChecks.push(await checkDeepseekProvider(sbxOk));
  if (want.has("deepseek-secret"))
    sandboxChecks.push(checkSecret("deepseek-secret", "DeepSeek API key", "deepseek", secrets, "DeepSeek agents need an API key. Paste it when asked.", "sbx secret set deepseek", !!process.env.DEEPSEEK_API_KEY?.trim()));
  checks.splice(5, 0, ...sandboxChecks);
  if (want.has("codex")) checks.push(await checkCodex());
  if (want.has("gemini")) checks.push(await checkGemini());
  if (want.has("gemini-login")) checks.push(checkGeminiLogin());
  const env: [SetupCheckId, string, string[], string][] = [
    ["anthropic-env", "Anthropic API key (Local mode)", ["ANTHROPIC_API_KEY"], PROVIDERS.anthropic.keyUrl],
    ["openai-env", "OpenAI API key (Local mode)", ["OPENAI_API_KEY"], PROVIDERS.openai.keyUrl],
    ["google-env", "Gemini API key (Local mode)", ["GEMINI_API_KEY", "GOOGLE_API_KEY"], PROVIDERS.google.keyUrl],
    ["deepseek-env", "DeepSeek API key (Local mode)", ["DEEPSEEK_API_KEY"], PROVIDERS.deepseek.keyUrl],
    ["perplexity-env", "Perplexity API key (Local mode)", ["PERPLEXITY_API_KEY"], PROVIDERS.perplexity.keyUrl],
  ];
  for (const [id, label, vars, url] of env) if (want.has(id)) checks.push(checkEnv(id, label, vars, url));
  const ok = (c: SetupCheck) => c.status === "ok";
  return {
    machine: { cpus: cpus().length, memoryGb: Math.round(totalmem() / 1024 ** 3), persistentAgents: usesTmux() },
    checks,
    sandboxReady: osCheck.status !== "unsupported" && ok(sbx) && ok(login) && ok(policy) && ok(tmux),
    localReady: ok(tmux) && ok(claude),
    checkedAt: new Date().toISOString(),
  };
}
