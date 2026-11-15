// Profiles and office themes (Phase 5 part 1): avatars (built-in looks and uploaded pictures),
// bios, the CEO's look, the office theme, how they are cleaned, saved to YAML, carried by
// templates, written to role files and served over HTTP. No agents, sandboxes or network needed.
//
//   npx tsx scripts/profiles-test.ts

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "yacc-profiles-"));
Object.assign(process.env, { HOME: tmp, USERPROFILE: tmp });

const { makeCommands } = await import("../server/commands");
const { roleMd } = await import("../server/agentFiles");
const { readAvatar, removeAvatar, saveAvatar } = await import("../server/avatars");
const { Hub } = await import("../server/hub");
const { startHttp } = await import("../server/http");
const { newAgent, parseConfig, serializeConfig } = await import("../server/store");
const { readTemplate, saveTemplate } = await import("../server/templates");
const { AVATAR_MAX_BYTES, BIO_MAX, HAIR_COUNT, SKIN_COUNT, STYLE_COUNT, cleanAvatar, cleanBio, cleanTheme, isPng } = await import("../src/data/profile");
const { defaultAutonomy, defaultRoles, normalizeConfig } = await import("../src/data/roles");
const { BUILT_IN_TEMPLATES } = await import("../src/data/templates");
const { defaultWorkflowParts } = await import("../src/data/workflow");
const { CEO_ID, LEAD_ROLE_ID, THEME_IDS } = await import("../src/data/types");
const { AVATAR_PRESETS, HAIR, HAIR_STYLES, SKIN, lookFor } = await import("../src/officeModern/avatar");
const { THEMES, themeOf } = await import("../src/officeModern/themes");
import type { HqConfig, SetupState } from "../src/data/types";
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

// A real 1×1 PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function team(): HqConfig {
  const lead = newAgent("maya", "Maya", LEAD_ROLE_ID, "#ff77a8");
  const ada = newAgent("ada", "Ada", "developer", "#29adff", "maya");
  const cfg: HqConfig = {
    project: { id: "p", name: "P", repo: "acme/p", path: tmp, hqPort: 7420 },
    ceo: { name: "Abuti" },
    limits: { maxAgents: 8 },
    autonomy: defaultAutonomy(),
    roles: defaultRoles(),
    team: [lead, ada],
    workflow: { ...defaultWorkflowParts(true), review: { enabled: true, tool: "human", command: "" }, merge: { by: "human" }, deploy: { enabled: false, tool: "custom", command: "", perAgentEnvironments: false } },
  };
  normalizeConfig(cfg);
  return cfg;
}

let n = 0;
function world(cfg = team()) {
  const name = `w${++n}`;
  const root = join(tmp, name);
  mkdirSync(join(root, ".yacc"), { recursive: true });
  const repo: RepoInfo = { root, name, originUrl: null, github: null, hasCodeRabbit: false, hasInsta: false };
  cfg.project.path = root;
  const setup = { machine: { cpus: 4, memoryGb: 8 }, checks: [], sandboxReady: false, localReady: true, checkedAt: "" } as SetupState;
  const hub = new Hub(repo, `profiles-${name}-${process.pid}`, cfg, { boards: [{ id: "B1", title: "Backlog", status: "active", order: 0 }], tasks: [] }, setup);
  const stub = {} as never;
  const cmds = makeCommands(hub, { recheckSetup: async () => undefined } as never, stub, stub, stub, stub, { briefings: stub, memory: stub });
  return { hub, root, cmds, cfg: () => hub.snap.config };
}

// ------------------------------------------------------------------ 1. Cleaning input

ok("avatar: nothing → undefined", cleanAvatar(undefined) === undefined && cleanAvatar({}) === undefined && cleanAvatar("x") === undefined);
ok("avatar: a full look is kept", JSON.stringify(cleanAvatar({ skin: 2, hair: 7, style: 4, glasses: true })) === JSON.stringify({ skin: 2, hair: 7, style: 4, glasses: true }));
ok("avatar: out-of-range and non-integer indices are dropped", JSON.stringify(cleanAvatar({ skin: SKIN_COUNT, hair: -1, style: 1.5, glasses: "yes" })) === undefined || cleanAvatar({ skin: SKIN_COUNT, hair: -1, style: 1.5, glasses: "yes" }) === undefined);
ok("avatar: last valid index is kept", cleanAvatar({ skin: SKIN_COUNT - 1, hair: HAIR_COUNT - 1, style: STYLE_COUNT - 1 })?.style === STYLE_COUNT - 1);
ok("avatar: an uploaded picture path is kept", cleanAvatar({ image: "avatars/ada-0a1b2c3d.png" })?.image === "avatars/ada-0a1b2c3d.png");
for (const bad of ["../config.yml", "avatars/../../x.png", "avatars/ada.jpg", "/etc/passwd", "avatars/Ada.png", "https://x.test/a.png", "data:image/png;base64,AAAA"])
  ok(`avatar: picture path "${bad}" is refused`, cleanAvatar({ image: bad }) === undefined);
