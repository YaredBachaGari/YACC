import { useState } from "react";
import { PERPLEXITY_MCP, PROVIDERS, RUNTIMES, authFor, providerOf } from "../../data/models";
import { AUTH_LABEL, LEAD_ROLE_ID, type AgentCli, type AuthMode, type ProviderId, type SetupCheckId } from "../../data/types";
import { officeActions, useOffice } from "../../store/office";
import { TerminalView } from "../drawers/TerminalView";
import { Field, SectionTitle } from "../kit";
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
    </div>
  );
}
