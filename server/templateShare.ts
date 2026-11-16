// Sharing templates (plan step 7.3): export one as a single file, import one from a file or a
// URL, and browse a gallery. An import is checked completely first: the bundle is written to a
// temporary folder and read back with the same checks as any saved template. Only then is it
// moved into place, with its schedules switched off.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { stringify as toYaml } from "yaml";
import { roleSlug } from "../src/data/roles";
import { BUNDLE_FILE, BUNDLE_FORMAT, BUNDLE_MAX_BYTES, BUNDLE_VERSION, DEFAULT_GALLERY, previewTemplate, templateToBundle, type GalleryEntry, type TemplateBundle, type TemplatePreview } from "../src/data/templateBundle";
import type { Template } from "../src/data/templates";
import { listTemplates, readTemplate, templateDir } from "./templates";

export class ShareError extends Error {}

/** Checks a bundle's shape and sizes (not yet its content: see checkBundle). */
function shape(raw: unknown): TemplateBundle {
  const b = (raw ?? {}) as Partial<TemplateBundle>;
  if (b.format !== BUNDLE_FORMAT) throw new ShareError("This isn't a YACC template (its format isn't yacc-template).");
  if (typeof b.version !== "number" || b.version > BUNDLE_VERSION) throw new ShareError(`This template needs a newer YACC (bundle version ${String(b.version)}). Update YACC and try again.`);
  if (!b.template || typeof b.template !== "object" || Array.isArray(b.template)) throw new ShareError("The template is missing.");
  const files = b.files ?? {};
  if (typeof files !== "object" || Array.isArray(files)) throw new ShareError("The template's files aren't a list of files.");
  for (const [path, text] of Object.entries(files)) {
    if (!BUNDLE_FILE.test(path)) throw new ShareError(`The template carries a file HQ won't write: ${path.slice(0, 120)}. Only text files inside skills/<name>/ are allowed.`);
    if (typeof text !== "string") throw new ShareError(`${path} isn't text.`);
  }
  const size = JSON.stringify(b).length;
  if (size > BUNDLE_MAX_BYTES) throw new ShareError(`The template is too large (${Math.round(size / 1024)} KB; at most ${BUNDLE_MAX_BYTES / 1000} KB).`);
  return { format: BUNDLE_FORMAT, version: b.version, template: b.template, files: files as Record<string, string> };
}

/** Writes a bundle as a template folder (template.yml + files). Its schedules are switched off. */
function writeFolder(dir: string, bundle: TemplateBundle) {
  mkdirSync(dir, { recursive: true });
  const doc = { ...bundle.template };
  if (Array.isArray(doc.schedules)) doc.schedules = doc.schedules.map((s) => (s && typeof s === "object" ? { ...(s as object), enabled: false } : s));
  writeFileSync(join(dir, "template.yml"), `# A YACC team template, imported. Edit by hand or save again from Settings.\n${toYaml(doc, { lineWidth: 0 })}`);
  for (const [path, text] of Object.entries(bundle.files)) {
    const file = join(dir, ...path.split("/"));
    if (!file.startsWith(dir + sep)) throw new ShareError(`Bad path: ${path}`);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, text);
  }
}

/** Reads a bundle the way installing would, without installing it. Throws ShareError with what's wrong. */
export function checkBundle(raw: unknown): { bundle: TemplateBundle; template: Template; preview: TemplatePreview } {
  const bundle = shape(raw);
  const tmp = mkdtempSync(join(tmpdir(), "yacc-template-"));
  const dir = join(tmp, roleSlug(String(bundle.template.name ?? "template")));
  try {
    writeFolder(dir, bundle);
    let template: Template;
    try {
      template = readTemplate(dir, "user");
    } catch (err) {
      throw new ShareError(String(err instanceof Error ? err.message : err).replace(join(dir, "template.yml"), "the template"));
    }
    return { bundle, template, preview: previewTemplate(template) };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Installs a bundle in this project (.yacc/templates/) or for you (~/.yacc/templates/). Returns the new template's id. */
export function installBundle(raw: unknown, where: "project" | "user", repoRoot: string): { id: string; dir: string; name: string } {
  const { bundle, template } = checkBundle(raw);
  const base = templateDir(where, repoRoot);
  mkdirSync(base, { recursive: true });
  const slug = roleSlug(template.name);
  let name = slug;
  for (let n = 2; existsSync(join(base, name)); n++) name = `${slug}-${n}`;
  const staging = join(base, `.${name}.${process.pid}.tmp`);
  rmSync(staging, { recursive: true, force: true });
  writeFolder(staging, bundle);
  renameSync(staging, join(base, name));
  return { id: `${where}:${name}`, dir: join(base, name), name: template.name };
}

/** All text files in a saved template's skill folders, keyed by their path in the bundle. */
export function skillFiles(dir: string): Record<string, string> {
  const root = join(dir, "skills");
  const out: Record<string, string> = {};
  const walk = (d: string, depth: number) => {
    if (depth > 5 || !existsSync(d)) return;
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p, depth + 1);
      else {
        const rel = `skills/${relative(root, p).split(sep).join("/")}`;
        if (BUNDLE_FILE.test(rel)) out[rel] = readFileSync(p, "utf8");
      }
    }
  };
  walk(root, 0);
  return out;
}

