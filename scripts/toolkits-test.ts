// Toolkits and the team's own skills (Phase 6 part 1): the catalog, choices in config.yml, what
// each agent gets (skills, MCP servers, its role file), project skills on disk, copying skills into
// agents' folders, the commands, the HTTP route, and templates that bring toolkits and skills.
// The skills CLI isn't run: the cache it would fill is laid out by hand.
//
//   npx tsx scripts/toolkits-test.ts

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "yacc-toolkits-"));
Object.assign(process.env, { HOME: tmp, USERPROFILE: tmp });

const { roleMd } = await import("../server/agentFiles");
const { makeCommands } = await import("../server/commands");
const { Hub } = await import("../server/hub");
const { startHttp } = await import("../server/http");
const { listProjectSkills, projectSkillSources, readProjectSkill, removeProjectSkill, writeProjectSkill } = await import("../server/projectSkills");
const { MCP_NAME } = await import("../server/sbxMcp");
const { cacheDir, syncSkillsInto } = await import("../server/skills");
const { parseConfig, serializeConfig } = await import("../server/store");
const { readTemplate, saveTemplate } = await import("../server/templates");
const { mcpFor, requiredChecks } = await import("../src/data/models");
const { normalizeConfig } = await import("../src/data/roles");
const { BUILT_IN_TEMPLATES } = await import("../src/data/templates");
const T = await import("../src/data/toolkits");
import type { SkillSpec } from "../src/data/stack";
import type { HqConfig, SetupState } from "../src/data/types";
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
team:
  - { id: maya, name: Maya, role: lead, mode: local }
  - { id: leo, name: Leo, role: researcher, mode: local }
  - { id: ada, name: Ada, role: writer, mode: local }
  - { id: sam, name: Sam, role: editor, mode: sandbox }
toolkits:
  - documents
  - { id: web-research, roles: [researcher] }
  - { id: writing, roles: [writer, editor, nobody] }
  - nonsense
  - documents
skills:
  - { name: house-style, roles: [writer, editor] }
  - source-notes
  - { name: Bad_Name }
workflow:
  item: Piece
  deliverable: files
  stages:
    - { name: Research, owner: researcher }
    - { name: Script, owner: writer, gate: review, reviewer: editor }
  review: { enabled: false, tool: human }
  merge: { by: human }
  deploy: { enabled: false, tool: custom }
