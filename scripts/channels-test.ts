// Channels, messaging rules and schedules (Phase 6 part 2): who may message whom, posts to
// #team and role channels, the rules in role files and YAML; schedules on a clock (with a fake
// clock) and on events, what each run does, restarts, and templates that bring schedules.
//
//   npx tsx scripts/channels-test.ts

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "yacc-channels-"));
Object.assign(process.env, { HOME: tmp, USERPROFILE: tmp });

const { ActionItems } = await import("../server/actionItems");
const { roleMd } = await import("../server/agentFiles");
const { makeCommands } = await import("../server/commands");
const { Hub } = await import("../server/hub");
const { Planner } = await import("../server/planner");
const { Scheduler } = await import("../server/scheduler");
const { parseConfig, serializeConfig } = await import("../server/store");
const { readTemplate, saveTemplate } = await import("../server/templates");
const M = await import("../src/data/messaging");
const S = await import("../src/data/schedules");
const { normalizeConfig } = await import("../src/data/roles");
const { BUILT_IN_TEMPLATES } = await import("../src/data/templates");
import type { HqConfig, SetupState } from "../src/data/types";
import type { Inbox } from "../server/inbox";
import type { RepoInfo } from "../server/repo";

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

// Maya leads; Sam (editor) reports to her and manages Ada (writer) and Bo (writer); Leo (researcher) reports to Maya.
const STUDIO = `
project: { name: Studio }
ceo: { name: Abuti }
roles:
  lead: { title: Producer, can: [plan, assign, review, hire], instructions: Run it. }
  researcher: { title: Researcher, can: [work], instructions: Facts. }
  writer: { title: Writer, can: [work], instructions: Write. }
  editor: { title: Editor, can: [work, review], instructions: Edit. }
  designer: { title: Designer, can: [work], instructions: Draw. }
team:
  - { id: maya, name: Maya, role: lead, mode: local }
  - { id: leo, name: Leo, role: researcher, mode: local }
  - { id: sam, name: Sam, role: editor, mode: local }
  - { id: ada, name: Ada, role: writer, mode: local, reportsTo: sam }
  - { id: bo, name: Bo, role: writer, mode: local, reportsTo: sam }
workflow:
  item: Piece
  deliverable: files
  stages:
    - { name: Write, owner: writer }
  review: { enabled: false, tool: human }
  merge: { by: human }
  deploy: { enabled: false, tool: custom }
`;
const LINES = STUDIO.replace("workflow:", "messaging: { direct: lines, team: lead, allow: [{ from: researcher, to: writer }, { from: ghost, to: writer }] }\nworkflow:");
const setup = { machine: { cpus: 4, memoryGb: 8 }, checks: [], sandboxReady: false, localReady: true, checkedAt: "" } as SetupState;
const cfgOf = (yaml: string) => parseConfig(yaml, () => null).config;

let n = 0;
function world(yaml = STUDIO, clock?: { now: Date }) {
  const name = `w${++n}`;
  const root = join(tmp, name);
  mkdirSync(join(root, ".yacc"), { recursive: true });
  const repo: RepoInfo = { root, name, originUrl: null, github: null, hasCodeRabbit: false, hasInsta: false };
  const config = cfgOf(yaml);
  config.project.path = root;
  const hub = new Hub(repo, `ch-${name}-${process.pid}`, config, { boards: [{ id: "B1", title: "Backlog", status: "active", order: 0 }], tasks: [] }, setup);
  const inbox: { to: string; text: string; from: string }[] = [];
  const planner = new Planner(hub, { push: (to: string, m: { text: string; fromId: string }) => void inbox.push({ to, text: m.text, from: m.fromId }), forget: () => {} } as unknown as Inbox);
  planner.actions = new ActionItems(hub, planner);
  for (const a of config.team) hub.setSession(a.id, { state: "running" });
  const scheduler = new Scheduler(hub, planner, () => clock?.now ?? new Date());
  const stub = {} as never;
  const cmds = makeCommands(hub, { recheckSetup: async () => undefined } as never, planner, { refresh: async () => undefined } as never, stub, stub, { briefings: stub, memory: stub, scheduler });
  return { hub, planner, inbox, scheduler, cmds, root, cfg: () => hub.snap.config };
}

