import { useState } from "react";
import { nextAgentName } from "../../data/names";
import { MAX_AGENTS_CEILING } from "../../data/roles";
import { CEO_ID, CLI_LABEL, LEAD_ROLE_ID, type AgentCli, type AgentConfig, type AgentMode } from "../../data/types";
import { officeActions, useOffice } from "../../store/office";
import { agentPalette } from "../../theme/tokens";
import { Field, Portrait, SectionTitle } from "../kit";
import { CommitInput } from "./controls";
import { RemoveAgentDialog } from "./RemoveAgentDialog";

export function CliSelect({ value, onChange }: { value: AgentCli; onChange: (v: AgentCli) => void }) {
  return (
    <select className="field" value={value} onChange={(e) => onChange(e.target.value as AgentCli)} aria-label="Coding agent">
      {(Object.keys(CLI_LABEL) as AgentCli[]).map((c) => (
        <option key={c} value={c}>
          {CLI_LABEL[c]}
        </option>
      ))}
    </select>
  );
}

export function TeamSettings() {
  const team = useOffice((s) => s.snap?.config.team);
  const ceo = useOffice((s) => s.snap?.config.ceo);
  const limits = useOffice((s) => s.snap?.config.limits);
  const [open, setOpen] = useState<string | null>(null);
  const [removing, setRemoving] = useState<AgentConfig | null>(null);
  if (!team || !ceo || !limits) return null;
  return (
    <div className="flex flex-col gap-5">
      <section>
        <SectionTitle>You, the CEO</SectionTitle>
        <p className="mb-3 text-[14px] text-muted">
          You head the team. You brief the lead, and the lead reports back to you. Any agent can ask you directly for an approval, a decision or access.
        </p>
        <div className="grid grid-cols-[1fr_220px] items-start gap-2.5">
          <Field label="Your name" hint="How agents refer to you.">
            <CommitInput className="field" value={ceo.name} maxLength={40} onCommit={(v) => v.trim() && officeActions.updateOrg({ ceoName: v.trim() })} />
          </Field>
          <Field label="Headcount limit" hint={`Most agents on the team, lead included (up to ${MAX_AGENTS_CEILING}). The lead can hire without asking you, but never past this.`}>
            <CommitInput
              className="field"
              type="number"
              value={String(limits.maxAgents)}
              onCommit={(v) => Number.isFinite(Number(v)) && officeActions.updateOrg({ maxAgents: Number(v) })}
            />
          </Field>
        </div>
      </section>
      <section>
        <SectionTitle>
          Team · {team.length} of {limits.maxAgents} agents
        </SectionTitle>
        <p className="mb-3 text-[14px] text-muted">
          Changes to role, model, mode or folder apply the next time the agent starts. One lead plans and assigns work. Every other agent gets its own desk and sandbox. What each role may do is under Roles.
        </p>
        <div className="flex flex-col gap-2">
          {team.map((a) => (
            <AgentRow key={a.id} agent={a} expanded={open === a.id} onToggle={() => setOpen(open === a.id ? null : a.id)} onRemove={() => setRemoving(a)} />
          ))}
        </div>
      </section>
      <AddAgent />
      {removing && <RemoveAgentDialog agent={removing} onClose={() => setRemoving(null)} />}
    </div>
  );
}

