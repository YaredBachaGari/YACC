// Workflow stages and gates. Shared by the server (which moves work through them)
// and the UI (which edits them and draws the board).

import { roleSlug } from "./roles";
import { ANY_ROLE, CEO_ID, GATES, LEAD_ROLE_ID, type HqConfig, type StageConfig, type Task, type WorkflowConfig } from "./types";

/** The coding team's flow: one stage, finished by a pull request that is reviewed and merged on GitHub. */
export const codingStages = (): StageConfig[] => [{ id: "build", name: "Build", owner: ANY_ROLE, gate: "pull-request" }];

/** A flow for projects without GitHub: do the work, the lead reviews it. */
export const filesStages = (): StageConfig[] => [{ id: "do", name: "Do", owner: ANY_ROLE, gate: "review", reviewer: LEAD_ROLE_ID }];

export const defaultWorkflowParts = (github: boolean): Pick<WorkflowConfig, "item" | "deliverable" | "stages"> =>
  github ? { item: "Task", deliverable: "pull-request", stages: codingStages() } : { item: "Task", deliverable: "files", stages: filesStages() };

export const stageOf = (wf: Pick<WorkflowConfig, "stages">, task: Pick<Task, "stage">): StageConfig =>
  wf.stages.find((s) => s.id === task.stage) ?? wf.stages[0];

export const nextStageOf = (wf: Pick<WorkflowConfig, "stages">, task: Pick<Task, "stage">): StageConfig | null => {
  const i = wf.stages.indexOf(stageOf(wf, task));
  return wf.stages[i + 1] ?? null;
};

/** "Brief → Research → Script (review) → Approve (you)" */
export function describeFlow(cfg: Pick<HqConfig, "workflow" | "roles" | "ceo">): string {
  const roleTitle = (id: string) => (id === ANY_ROLE ? "anyone" : (cfg.roles.find((r) => r.id === id)?.title ?? id));
  return cfg.workflow.stages
    .map((s, i) => {
      const gate =
        s.gate === "none" ? "" :
        s.gate === "ceo" ? `, then ${cfg.ceo.name} approves` :
        s.gate === "pull-request" ? ", ends with a pull request reviewed and merged on GitHub" :
        `, then ${s.reviewer ? roleTitle(s.reviewer) : `a teammate who can ${s.gate === "review" ? "review" : "approve"}`} ${s.gate === "review" ? "reviews" : "signs off"}`;
      return `${i + 1}. ${s.name}: ${roleTitle(s.owner)}${gate}${s.description ? `. Done when: ${s.description}` : ""}`;
    })
    .join("\n");
}

/**
 * Keeps the workflow usable: at least one stage, unique ids, owners and reviewers that are roles,
 * and a pull-request gate only where it can work (GitHub deliverable, last stage).
 * Returns what it had to fix. Called from normalizeConfig.
 */
export function normalizeWorkflow(cfg: HqConfig): string[] {
  const fixed: string[] = [];
  const wf = cfg.workflow;
  wf.item = String(wf.item ?? "").trim().slice(0, 30) || "Task";
  if (wf.deliverable !== "files") wf.deliverable = "pull-request";
  if (!Array.isArray(wf.stages) || wf.stages.length === 0) {
    wf.stages = wf.deliverable === "pull-request" ? codingStages() : filesStages();
    fixed.push("The workflow needs at least one stage; added the default.");
  }
  const seen = new Set<string>();
  const roleIds = new Set(cfg.roles.map((r) => r.id));
  wf.stages = wf.stages.slice(0, 12).map((s, i, all) => {
    const name = String(s.name ?? s.id ?? "").trim().slice(0, 30) || `Stage ${i + 1}`;
    let id = roleSlug(String(s.id ?? name));
    for (let n = 2; seen.has(id); n++) id = `${roleSlug(name)}-${n}`;
    seen.add(id);
    let owner = String(s.owner ?? ANY_ROLE);
    if (owner !== ANY_ROLE && !roleIds.has(owner)) {
      fixed.push(`Stage "${name}" named the role "${owner}", which doesn't exist; anyone can do it now.`);
      owner = ANY_ROLE;
    }
    let gate = (GATES as readonly string[]).includes(s.gate) ? s.gate : "none";
    if (gate === "pull-request" && (wf.deliverable !== "pull-request" || i !== all.length - 1)) {
      fixed.push(`Stage "${name}": a pull-request gate works only on the last stage of a GitHub workflow; it is a review now.`);
      gate = "review";
    }
    const stage: StageConfig = { id, name, owner, gate };
    const description = String(s.description ?? "").replace(/\s+/g, " ").trim().slice(0, STAGE_DESCRIPTION_MAX);
    if (description) stage.description = description;
    if ((gate === "review" || gate === "approval") && s.reviewer) {
      if (roleIds.has(s.reviewer)) stage.reviewer = s.reviewer;
      else fixed.push(`Stage "${name}" named the reviewer role "${s.reviewer}", which doesn't exist; anyone who can ${gate === "review" ? "review" : "approve"} checks it now.`);
    }
    return stage;
  });
  return fixed;
}