`;
const setup = { machine: { cpus: 4, memoryGb: 8 }, checks: [], sandboxReady: false, localReady: true, checkedAt: "" } as SetupState;
const agent = (cfg: HqConfig, id: string) => cfg.team.find((a) => a.id === id)!;

// ------------------------------------------------------------------ 1. The catalog

ok("catalog: unique ids", new Set(T.TOOLKIT_CATALOG.map((t) => t.id)).size === T.TOOLKIT_CATALOG.length);
ok("catalog: every toolkit is in a group that's shown", T.TOOLKIT_CATALOG.every((t) => T.TOOLKIT_GROUPS.some((g) => g.id === t.group)));
ok("catalog: every group has a toolkit", T.TOOLKIT_GROUPS.every((g) => T.TOOLKIT_CATALOG.some((t) => t.group === g.id)));
ok("catalog: each toolkit brings something", T.TOOLKIT_CATALOG.every((t) => t.skills.length || t.mcp.length));
ok("catalog: skill sources are owner/repo and names are valid", T.TOOLKIT_CATALOG.every((t) => t.skills.every((sp) => /^[\w.-]+\/[\w.-]+$/.test(sp.source) && sp.skills.every((n) => T.SKILL_NAME.test(n)))));
ok("catalog: MCP names are valid sbx names", T.TOOLKIT_CATALOG.every((t) => t.mcp.every((n) => MCP_NAME.test(n))));
ok("catalog: notes and descriptions are filled in", T.TOOLKIT_CATALOG.every((t) => t.note.length > 20 && t.description.length > 15 && t.name));
ok("catalog: web research is Perplexity", T.toolkit("web-research")?.mcp.join() === "perplexity");

// ------------------------------------------------------------------ 2. Cleaning choices

const roleIds = ["lead", "researcher", "writer", "editor"];
{
  const kits = T.cleanToolkits(["documents", { id: "web-research", roles: ["researcher", "researcher", "ghost"] }, "nope", "documents", { id: "writing", roles: [] }, { id: "visual-design", roles: ["ghost"] }, 7, null], roleIds);
  ok("toolkits: a bare id is every role", kits[0].id === "documents" && !kits[0].roles);
  ok("toolkits: roles deduplicated, unknown ones dropped", JSON.stringify(kits[1]) === JSON.stringify({ id: "web-research", roles: ["researcher"] }));
  ok("toolkits: unknown ids and duplicates dropped", kits.map((k) => k.id).join() === "documents,web-research,writing", kits);
  ok("toolkits: an empty roles list is every role", !kits[2].roles);
  ok("toolkits: roles that all vanished drop the choice (it doesn't spread to everyone)", !kits.some((k) => k.id === "visual-design"));
  ok("toolkits: not a list → none", T.cleanToolkits("documents", roleIds).length === 0 && T.cleanToolkits(undefined, roleIds).length === 0);
  const own = T.cleanProjectSkills(["house-style", { name: "house-style" }, { name: "Bad Name" }, { name: "../x" }, { name: "notes", roles: ["writer"] }, { name: "gone", roles: ["ghost"] }], roleIds);
  ok("skills: valid names once each, roles kept", JSON.stringify(own) === JSON.stringify([{ name: "house-style" }, { name: "notes", roles: ["writer"] }]), own);
  ok("yaml shorthand: every role → a bare id", JSON.stringify(T.toolkitsYaml(kits)) === JSON.stringify(["documents", { id: "web-research", roles: ["researcher"] }, "writing"]));
  ok("yaml shorthand: skills too", JSON.stringify(T.projectSkillsYaml(own)) === JSON.stringify(["house-style", { name: "notes", roles: ["writer"] }]));
}

// ------------------------------------------------------------------ 3. config.yml

{
  const { config, fixed } = parseConfig(STUDIO, () => null);
  ok("yaml: toolkits read and cleaned", JSON.stringify(config.toolkits) === JSON.stringify([{ id: "documents" }, { id: "web-research", roles: ["researcher"] }, { id: "writing", roles: ["writer", "editor"] }]), config.toolkits);
  ok("yaml: project skills read and cleaned", JSON.stringify(config.skills) === JSON.stringify([{ name: "house-style", roles: ["writer", "editor"] }, { name: "source-notes" }]), config.skills);
  void fixed;
  const { yaml } = serializeConfig(config);
  ok("yaml: written back in short form", /toolkits:\n  - documents\n  - id: web-research\n    roles:\n      - researcher/.test(yaml) && /skills:\n  - name: house-style[\s\S]*  - source-notes/.test(yaml), yaml.slice(yaml.indexOf("toolkits:"), yaml.indexOf("toolkits:") + 300));
  const back = parseConfig(yaml, () => null).config;
  ok("yaml: round trip", JSON.stringify(back.toolkits) === JSON.stringify(config.toolkits) && JSON.stringify(back.skills) === JSON.stringify(config.skills));
  const none = parseConfig(STUDIO.replace(/toolkits:[\s\S]*?workflow:/, "workflow:"), () => null).config;
  ok("yaml: none → no keys", !("toolkits" in none) && !("skills" in none) && !/toolkits:|^skills:/m.test(serializeConfig(none).yaml));
  // A role removed: choices only it had go; mixed ones keep the other roles.
  const cut = structuredClone(config);
  cut.roles = cut.roles.filter((r) => r.id !== "researcher");
  cut.team = cut.team.filter((a) => a.roleId !== "researcher");
  normalizeConfig(cut);
  ok("normalize: a removed role's only toolkit goes", !cut.toolkits?.some((k) => k.id === "web-research"));
  const cut2 = structuredClone(config);
  cut2.roles = cut2.roles.filter((r) => r.id !== "editor");
  cut2.team = cut2.team.filter((a) => a.roleId !== "editor");
  normalizeConfig(cut2);
  ok("normalize: a shared one keeps the other roles", JSON.stringify(cut2.toolkits?.find((k) => k.id === "writing")) === JSON.stringify({ id: "writing", roles: ["writer"] }) && JSON.stringify(cut2.skills?.[0]) === JSON.stringify({ name: "house-style", roles: ["writer"] }));
}

// ------------------------------------------------------------------ 4. What each agent gets

{
  const cfg = parseConfig(STUDIO, () => null).config;
  const names = (id: string) => T.toolkitsFor(agent(cfg, id), cfg).map((t) => t.id).join();
  ok("per role: the researcher", names("leo") === "documents,web-research");
  ok("per role: the writer", names("ada") === "documents,writing");
  ok("per role: the lead (only what's for every role)", names("maya") === "documents");
  ok("per role: project skills", T.projectSkillsFor(agent(cfg, "ada"), cfg).join() === "house-style,source-notes" && T.projectSkillsFor(agent(cfg, "leo"), cfg).join() === "source-notes");
  const specs = T.skillSpecsFor(agent(cfg, "ada"), cfg);
  ok("skills: merged per source, sorted", JSON.stringify(specs) === JSON.stringify([{ source: "anthropics/skills", skills: ["doc-coauthoring", "docx", "internal-comms", "pdf", "pptx", "xlsx"] }]), specs);
  const withStack = { ...cfg, stack: { frameworks: [{ id: "nextjs" }], tools: {} } };
  const both = T.skillSpecsFor(agent(cfg, "leo"), withStack);
  ok("skills: the coding stack's for every role, alongside the toolkits'", both.some((s) => s.source === "vercel/next.js") && both.some((s) => s.source === "anthropics/skills"), both);
  ok("MCP: Perplexity for the researcher only", mcpFor(agent(cfg, "leo"), cfg).includes("perplexity") && !mcpFor(agent(cfg, "ada"), cfg).includes("perplexity"));
  ok("MCP: on top of the role's tools and the agent's own", (() => {
    const c = structuredClone(cfg);
    c.roles.find((r) => r.id === "researcher")!.tools = ["exa"];
    agent(c, "leo").mcp = ["notion"];
    return mcpFor(agent(c, "leo"), c).join() === "notion,exa,perplexity";
  })());
  ok("setup: a Local researcher with web research needs the Perplexity key", requiredChecks(agent(cfg, "leo"), cfg).includes("perplexity-env") && !requiredChecks(agent(cfg, "ada"), cfg).includes("perplexity-env"));
  const sets = T.teamSkillSets(cfg);
  ok("cache sets: one per distinct set of skills (the lead and the researcher share one)", sets.length === 2, sets.map((s) => s[0].skills.join("+")));

  const skills = [
    { name: "house-style", description: "Use when writing: the studio's voice.", problem: null },
    { name: "source-notes", description: "Use when researching.", problem: "SKILL.md needs a description" },
  ];
  const md = T.toolkitsRoleMd(agent(cfg, "ada"), cfg, skills);
  ok("role file section: toolkit notes", md.startsWith("## Your tools\n") && md.includes(T.toolkit("documents")!.note) && md.includes(T.toolkit("writing")!.note));
  ok("role file section: valid team skills with their description", md.includes("- house-style (the team's own skill): Use when writing: the studio's voice."));
  ok("role file section: broken skills left out", !md.includes("source-notes"));
  ok("role file section: nothing → empty", T.toolkitsRoleMd(agent(cfg, "maya"), { ...cfg, toolkits: [] }, skills) === "");
  const file = roleMd(agent(cfg, "ada"), cfg, { projectSkills: skills });
  ok("role file: has the section", file.includes("## Your tools") && file.includes("house-style"));
  ok("role file: the researcher's differs from the writer's", !roleMd(agent(cfg, "leo"), cfg, { projectSkills: skills }).includes("Writing:") && roleMd(agent(cfg, "leo"), cfg, { projectSkills: skills }).includes("Web research:"));
}

// ------------------------------------------------------------------ 5. SKILL.md

{
  const text = T.skillMd("house-style", "Use when writing: the \"voice\"\nand length.", "# House style\n\n- Short.\n");
  ok("SKILL.md: front matter, quoted description on one line", text.startsWith('---\nname: house-style\ndescription: "Use when writing: the \\"voice\\" and length."\n---\n\n# House style'), text);
  const back = T.parseSkillMd(text)!;
  ok("SKILL.md: parsed back", back.name === "house-style" && back.description === 'Use when writing: the "voice" and length.' && back.body.startsWith("# House style"));
  const hand = T.parseSkillMd("---\nname: notes\ndescription: 'Use when it''s time for notes.'\nlicense: MIT\n---\nBody here\n")!;
  ok("SKILL.md: hand-written, single quotes, other keys", hand.name === "notes" && hand.description === "Use when it's time for notes." && hand.body === "Body here\n", hand);
  ok("SKILL.md: no front matter → null", T.parseSkillMd("# Just markdown") === null);
}

// ------------------------------------------------------------------ 6. Project skills on disk

{
  const root = join(tmp, "disk");
  mkdirSync(join(root, ".yacc"), { recursive: true });
  ok("disk: no folder → none", listProjectSkills(root).length === 0);
  writeProjectSkill(root, "house-style", "Use when writing.", "# House style\n- Short.");
  ok("disk: written to .yacc/skills/<name>/SKILL.md", existsSync(join(root, ".yacc", "skills", "house-style", "SKILL.md")));
  ok("disk: listed", JSON.stringify(listProjectSkills(root)) === JSON.stringify([{ name: "house-style", description: "Use when writing.", problem: null }]));
  ok("disk: read for editing", readProjectSkill(root, "house-style")?.body.startsWith("# House style"));
  writeFileSync(join(root, ".yacc", "skills", "house-style", "examples.md"), "extra");
  writeProjectSkill(root, "house-style", "Use when writing or editing.", "# House style v2");
  ok("disk: rewriting keeps other files in the folder", existsSync(join(root, ".yacc", "skills", "house-style", "examples.md")) && readProjectSkill(root, "house-style")?.description === "Use when writing or editing.");
  const bad: [string, () => void, RegExp][] = [
    ["bad name", () => writeProjectSkill(root, "House Style", "d", "b"), /lowercase/],
    ["path escape", () => writeProjectSkill(root, "../evil", "d", "b"), /lowercase/],
    ["no description", () => writeProjectSkill(root, "x", "  ", "b"), /description/],
    ["no body", () => writeProjectSkill(root, "x", "d", " "), /instructions/],
    ["body too long", () => writeProjectSkill(root, "x", "d", "y".repeat(T.SKILL_BODY_MAX + 1)), /longer/],
    ["description too long", () => writeProjectSkill(root, "x", "d".repeat(T.SKILL_DESCRIPTION_MAX + 1), "b"), /longer/],
  ];
  for (const [label, fn, msg] of bad) {
    let err = "";
    try {
      fn();
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    ok(`disk: refused (${label})`, msg.test(err), err);
  }
  ok("disk: nothing written outside", !existsSync(join(root, ".yacc", "evil")) && !existsSync(join(root, ".yacc", "skills", "x")));
  const base = join(root, ".yacc", "skills");
  mkdirSync(join(base, "empty"));
  mkdirSync(join(base, "nodesc"));
  writeFileSync(join(base, "nodesc", "SKILL.md"), "---\nname: nodesc\n---\nBody");
  mkdirSync(join(base, "wrong"));
  writeFileSync(join(base, "wrong", "SKILL.md"), "---\nname: other\ndescription: Something.\n---\nBody");
  mkdirSync(join(base, "Upper"));
  writeFileSync(join(base, "notes.md"), "a file, not a folder");
  const listed = listProjectSkills(root);
  const problem = (n: string) => listed.find((s) => s.name === n)?.problem ?? "";
  ok("disk: no SKILL.md", /no SKILL\.md/.test(problem("empty")));
  ok("disk: no description", /needs a description/.test(problem("nodesc")));
  ok("disk: name doesn't match the folder", /must match the folder/.test(problem("wrong")));
  ok("disk: bad folder name", /lowercase/.test(problem("Upper")));
  ok("disk: stray files ignored", !listed.some((s) => s.name === "notes.md"));
  ok("sources: only valid skills that are chosen", projectSkillSources(root, ["house-style", "empty", "wrong", "missing"]).map((s) => s.name).join() === "house-style");
  removeProjectSkill(root, "../.."); // refused quietly
  ok("remove: never outside .yacc/skills", existsSync(join(root, ".yacc")));
  removeProjectSkill(root, "house-style");
  ok("remove: the folder goes", !existsSync(join(base, "house-style")));
}

// ------------------------------------------------------------------ 7. Copying skills into an agent's folder

{
  const slug = `tk-${process.pid}`;
  const root = join(tmp, "copy");
  const ws = join(tmp, "copy-ws");
  mkdirSync(join(root, ".yacc"), { recursive: true });
  mkdirSync(ws, { recursive: true });
  // What `npx skills add` would have left in the cache.
  const specs: SkillSpec[] = [{ source: "anthropics/skills", skills: ["docx", "pdf"] }];
  const cache = cacheDir(slug, specs);
  for (const sub of [".claude/skills", ".agents/skills"]) for (const n of ["docx", "pdf"]) {
    mkdirSync(join(cache, sub, n), { recursive: true });
    writeFileSync(join(cache, sub, n, "SKILL.md"), `---\nname: ${n}\ndescription: registry ${n}\n---\n`);
  }
  writeProjectSkill(root, "house-style", "Use when writing.", "ours");
  writeProjectSkill(root, "pdf", "Our own PDF rules.", "ours wins");
  ok("cache: one folder per set of skills", cacheDir(slug, specs) !== cacheDir(slug, [{ source: "anthropics/skills", skills: ["docx"] }]) && cacheDir(slug, specs) === cacheDir(slug, structuredClone(specs)));
  // The agent already has a skill of its own HQ must leave alone.
  mkdirSync(join(ws, ".claude", "skills", "mine"), { recursive: true });
  writeFileSync(join(ws, ".claude", "skills", "mine", "SKILL.md"), "mine");
  const copied = await syncSkillsInto(slug, ws, specs, projectSkillSources(root, ["house-style", "pdf"]));
  ok("copy: registry and team skills, for Claude Code and Codex", [".claude/skills/docx", ".claude/skills/pdf", ".claude/skills/house-style", ".agents/skills/docx", ".agents/skills/house-style"].every((p) => copied.includes(p) && existsSync(join(ws, p, "SKILL.md"))), copied);
  ok("copy: the team's skill wins over a registry skill with its name", readFileSync(join(ws, ".claude", "skills", "pdf", "SKILL.md"), "utf8").includes("ours wins"));
  ok("copy: the agent's own skill is untouched", readFileSync(join(ws, ".claude", "skills", "mine", "SKILL.md"), "utf8") === "mine" && !copied.some((p) => p.endsWith("/mine")));
  ok("copy: listed once each", new Set(copied).size === copied.length);
  // The writer loses the house style: its copy goes, the rest stays.
  const after = await syncSkillsInto(slug, ws, specs, []);
  ok("copy: a skill no longer chosen is removed", !existsSync(join(ws, ".claude", "skills", "house-style")) && !after.includes(".claude/skills/house-style"));
  ok("copy: the registry pdf is back once ours is gone", readFileSync(join(ws, ".claude", "skills", "pdf", "SKILL.md"), "utf8").includes("registry pdf"));
  // The registry couldn't be reached: keep what's there.
  const kept = await syncSkillsInto(slug, ws, [{ source: "anthropics/skills", skills: ["xlsx"] }], [], true);
  ok("copy: when installing failed, earlier skills stay", existsSync(join(ws, ".claude", "skills", "docx")) && kept.includes(".claude/skills/docx"));
  const cleared = await syncSkillsInto(slug, ws, [], []);
  ok("copy: nothing chosen → HQ's copies removed, the agent's own kept", !existsSync(join(ws, ".claude", "skills", "docx")) && cleared.length === 0 && existsSync(join(ws, ".claude", "skills", "mine")));
  ok("copy: git-excluded", !existsSync(join(ws, ".git")) || readFileSync(join(ws, ".git", "info", "exclude"), "utf8").includes(".claude/skills"));
}

// ------------------------------------------------------------------ 8. Commands

function world(yaml = STUDIO, welcome = false) {
  const root = join(tmp, `w${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(join(root, ".yacc"), { recursive: true });
  const repo: RepoInfo = { root, name: "w", originUrl: null, github: null, hasCodeRabbit: false, hasInsta: false };
  const config = parseConfig(yaml, () => null).config;
  config.project.path = root;
  const hub = new Hub(repo, `tk-${process.pid}-${Math.random().toString(36).slice(2, 6)}`, config, { boards: [{ id: "B1", title: "Backlog", status: "active", order: 0 }], tasks: [] }, setup);
  if (welcome) hub.snap.welcome = true;
  const events: string[] = [];
  const emit = hub.emit.bind(hub);
  hub.emit = (e) => {
    events.push(e.type);
    emit(e);
  };
  let brief = "";
  const synced: string[] = [];
  const stub = {} as never;
  const cmds = makeCommands(
    hub,
    { recheckSetup: async () => undefined } as never,
    stub,
    { refresh: async () => undefined } as never,
    { syncTeam: async () => void synced.push("team"), syncRole: async () => undefined } as never,
    stub,
    { briefings: stub, memory: { read: () => ({ brief }), set: (m: { brief: string }) => void (brief = m.brief) } as never },
  );
  return { hub, root, cmds, events, synced, cfg: () => hub.snap.config, yml: () => readFileSync(join(root, ".yacc", "config.yml"), "utf8") };
}