ok("avatar: unknown keys are dropped", !("hat" in (cleanAvatar({ skin: 1, hat: "top" }) ?? {})));
ok("bio: trimmed to one line", cleanBio("  Likes\n\ntests   and\tdocs ") === "Likes tests and docs");
ok("bio: at most BIO_MAX", cleanBio("x".repeat(BIO_MAX + 50)).length === BIO_MAX);
ok("bio: non-strings are empty", cleanBio(42) === "" && cleanBio(null) === "");
ok("theme: known ids pass", THEME_IDS.every((t) => cleanTheme(t) === t));
ok("theme: anything else is undefined", cleanTheme("disco") === undefined && cleanTheme(undefined) === undefined && cleanTheme(3) === undefined);
ok("png: signature detected", isPng(Buffer.from(PNG, "base64")));
ok("png: JPEG and junk are not PNGs", !isPng(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0])) && !isPng(Buffer.from("hello")) && !isPng(new Uint8Array()));

// ------------------------------------------------------------------ 2. Looks

ok("palettes match the profile ranges", SKIN.length === SKIN_COUNT && HAIR.length === HAIR_COUNT && HAIR_STYLES.length === STYLE_COUNT);
{
  const base = lookFor("ada");
  ok("look: same id, same look", JSON.stringify(base) === JSON.stringify(lookFor("ada")));
  ok("look: no avatar = the id's look", JSON.stringify(lookFor("ada", undefined)) === JSON.stringify(base) && JSON.stringify(lookFor("ada", {})) === JSON.stringify(base));
  const mine = lookFor("ada", { skin: 5, hair: 2, style: 3, glasses: true });
  ok("look: chosen parts win", mine.skin === SKIN[5] && mine.hair === HAIR[2] && mine.style === 3 && mine.glasses === true);
  const part = lookFor("ada", { hair: 6 });
  ok("look: unchosen parts come from the id", part.hair === HAIR[6] && part.skin === base.skin && part.style === base.style && part.glasses === base.glasses);
  const off = lookFor("ada", { skin: 99, style: -2 });
  ok("look: out-of-range choices fall back", off.skin === base.skin && off.style === base.style);
  ok("look: glasses false is a choice", lookFor("ada", { glasses: false }).glasses === false);
}
ok("presets: a dozen, all valid and different", AVATAR_PRESETS.length === 12 && AVATAR_PRESETS.every((p) => JSON.stringify(cleanAvatar(p)) === JSON.stringify(p)) && new Set(AVATAR_PRESETS.map((p) => JSON.stringify(p))).size === 12);

// ------------------------------------------------------------------ 3. Themes

ok("themes: one per id", THEME_IDS.every((id) => THEMES[id]?.id === id) && Object.keys(THEMES).length === THEME_IDS.length);
const hex = /^#[0-9a-f]{6}$/i;
for (const id of THEME_IDS) {
  const t = THEMES[id];
  const colours = [t.floor.base, t.wall.top, t.wall.bottom, t.wall.skirting, t.sign.bg, t.sign.fg, t.rug.fill, t.rug.line, ...Object.values(t.rooms), ...Object.values(t.desk), t.chair, ...t.sofa, ...t.table, t.pot, t.muted, t.outside, ...t.swatches];
  ok(`theme ${id}: every colour is #rrggbb`, colours.every((c) => hex.test(c)), colours.find((c) => !hex.test(c)));
  ok(`theme ${id}: label and description`, t.label.length > 0 && t.description.length > 10);
  ok(`theme ${id}: brick walls say their mortar`, t.wall.kind !== "brick" || !!t.wall.brick);
  // The sign must be readable: rough luminance contrast between its colours.
  const lum = (c: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(t.sign.bg), lum(t.sign.fg)].sort((a, b) => b - a);
  ok(`theme ${id}: the wall sign has contrast ≥ 4.5`, (hi + 0.05) / (lo + 0.05) >= 4.5, ((hi + 0.05) / (lo + 0.05)).toFixed(2));
}
ok("themes: the night theme has night windows", THEMES.night.night && !THEMES.modern.night);
ok("themeOf: unknown or missing → modern", themeOf(undefined).id === "modern" && themeOf("disco" as never).id === "modern" && themeOf("loft").id === "loft");

