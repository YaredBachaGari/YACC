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
      return `${i + 1}. ${s.name}: ${roleTitle(s.owner)}${gate}`;
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
    if ((gate === "review" || gate === "approval") && s.reviewer) {
      if (roleIds.has(s.reviewer)) stage.reviewer = s.reviewer;
      else fixed.push(`Stage "${name}" named the reviewer role "${s.reviewer}", which doesn't exist; anyone who can ${gate === "review" ? "review" : "approve"} checks it now.`);
    }
    return stage;
  });
  return fixed;
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