{
  const { cmds, cfg, yml, synced, hub } = world();
  cmds.updateToolkits([{ id: "documents" }, { id: "visual-design", roles: ["editor"] }]);
  ok("updateToolkits: saved", JSON.stringify(cfg().toolkits) === JSON.stringify([{ id: "documents" }, { id: "visual-design", roles: ["editor"] }]) && /- id: visual-design/.test(yml()));
  ok("updateToolkits: MCP changed (web research gone) → sandboxes synced", synced.length === 1);
  cmds.updateToolkits([{ id: "documents" }, { id: "visual-design", roles: ["editor"] }]);
  ok("updateToolkits: no change, no work", synced.length === 1);
  cmds.updateToolkits([{ id: "documents" }, { id: "visual-design", roles: ["writer"] }]);
  ok("updateToolkits: skills-only change doesn't touch MCP", synced.length === 1 && cfg().toolkits?.[1].roles?.join() === "writer");
  cmds.updateToolkits([]);
  ok("updateToolkits: none → key removed", !("toolkits" in cfg()) && !/^toolkits:/m.test(yml()));

  cmds.saveProjectSkill({ name: "brand-voice", description: "Use when writing anything public.", body: "# Brand voice\n- Warm, plain.", roles: ["writer"] });
  ok("saveProjectSkill: folder written", existsSync(join(hub.repo.root, ".yacc", "skills", "brand-voice", "SKILL.md")));
  ok("saveProjectSkill: a new skill goes to the roles given", JSON.stringify(cfg().skills?.find((c) => c.name === "brand-voice")) === JSON.stringify({ name: "brand-voice", roles: ["writer"] }));
  ok("saveProjectSkill: the browser hears about it", hub.snap.projectSkills?.some((s) => s.name === "brand-voice") && hub.snap.activity[0].text.includes("Added the skill brand-voice"));
  cmds.updateProjectSkills([{ name: "brand-voice", roles: ["writer", "editor"] }]);
  cmds.saveProjectSkill({ name: "brand-voice", description: "Use when writing anything public, including posts.", body: "# v2" });
  ok("saveProjectSkill: editing keeps who has it", JSON.stringify(cfg().skills) === JSON.stringify([{ name: "brand-voice", roles: ["writer", "editor"] }]) && readProjectSkill(hub.repo.root, "brand-voice")?.body.trim() === "# v2");
  cmds.saveProjectSkill({ name: "Brand Voice!", description: "x", body: "y" });
  ok("saveProjectSkill: a bad name is refused and you're told", /Skill not saved: .*lowercase/.test(hub.snap.activity[0].text), hub.snap.activity[0].text);
  cmds.saveProjectSkill({ name: "everyone", description: "Use always.", body: "z" });
  ok("saveProjectSkill: no roles → every role", JSON.stringify(cfg().skills?.find((c) => c.name === "everyone")) === JSON.stringify({ name: "everyone" }));
  cmds.removeProjectSkill("brand-voice");
  ok("removeProjectSkill: folder and config entry gone", !existsSync(join(hub.repo.root, ".yacc", "skills", "brand-voice")) && !cfg().skills?.some((c) => c.name === "brand-voice"));
  cmds.updateProjectSkills([{ name: "everyone", roles: ["ghost"] }]);
  ok("updateProjectSkills: roles that don't exist drop it", !("skills" in cfg()));
  writeProjectSkill(hub.repo.root, "by-hand", "Made in an editor.", "body");
  ok("refresh: a folder made by hand appears after a rescan", !hub.snap.projectSkills?.some((s) => s.name === "by-hand") && (cmds.refreshProjectSkills(), hub.snap.projectSkills?.some((s) => s.name === "by-hand")));
}

