// Workflow stages, gates and handoffs (Phase 2). No agents, sandboxes or browser needed.
//
//   npx tsx scripts/workflow-test.ts

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ActionItems } from "../server/actionItems";
import { roleMd } from "../server/agentFiles";
import { Hub } from "../server/hub";
import { Inbox } from "../server/inbox";
import { Planner } from "../server/planner";
import type { RepoInfo } from "../server/repo";
import { parseConfig, saveConfig } from "../server/store";
import { toolsFor } from "../src/data/roles";
import { normalizeConfig } from "../src/data/roles";
import type { HqConfig, SetupState } from "../src/data/types";


const tmp = mkdtempSync(join(tmpdir(), "yacc-wf-"));
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

const STUDIO = `
project: { name: Studio }
ceo: { name: Abuti }
roles:
  lead: { title: Producer, can: [plan, assign, review, hire], instructions: Run the studio. }
  researcher: { title: Researcher, can: [work], instructions: Find facts. }
  writer: { title: Writer, can: [work], instructions: Write scripts. }
  editor: { title: Editor, can: [work, review], instructions: Edit. }
team:
  - { id: maya, name: Maya, role: lead, mode: local }
  - { id: leo, name: Leo, role: researcher, mode: local }
  - { id: ada, name: Ada, role: writer, mode: local }
  - { id: sam, name: Sam, role: editor, mode: local }
workflow:
  item: Piece
  deliverable: files
  stages:
    - { name: Research, owner: researcher }
    - { name: Script, owner: writer, gate: review, reviewer: editor }
    - { name: Approve, owner: editor, gate: ceo }
  review: { enabled: false, tool: human }
  merge: { by: human }
  deploy: { enabled: false, tool: custom }
`;

const setup = { machine: { cpus: 4, memoryGb: 8 }, checks: [], sandboxReady: false, localReady: true, checkedAt: "" } as SetupState;
function world(yaml: string, name: string) {
  const root = join(tmp, name);
  mkdirSync(join(root, ".yacc"), { recursive: true });
  const repo: RepoInfo = { root, name, originUrl: null, github: null, hasCodeRabbit: false, hasInsta: false };
  const config = parseConfig(yaml, () => null).config;
  config.project.path = root;
  const hub = new Hub(repo, `wftest-${name}-${process.pid}`, config, { boards: [{ id: "B1", title: "Backlog", status: "active", order: 0 }], tasks: [] }, setup);
  const inbox: { to: string; text: string }[] = [];
  const planner = new Planner(hub, { push: (to: string, m: { text: string }) => void inbox.push({ to, text: m.text }), forget: () => {} } as unknown as Inbox);
  planner.actions = new ActionItems(hub, planner);
  for (const a of config.team) hub.setSession(a.id, { state: "running" });
  return { hub, planner, inbox, root, cfg: () => hub.snap.config };
}

// ------------------------------------------------------------------ config

