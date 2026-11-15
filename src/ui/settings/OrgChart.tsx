// The org chart editor (plan step 5.2): who reports to whom, drawn as a tree under you, the CEO.
// Drag a person onto someone to change who they report to; drag a role onto someone to add an
// agent with that role who reports to them. Everything here also works without a mouse, from
// the panel beside the chart.

import { useState, type DragEvent, type ReactNode } from "react";
import { MAX_AGENTS_CEILING, orgTree, wouldLoop, type OrgNode } from "../../data/roles";
import { CEO_ID, LEAD_ROLE_ID, type AgentConfig, type HqConfig, type RoleConfig } from "../../data/types";
import { officeActions, useOffice } from "../../store/office";
import { ui } from "../../store/ui";
import { Field, Portrait, SectionTitle } from "../kit";

type Drag = { kind: "agent"; id: string } | { kind: "role"; id: string } | null;

const CEO_SHIRT = "#40506b";

export function OrgChart() {
  const cfg = useOffice((s) => s.snap?.config);
  const [drag, setDrag] = useState<Drag>(null);
  const [over, setOver] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(CEO_ID);
  if (!cfg) return null;
  const tree = orgTree(cfg);
  const full = cfg.team.length >= MAX_AGENTS_CEILING;

  /** What dropping the current drag on `target` would do, or null if it can't go there. */
  const dropAction = (target: string): string | null => {
    if (!drag) return null;
    const name = target === CEO_ID ? cfg.ceo.name : (cfg.team.find((a) => a.id === target)?.name ?? "");
    if (drag.kind === "role") {
      if (full) return null;
      const role = cfg.roles.find((r) => r.id === drag.id);
      return role ? `Add a ${role.title} who reports to ${name}` : null;
    }
    const agent = cfg.team.find((a) => a.id === drag.id);
    if (!agent || agent.id === target || agent.reportsTo === target || wouldLoop(cfg.team, agent.id, target)) return null;
    return `${agent.name} reports to ${name}`;
  };
  const drop = (target: string) => {
    if (!drag || !dropAction(target)) return;
    if (drag.kind === "role") {
      const role = cfg.roles.find((r) => r.id === drag.id);
      if (role) officeActions.addAgent({ name: "", role: role.id, reportsTo: target, cli: role.cli, mode: "sandbox" });
    } else officeActions.updateAgent(drag.id, { reportsTo: target });
    setDrag(null);
    setOver(null);
  };
  const target = (id: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!dropAction(id)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = drag?.kind === "role" ? "copy" : "move";
      if (over !== id) setOver(id);
    },
    onDragLeave: () => over === id && setOver(null),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      drop(id);
    },
  });
  const start = (d: NonNullable<Drag>) => (e: DragEvent) => {
    e.dataTransfer.setData("text/plain", d.id);
    e.dataTransfer.effectAllowed = d.kind === "role" ? "copy" : "move";
    setDrag(d);
  };
  const end = () => {
    setDrag(null);
    setOver(null);
  };

  const branch = (node: OrgNode): ReactNode => (
    <li key={node.id}>
      <PersonCard
        cfg={cfg}
        id={node.id}
        selected={selected === node.id}
        onSelect={() => setSelected(node.id)}
        dropHint={over === node.id ? dropAction(node.id) : null}
        dimmed={!!drag && !dropAction(node.id) && !(drag.kind === "agent" && drag.id === node.id)}
        draggable={node.id !== CEO_ID && cfg.team.find((a) => a.id === node.id)?.roleId !== LEAD_ROLE_ID}
        onDragStart={start({ kind: "agent", id: node.id })}
        onDragEnd={end}
        {...target(node.id)}
      />
      {node.reports.length > 0 && <ul>{node.reports.map(branch)}</ul>}
    </li>
  );

  return (
    <div className="flex flex-col gap-4">
      <section>
        <SectionTitle>Org chart · {cfg.team.length} of {cfg.limits.maxAgents} agents</SectionTitle>
        <p className="text-[14px] text-muted">
          Who reports to whom. Drag a person onto someone else to change who they report to. Drag a role from the right onto someone to add an agent with that role under them. Reporting lines decide who an agent sends finished work to and asks first; anyone can still message anyone. The lead always reports to you.
        </p>
      </section>
      <div className="grid grid-cols-[1fr_250px] items-start gap-4">
        <div className="scroll-thin overflow-x-auto border-[3px] border-ink bg-white p-4" aria-label="Org chart">
          <div className="org-tree min-w-fit">
            <ul>{branch(tree)}</ul>
          </div>
        </div>
        <aside className="flex flex-col gap-3">
          <Selected cfg={cfg} id={selected} full={full} />
          <RolePalette cfg={cfg} full={full} onDragStart={(id) => start({ kind: "role", id })} onDragEnd={end} dragging={drag?.kind === "role" ? drag.id : null} />
        </aside>
      </div>
    </div>
  );
}