// ------------------------------------------------------------------ 4. YAML

{
  const cfg = team();
  cfg.project.theme = "loft";
  cfg.ceo.avatar = { skin: 4, style: 1 };
  const ada = cfg.team.find((a) => a.id === "ada")!;
  ada.avatar = { hair: 3, glasses: true, image: "avatars/ada-1234abcd.png" };
  ada.bio = "Front end; cares about accessibility.";
  const { yaml, files } = serializeConfig(cfg);
  ok("yaml: theme under project", /project:[\s\S]*theme: loft/.test(yaml));
  ok("yaml: the CEO's look", /ceo:\n\s+name: Abuti\n\s+avatar:\n\s+skin: 4\n\s+style: 1/.test(yaml), yaml.slice(0, 400));
  ok("yaml: an agent's avatar and bio", /avatar:\n\s+hair: 3\n\s+glasses: true\n\s+image: avatars\/ada-1234abcd.png\n\s+bio: Front end; cares about accessibility./.test(yaml));
  ok("yaml: no avatar or bio for the lead, who has none", !/name: Maya[\s\S]*?avatar:[\s\S]*?name: Ada/.test(yaml));
  const back = parseConfig(yaml, (rel) => files[rel] ?? null).config;
  ok("yaml: round trip keeps the theme", back.project.theme === "loft");
  ok("yaml: round trip keeps the CEO's look", JSON.stringify(back.ceo.avatar) === JSON.stringify({ skin: 4, style: 1 }));
  const backAda = back.team.find((a) => a.id === "ada")!;
  ok("yaml: round trip keeps the avatar", JSON.stringify(backAda.avatar) === JSON.stringify(ada.avatar));
  ok("yaml: round trip keeps the bio", backAda.bio === ada.bio);
  ok("yaml: no avatar → none after parsing", !back.team.find((a) => a.id === "maya")!.avatar && !("bio" in back.team.find((a) => a.id === "maya")!));

  // Hand edits that don't make sense are dropped, not fatal.
  const edited = yaml.replace("theme: loft", "theme: disco").replace("skin: 4", "skin: 40").replace("image: avatars/ada-1234abcd.png", "image: ../../secret.png");
  const loose = parseConfig(edited, (rel) => files[rel] ?? null).config;
  ok("yaml: an unknown theme is dropped", loose.project.theme === undefined);
  ok("yaml: an out-of-range skin is dropped, the rest kept", JSON.stringify(loose.ceo.avatar) === JSON.stringify({ style: 1 }));
  ok("yaml: a picture outside .yacc/avatars is dropped", loose.team.find((a) => a.id === "ada")!.avatar?.image === undefined && loose.team.find((a) => a.id === "ada")!.avatar?.hair === 3);
  throws("yaml: an avatar that isn't a mapping is refused", () => parseConfig(yaml.replace(/ceo:\n(\s+)name: Abuti\n\s+avatar:\n\s+skin: 4\n\s+style: 1/, "ceo:\n$1name: Abuti\n$1avatar: smiley"), (rel) => files[rel] ?? null), /ceo\.avatar/);
}
{
  const cfg = team() as HqConfig & { team: { avatar?: unknown; bio?: unknown }[] };
  (cfg.team[1] as { avatar?: unknown }).avatar = { skin: 99 };
  (cfg.team[1] as { bio?: unknown }).bio = "   ";
  (cfg.project as { theme?: unknown }).theme = "neon";
  normalizeConfig(cfg);
  ok("normalize: an empty avatar and bio are removed", !("avatar" in cfg.team[1]) && !("bio" in cfg.team[1]));
  ok("normalize: an unknown theme is removed", !("theme" in cfg.project));
}

// ------------------------------------------------------------------ 5. Commands

