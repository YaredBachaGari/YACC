// Phase 7: the audit log, retrospectives, template sharing and the gallery, and the project
// switcher. No agents or network needed: fetches and launches are faked.
//
//   npx tsx scripts/hardening-test.ts

import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const tmp = mkdtempSync(join(tmpdir(), "yacc-hardening-"));
Object.assign(process.env, { HOME: tmp, USERPROFILE: tmp });

const { ActionItems } = await import("../server/actionItems");
const { roleMd } = await import("../server/agentFiles");
const { AuditLog } = await import("../server/audit");
const { makeCommands } = await import("../server/commands");
const { Hub } = await import("../server/hub");
const { startHttp } = await import("../server/http");
const { Planner } = await import("../server/planner");
const { forgetProject, listProjects, openProject, registerProject, unregisterSession } = await import("../server/projects");
const { Retros, retroPrompt } = await import("../server/retros");
const { Scheduler } = await import("../server/scheduler");
const { parseConfig, saveConfig } = await import("../server/store");
const { checkBundle, deleteTemplate, exportTemplate, fetchJson, installBundle, rawUrl, readGallery, skillFiles } = await import("../server/templateShare");
const { listTemplates, readTemplate, saveTemplate } = await import("../server/templates");
const A = await import("../src/data/audit");
const { foldDiff, lineDiff } = await import("../src/data/diff");
const { toolsFor } = await import("../src/data/roles");
const B = await import("../src/data/templateBundle");
const { BUILT_IN_TEMPLATES } = await import("../src/data/templates");
import type { HqConfig, SetupState } from "../src/data/types";
import type { Inbox } from "../server/inbox";
import type { RepoInfo } from "../server/repo";

