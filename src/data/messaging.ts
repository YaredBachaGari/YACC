// Group messaging (plan step 6.4): channels and who may message whom.
//
// Every team has an all-team channel, #team, and one channel per role with agents in it
// (#writer, #developer…). A post to a channel goes to every agent in it. Direct messages are
// open by default; a team can limit them to reporting lines (your manager, the people who report
// to you, and the people who share your manager), plus the lead, plus role pairs it allows.
// The CEO and HQ itself are never limited, and anyone can always ask the CEO (ask_user).

import { CEO_ID, LEAD_ROLE_ID, type AgentConfig, type HqConfig } from "./types";

export type DirectRule = "anyone" | "lines";
export type TeamChannelRule = "everyone" | "lead";

export interface MessagingConfig {
  /** Who may message whom directly. */
  direct: DirectRule;
  /** With direct "lines": more pairs, by role. Agents with role `from` may message agents with role `to`. */
  allow?: { from: string; to: string }[];
  /** Who may post to #team. */
  team: TeamChannelRule;
}

export const DEFAULT_MESSAGING: MessagingConfig = { direct: "anyone", team: "everyone" };
export const TEAM_CHANNEL = "#team";

export const isChannel = (id: string | null | undefined): id is string => !!id && id.startsWith("#");
export const roleChannel = (roleId: string) => `#${roleId}`;

/** Senders who are never limited: you (the CEO), HQ itself and schedules. */
const UNLIMITED = new Set(["you", CEO_ID, "hq"]);

export function messagingOf(cfg: Pick<HqConfig, "messaging">): MessagingConfig {
  return cfg.messaging ?? DEFAULT_MESSAGING;
}

/** From YAML or the browser: known values, pairs of roles that exist. Undefined when it's all default. */
export function cleanMessaging(raw: unknown, roleIds: string[]): MessagingConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const v = raw as Partial<MessagingConfig>;
  const direct: DirectRule = v.direct === "lines" ? "lines" : "anyone";
  const team: TeamChannelRule = v.team === "lead" ? "lead" : "everyone";
  const allow: { from: string; to: string }[] = [];
  for (const p of Array.isArray(v.allow) ? v.allow.slice(0, 50) : []) {
    const from = typeof p?.from === "string" ? p.from : "";
    const to = typeof p?.to === "string" ? p.to : "";
    if (roleIds.includes(from) && roleIds.includes(to) && !allow.some((x) => x.from === from && x.to === to)) allow.push({ from, to });
  }
  const out: MessagingConfig = { direct, team, ...(allow.length ? { allow } : {}) };
  return direct === "anyone" && team === "everyone" && !allow.length ? undefined : out;
}

/** The channels on this team: #team, then one per role that has agents, in role order. */
export function channelsOf(cfg: Pick<HqConfig, "roles" | "team">): { id: string; name: string; roleId: string | null }[] {
  return [
    { id: TEAM_CHANNEL, name: "Everyone", roleId: null },
    ...cfg.roles.filter((r) => cfg.team.some((a) => a.roleId === r.id)).map((r) => ({ id: roleChannel(r.id), name: r.title, roleId: r.id })),
  ];
}

/** Agent ids in a channel (empty for one that doesn't exist). */
export function channelMembers(cfg: Pick<HqConfig, "roles" | "team">, channel: string): string[] {
  if (channel === TEAM_CHANNEL) return cfg.team.map((a) => a.id);
  const roleId = channel.slice(1);
  return cfg.roles.some((r) => r.id === roleId) ? cfg.team.filter((a) => a.roleId === roleId).map((a) => a.id) : [];
}

/** The channels an agent is in. */
export const channelsFor = (cfg: Pick<HqConfig, "roles" | "team">, agentId: string) => channelsOf(cfg).filter((c) => channelMembers(cfg, c.id).includes(agentId));

/** Why `fromId` may not message `toId` directly, or null if it may. */
export function directBlock(cfg: Pick<HqConfig, "team" | "messaging" | "ceo">, fromId: string, toId: string): string | null {
  if (UNLIMITED.has(fromId) || toId === CEO_ID) return null;
  const m = messagingOf(cfg);
  if (m.direct === "anyone") return null;
  const from = cfg.team.find((a) => a.id === fromId);
  const to = cfg.team.find((a) => a.id === toId);
  if (!from || !to) return null;
  // The lead talks to everyone, and everyone can reach the lead.
  if (from.roleId === LEAD_ROLE_ID || to.roleId === LEAD_ROLE_ID) return null;
  if (from.reportsTo === to.id || to.reportsTo === from.id || from.reportsTo === to.reportsTo) return null;
  if ((m.allow ?? []).some((p) => p.from === from.roleId && p.to === to.roleId)) return null;
  const manager = from.reportsTo === CEO_ID ? cfg.ceo.name : (cfg.team.find((a) => a.id === from.reportsTo)?.name ?? "your manager");
  return `Your team's rules don't let you message ${to.name} directly: message along reporting lines (${manager}, your reports, or people who share your manager) or the lead, who can pass it on.`;
}

/** Why `fromId` may not post to `channel`, or null if it may. */
export function postBlock(cfg: Pick<HqConfig, "team" | "roles" | "messaging" | "ceo">, fromId: string, channel: string): string | null {
  if (!channelsOf(cfg).some((c) => c.id === channel)) return `There's no channel ${channel}. Channels: ${channelsOf(cfg).map((c) => c.id).join(", ")}.`;
  if (UNLIMITED.has(fromId)) return null;
  const from = cfg.team.find((a) => a.id === fromId);
  if (!from) return null;
  const m = messagingOf(cfg);
  if (channel === TEAM_CHANNEL) return m.team === "lead" && from.roleId !== LEAD_ROLE_ID ? "Only the lead posts to #team on this team. Message the lead to share something with everyone." : null;
  // A role channel: its members and the lead always; others when they may message its members directly.
  const members = channelMembers(cfg, channel);
  if (members.includes(fromId) || from.roleId === LEAD_ROLE_ID) return null;
  if (m.direct === "anyone") return null;
  return members.some((id) => !directBlock(cfg, fromId, id)) ? null : `Your team's rules don't let you post to ${channel}. Message the lead, who can pass it on.`;
}

/** The "Messages" section of an agent's role file. */
export function messagingRoleMd(agent: Pick<AgentConfig, "id" | "roleId">, cfg: Pick<HqConfig, "team" | "roles" | "messaging" | "ceo">): string {
  const m = messagingOf(cfg);
  const mine = channelsFor(cfg, agent.id).map((c) => c.id);
  const lines = [
    "## Messages",
    `Channels: send_message to ${TEAM_CHANNEL} reaches the whole team; to #<role> (e.g. ${mine.find((c) => c !== TEAM_CHANNEL) ?? "#developer"}) everyone with that role. You're in ${mine.join(", ")}. Use a channel only when everyone in it needs the message.`,
  ];
  if (m.team === "lead") lines.push(`Only the lead posts to ${TEAM_CHANNEL}.`);
  if (m.direct === "lines" && agent.roleId !== LEAD_ROLE_ID)
    lines.push("Direct messages follow reporting lines: you can message your manager, the people who report to you, the people who share your manager, and the lead. Ask the lead to pass on anything else. You can always ask the CEO with ask_user.");
  return lines.join("\n");
}