function AgentRow({ agent, expanded, onToggle, onRemove }: { agent: AgentConfig; expanded: boolean; onToggle: () => void; onRemove: () => void }) {
  const set = (patch: Parameters<typeof officeActions.updateAgent>[1]) => officeActions.updateAgent(agent.id, patch);
  const roles = useOffice((s) => s.snap?.config.roles) ?? [];
  const team = useOffice((s) => s.snap?.config.team) ?? [];
  const ceoName = useOffice((s) => s.snap?.config.ceo.name) ?? "CEO";
  const hirer = agent.hiredBy ? team.find((a) => a.id === agent.hiredBy)?.name : null;
  return (
    <div className="border-[3px] border-ink bg-white">
      <div className="grid grid-cols-[40px_1fr_1fr_150px_130px_auto] items-end gap-2.5 p-2.5">
        <Portrait color={agent.color} lead={agent.isLead} />
        <Field label="Name">
          <CommitInput className="field" value={agent.name} onCommit={(v) => v.trim() && set({ name: v.trim() })} />
        </Field>
        <Field label="Role">
          {agent.isLead ? (
            <div className="field flex h-9 items-center bg-cream-2">{agent.role}</div>
          ) : (
            <select className="field" value={agent.roleId} onChange={(e) => set({ roleId: e.target.value })} aria-label={`${agent.name}'s role`}>
              {roles
                .filter((r) => r.id !== LEAD_ROLE_ID)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
            </select>
          )}
        </Field>
        <Field label="Agent">
          <CliSelect value={agent.cli} onChange={(cli) => set({ cli })} />
        </Field>
        <Field label="Runs in">
          <select className="field" value={agent.mode} onChange={(e) => set({ mode: e.target.value as AgentMode })}>
            <option value="sandbox">Sandbox</option>
            <option value="local">Local</option>
          </select>
        </Field>
        <div className="flex gap-1.5">
          <button className="btn px-2 text-[13px]" aria-expanded={expanded} onClick={onToggle}>
            {expanded ? "Less" : "More"}
          </button>
          {!agent.isLead && (
            <button
              className="btn px-2 text-[13px] text-red"
              onClick={onRemove}
            >
              Remove
            </button>
          )}
        </div>
      </div>
      {hirer && (
        <div className="border-t-2 border-dashed border-cream-3 px-3 py-1 text-[12px] text-muted">
          Hired by {hirer}
          {agent.temporary ? " for one piece of work (temporary). The lead dismisses them when it is done." : "."}
        </div>
      )}
      {agent.mode === "local" && (
        <div className="border-t-2 border-dashed border-cream-3 px-3 py-1 text-[12px] text-muted">
          Local mode runs plain <code>{agent.cli}</code> in the agent's own folder. Permission prompts stay on.
        </div>
      )}
      {expanded && (
        <div className="grid grid-cols-2 gap-3 border-t-[3px] border-ink bg-cream p-3">
          <Field label="Reports to" hint="Who this agent answers to. Everyone can still message everyone.">
            {agent.isLead ? (
              <div className="field flex h-9 items-center bg-cream-2">{ceoName} (CEO)</div>
            ) : (
              <select className="field" value={agent.reportsTo} onChange={(e) => set({ reportsTo: e.target.value })} aria-label={`Who ${agent.name} reports to`}>
                <option value={CEO_ID}>{ceoName} (CEO)</option>
                {team
                  .filter((a) => a.id !== agent.id)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.role})
                    </option>
                  ))}
              </select>
            )}
          </Field>
          <Field label="Colour">
            <div className="flex flex-wrap gap-1.5">
              {agentPalette.map((c) => (
                <button
                  key={c}
                  className="h-6 w-6 border-[3px] border-ink"
                  style={{ background: c, outline: c === agent.color ? "3px solid #241a2e" : undefined, outlineOffset: 1 }}
                  aria-label={`Colour ${c}`}
                  onClick={() => set({ color: c })}
                />
              ))}
            </div>
          </Field>
          <Field label="Start with model" hint="Optional. Leave empty to use the CLI's default — you can always switch with /model in the terminal. Set it to keep a choice across restarts (e.g. Opus for the lead).">
            <CommitInput
              className="field"
              value={agent.model}
              placeholder={`${CLI_LABEL[agent.cli]} default`}
              list={agent.cli === "codex" ? "codex-models" : "claude-models"}
              onCommit={(v) => set({ model: v.trim() })}
            />
          </Field>
          <Field label="Skills" hint="Comma separated. Copied into the agent's .claude/skills.">
            <CommitInput
              className="field"
              value={agent.skills.join(", ")}
              onCommit={(v) => set({ skills: v.split(",").map((s) => s.trim()).filter(Boolean) })}
            />
          </Field>
          <div className="col-span-2">
            <Field label="Folder" hint="Leave empty and HQ keeps its own clone of the repo for this agent. Or enter an existing git folder.">
              <CommitInput
                className="field font-term text-[17px]"
                value={agent.workspacePath ?? ""}
                placeholder={`HQ-managed: ~/.yacc/…/${agent.id}`}
                onCommit={(v) => set({ workspacePath: v.trim() || null })}
              />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Notes for this agent" hint="Optional, for this agent only. What the role does is under Roles. HQ puts the role's instructions, these notes, the team and the tools into .yacc-role.md in the agent's folder (never committed) and loads it when the session starts. A ROLE.md the folder already has is included too, never overwritten.">
              <CommitInput multiline className="field h-[120px] resize-y font-term text-[17px] leading-tight" value={agent.roleMd} onCommit={(v) => set({ roleMd: v })} />
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}

function AddAgent() {
  const [name, setName] = useState("");
  const roles = (useOffice((s) => s.snap?.config.roles) ?? []).filter((r) => r.id !== LEAD_ROLE_ID);
  const limit = useOffice((s) => s.snap?.config.limits.maxAgents) ?? MAX_AGENTS_CEILING;
  const [role, setRole] = useState(roles[0]?.title ?? "Developer");
  const [cli, setCli] = useState<AgentCli>("claude");
  const [mode, setMode] = useState<AgentMode>("sandbox");
  const team = useOffice((s) => s.snap?.config.team) ?? [];
  const suggested = nextAgentName(team.map((a) => a.name));
  const add = () => {
    officeActions.addAgent({ name: name.trim() || suggested, role, cli, mode });
    setName("");
  };
  return (
    <section className="border-[3px] border-dashed border-ink p-3">
      <SectionTitle>Add an agent</SectionTitle>
      <form
        className="grid grid-cols-[1fr_1fr_150px_130px_auto] items-end gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Field label="Name">
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder={suggested} />
        </Field>
        <Field label="Role" hint="Pick a role, or type a new title to create one.">
          <input className="field" value={role} list="role-suggestions" onChange={(e) => setRole(e.target.value)} />
        </Field>
        <Field label="Agent">
          <CliSelect value={cli} onChange={setCli} />
        </Field>
        <Field label="Runs in">
          <select className="field" value={mode} onChange={(e) => setMode(e.target.value as AgentMode)}>
            <option value="sandbox">Sandbox</option>
            <option value="local">Local</option>
          </select>
        </Field>
        <button className="btn" type="submit">
          Add
        </button>
      </form>
      <p className="mt-2 text-[12px] text-muted">
        HQ starts a new sandbox with the lead's network policy and allows it to reach HQ at host.docker.internal.
        {team.length >= limit && ` You are at your headcount limit of ${limit}: you can still add agents yourself, but the lead can't hire.`}
      </p>
      <datalist id="codex-models">
        <option value="gpt-5.6-sol" />
      </datalist>
      <datalist id="claude-models">
        <option value="opus" />
        <option value="sonnet" />
        <option value="haiku" />
      </datalist>
      <datalist id="role-suggestions">
        {roles.map((r) => (
          <option key={r.id} value={r.title} />
        ))}
      </datalist>
    </section>
  );
}