let passed = 0;
function ok(label: string, cond: unknown, detail?: unknown) {
  if (!cond) throw new Error(`FAILED: ${label}${detail !== undefined ? `\n  got: ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  passed += 1;
}
async function rejects(label: string, p: Promise<unknown> | (() => unknown), match: RegExp) {
  try {
    await (typeof p === "function" ? p() : p);
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
  lead: { title: Producer, can: [plan, assign, review, hire], instructions: Run it. }
  researcher: { title: Researcher, can: [work], instructions: "- Find facts.\\n- Cite them." }
  writer: { title: Writer, can: [work], instructions: "- Write.\\n- Keep it short." }
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
let n = 0;
function world(yaml = STUDIO) {
  const name = `w${++n}`;
  const root = join(tmp, name);
  mkdirSync(join(root, ".yacc"), { recursive: true });
  const repo: RepoInfo = { root, name, originUrl: null, github: null, hasCodeRabbit: false, hasInsta: false };
  const config = parseConfig(yaml, () => null).config;
  config.project.path = root;
  saveConfig(root, config);
  const hub = new Hub(repo, `hard-${name}-${process.pid}`, config, { boards: [{ id: "B1", title: "Backlog", status: "active", order: 0 }], tasks: [] }, setup);
  hub.auditLog = new AuditLog(hub.slug);
  const inbox: { to: string; text: string }[] = [];
  const planner = new Planner(hub, { push: (to: string, m: { text: string }) => void inbox.push({ to, text: m.text }), forget: () => {} } as unknown as Inbox);
  planner.actions = new ActionItems(hub, planner);
  for (const a of config.team) hub.setSession(a.id, { state: "running" });
  const retros = new Retros(hub, planner);
  const stub = {} as never;
  const cmds = makeCommands(hub, { recheckSetup: async () => undefined } as never, planner, { refresh: async () => undefined, setKey: async () => undefined, removeKey: async () => undefined } as never, stub, stub, { briefings: stub, memory: { read: () => ({ brief: "" }), set: () => {} } as never, retros });
  const entries = () => hub.auditLog!.read({ limit: 1000 }).entries;
  return { hub, planner, inbox, retros, cmds, root, entries, cfg: () => hub.snap.config };
}

// ------------------------------------------------------------------ 1. Audit log

{
  const cfg = parseConfig(STUDIO, () => null).config;
  const next = structuredClone(cfg);
  next.team.find((a) => a.id === "ada")!.model = "opus";
  next.team.find((a) => a.id === "ada")!.reportsTo = "sam";
  next.team.push({ ...structuredClone(next.team[1]), id: "gus", name: "Gus" });
  next.team = next.team.filter((a) => a.id !== "leo" || true);
  next.roles.find((r) => r.id === "writer")!.instructions = "new";
  next.roles = next.roles.filter((r) => r.id !== "editor").concat([{ id: "designer", title: "Designer", can: ["work"], instructions: "" }]);
  next.workflow.item = "Story";
  next.project.theme = "loft";
  const lines = A.describeConfigChange(cfg, next);
  ok("diff: an agent's changed fields", lines.includes("Ada: model, reportsTo"), lines);
  ok("diff: added agents and roles, removed roles", lines.includes("added agent Gus (Researcher)") && lines.includes("added role Designer") && lines.includes("removed role Editor"), lines);
  ok("diff: a role's changed fields", lines.includes("role Writer: instructions"));
  ok("diff: sections", lines.includes("workflow") && lines.includes("project"));
  ok("diff: no change, nothing", A.describeConfigChange(cfg, structuredClone(cfg)).length === 0);
  const less = structuredClone(cfg);
  less.team = less.team.filter((a) => a.id !== "sam");
  ok("diff: removed agents", A.describeConfigChange(cfg, less).includes("removed agent Sam"));
  ok("actor names", A.actorName("you", cfg) === "Abuti (you)" && A.actorName("ada", cfg) === "Ada" && A.actorName("config.yml", cfg).includes("by hand") && A.actorName("schedule:weekly", cfg) === "Schedule weekly" && A.actorName("hq", cfg) === "HQ");
  const csv = A.auditCsv([{ at: "2026-11-01T00:00:00.000Z", kind: "config", actor: "you", summary: 'Changed "x", y\nz' }], cfg);
  ok("csv: header and quoting", csv === 'at,kind,actor,target,summary\n2026-11-01T00:00:00.000Z,config,Abuti (you),,"Changed ""x"", y\nz"\n', csv);
}
{
  const log = new AuditLog("audit-unit");
  log.record({ kind: "config", actor: "you", summary: "October change", at: "2026-10-31T23:00:00.000Z" });
  for (let i = 0; i < 5; i++) log.record({ kind: "assign", actor: "maya", summary: `Assigned T${i}`, target: `T${i}`, at: `2026-11-0${i + 1}T10:00:00.000Z` });
  log.record({ kind: "secret", actor: "you", summary: "  Set   the key\n for   Ada  ", at: "2026-11-06T10:00:00.000Z" });
  const dir = join(tmp, ".yacc", "audit-unit", "audit");
  ok("disk: one file per month", existsSync(join(dir, "2026-10.jsonl")) && existsSync(join(dir, "2026-11.jsonl")));
  writeFileSync(join(dir, "2026-11.jsonl"), readFileSync(join(dir, "2026-11.jsonl"), "utf8") + "not json\n{\"at\":1}\n");
  const all = log.read();
  ok("read: newest first, across months, bad lines skipped", all.entries.map((e) => e.summary).join("|") === "Set the key for Ada|Assigned T4|Assigned T3|Assigned T2|Assigned T1|Assigned T0|October change", all.entries.map((e) => e.summary));
  ok("record: summary on one line", all.entries[0].summary === "Set the key for Ada");
  const page = log.read({ limit: 2 });
  ok("page: limit and more", page.entries.length === 2 && page.more);
  const next = log.read({ limit: 3, before: page.entries[1].at });
  ok("page: before", next.entries.map((e) => e.target).join() === "T3,T2,T1");
  ok("filters: kind, actor, text", log.read({ kind: "assign" }).entries.length === 5 && log.read({ actor: "you" }).entries.length === 2 && log.read({ text: "t3" }).entries.length === 1);
  ok("empty: no folder, no entries", new AuditLog("audit-empty").read().entries.length === 0);
}
{
  const w = world();
  await Hub.as("you", async () => {
    await new Promise((r) => setTimeout(r, 5));
    w.cmds.updateAgent("ada", { model: "opus" });
  });
  ok("config: an entry with what changed and who", w.entries()[0].kind === "config" && w.entries()[0].actor === "you" && w.entries()[0].summary === "Changed Ada: model", w.entries()[0]);
  w.cmds.updateProject({ name: "Studio 2" });
  ok("config: outside any actor it's HQ", w.entries()[0].actor === "hq" && w.entries()[0].summary === "Changed project");
  const edited = parseConfig(STUDIO.replace("name: Studio }", "name: Studio }").replace("instructions: Edit.", "instructions: Edit hard."), () => null).config;
  w.hub.applyExternalConfig(edited);
  ok("config: a hand edit is config.yml's", w.entries()[0].actor === "config.yml" && /role Editor: instructions/.test(w.entries()[0].summary), w.entries()[0]);
  const t = w.planner.createTask({ title: "Scam calls" }, "maya");
  Hub.as("maya", () => w.planner.assign(t.id, "leo", "maya"));
  ok("assign: by the lead", w.entries()[0].kind === "assign" && w.entries()[0].actor === "maya" && w.entries()[0].target === t.id && /Assigned .* "Scam calls" to Leo/.test(w.entries()[0].summary));
  w.planner.completeStage("leo", "done");
  w.planner.completeStage("ada", "draft");
  w.planner.requestChanges("sam", t.id, "Shorter intro");
  ok("review: changes requested by the reviewer", w.entries()[0].kind === "review" && w.entries()[0].actor === "sam" && /Shorter intro/.test(w.entries()[0].summary));
  w.planner.completeStage("ada", "draft 2");
  w.planner.approveWork("sam", t.id);
  w.planner.completeStage("sam", "final");
  const item = w.hub.snap.actionItems?.find((i) => i.kind === "approval" && i.status === "open");
  w.cmds.resolveActionItem(item!.id, "done", "Lovely");
  ok("approval: yours, as the CEO", w.entries().some((e) => e.kind === "approval" && e.actor === "you" && /Approved Approve on/.test(e.summary)), w.entries().slice(0, 4));
  w.cmds.setSecret("ada", "anthropic", "sk-secret-value");
  ok("keys: recorded without the value", w.entries().some((e) => e.kind === "secret" && /anthropic key for Ada/.test(e.summary)) && !JSON.stringify(w.entries()).includes("sk-secret-value"));
  const all = w.entries().map((e) => e.kind);
  ok("kinds seen", ["config", "assign", "review", "approval", "secret"].every((k) => all.includes(k as never)), all);
  // Schedules run as themselves.
  const s = new Scheduler(w.hub, w.planner);
  w.cfg().schedules = [{ id: "ping", name: "Ping", enabled: true, every: "day", at: "09:00", action: "message", to: "lead", text: "Hi" }];
  s.runNow("ping");
  ok("schedule: run now is yours", w.entries()[0].kind === "schedule" && w.entries()[0].actor === "you");
}

// ------------------------------------------------------------------ 2. Retrospectives

{
  const d = lineDiff("a\nb\nc", "a\nB\nc\nd");
  ok("diff lines", d.map((l) => `${l.op[0]}${l.text}`).join(",") === "sa,rb,aB,sc,ad", d);
  ok("diff: same text, all same", lineDiff("x\ny", "x\ny").every((l) => l.op === "same"));
  const long = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  const folded = foldDiff(lineDiff(long, long.replace("line 10", "line ten")));
  ok("fold: long unchanged runs fold", folded.some((l) => l.op === "fold") && folded.filter((l) => l.op !== "fold").length === 2 + 2 + 2, folded.map((l) => l.op));
}
{
  const w = world();
  ok("tools: the lead can read and propose role changes and close boards", ["read_role", "propose_role_change", "update_board"].every((t) => toolsFor(w.cfg().roles[0]).includes(t)) && !toolsFor(w.cfg().roles[2]).includes("propose_role_change"));
  ok("role file: the lead is told", roleMd(w.cfg().team[0], w.cfg()).includes("propose_role_change"));
  const t = w.planner.createTask({ title: "Piece one" }, "maya");
  w.planner.updateTask(t.id, { status: "done" });
  w.retros.start();
  w.planner.updateBoard("B1", { status: "done" });
  await new Promise((r) => setImmediate(r));
  const prompt = w.inbox.find((m) => m.to === "maya" && m.text.startsWith("[Retrospective]"))?.text ?? "";
  ok("board done → the lead is asked", /The board "Backlog" is done/.test(prompt) && prompt.includes(`${t.id} Piece one`) && prompt.includes("propose_role_change"), prompt);
  ok("asked once per change to done", (w.planner.updateBoard("B1", { title: "Backlog!" }), true) && w.inbox.filter((m) => m.text.startsWith("[Retrospective]")).length === 1);
  ok("audit: the ask", w.entries().some((e) => e.kind === "retro" && /Asked for a retrospective/.test(e.summary)));
  ok("sent-back work is named", (() => {
    w.hub.snap.tasks[0].note = "Changes requested by Sam: x";
    return retroPrompt(w.hub, w.hub.snap.boards[0]).includes(`Sent back with changes at least once: ${t.id}.`);
  })());

  const actions = w.planner.actions!;
  await rejects("propose: unknown role", () => actions.addRoleChange("maya", "ghost", "x", "y"), /No role "ghost"/);
  await rejects("propose: no change", () => actions.addRoleChange("maya", "writer", "- Write.\n- Keep it short.", "y"), /already/);
  const first = actions.addRoleChange("maya", "writer", "- Write.\n- Keep it under 600 words.", "Drafts ran long");
  const second = actions.addRoleChange("maya", "writer", "- Write.\n- Keep it under 500 words.", "Drafts ran long twice");
  ok("propose: a newer one replaces the open one", first.status === "dismissed" && second.status === "open" && w.hub.snap.actionItems?.filter((i) => i.kind === "role-change" && i.status === "open").length === 1);
  ok("propose: the before and after are kept", second.payload?.before === "- Write.\n- Keep it short." && second.payload?.after === "- Write.\n- Keep it under 500 words.");
  w.inbox.length = 0;
  Hub.as("you", () => w.cmds.resolveActionItem(second.id, "done", "Good call"));
  ok("accept: the role's instructions change and are saved", w.cfg().roles.find((r) => r.id === "writer")?.instructions === "- Write.\n- Keep it under 500 words." && readFileSync(join(w.root, ".yacc", "roles", "writer.md"), "utf8").includes("under 500 words"));
  ok("accept: the lead hears, with your note", w.inbox.some((m) => m.to === "maya" && /accepted your change to the Writer role.*Good call/.test(m.text)));
  ok("accept: audited", w.entries().some((e) => e.kind === "retro" && e.actor === "you" && /Accepted the change to the Writer role/.test(e.summary)));
  const third = actions.addRoleChange("maya", "editor", "Edit harder.", "Too soft");
  w.cmds.resolveActionItem(third.id, "dismissed", "Not yet");
  ok("reject: nothing changes, the lead hears why", w.cfg().roles.find((r) => r.id === "editor")?.instructions === "Edit." && w.inbox.some((m) => /rejected your change to the Editor role.*Not yet/.test(m.text)));
  const fourth = actions.addRoleChange("maya", "researcher", "Find more.", "More");
  w.cfg().roles = w.cfg().roles.filter((r) => r.id !== "researcher");
  w.cfg().team = w.cfg().team.filter((a) => a.roleId !== "researcher");
  w.cmds.resolveActionItem(fourth.id, "done");
  ok("accept: a role that's gone isn't recreated", !w.cfg().roles.some((r) => r.id === "researcher") && w.inbox.some((m) => /no longer exists/.test(m.text)));
  w.cmds.updateWorkflow({ retrospective: false });
  ok("setting: off is saved", w.cfg().workflow.retrospective === false && /retrospective: false/.test(readFileSync(join(w.root, ".yacc", "config.yml"), "utf8")));
  w.planner.createBoard("Phase 2", "active");
  const b2 = w.hub.snap.boards[1];
  w.inbox.length = 0;
  w.planner.updateBoard(b2.id, { status: "done" });
  await new Promise((r) => setImmediate(r));
  ok("setting off: no automatic ask", !w.inbox.some((m) => m.text.startsWith("[Retrospective]")));
  w.cmds.requestRetrospective(b2.id);
  ok("ask for one anyway", w.inbox.some((m) => m.text.startsWith('[Retrospective] The board "Phase 2"')));
  w.cmds.updateWorkflow({ retrospective: true });
  ok("setting: on removes the key", !("retrospective" in w.cfg().workflow));
  w.retros.stop();
}

// ------------------------------------------------------------------ 3. Sharing templates

{
  const studio = BUILT_IN_TEMPLATES.find((t) => t.id === "content-studio")!;
  const bundle = B.templateToBundle(studio);
  ok("bundle: format and files for the template's skills", bundle.format === "yacc-template" && bundle.version === 1 && Object.keys(bundle.files).sort().join() === "skills/house-style/SKILL.md,skills/source-notes/SKILL.md");
  const { template, preview } = checkBundle(JSON.parse(JSON.stringify(bundle)));
  ok("check: a built-in's bundle reads back the same", template.name === studio.name && JSON.stringify(template.roles.map((r) => [r.id, r.can, r.instructions])) === JSON.stringify(studio.roles.map((r) => [r.id, r.can, r.instructions])) && JSON.stringify(template.stages) === JSON.stringify(studio.stages));
  ok("check: skills come back with their text", template.skills?.find((s) => s.name === "house-style")?.body.includes("# House style"));
  ok("check: schedules come back switched off", template.schedules?.length === 2 && template.schedules.every((s) => !s.enabled));
  ok("preview: what it adds", preview.team.length === 4 && preview.stages.join() === "Research,Script,Final edit" && preview.skills.join() === "source-notes,house-style" && preview.schedules.length === 2);
  ok("preview: notes on powers, schedules and skills", preview.notes.some((x) => /can hire and dismiss/.test(x)) && preview.notes.some((x) => /switched off/.test(x)) && preview.notes.some((x) => /Read them first/.test(x)));
  const bad = (patch: (b: B.TemplateBundle) => void) => {
    const b = structuredClone(bundle);
    patch(b);
    return b;
  };
  await rejects("check: not a template", () => checkBundle({ hello: 1 }), /isn't a YACC template/);
  await rejects("check: from a newer YACC", () => checkBundle(bad((b) => (b.version = 9))), /newer YACC/);
  await rejects("check: a file outside skills/", () => checkBundle(bad((b) => (b.files["../../.bashrc"] = "x"))), /won't write: \.\.\/\.\.\/\.bashrc/);
  await rejects("check: a path that climbs inside skills/", () => checkBundle(bad((b) => (b.files["skills/x/../../evil.md"] = "x"))), /won't write/);
  await rejects("check: an executable file", () => checkBundle(bad((b) => (b.files["skills/x/run.exe"] = "x"))), /won't write/);
  await rejects("check: not text", () => checkBundle(bad((b) => ((b.files as Record<string, unknown>)["skills/x/a.md"] = 5))), /isn't text/);
  await rejects("check: too large", () => checkBundle(bad((b) => (b.files["skills/x/big.md"] = "x".repeat(B.BUNDLE_MAX_BYTES)))), /too large/);
  await rejects("check: no lead", () => checkBundle(bad((b) => delete (b.template.roles as Record<string, unknown>).lead)), /needs a "lead" role/);
  await rejects("check: a skill without its file", () => checkBundle(bad((b) => delete b.files["skills/house-style/SKILL.md"])), /skills\/house-style\/SKILL\.md/);

  const root = join(tmp, "share");
  mkdirSync(join(root, ".yacc"), { recursive: true });
  const enabled = bad((b) => ((b.template.schedules as { enabled: boolean }[])[0].enabled = true));
  const first = installBundle(enabled, "project", root);
  ok("install: in .yacc/templates/<slug>", first.id === "project:content-studio" && existsSync(join(root, ".yacc", "templates", "content-studio", "template.yml")) && existsSync(join(root, ".yacc", "templates", "content-studio", "skills", "house-style", "SKILL.md")));
  ok("install: schedules switched off", !/enabled: true/.test(readFileSync(join(first.dir, "template.yml"), "utf8")));
  const second = installBundle(bundle, "project", root);
  ok("install: never over another", second.id === "project:content-studio-2");
  ok("install: offered with the others", listTemplates(root).templates.some((t) => t.id === "project:content-studio-2"));
  const mine = installBundle(bundle, "user", root);
  ok("install: for you, in ~/.yacc/templates", mine.id === "user:content-studio" && existsSync(join(tmp, ".yacc", "templates", "content-studio", "template.yml")));
  ok("no leftovers from a failed or finished install", !readdirSync(join(root, ".yacc", "templates")).some((f) => f.startsWith(".")));

  // P5's done-when: a template built in the UI (here, its commands) exports and re-imports cleanly.
  const w = world();
  w.cmds.addRole({ title: "Fact checker", can: ["work", "review"], instructions: "Check every claim." });
  w.cmds.updateWorkflow({ stages: [...w.cfg().workflow.stages.slice(0, 2), { id: "check", name: "Check", owner: "fact-checker", gate: "none", description: "Every claim has a source." }, w.cfg().workflow.stages[2]] });
  w.cmds.updateToolkits([{ id: "documents", roles: ["writer"] }]);
  w.cmds.saveProjectSkill({ name: "house-style", description: "Use when writing.", body: "# House\n- Short.", roles: ["writer"] });
  w.cmds.updateSchedules([{ id: "", name: "Weekly", enabled: true, every: "week", day: 5, at: "16:00", action: "message", to: "lead", text: "Report." }]);
  w.cmds.updateMessaging({ direct: "lines", team: "lead" });
  Hub.as("you", () => w.cmds.saveTemplate("Built in the UI", "project", "From the UI"));
  const id = "project:built-in-the-ui";
  const out = exportTemplate(id, w.root);
  const again = checkBundle(JSON.parse(JSON.stringify(out))).template;
  const cfg = w.cfg();
  ok("round trip: roles", JSON.stringify(again.roles.map((r) => [r.id, r.title, r.can, r.instructions]).sort()) === JSON.stringify(cfg.roles.map((r) => [r.id, r.title, r.can, r.instructions]).sort()));
  ok("round trip: stages with done-when", JSON.stringify(again.stages) === JSON.stringify(cfg.workflow.stages));
  ok("round trip: team, toolkits, skills, schedules (off)", again.team.length === cfg.team.length && JSON.stringify(again.toolkits) === JSON.stringify(cfg.toolkits) && again.skills?.[0].name === "house-style" && again.skills[0].body.includes("- Short.") && again.schedules?.[0].name === "Weekly");
  ok("audit: saving a template", w.entries().some((e) => e.kind === "template" && /Built in the UI/.test(e.summary)));
  const into = join(tmp, "elsewhere");
  mkdirSync(join(into, ".yacc"), { recursive: true });
  const installed = installBundle(out, "project", into);
  ok("round trip: installs in another project", readTemplate(installed.dir, "project").stages.length === 4);
  await rejects("delete: built-in", () => deleteTemplate("content-studio", root), /can't be deleted/);
  await rejects("delete: a path", () => deleteTemplate("project:../../x", root), /can't be deleted/);
  deleteTemplate("project:content-studio-2", root);
  ok("delete: gone", !listTemplates(root).templates.some((t) => t.id === "project:content-studio-2"));
  ok("export: a built-in", exportTemplate("rd-lab", root).template.name === "R&D Lab");
  await rejects("export: unknown", () => exportTemplate("project:nope", root), /No template/);
}
{
  ok("raw url: GitHub page links become file links", rawUrl("https://github.com/a/b/blob/main/templates/x.json") === "https://raw.githubusercontent.com/a/b/main/templates/x.json" && rawUrl(" https://x.test/y ") === "https://x.test/y");
  const fake = (status: number, body: string) => (async () => new Response(body, { status })) as unknown as typeof fetch;
  await rejects("fetch: https only", fetchJson("http://example.com/x.json", fake(200, "{}")), /https only/);
  await rejects("fetch: not a URL", fetchJson("nope", fake(200, "{}")), /isn't a URL/);
  await rejects("fetch: an error status", fetchJson("https://x.test/a.json", fake(404, "")), /answered 404/);
  await rejects("fetch: not JSON", fetchJson("https://x.test/a.json", fake(200, "<html>")), /isn't JSON/);
  await rejects("fetch: too large", fetchJson("https://x.test/a.json", fake(200, " ".repeat(B.BUNDLE_MAX_BYTES + 1))), /too large/);
  const seen: string[] = [];
  const gallery = (async (u: URL) => {
    seen.push(String(u));
    return new Response(JSON.stringify({ templates: [{ id: "a", name: "A", description: "d", url: "a.yacc-template.json", tags: ["x", 3] }, { name: "B", url: "https://other.test/b.json" }, { url: "no-name.json" }] }));
  }) as unknown as typeof fetch;
  const list = await readGallery("https://github.com/o/r/blob/main/templates/index.json", gallery);
  ok("gallery: fetched from the raw file", seen[0] === "https://raw.githubusercontent.com/o/r/main/templates/index.json");
  ok("gallery: relative URLs made absolute, junk dropped", list.length === 2 && list[0].url === "https://raw.githubusercontent.com/o/r/main/templates/a.yacc-template.json" && list[1].url === "https://other.test/b.json" && JSON.stringify(list[0].tags) === '["x"]' && list[1].id === "b");
}
{
  // The public gallery in this repo: every template reads, and the bundles are up to date.
  const dir = join(import.meta.dirname, "..", "templates");
  const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as { templates: { id: string; url: string }[] };
  ok("gallery: has templates", index.templates.length >= 3);
  for (const e of index.templates) {
    const raw = JSON.parse(readFileSync(join(dir, e.url), "utf8"));
    const { template, preview } = checkBundle(raw);
    ok(`gallery ${e.id}: installs`, template.team.length >= 2 && preview.roles.length >= 2);
    ok(`gallery ${e.id}: bundle matches its folder`, JSON.stringify(B.templateToBundle(readTemplate(join(dir, e.id), "user"), skillFiles(join(dir, e.id)))) === JSON.stringify(raw));
  }
  execFileSync(process.execPath, [...process.execArgv, join(import.meta.dirname, "build-gallery.ts"), "--check"], { stdio: "pipe" });
  ok("gallery: build --check passes", true);
}

// ------------------------------------------------------------------ 4. Projects

{
  const servers: Server[] = [];
  const serve = (port: number) =>
    new Promise<void>((resolve) => {
      const s = createServer((req, res) => res.end(req.url === "/api/health" ? '{"ok":true}' : "")).listen(port, "127.0.0.1", () => resolve());
      servers.push(s);
    });
  const repoA = join(tmp, "proj-a");
  const repoB = join(tmp, "proj-b");
  const repoC = join(tmp, "proj-c");
  for (const r of [repoA, repoB, repoC]) {
    mkdirSync(r, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: r });
  }
  const portA = 7600 + (process.pid % 100);
  registerProject("proj-a", "A", repoA, portA, "tok-a");
  ok("register: on the list, with how to reach it (only you can read it)", existsSync(join(tmp, ".yacc", "projects.json")) && JSON.parse(readFileSync(join(tmp, ".yacc", "proj-a", "session.json"), "utf8")).token === "tok-a");
  if (process.platform !== "win32") ok("register: session file is 0600", (statSync(join(tmp, ".yacc", "proj-a", "session.json")).mode & 0o777) === 0o600);
  // B was opened once, then stopped: its session file names a dead process.
  registerProject("proj-b", "B", repoB, portA + 1, "tok-b-old");
  writeFileSync(join(tmp, ".yacc", "proj-b", "session.json"), JSON.stringify({ pid: 999999, port: portA + 1, token: "old", startedAt: new Date(0).toISOString() }));
  let list = await listProjects("proj-a");
  ok("list: this one first and running, B stopped", list[0].slug === "proj-a" && list[0].current && list[0].running && list.find((p) => p.slug === "proj-b")?.running === false, list);
  // Opening B starts it: the fake launcher plays HQ (registers, answers health).
  const launches: string[] = [];
  const launcher = (root: string, port: number) => {
    launches.push(`${root}:${port}`);
    setTimeout(() => {
      void serve(port).then(() => registerProject(root === repoB ? "proj-b" : "proj-c", root === repoB ? "B" : "C", root, port, `tok-${port}`));
    }, 200);
  };
  const opened = await openProject({ slug: "proj-b" }, "proj-a", launcher);
  ok("open a stopped one: started, then its address", opened.started && launches[0].startsWith(repoB) && /^http:\/\/127\.0\.0\.1:\d+\/\?token=tok-\d+$/.test(opened.url), opened);
  list = await listProjects("proj-a");
  ok("list: B now running", list.find((p) => p.slug === "proj-b")?.running);
  const again = await openProject({ slug: "proj-b" }, "proj-a", launcher);
  ok("open a running one: no new start", !again.started && launches.length === 1 && again.url === opened.url);
  const added = await openProject({ root: repoC }, "proj-a", launcher);
  ok("add by folder: started and on the list", added.started && added.slug === "proj-c" && (await listProjects("proj-a")).some((p) => p.slug === "proj-c"));
  await rejects("add: not a git repo", openProject({ root: tmp + "/nope" }, "proj-a", launcher), /isn't inside a git repository/);
  await rejects("open: unknown", openProject({ slug: "ghost" }, "proj-a", launcher), /No project ghost/);
  await rejects("forget: the current one", forgetProject("proj-a", "proj-a"), /you're in/);
  await rejects("forget: a running one", forgetProject("proj-b", "proj-a"), /It's running/);
  for (const s of servers) s.close();
  await new Promise((r) => setTimeout(r, 100));
  await forgetProject("proj-b", "proj-a");
  ok("forget: off the list, files kept", !(await listProjects("proj-a")).some((p) => p.slug === "proj-b") && existsSync(repoB));
  unregisterSession("proj-a");
  ok("stop: the session file goes", !existsSync(join(tmp, ".yacc", "proj-a", "session.json")));
}

// ------------------------------------------------------------------ 5. HTTP

{
  const w = world();
  w.hub.audit("config", "Changed something", undefined, "you");
  const port = 7700 + (process.pid % 90);
  const stub = {} as never;
  const server = await startHttp({ hub: w.hub, inbox: stub, planner: w.planner, team: stub, mcpExtras: stub, port, browserToken: "b", agentToken: "a", distDir: null, allowedOrigins: [], commands: {}, audit: w.hub.auditLog! });
  const at = (p: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${p}`, init);
  const post = (p: string, body: unknown) => at(p, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  try {
    ok("audit: token needed", (await at("/api/audit")).status === 401 && (await at("/api/audit?token=a")).status === 401);
    const r = (await (await at("/api/audit?token=b&kind=config")).json()) as { entries: { summary: string }[] };
    ok("audit: JSON, filtered", r.entries.length >= 1 && r.entries.every((e) => typeof e.summary === "string"));
    const csv = await at("/api/audit?token=b&format=csv");
    ok("audit: CSV download", csv.headers.get("content-type")?.startsWith("text/csv") && (await csv.text()).startsWith("at,kind,actor,target,summary"));
    const bundle = B.templateToBundle(BUILT_IN_TEMPLATES[2]);
    ok("templates: token needed", (await post("/api/templates/preview", { bundle })).status === 401);
    const pv = (await (await post("/api/templates/preview?token=b", { bundle })).json()) as { preview: B.TemplatePreview };
    ok("templates: preview", pv.preview.name === "R&D Lab");
    const badPv = await post("/api/templates/preview?token=b", { bundle: { format: "nope" } });
    ok("templates: a bad bundle is a 400 with the reason", badPv.status === 400 && /isn't a YACC template/.test(((await badPv.json()) as { error: string }).error));
    const im = (await (await post("/api/templates/import?token=b", { bundle, where: "project" })).json()) as { id: string };
    ok("templates: import, offered and audited", im.id === "project:r-d-lab" && w.hub.snap.templates?.some((t) => t.id === "project:r-d-lab") && w.entries().some((e) => e.kind === "template" && /Installed the template "R&D Lab"/.test(e.summary)));
    const ex = await at(`/api/templates/export?token=b&id=${encodeURIComponent(im.id)}`);
    ok("templates: export as an attachment", /r-d-lab\.yacc-template\.json/.test(ex.headers.get("content-disposition") ?? "") && ((await ex.json()) as B.TemplateBundle).format === "yacc-template");
    ok("templates: delete", (await post("/api/templates/delete?token=b", { id: im.id })).status === 200 && !w.hub.snap.templates?.some((t) => t.id === im.id));
    ok("projects: token needed, then the list", (await at("/api/projects")).status === 401 && Array.isArray(((await (await at("/api/projects?token=b")).json()) as { projects: unknown[] }).projects));
    const op = await post("/api/projects/open?token=b", { root: join(tmp, "nope") });
    ok("projects: errors are 400 with the reason", op.status === 400 && /git repository/.test(((await op.json()) as { error: string }).error));
  } finally {
    server.close();
  }
}

// Windows may still hold a file open for a moment (the skills cache); leftovers in the temp folder are harmless.
try {
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch {
  /* ignore */
}
console.log(`hardening: ${passed} checks passed`);
void ({} as HqConfig);