// ------------------------------------------------------------------ 9. HTTP

{
  const { hub, root } = world();
  writeProjectSkill(root, "house-style", "Use when writing.", "# Rules");
  const port = 7800 + (process.pid % 90);
  const stub = {} as never;
  const server = await startHttp({ hub, inbox: stub, planner: stub, team: stub, mcpExtras: stub, port, browserToken: "b-tok", agentToken: "a-tok", distDir: null, allowedOrigins: [], commands: {} });
  try {
    const at = (p: string) => fetch(`http://127.0.0.1:${port}${p}`);
    ok("http: no token → 401", (await at("/skills/house-style")).status === 401);
    ok("http: agent token → 401", (await at("/skills/house-style?token=a-tok")).status === 401);
    const r = await at("/skills/house-style?token=b-tok");
    const body = (await r.json()) as { name: string; description: string; body: string };
    ok("http: the skill as JSON", r.status === 200 && body.name === "house-style" && body.description === "Use when writing." && body.body.trim() === "# Rules");
    ok("http: unknown → 404", (await at("/skills/nope?token=b-tok")).status === 404);
    ok("http: no way out", (await at("/skills/..%2F..%2Fconfig.yml?token=b-tok")).status === 404);
  } finally {
    server.close();
  }
}

// ------------------------------------------------------------------ 10. Templates

