// Several projects (plan step 7.2). Each HQ serves one repo; this keeps a list of the repos
// you've run HQ in (~/.yacc/projects.json) and, for the running ones, how to reach them
// (~/.yacc/<project>/session.json, readable only by you). The project switcher opens a running
// one, or starts HQ for a stopped one in the background and opens it when it's ready.

import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProjectEntry } from "../src/data/projects";
import { projectHome } from "./paths";
import { detectRepo } from "./repo";

interface Registry {
  projects: Record<string, { slug: string; name: string; root: string; port: number; lastOpened: string }>;
}
interface Session {
  pid: number;
  port: number;
  token: string;
  startedAt: string;
}

export class ProjectError extends Error {}

const registryFile = () => join(homedir(), ".yacc", "projects.json");
const sessionFile = (slug: string) => join(projectHome(slug), "session.json");

function readRegistry(): Registry {
  try {
    const r = JSON.parse(readFileSync(registryFile(), "utf8")) as Registry;
    return r && typeof r.projects === "object" ? r : { projects: {} };
  } catch {
    return { projects: {} };
  }
}

function writeRegistry(r: Registry) {
  mkdirSync(join(homedir(), ".yacc"), { recursive: true });
  writeFileSync(registryFile(), JSON.stringify(r, null, 2));
}

function readSession(slug: string): Session | null {
  try {
    const s = JSON.parse(readFileSync(sessionFile(slug), "utf8")) as Session;
    return typeof s.pid === "number" && typeof s.port === "number" && typeof s.token === "string" ? s : null;
  } catch {
    return null;
  }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Is HQ answering on this port? */
async function healthy(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(800) });
    return r.ok;
  } catch {
    return false;
  }
}

const portFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });

/** Called by HQ when it starts: it's on the list, and how to reach it is written down (0600). */
export function registerProject(slug: string, name: string, root: string, port: number, token: string) {
  const r = readRegistry();
  r.projects[slug] = { slug, name, root, port, lastOpened: new Date().toISOString() };
  writeRegistry(r);
  writeFileSync(sessionFile(slug), JSON.stringify({ pid: process.pid, port, token, startedAt: new Date().toISOString() } satisfies Session), { mode: 0o600 });
}

/** Called by HQ when it stops. */
export function unregisterSession(slug: string) {
  const s = readSession(slug);
  if (s?.pid === process.pid) rmSync(sessionFile(slug), { force: true });
}

/** Every project you've run HQ in, most recently opened first. */
export async function listProjects(currentSlug: string): Promise<ProjectEntry[]> {
  const r = readRegistry();
  const out: ProjectEntry[] = [];
  for (const p of Object.values(r.projects)) {
    const s = readSession(p.slug);
    const running = p.slug === currentSlug || (!!s && alive(s.pid) && (await healthy(s.port)));
    out.push({ slug: p.slug, name: p.name, root: p.root, port: running && s ? s.port : p.port, running, current: p.slug === currentSlug, missing: !existsSync(p.root), lastOpened: p.lastOpened });
  }
  return out.sort((a, b) => Number(b.current) - Number(a.current) || b.lastOpened.localeCompare(a.lastOpened));
}

/** A port for a project to start on: its usual one if free, else the next free one from 7420. */
async function pickPort(preferred: number, taken: number[]): Promise<number> {
  if (preferred && !taken.includes(preferred) && (await portFree(preferred))) return preferred;
  for (let p = 7420; p < 7520; p++) if (!taken.includes(p) && (await portFree(p))) return p;
  throw new ProjectError("No free port between 7420 and 7519.");
}

export interface Launcher {
  /** Starts HQ for a repo on a port, in the background; its output goes to logFile. */
  (root: string, port: number, logFile: string): void;
}

/** Starts this same HQ program (dist-server/main.mjs, or the dev entry) for another repo. */
export const launchHq: Launcher = (root, port, logFile) => {
  mkdirSync(join(logFile, ".."), { recursive: true });
  const fd = openSync(logFile, "a");
  const child = spawn(process.execPath, [...process.execArgv, process.argv[1], "--repo", root, "--port", String(port), "--no-open"], {
    detached: true,
    stdio: ["ignore", fd, fd],
    windowsHide: true,
    env: process.env,
  });
  child.unref();
  closeSync(fd);
};

/**
 * The address to open a project at: right away when it's running, after starting HQ for it when
 * it isn't (up to 45 s). `root` adds a repo that isn't on the list yet.
 */
export async function openProject(ref: { slug?: string; root?: string }, currentSlug: string, launcher: Launcher = launchHq): Promise<{ url: string; slug: string; started: boolean }> {
  let slug = ref.slug ?? "";
  let entry = slug ? readRegistry().projects[slug] : undefined;
  if (!entry && ref.root) {
    let repo;
    try {
      repo = await detectRepo(ref.root.trim().replace(/^~(?=$|[\\/])/, homedir()));
    } catch {
      throw new ProjectError(`${ref.root} isn't inside a git repository. Run "git init" there first.`);
    }
    entry = Object.values(readRegistry().projects).find((p) => p.root === repo.root);
    if (!entry) {
      const before = new Set(Object.keys(readRegistry().projects));
      const all = await listProjects(currentSlug);
      const port = await pickPort(0, all.filter((p) => p.running).map((p) => p.port));
      launcher(repo.root, port, join(homedir(), ".yacc", "logs", `${repo.name}.log`));
      // The new HQ registers itself; wait for it to appear.
      const end = Date.now() + 45_000;
      while (Date.now() < end) {
        await new Promise((r) => setTimeout(r, 300));
        const added = Object.values(readRegistry().projects).find((p) => !before.has(p.slug) && p.root === repo.root);
        const s = added && readSession(added.slug);
        if (added && s && (await healthy(s.port))) return { url: `http://127.0.0.1:${s.port}/?token=${s.token}`, slug: added.slug, started: true };
      }
      throw new ProjectError(`HQ didn't start for ${repo.root} within 45 seconds. See ~/.yacc/logs/${repo.name}.log.`);
    }
    slug = entry.slug;
  }
  if (!entry) throw new ProjectError(`No project ${slug}.`);
  if (!existsSync(entry.root)) throw new ProjectError(`${entry.root} isn't there any more. Remove it from the list.`);
  const s = readSession(entry.slug);
  if (s && alive(s.pid) && (await healthy(s.port))) return { url: `http://127.0.0.1:${s.port}/?token=${s.token}`, slug: entry.slug, started: false };
  const all = await listProjects(currentSlug);
  const port = await pickPort(entry.port, all.filter((p) => p.running).map((p) => p.port));
  const startedAt = Date.now();
  launcher(entry.root, port, join(projectHome(entry.slug), "hq.log"));
  const end = Date.now() + 45_000;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 300));
    const n = readSession(entry.slug);
    if (n && Date.parse(n.startedAt) >= startedAt - 1000 && (await healthy(n.port))) return { url: `http://127.0.0.1:${n.port}/?token=${n.token}`, slug: entry.slug, started: true };
  }
  throw new ProjectError(`HQ didn't start for ${entry.name} within 45 seconds. See ~/.yacc/${entry.slug}/hq.log.`);
}

/** Takes a project off the list (its files are left alone). Not the one you're in, nor a running one. */
export async function forgetProject(slug: string, currentSlug: string) {
  if (slug === currentSlug) throw new ProjectError("That's the project you're in.");
  const s = readSession(slug);
  if (s && alive(s.pid) && (await healthy(s.port))) throw new ProjectError("It's running. Stop its HQ first.");
  const r = readRegistry();
  delete r.projects[slug];
  writeRegistry(r);
}
