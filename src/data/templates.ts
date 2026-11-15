// Templates: a whole team setup for one purpose (roles, starting agents, workflow, autonomy,
// a starting brief), and the role library: ready-made roles the CEO adds and the lead hires from.
// Built-ins live here; templates you save are folders under .yacc/templates/ (server/templates.ts).

import type { ToolkitChoice } from "./toolkits";
import { DEVELOPER_INSTRUCTIONS, LEAD_DUTIES, WORKER_BASE_INSTRUCTIONS, roleSlug } from "./roles";
import { ANY_ROLE, LEAD_ROLE_ID, type AutonomyConfig, type DeliverableKind, type Permission, type RoleConfig, type StageConfig, type ThemeId } from "./types";

/** A ready-made role. `instructions` say what the role does; HQ adds how tasks and tools work. */
export interface RoleCard {
  id: string;
  title: string;
  /** One line, shown when choosing. */
  summary: string;
  can: Permission[];
  instructions: string;
}

export interface TemplateAgent {
  name: string;
  /** Role id in the template's roles. */
  role: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  /** built-in, saved in this project (.yacc/templates/), or saved for you (~/.yacc/templates/). */
  source: "built-in" | "project" | "user";
  officeName?: string;
  /** The office look it starts with (Settings → Project changes it later). */
  theme?: ThemeId;
  item: string;
  deliverable: DeliverableKind;
  stages: StageConfig[];
  /** Includes the lead role. Roles nobody starts with are the team's library: the lead can hire into them. */
  roles: RoleConfig[];
  /** Starting agents. The first has the lead role. */
  team: TemplateAgent[];
  autonomy?: AutonomyConfig;
  maxAgents?: number;
  /** Starting project brief (.yacc/memory/brief.md). */
  brief?: string;
  /** Toolkits the team starts with, each for every role or the roles listed (toolkits.ts). */
  toolkits?: ToolkitChoice[];
  /** The team's own skills, written to .yacc/skills/<name>/SKILL.md when the team is created. */
  skills?: TemplateSkill[];
}

/** A project skill a template brings. */
export interface TemplateSkill {
  name: string;
  description: string;
  body: string;
  /** Left out: every role. */
  roles?: string[];
  /** A saved template's folder for the skill (copied whole, with any files beside SKILL.md). */
  dir?: string;
}

const card = (title: string, summary: string, can: Permission[], instructions: string): RoleCard => ({ id: roleSlug(title), title, summary, can, instructions });

// ---------------------------------------------------------------- role library

export const ROLE_LIBRARY: RoleCard[] = [
  card("Developer", "Builds features: one task, one branch, one pull request.", ["work"], DEVELOPER_INSTRUCTIONS),
  card("QA", "Tests what others built and reports what fails, with steps to reproduce.", ["work", "review"], `- Test the work you are given against its done-when. Try the unhappy paths too.
- For each problem, write the steps to reproduce, what you expected and what happened.
- When asked to review, approve only what you have run yourself.`),
  card("Designer", "Designs screens and visuals, and explains the choices.", ["work"], `- Produce the design the task asks for: files, plus a short note on the choices you made and why.
- Keep to the project's existing look unless the task says otherwise.
- Share every file the next person needs.`),
  card("Technical writer", "Writes docs, guides and release notes in plain words.", ["work"], `- Write for the reader named in the task. Short sentences, plain words, examples.
- Check every command and step you document actually works.`),
  card("Researcher", "Finds and checks facts, and lists every source.", ["work"], `- Find what the task asks for from reliable sources. Prefer primary sources: official sites, papers, data.
- For every fact, keep the source link. Mark anything you could not confirm.
- Write findings to a file (research/<topic>.md) and share it.`),
  card("Writer", "Writes scripts, articles and posts from the research.", ["work"], `- Write from the research you are given; don't add facts without a source.
- Match the length, audience and tone in the brief.
- Write drafts to files (drafts/<name>.md) and share them.`),
  card("Editor", "Edits for clarity, accuracy and length, and reviews others' writing.", ["work", "review"], `- Edit for clarity, accuracy, length and tone. Cut what doesn't earn its place.
- When asked to review, approve work that is ready; otherwise request changes with specific edits.
- Check every fact against its source before approving.`),
  card("Fact checker", "Checks every claim and figure against its source.", ["work", "review"], `- Check every claim, name and figure against its source. List each mismatch with the source link.
- Approve only when every claim is sourced and correct.`),
  card("Analyst", "Analyses data and explains what it shows.", ["work"], `- Work from the data you are given. Say where it came from and how you cleaned it.
- Run the analysis in code you can share, so it can be checked and rerun.
- Report the finding in one sentence first, then the numbers and the caveats.`),
  card("Experimenter", "Designs and runs experiments, and records every result.", ["work"], `- Before running, write down the question, the method and what result would answer it.
- Record every run: settings, data, results, including failures.
- Share the code, the raw results and a short write-up.`),
  card("Marketer", "Plans and writes launch, social and email copy.", ["work"], `- Write for the audience and channel in the task. One clear message and one call to action.
- Give two or three variants when the task leaves the tone open.`),
];