for (const t of BUILT_IN_TEMPLATES) {
  const ids = t.roles.map((r) => r.id);
  ok(`${t.name}: toolkits name roles it has`, (t.toolkits ?? []).every((c) => T.toolkit(c.id) && (c.roles ?? []).every((r) => ids.includes(r))), t.toolkits);
  ok(`${t.name}: skills are valid and name roles it has`, (t.skills ?? []).every((s) => T.SKILL_NAME.test(s.name) && s.description.startsWith("Use when") && s.body.length > 50 && (s.roles ?? []).every((r) => ids.includes(r))));
}
{
  const studio = BUILT_IN_TEMPLATES.find((t) => t.id === "content-studio")!;
  const kitsFor = (role: string) => (studio.toolkits ?? []).filter((c) => !c.roles || c.roles.includes(role)).map((c) => c.id).sort().join();
  const skillsFor = (role: string) => (studio.skills ?? []).filter((s) => !s.roles || s.roles.includes(role)).map((s) => s.name).join();
  ok("Content Studio: the researcher and the writer get different tools", (kitsFor("researcher") + skillsFor("researcher")) !== (kitsFor("writer") + skillsFor("writer")) && skillsFor("researcher") === "source-notes" && skillsFor("writer") === "house-style" && kitsFor("writer") === "documents,writing");
}

