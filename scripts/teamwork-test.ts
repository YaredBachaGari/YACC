// Shared files, project memory, briefings and autonomy (Phase 2, part 2).
// No agents, sandboxes or browser needed.
//
//   npx tsx scripts/teamwork-test.ts

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ActionItems } from "../server/actionItems";
import { roleMd } from "../server/agentFiles";
import { Briefings } from "../server/briefings";
import { Hub } from "../server/hub";
import type { Inbox } from "../server/inbox";
import { Memory } from "../server/memory";
import { Planner } from "../server/planner";
import type { RepoInfo } from "../server/repo";
import { SharedFiles, safeRelative } from "../server/shared";
import { parseConfig } from "../server/store";
import { Team } from "../server/team";
import type { SetupState } from "../src/data/types";

const tmp = mkdtempSync(join(tmpdir(), "yacc-tw-"));
const slug = `twtest-${process.pid}`;
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

const root = join(tmp, "repo");
mkdirSync(join(root, ".yacc"), { recursive: true });
const folder = (id: string) => join(tmp, "agents", id);
const YAML = `
project: { name: Studio }
ceo: { name: Abuti }
limits: { maxAgents: 6 }
autonomy: { hire: ask, dismiss: notify }
roles:
  lead: { title: Producer, can: [plan, assign, review, hire], instructions: Run the studio. }
  researcher: { title: Researcher, can: [work], instructions: Find facts. }
  writer: { title: Writer, can: [work], instructions: Write scripts. }
team:
  - { id: maya, name: Maya, role: lead, mode: local, workspacePath: ${folder("maya")} }
  - { id: leo, name: Leo, role: researcher, mode: local, workspacePath: ${folder("leo")} }
  - { id: ada, name: Ada, role: writer, mode: local, workspacePath: ${folder("ada")} }
workflow:
  deliverable: files
  stages:
    - { name: Research, owner: researcher }
    - { name: Script, owner: writer }
  review: { enabled: false, tool: human }
  merge: { by: human }
  deploy: { enabled: false, tool: custom }
`;
for (const id of ["maya", "leo", "ada"]) mkdirSync(folder(id), { recursive: true });
const config = parseConfig(YAML, () => null).config;
config.project.path = root;
ok("yaml: autonomy read", config.autonomy.hire === "ask" && config.autonomy.dismiss === "notify");
ok("yaml: autonomy defaults when left out", parseConfig(YAML.replace("autonomy: { hire: ask, dismiss: notify }\n", ""), () => null).config.autonomy.hire === "notify");

const repo: RepoInfo = { root, name: "repo", originUrl: null, github: null, hasCodeRabbit: false, hasInsta: false };
const setup = { machine: { cpus: 4, memoryGb: 8 }, checks: [], sandboxReady: false, localReady: true, checkedAt: "" } as SetupState;
const hub = new Hub(repo, slug, config, { boards: [{ id: "B1", title: "Backlog", status: "active", order: 0 }], tasks: [] }, setup);
const inbox: { to: string; text: string }[] = [];
const planner = new Planner(hub, { push: (to: string, m: { text: string }) => void inbox.push({ to, text: m.text }), forget: () => {} } as unknown as Inbox);
planner.actions = new ActionItems(hub, planner);
const briefings = new Briefings(hub, planner);
const shared = new SharedFiles(hub);
const memory = new Memory(hub);
planner.shared = shared;
for (const a of config.team) hub.setSession(a.id, { state: "running" });

// ------------------------------------------------------------------ shared files

ok("paths: relative kept", safeRelative("./drafts\\\\script.md") === "drafts/script.md");
throws("paths: no ..", () => safeRelative("../../etc/passwd"), /outside your folder/);
throws("paths: no absolute", () => safeRelative("/etc/passwd"), /absolute/);
throws("paths: no Windows absolute", () => safeRelative("C:\\\\Users\\\\x"), /absolute/);
throws("paths: not .git", () => safeRelative(".git/config"), /\.git/);