export const STAGE_DESCRIPTION_MAX = 200;
export const MAX_STAGES = 12;

/** A new stage's id: from its name, unlike any other stage's. Existing stages keep theirs when renamed, so their work stays put. */
export function newStageId(stages: Pick<StageConfig, "id">[], name: string): string {
  const base = /[a-z0-9]/i.test(name) ? roleSlug(name) : "stage";
  let id = base;
  for (let n = 2; stages.some((s) => s.id === id); n++) id = `${base}-${n}`;
  return id;
}

export interface StageIssue {
  /** The stage it's about (its index), or null for the whole flow. */
  stage: number | null;
  /** error: can't be saved as is. warn: saves, but work may stall there. */
  level: "error" | "warn";
  text: string;
}

/**
 * What the workflow editor points out before saving: things that can't work (errors) and
 * stages where work would wait because nobody on the team can do or check it (warnings).
 */
export function stageIssues(cfg: Pick<HqConfig, "roles" | "team" | "ceo">, wf: Pick<WorkflowConfig, "deliverable">, stages: StageConfig[]): StageIssue[] {
  const out: StageIssue[] = [];
  const role = (id: string) => cfg.roles.find((r) => r.id === id);
  const holders = (id: string) => cfg.team.filter((a) => a.roleId === id);
  const can = (perm: "work" | "review" | "approve") => cfg.team.filter((a) => role(a.roleId)?.can.includes(perm));
  if (!stages.length) out.push({ stage: null, level: "error", text: "The workflow needs at least one stage." });
  if (stages.length > MAX_STAGES) out.push({ stage: null, level: "error", text: `At most ${MAX_STAGES} stages.` });
  const names = new Map<string, number>();
  stages.forEach((s, i) => {
    const name = s.name.trim();
    if (!name) out.push({ stage: i, level: "error", text: `Stage ${i + 1} needs a name.` });
    else if (names.has(name.toLowerCase())) out.push({ stage: i, level: "error", text: `Two stages are called "${name}".` });
    names.set(name.toLowerCase(), i);
    const label = name || `Stage ${i + 1}`;
    if (s.gate === "pull-request" && (wf.deliverable !== "pull-request" || i !== stages.length - 1))
      out.push({ stage: i, level: "error", text: `${label}: a pull request can only end the last stage of a GitHub workflow.` });
    if (s.owner === ANY_ROLE) {
      if (!can("work").length) out.push({ stage: i, level: "warn", text: `${label}: nobody on the team takes tasks yet.` });
    } else if (!role(s.owner)) {
      out.push({ stage: i, level: "error", text: `${label}: the role "${s.owner}" doesn't exist.` });
    } else if (!holders(s.owner).length) {
      out.push({ stage: i, level: "warn", text: `${label}: nobody is a ${role(s.owner)!.title} yet. Work will wait there until the lead assigns it or hires one.` });
    }
    if (s.gate === "review" || s.gate === "approval") {
      const perm = s.gate === "review" ? "review" : "approve";
      if (s.reviewer) {
        const r = role(s.reviewer);
        if (!r) out.push({ stage: i, level: "error", text: `${label}: the role "${s.reviewer}" doesn't exist.` });
        else if (!holders(s.reviewer).length) out.push({ stage: i, level: "warn", text: `${label}: nobody is a ${r.title} yet to ${perm} it.` });
      } else if (!can(perm).length) {
        out.push({ stage: i, level: "warn", text: `${label}: nobody on the team can ${perm} yet (give a role the ${perm} permission).` });
      }
    }
    if ((s.description ?? "").length > STAGE_DESCRIPTION_MAX) out.push({ stage: i, level: "error", text: `${label}: "done when" is longer than ${STAGE_DESCRIPTION_MAX} characters.` });
  });
  return out;
}

/** Puts every task in a stage that exists. Returns the ids of tasks it moved. */
export function placeTasks(wf: Pick<WorkflowConfig, "stages">, tasks: Task[]): string[] {
  const ids = new Set(wf.stages.map((s) => s.id));
  const moved: string[] = [];
  for (const t of tasks)
    if (!t.stage || !ids.has(t.stage)) {
      if (t.stage) moved.push(t.id);
      t.stage = wf.stages[0].id;
    }
  return moved;
}

export const isCeo = (id: string | null | undefined) => id === CEO_ID;