// ------------------------------------------------------------------ 1. Rules

{
  ok("clean: default → undefined", M.cleanMessaging({ direct: "anyone", team: "everyone" }, ["writer"]) === undefined && M.cleanMessaging(null, []) === undefined);
  const m = M.cleanMessaging({ direct: "lines", team: "lead", allow: [{ from: "researcher", to: "writer" }, { from: "researcher", to: "writer" }, { from: "ghost", to: "writer" }, { to: "writer" }] }, ["researcher", "writer"]);
  ok("clean: values, known pairs once", JSON.stringify(m) === JSON.stringify({ direct: "lines", team: "lead", allow: [{ from: "researcher", to: "writer" }] }), m);
  ok("clean: junk → defaults", M.cleanMessaging({ direct: "nobody", team: "you" }, []) === undefined);

  const cfg = cfgOf(STUDIO);
  ok("channels: #team, then a channel per role that has agents", M.channelsOf(cfg).map((c) => c.id).join() === "#team,#lead,#researcher,#writer,#editor");
  ok("channels: members", M.channelMembers(cfg, "#writer").join() === "ada,bo" && M.channelMembers(cfg, "#team").length === 5 && M.channelMembers(cfg, "#designer").length === 0 && M.channelMembers(cfg, "#ghost").length === 0);
  ok("channels: an agent's", M.channelsFor(cfg, "ada").map((c) => c.id).join() === "#team,#writer");
  ok("open: anyone to anyone", M.directBlock(cfg, "leo", "bo") === null && M.postBlock(cfg, "leo", "#writer") === null && M.postBlock(cfg, "leo", "#team") === null);

  const lines = cfgOf(LINES);
  ok("yaml: rules read, a pair with an unknown role dropped", JSON.stringify(lines.messaging) === JSON.stringify({ direct: "lines", team: "lead", allow: [{ from: "researcher", to: "writer" }] }), lines.messaging);
  const can = (a: string, b: string) => M.directBlock(lines, a, b) === null;
  ok("lines: to your manager and back", can("ada", "sam") && can("sam", "ada"));
  ok("lines: to someone who shares your manager", can("ada", "bo") && can("leo", "sam"));
  ok("lines: the lead reaches everyone, everyone reaches the lead", can("maya", "bo") && can("bo", "maya"));
  ok("lines: you and HQ are never limited", can("you", "bo") && can("hq", "ada"));
  ok("lines: an allowed role pair, one way only", can("leo", "ada") && !can("ada", "leo"));
  ok("lines: across the chart is refused", !can("bo", "leo"));
  ok("lines: the refusal says who to ask", /message Bo|message Leo directly: message along reporting lines \(Sam, your reports, or people who share your manager\) or the lead/.test(M.directBlock(lines, "bo", "leo") ?? ""), M.directBlock(lines, "bo", "leo"));
  ok("#team: only the lead posts", M.postBlock(lines, "maya", "#team") === null && /Only the lead posts to #team/.test(M.postBlock(lines, "ada", "#team") ?? "") && M.postBlock(lines, "you", "#team") === null);
  ok("role channel: members, the lead, and those who may message a member", M.postBlock(lines, "bo", "#writer") === null && M.postBlock(lines, "maya", "#writer") === null && M.postBlock(lines, "sam", "#writer") === null && M.postBlock(lines, "leo", "#writer") === null);
  ok("role channel: others are refused", /don't let you post to #researcher/.test(M.postBlock(lines, "ada", "#researcher") ?? ""));
  ok("unknown channel", /no channel #ghost/.test(M.postBlock(lines, "you", "#ghost") ?? ""));

  const ada = lines.team.find((a) => a.id === "ada")!;
  const md = roleMd(ada, lines);
  ok("role file: channels it's in", /## Messages\nChannels:[\s\S]*You're in #team, #writer\./.test(md), md.slice(md.indexOf("## Messages"), md.indexOf("## Messages") + 400));
  ok("role file: the rules", md.includes("Only the lead posts to #team.") && md.includes("Direct messages follow reporting lines"));
  ok("role file: no 'message anyone' line under rules", !md.includes("You can message any teammate with send_message, whatever"));
  ok("role file: the lead isn't told about limits", !roleMd(lines.team[0], lines).includes("Direct messages follow reporting lines"));
  ok("role file: open teams keep the old line", roleMd(cfg.team[3], cfg).includes("You can message any teammate with send_message, whatever the reporting lines."));

  const { yaml } = serializeConfig(lines);
  ok("yaml: written and read back", /messaging:\n  direct: lines\n  team: lead\n  allow:\n    - from: researcher\n      to: writer/.test(yaml) && JSON.stringify(cfgOf(yaml).messaging) === JSON.stringify(lines.messaging));
  ok("yaml: open teams write nothing", !/messaging:/.test(serializeConfig(cfg).yaml));
  const cut = structuredClone(lines);
  cut.roles = cut.roles.filter((r) => r.id !== "researcher");
  cut.team = cut.team.filter((a) => a.roleId !== "researcher");
  normalizeConfig(cut);
  ok("normalize: a removed role's pairs go", !cut.messaging?.allow);
}

// ------------------------------------------------------------------ 2. Posting and messaging through HQ

{
  const { planner, inbox, hub } = world(LINES);
  const to = planner.message("maya", "#writer", "Scripts due Friday.");
  ok("post: returns the channel", to === "#writer");
  ok("post: everyone in the channel gets it, tagged", inbox.filter((m) => m.text === "[#writer] Scripts due Friday.").map((m) => m.to).join() === "ada,bo");
  ok("post: recorded once, to the channel", hub.snap.messages.filter((m) => m.toId === "#writer").length === 1 && hub.snap.messages[0].fromId === "maya");
  ok("post: in Activity with the count", /Maya → #writer \(2\): Scripts due Friday/.test(hub.snap.activity[0].text), hub.snap.activity[0].text);
  inbox.length = 0;
  planner.message("ada", "#writer", "Draft is up.");
  ok("post: not sent back to the poster", inbox.map((m) => m.to).join() === "bo");
  inbox.length = 0;
  planner.message("you", "#TEAM", "Demo day Friday.");
  ok("post: you to #team (any case) reaches everyone", inbox.length === 5);
  throws("post: refused by the rules", () => planner.message("ada", "#team", "hi"), /Only the lead posts/);
  throws("post: unknown channel", () => planner.message("you", "#nope", "hi"), /no channel #nope/);
  throws("post: empty", () => planner.message("maya", "#writer", "  "), /Empty/);
  throws("direct: refused by the rules", () => planner.message("bo", "leo", "hi"), /don't let you message Leo directly/);
  inbox.length = 0;
  planner.message("leo", "ada", "Sources are in shared/research.");
  ok("direct: an allowed pair goes through", inbox.length === 1 && inbox[0].to === "ada");
  throws("direct: unknown agent lists the channels", () => planner.message("you", "ghost", "hi"), /Channels: #team/);
}

{
  const { cmds, cfg, root } = world();
  cmds.updateMessaging({ direct: "lines", team: "everyone", allow: [{ from: "writer", to: "researcher" }] });
  ok("command: saved", cfg().messaging?.direct === "lines" && /messaging:\n  direct: lines/.test(readFileSync(join(root, ".yacc", "config.yml"), "utf8")));
  cmds.updateMessaging({ direct: "anyone", team: "everyone" });
  ok("command: back to open removes it", !("messaging" in cfg()));
}

// ------------------------------------------------------------------ 3. Schedules: cleaning and times

{
  const list = S.cleanSchedules([
    { name: "Weekly report", every: "week", day: 5, at: "16:00", action: "message", text: "Report, please." },
    { name: "Weekly report", every: "day", action: "message", to: "#team", text: "Hello" },
    { name: "", every: "day", action: "message", text: "x" },
    { name: "No text", every: "day", action: "message", text: " " },
    { name: "Task without title", every: "day", action: "task", text: "x" },
    { name: "Bad time", every: "day", at: "25:99", action: "message", text: "x" },
    { name: "Never", every: "fortnight", action: "message", text: "x" },
    { name: "On done", on: "task-done", action: "task", title: "Promote {title}", to: "role:writer", text: "" },
    { name: "Off", enabled: false, every: "month", day: 31, action: "message", text: "x" },
  ]);
  ok("clean: what can run is kept", list.map((s) => s.name).join("|") === "Weekly report|Weekly report|Task without title|Bad time|On done|Off".replace("Task without title|", ""), list.map((s) => s.name));
  ok("clean: ids unique", list[0].id === "weekly-report" && list[1].id === "weekly-report-2");
  ok("clean: a message goes to the lead by default", list[0].to === "lead" && list[1].to === "#team");
  ok("clean: a bad time becomes 09:00", list.find((s) => s.name === "Bad time")?.at === "09:00");
  ok("clean: events keep no clock", list.find((s) => s.name === "On done")?.on === "task-done" && !list.find((s) => s.name === "On done")?.every);
  ok("clean: on by default, off kept, a bad month day → 1", list[0].enabled && list.find((s) => s.name === "Off")?.enabled === false && list.find((s) => s.name === "Off")?.day === 1);
  ok("clean: at most 30", S.cleanSchedules(Array.from({ length: 40 }, (_, i) => ({ name: `S${i}`, every: "day", action: "message", text: "x" }))).length === S.MAX_SCHEDULES);

  const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi);
  const day = { id: "d", name: "d", enabled: true, every: "day" as const, at: "09:00", action: "message" as const, text: "x" };
  ok("day: previous and next", +S.previousRun(day, at(2026, 11, 18, 10))! === +at(2026, 11, 18, 9) && +S.nextRun(day, at(2026, 11, 18, 10))! === +at(2026, 11, 19, 9));
  ok("day: before the time, yesterday's", +S.previousRun(day, at(2026, 11, 18, 8))! === +at(2026, 11, 17, 9));
  const weekday = { ...day, every: "weekday" as const };
  ok("weekday: Saturday → Monday next, Friday previous", +S.nextRun(weekday, at(2026, 11, 21, 12))! === +at(2026, 11, 23, 9) && +S.previousRun(weekday, at(2026, 11, 22, 12))! === +at(2026, 11, 20, 9));
  const week = { ...day, every: "week" as const, day: 5, at: "16:00" };
  ok("week: the next Friday 16:00", +S.nextRun(week, at(2026, 11, 18, 10))! === +at(2026, 11, 20, 16) && +S.nextRun(week, at(2026, 11, 20, 16, 1))! === +at(2026, 11, 27, 16));
  const month = { ...day, every: "month" as const, day: 1 };
  ok("month: the 1st", +S.nextRun(month, at(2026, 11, 18, 10))! === +at(2026, 12, 1, 9) && +S.previousRun(month, at(2026, 11, 18, 10))! === +at(2026, 11, 1, 9));
  const hour = { ...day, every: "hour" as const, at: "00:15" };
  ok("hour: quarter past", +S.nextRun(hour, at(2026, 11, 18, 10, 20))! === +at(2026, 11, 18, 11, 15) && +S.previousRun(hour, at(2026, 11, 18, 10, 20))! === +at(2026, 11, 18, 10, 15) && +S.previousRun(hour, at(2026, 11, 18, 10, 5))! === +at(2026, 11, 18, 9, 15));
  ok("due: a time passed since → yes", S.isDue(day, at(2026, 11, 18, 8), at(2026, 11, 18, 9, 1)));
  ok("due: nothing since → no", !S.isDue(day, at(2026, 11, 18, 9, 0), at(2026, 11, 18, 12)));
  ok("due: off, or an event → no", !S.isDue({ ...day, enabled: false }, at(2026, 11, 1, 0), at(2026, 11, 18, 12)) && !S.isDue({ ...day, every: undefined, on: "task-done" }, at(2026, 11, 1, 0), at(2026, 11, 18, 12)));
  ok("fill: known placeholders only", S.fill("{date} {task} {nope}", { date: "2026-11-18", task: "B1-T01" }) === "2026-11-18 B1-T01 {nope}");
  ok("describe: when", S.describeWhen(week) === "Every Friday at 16:00" && S.describeWhen(hour) === "Every hour at :15" && S.describeWhen({ on: "pr-merged" }) === "When a pull request is merged" && S.describeWhen(month) === "On day 1 of every month at 09:00");
  const cfg = cfgOf(STUDIO);
  ok("describe: what", S.describeWhat({ ...day, to: "#writer" }, cfg) === "a message to #writer" && S.describeWhat({ ...day, action: "task", title: "Report", to: "role:writer" }, cfg) === 'the task "Report" for someone with the Writer role' && S.describeWhat({ ...day, action: "task", title: "Report" }, cfg) === 'the task "Report", assigned by the lead');
}

// ------------------------------------------------------------------ 4. Running schedules

{
  const clock = { now: new Date(2026, 10, 18, 8, 0) }; // Wednesday 18 November, 08:00
  const yaml = STUDIO.replace(
    "workflow:",
    `schedules:
  - { name: Morning, every: day, at: "09:00", action: message, text: "Plan {date}." }
  - { name: Standup, every: day, at: "09:00", action: message, to: "#writer", text: "Post your plan." }
  - { name: Report, every: day, at: "09:00", action: task, title: "Report {date}", to: "role:writer", text: "Write it." }
  - { name: Design, every: day, at: "09:00", action: task, title: "Poster", to: "role:designer", text: "" }
  - { name: Lead decides, every: day, at: "09:00", action: task, title: "Triage", text: "Look at the inbox." }
  - { name: To Leo, every: day, at: "09:00", action: task, title: "Sources", to: leo, text: "" }
  - { name: Broken, every: day, at: "09:00", action: message, to: ghost, text: "x" }
  - { name: Off, enabled: false, every: day, at: "09:00", action: message, text: "x" }
  - { name: Promote, on: task-done, action: message, to: "#writer", text: "{task} ({title}) on {board} is done." }
  - { name: Wrap up, on: board-done, action: message, text: "{board} is done: send me a briefing." }
workflow:`,
  );
  const { scheduler, inbox, hub, planner, cfg } = world(yaml, clock);
  hub.setStatus("bo", { currentTaskId: "X" }); // Ada is free, Bo isn't
  scheduler.start();
  ok("first look: nothing runs for times already past", inbox.length === 0 && hub.snap.schedules?.every((s) => !s.lastRun));
  ok("statuses: next runs", hub.snap.schedules?.find((s) => s.id === "morning")?.nextRun === new Date(2026, 10, 18, 9, 0).toISOString() && hub.snap.schedules?.find((s) => s.id === "off")?.nextRun === null && hub.snap.schedules?.find((s) => s.id === "promote")?.nextRun === null);
  clock.now = new Date(2026, 10, 18, 9, 0, 30);
  scheduler.tick();
  const lead = inbox.filter((m) => m.to === "maya").map((m) => m.text);
  ok("message: to the lead, tagged, filled in", lead.includes("[Schedule: Morning] Plan 2026-11-18."), lead);
  ok("message: from HQ", inbox.find((m) => m.text.includes("Plan 2026-11-18"))?.from === "hq");
  ok("channel: posted to #writer", inbox.filter((m) => m.text === "[#writer] [Schedule: Standup] Post your plan.").map((m) => m.to).join() === "ada,bo");
  const report = hub.snap.tasks.find((t) => t.title === "Report 2026-11-18");
  ok("task: added with its description and tag", !!report && report.description.startsWith("Write it.") && report.description.includes("[Schedule: Report]"));
  ok("task: for the role's free agent", report?.ownerId === "ada", report);
  ok("task: nobody with the role → the lead is told", hub.snap.tasks.some((t) => t.title === "Poster" && !t.ownerId) && lead.some((t) => /for the Designer role, but nobody has it/.test(t)));
  ok("task: no one named → the lead assigns it", lead.some((t) => /\[Schedule: Lead decides\] Added .* \(Triage\)\. Plan it and assign it\./.test(t)));
  ok("task: for a named agent", hub.snap.tasks.find((t) => t.title === "Sources")?.ownerId === "leo");
  const st = (id: string) => hub.snap.schedules?.find((s) => s.id === id);
  ok("result: a failure is recorded, not thrown", /^Didn't run: No agent "ghost"/.test(st("broken")?.lastResult ?? ""), st("broken"));
  ok("result: Activity says what ran", hub.snap.activity.some((a) => a.text.startsWith('Schedule "Morning": message sent to Maya')));
  ok("off: didn't run", !st("off")?.lastRun);
  const count = inbox.length;
  clock.now = new Date(2026, 10, 18, 12, 0);
  scheduler.tick();
  ok("once: no second run the same day", inbox.length === count);
  // HQ restarts: the record on disk stops a repeat.
  const again = new Scheduler(hub, planner, () => clock.now);
  again.tick();
  ok("restart: no repeat", inbox.length === count);
  // HQ was off for two days: the missed run happens once.
  clock.now = new Date(2026, 10, 20, 11, 0);
  again.tick();
  ok("missed while off: runs once on return", inbox.filter((m) => m.text === "[Schedule: Morning] Plan 2026-11-20.").length === 1);
  again.tick();
  ok("missed while off: only once", inbox.filter((m) => m.text.startsWith("[Schedule: Morning]")).length === 2);
  // From here on the restarted scheduler is the one HQ runs.
  scheduler.stop();
  again.start();
  const stub = {} as never;
  const cmds2 = makeCommands(hub, { recheckSetup: async () => undefined } as never, planner, { refresh: async () => undefined } as never, stub, stub, { briefings: stub, memory: stub, scheduler: again });

  // Events.
  inbox.length = 0;
  const t = planner.createTask({ title: "Scam calls" }, "maya");
  planner.updateTask(t.id, { status: "done" });
  await new Promise((r) => setImmediate(r));
  ok("event: task done → posted", inbox.filter((m) => m.text === `[#writer] [Schedule: Promote] ${t.id} (Scam calls) on Backlog is done.`).length === 2, inbox);
  planner.updateTask(t.id, { title: "Scam calls (v2)" });
  await new Promise((r) => setImmediate(r));
  ok("event: only on the change to done", inbox.filter((m) => m.text.includes("[Schedule: Promote]")).length === 2);
  planner.updateBoard("B1", { status: "done" });
  await new Promise((r) => setImmediate(r));
  ok("event: board done → the lead", inbox.some((m) => m.to === "maya" && m.text === "[Schedule: Wrap up] Backlog is done: send me a briefing."));

  // Run now, and edits.
  cmds2.runSchedule("off");
  ok("run now: even when off", st("off")?.lastResult === "message sent to Maya");
  cmds2.updateSchedules((cfg().schedules ?? []).filter((s) => s.id !== "broken"));
  ok("edit: a removed schedule is forgotten", !hub.snap.schedules?.some((s) => s.id === "broken") && !JSON.parse(readFileSync(join(tmp, ".yacc", hub.slug, "schedules.json"), "utf8")).broken);
  cmds2.updateSchedules([...(cfg().schedules ?? []), { id: "", name: "New one", enabled: true, every: "day", at: "08:00", action: "message", text: "x" }]);
  const before = inbox.length;
  again.tick();
  ok("edit: a new schedule doesn't fire for a time already past today", inbox.length === before && st("new-one")?.nextRun === new Date(2026, 10, 21, 8, 0).toISOString(), { d: inbox.length - before, st: st("new-one"), msgs: inbox.slice(before) });
  scheduler.stop();
  again.stop();
}

{
  const yaml = STUDIO.replace("workflow:", `schedules:\n  - { name: Weekly, every: week, day: 5, at: "16:00", action: message, text: "Report." }\n  - { name: Merged, on: pr-merged, action: task, title: "Notes for {pr}", text: "{title}" }\nworkflow:`);
  const cfg = cfgOf(yaml);
  ok("yaml: read", cfg.schedules?.length === 2 && cfg.schedules[0].day === 5 && cfg.schedules[1].on === "pr-merged");
  const { yaml: out } = serializeConfig(cfg);
  ok("yaml: round trip", JSON.stringify(cfgOf(out).schedules) === JSON.stringify(cfg.schedules));
  ok("yaml: none → no key", !/schedules:/.test(serializeConfig(cfgOf(STUDIO)).yaml));
  const lead = roleMd(cfg.team[0], cfg);
  ok("role file: the lead knows what arrives on its own", /## Schedules\nHQ starts this work on its own[\s\S]*- Weekly: every friday at 16:00, a message to the lead\.\n- Merged: when a pull request is merged, the task "Notes for \{pr\}", assigned by the lead\./.test(lead), lead.slice(lead.indexOf("## Schedules"), lead.indexOf("## Schedules") + 300));
  ok("role file: others aren't told", !roleMd(cfg.team[1], cfg).includes("## Schedules"));
  const off = structuredClone(cfg);
  off.schedules = off.schedules!.map((s) => ({ ...s, enabled: false }));
  ok("role file: switched-off schedules aren't listed", !roleMd(off.team[0], off).includes("## Schedules"));
}

// ------------------------------------------------------------------ 5. Templates

for (const t of BUILT_IN_TEMPLATES.filter((x) => x.schedules?.length)) {
  const sorted = (list: unknown[]) => JSON.stringify(list.map((x) => Object.fromEntries(Object.entries(x as object).sort())));
  ok(`${t.name}: its schedules are valid and start switched off`, sorted(S.cleanSchedules(t.schedules)) === sorted(t.schedules!) && t.schedules!.every((s) => !s.enabled), S.cleanSchedules(t.schedules));
}
ok("templates: Content Studio has a daily run", BUILT_IN_TEMPLATES.find((t) => t.id === "content-studio")?.schedules?.some((s) => s.every === "weekday"));
{
  const root = join(tmp, "tpl");
  mkdirSync(join(root, ".yacc"), { recursive: true });
  const cfg = cfgOf(STUDIO.replace("workflow:", `schedules:\n  - { name: Weekly, every: week, day: 5, at: "16:00", action: message, text: "Report." }\nworkflow:`)) as HqConfig;
  const dir = saveTemplate(cfg, "", "With schedules", "project", root);
  ok("save: schedules kept", readTemplate(dir, "project").schedules?.[0].name === "Weekly");
  const w = world(STUDIO);
  w.hub.snap.welcome = true;
  const stub = {} as never;
  const cmds = makeCommands(w.hub, { recheckSetup: async () => undefined } as never, w.planner, { refresh: async () => undefined } as never, stub, stub, { briefings: stub, memory: { read: () => ({ brief: "" }), set: () => {} } as never, scheduler: w.scheduler });
  await cmds.completeWelcome({ templateId: "content-studio", projectName: "x", lead: { name: "Maya", cli: "claude" }, workers: [], reviewTool: "human", reviewEnabled: false });
  ok("welcome: the template's schedules, switched off", w.cfg().schedules?.map((s) => `${s.id}:${s.enabled}`).join() === "daily-content-run:false,weekly-roundup:false");
  w.scheduler.stop();
}

rmSync(tmp, { recursive: true, force: true });
console.log(`channels: ${passed} checks passed`);