export const libraryCard = (ref: string): RoleCard | undefined => {
  const r = ref.trim().toLowerCase();
  return ROLE_LIBRARY.find((c) => c.id === r || c.title.toLowerCase() === r || c.id === roleSlug(r));
};

export const roleFromCard = (c: RoleCard): RoleConfig => ({ id: c.id, title: c.title, can: [...c.can], instructions: c.instructions });

const lead = (title: string, extra: string): RoleConfig => ({
  id: LEAD_ROLE_ID,
  title,
  can: ["plan", "assign", "review", "hire"],
  instructions: `${LEAD_DUTIES}\n\n${extra}`,
});
const from = (title: string): RoleConfig => roleFromCard(libraryCard(title)!);

// ---------------------------------------------------------------- built-in templates

export const BUILT_IN_TEMPLATES: Template[] = [
  {
    id: "software-team",
    name: "Software Team",
    description: "A lead plans; developers each work on their own branch and open a pull request, reviewed and merged on GitHub.",
    source: "built-in",
    theme: "modern",
    item: "Task",
    deliverable: "pull-request",
    stages: [{ id: "build", name: "Build", owner: ANY_ROLE, gate: "pull-request" }],
    roles: [
      lead("Lead", "## Coding rules\n- You never write app code.\n- Keep tasks small: one task = one branch = one PR. Give each task the files it may edit and a clear done-when."),
      from("Developer"),
      from("QA"),
      from("Designer"),
      from("Technical writer"),
    ],
    team: [
      { name: "Michael", role: LEAD_ROLE_ID },
      { name: "Dwight", role: "developer" },
    ],
    toolkits: [
      { id: "web-testing", roles: ["qa"] },
      { id: "frontend-design", roles: ["designer"] },
      { id: "documents", roles: ["technical-writer"] },
    ],
  },
  {
    id: "content-studio",
    name: "Content Studio",
    description: "Research, script and edit short videos or articles. The editor reviews every script; you approve before it is final.",
    source: "built-in",
    officeName: "The Studio",
    theme: "studio",
    item: "Piece",
    deliverable: "files",
    stages: [
      { id: "research", name: "Research", owner: "researcher", gate: "none", description: "Sources and notes for the piece are in shared/research/." },
      { id: "script", name: "Script", owner: "writer", gate: "review", reviewer: "editor", description: "A full draft that meets the brief's length and tone is in shared/scripts/." },
      { id: "final", name: "Final edit", owner: "editor", gate: "ceo", description: "The script is ready to publish: facts checked, typos fixed." },
    ],
    roles: [
      lead("Producer", "## Studio rules\n- One piece = one topic. Give each piece its audience, length and done-when.\n- Put the channel's audience, tone and length rules in the brief."),
      from("Researcher"),
      from("Writer"),
      from("Editor"),
      from("Fact checker"),
      from("Designer"),
      from("Marketer"),
    ],
    team: [
      { name: "Maya", role: LEAD_ROLE_ID },
      { name: "Leo", role: "researcher" },
      { name: "Ada", role: "writer" },
      { name: "Sam", role: "editor" },
    ],
    brief: "# Brief\n\nWho the work is for, what it should achieve, the tone, and the length. (Replace this with your own.)\n",
    toolkits: [
      { id: "documents", roles: ["writer", "editor", "marketer"] },
      { id: "writing", roles: ["writer", "editor"] },
      { id: "visual-design", roles: ["designer"] },
    ],
    skills: [
      {
        name: "source-notes",
        description: "Use when researching a piece: how to find, check and write down sources so the writer can use them.",
        roles: ["researcher", "fact-checker"],
        body: `# Source notes

Write one notes file per piece, shared/research/<piece>.md, in this shape:

1. **The question**: what the piece needs to know, in one line.
2. **Findings**: one bullet per fact, each with its source link and the date you checked it.
3. **Unsure**: anything you couldn't confirm, and why.
4. **Quotes**: exact words only, with who said them and where.

Prefer primary sources (official sites, papers, data) over articles about them. Two independent sources for any number. Never invent a source; say what's missing instead.`,
      },
      {
        name: "house-style",
        description: "Use when writing or editing any piece: the studio's voice, length and formatting rules.",
        roles: ["writer", "editor"],
        body: `# House style

- Write for the audience in the brief. Short sentences, plain words, active voice.
- Every fact comes from the researcher's notes (shared/research/); cite the source in a footnote or the script notes.
- Keep to the length in the brief, give or take 10%.
- Headings and lists only where they help the reader find things.
- Before handing on: read it aloud once, fix anything that trips you up.

Change these rules to your channel's in .yacc/skills/house-style/SKILL.md.`,
      },
    ],
  },
  {
    id: "rd-lab",
    name: "R&D Lab",
    description: "Turn a question into a survey, an experiment and an analysis. The principal reviews the analysis; you approve the report.",
    source: "built-in",
    officeName: "The Lab",
    theme: "lab",
    item: "Experiment",
    deliverable: "files",
    stages: [
      { id: "survey", name: "Survey", owner: "researcher", gate: "none", description: "What is already known, with sources, is in shared/survey/." },
      { id: "run", name: "Run", owner: "experimenter", gate: "none", description: "The experiment ran as planned and its raw results are saved." },
      { id: "analyse", name: "Analyse", owner: "analyst", gate: "review", reviewer: LEAD_ROLE_ID, description: "The results answer the question, or say why not." },
      { id: "report", name: "Report", owner: ANY_ROLE, gate: "ceo", description: "A short report with the answer and how sure we are." },
    ],
    roles: [
      lead("Principal", "## Lab rules\n- State each experiment's question and what result would answer it before it starts.\n- Record decisions about method in the project memory."),
      from("Researcher"),
      from("Experimenter"),
      from("Analyst"),
      from("Developer"),
      from("Technical writer"),
    ],
    team: [
      { name: "Grace", role: LEAD_ROLE_ID },
      { name: "Leo", role: "researcher" },
      { name: "Rosalind", role: "experimenter" },
      { name: "Alan", role: "analyst" },
    ],
    brief: "# Brief\n\nThe question the lab is working on, what is known, and what a useful answer looks like. (Replace this with your own.)\n",
    toolkits: [{ id: "documents" }],
    skills: [
      {
        name: "lab-notebook",
        description: "Use when planning, running or analysing an experiment: how to record it so anyone can repeat it.",
        roles: ["experimenter", "analyst"],
        body: `# Lab notebook

Keep one entry per experiment in shared/notebook/<experiment>.md:

- **Question** and the result that would answer it, written before you start.
- **Method**: steps, inputs, versions and settings, enough for someone else to repeat it.
- **Raw results**: where they're saved. Never edit raw data; work on copies.
- **What happened**: including what went wrong or differed from the plan.
- **Analysis**: what the results show, how sure you are, and what you'd do next.`,
      },
    ],
  },
  {
    id: "lead-only",
    name: "Start with a lead",
    description: "Just a lead. Tell it what you need; it hires from the role library, within your headcount limit.",
    source: "built-in",
    theme: "modern",
    item: "Task",
    deliverable: "files",
    stages: [{ id: "do", name: "Do", owner: ANY_ROLE, gate: "review", reviewer: LEAD_ROLE_ID }],
    roles: [{ ...lead("Lead", ""), instructions: LEAD_DUTIES }],
    team: [{ name: "Michael", role: LEAD_ROLE_ID }],
  },
];

/** What a role that came from nowhere gets: the generic rules. */
export const BLANK_ROLE_INSTRUCTIONS = WORKER_BASE_INSTRUCTIONS;
