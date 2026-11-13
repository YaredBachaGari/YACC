// The files HQ writes into each agent's folder. All of them are listed in the
// clone's .git/info/exclude, so they are never committed.

import { lstatSync } from "node:fs";
import { agentRead, agentRemove, agentWrite } from "./lib/agentFs";
import { run } from "./lib/exec";
import { join } from "node:path";
import { stackRoleMd } from "../src/data/stack";
import { CEO_ID, type AgentConfig, type HqConfig } from "../src/data/types";
import { can, managerName, roleOf, toolsFor } from "../src/data/roles";

/** Team MCP config, passed with `claude --mcp-config` (so the project's own .mcp.json is untouched). */
export const MCP_CONFIG = ".claude/hq-mcp.json";
/** Local mode on Windows: hooks run this with node (no sh or curl there). */
export const HOOK_SCRIPT = ".yacc-hook.mjs";
/** HQ's generated role file. Its own name, so a ROLE.md the project has is never overwritten. */
export const ROLE_FILE = ".yacc-role.md";
export const HQ_FILES = [ROLE_FILE, ".claude/settings.local.json", MCP_CONFIG, HOOK_SCRIPT];

/** Extra context for the generated role: the folder's own ROLE.md, and whether app variables are set. */
export interface RoleExtras {
  ownRole?: string | null;
  hasEnvFile?: boolean;
}

/** HQ ≤ 0.3 wrote its role to ROLE.md; recognise that so it can be cleaned up. */
const isHqRole = (text: string) => text.includes("## Team MCP (server `hq`)") && text.includes("You are managed by YACC.");

/**
 * The folder's own ROLE.md, if it has one (it's included in the generated role). A ROLE.md that an
 * older HQ generated there is removed, along with the exclude line HQ added for it.
 */
export async function adoptRoleFile(dir: string): Promise<string | null> {
  const text = agentRead(dir, "ROLE.md");
  if (text === null) return null;
  if (!isHqRole(text)) return text.slice(0, 20_000);
  const tracked = await run("git", ["ls-files", "--error-unmatch", "ROLE.md"], { cwd: dir });
  if (!tracked.ok) {
    agentRemove(dir, "ROLE.md");
    removeFromExclude(dir, ["ROLE.md"]);
  }
  return null;
}
export const MARK = "# yacc-hook";
/** Same marker for node hook commands (cmd and PowerShell have no `#` comments). */
const MARK_ARG = "--yacc-hook";
const isOurs = (command: string) => command.includes(MARK) || command.includes(MARK_ARG);

/**
 * Hooks run where the agent runs. Sandboxes are Linux, so they use sh + curl;
 * a Local-mode agent on Windows uses the node script instead.
 * HQ_NODE_HOOKS=1 forces the script (to test it on macOS/Linux).
 */
export function hookScriptFor(agent: AgentConfig, dir: string): string | null {
  if (agent.mode !== "local" || (process.platform !== "win32" && process.env.HQ_NODE_HOOKS !== "1")) return null;
  return join(dir, HOOK_SCRIPT).replace(/\\/g, "/");
}

const HOOK_SCRIPT_SOURCE = `// Written by YACC (git-excluded). Sends this agent's hook events to HQ.
// Usage: node .yacc-hook.mjs <url> <token> [--print-reply] | --print-role
import { readFileSync } from "node:fs";

const args = process.argv.slice(2).filter((a) => a !== "${MARK_ARG}");
if (args[0] === "--print-role") {
  try {
    process.stdout.write(readFileSync(new URL("./${ROLE_FILE}", import.meta.url), "utf8"));
  } catch {}
  process.exit(0);
}
const [url, token, print] = args;
let body = "";
let sent = false;
const send = async () => {
  if (sent) return;
  sent = true;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: body || "{}",
      signal: AbortSignal.timeout(4000),
    });
    // Stop: HQ's reply ({"decision":"block",...}) hands over queued messages.
    if (print === "--print-reply" && res.ok) process.stdout.write(await res.text());
  } catch {}
  process.exit(0);
};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (body += d));
process.stdin.on("end", send);
setTimeout(send, 2000).unref();
`;

export function writeHookScript(dir: string) {
  agentWrite(dir, HOOK_SCRIPT, HOOK_SCRIPT_SOURCE);
}

// PostToolUse: the moment a question or permission prompt is answered, the tool completes.
const HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Notification", "Stop", "SessionEnd"] as const;

/** URL agents use to reach HQ: through the sandbox proxy, or straight to localhost. */
export function hqUrl(agent: AgentConfig, port: number): string {
  return agent.mode === "sandbox" ? `http://host.docker.internal:${port}` : `http://127.0.0.1:${port}`;
}

/**
 * The role file an agent reads at session start. HQ only assembles it: what the role does comes
 * from the role's instructions (.yacc/roles/<id>.md), the agent's own note, and the settings.
 * The rules added here are the ones that hold for any team: how to reach the CEO and how HQ works.
 */