mkdirSync(join(folder("leo"), "research"), { recursive: true });
writeFileSync(join(folder("leo"), "research", "scam-calls.md"), "# Sources\n- FTC 2026\n");
writeFileSync(join(folder("leo"), "research", "notes.txt"), "draft");
const secret = join(tmp, "secret.txt");
writeFileSync(secret, "TOKEN");
// Windows needs extra rights to make links; there the check is skipped.
let linked = true;
try {
  symlinkSync(secret, join(folder("leo"), "link.txt"));
} catch {
  linked = false;
}
if (linked) throws("share: a link out of the folder is refused", () => shared.share("leo", ["link.txt"]), /outside your folder|is a link/);
throws("share: missing file", () => shared.share("leo", ["nope.md"]), /isn't in your folder/);
throws("share: nothing named", () => shared.share("leo", []), /at least one/);
const got = shared.share("leo", ["research"]);
ok("share: a folder shares every file in it", got.sort().join() === "research/notes.txt,research/scam-calls.md", got);
ok("share: copied into shared/ in the repo", readFileSync(join(root, "shared", "research", "scam-calls.md"), "utf8").includes("FTC 2026"));
ok("share: listed with who shared it", hub.snap.sharedFiles?.some((f) => f.path === "research/scam-calls.md" && f.by === "leo" && f.bytes > 0));
ok("share: the secret never reached shared/", !existsSync(join(root, "shared", "link.txt")));

// Handoff copies the shared folder to the next owner.
const t = planner.createTask({ title: "Scam calls" }, "maya");
planner.assign(t.id, "leo", "maya");
planner.completeStage("leo", "Sources in shared/research/scam-calls.md");
ok("handoff: the writer got the shared files", t.ownerId === "ada" && readFileSync(join(folder("ada"), "shared", "research", "scam-calls.md"), "utf8").includes("FTC 2026"));
ok("deliver: by path", shared.deliver("maya", ["research/notes.txt"]).join() === "research/notes.txt" && existsSync(join(folder("maya"), "shared", "research", "notes.txt")));
throws("deliver: unknown path", () => shared.deliver("maya", ["nothing.md"]), /None of those are shared/);
throws("share: can't re-share what came from shared/", () => shared.share("ada", ["shared/research/scam-calls.md"]), /already from the shared folder/);

// ------------------------------------------------------------------ project memory

memory.set({ brief: "We make 2-minute videos that help older adults spot scams.\n" });
memory.add("maya", "decision", "Every script cites at least three sources.");
memory.add("ada", "lesson", "Short intros keep viewers.");
throws("memory: empty line", () => memory.add("ada", "lesson", "  "), /Write the decision/);
const m = memory.read();
ok("memory: files in .yacc/memory/", existsSync(join(root, ".yacc", "memory", "brief.md")) && m.decisions.includes("Maya: Every script cites") && m.lessons.includes("Ada: Short intros"));
ok("memory: dated lines", /- \d{4}-\d{2}-\d{2} Maya:/.test(m.decisions));
const file = roleMd(hub.cfg("ada")!, hub.snap.config, { memory: memory.forRoleFile() });
ok("role file: brief and recent memory included", file.includes("## Project memory") && file.includes("help older adults spot scams") && file.includes("Every script cites"), file);
ok("role file: how to share", file.includes("share_files") && file.includes("add_to_memory"));
ok("role file: no memory section when empty", !roleMd(hub.cfg("ada")!, hub.snap.config, { memory: "" }).includes("## Project memory"));

// ------------------------------------------------------------------ briefings

throws("report: needs a summary", () => briefings.report("maya", " "), /Write the summary/);
const b = briefings.report("maya", "Scam calls piece is done.", ["shared/scripts/scam-calls.md"], ["Publish Monday or Wednesday?"]);
ok("report: stored unread, with outputs and questions", !b.read && b.deliverables.length === 1 && b.questions.length === 1 && hub.snap.briefings?.[0].id === b.id);
briefings.reply(b.id, "Monday.");
ok("reply: goes to the lead as a message", b.reply === "Monday." && b.read && hub.snap.messages[0].toId === "maya" && hub.snap.messages[0].text.includes("Monday."));
briefings.notice("maya", "Maya hired Kit");
briefings.markAllRead();
ok("read: all marked read", (hub.snap.briefings ?? []).every((x) => x.read));
ok("briefings: kept on disk", readFileSync(join(homedir(), ".yacc", slug, "briefings.json"), "utf8").includes("Scam calls piece is done."));

// ------------------------------------------------------------------ autonomy

const started: string[] = [];
const team = new Team(hub, {
  start: (id) => void started.push(id),
  removeResources: async () => ["sandbox"],
  forget: () => {},
  recheckSetup: () => {},
  ask: (kind, by, title, details, payload) => planner.actions!.addDecision(kind, by, title, details, payload),
  notice: (by, text) => briefings.notice(by, text),
});
planner.actions!.onDecision = async (item, decision, note) => {
  const p = item.payload ?? {};
  if (decision === "dismissed") return planner.notify(item.fromId, `The CEO declined: ${item.title}.${note ? ` ${note}` : ""}`);
  const r = item.kind === "hire" ? team.hire(item.fromId, p.input as Parameters<Team["hire"]>[1], true) : await team.dismiss(item.fromId, String(p.agent), String(p.reason ?? ""), true);
  planner.notify(item.fromId, `The CEO approved: ${item.title}. ${r}`);
};

// ask: nothing happens until the CEO approves.
const asked = team.hire("maya", { role: "Fact checker", name: "Kit", reason: "Nobody checks figures.", temporary: true, instructions: "Check every figure against its source and list mismatches with links." });
const item = hub.snap.actionItems!.find((i) => i.kind === "hire" && i.status === "open")!;
ok("ask: the hire waits for the CEO", /Action items/.test(asked) && !!item && !hub.cfg("kit") && !hub.snap.config.roles.some((r) => r.title === "Fact checker"), asked);
ok("ask: the request says why", item.title.includes("Maya wants to hire a Fact checker (temporary)") && item.details.includes("Nobody checks figures."));
planner.actions!.resolve(item.id, "done");
await new Promise((r) => setTimeout(r, 20));
ok("ask: approved → hired, started, lead told", !!hub.cfg("kit") && started.includes("kit") && inbox.some((x) => x.to === "maya" && x.text.includes("The CEO approved") && x.text.includes("Hired Kit")));

team.hire("maya", { role: "writer", reason: "Second script" });
const declined = hub.snap.actionItems!.find((i) => i.kind === "hire" && i.status === "open")!;
const before = hub.snap.config.team.length;
planner.actions!.resolve(declined.id, "dismissed", "Not this month.");
await new Promise((r) => setTimeout(r, 20));
ok("ask: declined → nobody hired, lead told why", hub.snap.config.team.length === before && inbox.some((x) => x.to === "maya" && x.text.includes("declined") && x.text.includes("Not this month.")));

// notify: done at once, and the CEO gets a notice.
const n = (hub.snap.briefings ?? []).length;
const msg = await team.dismiss("maya", "kit", "Figures checked");
ok("notify: dismissed at once", !hub.cfg("kit") && msg.startsWith("Dismissed Kit"));
ok("notify: a notice in Briefings", (hub.snap.briefings ?? []).length === n + 1 && hub.snap.briefings![0].kind === "notice" && hub.snap.briefings![0].summary.includes("dismissed Kit"));

// auto: done, no notice.
hub.snap.config.autonomy.hire = "auto";
team.hire("maya", { role: "writer", name: "Bo", reason: "Second script" });
ok("auto: hired with no notice", !!hub.cfg("bo") && (hub.snap.briefings ?? []).length === n + 1);

rmSync(tmp, { recursive: true, force: true });
rmSync(join(homedir(), ".yacc", slug), { recursive: true, force: true });
console.log(`teamwork-test: ${passed} checks passed`);
process.exit(0);
