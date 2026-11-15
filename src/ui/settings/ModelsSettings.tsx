import { useState } from "react";
import { PERPLEXITY_MCP, PROVIDERS, RUNTIMES, authFor, providerOf } from "../../data/models";
import { AUTH_LABEL, BUDGET_PERIODS, LEAD_ROLE_ID, type AgentCli, type AuthMode, type Budget, type BudgetPeriod, type ModelPick, type ProviderId, type RoutingRule, type SetupCheckId, type UsageLine } from "../../data/types";
import { officeActions, useOffice } from "../../store/office";
import { TerminalView } from "../drawers/TerminalView";
import { Field, SectionTitle, tokensText, usdText } from "../kit";
import { CommitInput } from "./controls";
import { CheckRow } from "../setup/SetupChecklist";

/** The datalist id with a runtime's suggested models (rendered once by ModelDatalists). */
export const modelListId = (cli: AgentCli) => `models-${cli}`;

/** Suggested model names for every runtime; inputs pick theirs with list={modelListId(cli)}. */
export function ModelDatalists() {
  return (
    <>
      {Object.values(RUNTIMES).map((r) => (
        <datalist key={r.id} id={modelListId(r.id)}>
          {r.models.filter((m) => m.id).map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </datalist>
      ))}
    </>
  );
}

/** What an empty model field means for this runtime. */
export const modelPlaceholder = (cli: AgentCli) => {
  const r = RUNTIMES[cli];
  return r.defaultModel ? `${r.defaultModel} (default)` : `${r.models[0]?.label ?? "Default"} (${r.label}'s default)`;
};

/** Setup checks that belong to each provider, in the order they matter. */
const PROVIDER_CHECKS: Record<ProviderId, SetupCheckId[]> = {
  anthropic: ["anthropic-secret", "claude", "anthropic-env"],
  openai: ["openai-secret", "codex", "openai-env"],
  google: ["google-secret", "gemini", "google-env", "gemini-login"],
  deepseek: ["deepseek-provider", "deepseek-secret", "claude", "deepseek-env"],
  perplexity: ["perplexity-env"],
};

const MODEL_PROVIDERS: ProviderId[] = ["anthropic", "openai", "google", "deepseek"];

/** Settings → Models: how each provider is signed in to, what that still needs, and Perplexity for research. */
export function ModelsSettings() {
  const cfg = useOffice((s) => s.snap?.config);
  const checks = useOffice((s) => s.snap?.setup.checks) ?? [];
  const mcp = useOffice((s) => s.snap?.mcp);
  const [running, setRunning] = useState<string | null>(null);
  const [key, setKey] = useState("");
  if (!cfg) return null;

  const run = (id: SetupCheckId) => {
    setRunning(id);
    officeActions.runSetupFix(id);
  };
  const perplexity = mcp?.servers.find((s) => s.name === PERPLEXITY_MCP.name);
  const toolRoles = cfg.roles.filter((r) => r.tools?.includes(PERPLEXITY_MCP.name));

  return (
    <div className="flex flex-col gap-5">
      <section>
        <SectionTitle>Models</SectionTitle>
        <p className="mb-3 text-[14px] text-muted">
          Each agent runs on one model: pick it per agent in Team, or a default per role in Roles. Here you choose how YACC signs in to each provider. Keys are never saved in <code>config.yml</code>: sandboxes get them from Docker's secret store, whose proxy adds them to requests so they never enter a sandbox. In Local mode, programs read them from the environment YACC starts from.
        </p>
        <div className="flex flex-col gap-3">
          {MODEL_PROVIDERS.map((p) => {
            const info = PROVIDERS[p];
            const agents = cfg.team.filter((a) => providerOf(a.cli) === p);
            const auth = authFor(cfg.providers, p);
            const rows = checks.filter((c) => PROVIDER_CHECKS[p].includes(c.id) && (c.id !== "claude" || agents.some((a) => a.mode === "local")));
            return (
              <div key={p} className="border-[3px] border-ink bg-white">
                <div className="grid grid-cols-[1fr_260px] items-start gap-3 p-2.5">
                  <div>
                    <div className="text-[17px] font-bold">{info.label}</div>
                    <div className="text-[13px] text-muted">
                      {agents.length ? `Used by ${agents.map((a) => `${a.name}${a.model ? ` (${a.model})` : ""}`).join(", ")}` : "No agent uses it yet."}
                      {" · "}
                      <a className="underline" href={info.keyUrl} target="_blank" rel="noreferrer">
                        Get a key ↗
                      </a>
                    </div>
                    {auth === "subscription" && info.subscriptionNote && <div className="mt-1 text-[13px]">{info.subscriptionNote}</div>}
                    {p === "deepseek" && (
                      <div className="mt-1 text-[13px]">
                        DeepSeek runs in Claude Code, pointed at DeepSeek's API. In sandboxes, YACC adds DeepSeek to Docker Sandboxes' model providers (an experimental sbx feature).
                      </div>
                    )}
                  </div>
                  <Field label="Sign in with">
                    {info.auth.length > 1 ? (
                      <select className="field" value={auth} onChange={(e) => officeActions.setProviderAuth(p, e.target.value as AuthMode)}>
                        {info.auth.map((m) => (
                          <option key={m} value={m}>
                            {AUTH_LABEL[m]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="field bg-cream text-muted">API key only</div>
                    )}
                  </Field>
                </div>
                {rows.length > 0 && (
                  <ul className="border-t-[3px] border-ink bg-cream px-3">
                    {rows.map((c) => (
                      <CheckRow key={c.id} c={c} running={running === c.id} onRun={() => run(c.id)} />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
        {running && (
          <div className="mt-2 border-[3px] border-ink">
            <div className="flex items-center justify-between bg-navy px-2 py-1 text-[13px] text-cream">
              <span>Running · type here if it asks for a key</span>
              <button className="text-[12px] underline" onClick={() => setRunning(null)}>
                Hide
              </button>
            </div>
            <div className="h-[200px]">
              <TerminalView key={running} agentId={`setup:${running}`} />
            </div>
          </div>
        )}
      </section>

      <section>
        <SectionTitle>Research: Perplexity</SectionTitle>
        <p className="mb-3 text-[14px] text-muted">
          Give any role live web research with sources: Perplexity's search, ask and deep-research tools. It uses Perplexity's own MCP server and your API key, which goes to Docker's secret store.
        </p>
        {!perplexity ? (
          <form
            className="flex items-end gap-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!key.trim()) return;
              officeActions.addMcp({ name: PERPLEXITY_MCP.name, url: PERPLEXITY_MCP.url, apiKey: key.trim() });
              setKey("");
            }}
          >
            <div className="flex-1">
              <Field label="Perplexity API key" hint="From perplexity.ai → API. Stored by Docker Sandboxes, never in YACC's files.">
                <input className="field" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="pplx-…" />
              </Field>
            </div>
            <button className="btn" type="submit" disabled={!key.trim() || !mcp}>
              Add Perplexity
            </button>
          </form>
        ) : (
          <div className="border-[3px] border-ink bg-white p-2.5 text-[14px]">
            <div>
              <b>Perplexity</b> · {perplexity.status === "ready" ? "ready" : perplexity.status}
              {perplexity.status === "needs-auth" && " (Settings → MCP → Sign in)"}
            </div>
            {/* Each checkbox has its own label, so this is a fieldset, not a Field. */}
            <fieldset className="m-0 mt-2 border-0 p-0">
              <legend className="mb-1 p-0 text-[14px] font-bold">Roles that get it</legend>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {cfg.roles.map((r) => {
                  const on = !!r.tools?.includes(PERPLEXITY_MCP.name);
                  return (
                    <label key={r.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => officeActions.updateRole(r.id, { tools: on ? (r.tools ?? []).filter((t) => t !== PERPLEXITY_MCP.name) : [...(r.tools ?? []), PERPLEXITY_MCP.name] })}
                      />
                      {r.title}
                      {r.id === LEAD_ROLE_ID ? " (lead)" : ""}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <p className="m-0 mt-2 text-[12px] text-muted">
              {toolRoles.length ? `Running agents with ${toolRoles.map((r) => r.title).join(", ")} get it now; the rest when they start.` : "Tick a role to give its agents the research tools."} Local-mode agents need PERPLEXITY_API_KEY where YACC starts.
            </p>
          </div>
        )}
      </section>
      <UsageAndBudgets />
      <RoutingSettings />
      <ModelDatalists />
    </div>
  );
}

// ---------------------------------------------------------------- usage, budgets, routing (Phase 4 part 2)

function BudgetEditor({ budget, onChange, label }: { budget?: Budget; onChange: (b: Budget | null) => void; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[14px]">$</span>
      <CommitInput
        className="field w-[90px]"
        aria-label={`${label}: dollars`}
        inputMode="decimal"
        value={budget ? String(budget.usd) : ""}
        placeholder="none"
        onCommit={(v) => {
          const usd = Number(v.replace(/[$,\s]/g, ""));
          onChange(v.trim() && Number.isFinite(usd) && usd > 0 ? { usd, period: budget?.period ?? "month" } : null);
        }}
      />
      <select className="field w-[110px]" aria-label={`${label}: period`} value={budget?.period ?? "month"} disabled={!budget} onChange={(e) => budget && onChange({ ...budget, period: e.target.value as BudgetPeriod })}>
        {BUDGET_PERIODS.map((p) => (
          <option key={p} value={p}>
            a {p}
          </option>
        ))}
      </select>
    </div>
  );
}

const lineCost = (l?: UsageLine) => (l ? `${l.estimated ? "≈" : ""}${usdText(l.costUsd)}` : "–");
const lineTokens = (l?: UsageLine) => (l ? tokensText(l.input + l.cacheRead + l.output + l.cacheWrite) : "–");

/** Usage per agent and for the team, and the budgets that pause them. */
export function UsageAndBudgets() {
  const cfg = useOffice((s) => s.snap?.config);
  const usage = useOffice((s) => s.snap?.usage);
  if (!cfg) return null;
  return (
    <section>
      <SectionTitle>Usage and budgets</SectionTitle>
      <p className="mb-3 text-[14px] text-muted">
        Claude Code, Codex and Gemini CLI report their tokens to YACC as they work. Claude Code also reports cost; for the others YACC estimates it from API prices (≈). On a subscription, cost is what the same work would cost on the API. A budget pauses the agent (or the whole team) when it's reached: HQ holds new messages and tasks, and asks you in Action items.
      </p>
      <table className="mb-2 w-full border-[3px] border-ink bg-white text-[14px]">
        <thead>
          <tr className="bg-cream text-left text-[12px] text-muted">
            <th className="px-2 py-1 font-normal">Who</th>
            <th className="px-2 py-1 text-right font-normal">Today</th>
            <th className="px-2 py-1 text-right font-normal">This week</th>
            <th className="px-2 py-1 text-right font-normal">This month</th>
            <th className="px-2 py-1 font-normal">Budget</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t-[3px] border-ink font-bold">
            <td className="px-2 py-1.5">Whole team</td>
            <td className="px-2 py-1.5 text-right font-term text-[16px]">{lineCost(usage?.project.day)}</td>
            <td className="px-2 py-1.5 text-right font-term text-[16px]">{lineCost(usage?.project.week)}</td>
            <td className="px-2 py-1.5 text-right font-term text-[16px]">{lineCost(usage?.project.month)}</td>
            <td className="px-2 py-1">
              <BudgetEditor label="Team budget" budget={cfg.limits.budget} onChange={(b) => officeActions.updateOrg({ budget: b })} />
            </td>
          </tr>
          {cfg.team.map((a) => {
            const u = usage?.agents[a.id];
            return (
              <tr key={a.id} className="border-t border-ink/30">
                <td className="px-2 py-1">
                  {a.name}
                  <div className="text-[12px] text-muted">{u ? `${lineTokens(u.month)} tokens this month` : "nothing reported yet"}</div>
                </td>
                <td className="px-2 py-1 text-right font-term text-[16px]">{lineCost(u?.day)}</td>
                <td className="px-2 py-1 text-right font-term text-[16px]">{lineCost(u?.week)}</td>
                <td className="px-2 py-1 text-right font-term text-[16px]">{lineCost(u?.month)}</td>
                <td className="px-2 py-1">
                  <BudgetEditor label={`${a.name}'s budget`} budget={a.budget} onChange={(b) => officeActions.updateAgent(a.id, { budget: b })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="m-0 text-[12px] text-muted">Empty means no budget. Usage is kept on this machine (~/.yacc), never in the repo.</p>
    </section>
  );
}

function PickFields({ pick, onChange, label }: { pick: ModelPick; onChange: (p: ModelPick) => void; label: string }) {
  return (
    <>
      <select className="field" aria-label={`${label}: model`} value={pick.cli} onChange={(e) => onChange({ cli: e.target.value as AgentCli })}>
        {(Object.keys(RUNTIMES) as AgentCli[]).map((c) => (
          <option key={c} value={c}>
            {RUNTIMES[c].label}
          </option>
        ))}
      </select>
      <CommitInput
        className="field"
        aria-label={`${label}: model name`}
        value={pick.model ?? ""}
        placeholder={modelPlaceholder(pick.cli)}
        list={modelListId(pick.cli)}
        onCommit={(v) => onChange({ cli: pick.cli, ...(v.trim() ? { model: v.trim() } : {}) })}
      />
    </>
  );
}

/** Routing rules (model by kind of work) and the fallback order at a usage limit. */
export function RoutingSettings() {
  const cfg = useOffice((s) => s.snap?.config);
  const [kind, setKind] = useState("");
  if (!cfg) return null;
  const rules = cfg.routing?.rules ?? [];
  const fallback = cfg.routing?.fallback ?? [];
  const save = (next: { rules?: RoutingRule[]; fallback?: ModelPick[] }) => officeActions.setRouting({ rules, fallback, ...next });
  return (
    <section>
      <SectionTitle>Routing</SectionTitle>
      <p className="mb-3 text-[14px] text-muted">
        Send each kind of work to the model that suits it. The lead sets a kind on tasks (it's told the kinds below); when an agent starts a task of that kind, YACC restarts it on that model, keeping its folder and task. Other tasks run on the agent's own model.
      </p>
      <div className="mb-2 flex flex-col gap-1.5">
        {rules.map((r, i) => (
          <div key={`${r.kind}-${i}`} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
            <CommitInput className="field" aria-label="Kind of work" value={r.kind} onCommit={(v) => save({ rules: rules.map((x, j) => (j === i ? { ...x, kind: v } : x)) })} />
            <PickFields label={`${r.kind} work`} pick={r} onChange={(p) => save({ rules: rules.map((x, j) => (j === i ? { kind: x.kind, ...p } : x)) })} />
            <button className="btn px-2 text-[12px]" onClick={() => save({ rules: rules.filter((_, j) => j !== i) })} aria-label={`Remove the ${r.kind} rule`}>
              Remove
            </button>
          </div>
        ))}
        {!rules.length && <p className="m-0 text-[13px] text-muted">No rules: every agent runs on its own model.</p>}
      </div>
      <form
        className="mb-5 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!kind.trim()) return;
          save({ rules: [...rules, { kind: kind.trim(), cli: "gemini", model: "pro" }] });
          setKind("");
        }}
      >
        <div className="flex-1">
          <Field label="New kind of work" hint="e.g. research, writing, review, quick fixes">
            <input className="field" value={kind} onChange={(e) => setKind(e.target.value)} placeholder="research" />
          </Field>
        </div>
        <button className="btn" type="submit" disabled={!kind.trim()}>
          Add rule
        </button>
      </form>

      <SectionTitle>Fallback</SectionTitle>
      <p className="mb-3 text-[14px] text-muted">
        When a model stops at its usage limit (or a billing problem), YACC moves the agent to the first model below from another provider that's set up, and tells it to continue its task. It stays there until you choose "Use own model" in its drawer. With no fallback, you get an action item.
      </p>
      <ol className="m-0 mb-2 flex list-none flex-col gap-1.5 p-0">
        {fallback.map((f, i) => (
          <li key={`${f.cli}-${f.model ?? ""}-${i}`} className="grid grid-cols-[24px_1fr_1fr_auto] items-center gap-2">
            <span className="font-term text-[16px] text-muted">{i + 1}.</span>
            <PickFields label={`Fallback ${i + 1}`} pick={f} onChange={(p) => save({ fallback: fallback.map((x, j) => (j === i ? p : x)) })} />
            <span className="flex gap-1">
              <button className="btn px-2 text-[12px]" disabled={i === 0} onClick={() => save({ fallback: fallback.map((x, j) => (j === i - 1 ? fallback[i] : j === i ? fallback[i - 1] : x)) })} aria-label={`Move fallback ${i + 1} up`}>
                ↑
              </button>
              <button className="btn px-2 text-[12px]" onClick={() => save({ fallback: fallback.filter((_, j) => j !== i) })} aria-label={`Remove fallback ${i + 1}`}>
                Remove
              </button>
            </span>
          </li>
        ))}
      </ol>
      <button className="btn" onClick={() => save({ fallback: [...fallback, { cli: fallback.some((f) => f.cli === "codex") ? "gemini" : "codex" }] })}>
        Add a fallback
      </button>
    </section>
  );
}