{
  const { cmds, cfg, root, hub } = world();
  const ada = () => cfg().team.find((a) => a.id === "ada")!;
  cmds.updateAgent("ada", { avatar: { skin: 2, hair: 1, style: 0, glasses: false }, bio: "  Writes   tests first.  " });
  ok("updateAgent: look saved", JSON.stringify(ada().avatar) === JSON.stringify({ skin: 2, hair: 1, style: 0, glasses: false }));
  ok("updateAgent: bio cleaned and saved", ada().bio === "Writes tests first.");
  ok("updateAgent: written to config.yml", /bio: Writes tests first./.test(readFileSync(join(root, ".yacc", "config.yml"), "utf8")));
  cmds.updateAgent("ada", { avatar: { skin: 77, image: "avatars/evil.png" } as never });
  ok("updateAgent: a look can't set the picture, and bad parts are dropped", ada().avatar === undefined);

  cmds.setAvatarImage("ada", PNG);
  const first = ada().avatar?.image ?? "";
  ok("picture: saved under .yacc/avatars with a fresh name", /^avatars\/ada-[0-9a-f]{8}\.png$/.test(first) && existsSync(join(root, ".yacc", first)), first);
  ok("picture: the bytes are the upload", readFileSync(join(root, ".yacc", first)).equals(Buffer.from(PNG, "base64")));
  cmds.updateAgent("ada", { avatar: { hair: 4 } });
  ok("picture: changing the look keeps it", ada().avatar?.image === first && ada().avatar?.hair === 4);
  cmds.setAvatarImage("ada", `data:image/png;base64,${PNG}`);
  const second = ada().avatar?.image ?? "";
  ok("picture: a data URL works too, under a new name", second !== first && existsSync(join(root, ".yacc", second)));
  ok("picture: the old file is deleted", !existsSync(join(root, ".yacc", first)));
  cmds.updateAgent("ada", { avatar: null });
  ok("picture: resetting the look keeps the picture", JSON.stringify(ada().avatar) === JSON.stringify({ image: second }));

  const before = hub.snap.activity.length;
  cmds.setAvatarImage("ada", Buffer.from("GIF89a hello").toString("base64"));
  ok("picture: a non-PNG is refused and you're told", ada().avatar?.image === second && hub.snap.activity.length === before + 1 && /must be a PNG/.test(hub.snap.activity[0].text), hub.snap.activity[0]?.text);
  cmds.setAvatarImage("ada", "not base64 at all!");
  ok("picture: junk is refused", ada().avatar?.image === second && /base64/.test(hub.snap.activity[0].text));
  const big = Buffer.concat([Buffer.from(PNG, "base64"), Buffer.alloc(AVATAR_MAX_BYTES)]).toString("base64");
  cmds.setAvatarImage("ada", big);
  ok("picture: too large is refused", ada().avatar?.image === second && /too large/.test(hub.snap.activity[0].text));
  ok("picture: only one file on disk", readdirSync(join(root, ".yacc", "avatars")).length === 1);
  cmds.setAvatarImage("nobody", PNG);
  ok("picture: unknown agents are ignored", readdirSync(join(root, ".yacc", "avatars")).length === 1);
  cmds.setAvatarImage("ada", null);
  ok("picture: removed, with its file", ada().avatar === undefined && readdirSync(join(root, ".yacc", "avatars")).length === 0);
  cmds.setAvatarImage("ada", null);
  ok("picture: removing twice is harmless", ada().avatar === undefined);

  cmds.updateOrg({ ceoAvatar: { skin: 3, glasses: true } });
  ok("CEO: look saved", JSON.stringify(cfg().ceo.avatar) === JSON.stringify({ skin: 3, glasses: true }));
  cmds.setAvatarImage(CEO_ID, PNG);
  ok("CEO: picture saved under ceo-…", /^avatars\/ceo-[0-9a-f]{8}\.png$/.test(cfg().ceo.avatar?.image ?? "") && cfg().ceo.avatar?.skin === 3);
  ok("CEO: written to config.yml", /ceo:\n\s+name: Abuti\n\s+avatar:\n\s+skin: 3/.test(readFileSync(join(root, ".yacc", "config.yml"), "utf8")));
  cmds.updateOrg({ ceoAvatar: null });
  ok("CEO: reset keeps the picture", Object.keys(cfg().ceo.avatar ?? {}).join() === "image");
  cmds.updateOrg({ ceoName: "Ab" });
  ok("CEO: renaming keeps the look", !!cfg().ceo.avatar?.image && cfg().ceo.name === "Ab");

  cmds.updateProject({ theme: "night" });
  ok("theme: saved", cfg().project.theme === "night" && /theme: night/.test(readFileSync(join(root, ".yacc", "config.yml"), "utf8")));
  cmds.updateProject({ theme: "disco" as never });
  ok("theme: unknown clears it (back to modern)", cfg().project.theme === undefined);
  cmds.updateProject({ name: "Q" });
  ok("theme: other project edits leave it alone", cfg().project.theme === undefined && cfg().project.name === "Q");
}

