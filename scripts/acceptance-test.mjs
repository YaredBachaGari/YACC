#!/usr/bin/env node
// The definitions of done, checked end to end on the packed package, the way someone outside the
// project would use it (plan Phase 7: "someone outside the project installs it and runs a shared
// template unaided"). docs/acceptance.md says which check covers which phase.
//
//   npm pack --pack-destination pack && node scripts/acceptance-test.mjs pack/yacc-hq-*.tgz [port]
//
// What it does, with a fresh home folder and a repo that has no GitHub remote:
//   1. installs the tarball with npm and starts HQ;
//   2. installs a template from the public gallery (templates/newsletter-desk.yacc-template.json,
//      as a downloaded file) and finishes the welcome with it; no other setup;
//   3. puts two agents on different programs and models (Claude Code and Gemini CLI, Local mode;
//      stand-in programs on PATH play them, so no accounts are needed) and starts the team;
//   4. checks each agent's role file: different tools, the same brief;
//   5. moves one issue through every stage as the agents (over the Team MCP, with their token),
//      ending with your approval, with no GitHub;
//   6. reports token use for both agents and checks it's shown per agent;
//   7. builds a template through the UI's commands, exports it and imports it back;
//   8. closes the board, gets a retrospective proposal and accepts it;
//   9. reads the audit log and the project list (opening a second project from it), then stops HQ;
//  10. the coding team, unchanged: a Software Team on a GitHub repo plans a task, the developer
//      opens a pull request, HQ follows its review, and the merge marks the task done (a stand-in
//      `gh` plays GitHub).
// Needs Node 20+, git and tmux (Linux, macOS).

