// The team's own skills: folders in .yacc/skills/<name>/ with a SKILL.md (front matter with a
// name and a description, then the instructions), committed with the project. config.yml says
// which roles get each one; HQ copies them into those agents' folders when they start.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SKILL_BODY_MAX, SKILL_DESCRIPTION_MAX, SKILL_NAME, parseSkillMd, skillMd, type ProjectSkillInfo } from "../src/data/toolkits";

export const skillsDir = (root: string) => join(root, ".yacc", "skills");

export class SkillError extends Error {}

/** Every folder in .yacc/skills/, with what's wrong with it if it can't be used. */
export function listProjectSkills(root: string): ProjectSkillInfo[] {
  const base = skillsDir(root);
  if (!existsSync(base)) return [];
  const out: ProjectSkillInfo[] = [];
  for (const name of readdirSync(base).sort()) {
    const dir = join(base, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    if (!SKILL_NAME.test(name)) {
      out.push({ name, description: "", problem: "The folder name must be lowercase letters, numbers and dashes." });
      continue;
    }
    const file = join(dir, "SKILL.md");
    if (!existsSync(file)) {
      out.push({ name, description: "", problem: "There's no SKILL.md in this folder." });
      continue;
    }
    const parsed = parseSkillMd(readFileSync(file, "utf8"));
    if (!parsed) out.push({ name, description: "", problem: "SKILL.md must start with front matter (--- name and description ---)." });
    else if (!parsed.description) out.push({ name, description: "", problem: "SKILL.md needs a description: agents use it to decide when the skill applies." });
    else if (parsed.name && parsed.name !== name) out.push({ name, description: parsed.description, problem: `SKILL.md says its name is "${parsed.name}"; it must match the folder, "${name}".` });
    else out.push({ name, description: parsed.description, problem: null });
  }
  return out;
}

/** A project skill's text, for editing. */
export function readProjectSkill(root: string, name: string): { name: string; description: string; body: string } | null {
  if (!SKILL_NAME.test(name)) return null;
  const file = join(skillsDir(root), name, "SKILL.md");
  if (!existsSync(file)) return null;
  const parsed = parseSkillMd(readFileSync(file, "utf8"));
  return parsed ? { name, description: parsed.description, body: parsed.body } : { name, description: "", body: readFileSync(file, "utf8") };
}

/** Creates or rewrites a project skill's SKILL.md (other files in its folder are left alone). */
export function writeProjectSkill(root: string, name: string, description: string, body: string) {
  if (!SKILL_NAME.test(name)) throw new SkillError("A skill's name is lowercase letters, numbers and dashes, like brand-voice.");
  if (!description.trim()) throw new SkillError("Give the skill a description: agents read it to decide when the skill applies.");
  if (description.length > SKILL_DESCRIPTION_MAX) throw new SkillError(`The description is longer than ${SKILL_DESCRIPTION_MAX} characters.`);
  if (!body.trim()) throw new SkillError("Write the skill's instructions.");
  if (body.length > SKILL_BODY_MAX) throw new SkillError(`The instructions are longer than ${SKILL_BODY_MAX / 1000}k characters. Put long reference material in other files in the skill's folder.`);
  const dir = join(skillsDir(root), name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), skillMd(name, description, body));
}

/** Deletes a project skill's folder. */
export function removeProjectSkill(root: string, name: string) {
  if (!SKILL_NAME.test(name)) return;
  rmSync(join(skillsDir(root), name), { recursive: true, force: true });
}

/** Folders to copy into an agent's skills folders: the project skills its role gets that exist and are valid. */
export function projectSkillSources(root: string, names: string[]): { name: string; dir: string }[] {
  const ok = new Set(listProjectSkills(root).filter((s) => !s.problem).map((s) => s.name));
  return names.filter((n) => ok.has(n)).map((name) => ({ name, dir: join(skillsDir(root), name) }));
}