// ------------------------------------------------------------------ 6. Pictures on disk and over HTTP

{
  const root = join(tmp, "files");
  mkdirSync(join(root, ".yacc"), { recursive: true });
  const rel = saveAvatar(root, "Ada Lovelace!", PNG);
  ok("save: the name is made safe", /^avatars\/ada-lovelace-[0-9a-f]{8}\.png$/.test(rel), rel);
  ok("read: by file name", readAvatar(root, rel.slice("avatars/".length))?.equals(Buffer.from(PNG, "base64")));
  for (const bad of ["../config.yml", "..%2fconfig.yml", "x/../../config.yml", "nope.png", ""]) ok(`read: "${bad}" gives nothing`, readAvatar(root, bad) === null);
  removeAvatar(root, "../config.yml"); // only HQ's own pictures can be removed
  ok("remove: other files are never touched", existsSync(join(root, ".yacc")));
  removeAvatar(root, rel);
  ok("remove: the picture is gone", readAvatar(root, rel.slice("avatars/".length)) === null);
}
{
  const { hub, root } = world();
  const rel = saveAvatar(root, "ada", PNG);
  const port = 7900 + (process.pid % 90);
  const stub = {} as never;
  const server = await startHttp({ hub, inbox: stub, planner: stub, team: stub, mcpExtras: stub, port, browserToken: "browser-tok", agentToken: "agent-tok", distDir: null, allowedOrigins: [], commands: {} });
  try {
    const at = (path: string) => fetch(`http://127.0.0.1:${port}${path}`);
    const file = rel.slice("avatars/".length);
    let r = await at(`/avatars/${file}`);
    ok("http: no token → 401", r.status === 401);
    r = await at(`/avatars/${file}?token=agent-tok`);
    ok("http: the agent token doesn't work → 401", r.status === 401);
    r = await at(`/avatars/${file}?token=browser-tok`);
    const body = Buffer.from(await r.arrayBuffer());
    ok("http: the picture, as a PNG", r.status === 200 && r.headers.get("content-type") === "image/png" && body.equals(Buffer.from(PNG, "base64")));
    ok("http: cached for good (names change on upload) and never sniffed", /immutable/.test(r.headers.get("cache-control") ?? "") && r.headers.get("x-content-type-options") === "nosniff");
    r = await at(`/avatars/missing-00000000.png?token=browser-tok`);
    ok("http: unknown picture → 404", r.status === 404);
    r = await at(`/avatars/..%2fconfig.yml?token=browser-tok`);
    ok("http: no way out of .yacc/avatars", r.status === 404);
  } finally {
    server.close();
  }
}

// ------------------------------------------------------------------ 7. Role files and templates

{
  const cfg = team();
  const ada = cfg.team.find((a) => a.id === "ada")!;
  ok("role file: no About section without a bio", !/## About you/.test(roleMd(ada, cfg)));
  ada.bio = "Front end; cares about accessibility.";
  const md = roleMd(ada, cfg);
  ok("role file: the bio, before the role", /## About you\nFront end; cares about accessibility.\n\n## Your role/.test(md), md.slice(0, 600));
}
ok("templates: built-ins pick a theme", BUILT_IN_TEMPLATES.every((t) => t.theme && THEME_IDS.includes(t.theme)));
ok("templates: Content Studio → Studio, R&D Lab → Lab, Software Team → Modern", BUILT_IN_TEMPLATES.find((t) => t.id === "content-studio")?.theme === "studio" && BUILT_IN_TEMPLATES.find((t) => t.id === "rd-lab")?.theme === "lab" && BUILT_IN_TEMPLATES.find((t) => t.id === "software-team")?.theme === "modern");
{
  const root = join(tmp, "tpl");
  mkdirSync(join(root, ".yacc"), { recursive: true });
  const cfg = team();
  cfg.project.theme = "loft";
  const dir = saveTemplate(cfg, "", "Loft team", "project", root);
  ok("templates: a saved template keeps the theme", /theme: loft/.test(readFileSync(join(dir, "template.yml"), "utf8")) && readTemplate(dir, "project").theme === "loft");
  const plain = team();
  const dir2 = saveTemplate(plain, "", "Plain team", "project", root);
  ok("templates: no theme, none saved", !/theme:/.test(readFileSync(join(dir2, "template.yml"), "utf8")) && readTemplate(dir2, "project").theme === undefined);
}

rmSync(tmp, { recursive: true, force: true });
console.log(`profiles: ${passed} checks passed`);
