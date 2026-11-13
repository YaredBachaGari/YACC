// Roles, permissions, the org chart, YAML settings and hiring (Phase 1).
// Runs without agents, sandboxes or a browser, so it runs on every CI OS.
//
//   npx tsx scripts/roles-test.ts

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { roleMd } from "../server/agentFiles";
import { Hub } from "../server/hub";
import { Inbox } from "../server/inbox";
import { Planner } from "../server/planner";
import type { RepoInfo } from "../server/repo";
import { ConfigError, loadConfig, parseConfig, saveConfig, serializeConfig, watchConfig } from "../server/store";
import { Team } from "../server/team";
import { normalizeConfig, toolsFor } from "../src/data/roles";
import type { HqConfig, SetupState } from "../src/data/types";

const tmp = mkdtempSync(join(tmpdir(), "yacc-roles-"));
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
async function rejects(label: string, fn: () => Promise<unknown>, match: RegExp) {
  try {
    await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return ok(`${label} (message)`, match.test(msg), msg);
  }
  throw new Error(`FAILED: ${label}: expected an error`);
}

const repoAt = (name: string, github: string | null = null): RepoInfo => {
  const root = join(tmp, name);
  mkdirSync(join(root, ".yacc"), { recursive: true });
  return { root, name, originUrl: null, github, hasCodeRabbit: false, hasInsta: false };
};
const setup = { machine: { cpus: 4, memoryGb: 8 }, checks: [], sandboxReady: false, localReady: true, checkedAt: "" } as SetupState;
const yml = (repo: RepoInfo) => readFileSync(join(repo.root, ".yacc", "config.yml"), "utf8");

// ------------------------------------------------------------------ 1. old config.json becomes config.yml

{
  const repo = repoAt("legacy", "acme/legacy");
  const sandbox = { resources: { cpus: null, memoryGb: null }, allow: ["registry.npmjs.org"], deny: [] };
  const agent = (id: string, name: string, role: string, isLead: boolean) => ({ id, name, role, isLead, cli: "claude", model: "", mode: "sandbox", color: "#ff77a8", skills: [], roleMd: `You are ${name}.`, sandbox, workspacePath: null, mcp: [] });
  writeFileSync(
    join(repo.root, ".yacc", "config.json"),
    JSON.stringify({
      project: { id: "legacy", name: "Legacy", repo: "acme/legacy", hqPort: 7420, path: "" },
      team: [agent("michael", "Michael", "Lead", true), agent("dwight", "Dwight", "Developer", false), agent("pam", "Pam", "QA", false), agent("jim", "Jim", "developer", false)],
      workflow: { review: { enabled: true, tool: "human", command: "" }, merge: { by: "human" }, deploy: { enabled: false, tool: "instacloud", command: "", perAgentEnvironments: false } },
    }),
  );
  const { config, isNew, notes } = loadConfig(repo, 7420);
  ok("legacy: not treated as new", !isNew);
  ok("legacy: says what happened", notes.some((n) => n.includes("config.yml")), notes);
  ok("legacy: config.yml written", existsSync(join(repo.root, ".yacc", "config.yml")));
  ok("legacy: old file kept as .bak", existsSync(join(repo.root, ".yacc", "config.json.bak")) && !existsSync(join(repo.root, ".yacc", "config.json")));
  ok("legacy: roles are lead, developer, qa", config.roles.map((r) => r.id).join() === "lead,developer,qa", config.roles.map((r) => r.id));
  ok("legacy: lead flag became the lead role", config.team[0].roleId === "lead" && config.team[0].isLead && config.team[0].reportsTo === "ceo");
  ok("legacy: workers report to the lead", config.team.slice(1).every((a) => a.reportsTo === "michael" && !a.isLead));
  ok("legacy: same title, same role (case-insensitive)", config.team[1].roleId === "developer" && config.team[3].roleId === "developer");
  ok("legacy: a custom title keeps the worker rules it had", config.roles.find((r) => r.id === "qa")?.instructions.includes("One task = one branch = one PR"));
  ok("legacy: personal note and sandbox rules kept", config.team[1].roleMd === "You are Dwight." && config.team[1].sandbox.allow[0] === "registry.npmjs.org");
  ok("legacy: role instructions are files", readFileSync(join(repo.root, ".yacc", "roles", "lead.md"), "utf8").includes("Your duties"));
  ok("legacy: yml points at the files, has no machine path", yml(repo).includes("instructions: roles/lead.md") && !yml(repo).includes(tmp));

  // 2. What was written reads back the same.
  const again = loadConfig(repo, 7420);
  ok("round trip: second load is clean", !again.isNew && again.notes.length === 0, again.notes);
  const sorted = (v: unknown) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
  ok("round trip: same team", sorted(again.config.team) === sorted(config.team), sorted(again.config.team) + "\n" + sorted(config.team));
  ok("round trip: same roles", sorted(again.config.roles) === sorted(config.roles), sorted(again.config.roles) + "\n" + sorted(config.roles));
}