{
  const { config, fixed } = parseConfig(STUDIO, () => null);
  ok("yaml: stages read, ids from names", config.workflow.stages.map((s) => s.id).join() === "research,script,approve" && fixed.length === 0, fixed);
  ok("yaml: item label and deliverable", config.workflow.item === "Piece" && config.workflow.deliverable === "files");
  ok("yaml: an old config without stages keeps the coding flow", (() => {
    const old = parseConfig(STUDIO.replace(/  item: Piece\n  deliverable: files\n  stages:\n(    - .*\n)+/, ""), () => null).config.workflow;
    return old.deliverable === "pull-request" && old.stages.length === 1 && old.stages[0].gate === "pull-request";
  })());

  const bad = structuredClone(config);
  bad.workflow.stages = [
    { id: "a", name: "A", owner: "ghost", gate: "pull-request" },
    { id: "a", name: "A", owner: "writer", gate: "review", reviewer: "nobody" },
  ];
  const f = normalizeConfig(bad);
  ok("normalize: unknown owner → anyone", bad.workflow.stages[0].owner === "any", f);
  ok("normalize: a PR gate only on the last stage of a GitHub flow", bad.workflow.stages[0].gate === "review");
  ok("normalize: duplicate ids made unique", bad.workflow.stages[0].id !== bad.workflow.stages[1].id);
  ok("normalize: unknown reviewer role dropped", bad.workflow.stages[1].reviewer === undefined);
  ok("normalize: says what it fixed", f.length === 3, f);
  const empty = structuredClone(config);
  empty.workflow.stages = [];
  normalizeConfig(empty);
  ok("normalize: never zero stages", empty.workflow.stages.length === 1);

  const root = join(tmp, "save");
  mkdirSync(join(root, ".yacc"), { recursive: true });
  saveConfig(root, config);
  const text = readFileSync(join(root, ".yacc", "config.yml"), "utf8");
  ok("save: stages written and read back", text.includes("name: Script") && parseConfig(text, (rel) => readFileSync(join(root, ".yacc", rel), "utf8")).config.workflow.stages.length === 3);

  ok("tools: work gets complete_stage", toolsFor(config.roles.find((r) => r.id === "writer")).includes("complete_stage"));
  ok("tools: review gets approve_work and request_changes, once", toolsFor(config.roles.find((r) => r.id === "editor")).filter((t) => t === "approve_work").length === 1 && toolsFor({ can: ["review", "approve"] }).includes("request_changes"));
  const file = roleMd(config.team[2], config);
  ok("role file: everyone sees how work moves", file.includes("## How work moves") && file.includes("2. Script: Writer, then Editor reviews") && file.includes("3. Approve: Editor, then Abuti approves"), file);
  ok("role file: no PR wording in a files flow", !/pull request|gh pr/i.test(file));
}

// ------------------------------------------------------------------ a piece moves through every gate

