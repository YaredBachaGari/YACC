// Who may message whom (plan step 6.4), in Settings → Org chart: channels, and optional rules.

import { useState } from "react";
import {
  DEFAULT_MESSAGING,
  channelsOf,
  messagingOf,
  type DirectRule,
  type MessagingConfig,
  type TeamChannelRule,
} from "../../data/messaging";
import { LEAD_ROLE_ID, type HqConfig } from "../../data/types";
import { officeActions } from "../../store/office";
import { ui } from "../../store/ui";
import { Field, SectionTitle } from "../kit";

export function MessagingSection({ cfg }: { cfg: HqConfig }) {
  const m = messagingOf(cfg);
  const save = (patch: Partial<MessagingConfig>) =>
    officeActions.updateMessaging({ ...DEFAULT_MESSAGING, ...m, ...patch });
  // The lead talks to everyone anyway, so pairs are between the other roles.
  const roles = cfg.roles.filter((r) => r.id !== LEAD_ROLE_ID);
  const [fromPick, setFrom] = useState("");
  const [toPick, setTo] = useState("");
  const from = roles.some((r) => r.id === fromPick)
    ? fromPick
    : (roles[0]?.id ?? "");
  const to = roles.some((r) => r.id === toPick)
    ? toPick
    : (roles.find((r) => r.id !== from)?.id ?? "");
  const title = (id: string) => cfg.roles.find((r) => r.id === id)?.title ?? id;
  const allow = m.allow ?? [];
  return (
    <section
      className="border-[3px] border-ink bg-white p-3"
      aria-label="Messages"
    >
      <SectionTitle>Messages</SectionTitle>
      <p className="mb-3 text-[13px] text-muted">
        Every team has channels: <code>#team</code> reaches everyone, and each
        role has one (
        {channelsOf(cfg)
          .filter((c) => c.roleId)
          .slice(0, 3)
          .map((c) => c.id)
          .join(", ") || "#developer"}
        …) for everyone with that role.{" "}
        <button className="underline" onClick={() => ui.openChannels()}>
          Open channels
        </button>
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Direct messages"
          hint={
            m.direct === "anyone"
              ? "Any agent can message any other."
              : "Your manager, your reports, people who share your manager, and the lead. The lead reaches everyone."
          }
        >
          <select
            className="field"
            value={m.direct}
            onChange={(e) => save({ direct: e.target.value as DirectRule })}
          >
            <option value="anyone">Anyone can message anyone</option>
            <option value="lines">Along reporting lines</option>
          </select>
        </Field>
        <Field
          label="Who posts to #team"
          hint="Role channels: their members and the lead can always post."
        >
          <select
            className="field"
            value={m.team}
            onChange={(e) => save({ team: e.target.value as TeamChannelRule })}
          >
            <option value="everyone">Everyone</option>
            <option value="lead">Only the lead</option>
          </select>
        </Field>
      </div>
      {m.direct === "lines" && (
        <div className="mt-3">
          <span className="text-[14px] font-semibold">Also allowed</span>
          <p className="m-0 mb-1.5 text-[12px] text-muted">
            Role pairs that may message each other's agents directly, on top of
            the reporting lines (one way).
          </p>
          <ul className="m-0 mb-2 flex list-none flex-wrap gap-1.5 p-0">
            {allow.map((p) => (
              <li key={`${p.from}>${p.to}`} className="chip">
                {title(p.from)} → {title(p.to)}
                <button
                  className="ml-1 text-red"
                  aria-label={`Remove ${title(p.from)} to ${title(p.to)}`}
                  onClick={() => save({ allow: allow.filter((x) => x !== p) })}
                >
                  ✕
                </button>
              </li>
            ))}
            {!allow.length && <li className="text-[12px] text-muted">None.</li>}
          </ul>
          {roles.length < 2 ? (
            <p className="m-0 text-[12px] text-muted">
              Pairs need two roles besides the lead.
            </p>
          ) : (
            <div className="flex items-center gap-1.5">
              <select
                className="field w-auto"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                aria-label="From role"
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
              <span>may message</span>
              <select
                className="field w-auto"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                aria-label="To role"
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
              <button
                className="btn px-2 text-[13px]"
                disabled={
                  !from ||
                  !to ||
                  from === to ||
                  allow.some((p) => p.from === from && p.to === to)
                }
                onClick={() => save({ allow: [...allow, { from, to }] })}
              >
                Allow
              </button>
            </div>
          )}
        </div>
      )}
      <p className="mt-2 text-[12px] text-muted">
        You and HQ can message anyone, and any agent can always ask you
        (ask_user). Agents learn the rules when they next start; refused
        messages tell them who to ask instead.
      </p>
    </section>
  );
}
