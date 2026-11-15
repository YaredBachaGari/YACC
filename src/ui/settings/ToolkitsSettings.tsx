// Toolkits (plan steps 6.1 and 6.2): what each role works with. Toolkits bundle agent skills and
// MCP servers for a kind of work; the team's own skills live in .yacc/skills/; the coding stack is
// one more kind, for software projects. Each is given to every role or to the roles you pick.

import { useEffect, useState } from "react";
import { mcpFor } from "../../data/models";
import { SKILL_BODY_MAX, SKILL_DESCRIPTION_MAX, SKILL_NAME, TOOLKIT_CATALOG, TOOLKIT_GROUPS, projectSkillsFor, toolkitsFor, type ProjectSkillChoice, type ToolkitChoice } from "../../data/toolkits";
import type { HqConfig, RoleConfig } from "../../data/types";
import { officeActions, useOffice } from "../../store/office";
import { ui } from "../../store/ui";
import { Field, SectionTitle } from "../kit";
import { StackSettings } from "./StackSettings";
import { Toggle } from "./controls";

export function ToolkitsSettings() {
  const cfg = useOffice((s) => s.snap?.config);
  const [coding, setCoding] = useState(false);
  if (!cfg) return null;
  const hasStack = !!cfg.stack && (cfg.stack.frameworks.length > 0 || Object.values(cfg.stack.tools).some(Boolean));
  return (
    <div className="flex flex-col gap-5">
      <p className="m-0 text-[14px] text-muted">
        What each role works with. A toolkit installs agent skills (and sometimes MCP servers) for one kind of work. Give it to every role, or pick the roles. The team's own skills are below. Saved in <code>.yacc/config.yml</code>; agents get them the next time they start.
      </p>
      <Toolkits cfg={cfg} />
      <ProjectSkills cfg={cfg} />
      <WhoGetsWhat cfg={cfg} />
      <section>
        <button className="btn px-2 text-[13px]" aria-expanded={coding || hasStack} onClick={() => setCoding(!coding)} disabled={hasStack}>
          {coding || hasStack ? "▾" : "▸"} Coding stack {hasStack ? "(in use)" : "(for software projects)"}
        </button>
        {(coding || hasStack) && (
          <div className="mt-3 border-[3px] border-ink bg-cream p-3">
            <StackSettings />
          </div>
        )}
      </section>
    </div>
  );
}

/** Role chips: none picked = every role. */
function RolePicker({ roles, picked, onChange, label }: { roles: RoleConfig[]; picked: string[] | undefined; onChange: (ids: string[] | undefined) => void; label: string }) {
  const all = !picked?.length;
  const toggle = (id: string) => {
    const now = new Set(picked ?? []);
    if (now.has(id)) now.delete(id);
    else now.add(id);
    onChange(now.size ? roles.filter((r) => now.has(r.id)).map((r) => r.id) : undefined);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      <span className="text-[12px] font-semibold text-muted">For</span>
      <button className="btn px-1.5 py-0 text-[12px]" aria-pressed={all} onClick={() => onChange(undefined)}>
        Every role
      </button>
      {roles.map((r) => (
        <button key={r.id} className="btn px-1.5 py-0 text-[12px]" aria-pressed={!all && !!picked?.includes(r.id)} onClick={() => toggle(r.id)}>
          {r.title}
        </button>
      ))}
    </div>
  );
}

