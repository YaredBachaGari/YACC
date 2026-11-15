// The workflow editor (plan step 5.3): every unit of work goes through these stages in order.
// Drawn as a flow (stage cards, with what must happen between them), edited as a draft and saved
// whole, so a half-made list is never written. Stages keep their ids when renamed, so work in a
// stage stays there.

import { useEffect, useState, type DragEvent } from "react";
import { MAX_STAGES, STAGE_DESCRIPTION_MAX, newStageId, stageIssues, type StageIssue } from "../../data/workflow";
import { ANY_ROLE, GATE_LABEL, GATES, type AgentConfig, type DeliverableKind, type GateKind, type HqConfig, type StageConfig } from "../../data/types";
import { officeActions, useOffice } from "../../store/office";
import { Field, Portrait, SectionTitle } from "../kit";
import { CommitInput } from "./controls";

/** Draft stages not saved yet carry this id prefix; they get a real id from their name on save. */
const NEW = "~new-";
let newSeq = 0;

export function StagesSection() {
  const cfg = useOffice((s) => s.snap?.config);
  const wf = cfg?.workflow;
  const github = !!cfg?.project.repo.includes("/");
  const saved = JSON.stringify(wf?.stages ?? []);
  const [draft, setDraft] = useState<StageConfig[]>(wf?.stages ?? []);
  const [sel, setSel] = useState(0);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  useEffect(() => setDraft(JSON.parse(saved)), [saved]);
  if (!wf || !cfg) return null;
  const at = Math.min(sel, draft.length - 1);
  const dirty = JSON.stringify(draft) !== saved;
  const issues = stageIssues(cfg, wf, draft);
  const errors = issues.filter((x) => x.level === "error");

  const set = (i: number, patch: Partial<StageConfig>) => setDraft(draft.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= draft.length || from === to) return;
    const next = [...draft];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    setDraft(next);
    setSel(to);
  };
  const insert = (after: number) => {
    if (draft.length >= MAX_STAGES) return;
    const next = [...draft];
    next.splice(after + 1, 0, { id: `${NEW}${++newSeq}`, name: `Stage ${draft.length + 1}`, owner: ANY_ROLE, gate: "none" });
    // A pull request can only close the flow: the stage that had it is no longer last.
    if (wf.deliverable === "pull-request" && after === draft.length - 1 && next[after].gate === "pull-request") {
      next[after] = { ...next[after], gate: "none" };
      next[after + 1] = { ...next[after + 1], gate: "pull-request" };
    }
    setDraft(next);
    setSel(after + 1);
  };
  const remove = (i: number) => {
    if (draft.length === 1) return;
    setDraft(draft.filter((_, j) => j !== i));
    setSel(Math.max(0, i - 1));
  };
  const save = () => {
    const out: StageConfig[] = [];
    for (const s of draft) {
      const id = s.id.startsWith(NEW) ? newStageId([...draft.filter((x) => !x.id.startsWith(NEW)), ...out], s.name) : s.id;
      const { description, reviewer, ...rest } = s;
      out.push({ ...rest, id, name: s.name.trim(), ...(reviewer && (s.gate === "review" || s.gate === "approval") ? { reviewer } : {}), ...(description?.trim() ? { description: description.trim() } : {}) });
    }
    officeActions.updateWorkflow({ stages: out });
  };
  const onDrop = (to: number) => (e: DragEvent) => {
    e.preventDefault();
    if (dragFrom !== null) move(dragFrom, to);
    setDragFrom(null);
    setDropAt(null);
  };

  return (
    <section className="border-[3px] border-ink bg-white p-3">
      <SectionTitle>How work moves</SectionTitle>
      <p className="mb-3 text-[13px] text-muted">
        Every {wf.item.toLowerCase()} goes through these stages in order. When a stage is finished, HQ hands the work to whoever checks it, then to the next stage's role. Click a stage to edit it; drag stages to reorder them. Saved to <code>.yacc/config.yml</code>.
      </p>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Field label="A unit of work is called" hint="Shown on the board and to agents: Task, Piece, Experiment…">
          <CommitInput className="field" value={wf.item} maxLength={30} onCommit={(v) => v.trim() && officeActions.updateWorkflow({ item: v.trim() })} />
        </Field>
        <Field label="Finished work is" hint={wf.deliverable === "files" ? "Files in the agents' folders. GitHub is not used." : "A pull request on GitHub, reviewed and merged there."}>
          <select className="field" value={wf.deliverable} onChange={(e) => officeActions.updateWorkflow({ deliverable: e.target.value as DeliverableKind })}>
            <option value="files">Files</option>
            <option value="pull-request" disabled={!github}>
              Pull requests (GitHub){github ? "" : ": needs a GitHub remote"}
            </option>
          </select>
        </Field>
      </div>

      <div className="scroll-thin overflow-x-auto border-[3px] border-ink bg-cream px-3 py-4">
        <ol className="m-0 flex min-w-fit list-none items-center p-0" aria-label="Stages">
          <li className="mr-1 shrink-0 border-2 border-dashed border-ink px-2 py-1 text-[12px] font-semibold text-muted">New {wf.item.toLowerCase()}</li>
          <Arrow />
          {draft.map((st, i) => (
            <li key={st.id} className="flex shrink-0 items-center">
              <StageCard
                cfg={cfg}
                stage={st}
                index={i}
                selected={i === at}
                issues={issues.filter((x) => x.stage === i)}
                dropping={dropAt === i && dragFrom !== null && dragFrom !== i}
                onSelect={() => setSel(i)}
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", st.id);
                  e.dataTransfer.effectAllowed = "move";
                  setDragFrom(i);
                }}
                onDragEnd={() => {
                  setDragFrom(null);
                  setDropAt(null);
                }}
                onDragOver={(e) => {
                  if (dragFrom === null) return;
                  e.preventDefault();
                  if (dropAt !== i) setDropAt(i);
                }}
                onDrop={onDrop(i)}
              />
              <Arrow gate={gateText(cfg, st)} kind={st.gate} />
            </li>
          ))}
          <li className="flex shrink-0 items-center">
            <button className="btn mr-2 px-2 text-[13px]" disabled={draft.length >= MAX_STAGES} onClick={() => insert(draft.length - 1)} title={`Add a stage at the end (at most ${MAX_STAGES})`}>
              + Stage
            </button>
            <span className="border-2 border-ink bg-[#e5f4e4] px-2 py-1 text-[12px] font-semibold">Done</span>
          </li>
        </ol>
      </div>

      {draft[at] && (
        <StageEditor
          key={draft[at].id}
          cfg={cfg}
          stage={draft[at]}
          index={at}
          count={draft.length}
          last={at === draft.length - 1}
          onChange={(patch) => set(at, patch)}
          onMove={(by) => move(at, at + by)}
          onInsert={() => insert(at)}
          onRemove={() => remove(at)}
        />
      )}

      {issues.length > 0 && (
        <ul className="m-0 mt-3 flex list-none flex-col gap-1 p-0" aria-label="Problems with the stages">
          {issues.map((x, i) => (
            <li key={i}>
              <button className={`text-left text-[13px] ${x.level === "error" ? "text-red" : "text-[#9a5b00]"}`} onClick={() => x.stage !== null && setSel(x.stage)}>
                {x.level === "error" ? "✕ " : "! "}
                {x.text}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex items-center gap-2">
        <span className="text-[12px] text-muted">Work in a stage you remove moves to the first stage. Agents learn the new stages the next time they start.</span>
        <span className="flex-1" />
        {dirty && (
          <>
            <button className="btn px-2 text-[13px]" onClick={() => setDraft(JSON.parse(saved))}>
              Undo changes
            </button>
            <button className="btn px-3 text-[13px]" style={{ background: "#ffec27" }} disabled={errors.length > 0} title={errors.length ? "Fix the problems marked ✕ first" : undefined} onClick={save}>
              Save stages
            </button>
          </>
        )}
      </div>
    </section>
  );
}

const roleTitle = (cfg: HqConfig, id: string) => (id === ANY_ROLE ? "Anyone" : (cfg.roles.find((r) => r.id === id)?.title ?? id));

/** What has to happen after a stage before work moves on. */
function gateText(cfg: HqConfig, s: StageConfig): string {
  if (s.gate === "none") return "";
  if (s.gate === "ceo") return `${cfg.ceo.name} approves`;
  if (s.gate === "pull-request") return "Pull request";
  const who = s.reviewer ? roleTitle(cfg, s.reviewer) : s.gate === "review" ? "a reviewer" : "an approver";
  return s.gate === "review" ? `Review: ${who}` : `Sign-off: ${who}`;
}

function Arrow({ gate, kind }: { gate?: string; kind?: GateKind }) {
  const colour = kind === "ceo" ? "#ffec27" : kind === "pull-request" ? "#c2e6ff" : kind === "approval" ? "#efedff" : "#fff";
  return (
    <span className={`relative flex shrink-0 items-center justify-center self-stretch ${gate ? "w-[112px]" : "w-[56px]"}`} aria-hidden={!gate}>
      <span className="absolute left-1 right-2 top-1/2 h-[3px] -translate-y-1/2 bg-ink" />
      <span className="absolute right-1 top-1/2 h-0 w-0 -translate-y-1/2 border-y-[6px] border-l-[8px] border-y-transparent border-l-ink" />
      {gate && (
        <span className="relative z-[1] mr-2 max-w-[90px] border-2 border-ink px-1 text-center text-[11px] font-semibold leading-tight" style={{ background: colour }}>
          {gate}
        </span>
      )}
    </span>
  );
}

interface CardProps {
  cfg: HqConfig;
  stage: StageConfig;
  index: number;
  selected: boolean;
  issues: StageIssue[];
  dropping: boolean;
  onSelect: () => void;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}

function StageCard({ cfg, stage, index, selected, issues, dropping, onSelect, ...dnd }: CardProps) {
  const doers: AgentConfig[] = stage.owner === ANY_ROLE ? cfg.team.filter((a) => cfg.roles.find((r) => r.id === a.roleId)?.can.includes("work")) : cfg.team.filter((a) => a.roleId === stage.owner);
  const bad = issues.some((x) => x.level === "error");
  const warn = !bad && issues.length > 0;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Stage ${index + 1}: ${stage.name}, done by ${roleTitle(cfg, stage.owner)}${issues.length ? `, ${issues.length} problem${issues.length > 1 ? "s" : ""}` : ""}`}
      data-stage-card={index}
      draggable
      onClick={onSelect}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect())}
      {...dnd}
      className={`relative flex w-[150px] cursor-grab flex-col gap-1 border-[3px] p-2 ${bad ? "border-red" : "border-ink"} ${dropping ? "bg-[#fff6d6]" : selected ? "bg-[#e7f1fb]" : "bg-white"}`}
      style={{ boxShadow: selected ? "0 0 0 3px #29adff" : "0 3px 0 #241a2e" }}
    >
      <span className="flex items-baseline gap-1.5">
        <span className="font-term text-[16px] text-muted">{index + 1}</span>
        <span className="truncate text-[15px] font-bold">{stage.name || "Unnamed"}</span>
        {(bad || warn) && (
          <span className={`ml-auto text-[13px] font-bold ${bad ? "text-red" : "text-[#9a5b00]"}`} aria-hidden>
            {bad ? "✕" : "!"}
          </span>
        )}
      </span>
      <span className="truncate text-[12px] text-muted">{roleTitle(cfg, stage.owner)}</span>
      <span className="flex h-6 items-center gap-0.5">
        {doers.slice(0, 4).map((a) => (
          <Portrait key={a.id} color={a.color} lead={a.isLead} size={22} who={a} forceFace />
        ))}
        {doers.length > 4 && <span className="text-[11px] text-muted">+{doers.length - 4}</span>}
        {doers.length === 0 && <span className="text-[11px] italic text-[#9a5b00]">nobody yet</span>}
      </span>
    </div>
  );
}

interface EditorProps {
  cfg: HqConfig;
  stage: StageConfig;
  index: number;
  count: number;
  last: boolean;
  onChange: (patch: Partial<StageConfig>) => void;
  onMove: (by: number) => void;
  onInsert: () => void;
  onRemove: () => void;
}

function StageEditor({ cfg, stage, index, count, last, onChange, onMove, onInsert, onRemove }: EditorProps) {
  const workers = cfg.roles.filter((r) => r.can.includes("work") || r.id === stage.owner);
  const checkers = (gate: GateKind) => cfg.roles.filter((r) => r.can.includes(gate === "approval" ? "approve" : "review") || r.id === stage.reviewer);
  const gates = GATES.filter((g) => g !== "pull-request" || (cfg.workflow.deliverable === "pull-request" && last) || stage.gate === g);
  return (
    <div className="mt-3 border-[3px] border-ink bg-cream p-3" aria-label={`Edit stage ${index + 1}`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">Stage {index + 1}</span>
        <span className="flex-1" />
        <button className="btn px-2 text-[12px]" disabled={index === 0} onClick={() => onMove(-1)}>
          ← Earlier
        </button>
        <button className="btn px-2 text-[12px]" disabled={last} onClick={() => onMove(1)}>
          Later →
        </button>
        <button className="btn px-2 text-[12px]" disabled={count >= MAX_STAGES} onClick={onInsert}>
          + Stage after
        </button>
        <button className="btn px-2 text-[12px] text-red" disabled={count === 1} onClick={onRemove}>
          Remove
        </button>
      </div>
      <div className="grid grid-cols-[1fr_1fr_1.4fr] gap-3">
        <Field label="Name">
          <input className="field" value={stage.name} maxLength={30} onChange={(e) => onChange({ name: e.target.value })} />
        </Field>
        <Field label="Done by" hint="The role whose agents do this stage.">
          <select className="field" value={stage.owner} onChange={(e) => onChange({ owner: e.target.value })}>
            <option value={ANY_ROLE}>Anyone who takes tasks</option>
            {workers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Before it moves on">
          <div className="flex gap-1">
            <select className="field" value={stage.gate} onChange={(e) => onChange({ gate: e.target.value as GateKind, reviewer: undefined })}>
              {gates.map((g) => (
                <option key={g} value={g}>
                  {g === "ceo" ? `${cfg.ceo.name} approves` : GATE_LABEL[g]}
                </option>
              ))}
            </select>
            {(stage.gate === "review" || stage.gate === "approval") && (
              <select className="field" value={stage.reviewer ?? ""} onChange={(e) => onChange({ reviewer: e.target.value || undefined })} aria-label={`Who checks ${stage.name}`}>
                <option value="">Any {stage.gate === "review" ? "reviewer" : "approver"}</option>
                {checkers(stage.gate).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            )}
          </div>
        </Field>
        <div className="col-span-3">
          <Field label="Done when" hint={`Optional, up to ${STAGE_DESCRIPTION_MAX} characters. Told to whoever does the stage, so they know when to hand it on.`}>
            <textarea
              className="field h-[52px] resize-y"
              maxLength={STAGE_DESCRIPTION_MAX}
              value={stage.description ?? ""}
              placeholder="e.g. A full draft that meets the brief is in shared/scripts/."
              onChange={(e) => onChange({ description: e.target.value })}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}