import { spawn, execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tarball = resolve(process.argv[2] ?? fail("usage: acceptance-test.mjs <yacc-hq-*.tgz> [port]"));
const port = Number(process.argv[3] ?? 7451);
const bundleFile = resolve(here, "..", "templates", "newsletter-desk.yacc-template.json");
const base = `http://127.0.0.1:${port}`;

const tmp = mkdtempSync(join(tmpdir(), "yacc-accept-"));
const home = join(tmp, "home");
const app = join(tmp, "app");
const repo = join(tmp, "desk");
const fakeBin = join(tmp, "bin");
const tmuxDir = join(tmp, "tmux");
let hq = null;
let log = "";
let checks = 0;

function cleanup() {
  try {
    hq?.kill("SIGTERM");
  } catch {}
  try {
    execFileSync("tmux", ["kill-server"], { env: { ...process.env, TMUX_TMPDIR: tmuxDir }, stdio: "ignore" });
  } catch {}
  try {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
  } catch {}
}
function fail(msg) {
  console.error(`✗ ${msg}${log ? `\n--- HQ log (last 3000 chars) ---\n${log.slice(-3000)}` : ""}`);
  cleanup();
  process.exit(1);
}
function ok(label, cond, detail) {
  if (!cond) fail(`${label}${detail !== undefined ? `\n  got: ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 1500)}` : ""}`);
  checks += 1;
}
const step = (s) => console.log(`\n▸ ${s}`);
const sh = (cmd, args, cwd, env) => execFileSync(cmd, args, { cwd, env: env ?? process.env, encoding: "utf8", stdio: "pipe" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(label, fn, ms = 20_000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(250);
  }
  fail(`timed out: ${label}`);
}
process.on("uncaughtException", (e) => fail(e.stack ?? String(e)));
process.on("unhandledRejection", (e) => fail(e?.stack ?? String(e)));

// ------------------------------------------------------------------ 1. Install and start

step("install the package and start HQ on a repo with no remote");
mkdirSync(app, { recursive: true });
mkdirSync(home, { recursive: true });
mkdirSync(tmuxDir, { recursive: true });
writeFileSync(join(app, "package.json"), '{ "name": "outsider", "private": true }\n');
sh("npm", ["install", "--no-audit", "--no-fund", tarball], app);
const pkgRoot = join(app, "node_modules", "yacc-hq");
const bin = join(pkgRoot, "bin", "yacc-hq.mjs");
const version = sh(process.execPath, [bin, "--version"]).trim();
ok("installed", /^\d+\.\d+\.\d+/.test(version), version);
ok("docs ship with the package", existsSync(join(pkgRoot, "docs", "templates", "newsletter-desk.md")) && existsSync(join(pkgRoot, "CHANGELOG.md")));
console.log(`  yacc-hq ${version}`);

// Stand-ins for Claude Code and Gemini CLI: they answer --version and then sit at a prompt, like the real ones.
mkdirSync(fakeBin);
for (const [name, ver] of [
  ["claude", "2.1.400 (Claude Code)"],
  ["gemini", "0.30.0"],
]) {
  const f = join(fakeBin, name);
  writeFileSync(f, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${ver}"; exit 0; fi\necho "${name} ready"\nexec cat\n`);
  chmodSync(f, 0o755);
}
// A stand-in GitHub CLI: signed in, `gh pr create` records a PR, and `gh api graphql` (HQ's PR
// sync) answers from that record. The test merges a PR by editing the record, as GitHub would.
const ghState = join(home, "gh-prs.json");
writeFileSync(
  join(fakeBin, "gh"),
  `#!${process.execPath}
const fs = require("node:fs");
const file = ${JSON.stringify(ghState)};
const a = process.argv.slice(2);
const read = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { prs: [] }; } };
if (a[0] === "--version") { console.log("gh version 2.60.0"); process.exit(0); }
if (a[0] === "auth" && a[1] === "status") { console.log("github.com\\n  ✓ Logged in to github.com account outsider"); process.exit(0); }
if (a[0] === "pr" && a[1] === "create") {
  const st = read(); const n = st.prs.length + 1;
  const title = a[a.indexOf("--title") + 1]; const head = a[a.indexOf("--head") + 1];
  st.prs.push({ number: n, title, headRefName: head, url: "https://github.com/acme/press/pull/" + n, createdAt: new Date().toISOString(), mergedAt: null, state: "OPEN", mergeable: "MERGEABLE", isDraft: false, reviewDecision: null, reviews: { nodes: [] }, reviewThreads: { nodes: [] }, commits: { nodes: [] } });
  fs.writeFileSync(file, JSON.stringify(st)); console.log("https://github.com/acme/press/pull/" + n); process.exit(0);
}
if (a[0] === "api" && a[1] === "graphql") {
  const prs = read().prs;
  console.log(JSON.stringify({ data: { rateLimit: { cost: 1, remaining: 4900, resetAt: new Date(Date.now() + 3600e3).toISOString() }, repository: { open: { nodes: prs.filter((p) => p.state === "OPEN") }, merged: { nodes: prs.filter((p) => p.state === "MERGED") }, closed: { nodes: [] } } } }));
  process.exit(0);
}
if (a[0] === "api") { console.log("{}"); process.exit(0); }
process.exit(0);
`,
);
chmodSync(join(fakeBin, "gh"), 0o755);

// Gemini CLI signs in with a key (GEMINI_API_KEY, below) or with Google; this is the latter, for good measure.
mkdirSync(join(home, ".gemini"));
writeFileSync(join(home, ".gemini", "oauth_creds.json"), "{}");

mkdirSync(repo);
const git = (...a) => sh("git", ["-c", "user.name=Outsider", "-c", "user.email=outsider@example.com", ...a], repo);
git("init", "-q", "-b", "main");
writeFileSync(join(repo, "README.md"), "# The Desk\n");
git("add", ".");
git("commit", "-qm", "init");

const env = { ...process.env, HOME: home, USERPROFILE: home, PATH: `${fakeBin}:${process.env.PATH}`, TMUX_TMPDIR: tmuxDir, BROWSER: "true", GEMINI_API_KEY: "acceptance-test-key" };
delete env.TMUX;
hq = spawn(process.execPath, [bin, "--repo", repo, "--port", String(port), "--no-open"], { env, stdio: ["ignore", "pipe", "pipe"] });
const token = await new Promise((done) => {
  const onData = (d) => {
    log += d;
    const m = log.match(/token=([a-f0-9]+)/);
    if (m) done(m[1]);
  };
  hq.stdout.on("data", onData);
  hq.stderr.on("data", onData);
  hq.on("exit", (code) => fail(`HQ exited (code ${code})`));
  const timer = setTimeout(() => fail("HQ didn't start in 60s"), 60_000);
  timer.unref();
  hq.stdout.on("data", () => /token=/.test(log) && clearTimeout(timer));
});
const q = `token=${token}`;

const WebSocket = createRequire(join(pkgRoot, "package.json"))("ws");
/** A fresh snapshot, as the browser gets it on connect. */
const snapshot = () =>
  new Promise((done, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?${q}`, { headers: { Origin: base } });
    ws.on("message", (raw) => {
      const e = JSON.parse(String(raw));
      if (e.type === "snapshot") {
        ws.close();
        done(e.snapshot);
      }
    });
    ws.on("error", reject);
  });
const control = new WebSocket(`ws://127.0.0.1:${port}/ws?${q}`, { headers: { Origin: base } });
await new Promise((r, j) => (control.once("open", r), control.once("error", j)));
/** A command, as a button in the UI sends it. */
const cmd = (name, ...args) => control.send(JSON.stringify({ cmd: name, args }));
const api = async (path, body) => {
  const r = await fetch(`${base}${path}${path.includes("?") ? "&" : "?"}${q}`, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { text };
  }
  return { status: r.status, json, headers: r.headers };
};

let snap = await snapshot();
ok("a fresh repo opens on the welcome screen", snap.welcome === true);
const projects = JSON.parse(readFileSync(join(home, ".yacc", "projects.json"), "utf8")).projects;
const slug = Object.keys(projects)[0];
ok("HQ put itself on the project list", projects[slug]?.root && resolve(projects[slug].root) === resolve(sh("git", ["rev-parse", "--show-toplevel"], repo).trim()), projects);

// ------------------------------------------------------------------ 2. A shared template, unaided

step("install a shared template and finish the welcome with it");
const bundle = JSON.parse(readFileSync(bundleFile, "utf8"));
const pv = await api("/api/templates/preview", { bundle });
ok("preview of the shared template", pv.status === 200 && pv.json.preview.name === "Newsletter desk" && pv.json.preview.stages.join() === "Research,Draft,Final", pv.json);
ok("preview says what it will do", pv.json.preview.notes.some((n) => /switched off/.test(n)));
const im = await api("/api/templates/import", { bundle, where: "user" });
ok("installed for this user", im.status === 200 && im.json.id === "user:newsletter-desk", im.json);
snap = await until("the template is offered", async () => {
  const s = await snapshot();
  return s.templates?.some((t) => t.id === "user:newsletter-desk") && s;
});

cmd("completeWelcome", {
  templateId: "user:newsletter-desk",
  projectName: "The Desk",
  lead: { name: "Nora", cli: "claude" },
  workers: [
    { name: "Leo", role: "researcher", cli: "gemini" },
    { name: "Ada", role: "writer", cli: "claude" },
    { name: "Sam", role: "editor", cli: "claude" },
  ],
});
snap = await until("the welcome finishes", async () => {
  const s = await snapshot();
  return !s.welcome && s;
});
const cfg0 = snap.config;
ok("team from the template", cfg0.team.map((a) => `${a.id}:${a.roleId}`).join() === "nora:lead,leo:researcher,ada:writer,sam:editor", cfg0.team);
ok("workflow from the template, as files (no GitHub)", cfg0.workflow.stages.map((s) => s.name).join() === "Research,Draft,Final" && cfg0.workflow.deliverable === "files");
ok("the template's skill is in the project", existsSync(join(repo, ".yacc", "skills", "newsletter-format", "SKILL.md")));
ok("the template's schedule came switched off", cfg0.schedules?.length === 1 && cfg0.schedules[0].enabled === false);
ok("config saved in the repo", readFileSync(join(repo, ".yacc", "config.yml"), "utf8").includes("Newsletter") || readFileSync(join(repo, ".yacc", "config.yml"), "utf8").includes("Editor-in-chief"));

// ------------------------------------------------------------------ 3. Two runtimes, two models

step("two programs, two models, Local mode; start the team");
const BRIEF = "Readers are small-business owners in Washington State. Tone: plain and calm. 600 words at most. Acceptance brief marker: desk-7.";
cmd("updateMemory", { brief: `# Brief\n\n${BRIEF}\n` });
for (const [id, model] of [
  ["nora", "sonnet"],
  ["leo", "gemini-3-flash-preview"],
  ["ada", "opus"],
  ["sam", "sonnet"],
])
  cmd("updateAgent", id, { mode: "local", model });
snap = await until("agents in Local mode with their models", async () => {
  const s = await snapshot();
  return s.config.team.every((a) => a.mode === "local") && s.config.team.find((a) => a.id === "leo").model === "gemini-3-flash-preview" && s;
});
cmd("recheckSetup");
await sleep(1500);
for (const a of snap.config.team) cmd("startAgent", a.id);
snap = await until(
  "all four agents running",
  async () => {
    const s = await snapshot();
    const bad = s.agents.find((a) => a.session.state === "failed");
    if (bad) fail(`${bad.agentId} failed to start: ${bad.session.detail}`);
    return s.agents.every((a) => a.session.state === "running") && s;
  },
  45_000,
);
const byId = (id) => snap.config.team.find((a) => a.id === id);
ok("P4: two runtimes", byId("leo").cli === "gemini" && byId("ada").cli === "claude");
ok("P4: different models", byId("leo").model !== byId("ada").model);

// ------------------------------------------------------------------ 4. Role files: tools and the brief

step("role files: different tools, the same brief");
const roleFile = (id) => readFileSync(join(home, ".yacc", slug, id, ".yacc-role.md"), "utf8");
const leoMd = roleFile("leo");
const adaMd = roleFile("ada");
const toolLines = (md) => md.split("\n").filter((l) => /toolkit|skill|Your tools/i.test(l)).join("\n");
ok("P6: the researcher and the writer have different tools", toolLines(leoMd) !== toolLines(adaMd) && /newsletter-format/.test(adaMd) && !/newsletter-format/.test(leoMd), { leo: toolLines(leoMd), ada: toolLines(adaMd) });
ok("P6: both have the same brief", leoMd.includes("desk-7") && adaMd.includes("desk-7"));
ok("P4: Gemini CLI reads its role from GEMINI settings", existsSync(join(home, ".yacc", slug, "leo", ".gemini", "settings.json")));

// ------------------------------------------------------------------ 5. One piece through every stage, no GitHub

step("one issue: research, draft, review, final, your approval");
const agentToken = readFileSync(join(home, ".yacc", slug, "agent-token"), "utf8").trim();
let rpc = 0;
/** A Team MCP tool call, as the agent's program makes it. */
async function mcp(agent, name, args = {}) {
  const r = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${agentToken}`, "x-hq-agent": agent },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpc, method: "tools/call", params: { name, arguments: args } }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${agent} ${name}: ${j.error.message}`);
  const text = (j.result.content ?? []).map((c) => c.text).join("");
  if (j.result.isError) throw new Error(`${agent} ${name}: ${text}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
const board = await mcp("nora", "create_board", { title: "November issues", active: true });
const task = await mcp("nora", "create_task", { title: "Issue for 17 November", boardId: board.id, doneWhen: "Sent to readers" });
ok("the lead planned the issue", task.id && task.stage === "research", task);
await mcp("nora", "assign_task", { taskId: task.id, agent: "leo" });
let mine = await mcp("leo", "get_my_task");
ok("the researcher has it", JSON.stringify(mine).includes(task.id));
let failedTool = "";
try {
  await mcp("leo", "create_task", { title: "Not mine to plan" });
} catch (e) {
  failedTool = e.message;
}
ok("a researcher can't plan (tools follow the role)", /not|can't|permission|role/i.test(failedTool), failedTool);
mkdirSync(join(home, ".yacc", slug, "leo", "research"), { recursive: true });
writeFileSync(join(home, ".yacc", slug, "leo", "research", "2026-11-17.md"), "# Stories\n- A story — https://example.com — why it matters.\n");
await mcp("leo", "share_files", { paths: ["research/2026-11-17.md"] });
await mcp("leo", "complete_stage", { note: "Six stories in shared/research/2026-11-17.md" });
snap = await snapshot();
let t = snap.tasks.find((x) => x.id === task.id);
ok("research → draft, handed to the writer", t.stage === "draft" && t.ownerId === "ada", t);
await mcp("ada", "complete_stage", { note: "Draft in shared/issues/2026-11-17.md" });
snap = await snapshot();
t = snap.tasks.find((x) => x.id === task.id);
ok("draft → review by the editor", t.status === "in-review" && t.reviewerId === "sam", t);
await mcp("sam", "request_changes", { taskId: task.id, feedback: "Trim the intro to two sentences." });
await mcp("ada", "complete_stage", { note: "Intro trimmed." });
await mcp("sam", "approve_work", { taskId: task.id, note: "Reads well." });
snap = await snapshot();
t = snap.tasks.find((x) => x.id === task.id);
ok("approved → final, with the editor", t.stage === "final" && t.ownerId === "sam", t);
await mcp("sam", "complete_stage", { note: "Checked and trimmed to 580 words." });
snap = await snapshot();
const approval = snap.actionItems.find((i) => i.kind === "approval" && i.status === "open" && i.taskId === task.id);
ok("waiting for your approval", approval, snap.actionItems);
cmd("resolveActionItem", approval.id, "done", "Send it.");
snap = await until("the issue is done", async () => {
  const s = await snapshot();
  return s.tasks.find((x) => x.id === task.id)?.status === "done" && s;
});
ok("P2: no GitHub anywhere", snap.pullRequests.length === 0 && !sh("git", ["remote"], repo).trim());
ok("P2: the research is in the project's shared folder", existsSync(join(repo, "shared", "research", "2026-11-17.md")) && snap.sharedFiles?.some((f) => (f.path ?? f) === "research/2026-11-17.md" || JSON.stringify(f).includes("2026-11-17.md")), snap.sharedFiles);

// ------------------------------------------------------------------ 6. Usage per agent

step("token use, per agent and model");
const otlp = (agent, body) => fetch(`${base}/otlp/${agent}/${agentToken}/v1/metrics`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const metric = (name, model, pts) => ({
  resourceMetrics: [{ scopeMetrics: [{ metrics: [{ name, sum: { aggregationTemporality: 1, dataPoints: pts.map(([type, n]) => ({ asInt: String(n), attributes: [{ key: "type", value: { stringValue: type } }, { key: "model", value: { stringValue: model } }] })) } }] }] }],
});
ok("Gemini CLI reports", (await otlp("leo", metric("gemini_cli.token.usage", "gemini-3-flash-preview", [["input", 12000], ["output", 800]]))).ok);
ok("Claude Code reports", (await otlp("ada", metric("claude_code.token.usage", "claude-opus-5-5", [["input", 3000], ["output", 1500]]))).ok);
snap = await until("usage shows", async () => {
  const s = await snapshot();
  return s.usage?.agents?.leo && s.usage?.agents?.ada && s;
});
const u = snap.usage.agents;
const tokens = (line) => line.input + line.output + line.cacheRead + line.cacheWrite;
ok("P4: usage per agent", tokens(u.leo.day) === 12800 && tokens(u.ada.day) === 4500 && u.leo.day.costUsd > 0 && u.ada.day.costUsd > 0, u);
ok("P4: each under its own model", u.leo.models.some((m) => /gemini/.test(m)) && u.ada.models.some((m) => /opus/.test(m)), { leo: u.leo.models, ada: u.ada.models });

// ------------------------------------------------------------------ 7. A template built in the UI, exported and imported

step("build a template in the UI, export it, import it back");
cmd("addRole", { title: "Fact checker", can: ["work", "review"], instructions: "- Check every claim against its source." });
snap = await until("the role is added", async () => {
  const s = await snapshot();
  return s.config.roles.some((r) => r.title === "Fact checker") && s;
});
const checker = snap.config.roles.find((r) => r.title === "Fact checker").id;
const stages = snap.config.workflow.stages;
cmd("updateWorkflow", { stages: [stages[0], stages[1], { id: "check", name: "Fact check", owner: checker, gate: "none", description: "Every claim has a working source." }, stages[2]] });
cmd("updateToolkits", [...(snap.config.toolkits ?? []), { id: "documents", roles: [checker] }]);
cmd("saveTemplate", "Desk with fact checks", "project", "The desk, plus a fact-check stage.");
snap = await until("the template is saved", async () => {
  const s = await snapshot();
  return s.templates?.some((x) => x.id === "project:desk-with-fact-checks") && s;
});
const ex = await api("/api/templates/export?id=project%3Adesk-with-fact-checks");
ok("export: a file to download", ex.status === 200 && /desk-with-fact-checks\.yacc-template\.json/.test(ex.headers.get("content-disposition") ?? "") && ex.json.format === "yacc-template");
const back = await api("/api/templates/preview", { bundle: ex.json });
ok("P5: it reads back with its new stage and role", back.status === 200 && back.json.preview.stages.join() === "Research,Draft,Fact check,Final" && back.json.preview.roles.some((r) => r.title === "Fact checker"), back.json);
const reimport = await api("/api/templates/import", { bundle: ex.json, where: "user" });
ok("P5: and installs cleanly", reimport.status === 200 && reimport.json.id === "user:desk-with-fact-checks", reimport.json);
const again = await api(`/api/templates/export?id=${encodeURIComponent(reimport.json.id)}`);
const strip = (b) => JSON.stringify({ ...b.template, name: undefined, description: undefined, schedules: undefined, files: b.files });
ok("P5: the round trip changes nothing", strip(again.json) === strip(ex.json));

// ------------------------------------------------------------------ 8. Retrospective

step("close the board, propose a role change, accept it");
await mcp("nora", "update_board", { boardId: board.id, status: "done" });
const proposal = await mcp("nora", "propose_role_change", { role: "writer", instructions: "- Write the issue from the research notes only; never add facts without a source.\n- Follow the newsletter-format skill and the brief's tone.\n- Keep intros to two sentences.", reason: "The editor sent the intro back this time." });
ok("the lead proposes", /CEO|proposed|decide/i.test(JSON.stringify(proposal)), proposal);
snap = await snapshot();
const rc = snap.actionItems.find((i) => i.kind === "role-change" && i.status === "open");
ok("you get the before and after", rc?.payload?.before && rc.payload.after.includes("two sentences"), rc);
cmd("resolveActionItem", rc.id, "done", "Agreed.");
snap = await until("the role is changed", async () => {
  const s = await snapshot();
  return s.config.roles.find((r) => r.id === "writer")?.instructions.includes("two sentences") && s;
});
ok("saved in the repo", readFileSync(join(repo, ".yacc", "roles", "writer.md"), "utf8").includes("two sentences"));

// ------------------------------------------------------------------ 9. Audit log and projects

step("audit log and project list");
const audit = (await api("/api/audit?limit=500")).json.entries;
const has = (kind, re, actor) => audit.some((e) => e.kind === kind && re.test(e.summary) && (!actor || e.actor === actor));
ok("audit: the template install", has("template", /Installed the template "Newsletter desk"/, "you"));
ok("audit: the assignment, by the lead", has("assign", new RegExp(`${task.id}.*Leo`), "nora"));
ok("audit: the editor's review", has("review", /back/, "sam") && has("review", /Approved Draft/, "sam"));
ok("audit: your approval", has("approval", new RegExp(`Approved Final on ${task.id}`), "you"));
ok("audit: config changes, with what changed", has("config", /Leo: .*model|model/, "you"));
ok("audit: the retrospective", has("retro", /Accepted the change to the Writer role/, "you"));
const csv = await fetch(`${base}/api/audit?${q}&format=csv`);
ok("audit: CSV download", (await csv.text()).startsWith("at,kind,actor,target,summary"));
const plist = (await api("/api/projects")).json.projects;
ok("projects: this one, running", plist?.length === 1 && plist[0].current && plist[0].running, plist);

// The switcher: add a second repo by its folder; HQ starts for it in the background.
const second = join(tmp, "lab");
mkdirSync(second);
sh("git", ["init", "-q", "-b", "main"], second);
const opened = await api("/api/projects/open", { root: second });
ok("projects: a second repo starts and opens", opened.status === 200 && opened.json.started && /^http:\/\/127\.0\.0\.1:\d+\/\?token=[a-f0-9]+$/.test(opened.json.url), opened.json);
const page2 = await fetch(opened.json.url);
ok("projects: its page is served", page2.ok && (await page2.text()).includes("<div id="));
const plist2 = (await api("/api/projects")).json.projects;
ok("projects: both on the list, both running", plist2.length === 2 && plist2.every((p) => p.running) && plist2[0].current, plist2);
const s2 = plist2.find((p) => !p.current);
const reopen = await api("/api/projects/open", { slug: s2.slug });
ok("projects: opening a running one doesn't start another", reopen.json.url === opened.json.url && !reopen.json.started);
const pid2 = JSON.parse(readFileSync(join(home, ".yacc", s2.slug, "session.json"), "utf8")).pid;
process.kill(pid2, "SIGTERM");
await until("the second HQ stops", async () => !existsSync(join(home, ".yacc", s2.slug, "session.json")));

hq.removeAllListeners("exit");
const exited = new Promise((r) => hq.once("exit", r));
hq.kill("SIGTERM");
await exited;
hq = null;
ok("stopping HQ removes how to reach it", !existsSync(join(home, ".yacc", slug, "session.json")));
control.terminate();

// ------------------------------------------------------------------ 10. The coding team, unchanged

step("the coding team: plan, pull request, review, merge");
const press = join(tmp, "press");
mkdirSync(press);
const pgit = (...a) => sh("git", ["-c", "user.name=Outsider", "-c", "user.email=outsider@example.com", ...a], press);
pgit("init", "-q", "-b", "main");
writeFileSync(join(press, "README.md"), "# Press\n");
pgit("add", ".");
pgit("commit", "-qm", "init");
pgit("remote", "add", "origin", "https://github.com/acme/press.git");
const cport = port + 3;
log = "";
hq = spawn(process.execPath, [bin, "--repo", press, "--port", String(cport), "--no-open"], { env, stdio: ["ignore", "pipe", "pipe"] });
const ctoken = await new Promise((done) => {
  const onData = (d) => {
    log += d;
    const m = log.match(/token=([a-f0-9]+)/);
    if (m) done(m[1]);
  };
  hq.stdout.on("data", onData);
  hq.stderr.on("data", onData);
  hq.on("exit", (code) => fail(`the coding HQ exited (code ${code})`));
  const timer = setTimeout(() => fail("the coding HQ didn't start in 60s"), 60_000);
  timer.unref();
  hq.stdout.on("data", () => /token=/.test(log) && clearTimeout(timer));
});
const cbase = `http://127.0.0.1:${cport}`;
const csnap = () =>
  new Promise((done, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${cport}/ws?token=${ctoken}`, { headers: { Origin: cbase } });
    ws.on("message", (raw) => {
      const e = JSON.parse(String(raw));
      if (e.type === "snapshot") (ws.close(), done(e.snapshot));
    });
    ws.on("error", reject);
  });
const cctl = new WebSocket(`ws://127.0.0.1:${cport}/ws?token=${ctoken}`, { headers: { Origin: cbase } });
await new Promise((r, j) => (cctl.once("open", r), cctl.once("error", j)));
const ccmd = (name, ...args) => cctl.send(JSON.stringify({ cmd: name, args }));
ccmd("completeWelcome", { templateId: "software-team", projectName: "Press", lead: { name: "Michael", cli: "claude" }, workers: [{ name: "Dwight", role: "developer", cli: "claude" }], reviewTool: "human", reviewEnabled: true });
let cs = await until("the coding team is set up", async () => {
  const x = await csnap();
  return !x.welcome && x;
});
ok("P1: the coding team ends in pull requests", cs.config.workflow.deliverable === "pull-request" && cs.config.workflow.stages.length === 1 && cs.config.workflow.stages[0].gate === "pull-request", cs.config.workflow);
ok("no sandboxes here, so the welcome put the team in Local mode", cs.config.team.every((a) => a.mode === "local"));
for (const a of cs.config.team) ccmd("startAgent", a.id);
cs = await until("the coding team is running", async () => {
  const x = await csnap();
  const bad = x.agents.find((a) => a.session.state === "failed");
  if (bad) fail(`${bad.agentId} failed to start: ${bad.session.detail}`);
  return x.agents.every((a) => a.session.state === "running") && x;
}, 45_000);
const cslug = Object.values(JSON.parse(readFileSync(join(home, ".yacc", "projects.json"), "utf8")).projects).find((p) => resolve(p.root) === resolve(sh("git", ["rev-parse", "--show-toplevel"], press).trim())).slug;
const devMd = readFileSync(join(home, ".yacc", cslug, "dwight", ".yacc-role.md"), "utf8");
ok("P1: the developer's instructions still say branch and pull request", /pull request/i.test(devMd) && /branch/i.test(devMd));
const ctokenAgent = readFileSync(join(home, ".yacc", cslug, "agent-token"), "utf8").trim();
async function cmcp(agent, name, args = {}) {
  const r = await fetch(`${cbase}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${ctokenAgent}`, "x-hq-agent": agent }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpc, method: "tools/call", params: { name, arguments: args } }) });
  const j = await r.json();
  const text = (j.result?.content ?? []).map((c) => c.text).join("");
  if (j.error || j.result?.isError) throw new Error(`${agent} ${name}: ${j.error?.message ?? text}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
const cb = await cmcp("michael", "create_board", { title: "Phase 1", active: true });
const ct = await cmcp("michael", "create_task", { title: "Add a contact page", boardId: cb.id, files: ["contact.html"], doneWhen: "The page is linked from the README" });
await cmcp("michael", "assign_task", { taskId: ct.id, agent: "dwight" });
const rules = JSON.stringify(await cmcp("dwight", "get_my_task"));
ok("P0: the developer is told to open a PR titled with the task", rules.includes(`[${ct.id}]`) && /PR/.test(rules), rules);
// Dwight's work, in his own clone: a branch, a commit, and the PR.
const clone = join(home, ".yacc", cslug, "dwight");
const dgit = (...a) => sh("git", ["-c", "user.name=Dwight", "-c", "user.email=dwight@example.com", ...a], clone);
dgit("checkout", "-q", "-b", `dwight/${ct.id}-contact`);
writeFileSync(join(clone, "contact.html"), "<h1>Contact</h1>\n");
dgit("add", "contact.html");
dgit("commit", "-qm", `${ct.id}: contact page`);
const prUrl = sh("gh", ["pr", "create", "--title", `[${ct.id}] Add a contact page`, "--head", `dwight/${ct.id}-contact`, "--body", "Adds contact.html"], clone, env).trim();
ok("P0: a pull request is open", /\/pull\/1$/.test(prUrl), prUrl);
await cmcp("dwight", "set_my_status", { status: "in-review", note: "PR open", prNumber: 1 });
cs = await until("HQ sees the PR", async () => {
  const x = await csnap();
  return x.pullRequests.some((p) => p.number === 1 && p.taskId === ct.id && p.authorId === "dwight") && x;
}, 45_000);
ok("P0: the task waits in review on its PR", cs.tasks.find((x) => x.id === ct.id)?.status === "in-review" && cs.tasks.find((x) => x.id === ct.id)?.prNumber === 1);
// A reviewer approves, and you merge, on GitHub.
const prs = JSON.parse(readFileSync(ghState, "utf8"));
prs.prs[0].reviewDecision = "APPROVED";
writeFileSync(ghState, JSON.stringify(prs));
cs = await until("HQ sees the approval", async () => {
  const x = await csnap();
  return x.pullRequests.find((p) => p.number === 1)?.review === "passed" && x;
}, 45_000);
ok("P0: the review passed", true);
prs.prs[0].state = "MERGED";
prs.prs[0].mergedAt = new Date().toISOString();
writeFileSync(ghState, JSON.stringify(prs));
cs = await until("the merge marks the task done", async () => {
  const x = await csnap();
  return x.tasks.find((t) => t.id === ct.id)?.status === "done" && x;
}, 45_000);
ok("P0: merged on GitHub → done in HQ (HQ never merges)", cs.pullRequests.find((p) => p.number === 1)?.merged);
cctl.terminate();
hq.removeAllListeners("exit");
hq.kill("SIGTERM");
hq = null;

cleanup();
console.log(`\n✓ acceptance test passed (${checks} checks)`);
process.exit(0);