{
  const { cmds, cfg, root } = world(STUDIO.replace(/toolkits:[\s\S]*?workflow:/, "workflow:"), true);
  writeProjectSkill(root, "house-style", "Our own, kept.", "mine");
  await cmds.completeWelcome({ templateId: "content-studio", projectName: "Askwell", lead: { name: "Maya", cli: "claude" }, workers: [{ name: "Leo", role: "Researcher", cli: "claude" }, { name: "Ada", role: "Writer", cli: "claude" }], reviewTool: "human", reviewEnabled: false });
  ok("welcome: the template's toolkits", JSON.stringify(cfg().toolkits) === JSON.stringify(BUILT_IN_TEMPLATES.find((t) => t.id === "content-studio")!.toolkits));
  ok("welcome: the template's skills written", readProjectSkill(root, "source-notes")?.body.includes("# Source notes"));
  ok("welcome: an existing skill folder isn't overwritten", readProjectSkill(root, "house-style")?.body.trim() === "mine");
  ok("welcome: skills given to the template's roles", JSON.stringify(cfg().skills) === JSON.stringify([{ name: "source-notes", roles: ["researcher", "fact-checker"] }, { name: "house-style", roles: ["writer", "editor"] }]), cfg().skills);
  const w2 = world(STUDIO.replace(/toolkits:[\s\S]*?workflow:/, "workflow:"), true);
  await w2.cmds.completeWelcome({ templateId: "content-studio", projectName: "x", lead: { name: "Maya", cli: "claude" }, workers: [], reviewTool: "human", reviewEnabled: false, toolkits: [{ id: "web-research", roles: ["researcher"] }] });
  ok("welcome: toolkits picked on the welcome screen win", JSON.stringify(w2.cfg().toolkits) === JSON.stringify([{ id: "web-research", roles: ["researcher"] }]));
  const w3 = world(STUDIO.replace(/toolkits:[\s\S]*?workflow:/, "workflow:"), true);
  await w3.cmds.completeWelcome({ templateId: "content-studio", projectName: "x", lead: { name: "Maya", cli: "claude" }, workers: [], reviewTool: "human", reviewEnabled: false, toolkits: [] });
  ok("welcome: turning them all off", !("toolkits" in w3.cfg()));
}