// ------------------------------------------------------------------ 3. a non-coding team written by hand

const STUDIO = `
project: { name: Studio }
ceo: { name: Abuti }
limits: { maxAgents: 5 }
roles:
  lead: { title: Producer, can: [plan, assign, review, hire], instructions: roles/lead.md }
  researcher:
    title: Researcher
    can: [work]
    instructions: |
      Find and check the facts for the piece you are given. List every source.
  writer: { title: Writer, can: [work], instructions: roles/writer.md }
  editor: { title: Editor, can: [work, review], instructions: Edit the script for clarity and length. }
team:
  - { id: maya, name: Maya, role: lead }
  - { id: leo, name: Leo, role: researcher, mode: local }
  - { id: ada, name: Ada, role: writer, mode: local, reportsTo: leo }
  - { id: sam, name: Sam, role: editor, mode: local }
workflow:
  review: { enabled: false, tool: human }
  merge: { by: human }
  deploy: { enabled: false, tool: custom }
`;
const studioFiles: Record<string, string> = { "roles/lead.md": "Run the studio. Report to the CEO.", "roles/writer.md": "Write the script from the research." };
const studio = (): HqConfig => parseConfig(STUDIO, (rel) => studioFiles[rel] ?? null).config;

{
  const { config, fixed } = parseConfig(STUDIO, (rel) => studioFiles[rel] ?? null);
  ok("studio: nothing needed fixing", fixed.length === 0, fixed);
  ok("studio: four roles, titles from the file", config.roles.map((r) => r.title).join() === "Producer,Researcher,Writer,Editor");
  ok("studio: instructions from a file", config.roles[2].instructions === "Write the script from the research.");
  ok("studio: instructions written inline", config.roles[1].instructions.startsWith("Find and check the facts") && config.roles[3].instructions.startsWith("Edit the script"));
  ok("studio: the lead reports to the CEO; lines default to the lead", config.team[0].reportsTo === "ceo" && config.team[1].reportsTo === "maya" && config.team[3].reportsTo === "maya");
  ok("studio: an explicit reporting line is kept", config.team[2].reportsTo === "leo");
  ok("studio: derived fields", config.team[0].isLead && config.team[0].role === "Producer" && config.team[1].role === "Researcher" && !config.team[1].isLead);
  ok("studio: defaults filled in", config.team[1].cli === "claude" && config.team[1].sandbox.allow.length === 0 && config.ceo.name === "Abuti" && config.limits.maxAgents === 5);

  const noRead = () => null;
  throws("yaml: syntax error", () => parseConfig("project: [", noRead), /not valid YAML/);
  throws("yaml: missing team", () => parseConfig("project: { name: X }\nworkflow: { review: { enabled: true, tool: human }, merge: { by: human }, deploy: { enabled: false, tool: custom } }", noRead), /team/);
  throws("yaml: unknown role", () => parseConfig(STUDIO.replace("role: writer", "role: wrtier"), noRead), /"wrtier", which isn't under roles/);
  throws("yaml: unknown permission", () => parseConfig(STUDIO.replace("can: [work, review]", "can: [work, fly]"), noRead), /roles\.editor\.can/);
  throws("yaml: duplicate agent id", () => parseConfig(STUDIO.replace("id: sam", "id: leo"), noRead), /two agents have the id "leo"/);
  throws("yaml: bad agent id", () => parseConfig(STUDIO.replace("id: sam", "id: Sam Smith"), noRead), /lowercase/);
  ok("yaml: is a ConfigError", (() => { try { parseConfig("a: [", noRead); } catch (e) { return e instanceof ConfigError; } return false; })());

  // A path outside roles/ is never read: it is taken as the text itself.
  const reads: string[] = [];
  const sneaky = parseConfig(STUDIO.replace("instructions: roles/writer.md", "instructions: ../../secrets.md"), (rel) => (reads.push(rel), "SECRET"));
  ok("yaml: only roles/<id>.md is read from disk", !reads.includes("../../secrets.md") && sneaky.config.roles[2].instructions === "../../secrets.md", reads);
}

// ------------------------------------------------------------------ 4. a config is always made consistent

{
  const c = studio();
  c.team[1].roleId = "lead"; // a second lead
  c.team[3].reportsTo = "ghost";
  c.roles[0].can = ["review"]; // a lead that can't plan
  const fixed = normalizeConfig(c);
  ok("normalize: one lead only", c.team.filter((a) => a.roleId === "lead").length === 1 && c.team[1].roleId !== "lead", fixed);
  ok("normalize: unknown manager → the lead", c.team[3].reportsTo === "maya");
  ok("normalize: the lead keeps plan and assign", c.roles[0].can.includes("plan") && c.roles[0].can.includes("assign"));

  const loop = studio();
  loop.team[1].reportsTo = "ada"; // leo → ada → leo
  normalizeConfig(loop);
  const up = (id: string, n = 0): boolean => (n > 10 ? false : id === "ceo" ? true : up(loop.team.find((a) => a.id === id)!.reportsTo, n + 1));
  ok("normalize: reporting loops are broken", loop.team.every((a) => up(a.id)));

  const noLead = studio();
  noLead.roles = noLead.roles.filter((r) => r.id !== "lead");
  noLead.team[0].roleId = "writer";
  normalizeConfig(noLead);
  ok("normalize: the lead role and a lead always exist", noLead.roles.some((r) => r.id === "lead") && noLead.team.filter((a) => a.isLead).length === 1);
}

// ------------------------------------------------------------------ 5. tools follow permissions

{
  const c = studio();
  const tools = (id: string) => toolsFor(c.roles.find((r) => r.id === id));
  ok("tools: the lead plans, assigns and hires", ["create_task", "assign_task", "hire_agent", "dismiss_agent"].every((t) => tools("lead").includes(t)));
  ok("tools: the lead doesn't take tasks", !tools("lead").includes("get_my_task"));
  ok("tools: a worker takes tasks only", tools("writer").includes("get_my_task") && !["create_task", "assign_task", "hire_agent"].some((t) => tools("writer").includes(t)));
  ok("tools: everyone can message and ask the CEO", ["lead", "researcher", "writer", "editor"].every((id) => ["send_message", "ask_user", "request_access"].every((t) => tools(id).includes(t))));
  ok("tools: no permissions, common tools only", toolsFor({ can: [] }).join() === "list_workers,get_status,list_tasks,send_message,ask_user,request_access");
}

// ------------------------------------------------------------------ 6. the role file an agent reads

{
  const c = studio();
  const lead = roleMd(c.team[0], c);
  ok("role file: the role's own instructions", lead.includes("## Your role: Producer") && lead.includes("Run the studio."));
  ok("role file: the lead reports to the CEO by name", lead.includes("You report to Abuti, the CEO (the human)."));
  ok("role file: org chart with reporting lines", lead.includes("- Abuti — CEO (the human)") && lead.includes("- Ada — Writer; reports to Leo"));
  ok("role file: the hirer sees the headcount limit", lead.includes("Headcount limit set by the CEO: 5 agents (the team has 4)."));
  ok("role file: tools match the role", lead.includes("Your tools: create_board, create_task, update_task, assign_task, hire_agent, dismiss_agent, list_workers"));
  const writer = roleMd(c.team[2], c);
  ok("role file: a writer gets writer rules, not coding rules", writer.includes("Write the script from the research.") && !/\bPR\b|gh pr|branch/.test(writer), writer);
  ok("role file: anyone can go to the CEO directly", writer.includes("You don't need to go through the lead for this."));
  ok("role file: anyone can message anyone", writer.includes("You can message any teammate with send_message, whatever the reporting lines."));
  ok("role file: a worker doesn't see the hiring limit", !writer.includes("Headcount limit"));
  ok("role file: any role that takes tasks is told how", writer.includes("call get_my_task first") && writer.includes("Report with set_my_status") && !lead.includes("call get_my_task first"));
  ok("role file: local agents aren't told about sandbox blocks", !writer.includes("Your sandbox blocks most websites"));

  // The default coding team keeps the rules it had before roles existed.
  const repo = repoAt("coding", "acme/coding");
  const coding = loadConfig(repo, 7420).config;
  const codingLead = roleMd(coding.team[0], coding);
  const dev = roleMd(coding.team[1], coding);
  for (const rule of ["You never write app code.", "one task = one branch = one PR", "Assign only to agents that are running and free (check list_workers).", "The user merges PRs; never merge one yourself.", "If the user changes who merges, HQ tells you."])
    ok(`coding lead keeps: ${rule}`, codingLead.includes(rule));
  for (const rule of ["Work only on the task you were given. One task = one branch = one PR.", "call get_my_task first, then `git pull origin main`", "Edit only the files the task lists.", "Title PRs `[TASK-ID] Short title`", "set_my_status tells the lead automatically.", "call set_my_status blocked with the reason", "Your sandbox blocks most websites and APIs."])
    ok(`coding developer keeps: ${rule}`, dev.includes(rule));
  ok("coding developer isn't told the task rules twice", dev.split("call get_my_task first").length === 2, dev.split("call get_my_task first").length);
  ok("coding lead gets its duties", ["Follow every task to completion", "Compile and summarize", "Hire only when no role on the team covers the work"].every((d) => codingLead.includes(d)));
  coding.workflow.merge.by = "lead";
  ok("coding lead: merge rule follows the workflow setting", roleMd(coding.team[0], coding).includes("You merge PRs once they pass review"));
}

// ------------------------------------------------------------------ 7. hiring and dismissing

{
  const repo = repoAt("studio");
  const config = studio();
  config.project.path = repo.root;
  const hub = new Hub(repo, "studio", config, { boards: [{ id: "B1", title: "Backlog", status: "active", order: 0 }], tasks: [] }, setup);
  const typed: string[] = [];
  const planner = new Planner(hub, new Inbox(hub, { type: async (id, text) => void typed.push(`${id}:${text}`), enter: async () => {} }));
  const started: string[] = [];
  const removed: string[] = [];
  const team = new Team(hub, { start: (id) => void started.push(id), removeResources: async (id) => (removed.push(id), ["sandbox"]), forget: () => {}, recheckSetup: () => {} });
  const cfg = () => hub.snap.config;

  throws("hire: a worker can't hire", () => team.hire("ada", { role: "writer", reason: "more scripts" }), /can't hire/);
  throws("hire: a reason is required", () => team.hire("maya", { role: "writer", reason: " " }), /why this hire is needed/);
  throws("hire: no second lead", () => team.hire("maya", { role: "Producer", reason: "help" }), /one lead/);
  throws("hire: a new role needs instructions", () => team.hire("maya", { role: "Fact checker", reason: "accuracy" }), /no "Fact checker" role yet .* pass instructions/);

  const msg = team.hire("maya", { role: "Fact checker", name: "Kit", reason: "The script cites figures nobody on the team checks.", temporary: true, instructions: "Check every figure and name in the script against its source. Report each mismatch with the source link." });
  const kit = hub.cfg("kit")!;
  ok("hire: the agent joins and starts", !!kit && started.join() === "kit" && /Hired Kit \(id kit\) as Fact checker, a new role/.test(msg), msg);
  ok("hire: reports to who hired them, marked temporary", kit.reportsTo === "maya" && kit.hiredBy === "maya" && kit.temporary === true);
  ok("hire: runs like the hirer", kit.mode === cfg().team[0].mode && kit.cli === "claude");
  const role = cfg().roles.find((r) => r.id === "fact-checker")!;
  ok("hire: a new role can do tasks and nothing more", role.can.join() === "work", role.can);
  ok("hire: the CEO is told, with the reason", hub.snap.activity[0].text.startsWith("Maya hired Kit (Fact checker, temporary, new role): The script cites"), hub.snap.activity[0].text);
  ok("hire: saved to config.yml and roles/", yml(repo).includes("hiredBy: maya") && yml(repo).includes("temporary: true") && readFileSync(join(repo.root, ".yacc", "roles", "fact-checker.md"), "utf8").includes("Check every figure"));
  ok("hire: has a live status", hub.status("kit")?.session.state === "stopped");

  throws("hire: stops at the CEO's headcount limit", () => team.hire("maya", { role: "writer", reason: "one more" }), /headcount limit \(5 agents\).*hired: Kit\), or work with the team you have/);
  ok("hire: nothing was added past the limit", cfg().team.length === 5 && started.length === 1);

  // Tasks: only roles that do tasks can be given one.
  const task = planner.createTask({ title: "Check the script" }, "maya");
  throws("assign: the lead doesn't take tasks", () => planner.assign(task.id, "maya", "you"), /doesn't take tasks/);
  planner.assign(task.id, "kit", "maya");
  ok("assign: the hire got the task", planner.currentTask("kit")?.id === task.id);

  await rejects("dismiss: a worker can't", () => team.dismiss("ada", "kit", "done"), /can't dismiss/);
  await rejects("dismiss: not an agent the CEO added", () => team.dismiss("maya", "leo", "not needed"), /added by the CEO, so only the CEO can remove them/);
  await rejects("dismiss: not the lead", () => team.dismiss("maya", "maya", "x"), /That's you/);
  const bye = await team.dismiss("maya", "Kit", "Script is checked.");
  ok("dismiss: gone, sandbox removed, folder kept", !hub.cfg("kit") && !hub.status("kit") && removed.join() === "kit" && hub.snap.activity[0].text.includes("Their folder is kept."), hub.snap.activity[0].text);
  ok("dismiss: their unfinished task is unassigned again", planner.task(task.id)?.ownerId === null && bye.includes(task.id), bye);
  ok("dismiss: the role stays for next time", cfg().roles.some((r) => r.id === "fact-checker") && !yml(repo).includes("id: kit"));
  ok("hire: there is room again", /Hired/.test(team.hire("maya", { role: "fact-checker", reason: "second script" })));

  // The CEO removing an agent others report to: their reports move up.
  await team.remove("leo", { deleteSandbox: true, deleteFolder: false });
  ok("remove: reports move to the manager's manager", hub.cfg("ada")?.reportsTo === "maya");
  await rejects("remove: never the lead", () => team.remove("maya", { deleteSandbox: true, deleteFolder: false }), /lead can't be removed/);

  // ---------------------------------------------------------------- 8. edits by hand while HQ runs
  const events: ({ config: HqConfig; fixed: string[] } | { error: string })[] = [];
  const stop = watchConfig(repo.root, (r) => void events.push(r));
  const waitFor = async (n: number) => {
    for (let i = 0; i < 80 && events.length < n; i++) await new Promise((r) => setTimeout(r, 100));
  };
  const file = join(repo.root, ".yacc", "config.yml");
  saveConfig(repo.root, cfg()); // HQ's own save
  await new Promise((r) => setTimeout(r, 700));
  ok("watch: HQ's own saves are not reported", events.length === 0, events.length);
  writeFileSync(file, yml(repo).replace("maxAgents: 5", "maxAgents: 7"));
  await waitFor(1);
  ok("watch: an edit by hand is read", events.length === 1 && "config" in events[0] && events[0].config.limits.maxAgents === 7, events);
  ok("watch: applied to the running hub", hub.applyExternalConfig((events[0] as { config: HqConfig }).config) === null && cfg().limits.maxAgents === 7);
  writeFileSync(join(repo.root, ".yacc", "roles", "writer.md"), "Write tight. Two pages at most.\n");
  await waitFor(2);
  ok("watch: an edited instructions file is read", events.length === 2 && "config" in events[1] && events[1].config.roles.find((r) => r.id === "writer")?.instructions === "Write tight. Two pages at most.", events[1]);
  writeFileSync(file, yml(repo).replace("role: writer", "role: nobody"));
  await waitFor(3);
  ok("watch: a broken edit is reported, not applied", events.length === 3 && "error" in events[2] && /"nobody"/.test(events[2].error), events[2]);
  stop();

  // An agent that is running can't be removed by editing the file.
  hub.setSession("ada", { state: "running" });
  const without = structuredClone(cfg());
  without.team = without.team.filter((a) => a.id !== "ada");
  ok("external: a running agent stays", /Ada is still running/.test(hub.applyExternalConfig(without) ?? ""));
  ok("external: project.id is fixed while running", /project\.id can't change/.test(hub.applyExternalConfig({ ...structuredClone(cfg()), project: { ...cfg().project, id: "other" } }) ?? ""));
}

// ------------------------------------------------------------------ 9. what is written is always readable

{
  const c = studio();
  const { yaml, files } = serializeConfig(c);
  ok("serialize: reads back", parseConfig(yaml, (rel) => files[rel] ?? null).config.team.length === 4);
  ok("serialize: no derived fields in the file", !/isLead|roleId/.test(yaml));
  const bad = studio();
  bad.team = [];
  throws("save: refuses to write a config it couldn't read back", () => saveConfig(repoAt("bad").root, bad), /team/);
  ok("save: nothing was written", !existsSync(join(tmp, "bad", ".yacc", "config.yml")));
}

rmSync(tmp, { recursive: true, force: true });
console.log(`roles-test: ${passed} checks passed`);
process.exit(0); // the inbox keeps a retry timer running
