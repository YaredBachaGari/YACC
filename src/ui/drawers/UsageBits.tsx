import { describePick } from "../../data/models";
import type { AgentConfig, AgentStatus, UsageLine } from "../../data/types";
import { officeActions, useOffice } from "../../store/office";
import { ui } from "../../store/ui";
import { SectionTitle, tokensText, usdText } from "../kit";

/** Under the session bar: the model the agent runs on now (if not its own), a usage limit, or a budget hold. */
export function ModelBanner({ agent, status }: { agent: AgentConfig; status: AgentStatus }) {
  const { using, limited, held } = status;
  if (!using && !limited && !held) return null;
  return (
    <div className="flex flex-col gap-1 border-b-[3px] border-ink bg-[#fff1d6] px-3 py-1.5 text-[14px]">
      {held && (
        <div>
          <b>Paused.</b> {held}. HQ holds its messages until you decide in{" "}
          <button className="underline" onClick={() => ui.openActions()}>
            Action items
          </button>{" "}
          or raise the budget.
        </div>
      )}
      {limited && (
        <div>
          <b>At a limit.</b> {limited.note}.
        </div>
      )}
      {using && (
        <div className="flex items-center gap-2">
          <span className="flex-1">
            <b>On {describePick(using)}</b> ({using.why === "fallback" ? "fallback" : "routing"}): {using.reason}. Its own model is {describePick(agent)}.
          </span>
          <button className="btn shrink-0 px-2 text-[12px]" onClick={() => officeActions.useOwnModel(agent.id)} title="Restarts the agent on its own model when it's idle; its folder and task are kept.">
            Use own model
          </button>
        </div>
      )}
    </div>
  );
}

function Row({ label, line }: { label: string; line?: UsageLine }) {
  return (
    <tr className="border-t border-ink/20">
      <td className="py-1 pr-3">{label}</td>
      <td className="py-1 pr-3 text-right font-term text-[16px]">{line ? tokensText(line.input + line.cacheRead) : "–"}</td>
      <td className="py-1 pr-3 text-right font-term text-[16px]">{line ? tokensText(line.output) : "–"}</td>
      <td className="py-1 text-right font-term text-[16px]">{line ? `${line.estimated ? "≈" : ""}${usdText(line.costUsd)}` : "–"}</td>
    </tr>
  );
}

/** Tokens and cost this day, week and month, as the agent's program reports them. */
export function UsageSection({ agent }: { agent: AgentConfig }) {
  const u = useOffice((s) => s.snap?.usage?.agents[agent.id]);
  return (
    <div className="mb-4">
      <SectionTitle>Usage</SectionTitle>
      {!u ? (
        <p className="text-[14px] text-muted">Nothing reported yet. Claude Code, Codex and Gemini CLI report their tokens to YACC while they work.</p>
      ) : (
        <>
          <table className="w-full text-[14px]">
            <thead>
              <tr className="text-left text-[12px] text-muted">
                <th className="pb-1 font-normal" />
                <th className="pb-1 text-right font-normal">Input</th>
                <th className="pb-1 text-right font-normal">Output</th>
                <th className="pb-1 text-right font-normal">Cost</th>
              </tr>
            </thead>
            <tbody>
              <Row label="Today" line={u.day} />
              <Row label="This week" line={u.week} />
              <Row label="This month" line={u.month} />
            </tbody>
          </table>
          <p className="mt-1 text-[12px] text-muted">
            {u.models.length ? `Models: ${u.models.join(", ")}. ` : ""}
            {u.month.estimated ? "≈ is YACC's estimate from API prices; on a subscription it's what the work would cost on the API." : "Cost as Claude Code reports it."}
            {agent.budget ? ` Budget: ${usdText(agent.budget.usd)} a ${agent.budget.period}.` : ""}
          </p>
        </>
      )}
    </div>
  );
}