{
  const root = join(tmp, "tpl");
  mkdirSync(join(root, ".yacc"), { recursive: true });
  const cfg = parseConfig(STUDIO, () => null).config;
  cfg.roles.find((r) => r.id === "researcher")!.tools = ["exa"];
  cfg.roles.find((r) => r.id === "writer")!.cli = "gemini";
  writeProjectSkill(root, "house-style", "Use when writing.", "# House style");
  writeFileSync(join(root, ".yacc", "skills", "house-style", "examples.md"), "examples");
  // source-notes is chosen but has no folder: it isn't saved.
  const dir = saveTemplate(cfg, "", "Studio kit", "project", root);
  const doc = readFileSync(join(dir, "template.yml"), "utf8");
  ok("save: toolkits in short form", /toolkits:\n  - documents\n  - id: web-research/.test(doc));
  ok("save: skills with their folders", /skills:\n  - name: house-style/.test(doc) && existsSync(join(dir, "skills", "house-style", "SKILL.md")) && existsSync(join(dir, "skills", "house-style", "examples.md")));
  ok("save: a chosen skill with no folder is left out", !/source-notes/.test(doc));
  ok("save: role tools and any program", /researcher:[\s\S]*?tools:\n\s+- exa/.test(doc) && /writer:[\s\S]*?cli: gemini/.test(doc));
  const back = readTemplate(dir, "project");
  ok("read: toolkits", JSON.stringify(back.toolkits) === JSON.stringify(cfg.toolkits));
  ok("read: skills with their text and folder", back.skills?.length === 1 && back.skills[0].name === "house-style" && back.skills[0].body.includes("# House style") && back.skills[0].dir === join(dir, "skills", "house-style") && back.skills[0].roles?.join() === "writer,editor");
  ok("read: role tools and a Gemini role (was refused before)", back.roles.find((r) => r.id === "researcher")?.tools?.join() === "exa" && back.roles.find((r) => r.id === "writer")?.cli === "gemini");
  rmSync(join(dir, "skills", "house-style", "SKILL.md"));
  let err = "";
  try {
    readTemplate(dir, "project");
  } catch (e) {
    err = String(e);
  }
  ok("read: a listed skill without its SKILL.md is an error", /skills\/house-style\/SKILL\.md/.test(err), err);
  // Applying a saved template copies the whole skill folder.
  writeFileSync(join(dir, "skills", "house-style", "SKILL.md"), T.skillMd("house-style", "Use when writing.", "# From the template"));
  const w = world(STUDIO.replace(/toolkits:[\s\S]*?workflow:/, "workflow:"), true);
  mkdirSync(join(w.root, ".yacc", "templates"), { recursive: true });
  const { cpSync } = await import("node:fs");
  cpSync(dir, join(w.root, ".yacc", "templates", "studio-kit"), { recursive: true });
  await w.cmds.completeWelcome({ templateId: "project:studio-kit", projectName: "x", lead: { name: "Maya", cli: "claude" }, workers: [], reviewTool: "human", reviewEnabled: false });
  ok("apply: the saved template's skill folder copied whole", readProjectSkill(w.root, "house-style")?.body.includes("# From the template") && existsSync(join(w.root, ".yacc", "skills", "house-style", "examples.md")));
}

rmSync(tmp, { recursive: true, force: true });
console.log(`toolkits: ${passed} checks passed`);