{
  const { hub, planner, inbox, cfg } = world(STUDIO, "studio");
  const t = planner.createTask({ title: "Scam calls explainer", doneWhen: "Two pages, three sources" }, "maya");
  ok("create: starts in the first stage", t.stage === "research" && t.status === "todo");
  planner.assign(t.id, "leo", "maya");
  ok("assign: Leo has it", planner.currentTask("leo")?.id === t.id);

  // Research → Script (no gate): handed to the writer automatically.
  throws("approve: nothing to approve yet", () => planner.approveWork("sam", t.id), /isn't waiting/);
  planner.completeStage("leo", "Sources in research/scam-calls.md");
  ok("handoff: moved to Script, owned by the writer", t.stage === "script" && t.ownerId === "ada" && t.status === "todo", t);
  ok("handoff: the researcher is free", !planner.currentTask("leo"));
  ok("handoff: the writer is told, with the note", inbox.some((m) => m.to === "ada" && m.text.includes("Script stage") && m.text.includes("research/scam-calls.md")), inbox);

  // Script → review by the editor.
  planner.setStatus("ada", "in-progress");
  planner.setStatus("ada", "in-review", "Draft in scripts/scam-calls.md"); // same as complete_stage outside a PR stage
  ok("review gate: waits for the editor", t.status === "in-review" && t.reviewerId === "sam" && t.stage === "script", t);
  ok("review gate: the writer is free meanwhile", !planner.currentTask("ada"));
  ok("review gate: the editor is asked", inbox.some((m) => m.to === "sam" && m.text.includes("Please review") && m.text.includes("approve_work")));
  throws("review gate: only the assigned reviewer", () => planner.approveWork("maya", t.id), /waiting for Sam, not you/);
  throws("review gate: changes need words", () => planner.requestChanges("sam", t.id, "  "), /Say what needs to change/);

  planner.requestChanges("sam", t.id, "Cut the intro to one paragraph.");
  ok("send back: the writer has it again, with the feedback", t.status === "in-progress" && t.ownerId === "ada" && !t.reviewerId && planner.currentTask("ada")?.id === t.id && t.note?.includes("Cut the intro"), t);
  ok("send back: the writer is told", inbox.some((m) => m.to === "ada" && m.text.includes("Cut the intro") && m.text.includes("complete_stage")));

  planner.completeStage("ada", "Intro cut");
  planner.approveWork("sam", t.id, "Good");
  ok("approve: moves to Approve, owned by the editor", t.stage === "approve" && t.ownerId === "sam" && t.status === "todo", t);

  // Approve → CEO gate.
  planner.completeStage("sam", "Final in scripts/scam-calls.md");
  const item = hub.snap.actionItems?.find((i) => i.kind === "approval" && i.taskId === t.id && i.status === "open");
  ok("ceo gate: an approval action item for you", t.reviewerId === "ceo" && t.status === "in-review" && !!item, hub.snap.actionItems);
  throws("ceo gate: an agent can't approve it", () => planner.approveWork("maya", t.id), /waiting for the CEO/);
  throws("ceo gate: sending back needs feedback", () => planner.actions!.resolve(item!.id, "dismissed", ""), /Say what needs to change/);
  planner.actions!.resolve(item!.id, "dismissed", "Add a call to action at the end.");
  ok("ceo gate: sent back to the editor", t.status === "in-progress" && t.ownerId === "sam" && t.note?.includes("Abuti") && item!.status === "dismissed");
  planner.completeStage("sam", "CTA added");
  const item2 = hub.snap.actionItems!.find((i) => i.kind === "approval" && i.status === "open")!;
  planner.actions!.resolve(item2.id, "done", "Ship it");
  ok("ceo gate: approved on the last stage → done", t.status === "done" && !t.reviewerId, t);
  ok("done: the lead is told", inbox.some((m) => m.to === "maya" && m.text.includes(`${t.id}`) && m.text.includes("is done")));
  ok("done: activity says so", hub.snap.activity.some((a) => a.text.includes("is done")));

  // A stage whose role nobody has: unassigned, and the lead is told to assign or hire.
  cfg().team = cfg().team.filter((a) => a.id !== "ada");
  const t2 = planner.createTask({ title: "Second piece" }, "maya");
  planner.assign(t2.id, "leo", "maya");
  planner.completeStage("leo", "done");
  ok("no owner: unassigned in the next stage", t2.stage === "script" && t2.ownerId === null);
  ok("no owner: the lead is told to assign or hire", inbox.some((m) => m.to === "maya" && m.text.includes("nobody on the team has the Writer role") && m.text.includes("hire")));

  // Review gate with nobody able to review → it comes to the CEO.
  cfg().team = cfg().team.filter((a) => a.id !== "sam");
  cfg().roles.find((r) => r.id === "lead")!.can = ["plan", "assign", "hire"];
  planner.assign(t2.id, "leo", "maya");
  planner.completeStage("leo", "Wrote it myself");
  ok("no reviewer: falls to the CEO", t2.reviewerId === "ceo" && hub.snap.actionItems!.some((i) => i.taskId === t2.id && i.kind === "approval" && i.status === "open"));

  // Stages change while work is in one that is removed.
  const t3 = planner.createTask({ title: "Third", stage: "Approve" }, "maya");
  ok("create: can start in a later stage by name", t3.stage === "approve");
  cfg().workflow.stages = cfg().workflow.stages.filter((s) => s.id !== "approve");
  hub.configChanged();
  ok("stages removed: work moves to the first stage", t3.stage === "research", t3);
  throws("create: unknown stage", () => planner.createTask({ title: "x", stage: "nope" }, "maya"), /No stage "nope"/);
}

// ------------------------------------------------------------------ the coding flow is unchanged

{
  const coding = STUDIO.replace(/  item: Piece\n  deliverable: files\n  stages:\n(    - .*\n)+/, "");
  const { planner } = world(coding, "coding");
  const t = planner.createTask({ title: "Chat route" }, "maya");
  planner.assign(t.id, "ada", "maya");
  throws("PR stage: complete_stage points to the PR", () => planner.completeStage("ada", "x"), /ends with a pull request/);
  planner.setStatus("ada", "in-review", "PR open", 12);
  ok("PR stage: in review with the PR number, still Ada's", t.status === "in-review" && t.prNumber === 12 && planner.currentTask("ada")?.id === t.id && !t.reviewerId);
  planner.setStatus("ada", "done");
  ok("PR stage: done as before", t.status === "done");
}

rmSync(tmp, { recursive: true, force: true });
// Action items are kept under ~/.yacc/<project>/: remove the test projects.
for (const n of ["studio", "coding"]) rmSync(join(homedir(), ".yacc", `wftest-${n}-${process.pid}`), { recursive: true, force: true });
console.log(`workflow-test: ${passed} checks passed`);
process.exit(0);