export function roleMd(agent: AgentConfig, cfg: HqConfig, extras: RoleExtras = {}): string {
  const role = roleOf(cfg, agent);
  const title = role?.title ?? agent.role;
  const ceo = cfg.ceo.name;
  const team = [
    `- ${ceo} — CEO (the human). Everyone can ask the CEO directly with ask_user.`,
    ...cfg.team.map((a) => `- ${a.name} — ${a.role}${a.isLead ? " (lead)" : ""}${a.temporary ? ", temporary" : ""}; reports to ${managerName(cfg, a)}${a.id === agent.id ? " ← you" : ""}`),
  ].join("\n");
  const rules: string[] = [];
  // Who merges is a workflow setting, so it can't live in the lead's instructions file.
  if (agent.isLead && cfg.project.repo.includes("/"))
    rules.push(
      cfg.workflow.merge.by === "lead"
        ? "You merge PRs once they pass review (`gh pr merge <number> --squash --delete-branch`), one at a time, in an order that avoids conflicts. HQ tells you when each one passes."
        : "The user merges PRs; never merge one yourself. Decide the order they should land in, and tell the user if one blocks another.",
      "If the user changes who merges, HQ tells you. Follow the latest message.",
    );
  if (can(cfg, agent, "assign")) rules.push("Assign only to agents that are running and free (check list_workers).");
  // How tasks arrive and are reported is the same for every role; a role that already spells it out isn't told twice.
  if (can(cfg, agent, "work") && !/get_my_task/.test(role?.instructions ?? ""))
    rules.push(
      "When HQ tells you to start a task, call get_my_task first. Work only on that task.",
      "Report with set_my_status: in-review when your output is ready to be checked, blocked (with the reason) when you can't continue, done when it is finished. The lead is told automatically.",
    );
  rules.push(
    "You can message any teammate with send_message, whatever the reporting lines.",
    "When you need the CEO to approve or decide something, or to do something outside your sandbox (create an account, database or API key, change a setting in a dashboard, put a value in your env file), call ask_user with a short title and clear steps, then keep working on what you can. You don't need to go through the lead for this. Never put secret values in it; name the variable instead. Variables reach you through HQ: ask the user to add NAME to your App variables in HQ (Settings → Sandbox → App variables) and restart you; there is no env file inside your sandbox to edit.",
  );
  // Sandboxes block most sites; the agent asks instead of working around it.
  if (agent.mode === "sandbox")
    rules.push(
      "Your sandbox blocks most websites and APIs. If a request you need is blocked (a docs page or an API: usually a 403 saying 'Approval required for <host>'), call request_access with the domain and why, then continue with other work until HQ tells you it was answered. Never work around the block.",
    );
  const limits = can(cfg, agent, "hire") ? [`Headcount limit set by the CEO: ${cfg.limits.maxAgents} agents (the team has ${cfg.team.length}).`, ""] : [];
  return [
    `# ${agent.name} — ${title}`,
    "",
    `You are ${agent.name}, ${agent.isLead ? "the lead" : `${/^[aeiou]/i.test(title) ? "an" : "a"} ${title}`} on the ${cfg.project.name} team. You report to ${managerName(cfg, agent)}${agent.reportsTo === CEO_ID ? ", the CEO (the human)" : ""}.`,
    "",
    ...(role?.instructions.trim() ? [`## Your role: ${title}`, role.instructions.trim(), ""] : []),
    ...(agent.roleMd.trim() ? ["## Notes for you", agent.roleMd.trim(), ""] : []),
    "## Team",
    team,
    "",
    ...limits,
    "## How HQ works",
    ...rules.map((r) => `- ${r}`),
    "",
    ...(stackRoleMd(cfg.stack) ? [stackRoleMd(cfg.stack), ""] : []),
    ...(extras.hasEnvFile
      ? [
          "## App variables",
          "Your session already has this project's app variables (from HQ's env file) as environment variables. There is no .env file for them. See the names with `printenv | cut -d= -f1`; never print or commit the values. Code reads them from the environment as usual. Don't create a .env file with them unless the user asks.",
          "",
        ]
      : []),
    ...(extras.ownRole?.trim() ? ["## From ROLE.md in this folder", extras.ownRole.trim(), ""] : []),
    "## Team MCP (server `hq`)",
    `Your tools: ${toolsFor(role).join(", ")}.`,
    "Messages that start with `[HQ]` come from YACC: assignments from the lead, or messages from teammates. Act on them.",
    "Teammates work in their own sandboxes and cannot see your files or terminal. Talk to them only with send_message.",
    "",
    `Project: ${cfg.project.name} (${cfg.project.repo}). You are managed by YACC.`,
    "",
  ].join("\n");
}

