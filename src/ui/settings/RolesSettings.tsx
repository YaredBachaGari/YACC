import { useState } from "react";
import { toolsFor } from "../../data/roles";
import { LEAD_ROLE_ID, PERMISSIONS, PERMISSION_LABEL, type Permission, type RoleConfig } from "../../data/types";
import { officeActions, useOffice } from "../../store/office";
import { Field, SectionTitle } from "../kit";
import { CommitInput } from "./controls";

/** Permissions the lead role can't lose: without them nobody could plan or hand out work. */
const LEAD_LOCKED: Permission[] = ["plan", "assign"];

export function RolesSettings() {
  const roles = useOffice((s) => s.snap?.config.roles);
  const team = useOffice((s) => s.snap?.config.team) ?? [];
  const [open, setOpen] = useState<string | null>(null);
  if (!roles) return null;
  return (
    <div className="flex flex-col gap-5">
      <section>
        <SectionTitle>Roles · {roles.length}</SectionTitle>
        <p className="mb-3 text-[14px] text-muted">
          A role says what an agent may do and how it should work. Roles are saved in <code>.yacc/config.yml</code>, and each role's instructions in <code>.yacc/roles/</code>; you can edit those files by hand too. Changes reach an agent the next time it starts.
        </p>
        <div className="flex flex-col gap-2">
          {roles.map((r) => (
            <RoleRow key={r.id} role={r} holders={team.filter((a) => a.roleId === r.id).map((a) => a.name)} expanded={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
          ))}
        </div>
      </section>
      <AddRole />
    </div>
  );
}

function RoleRow({ role, holders, expanded, onToggle }: { role: RoleConfig; holders: string[]; expanded: boolean; onToggle: () => void }) {
  const isLead = role.id === LEAD_ROLE_ID;
  const set = (patch: Parameters<typeof officeActions.updateRole>[1]) => officeActions.updateRole(role.id, patch);
  const toggle = (p: Permission) => set({ can: role.can.includes(p) ? role.can.filter((x) => x !== p) : [...role.can, p] });
  return (
    <div className="border-[3px] border-ink bg-white">
      <div className="grid grid-cols-[1fr_2fr_auto] items-end gap-2.5 p-2.5">
        <Field label="Title">
          <CommitInput className="field" value={role.title} maxLength={40} onCommit={(v) => v.trim() && set({ title: v.trim() })} />
        </Field>
        <div className="pb-1.5 text-[13px] text-muted">
          <div>{role.can.length ? `Can ${role.can.join(", ")}` : "No special permissions"}</div>
          <div>{holders.length ? `Held by ${holders.join(", ")}` : "Nobody has this role yet"}</div>
        </div>
        <div className="flex gap-1.5">
          <button className="btn px-2 text-[13px]" aria-expanded={expanded} onClick={onToggle}>
            {expanded ? "Less" : "Edit"}
          </button>
          {!isLead && (
            <button
              className="btn px-2 text-[13px] text-red"
              disabled={holders.length > 0}
              title={holders.length ? "Give these agents another role first" : undefined}
              onClick={() => officeActions.removeRole(role.id)}
            >
              Remove
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="flex flex-col gap-3 border-t-[3px] border-ink bg-cream p-3">
          {/* Not a Field: a Field is one <label>, and each checkbox here needs its own. */}
          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-1 p-0 text-[14px] font-bold">Permissions</legend>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {PERMISSIONS.map((p) => {
                const locked = isLead && LEAD_LOCKED.includes(p);
                return (
                  <label key={p} className="flex items-center gap-2 text-[14px]">
                    <input type="checkbox" checked={role.can.includes(p)} disabled={locked} onChange={() => toggle(p)} />
                    {PERMISSION_LABEL[p]}
                  </label>
                );
              })}
            </div>
            <p className="m-0 mt-1 text-[12px] text-muted">{isLead ? "The lead is built in: every team has exactly one, and it always plans and assigns." : "Agents with this role get only the tools these allow."}</p>
          </fieldset>
          <div className="text-[12px] text-muted">Tools: {toolsFor(role).join(", ")}</div>
          <Field label="Instructions" hint={`What this role does and how. Saved to .yacc/roles/${role.id}.md. HQ adds the team, the reporting lines and the tools when the agent starts.`}>
            <CommitInput multiline className="field h-[220px] resize-y font-term text-[17px] leading-tight" value={role.instructions} onCommit={(v) => set({ instructions: v })} />
          </Field>
          <Field label="Default model for new agents" hint="Optional. An agent's own setting wins.">
            <CommitInput className="field" value={role.model ?? ""} placeholder="The agent CLI's default" onCommit={(v) => set({ model: v.trim() })} />
          </Field>
        </div>
      )}
    </div>
  );
}

function AddRole() {
  const [title, setTitle] = useState("");
  const add = () => {
    if (!title.trim()) return;
    officeActions.addRole({ title: title.trim() });
    setTitle("");
  };
  return (
    <section className="border-[3px] border-dashed border-ink p-3">
      <SectionTitle>Add a role</SectionTitle>
      <form
        className="grid grid-cols-[1fr_auto] items-end gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Field label="Title">
          <input className="field" value={title} maxLength={40} onChange={(e) => setTitle(e.target.value)} placeholder="Researcher, Writer, Editor, QA…" />
        </Field>
        <button className="btn" type="submit" disabled={!title.trim()}>
          Add
        </button>
      </form>
      <p className="mt-2 text-[12px] text-muted">A new role starts able to take tasks, with general instructions. Open it to say what the role does.</p>
    </section>
  );
}
