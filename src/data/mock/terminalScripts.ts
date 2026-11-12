// Fake Claude Code output. Each function returns lines; `typed` lines are streamed
// character by character, the rest appear at once (like tool output).

export interface TermLine {
  text: string;
  typed?: boolean;
}

const esc = (code: string) => `\x1b[${code}m`;
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return esc(`38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`);
};
const reset = esc("0");
const bold = esc("1");

const c = {
  tool: rgb("#00e436"),
  out: rgb("#8d99c4"),
  ok: rgb("#6cf08a"),
  err: rgb("#ff5c86"),
  warn: rgb("#ffc14d"),
  think: rgb("#c9b6ff"),
  say: rgb("#dfe6ff"),
  dim: rgb("#66729f"),
  pink: rgb("#ff77a8"),
  yellow: rgb("#ffec27"),
};

const tool = (name: string, arg: string): TermLine => ({ text: `${c.tool}●${reset} ${bold}${name}${reset}(${arg})` });
const out = (text: string, color = c.out): TermLine => ({ text: `  ${c.dim}└${reset} ${color}${text}${reset}` });
const think = (text: string): TermLine => ({ text: `${c.think}✻ ${text}${reset}`, typed: true });
const say = (text: string): TermLine => ({ text: `${c.say}${text}${reset}`, typed: true });
const blank: TermLine = { text: "" };

export const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const pick = <T,>(arr: readonly T[], seed: number): T => arr[Math.abs(seed) % arr.length];

export function banner(name: string, role: string, repo: string, mode: string): TermLine[] {
  return [
    { text: `${c.pink}╭──────────────────────────────────────────╮${reset}` },
    { text: `${c.pink}│${reset} ${bold}✻ Claude Code${reset}  ${c.dim}${name} · ${role}${reset}` },
    { text: `${c.pink}│${reset} ${c.dim}${repo} · ${mode === "sandbox" ? "docker sandbox (microVM)" : "local worktree"}${reset}` },
    { text: `${c.pink}╰──────────────────────────────────────────╯${reset}` },
    blank,
  ];
}

export function startTask(taskId: string, title: string, seed: number): TermLine[] {
  const s = slug(title);
  return [
    { text: `${c.yellow}> Pull main, start ${taskId}${reset}` },
    blank,
    tool("Bash", "git pull origin main"),
    out("Already up to date."),
    tool("Bash", `git checkout -b ${taskId.toLowerCase()}-${s}`),
    out(`Switched to a new branch '${taskId.toLowerCase()}-${s}'`),
    tool("Read", `docs/tasks/${taskId}.md`),
    out(`Read ${30 + (seed % 40)} lines`),
    think(`${title}: read the allowed files first, then write the tests.`),
  ];
}

const files = ["route.ts", "schema.ts", "handler.ts", "index.tsx", "service.ts", "utils.ts"];

export function workChunk(title: string, seed: number): TermLine[] {
  const s = slug(title);
  const file = `src/${s}/${pick(files, seed)}`;
  const adds = 6 + (seed % 30);
  const variants: TermLine[][] = [
    [tool("Read", file), out(`Read ${40 + (seed % 90)} lines`), think("The contract already exports the type I need.")],
    [tool("Update", file), out(`Updated with ${adds} additions and ${seed % 7} removals`, c.ok)],
    [tool("Write", `src/${s}/${s}.test.ts`), out(`Wrote ${20 + (seed % 40)} lines`, c.ok), think("Covering the error path too.")],
    [tool("Bash", `pnpm test ${s}`), out(`✓ ${4 + (seed % 12)} passed (${(0.6 + (seed % 9) / 10).toFixed(1)}s)`, c.ok)],
    [tool("Bash", "pnpm typecheck"), out("No errors", c.ok)],
    [tool("Grep", `"${s.split("-")[0]}" in src/`), out(`${2 + (seed % 6)} matches`)],
  ];
  return pick(variants, seed);
}

export function question(text: string): TermLine[] {
  return [blank, { text: `${c.err}? ${bold}Needs your input:${reset} ${c.say}${text}${reset}` }, { text: `${c.dim}  (type your answer and press Enter)${reset}` }];
}

export function answered(by: string): TermLine[] {
  return [{ text: `${c.ok}✓ Answer received${by ? ` from ${by}` : ""}. Continuing.${reset}` }];
}

export function openPr(num: number, taskId: string, title: string, repo: string, reviewer: string | null): TermLine[] {
  return [
    tool("Bash", "git push -u origin HEAD"),
    out("Branch pushed."),
    tool("Bash", `gh pr create --title "[${taskId}] ${title}"`),
    out(`https://github.com/${repo}/pull/${num}`, c.ok),
    say(reviewer ? `Opened PR #${num}. Waiting for ${reviewer}.` : `Opened PR #${num}.`),
  ];
}

export function changesRequested(num: number, comments: string[], reviewer: string): TermLine[] {
  return [
    blank,
    { text: `${c.warn}! ${reviewer} requested changes on #${num} (${comments.length} comments)${reset}` },
    ...comments.map((t) => out(t, c.warn)),
    think("Fixing the review comments on my own PR."),
  ];
}

export function pushedFix(num: number): TermLine[] {
  return [tool("Bash", "git commit -am 'Address review comments'"), out("1 commit"), tool("Bash", "git push"), out(`Updated #${num}`, c.ok)];
}

export function passed(num: number, reviewer: string, mergeBy: string): TermLine[] {
  return [{ text: `${c.ok}✓ ${reviewer} approved #${num}. Waiting for ${mergeBy} to merge.${reset}` }];
}

export function merged(num: number): TermLine[] {
  return [{ text: `${c.ok}✓ #${num} merged into main.${reset}` }, blank, say("Done. Free for the next task.")];
}

export function message(fromName: string, toName: string, text: string, incoming: boolean): TermLine[] {
  return incoming
    ? [{ text: `${c.pink}✉ ${fromName}:${reset} ${c.say}${text}${reset}` }]
    : [tool("hq.send_message", `to: "${toName}"`), out(`"${text}"`)];
}

export function leadPlanning(boardTitle: string, seed: number): TermLine[] {
  const variants: TermLine[][] = [
    [tool("hq.get_status", ""), out("All workers reporting."), think(`Checking what is left on ${boardTitle}.`)],
    [tool("Read", "docs/plan.md"), out(`Read ${80 + (seed % 60)} lines`), think("Ordering tasks so nobody waits on a contract change.")],
    [tool("hq.list_workers", ""), out("Workers listed.")],
  ];
  return pick(variants, seed);
}

export function leadAssign(taskId: string, title: string, workerName: string): TermLine[] {
  return [
    tool("hq.assign_task", `"${taskId}", to: "${workerName}"`),
    out(`Sent to ${workerName}: Pull main, start ${taskId} (${title})`, c.ok),
  ];
}

export function leadCreated(taskId: string, title: string): TermLine[] {
  return [tool("Write", `docs/tasks/${taskId}.md`), out(`Created task: ${title}`, c.ok)];
}

export function echoInput(text: string): TermLine[] {
  return [{ text: `${c.yellow}> ${text}${reset}` }];
}

const replies = [
  "Got it. I'll take that into account.",
  "Understood. Adjusting the plan.",
  "On it.",
  "Good call. Updating the task file.",
];

export function cannedReply(isLead: boolean, seed: number): TermLine[] {
  if (isLead) return [say(seed % 2 ? "Got it. I'll reassign the next free task." : "Noted. I'll keep that in the plan.")];
  return [say(pick(replies, seed))];
}
