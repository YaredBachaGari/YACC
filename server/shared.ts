// The project's shared folder: `shared/` in the repo. Each agent works in its own folder (and,
// in a sandbox, can see nothing else), so this is how one agent's output reaches the next.
// An agent shares files from its folder with share_files; HQ copies them here, on the host.
// HQ copies the folder into an agent's own `shared/` when work is handed to it, or on get_shared_files.

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import type { SharedFile } from "../src/data/types";
import { excludeFromGit } from "./agentFiles";
import type { Hub } from "./hub";
import { parseCliJson } from "./lib/json";
import { projectHome } from "./paths";
import { workspaceFor } from "./workspace";

export const SHARED_DIR = "shared";
/** Most bytes one share_files call may copy. */
export const MAX_SHARE_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 500;

/** A relative path inside a folder, or an error saying why not. Rejects absolute paths and `..`. */
export function safeRelative(path: string): string {
  const raw = String(path ?? "").trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!raw) throw new Error("Give a path relative to your folder, e.g. drafts/script.md");
  if (isAbsolute(raw) || /^[a-zA-Z]:/.test(raw)) throw new Error(`"${path}" is an absolute path. Give it relative to your folder.`);
  const clean = normalize(raw).split(sep).join("/");
  if (clean === ".." || clean.startsWith("../") || clean.split("/").includes("..")) throw new Error(`"${path}" points outside your folder.`);
  if (clean.split("/")[0] === ".git") throw new Error("Files in .git can't be shared.");
  return clean;
}

/** True when `target`, after following links, is inside `base`. */
function inside(base: string, target: string): boolean {
  const b = realpathSync(base);
  const t = realpathSync(target);
  const rel = relative(b, t);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Every file under `dir` (relative paths), not following links. */
function walk(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === ".git") continue;
    const full = join(dir, name);
    const st = lstatSync(full);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (st.isDirectory()) out.push(...walk(full, rel));
    else if (st.isFile()) out.push(rel);
  }
  return out;
}

export class SharedFiles {
  private indexFile: string;
  private index: Record<string, { by: string; at: string }>;

  constructor(private hub: Hub) {
    this.indexFile = join(projectHome(hub.slug), "shared-index.json");
    this.index = (existsSync(this.indexFile) && parseCliJson<Record<string, { by: string; at: string }>>(readFileSync(this.indexFile, "utf8"))) || {};
    this.publish(false);
  }

  get folder() {
    return join(this.hub.repo.root, SHARED_DIR);
  }

  list(): SharedFile[] {
    if (!existsSync(this.folder)) return [];
    return walk(this.folder)
      .map((path) => {
        const st = statSync(join(this.folder, path));
        const meta = this.index[path];
        return { path, by: meta?.by ?? "", at: meta?.at ?? st.mtime.toISOString(), bytes: st.size };
      })
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  private publish(emit = true) {
    this.hub.snap.sharedFiles = this.list();
    if (emit) this.hub.emit({ type: "shared.updated", files: this.hub.snap.sharedFiles });
  }

  private saveIndex() {
    mkdirSync(dirname(this.indexFile), { recursive: true });
    const tmp = `${this.indexFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.index, null, 2));
    renameSync(tmp, this.indexFile);
  }

  /** Copies files or folders from an agent's folder into the shared folder. Returns the shared paths. */
  share(agentId: string, paths: string[]): string[] {
    const agent = this.hub.cfg(agentId);
    if (!agent) throw new Error(`No agent ${agentId}`);
    if (!Array.isArray(paths) || !paths.length) throw new Error("Name at least one file or folder to share.");
    const base = workspaceFor(agent, this.hub.slug);
    // Work out everything first: nothing is copied unless all of it is allowed.
    const files: string[] = [];
    for (const p of paths) {
      const rel = safeRelative(p);
      if (rel === SHARED_DIR || rel.startsWith(`${SHARED_DIR}/`)) throw new Error(`${rel} is already from the shared folder.`);
      const full = join(base, rel);
      if (!existsSync(full)) throw new Error(`${rel} isn't in your folder.`);
      if (!inside(base, full)) throw new Error(`${rel} points outside your folder.`);
      const st = lstatSync(full);
      if (st.isSymbolicLink()) throw new Error(`${rel} is a link. Share the file itself.`);
      if (st.isDirectory()) files.push(...walk(full).map((f) => `${rel}/${f}`));
      else if (st.isFile()) files.push(rel);
    }
    if (!files.length) throw new Error("Nothing to share: those folders are empty.");
    if (files.length > MAX_FILES) throw new Error(`That is ${files.length} files; share at most ${MAX_FILES} at a time.`);
    const bytes = files.reduce((n, f) => n + statSync(join(base, f)).size, 0);
    if (bytes > MAX_SHARE_BYTES) throw new Error(`That is ${Math.round(bytes / 1048576)} MB; share at most ${MAX_SHARE_BYTES / 1048576} MB at a time.`);
    const at = new Date().toISOString();
    for (const f of files) {
      const to = join(this.folder, f);
      mkdirSync(dirname(to), { recursive: true });
      cpSync(join(base, f), to);
      this.index[f] = { by: agentId, at };
    }
    this.saveIndex();
    this.publish();
    this.hub.activity("message", agentId, `${this.hub.name(agentId)} shared ${files.length === 1 ? files[0] : `${files.length} files`}`);
    return files;
  }

  /**
   * Copies shared files into an agent's own `shared/` folder (all of them, or the paths given).
   * Kept out of the agent's git. Returns the paths copied.
   */
  deliver(agentId: string, paths?: string[]): string[] {
    const agent = this.hub.cfg(agentId);
    if (!agent || !existsSync(this.folder)) return [];
    const base = workspaceFor(agent, this.hub.slug);
    if (!existsSync(base)) return [];
    const all = walk(this.folder);
    const wanted = paths?.length ? paths.map(safeRelative) : null;
    const pick = wanted ? all.filter((f) => wanted.some((w) => f === w || f.startsWith(`${w}/`))) : all;
    if (wanted && !pick.length) throw new Error(`None of those are shared. Shared: ${all.slice(0, 20).join(", ") || "nothing yet"}`);
    for (const f of pick) {
      const to = join(base, SHARED_DIR, f);
      mkdirSync(dirname(to), { recursive: true });
      cpSync(join(this.folder, f), to);
    }
    try {
      excludeFromGit(base, [`${SHARED_DIR}/`]);
    } catch {
      // Not a git folder: nothing to keep it out of.
    }
    return pick;
  }

  /** Best effort, for handoffs: never fails the handoff. */
  deliverQuietly(agentId: string) {
    try {
      this.deliver(agentId);
    } catch {
      /* the agent can still call get_shared_files */
    }
  }
}
