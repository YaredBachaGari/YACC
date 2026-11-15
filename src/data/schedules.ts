// Schedules and triggers (plan step 6.5): work that starts on its own, on a clock (a weekly
// report, a daily content run) or when something happens (a piece is done, a board is finished,
// a pull request is merged). Each one either sends a message or adds a task. Times are local to
// the machine HQ runs on. Shared by the server (which runs them) and the browser (which edits them).

import { roleSlug } from "./roles";
import type { HqConfig } from "./types";

export type RepeatEvery = "hour" | "day" | "weekday" | "week" | "month";
export type ScheduleEvent = "task-done" | "board-done" | "pr-merged";
export type ScheduleAction = "message" | "task";

export const REPEATS: { id: RepeatEvery; label: string }[] = [
  { id: "hour", label: "Every hour" },
  { id: "day", label: "Every day" },
  { id: "weekday", label: "Every weekday" },
  { id: "week", label: "Every week" },
  { id: "month", label: "Every month" },
];
export const EVENTS: { id: ScheduleEvent; label: string; vars: string[] }[] = [
  { id: "task-done", label: "When a task is done", vars: ["task", "title", "board"] },
  { id: "board-done", label: "When a board is done", vars: ["board"] },
  { id: "pr-merged", label: "When a pull request is merged", vars: ["pr", "task", "title"] },
];
export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface Schedule {
  id: string;
  name: string;
  enabled: boolean;
  /** On a clock: how often, at what local time (HH:MM; for hourly only the minutes count), on which day. */
  every?: RepeatEvery;
  at?: string;
  /** Week: 0 (Sunday) to 6. Month: 1 to 28. */
  day?: number;
  /** Or when something happens. */
  on?: ScheduleEvent;
  /** message: `to` is an agent id, "lead" or a channel (#team, #writer). task: `to` is an agent id, "role:<id>", or left out (the lead assigns it). */
  action: ScheduleAction;
  to?: string;
  /** task: its title. */
  title?: string;
  /** message: the text. task: the description. {date}, {task}, {title}, {board} and {pr} are filled in. */
  text: string;
}

/** What the browser shows next to each schedule. */
export interface ScheduleStatus {
  id: string;
  lastRun: string | null;
  /** What the last run did, or why it didn't. */
  lastResult: string | null;
  /** Clock schedules that are on: the next run. */
  nextRun: string | null;
}

export const MAX_SCHEDULES = 30;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** From YAML or the browser: complete schedules with unique ids. Ones that can't run are dropped. */
export function cleanSchedules(raw: unknown): Schedule[] {
  if (!Array.isArray(raw)) return [];
  const out: Schedule[] = [];
  for (const item of raw.slice(0, MAX_SCHEDULES)) {
    const v = (item ?? {}) as Partial<Schedule>;
    const name = typeof v.name === "string" ? v.name.trim().slice(0, 60) : "";
    if (!name) continue;
    let id = roleSlug(typeof v.id === "string" && v.id.trim() ? v.id : name);
    for (let n = 2; out.some((s) => s.id === id); n++) id = `${roleSlug(name)}-${n}`;
    const action: ScheduleAction = v.action === "task" ? "task" : "message";
    const text = typeof v.text === "string" ? v.text.trim().slice(0, 2000) : "";
    const title = typeof v.title === "string" ? v.title.trim().slice(0, 120) : "";
    if (action === "message" && !text) continue;
    if (action === "task" && !title) continue;
    const s: Schedule = { id, name, enabled: v.enabled !== false, action, text };
    if (action === "task") s.title = title;
    if (typeof v.to === "string" && v.to.trim()) s.to = v.to.trim().slice(0, 80);
    if (action === "message" && !s.to) s.to = "lead";
    if (EVENTS.some((e) => e.id === v.on)) s.on = v.on;
    else if (REPEATS.some((r) => r.id === v.every)) {
      s.every = v.every;
      s.at = typeof v.at === "string" && HHMM.test(v.at) ? v.at : "09:00";
      if (s.every === "week") s.day = Number.isInteger(v.day) && v.day! >= 0 && v.day! <= 6 ? v.day : 1;
      if (s.every === "month") s.day = Number.isInteger(v.day) && v.day! >= 1 && v.day! <= 28 ? v.day : 1;
    } else continue;
    out.push(s);
  }
  return out;
}