interface CardProps {
  cfg: HqConfig;
  id: string;
  selected: boolean;
  onSelect: () => void;
  dropHint: string | null;
  dimmed: boolean;
  draggable: boolean;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent) => void;
}

function PersonCard({ cfg, id, selected, onSelect, dropHint, dimmed, draggable, ...dnd }: CardProps) {
  const agent = cfg.team.find((a) => a.id === id);
  const status = useOffice((s) => s.snap?.agents.find((a) => a.agentId === id));
  const isCeo = id === CEO_ID;
  const name = isCeo ? cfg.ceo.name : (agent?.name ?? id);
  const title = isCeo ? "CEO · you" : agent?.isLead ? `${agent.role} · lead` : (agent?.role ?? "");
  const reports = cfg.team.filter((a) => a.reportsTo === id).length;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${name}, ${title}${reports ? `, ${reports} report${reports > 1 ? "s" : ""}` : ""}`}
      data-org-card={id}
      draggable={draggable}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect())}
      onDragStart={dnd.onDragStart}
      onDragEnd={dnd.onDragEnd}
      onDragOver={dnd.onDragOver}
      onDragLeave={dnd.onDragLeave}
      onDrop={dnd.onDrop}
      className={`relative flex w-[150px] flex-col items-center gap-1 border-[3px] border-ink px-2 pb-2 pt-2.5 text-center transition-opacity ${draggable ? "cursor-grab" : "cursor-pointer"} ${
        dropHint ? "bg-[#fff6d6]" : selected ? "bg-[#e7f1fb]" : "bg-cream"
      } ${dimmed ? "opacity-40" : ""}`}
      style={{ boxShadow: selected ? "0 0 0 3px #29adff" : "0 3px 0 #241a2e", borderTopWidth: 6, borderTopColor: isCeo ? CEO_SHIRT : (agent?.color ?? "#241a2e") }}
    >
      <Portrait color={isCeo ? CEO_SHIRT : (agent?.color ?? "#888")} lead={!!agent?.isLead} size={40} who={isCeo ? { id: `ceo:${cfg.ceo.name}`, avatar: cfg.ceo.avatar } : agent} forceFace />
      <span className="max-w-full truncate text-[15px] font-bold leading-tight">{name}</span>
      <span className="max-w-full truncate text-[12px] leading-tight text-muted">{title}</span>
      {(agent?.temporary || agent?.hiredBy || status?.session.state === "running") && (
        <span className="flex gap-1">
          {status?.session.state === "running" && <span className="chip chip-dot" style={{ ["--c" as string]: "#d6f5d6" }}>on</span>}
          {agent?.hiredBy && <span className="chip">hired</span>}
          {agent?.temporary && <span className="chip">temp</span>}
        </span>
      )}
      {dropHint && (
        <span role="status" className="absolute -bottom-7 left-1/2 z-10 w-max max-w-[220px] -translate-x-1/2 border-2 border-ink bg-ink px-1.5 text-[12px] text-cream">
          {dropHint}
        </span>
      )}
    </div>
  );
}

/** The selected person: change their role and manager, or add someone under them, without dragging. */
function Selected({ cfg, id, full }: { cfg: HqConfig; id: string; full: boolean }) {
  const agent = cfg.team.find((a) => a.id === id);
  const isCeo = id === CEO_ID || !agent;
  const roles = cfg.roles.filter((r) => r.id !== LEAD_ROLE_ID);
  const [role, setRole] = useState("");
  const pick = role && roles.some((r) => r.id === role) ? role : (roles[0]?.id ?? "");
  const name = isCeo ? cfg.ceo.name : agent.name;
  const managers = [{ id: CEO_ID, name: `${cfg.ceo.name} (CEO)` }, ...cfg.team.filter((a) => agent && a.id !== agent.id && !wouldLoop(cfg.team, agent.id, a.id)).map((a) => ({ id: a.id, name: `${a.name} (${a.role})` }))];
  return (
    <section className="border-[3px] border-ink bg-white p-3" aria-label={`Selected: ${name}`}>
      <div className="mb-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">Selected</div>
      <div className="mb-2 text-[16px] font-bold">{name}</div>
      {agent && !agent.isLead && (
        <div className="flex flex-col gap-2">
          <Field label="Role">
            <select className="field" value={agent.roleId} onChange={(e) => officeActions.updateAgent(agent.id, { roleId: e.target.value })}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reports to">
            <select className="field" value={agent.reportsTo} onChange={(e) => officeActions.updateAgent(agent.id, { reportsTo: e.target.value })}>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      {agent?.isLead && <p className="mb-2 text-[13px] text-muted">The lead always reports to you.</p>}
      {agent && (
        <button className="btn mt-2 px-2 text-[13px]" onClick={() => ui.openSettings("team", agent.id)}>
          Profile, model and more
        </button>
      )}
      <div className="mt-3 border-t-2 border-dashed border-ink pt-2">
        <Field label={`Add someone who reports to ${name}`}>
          <div className="flex gap-1.5">
            <select className="field min-w-0 flex-1" value={pick} onChange={(e) => setRole(e.target.value)} aria-label="Their role">
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
            <button
              className="btn px-2 text-[13px]"
              disabled={full || !pick}
              onClick={() => {
                const r = roles.find((x) => x.id === pick);
                if (r) officeActions.addAgent({ name: "", role: r.id, reportsTo: isCeo ? CEO_ID : agent.id, cli: r.cli, mode: "sandbox" });
              }}
            >
              Add
            </button>
          </div>
        </Field>
        {full && <p className="mt-1 text-[12px] text-red">A team can have at most {MAX_AGENTS_CEILING} agents.</p>}
      </div>
    </section>
  );
}

/** Roles to drag onto the chart, and a quick way to make a new one. */
function RolePalette({ cfg, full, onDragStart, onDragEnd, dragging }: { cfg: HqConfig; full: boolean; onDragStart: (id: string) => (e: DragEvent) => void; onDragEnd: () => void; dragging: string | null }) {
  const [title, setTitle] = useState("");
  const roles = cfg.roles.filter((r) => r.id !== LEAD_ROLE_ID);
  const count = (r: RoleConfig) => cfg.team.filter((a: AgentConfig) => a.roleId === r.id).length;
  const exists = roles.some((r) => r.title.toLowerCase() === title.trim().toLowerCase());
  return (
    <section className="border-[3px] border-ink bg-white p-3" aria-label="Roles">
      <div className="mb-1 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">Roles</div>
      <p className="mb-2 text-[12px] text-muted">{full ? `The team is full (${MAX_AGENTS_CEILING}).` : "Drag one onto a person to add an agent under them."}</p>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {roles.map((r) => (
          <li
            key={r.id}
            draggable={!full}
            onDragStart={onDragStart(r.id)}
            onDragEnd={onDragEnd}
            data-org-role={r.id}
            className={`flex items-center justify-between gap-2 border-2 border-ink px-2 py-0.5 text-[14px] ${full ? "bg-cream-2" : "cursor-grab bg-cream"} ${dragging === r.id ? "opacity-50" : ""}`}
            title={r.can.length ? `Can ${r.can.join(", ")}` : "No special permissions"}
          >
            <span className="truncate font-semibold">{r.title}</span>
            <span className="text-[12px] text-muted">{count(r) || "none yet"}</span>
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim() || exists) return;
          officeActions.addRole({ title: title.trim(), can: ["work"] });
          setTitle("");
        }}
      >
        <input className="field min-w-0 flex-1" value={title} maxLength={40} placeholder="New role, e.g. Editor" aria-label="New role title" onChange={(e) => setTitle(e.target.value)} />
        <button className="btn px-2 text-[13px]" type="submit" disabled={!title.trim() || exists}>
          Add role
        </button>
      </form>
      <button className="mt-2 text-[12px] underline" onClick={() => ui.openSettings("roles")}>
        Permissions and instructions are under Roles
      </button>
    </section>
  );
}
