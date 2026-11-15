// The org chart and workflow editors (Phase 5 part 2): reporting lines (loops refused, the tree
// the chart draws, adding someone under a manager) and stages (what the editor flags, ids that
// survive a rename, the "done when" text and where agents see it). No agents or browser needed.
//
//   npx tsx scripts/editors-test.ts

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "yacc-editors-"));
Object.assign(process.env, { HOME: tmp, USERPROFILE: tmp });

const { ActionItems } = await import("../server/actionItems");
const { roleMd } = await import("../server/agentFiles");
const { makeCommands } = await import("../server/commands");
const { Hub } = await import("../server/hub");
const { Planner } = await import("../server/planner");
const { Team } = await import("../server/team");
const { parseConfig, serializeConfig } = await import("../server/store");
const { readTemplate, saveTemplate } = await import("../server/templates");
const { normalizeConfig, orgTree, wouldLoop } = await import("../src/data/roles");
const { BUILT_IN_TEMPLATES } = await import("../src/data/templates");
const { MAX_STAGES, STAGE_DESCRIPTION_MAX, describeFlow, newStageId, stageIssues } = await import("../src/data/workflow");
const { ANY_ROLE, CEO_ID } = await import("../src/data/types");
import type { OrgNode } from "../src/data/roles";
import type { HqConfig, SetupState, StageConfig } from "../src/data/types";
import type { Inbox } from "../server/inbox";
import type { RepoInfo } from "../server/repo";