/** A template (built-in, this project's or yours) as a bundle to share. */
export function exportTemplate(id: string, repoRoot: string): TemplateBundle {
  const t = listTemplates(repoRoot).templates.find((x) => x.id === id);
  if (!t) throw new ShareError(`No template ${id}.`);
  const dir = t.source === "built-in" ? null : join(templateDir(t.source, repoRoot), id.slice(id.indexOf(":") + 1));
  return templateToBundle(t, dir ? skillFiles(dir) : {});
}

/** Deletes a template you or this project saved. Built-in ones can't be deleted. */
export function deleteTemplate(id: string, repoRoot: string) {
  const [source, name] = id.split(":");
  if ((source !== "project" && source !== "user") || !name || name !== roleSlug(name)) throw new ShareError("Built-in templates can't be deleted.");
  const dir = join(templateDir(source, repoRoot), name);
  if (!existsSync(join(dir, "template.yml"))) throw new ShareError(`No template ${id}.`);
  rmSync(dir, { recursive: true, force: true });
}

/** GitHub page links to a file become links to the file itself. */
export function rawUrl(url: string): string {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(url.trim());
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` : url.trim();
}

/** Fetches JSON over https, at most BUNDLE_MAX_BYTES. */
export async function fetchJson(url: string, fetcher: typeof fetch = fetch): Promise<unknown> {
  let u: URL;
  try {
    u = new URL(rawUrl(url));
  } catch {
    throw new ShareError("That isn't a URL.");
  }
  if (u.protocol !== "https:") throw new ShareError("Templates are fetched over https only.");
  let r: Response;
  try {
    r = await fetcher(u, { signal: AbortSignal.timeout(15_000), redirect: "follow" });
  } catch (err) {
    throw new ShareError(`Couldn't fetch ${u.host}: ${err instanceof Error ? err.message : err}`);
  }
  if (!r.ok) throw new ShareError(`${u.host} answered ${r.status}.`);
  const text = await r.text();
  if (text.length > BUNDLE_MAX_BYTES) throw new ShareError(`That file is too large (${Math.round(text.length / 1024)} KB).`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ShareError("That file isn't JSON. Use a .yacc-template.json file.");
  }
}

/** The gallery's templates, with their URLs made absolute. */
export async function readGallery(indexUrl = process.env.YACC_GALLERY || DEFAULT_GALLERY, fetcher: typeof fetch = fetch): Promise<GalleryEntry[]> {
  const raw = (await fetchJson(indexUrl, fetcher)) as { templates?: unknown };
  const list = Array.isArray(raw?.templates) ? raw.templates : [];
  const out: GalleryEntry[] = [];
  for (const item of list.slice(0, 200)) {
    const e = (item ?? {}) as Partial<GalleryEntry>;
    if (typeof e.name !== "string" || typeof e.url !== "string") continue;
    let url: string;
    try {
      url = new URL(e.url, rawUrl(indexUrl)).toString();
    } catch {
      continue;
    }
    out.push({ id: typeof e.id === "string" ? e.id : roleSlug(e.name), name: e.name.slice(0, 80), description: typeof e.description === "string" ? e.description.slice(0, 300) : "", url, ...(Array.isArray(e.tags) ? { tags: e.tags.filter((t): t is string => typeof t === "string").slice(0, 8) } : {}) });
  }
  return out;
}

/** Copies a template folder (used by the gallery build script). */
export const copyTemplate = (from: string, to: string) => cpSync(from, to, { recursive: true });