const hm = (s: Schedule) => {
  const m = HHMM.exec(s.at ?? "09:00");
  return { h: Number(m?.[1] ?? 9), m: Number(m?.[2] ?? 0) };
};

/** Does a clock schedule run at this calendar slot (a day, or for hourly any hour)? */
function onDay(s: Schedule, d: Date): boolean {
  switch (s.every) {
    case "weekday":
      return d.getDay() >= 1 && d.getDay() <= 5;
    case "week":
      return d.getDay() === s.day;
    case "month":
      return d.getDate() === s.day;
    default:
      return true;
  }
}

/** The most recent time a clock schedule was due at or before `now`, or null (none in the last ~2 months). */
export function previousRun(s: Schedule, now: Date): Date | null {
  if (!s.every) return null;
  const { h, m } = hm(s);
  if (s.every === "hour") {
    const t = new Date(now);
    t.setMinutes(m, 0, 0);
    if (t > now) t.setHours(t.getHours() - 1);
    return t;
  }
  for (let back = 0; back < 62; back++) {
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, h, m, 0, 0);
    if (t <= now && onDay(s, t)) return t;
  }
  return null;
}

/** The next time a clock schedule is due after `now`, or null. */
export function nextRun(s: Schedule, now: Date): Date | null {
  if (!s.every) return null;
  const { h, m } = hm(s);
  if (s.every === "hour") {
    const t = new Date(now);
    t.setMinutes(m, 0, 0);
    if (t <= now) t.setHours(t.getHours() + 1);
    return t;
  }
  for (let ahead = 0; ahead < 62; ahead++) {
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead, h, m, 0, 0);
    if (t > now && onDay(s, t)) return t;
  }
  return null;
}

/**
 * Should a clock schedule run now? It's due when a scheduled time has passed since it last ran
 * (or since HQ first saw it, so a new schedule never fires for a time already past). A time missed
 * while HQ was off runs once, when HQ is back.
 */
export function isDue(s: Schedule, since: Date, now: Date): boolean {
  if (!s.enabled || !s.every) return false;
  const prev = previousRun(s, now);
  return !!prev && prev > since;
}

/** {name} placeholders filled in; unknown ones are left as they are. */
export function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (all, key: string) => (key in vars ? vars[key] : all));
}

/** "Every weekday at 09:00", "When a task is done". */
export function describeWhen(s: Pick<Schedule, "every" | "at" | "day" | "on">): string {
  if (s.on) return EVENTS.find((e) => e.id === s.on)?.label ?? s.on;
  const at = s.at ?? "09:00";
  switch (s.every) {
    case "hour":
      return `Every hour at :${at.slice(3)}`;
    case "day":
      return `Every day at ${at}`;
    case "weekday":
      return `Every weekday at ${at}`;
    case "week":
      return `Every ${DAYS[s.day ?? 1]} at ${at}`;
    case "month":
      return `On day ${s.day ?? 1} of every month at ${at}`;
    default:
      return "Never";
  }
}

/** "a message to the lead", "a task for someone with the Writer role". */
export function describeWhat(s: Schedule, cfg: Pick<HqConfig, "team" | "roles">): string {
  const who = (to: string | undefined) => {
    if (!to || to === "lead") return "the lead";
    if (to.startsWith("#")) return to;
    if (to.startsWith("role:")) return `someone with the ${cfg.roles.find((r) => r.id === to.slice(5))?.title ?? to.slice(5)} role`;
    return cfg.team.find((a) => a.id === to)?.name ?? to;
  };
  return s.action === "task" ? `the task "${s.title}"${s.to ? ` for ${who(s.to)}` : ", assigned by the lead"}` : `a message to ${who(s.to)}`;
}

/** Schedules for the lead's role file, so it knows what arrives on its own. */
export function schedulesRoleMd(cfg: Pick<HqConfig, "schedules" | "team" | "roles">): string {
  const on = (cfg.schedules ?? []).filter((s) => s.enabled);
  if (!on.length) return "";
  return [
    "## Schedules",
    "HQ starts this work on its own (messages from them start with [Schedule: …]):",
    ...on.map((s) => `- ${s.name}: ${describeWhen(s).toLowerCase()}, ${describeWhat(s, cfg)}.`),
  ].join("\n");
}