type HookEntry = { matcher?: string; hooks: { type: "command"; command: string; timeout?: number }[] };
type Settings = { hooks?: Record<string, HookEntry[]>; permissions?: { allow?: string[]; [k: string]: unknown }; [k: string]: unknown };

export function hookCommand(url: string, token: string, agentId: string, event: string, script: string | null = null): string {
  if (script) return `node "${script}" ${url}/hook/${agentId}/${event} ${token}${event === "Stop" ? " --print-reply" : ""} ${MARK_ARG}`;
  // Stop prints HQ's reply: {"decision":"block","reason":…} hands over queued messages.
  const out = event === "Stop" ? "2>/dev/null" : ">/dev/null 2>&1";
  return `curl -sf -m 4 -X POST -H 'Authorization: Bearer ${token}' -H 'Content-Type: application/json' --data-binary @- '${url}/hook/${agentId}/${event}' ${out} || true ${MARK}`;
}

/**
 * Hooks report state to HQ. SessionStart also prints ROLE.md, which Claude Code
 * adds to the session's context. Existing user hooks are kept.
 */
export function writeSettings(dir: string, agent: AgentConfig, port: number, token: string) {
  const script = hookScriptFor(agent, dir);
  const file = ".claude/settings.local.json";
  let settings: Settings = {};
  const existing = agentRead(dir, file); // a symlink reads as missing: never pull in a host file
  if (existing) {
    try {
      settings = JSON.parse(existing) as Settings;
    } catch {
      settings = {};
    }
  }
  const hooks: Record<string, HookEntry[]> = { ...(settings.hooks ?? {}) };
  const url = hqUrl(agent, port);
  for (const event of HOOK_EVENTS) {
    const kept = (hooks[event] ?? [])
      .map((e) => ({ ...e, hooks: e.hooks.filter((h) => !isOurs(h.command)) }))
      .filter((e) => e.hooks.length);
    const ours: HookEntry["hooks"] = [{ type: "command", command: hookCommand(url, token, agent.id, event, script), timeout: 5 }];
    if (event === "SessionStart")
      ours.unshift({ type: "command", command: script ? `node "${script}" --print-role ${MARK_ARG}` : `cat "$CLAUDE_PROJECT_DIR/${ROLE_FILE}" 2>/dev/null || true ${MARK}` });
    hooks[event] = [...kept, event === "PreToolUse" || event === "PostToolUse" ? { matcher: "*", hooks: ours } : { hooks: ours }];
  }
  // Let the agent use the Team MCP without a permission prompt for every call.
  const allow = new Set([...(settings.permissions?.allow ?? []), "mcp__hq"]);
  agentWrite(dir, file, JSON.stringify({ ...settings, hooks, permissions: { ...(settings.permissions ?? {}), allow: [...allow] } }, null, 2) + "\n");
}

/** Team MCP config: HQ's URL plus this agent's identity and token. */
export function writeMcpConfig(dir: string, agent: AgentConfig, port: number, token: string) {
  const config = {
    mcpServers: {
      hq: { type: "http", url: `${hqUrl(agent, port)}/mcp`, headers: { Authorization: `Bearer ${token}`, "X-HQ-Agent": agent.id } },
    },
  };
  agentWrite(dir, MCP_CONFIG, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

/** Claude Code's files: the role (loaded by the SessionStart hook), hooks, and the Team MCP config. */
export function writeClaudeFiles(dir: string, agent: AgentConfig, cfg: HqConfig, token: string, extras: RoleExtras = {}) {
  agentWrite(dir, ROLE_FILE, roleMd(agent, cfg, extras));
  writeSettings(dir, agent, cfg.project.hqPort, token);
  writeMcpConfig(dir, agent, cfg.project.hqPort, token);
  if (hookScriptFor(agent, dir)) writeHookScript(dir);
  excludeFromGit(dir, HQ_FILES);
}

/** Removes lines HQ added to .git/info/exclude. */
export function removeFromExclude(dir: string, paths: string[]) {
  const file = ".git/info/exclude";
  const current = agentRead(dir, file);
  if (current === null) return;
  const next = current.split("\n").filter((l) => !paths.includes(l)).join("\n");
  if (next !== current) agentWrite(dir, file, next);
}

/** Adds paths to .git/info/exclude (a per-clone .gitignore that is never committed). */
export function excludeFromGit(dir: string, paths: string[]) {
  // Only a real .git folder (a worktree's .git is a file; a symlink isn't followed).
  try {
    if (!lstatSync(join(dir, ".git")).isDirectory()) return;
  } catch {
    return;
  }
  const file = ".git/info/exclude";
  const current = agentRead(dir, file) ?? "";
  const missing = paths.filter((p) => !current.split("\n").includes(p));
  if (missing.length) agentWrite(dir, file, current + (current.endsWith("\n") || !current ? "" : "\n") + "# YACC\n" + missing.join("\n") + "\n");
}