let passed = 0;
function ok(label: string, cond: unknown, detail?: unknown) {
  if (!cond) throw new Error(`FAILED: ${label}${detail !== undefined ? `\n  got: ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  passed += 1;
}

const STUDIO = `
project: { name: Studio }
ceo: { name: Abuti }
roles:
  lead: { title: Producer, can: [plan, assign, review, hire], instructions: Run the studio. }
  researcher: { title: Researcher, can: [work], instructions: Find facts. }
  writer: { title: Writer, can: [work], instructions: Write scripts. }
  editor: { title: Editor, can: [work, review], instructions: Edit. }
  designer: { title: Designer, can: [work], instructions: Draw. }
team:
  - { id: maya, name: Maya, role: lead, mode: local }
  - { id: leo, name: Leo, role: researcher, mode: local }
  - { id: ada, name: Ada, role: writer, mode: local, reportsTo: sam }
  - { id: sam, name: Sam, role: editor, mode: local }
workflow:
  item: Piece
  deliverable: files
  stages:
    - { name: Research, owner: researcher, description: "  Sources and notes   are in shared/research/. " }
    - { name: Script, owner: writer, gate: review, reviewer: editor, description: A full draft is in shared/scripts/. }
    - { name: Approve, owner: editor, gate: ceo }
  review: { enabled: false, tool: human }
  merge: { by: human }
  deploy: { enabled: false, tool: custom }
`;

const setup = { machine: { cpus: 4, memoryGb: 8 }, checks: [], sandboxReady: false, localReady: true, checkedAt: "" } as SetupState;
let n = 0;
function world(yaml = STUDIO) {
  const name = `w${++n}`;
  const root = join(tmp, name);
  mkdirSync(join(root, ".yacc"), { recursive: true });
  const repo: RepoInfo = { root, name, originUrl: null, github: null, hasCodeRabbit: false, hasInsta: false };
  const config = parseConfig(yaml, () => null).config;
  config.project.path = root;
  const hub = new Hub(repo, `editors-${name}-${process.pid}`, config, { boards: [{ id: "B1", title: "Backlog", status: "active", order: 0 }], tasks: [] }, setup);
  const inbox: { to: string; text: string }[] = [];
  const planner = new Planner(hub, { push: (to: string, m: { text: string }) => void inbox.push({ to, text: m.text }), forget: () => {} } as unknown as Inbox);
  planner.actions = new ActionItems(hub, planner);
  for (const a of config.team) hub.setSession(a.id, { state: "running" });
  const stub = {} as never;
  const team = new Team(hub, { start: () => {}, removeResources: async () => [], forget: () => {}, recheckSetup: () => {} });
  const cmds = makeCommands(hub, { recheckSetup: async () => undefined } as never, planner, stub, stub, team, { briefings: stub, memory: stub });
  return { hub, planner, inbox, root, cmds, cfg: () => hub.snap.config };
}
const flat = (node: OrgNode, depth = 0): string[] => [`${"  ".repeat(depth)}${node.id}`, ...node.reports.flatMap((r) => flat(r, depth + 1))];

// ------------------------------------------------------------------ 1. Reporting lines

{
  const cfg = parseConfig(STUDIO, () => null).config;
  ok("yaml: reportsTo read (Ada → Sam), others default to the lead", cfg.team.find((a) => a.id === "ada")!.reportsTo === "sam" && cfg.team.find((a) => a.id === "leo")!.reportsTo === "maya");
  ok("loop: to the CEO never loops", !wouldLoop(cfg.team, "sam", CEO_ID));
  ok("loop: to yourself loops", wouldLoop(cfg.team, "sam", "sam"));
  ok("loop: to someone who reports to you loops", wouldLoop(cfg.team, "sam", "ada"));
  ok("loop: to someone further down loops", (() => {
    const t = structuredClone(cfg.team);
    t.find((a) => a.id === "leo")!.reportsTo = "ada";
    return wouldLoop(t, "sam", "leo");
  })());
  ok("loop: to a peer is fine", !wouldLoop(cfg.team, "leo", "sam") && !wouldLoop(cfg.team, "ada", "leo"));
  ok("loop: unknown manager doesn't loop", !wouldLoop(cfg.team, "leo", "ghost"));
  ok("loop: an existing loop elsewhere doesn't hang", (() => {
    const t = [{ id: "x", reportsTo: "y" }, { id: "y", reportsTo: "x" }, { id: "z", reportsTo: "ceo" }];
    return wouldLoop(t, "z", "x") === true && wouldLoop(t, "x", "z") === false;
  })());

  const tree = orgTree(cfg);
  ok("tree: CEO at the root", tree.id === CEO_ID);
  ok("tree: lead under the CEO, the team under the lead, Ada under Sam", flat(tree).join("|") === "ceo|  maya|    leo|    sam|      ada", flat(tree));
  const broken = { team: [...cfg.team.map((a) => ({ ...a })), { ...cfg.team[1], id: "p", reportsTo: "q" }, { ...cfg.team[1], id: "q", reportsTo: "p" }] };
  const all = flat(orgTree(broken)).map((s) => s.trim());
  ok("tree: everyone appears exactly once, even in a broken loop", all.length === broken.team.length + 1 && new Set(all).size === all.length, all);
  ok("tree: a loop hangs under the CEO", orgTree(broken).reports.some((r) => r.id === "p" || r.id === "q"));
}

{
  const { cmds, cfg, hub, root } = world();
  const agent = (id: string) => cfg().team.find((a) => a.id === id)!;
  cmds.updateAgent("leo", { reportsTo: "sam" });
  ok("command: Leo now reports to Sam", agent("leo").reportsTo === "sam");
  ok("command: saved to config.yml", /id: leo[\s\S]*?reportsTo: sam/.test(readFileSync(join(root, ".yacc", "config.yml"), "utf8")));
  const before = hub.snap.activity.length;
  cmds.updateAgent("sam", { reportsTo: "ada" });
  ok("command: a loop is refused", agent("sam").reportsTo === "maya");
  ok("command: and you're told why", hub.snap.activity.length === before + 1 && /Sam can't report to Ada: Ada already reports to Sam/.test(hub.snap.activity[0].text), hub.snap.activity[0]?.text);
  cmds.updateAgent("sam", { reportsTo: "leo" });
  ok("command: a loop through someone is refused too", agent("sam").reportsTo === "maya" && /directly or through someone/.test(hub.snap.activity[0].text));
  cmds.updateAgent("ada", { reportsTo: CEO_ID });
  ok("command: anyone can report to the CEO", agent("ada").reportsTo === CEO_ID);
  cmds.updateAgent("maya", { reportsTo: "sam" });
  ok("command: the lead always reports to the CEO", agent("maya").reportsTo === CEO_ID);
  cmds.updateAgent("ada", { reportsTo: "ghost" });
  ok("command: an unknown manager is ignored", agent("ada").reportsTo === CEO_ID);

  cmds.addAgent({ name: "Gus", role: "designer", reportsTo: "sam", mode: "local" });
  ok("add: under the manager you dropped on", agent("gus").reportsTo === "sam" && agent("gus").roleId === "designer");
  ok("add: Activity says who they report to", /Added Gus \(Designer\), reporting to Sam/.test(hub.snap.activity[0].text), hub.snap.activity[0].text);
  cmds.addAgent({ name: "Ivy", role: "writer", reportsTo: CEO_ID, mode: "local" });
  ok("add: straight under the CEO", agent("ivy").reportsTo === CEO_ID && /reporting to Abuti/.test(hub.snap.activity[0].text));
  cmds.addAgent({ name: "Joe", role: "writer", reportsTo: "ghost", mode: "local" });
  ok("add: an unknown manager → the lead, and Activity doesn't mention it", agent("joe").reportsTo === "maya" && /Added Joe \(Writer\)\. Press Start/.test(hub.snap.activity[0].text), hub.snap.activity[0].text);
  cmds.addAgent({ name: "Kai", role: "Illustrator", reportsTo: "gus", mode: "local" });
  ok("add: a new role title makes the role", cfg().roles.some((r) => r.title === "Illustrator") && agent("kai").reportsTo === "gus");
  ok("add: the chart shows them in place", flat(orgTree(cfg())).map((s) => s.trim()).join() === "ceo,maya,sam,leo,gus,kai,joe,ada,ivy", flat(orgTree(cfg())));
}

// ------------------------------------------------------------------ 2. Stages: what the editor flags

{
  const cfg = parseConfig(STUDIO, () => null).config;
  const wf = cfg.workflow;
  const stages = () => structuredClone(wf.stages);
  const levels = (list: StageConfig[], w = wf) => stageIssues(cfg, w, list).map((x) => `${x.stage}:${x.level}`);
  ok("issues: the studio flow is fine", stageIssues(cfg, wf, stages()).length === 0, stageIssues(cfg, wf, stages()));
  ok("issues: no stages", levels([]).join() === "null:error");
  ok("issues: too many stages", levels(Array.from({ length: MAX_STAGES + 1 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, owner: ANY_ROLE, gate: "none" as const }))).includes("null:error"));
  const unnamed = stages();
  unnamed[1].name = "  ";
  ok("issues: a stage without a name", levels(unnamed).join() === "1:error");
  const twins = stages();
  twins[2].name = "script";
  ok("issues: two stages with the same name (any case)", stageIssues(cfg, wf, twins).some((x) => x.stage === 2 && x.level === "error" && /Two stages/.test(x.text)));
  const pr = stages();
  pr[0].gate = "pull-request";
  ok("issues: a pull request in a files workflow", stageIssues(cfg, wf, pr).some((x) => x.stage === 0 && /pull request/.test(x.text)));
  const github = { ...wf, deliverable: "pull-request" as const };
  const prLast = stages();
  prLast[2].gate = "pull-request";
  ok("issues: a pull request ending a GitHub workflow is fine", stageIssues(cfg, github, prLast).length === 0);
  const prMid = stages();
  prMid[1].gate = "pull-request";
  ok("issues: but not in the middle", stageIssues(cfg, github, prMid).some((x) => x.stage === 1 && x.level === "error"));
  const ghost = stages();
  ghost[0].owner = "ghost";
  ok("issues: an owner role that doesn't exist", stageIssues(cfg, wf, ghost).some((x) => x.stage === 0 && x.level === "error" && /"ghost" doesn't exist/.test(x.text)));
  const empty = stages();
  empty[0].owner = "designer";
  ok("issues: nobody has the owner role → a warning, not an error", levels(empty).join() === "0:warn" && /nobody is a Designer yet/.test(stageIssues(cfg, wf, empty)[0].text));
  const noReviewer = stages();
  noReviewer[1].reviewer = "designer";
  ok("issues: nobody has the reviewer role → warning", stageIssues(cfg, wf, noReviewer).some((x) => x.stage === 1 && x.level === "warn" && /nobody is a Designer yet to review/.test(x.text)));
  const badReviewer = stages();
  badReviewer[1].reviewer = "ghost";
  ok("issues: a reviewer role that doesn't exist → error", stageIssues(cfg, wf, badReviewer).some((x) => x.stage === 1 && x.level === "error"));
  const approval = stages();
  approval[0].gate = "approval";
  ok("issues: nobody can approve → warning", stageIssues(cfg, wf, approval).some((x) => x.stage === 0 && x.level === "warn" && /can approve/.test(x.text)));
  const anyReview = stages();
  anyReview[0].gate = "review";
  ok("issues: someone can review (the lead, the editor) → fine", !stageIssues(cfg, wf, anyReview).some((x) => x.stage === 0));
  const nobodyWorks = { ...cfg, roles: cfg.roles.map((r) => ({ ...r, can: r.can.filter((p) => p !== "work") })) };
  const anyone = stages();
  anyone[0].owner = ANY_ROLE;
  ok("issues: 'anyone' with nobody who takes tasks → warning", stageIssues(nobodyWorks, wf, anyone).some((x) => x.stage === 0 && x.level === "warn"));
  const long = stages();
  long[0].description = "x".repeat(STAGE_DESCRIPTION_MAX + 1);
  ok("issues: done-when too long", stageIssues(cfg, wf, long).some((x) => x.stage === 0 && x.level === "error"));

  ok("new id: from the name", newStageId(wf.stages, "Final cut") === "final-cut");
  ok("new id: unlike the others", newStageId(wf.stages, "Script") === "script-2" && newStageId([...wf.stages, { id: "script-2" }], "Script") === "script-3");
  ok("new id: a name with no letters still gets one", newStageId(wf.stages, "!!!") === "stage");
}

// ------------------------------------------------------------------ 3. Done-when text

{
  const { config, fixed } = parseConfig(STUDIO, () => null);
  const [research, script, approve] = config.workflow.stages;
  ok("yaml: done-when read and tidied", research.description === "Sources and notes are in shared/research/." && fixed.length === 0, research.description);
  ok("yaml: kept as written", script.description === "A full draft is in shared/scripts/.");
  ok("yaml: none → no key", !("description" in approve));
  const { yaml } = serializeConfig(config);
  ok("yaml: written back", /description: Sources and notes are in shared\/research\//.test(yaml) && !/name: Approve[^\n]*\n[^-]*description/.test(yaml));
  ok("yaml: round trip", JSON.stringify(parseConfig(yaml, () => null).config.workflow.stages) === JSON.stringify(config.workflow.stages));
  const long = structuredClone(config);
  long.workflow.stages[0].description = "y".repeat(500);
  normalizeConfig(long);
  ok("normalize: cut to the limit", long.workflow.stages[0].description?.length === STAGE_DESCRIPTION_MAX);
  const blank = structuredClone(config);
  blank.workflow.stages[0].description = "   ";
  normalizeConfig(blank);
  ok("normalize: blank → no key", !("description" in blank.workflow.stages[0]));
  const flow = describeFlow(config);
  ok("flow: done-when shown to agents", /1\. Research: Researcher\. Done when: Sources and notes are in shared\/research\//.test(flow) && /2\. Script: Writer, then Editor reviews\. Done when: A full draft/.test(flow), flow);
  ok("flow: no done-when, no suffix", /3\. Approve: Editor, then Abuti approves$/.test(flow), flow);
  const md = roleMd(config.team.find((a) => a.id === "ada")!, config);
  ok("role file: How work moves includes done-when", /## How work moves[\s\S]*Done when: A full draft is in shared\/scripts\//.test(md));
}

{
  const { planner, inbox, cmds, cfg, hub } = world();
  const t = planner.createTask({ title: "Scam calls explainer" }, "maya");
  planner.assign(t.id, "leo", "maya");
  planner.completeStage("leo", "Sources in research/scam-calls.md");
  const handoff = inbox.filter((m) => m.to === "ada").at(-1)?.text ?? "";
  ok("handoff: the next stage's done-when goes with the work", /yours for the Script stage\. Script is done when: A full draft is in shared\/scripts\/\. From the last stage: Sources in research/.test(handoff), handoff);

  // The editor saves stages whole. Renaming keeps the id, so the piece stays in its stage.
  const stages = structuredClone(cfg().workflow.stages);
  stages[1] = { ...stages[1], name: "Draft", description: "First draft done." };
  cmds.updateWorkflow({ stages });
  ok("rename: the id stays", cfg().workflow.stages[1].id === "script" && cfg().workflow.stages[1].name === "Draft");
  ok("rename: work in that stage stays there", hub.snap.tasks.find((x) => x.id === t.id)?.stage === "script");
  ok("save: done-when kept", cfg().workflow.stages[1].description === "First draft done.");
  // Reordered, with a new stage (id made from its name by the editor).
  const next = structuredClone(cfg().workflow.stages);
  next.splice(1, 0, { id: newStageId(next, "Outline"), name: "Outline", owner: "writer", gate: "none", description: "  An outline   " });
  cmds.updateWorkflow({ stages: next });
  ok("save: new stage in place", cfg().workflow.stages.map((s) => s.id).join() === "research,outline,script,approve");
  ok("save: its done-when tidied", cfg().workflow.stages[1].description === "An outline");
  ok("save: the piece is still in Draft", hub.snap.tasks.find((x) => x.id === t.id)?.stage === "script");
  const cleared = structuredClone(cfg().workflow.stages);
  cleared[1] = { ...cleared[1], description: "" };
  cmds.updateWorkflow({ stages: cleared });
  ok("save: clearing done-when removes it", !("description" in cfg().workflow.stages[1]));
}

// ------------------------------------------------------------------ 4. Templates carry done-when

{
  const studio = BUILT_IN_TEMPLATES.find((t) => t.id === "content-studio")!;
  ok("templates: Content Studio and R&D Lab stages say when they're done", studio.stages.every((s) => s.description) && BUILT_IN_TEMPLATES.find((t) => t.id === "rd-lab")!.stages.every((s) => s.description));
  ok("templates: within the limit", BUILT_IN_TEMPLATES.every((t) => t.stages.every((s) => (s.description ?? "").length <= STAGE_DESCRIPTION_MAX)));
  const root = join(tmp, "tpl");
  mkdirSync(join(root, ".yacc"), { recursive: true });
  const cfg = parseConfig(STUDIO, () => null).config as HqConfig;
  cfg.project.path = root;
  const dir = saveTemplate(cfg, "", "Studio flow", "project", root);
  const back = readTemplate(dir, "project");
  ok("templates: a saved template keeps done-when", back.stages[0].description === "Sources and notes are in shared/research/." && !("description" in back.stages[2]));
}

rmSync(tmp, { recursive: true, force: true });
console.log(`editors: ${passed} checks passed`);
