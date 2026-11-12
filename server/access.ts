// Access requests (plan 009): an agent whose sandbox blocks a domain asks
// through the Team MCP (request_access); you answer Allow or Deny in HQ.
// Allow adds a per-sandbox rule (the base policy is never touched).

import type { AccessDecision, AccessRequest } from "../src/data/types";
import type { Hub } from "./hub";
import type { Planner } from "./planner";
import type { Sbx } from "./sbx";

const DOMAIN = /^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?$/;

/** Turns what an agent passed (a URL, a host, a host:port) into a domain, or null. */
export function cleanDomain(raw: string): string | null {
  let v = raw.trim().toLowerCase();
  try {
    if (/^[a-z]+:\/\//.test(v)) v = new URL(v).host;
  } catch {
    return null;
  }
  v = v.replace(/\/.*$/, "");
  return DOMAIN.test(v) ? v : null;
}

let seq = 0;

/** Creates (or returns the open) request and asks you. Returns what the agent is told. */
export function requestAccess(hub: Hub, agentId: string, rawDomain: string, reason: string): string {
  const agent = hub.cfg(agentId);
  if (!agent) throw new Error("Unknown agent.");
  if (agent.mode !== "sandbox") return "You run in Local mode, outside a sandbox: HQ doesn't restrict your network. If a request fails, it isn't a sandbox block.";
  const domain = cleanDomain(rawDomain);
  if (!domain) throw new Error(`"${rawDomain}" isn't a domain. Pass just the host, like docs.example.com.`);
  if (agent.sandbox.allow.includes(domain))
    return `${domain} is already allowed for your sandbox. If it still fails, the problem is something else (a typo, the site is down, or a different domain it redirects to).`;
  const open = hub.snap.accessRequests?.find((r) => r.agentId === agentId && r.domain === domain && r.status === "pending");
  if (open) return `You already asked for ${domain}; the user hasn't answered yet. Continue with other work; HQ will tell you.`;

  const req: AccessRequest = { id: `ar${Date.now().toString(36)}${++seq}`, agentId, domain, reason: reason.trim().slice(0, 300) || "No reason given", at: new Date().toISOString(), status: "pending" };
  hub.holdForAccess(agentId);
  // Keep every open request; trim only answered history.
  const all = [req, ...(hub.snap.accessRequests ?? [])];
  hub.snap.accessRequests = [...all.filter((r) => r.status === "pending"), ...all.filter((r) => r.status !== "pending").slice(0, 50)];
  hub.emit({ type: "access.updated", request: { ...req } });
  hub.setStatus(agentId, { state: "needs-input", note: `Asking: access to ${domain}` });
  hub.activity("agent.needs-input", agentId, `${agent.name} needs you: access to ${domain}`);
  return `Asked the user to allow ${domain}. Continue with other work if you can; HQ will message you as soon as they answer. Don't work around the block meanwhile.`;
}

// Answers are applied one at a time: rules for the same sandbox are synced in order, and an
// "everyone" answer can't settle a request that another answer is still working on.
let queue: Promise<void> = Promise.resolve();

/** Your answer: allow for that agent, for every sandboxed agent, or deny. */
export function resolveAccess(hub: Hub, sbx: Sbx, planner: Planner, requestId: string, decision: AccessDecision): Promise<void> {
  const next = queue.then(() => answer(hub, sbx, planner, requestId, decision));
  queue = next.catch(() => {});
  return next;
}

async function answer(hub: Hub, sbx: Sbx, planner: Planner, requestId: string, decision: AccessDecision) {
  const req = hub.snap.accessRequests?.find((r) => r.id === requestId);
  if (!req || req.status !== "pending") return;
  const who = hub.name(req.agentId);
  const settle = (r: AccessRequest, status: AccessRequest["status"]) => {
    r.status = status;
    hub.emit({ type: "access.updated", request: { ...r } });
    hub.accessAnswered(r.agentId);
  };

  if (decision === "deny") {
    settle(req, "denied");
    hub.activity("config", req.agentId, `You denied ${who} access to ${req.domain}`);
    planner.notify(req.agentId, `The user denied access to ${req.domain}. Continue without it. If you can't, say why in your reply${hub.cfg(req.agentId)?.isLead ? "" : " and call set_my_status blocked with the reason"}.`);
    return;
  }

  const ids = decision === "everyone" ? hub.snap.config.team.filter((a) => a.mode === "sandbox").map((a) => a.id) : [req.agentId];
  const added: string[] = [];
  for (const id of ids) {
    const a = hub.cfg(id);
    if (a && !a.sandbox.allow.includes(req.domain)) {
      a.sandbox.allow = [...a.sandbox.allow, req.domain];
      added.push(id);
    }
  }
  hub.configChanged();

  // Applies the per-sandbox rules (only sandboxes that exist; others get them when they start).
  // sbx may refuse the rule for any of them: then undo it everywhere and keep the request open.
  // allSettled: every sync finishes before any rollback, so a late one can't re-add the rule after it.
  let failure: string | null = null;
  const results = await Promise.allSettled(ids.map((id) => sbx.syncRules(id)));
  const thrown = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  const bad = ids.find((id) => sbx.state.agents[id]?.syncError?.includes(req.domain));
  if (thrown) failure = thrown.reason instanceof Error ? thrown.reason.message : String(thrown.reason);
  else if (bad) failure = `${hub.name(bad)}: ${sbx.state.agents[bad]?.syncError}`;
  if (failure) {
    for (const id of added) {
      const a = hub.cfg(id);
      if (a) a.sandbox.allow = a.sandbox.allow.filter((d) => d !== req.domain);
    }
    hub.configChanged();
    // Remove any rule that did go through, and clear the stale error.
    await Promise.all(added.map((id) => sbx.syncRules(id).catch(() => {})));
    hub.activity("config", req.agentId, `Couldn't allow ${req.domain} (${failure.slice(0, 160)}). The request is still open: try again or deny it.`);
    return;
  }

  settle(req, "allowed");
  hub.activity("config", req.agentId, `You allowed ${req.domain} for ${decision === "everyone" ? "every agent" : who}`);
  planner.notify(req.agentId, `The user allowed ${req.domain} for your sandbox. Try the request again.`);
  // Other agents waiting on the same domain are covered too.
  if (decision === "everyone")
    for (const other of hub.snap.accessRequests ?? [])
      if (other.status === "pending" && other.domain === req.domain && other.id !== req.id) {
        settle(other, "allowed");
        planner.notify(other.agentId, `The user allowed ${req.domain} for your sandbox. Try the request again.`);
      }
}
