// Templates and the role library (Phase 3). No agents, sandboxes or browser needed.
//
//   npx tsx scripts/templates-test.ts

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { roleMd } from "../server/agentFiles";
import { Hub } from "../server/hub";
import type { Inbox } from "../server/inbox";
import { Planner } from "../server/planner";
import type { RepoInfo } from "../server/repo";
import { newAgent } from "../server/store";
import { Team } from "../server/team";
import { listTemplates, readTemplate, saveTemplate } from "../server/templates";
import { defaultAutonomy, normalizeConfig, toolsFor } from "../src/data/roles";
import { BUILT_IN_TEMPLATES, ROLE_LIBRARY, libraryCard, type Template } from "../src/data/templates";
import { CEO_ID, LEAD_ROLE_ID, type HqConfig, type SetupState } from "../src/data/types";

const tmp = mkdtempSync(join(tmpdir(), "yacc-tpl-"));
let passed = 0;
function ok(label: string, cond: unknown, detail?: unknown) {
  if (!cond) throw new Error(`FAILED: ${label}${detail !== undefined ? `\n  got: ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  passed += 1;
}

/** What the welcome does with a template, minus the screen. */
function configFrom(t: Template, github: boolean): HqConfig {
  const lead = t.team[0];
  const team = t.team.map((a, i) => newAgent(a.name.toLowerCase(), a.name, a.role, "#29adff", i === 0 ? CEO_ID : lead.name.toLowerCase()));
  const cfg: HqConfig = {
    project: { id: "p", name: "P", repo: github ? "acme/p" : "p", path: tmp, hqPort: 7420, ...(t.officeName ? { officeName: t.officeName } : {}) },
    ceo: { name: "Abuti" },
    limits: { maxAgents: Math.max(t.maxAgents ?? 8, team.length) },
    autonomy: t.autonomy ?? defaultAutonomy(),
    roles: structuredClone(t.roles),
    team,
    workflow: {
      item: t.item,
      deliverable: t.deliverable === "pull-request" && github ? "pull-request" : "files",
      stages: structuredClone(t.stages),
      review: { enabled: true, tool: "human", command: "" },
      merge: { by: "human" },
      deploy: { enabled: false, tool: "custom", command: "", perAgentEnvironments: false },
    },
  };
  return cfg;
}

// ------------------------------------------------------------------ built-ins

ok("built-ins: four, unique ids", new Set(BUILT_IN_TEMPLATES.map((t) => t.id)).size === 4);
for (const t of BUILT_IN_TEMPLATES) {
  const cfg = configFrom(t, true);
  const fixed = normalizeConfig(cfg);
  ok(`${t.name}: applies with nothing to fix`, fixed.length === 0, fixed);
  ok(`${t.name}: the first agent is the lead`, cfg.team[0].isLead && cfg.team.filter((a) => a.isLead).length === 1);
  ok(`${t.name}: every stage's role exists`, t.stages.every((s) => s.owner === "any" || t.roles.some((r) => r.id === s.owner)));
  ok(`${t.name}: a stage's role is held by someone, or the lead can hire it`, t.stages.every((s) => s.owner === "any" || t.team.some((a) => a.role === s.owner) || t.roles.find((r) => r.id === LEAD_ROLE_ID)!.can.includes("hire")));
  const lead = roleMd(cfg.team[0], cfg);
  ok(`${t.name}: the lead's file has its duties and the flow`, lead.includes("Your duties") && lead.includes("## How work moves"));
  for (const a of cfg.team.slice(1)) ok(`${t.name}: ${a.name}'s role file has its instructions`, roleMd(a, cfg).includes(cfg.roles.find((r) => r.id === a.roleId)!.instructions.split("\n")[0]));
  if (t.deliverable === "files") ok(`${t.name}: no coding rules for non-coding roles`, cfg.team.slice(1).every((a) => !/gh pr|pull request/i.test(roleMd(a, cfg))));
  // Without GitHub a pull-request template becomes files with a review.
  if (t.deliverable === "pull-request") {
    const local = configFrom(t, false);
    normalizeConfig(local);
    ok(`${t.name}: without GitHub, files and a review`, local.workflow.deliverable === "files" && local.workflow.stages.every((s) => s.gate !== "pull-request"));
  }
}
const coding = configFrom(BUILT_IN_TEMPLATES[0], true);
normalizeConfig(coding);
ok("Software Team: same coding rules as before templates", roleMd(coding.team[1], coding).includes("Title PRs `[TASK-ID] Short title`") && roleMd(coding.team[0], coding).includes("You never write app code."));

// ------------------------------------------------------------------ role library

ok("library: unique ids", new Set(ROLE_LIBRARY.map((c) => c.id)).size === ROLE_LIBRARY.length);
ok("library: no card plans, assigns, hires or approves", ROLE_LIBRARY.every((c) => c.can.every((p) => p === "work" || p === "review")));
ok("library: found by title or id", libraryCard("fact checker")?.id === "fact-checker" && libraryCard("Fact-Checker")?.title === "Fact checker");
ok("tools: hiring includes list_roles", toolsFor({ can: ["hire"] }).includes("list_roles"));

{
  const root = join(tmp, "lib");
  mkdirSync(join(root, ".yacc"), { recursive: true });
  const cfg = configFrom(BUILT_IN_TEMPLATES[3], false); // lead only
  normalizeConfig(cfg);
  const repo: RepoInfo = { root, name: "lib", originUrl: null, github: null, hasCodeRabbit: false, hasInsta: false };
  const setup = { machine: { cpus: 4, memoryGb: 8 }, checks: [], sandboxReady: false, localReady: true, checkedAt: "" } as SetupState;
  const hub = new Hub(repo, `tpltest-${process.pid}`, cfg, { boards: [], tasks: [] }, setup);
  const planner = new Planner(hub, { push: () => {}, forget: () => {} } as unknown as Inbox);
  void planner;
  const team = new Team(hub, { start: () => {}, removeResources: async () => [], forget: () => {}, recheckSetup: () => {} });
  const msg = team.hire("michael", { role: "Editor", reason: "Scripts need editing" });
  const editor = hub.snap.config.roles.find((r) => r.title === "Editor");
  ok("library hire: no instructions needed", /Hired .* as Editor, a new role/.test(msg) && editor?.instructions === libraryCard("editor")!.instructions, msg);
  ok("library hire: keeps work and review, nothing more", editor?.can.join() === "work,review");
  let err = "";
  try {
    team.hire("michael", { role: "Astronaut", reason: "x" });
  } catch (e) {
    err = String(e);
  }
  ok("unknown role: the error lists the library", err.includes("in the library:") && err.includes("Fact checker"), err);
  rmSync(join(homedir(), ".yacc", `tpltest-${process.pid}`), { recursive: true, force: true });
}

// ------------------------------------------------------------------ save and read back

{
  const root = join(tmp, "repo");
  mkdirSync(join(root, ".yacc"), { recursive: true });
  const cfg = configFrom(BUILT_IN_TEMPLATES[1], false); // content studio
  normalizeConfig(cfg);
  cfg.team.push({ ...newAgent("kit", "Kit", "fact-checker", "#fff", "maya"), temporary: true, hiredBy: "maya" });
  normalizeConfig(cfg);
  const dir = saveTemplate(cfg, "# Brief\nVideos for older adults.", "My Studio", "project", root, "Short scam-prevention videos");
  ok("save: in .yacc/templates/<slug>", dir.endsWith(join(".yacc", "templates", "my-studio")));
  ok("save: role instructions as files", readFileSync(join(dir, "roles", "editor.md"), "utf8").includes("Edit for clarity"));
  const back = readTemplate(dir, "project");
  ok("read back: same roles, stages and starting team", back.roles.length === cfg.roles.length && back.stages.map((s) => s.id).join() === cfg.workflow.stages.map((s) => s.id).join() && back.team.length === 4, back);
  ok("read back: temporary hires left out", !back.team.some((a) => a.name === "Kit"));
  ok("read back: brief, item, autonomy, office", back.brief?.includes("older adults") && back.item === "Piece" && back.autonomy?.hire === "notify" && back.officeName === "The Studio");
  const rebuilt = configFrom(back, false);
  ok("read back: applies with nothing to fix", normalizeConfig(rebuilt).length === 0);

  // A broken template folder is reported, not fatal.
  mkdirSync(join(root, ".yacc", "templates", "broken"), { recursive: true });
  writeFileSync(join(root, ".yacc", "templates", "broken", "template.yml"), "name: Broken\nstages: []\nroles: {}\nteam: []\n");
  const { templates, problems } = listTemplates(root);
  ok("list: built-ins, then the saved one", templates.slice(0, 4).every((t) => t.source === "built-in") && templates.some((t) => t.id === "project:my-studio"));
  ok("list: a broken folder is reported", problems.length === 1 && problems[0].includes("broken"), problems);
  // Only roles/*.md and brief.md inside the folder are read.
  writeFileSync(join(root, ".yacc", "templates", "broken", "template.yml"), "name: Sneaky\nstages: [{ name: Do }]\nroles: { lead: { title: Lead, instructions: ../../../config.yml } }\nteam: [{ name: A, role: lead }]\n");
  const sneaky = listTemplates(root).templates.find((t) => t.name === "Sneaky")!;
  ok("read: paths outside the folder are not read", sneaky.roles[0].instructions === "../../../config.yml");
}

rmSync(tmp, { recursive: true, force: true });
console.log(`templates-test: ${passed} checks passed`);
process.exit(0);
