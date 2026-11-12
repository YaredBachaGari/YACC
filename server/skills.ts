// Agent skills for the project's stack (plan 009). Installed once per project
// into a cache with the skills CLI (`npx skills add`), then copied into each
// agent's folder: Claude Code reads .claude/skills/, Codex reads .agents/skills/.
// The copies are git-excluded and replaced when the stack changes.

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { agentMkdir, agentPath, agentRemove } from "./lib/agentFs";
import { createHash } from "node:crypto";
import { join, resolve, sep } from "node:path";
import type { SkillSpec } from "../src/data/stack";
import { excludeFromGit } from "./agentFiles";
import { run } from "./lib/exec";
import { log } from "./lib/log";
import { projectHome } from "./paths";

const AGENT_DIRS = [".claude/skills", ".agents/skills"]; // Claude Code, Codex

const cacheDir = (slug: string) => join(projectHome(slug), "skills-cache");
const key = (specs: SkillSpec[]) => JSON.stringify(specs);

let installing: Promise<void> | null = null;

/** Installs the specs into the project's cache (once per change of specs). */
export function ensureSkillCache(slug: string, specs: SkillSpec[]): Promise<void> {
  const run_ = async () => {
    const dir = cacheDir(slug);
    const stamp = join(dir, "installed.json");
    if (existsSync(stamp) && readFileSync(stamp, "utf8") === key(specs)) return;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    if (!specs.length) return writeFileSync(stamp, key(specs));
    await run("git", ["init", "-q"], { cwd: dir }); // the CLI installs into the current project
    const failed: string[] = [];
    for (const spec of specs) {
      const args = ["-y", "skills", "add", spec.source, "--skill", ...spec.skills, "-a", "claude-code", "codex", "-y", "--copy"];
      // npx is a .cmd shim on Windows, which only runs through cmd.exe.
      const [cmd, cmdArgs] = process.platform === "win32" ? ["cmd.exe", ["/d", "/s", "/c", "npx", ...args]] : ["npx", args];
      const r = await run(cmd, cmdArgs, {
        cwd: dir,
        timeoutMs: 180_000,
      });
      if (!r.ok) failed.push(`${spec.source}: ${(r.stderr || r.stdout).trim().split("\n").pop()}`);
    }
    if (failed.length) throw new Error(`Some skills didn't install. ${failed.join("; ")}`);
    writeFileSync(stamp, key(specs));
  };
  // One install at a time per HQ; a second caller waits for the first.
  const next = (installing ?? Promise.resolve()).then(run_);
  // What's kept for the next caller never rejects (an unhandled rejection would stop HQ).
  const settled = next.then(
    () => {},
    () => {},
  );
  installing = settled;
  void settled.then(() => {
    if (installing === settled) installing = null;
  });
  return next;
}

// Which skill folders HQ put in each agent's folder. Kept in HQ's own home, not in the
// agent's folder (an agent can edit its .git), and only ever names paths like
// .claude/skills/<name> — so nothing outside those two folders can be deleted.
const SAFE = /^\.(claude|agents)\/skills\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ownedFile = (slug: string, workspace: string) =>
  join(projectHome(slug), "skills-owned", `${createHash("sha1").update(resolve(workspace)).digest("hex").slice(0, 16)}.json`);

function readOwned(slug: string, workspace: string): string[] {
  try {
    const list = JSON.parse(readFileSync(ownedFile(slug, workspace), "utf8")) as unknown;
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string" && SAFE.test(p)) : [];
  } catch {
    return [];
  }
}

/** True if HQ has put skills into this folder before (so a now-empty stack still cleans them up). */
export const hasHqSkills = (slug: string, workspace: string) => readOwned(slug, workspace).length > 0;

/** Copies the cached skills into an agent's folder and removes ones HQ added before that the stack dropped. */
export async function syncSkillsInto(slug: string, workspace: string): Promise<string[]> {
  const before = readOwned(slug, workspace);
  const tracked = async (rel: string) => (await run("git", ["ls-files", "--error-unmatch", rel], { cwd: workspace })).ok;
  const inside = (rel: string) => SAFE.test(rel) && resolve(workspace, rel).startsWith(resolve(workspace) + sep);
  const now: string[] = [];
  const there = (rel: string) => {
    try {
      lstatSync(agentPath(workspace, rel));
      return true;
    } catch {
      return false;
    }
  };
  for (const sub of AGENT_DIRS) {
    const from = join(cacheDir(slug), sub);
    if (!existsSync(from)) continue;
    agentMkdir(workspace, sub); // refuses if .claude, .agents or skills is a symlink
    for (const name of readdirSync(from)) {
      const rel = `${sub}/${name}`;
      if (!inside(rel)) continue;
      // Never touch a skill the repo commits, or one that's already there and isn't HQ's.
      if (await tracked(rel)) continue;
      if (there(rel) && !before.includes(rel)) continue;
      agentRemove(workspace, rel); // removes a symlink itself, never its target
      cpSync(join(from, name), agentPath(workspace, rel), { recursive: true });
      now.push(rel);
    }
  }
  for (const rel of before) {
    if (now.includes(rel) || !inside(rel) || (await tracked(rel))) continue;
    try {
      agentRemove(workspace, rel);
    } catch {
      /* a symlinked parent: leave it */
    }
  }
  mkdirSync(join(projectHome(slug), "skills-owned"), { recursive: true });
  writeFileSync(ownedFile(slug, workspace), JSON.stringify(now));
  excludeFromGit(workspace, now);
  return now;
}

/** Install (if needed) and copy into the workspace. Never fails the agent's start. */
export async function prepareSkills(slug: string, workspace: string, specs: SkillSpec[]): Promise<{ count: number; error: string | null }> {
  try {
    await ensureSkillCache(slug, specs);
    const copied = await syncSkillsInto(slug, workspace);
    return { count: copied.filter((p) => p.startsWith(".claude/")).length, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`skills: ${msg}`);
    return { count: 0, error: msg };
  }
}