function Toolkits({ cfg }: { cfg: HqConfig }) {
  const chosen = cfg.toolkits ?? [];
  const mcp = useOffice((s) => s.snap?.mcp);
  const save = (next: ToolkitChoice[]) => officeActions.updateToolkits(next);
  const choice = (id: string) => chosen.find((c) => c.id === id);
  return (
    <section>
      <SectionTitle>Toolkits</SectionTitle>
      <div className="flex flex-col gap-3">
        {TOOLKIT_GROUPS.map((g) => (
          <div key={g.id}>
            <div className="mb-1.5 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">{g.label}</div>
            <div className="grid grid-cols-2 gap-2">
              {TOOLKIT_CATALOG.filter((t) => t.group === g.id).map((t) => {
                const c = choice(t.id);
                const missingMcp = t.mcp.filter((n) => mcp && !mcp.error && !mcp.servers.some((s) => s.name === n));
                return (
                  <div key={t.id} className={`flex flex-col gap-1.5 border-[3px] border-ink p-2.5 ${c ? "bg-white" : "bg-cream"}`} data-toolkit={t.id}>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <b className="text-[15px]">{t.name}</b>
                        <div className="text-[13px] text-muted">{t.description}</div>
                      </div>
                      <Toggle checked={!!c} label={c ? "On" : "Off"} onChange={(on) => save(on ? [...chosen, { id: t.id }] : chosen.filter((x) => x.id !== t.id))} />
                    </div>
                    <div className="flex flex-wrap gap-1 text-[12px]">
                      {t.skills.map((sp) => (
                        <span key={sp.source} className="chip font-term text-[14px]" title={`${sp.skills.join(", ")} from ${sp.source}`}>
                          {sp.skills.length} skill{sp.skills.length === 1 ? "" : "s"}
                        </span>
                      ))}
                      {t.mcp.map((n) => (
                        <span key={n} className="chip font-term text-[14px]" title="MCP server">
                          MCP {n}
                        </span>
                      ))}
                    </div>
                    {t.needs && <div className="text-[12px] text-muted">Needs: {t.needs}</div>}
                    {c && missingMcp.length > 0 && (
                      <button className="text-left text-[12px] text-[#9a5b00] underline" onClick={() => ui.openSettings("mcp")}>
                        {missingMcp.join(", ")} isn't in Docker Sandboxes yet: sandboxed agents won't have it until you add it in Settings → MCP.
                      </button>
                    )}
                    {c && <RolePicker roles={cfg.roles} picked={c.roles} label={`Roles that get ${t.name}`} onChange={(roles) => save(chosen.map((x) => (x.id === t.id ? { id: t.id, ...(roles ? { roles } : {}) } : x)))} />}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

interface Draft {
  name: string;
  description: string;
  body: string;
  /** Editing an existing skill (its name can't change). */
  existing: boolean;
  roles?: string[];
}

function ProjectSkills({ cfg }: { cfg: HqConfig }) {
  const skills = useOffice((s) => s.snap?.projectSkills) ?? [];
  const chosen = cfg.skills ?? [];
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  useEffect(() => officeActions.refreshProjectSkills(), []);
  const save = (next: ProjectSkillChoice[]) => officeActions.updateProjectSkills(next);
  const edit = async (name: string) => {
    const s = await officeActions.readProjectSkill(name);
    if (s) setDraft({ ...s, existing: true });
  };
  const nameError = draft && !draft.existing && draft.name && !SKILL_NAME.test(draft.name) ? "Lowercase letters, numbers and dashes, like brand-voice." : draft && !draft.existing && skills.some((s) => s.name === draft.name) ? "There's already a skill with this name." : "";
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <SectionTitle>The team's own skills</SectionTitle>
        <span className="flex-1" />
        <button className="btn px-2 text-[13px]" onClick={() => officeActions.refreshProjectSkills()} title="Read .yacc/skills/ again, after adding or editing a folder by hand">
          Rescan
        </button>
        <button className="btn px-2 text-[13px]" onClick={() => setDraft({ name: "", description: "", body: "", existing: false })} disabled={!!draft}>
          + New skill
        </button>
      </div>
      <p className="mb-2 text-[13px] text-muted">
        Instructions for how your team does a kind of work: a house style, a checklist, a method. Each is a folder in <code>.yacc/skills/</code> with a SKILL.md, committed with the project. Agents use a skill when its description fits the task.
      </p>
      {draft && <SkillEditor cfg={cfg} draft={draft} setDraft={setDraft} nameError={nameError} />}
      <div className="flex flex-col gap-2">
        {skills.map((s) => {
          const c = chosen.find((x) => x.name === s.name);
          return (
            <div key={s.name} className="flex flex-col gap-1.5 border-[3px] border-ink bg-white p-2.5" data-project-skill={s.name}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <b className="font-term text-[17px]">{s.name}</b>
                  <div className="text-[13px] text-muted">{s.description || "No description"}</div>
                  {s.problem && <div className="text-[12px] text-red">{s.problem}</div>}
                </div>
                <Toggle checked={!!c} label={c ? "In use" : "Not used"} onChange={(on) => save(on ? [...chosen, { name: s.name }] : chosen.filter((x) => x.name !== s.name))} />
                <button className="btn px-2 text-[12px]" onClick={() => void edit(s.name)} disabled={!!draft}>
                  Edit
                </button>
                {removing === s.name ? (
                  <span className="flex items-center gap-1 text-[12px]">
                    Delete the folder?
                    <button
                      className="btn px-1.5 text-[12px] text-red"
                      onClick={() => {
                        officeActions.removeProjectSkill(s.name);
                        setRemoving(null);
                      }}
                    >
                      Delete
                    </button>
                    <button className="btn px-1.5 text-[12px]" onClick={() => setRemoving(null)}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <button className="btn px-2 text-[12px] text-red" onClick={() => setRemoving(s.name)}>
                    Remove
                  </button>
                )}
              </div>
              {c && <RolePicker roles={cfg.roles} picked={c.roles} label={`Roles that get ${s.name}`} onChange={(roles) => save(chosen.map((x) => (x.name === s.name ? { name: s.name, ...(roles ? { roles } : {}) } : x)))} />}
            </div>
          );
        })}
        {!skills.length && !draft && <p className="m-0 text-[13px] text-muted">None yet.</p>}
      </div>
    </section>
  );
}

function SkillEditor({ cfg, draft, setDraft, nameError }: { cfg: HqConfig; draft: Draft; setDraft: (d: Draft | null) => void; nameError: string }) {
  const ready = SKILL_NAME.test(draft.name) && !nameError && draft.description.trim() && draft.body.trim();
  return (
    <div className="mb-3 flex flex-col gap-2.5 border-[3px] border-ink bg-cream p-3" aria-label={draft.existing ? `Edit ${draft.name}` : "New skill"}>
      <div className="grid grid-cols-[220px_1fr] gap-3">
        <Field label="Name" hint={draft.existing ? "The folder's name; it can't change." : "The folder name: lowercase, dashes."}>
          <input className="field font-term text-[17px]" value={draft.name} disabled={draft.existing} maxLength={64} placeholder="house-style" onChange={(e) => setDraft({ ...draft, name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} />
          {nameError && <span className="text-[12px] text-red">{nameError}</span>}
        </Field>
        <Field label="When to use it" hint="Agents read this to decide when the skill applies. Start with 'Use when…'.">
          <input className="field" value={draft.description} maxLength={SKILL_DESCRIPTION_MAX} placeholder="Use when writing or editing any piece: the voice, length and formatting rules." onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </Field>
      </div>
      <Field label="Instructions" hint="Markdown. What to do, step by step, and what good looks like.">
        <textarea className="field h-[180px] resize-y font-term text-[16px] leading-tight" maxLength={SKILL_BODY_MAX} value={draft.body} placeholder={"# House style\n\n- Short sentences, plain words.\n- Cite every fact."} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
      </Field>
      {!draft.existing && <RolePicker roles={cfg.roles} picked={draft.roles} label="Roles that get the new skill" onChange={(roles) => setDraft({ ...draft, roles })} />}
      <div className="flex gap-2">
        <button
          className="btn px-3 text-[13px]"
          style={{ background: "#ffec27" }}
          disabled={!ready}
          onClick={() => {
            officeActions.saveProjectSkill({ name: draft.name, description: draft.description, body: draft.body, ...(draft.roles ? { roles: draft.roles } : {}) });
            setDraft(null);
          }}
        >
          {draft.existing ? "Save skill" : "Add skill"}
        </button>
        <button className="btn px-2 text-[13px]" onClick={() => setDraft(null)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Per role: what its agents get, so you can check the setup at a glance. */
function WhoGetsWhat({ cfg }: { cfg: HqConfig }) {
  const skills = useOffice((s) => s.snap?.projectSkills) ?? [];
  const rows = cfg.roles.map((r) => {
    const probe = { roleId: r.id };
    const agent = cfg.team.find((a) => a.roleId === r.id);
    const kits = toolkitsFor(probe, cfg).map((t) => t.name);
    const own = projectSkillsFor(probe, cfg).filter((n) => skills.some((s) => s.name === n && !s.problem));
    const servers = agent ? mcpFor(agent, cfg) : [...new Set([...(r.tools ?? []), ...toolkitsFor(probe, cfg).flatMap((t) => t.mcp)])];
    return { role: r, kits, own, servers, people: cfg.team.filter((a) => a.roleId === r.id).length };
  });
  if (!rows.some((r) => r.kits.length || r.own.length || r.servers.length)) return null;
  return (
    <section>
      <SectionTitle>Who gets what</SectionTitle>
      <table className="w-full border-collapse border-[3px] border-ink bg-white text-[13px]">
        <thead>
          <tr className="bg-cream-2 text-left">
            <th className="px-2 py-1">Role</th>
            <th className="px-2 py-1">Toolkits</th>
            <th className="px-2 py-1">Team skills</th>
            <th className="px-2 py-1">MCP servers</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ role, kits, own, servers, people }) => (
            <tr key={role.id} className="border-t-2 border-dashed border-cream-3 align-top">
              <td className="px-2 py-1 font-semibold">
                {role.title}
                <span className="ml-1 font-normal text-muted">({people})</span>
              </td>
              <td className="px-2 py-1">{kits.join(", ") || <span className="text-muted">none</span>}</td>
              <td className="px-2 py-1 font-term text-[15px]">{own.join(", ") || <span className="font-body text-[13px] text-muted">none</span>}</td>
              <td className="px-2 py-1 font-term text-[15px]">{servers.join(", ") || <span className="font-body text-[13px] text-muted">none</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[12px] text-muted">Every role also gets the coding stack's skills, when one is set. MCP servers per role are under Roles; per agent under MCP.</p>
    </section>
  );
}
